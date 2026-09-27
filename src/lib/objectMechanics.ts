import type {
  AttemptFilterContext,
  ObjectTransitionDecision,
  ObjectTransitionProposal,
  ObjectTransitionReason,
  RestraintLedger,
  WorldObjectLedger,
} from '../types/worldState';

/**
 * Specific reach-failure diagnosis (Packet 0's inReach is a boolean;
 * transitions need the reason). Order of checks mirrors inReach exactly.
 */
export function reachFailureReason(
  characterId: string,
  objectId: string,
  ctx: AttemptFilterContext
): { code: ObjectTransitionReason; provenance: string } | null {
  const obj = ctx.objects[objectId];
  if (!obj) {
    return { code: 'NOT_AN_OBJECT', provenance: `Object ${objectId} does not exist in the world ledger.` };
  }

  const charNode = ctx.characterNodes[characterId];
  if (!charNode) {
    return { code: 'OUT_OF_REACH', provenance: `Character ${characterId} has no node.` };
  }

  // Co-location (containers resolve to their owning node; carriers to their node)
  if (obj.location.kind === 'NODE' && obj.location.id !== charNode) {
    return {
      code: 'OUT_OF_REACH',
      provenance: `Object ${objectId} is in node ${obj.location.id}; character is in ${charNode}.`,
    };
  }
  if (obj.location.kind === 'CONTAINER') {
    let currentContainerId: string | undefined = obj.location.id;
    const visited = new Set<string>();

    while (currentContainerId) {
      if (visited.has(currentContainerId)) {
        return { code: 'OUT_OF_REACH', provenance: `Cyclic container reference at ${currentContainerId}.` };
      }
      visited.add(currentContainerId);

      const parent = ctx.objects[currentContainerId];
      if (!parent) {
        return { code: 'NOT_A_CONTAINER', provenance: `Parent container ${currentContainerId} missing.` };
      }
      if (parent.containerState !== 'OPEN') {
        return {
          code: 'CONTAINER_CLOSED',
          provenance: `Object ${objectId} is inside closed container ${parent.objectId}.`,
        };
      }
      if (parent.location.kind === 'NODE') {
        if (parent.location.id !== charNode) {
          return {
            code: 'OUT_OF_REACH',
            provenance: `Container ${parent.objectId} is not co-located with ${characterId}.`,
          };
        }
        break;
      } else if (parent.location.kind === 'CARRIER') {
        if (parent.location.id !== characterId) {
          return {
            code: 'OUT_OF_REACH',
            provenance: `Object ${objectId} is carried by ${parent.location.id}.`,
          };
        }
        break;
      } else if (parent.location.kind === 'CONTAINER') {
        currentContainerId = parent.location.id;
      } else {
        return { code: 'OUT_OF_REACH', provenance: `Invalid container location.` };
      }
    }
  }
  if (obj.location.kind === 'CARRIER' && obj.location.id !== characterId) {
    return {
      code: 'OUT_OF_REACH',
      provenance: `Object ${objectId} is carried by ${obj.location.id}.`,
    };
  }

  // Grip
  const binding = ctx.restraint?.bindings?.[characterId]?.level || 'UNRESTRAINED';
  if (binding === 'WRISTS_BOUND_FRONT' && obj.sizeClass !== 'LIGHT') {
    return {
      code: 'RESTRAINT_BINDING',
      provenance: `Binding ${binding} permits LIGHT objects only; ${objectId} is ${obj.sizeClass}.`,
    };
  }
  if (['WRISTS_BOUND_BEHIND', 'TIED_TO_FIXTURE', 'FULL_HOGTIE'].includes(binding)) {
    return {
      code: 'RESTRAINT_BINDING',
      provenance: `Binding ${binding} denies object manipulation.`,
    };
  }

  // Capability
  const impaired = ctx.capabilities?.[characterId]?.impairedCapabilities || [];
  if (impaired.includes('GRIP_COARSE')) {
    return {
      code: 'CAPABILITY_IMPAIRED',
      provenance: `Grip capability impaired for ${characterId}.`,
    };
  }

  return null; // reachable
}

/**
 * Evaluates one object transition proposal. Pure; no ledger mutation.
 */
