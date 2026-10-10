import type { AcousticMedium } from '../types/vocalization';
import { AcousticMediumSchema } from '../types/vocalization';
import type { AttentionLedger, WorldObjectLedger } from '../types/worldState';

/**
 * Traverses world-object carrier/container chains to check if an object
 * is currently held by a given character.
 */
function isAttendingToSourceViaObjects(
  attendingToId: string,
  sourceCharacterId: string,
  objects: WorldObjectLedger
): boolean {
  let currentObj = objects[attendingToId];
  const visited = new Set<string>();
  while (currentObj && !visited.has(currentObj.objectId || attendingToId)) {
    visited.add(currentObj.objectId || attendingToId);
    if (currentObj.location.kind === 'CARRIER') {
      return currentObj.location.id === sourceCharacterId;
    }
    if (currentObj.location.kind === 'CONTAINER') {
      currentObj = objects[currentObj.location.id];
    } else {
      break;
    }
  }
  return false;
}

/**
 * Known limitation: The medium model is acoustic/vocalization-centric — there is no
 * sight/visual medium, so a trace like "seen entering Room 6" has no faithful medium today.
 * A future packet may extend the enum; v1 does not.
 *
 * Computes the deterministic set of character IDs who observed a given trace.
 *
 * Rules:
 * 1. Candidate observers = all character ids in `ctx.characterNodes` whose node === `trace.nodeId`,
 *    EXCLUDING `trace.sourceCharacterId` when provided (a character does not witness its own trace).
 * 2. Inclusion semantics per candidate (mirrors `isObserved` from `src/lib/worldPredicates.ts:119-158`):
 *    - No attention record → included
 *    - Empty attention ledger → included
 *    - Active lapse (expiresAtFictionalTime > ctx.fictionalTime) → excluded
 *    - attendingTo is null → included
 *    - attendingTo matching trace node id or source character id (or via object container/carrier chaining) → included
 *    - Otherwise → excluded
 * 3. `medium` is accepted on the trace and validated as `AcousticMedium`, but does not expand
 *    the observer set in v1 (no cross-node propagation rules yet). Co-located computation only.
 * 4. Returns observer IDs sorted lexicographically for deterministic output.
 */
export function computeObserverSet(
  trace: { nodeId: string; medium: AcousticMedium; sourceCharacterId?: string },
  ctx: {
    characterNodes: Record<string, string>;
    attention: AttentionLedger;
    fictionalTime: number;
    objects?: WorldObjectLedger;
  }
): string[] {
  if (!trace || typeof trace.nodeId !== 'string' || !trace.nodeId) {
    return [];
  }

  // Validate AcousticMedium per Rule 3
  if (!trace.medium || !AcousticMediumSchema.safeParse(trace.medium).success) {
    return [];
  }

  if (!ctx || !ctx.characterNodes) {
    return [];
  }

  const observers: string[] = [];
  const emptyLedger = !ctx.attention || Object.keys(ctx.attention).length === 0;

  for (const [characterId, charNodeId] of Object.entries(ctx.characterNodes)) {
    // Co-location check: character must be at trace.nodeId
    if (charNodeId !== trace.nodeId) {
      continue;
    }

    // Rule 1: A character does not witness their own trace
    if (trace.sourceCharacterId && characterId === trace.sourceCharacterId) {
      continue;
    }

    // Rule 2: Empty attention ledger = always-attending (CC1 regression guard)
    if (emptyLedger) {
      observers.push(characterId);
      continue;
    }

    const att = ctx.attention[characterId];

    // Rule 2: Missing attention record defaults to attending (NPC-only state / player character invariant)
    if (!att) {
      observers.push(characterId);
      continue;
    }

    // Rule 2: Active lapse check
    const hasActiveLapse = Boolean(att.lapse?.active && att.lapse.expiresAtFictionalTime > ctx.fictionalTime);
    if (hasActiveLapse) {
      continue;
    }

    // Rule 2: attendingTo is null/undefined = general room awareness
    if (!att.attendingTo) {
      observers.push(characterId);
      continue;
    }

    // Rule 2: attendingTo matches trace node id
    if (att.attendingTo.id === trace.nodeId) {
      observers.push(characterId);
      continue;
    }

    // Rule 2: attendingTo matches source character id
    if (trace.sourceCharacterId && att.attendingTo.id === trace.sourceCharacterId) {
      observers.push(characterId);
      continue;
    }

    // Rule 2: attendingTo matches via object container/carrier chaining to source character
    if (
      ctx.objects &&
      trace.sourceCharacterId &&
      isAttendingToSourceViaObjects(att.attendingTo.id, trace.sourceCharacterId, ctx.objects)
    ) {
      observers.push(characterId);
      continue;
    }

    // Otherwise excluded
  }

  // Rule 4: Return sorted observer IDs for determinism
  return observers.sort((a, b) => a.localeCompare(b));
}
