import type {
  AttemptFilterContext,
  AttentionState,
  AttentionTransitionDecision,
  AttentionTransitionProposal,
  AttentionTransitionReason,
} from '../types/worldState';
import { inReach, resolveObjectNodeId } from './worldPredicates';

/**
 * Evaluates an attention transition proposal against the current world state.
 * Implements Invariant 2 (model proposes, machine commits) and Invariant 6 (NPC state only).
 */
export function evaluateAttentionTransition(
  proposal: AttentionTransitionProposal,
  ctx: AttemptFilterContext
): AttentionTransitionDecision {
  const deny = (code: AttentionTransitionReason, provenance: string): AttentionTransitionDecision => ({
    proposal,
    accepted: false,
    reasonCode: code,
    provenance,
  });

  const allow = (provenance: string): AttentionTransitionDecision => ({
    proposal,
    accepted: true,
    reasonCode: 'ALLOWED',
    provenance,
  });

  // Invariant 6: Attention is NPC state only
  if (!ctx.attention || !ctx.attention[proposal.characterId]) {
    return deny('NOT_AN_NPC', `Character ${proposal.characterId} is not tracked in the attention ledger.`);
  }

  if (ctx.seats?.preyCharacterIds?.includes(proposal.characterId)) {
    return deny('NOT_AN_NPC', `Character ${proposal.characterId} is a player character; attention is NPC state only.`);
  }

  const att = ctx.attention[proposal.characterId];
  const charNode = ctx.characterNodes[proposal.characterId];

  switch (proposal.transition) {
    case 'CAPTURE': {
      if (!proposal.target) {
        return deny('TARGET_REQUIRED', 'CAPTURE transition requires target.');
      }

      // Target reachability check
      if (proposal.target.kind === 'OBJECT') {
        if (!inReach(proposal.characterId, proposal.target.id, ctx)) {
          return deny('TARGET_OUT_OF_REACH', `Target object ${proposal.target.id} is out of reach for ${proposal.characterId}.`);
        }
      } else if (proposal.target.kind === 'CHARACTER') {
        const targetNode = ctx.characterNodes[proposal.target.id];
        if (!charNode || !targetNode || charNode !== targetNode) {
          return deny('TARGET_OUT_OF_REACH', `Target character ${proposal.target.id} is not co-located with ${proposal.characterId}.`);
        }
      } else if (proposal.target.kind === 'NODE') {
        if (!charNode || proposal.target.id !== charNode) {
          return deny('TARGET_OUT_OF_REACH', `Target node ${proposal.target.id} is not the current node for ${proposal.characterId}.`);
        }
      }

      if (att.attendingTo?.kind === proposal.target.kind && att.attendingTo.id === proposal.target.id) {
        return deny('ALREADY_IN_STATE', `${proposal.characterId} is already attending to ${proposal.target.kind}:${proposal.target.id}.`);
      }

      return allow(`${proposal.characterId} captured attention on ${proposal.target.kind}:${proposal.target.id}.`);
    }

    case 'RELEASE': {
      if (!att.attendingTo) {
        return deny('ALREADY_IN_STATE', `${proposal.characterId} is not currently attending to any target.`);
      }

      return allow(`${proposal.characterId} released attention from ${att.attendingTo.kind}:${att.attendingTo.id}.`);
    }

    case 'DISTRACT': {
      if (!proposal.durationMinutes || proposal.durationMinutes <= 0) {
        return deny('DURATION_REQUIRED', 'DISTRACT transition requires positive durationMinutes.');
      }

      if (att.lapse?.active && att.lapse.expiresAtFictionalTime > ctx.fictionalTime) {
        return deny('ALREADY_IN_STATE', `${proposal.characterId} already has an active distraction lapse.`);
      }

      return allow(`${proposal.characterId} distracted for ${proposal.durationMinutes} minutes.`);
    }

    default:
      return deny('ALREADY_IN_STATE', 'Unknown transition kind.');
  }
}

/**
 * Pure, non-mutating application of an accepted attention transition.
 * Sets attendingTo or lapse with expiresAtFictionalTime = ctx.fictionalTime + (durationMinutes * 60).
 */
export function applyAttentionTransition(
  ledger: Record<string, AttentionState>,
  proposal: AttentionTransitionProposal,
  ctx: AttemptFilterContext
): Record<string, AttentionState> {
  const nextLedger: Record<string, AttentionState> = JSON.parse(JSON.stringify(ledger));
  const current = nextLedger[proposal.characterId];
  if (!current) return nextLedger;

  switch (proposal.transition) {
    case 'CAPTURE':
      current.attendingTo = proposal.target ? { kind: proposal.target.kind, id: proposal.target.id } : null;
      break;
    case 'RELEASE':
      current.attendingTo = null;
      break;
    case 'DISTRACT':
      if (proposal.durationMinutes) {
        const expiresAt = ctx.fictionalTime + proposal.durationMinutes * 60;
        current.lapse = {
          active: true,
          expiresAtFictionalTime: expiresAt,
        };
      }
      break;
  }

  return nextLedger;
}

/**
 * Joint Attention Coverage (G-C):
 * Evaluates whether an action on a target is unobserved by all co-located captors.
 * An action is unobserved only when all co-located captors either have an active lapse
 * or are attending to something else. One vigilant captor = observed (returns false).
 * Empty attention ledger defaults to false (always-attending; CC1 regression guard).
 */
export function isActionUnobserved(
  actionTargetRef: { kind: 'NODE' | 'OBJECT' | 'CHARACTER'; id: string },
  ctx: AttemptFilterContext
): boolean {
  if (!ctx.attention || Object.keys(ctx.attention).length === 0) {
    return false;
  }

  let targetNodeId: string | undefined;
  if (actionTargetRef.kind === 'NODE') {
    targetNodeId = actionTargetRef.id;
  } else if (actionTargetRef.kind === 'CHARACTER') {
    targetNodeId = ctx.characterNodes[actionTargetRef.id];
  } else if (actionTargetRef.kind === 'OBJECT') {
    targetNodeId = resolveObjectNodeId(actionTargetRef.id, ctx.objects, ctx.characterNodes);
  }

  if (!targetNodeId) {
    return false;
  }

  for (const captorId of ctx.seats?.captorCharacterIds || []) {
    const captorNode = ctx.characterNodes[captorId];
    if (captorNode !== targetNodeId) continue;

    const att = ctx.attention[captorId];
    if (!att) return false;

    if (att.lapse?.active && att.lapse.expiresAtFictionalTime > ctx.fictionalTime) {
      continue;
    }

    if (!att.attendingTo || att.attendingTo.id === actionTargetRef.id || att.attendingTo.id === targetNodeId) {
      return false;
    }

    if (actionTargetRef.kind === 'OBJECT') {
      let currentObj = ctx.objects[actionTargetRef.id];
      const visited = new Set<string>();
      while (currentObj && !visited.has(currentObj.objectId)) {
        visited.add(currentObj.objectId);
        if (currentObj.location.kind === 'CONTAINER' || currentObj.location.kind === 'CARRIER') {
          if (att.attendingTo.id === currentObj.location.id) {
            return false;
          }
          if (currentObj.location.kind === 'CONTAINER') {
            currentObj = ctx.objects[currentObj.location.id];
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }
  }

  return true;
}