export function evaluateObjectTransition(
  characterId: string,
  proposal: ObjectTransitionProposal,
  ctx: AttemptFilterContext
): ObjectTransitionDecision {
  const deny = (code: ObjectTransitionReason, provenance: string): ObjectTransitionDecision => ({
    proposal,
    accepted: false,
    reasonCode: code,
    provenance,
  });
  const allow = (provenance: string): ObjectTransitionDecision => ({
    proposal,
    accepted: true,
    reasonCode: 'ALLOWED',
    provenance,
  });

  const obj = ctx.objects[proposal.objectId];
  if (!obj && proposal.transition !== 'UNLOCK') {
    return deny('NOT_AN_OBJECT', `Object ${proposal.objectId} does not exist.`);
  }

  switch (proposal.transition) {
    case 'PICKUP': {
      if (!obj) return deny('NOT_AN_OBJECT', `Object ${proposal.objectId} does not exist.`);
      if (obj.location.kind === 'CARRIER' && obj.location.id === characterId) {
        return deny('ALREADY_IN_STATE', `${characterId} already carries ${proposal.objectId}.`);
      }
      const fail = reachFailureReason(characterId, proposal.objectId, ctx);
      if (fail) return deny(fail.code, fail.provenance);
      return allow(`${characterId} can reach ${proposal.objectId}; pickup permitted.`);
    }

    case 'DROP': {
      if (!obj) return deny('NOT_AN_OBJECT', `Object ${proposal.objectId} does not exist.`);
      if (!(obj.location.kind === 'CARRIER' && obj.location.id === characterId)) {
        return deny('ALREADY_IN_STATE', `${characterId} is not carrying ${proposal.objectId}.`);
      }
      const charNode = ctx.characterNodes[characterId];
      if (!charNode) {
        return deny('OUT_OF_REACH', `Character ${characterId} has no node.`);
      }
      return allow(`${characterId} carries ${proposal.objectId}; drop permitted.`);
    }

    case 'PLACE_IN': {
      if (!obj) return deny('NOT_AN_OBJECT', `Object ${proposal.objectId} does not exist.`);
      const targetId = proposal.targetContainerId;
      if (!targetId) return deny('NOT_A_CONTAINER', 'PLACE_IN requires targetContainerId.');
      if (targetId === proposal.objectId) {
        return deny('NOT_A_CONTAINER', 'An object cannot be placed inside itself.');
      }
      const target = ctx.objects[targetId];
      if (!target) return deny('NOT_AN_OBJECT', `Container ${targetId} does not exist.`);
      if (target.containerState === undefined) {
        return deny('NOT_A_CONTAINER', `${targetId} has no container state.`);
      }
      if (target.containerState !== 'OPEN') {
        return deny('CONTAINER_CLOSED', `Container ${targetId} is closed.`);
      }
      if (obj.location.kind === 'CONTAINER' && obj.location.id === targetId) {
        return deny('ALREADY_IN_STATE', `Object ${proposal.objectId} is already inside container ${targetId}.`);
      }
      // Cycle guard: target container cannot be inside proposal.objectId
      let curr = target.location;
      const visited = new Set<string>();
      while (curr && curr.kind === 'CONTAINER') {
        if (curr.id === proposal.objectId) {
          return deny('NOT_A_CONTAINER', `Cannot place ${proposal.objectId} inside its own descendant container ${targetId}.`);
        }
        if (visited.has(curr.id)) break;
        visited.add(curr.id);
        const parent = ctx.objects[curr.id];
        if (!parent) break;
        curr = parent.location;
      }
      const failObj = reachFailureReason(characterId, proposal.objectId, ctx);
      if (failObj) return deny(failObj.code, failObj.provenance);
      const failTarget = reachFailureReason(characterId, targetId, ctx);
      if (failTarget) return deny(failTarget.code, failTarget.provenance);
      return allow(`${proposal.objectId} and open container ${targetId} both in reach.`);
    }

    case 'OPEN':
    case 'CLOSE': {
      if (!obj) return deny('NOT_AN_OBJECT', `Object ${proposal.objectId} does not exist.`);
      if (obj.containerState === undefined) {
        return deny('NOT_A_CONTAINER', `${proposal.objectId} has no container state.`);
      }
      const want = proposal.transition === 'OPEN' ? 'OPEN' : 'CLOSED';
      if (obj.containerState === want) {
        return deny('ALREADY_IN_STATE', `${proposal.objectId} is already ${want}.`);
      }
      if (proposal.transition === 'OPEN') {
        const lockKey = `CONTAINER:${proposal.objectId}`;
        const lock = ctx.restraint?.locks?.[lockKey];
        if (lock && lock.locked) {
          return deny(
            'LOCK',
            `Container ${proposal.objectId} is locked.${lock.keyObjectId ? ` Requires key ${lock.keyObjectId}.` : ' No key in world.'}`
          );
        }
      }
      const fail = reachFailureReason(characterId, proposal.objectId, ctx);
      if (fail) return deny(fail.code, fail.provenance);
      return allow(`${proposal.transition} of ${proposal.objectId} permitted.`);
    }

    case 'UNLOCK': {
      const lockKey = `CONTAINER:${proposal.objectId}`;
      const edgeLockKey = `EDGE:${proposal.objectId}`;
      const lock = ctx.restraint?.locks?.[lockKey] ?? ctx.restraint?.locks?.[edgeLockKey];
      if (!lock) {
        if (!obj) return deny('NOT_AN_OBJECT', `Object ${proposal.objectId} does not exist.`);
        return deny('ALREADY_IN_STATE', `No lock state for ${proposal.objectId}.`);
      }
      if (!lock.locked) return deny('ALREADY_IN_STATE', `${proposal.objectId} is already unlocked.`);
      if (!lock.keyObjectId) {
        return deny('LOCK', `${proposal.objectId} is locked with no key authored in the world.`);
      }
      if (obj) {
        const targetFail = reachFailureReason(characterId, proposal.objectId, ctx);
        if (targetFail) return deny(targetFail.code, targetFail.provenance);
      }
      const keyFail = reachFailureReason(characterId, lock.keyObjectId, ctx);
      if (keyFail) return deny(keyFail.code, `Key ${lock.keyObjectId} not usable: ${keyFail.provenance}`);
      return allow(`Key ${lock.keyObjectId} in reach; unlock of ${proposal.objectId} permitted.`);
    }

    default:
      return deny('NOT_AN_OBJECT', `Unknown transition.`);
  }
}

