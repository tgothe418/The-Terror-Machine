import type {
  AttemptFilterContext,
  CanAttemptResult,
  RestraintLevel,
} from '../types/worldState';

/**
 * Verb-to-restraint mapping: which verbs are gated by which binding levels.
 * This is the executability filter's core logic.
 */
export const VERB_RESTRAINT_REQUIREMENTS: Record<string, RestraintLevel[]> = {
  // Locomotion verbs require at least one free leg (no TIED_TO_FIXTURE/FULL_HOGTIE)
  FLEE: ['UNRESTRAINED', 'WRISTS_BOUND_FRONT', 'WRISTS_BOUND_BEHIND'],
  INVESTIGATE: ['UNRESTRAINED', 'WRISTS_BOUND_FRONT', 'WRISTS_BOUND_BEHIND'],
  CLOSE_IN: ['UNRESTRAINED', 'WRISTS_BOUND_FRONT', 'WRISTS_BOUND_BEHIND'],
  HIDE: ['UNRESTRAINED', 'WRISTS_BOUND_FRONT', 'WRISTS_BOUND_BEHIND'],

  // Fine-motor manipulation verbs require completely free hands (no binding)
  FORTIFY: ['UNRESTRAINED'],
  TRAP: ['UNRESTRAINED'],
  PICK_LOCK: ['UNRESTRAINED'],

  // Coarse manipulation verbs (WRISTS_BOUND_FRONT allows LIGHT objects only)
  // Handled by inReach() + sizeClass check in worldPredicates.ts

  // Vocal verbs are unaffected by binding (unless gagged — future A5 scope)
  // PARLEY, WARN, MOURN, RECRUIT, FRACTURE, DENY, MISDIRECT, PURSUE_AGENDA — no restraint gate (intentionally unmapped)

  // SUBMIT is always available (it's a psychological state, not a physical action — intentionally unmapped)
};

/**
 * Evaluates whether a verb is physically executable given the character's restraint state.
 */
export function evaluateVerbRestraint(
  characterId: string,
  verb: string,
  ctx: AttemptFilterContext
): CanAttemptResult {
  const binding = ctx.restraint.bindings[characterId]?.level || 'UNRESTRAINED';
  const allowedLevels = VERB_RESTRAINT_REQUIREMENTS[verb];

  // If the verb isn't in the map, it's unrestricted (vocal verbs, SUBMIT, etc.)
  if (!allowedLevels) {
    return {
      allowed: true,
      reasonCode: 'ALLOWED',
      provenance: `Verb ${verb} has no restraint gate.`,
    };
  }

  if (!allowedLevels.includes(binding)) {
    return {
      allowed: false,
      reasonCode: 'RESTRAINT_BINDING',
      provenance: `Binding level ${binding} denies verb ${verb}. Allowed levels: ${allowedLevels.join(', ')}.`,
    };
  }

  return {
    allowed: true,
    reasonCode: 'ALLOWED',
    provenance: `Binding level ${binding} permits verb ${verb}.`,
  };
}

/**
 * Evaluates whether a target (object or edge) is locked and thus unreachable.
 */
export function evaluateLockState(
  targetRef: { kind: 'EDGE' | 'CONTAINER'; id: string },
  ctx: AttemptFilterContext
): CanAttemptResult {
  const lockKey = `${targetRef.kind}:${targetRef.id}`;
  const lock = ctx.restraint.locks[lockKey];

  if (!lock) {
    return {
      allowed: true,
      reasonCode: 'ALLOWED',
      provenance: `No lock state for ${lockKey}.`,
    };
  }

  if (lock.locked) {
    return {
      allowed: false,
      reasonCode: 'LOCK',
      provenance: `${lockKey} is locked.${lock.keyObjectId ? ` Key: ${lock.keyObjectId}` : ' No key in world.'}`,
    };
  }

  return {
    allowed: true,
    reasonCode: 'ALLOWED',
    provenance: `${lockKey} is unlocked.`,
  };
}

/**
 * Composite restraint check: evaluates verb + target against binding and lock state.
 * This is the function the turn execution layer calls.
 */
export function checkRestraint(
  characterId: string,
  verb: string,
  targetId: string | null,
  ctx: AttemptFilterContext
): CanAttemptResult {
  // 1. Check verb-level restraint
  const verbCheck = evaluateVerbRestraint(characterId, verb, ctx);
  if (!verbCheck.allowed) return verbCheck;

  // 2. Check target-specific locks (if target is an edge or container)
  if (targetId) {
    // Check direct edge lock reference first
    if (ctx.restraint.locks[`EDGE:${targetId}`]) {
      const lockCheck = evaluateLockState({ kind: 'EDGE', id: targetId }, ctx);
      if (!lockCheck.allowed) return lockCheck;
    }

    // Check if target is or connects to a topology edge
    const charNode = ctx.characterNodes[characterId];
    let edge = ctx.topologyConnections.find(
      (e) => `${e.fromNodeId}->${e.toNodeId}` === targetId
    );
    if (!edge && charNode) {
      edge = ctx.topologyConnections.find(
        (e) =>
          (e.fromNodeId === charNode && e.toNodeId === targetId) ||
          (e.toNodeId === charNode && e.fromNodeId === targetId)
      );
    }
    if (!edge) {
      edge = ctx.topologyConnections.find(
        (e) => e.toNodeId === targetId || e.fromNodeId === targetId
      );
    }

    if (edge && edge.status === 'LOCKED') {
      let lockCheck = evaluateLockState(
        { kind: 'EDGE', id: `${edge.fromNodeId}->${edge.toNodeId}` },
        ctx
      );
      if (!lockCheck.allowed) return lockCheck;

      const reverseKey = `${edge.toNodeId}->${edge.fromNodeId}`;
      if (ctx.restraint.locks[`EDGE:${reverseKey}`]) {
        lockCheck = evaluateLockState({ kind: 'EDGE', id: reverseKey }, ctx);
        if (!lockCheck.allowed) return lockCheck;
      }
    }

    // Check if target is a container object or has an explicit container lock
    const targetObj = ctx.objects[targetId];
    if (
      (targetObj && targetObj.containerState === 'CLOSED') ||
      ctx.restraint.locks[`CONTAINER:${targetId}`]
    ) {
      const lockCheck = evaluateLockState({ kind: 'CONTAINER', id: targetId }, ctx);
      if (!lockCheck.allowed) return lockCheck;
    }
  }

  return {
    allowed: true,
    reasonCode: 'ALLOWED',
    provenance: 'All restraint checks passed.',
  };
}