/**
 * Pure commit: returns a NEW ledger with one accepted transition applied.
 * Reducer calls this per accepted decision during PROCESS_OBJECT_TRANSITIONS.
 */
export function applyObjectTransition(
  ledger: WorldObjectLedger,
  characterId: string,
  proposal: ObjectTransitionProposal,
  ctx: AttemptFilterContext
): WorldObjectLedger {
  const next: WorldObjectLedger = JSON.parse(JSON.stringify(ledger));
  const obj = next[proposal.objectId];
  if (!obj) return next;

  switch (proposal.transition) {
    case 'PICKUP':
      obj.location = { kind: 'CARRIER', id: characterId };
      break;
    case 'DROP':
      obj.location = { kind: 'NODE', id: ctx.characterNodes[characterId] || 'node-1' };
      break;
    case 'PLACE_IN':
      if (proposal.targetContainerId) {
        obj.location = { kind: 'CONTAINER', id: proposal.targetContainerId };
      }
      break;
    case 'OPEN':
      obj.containerState = 'OPEN';
      break;
    case 'CLOSE':
      obj.containerState = 'CLOSED';
      break;
    case 'UNLOCK':
      // Lock flags live in restraintLedger.locks, handled via applyLockTransition
      break;
  }
  return next;
}

/**
 * Pure commit for lock state: returns a NEW restraint ledger with lock state updated.
 */
export function applyLockTransition(
  restraintLedger: RestraintLedger,
  decision: ObjectTransitionDecision
): RestraintLedger {
  if (!decision.accepted || decision.proposal.transition !== 'UNLOCK') {
    return restraintLedger;
  }
  const next: RestraintLedger = JSON.parse(JSON.stringify(restraintLedger));
  const lockKey = `CONTAINER:${decision.proposal.objectId}`;
  const edgeLockKey = `EDGE:${decision.proposal.objectId}`;
  const key = next.locks[lockKey] ? lockKey : edgeLockKey;
  if (next.locks[key]) {
    next.locks[key].locked = false;
  }
  return next;
}
