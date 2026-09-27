import type {
  AttemptFilterContext,
  CanAttemptResult,
  RestraintLevel,
  ObjectSizeClass,
  RoutineState,
  WorldObjectLedger,
} from '../types/worldState';
import { checkRestraint } from './restraintMechanics';

/**
 * Grip Matrix: evaluates physical grip affordance from binding level and sizeClass
 */
export function restraintAllowsGrip(level: RestraintLevel, sizeClass: ObjectSizeClass): boolean {
  switch (level) {
    case 'UNRESTRAINED':
      return true;
    case 'WRISTS_BOUND_FRONT':
      return sizeClass === 'LIGHT';
    case 'WRISTS_BOUND_BEHIND':
    case 'TIED_TO_FIXTURE':
    case 'FULL_HOGTIE':
      return false;
  }
}

/**
 * Resolves the ultimate node where an object is located, traversing through
 * container hierarchies or carrier characters.
 */
export function resolveObjectNodeId(
  objectId: string,
  objects: WorldObjectLedger,
  characterNodes: Record<string, string>,
  visited = new Set<string>()
): string | undefined {
  if (visited.has(objectId)) return undefined;
  visited.add(objectId);

  const obj = objects[objectId];
  if (!obj) return undefined;

  if (obj.location.kind === 'NODE') {
    return obj.location.id;
  }
  if (obj.location.kind === 'CARRIER') {
    return characterNodes[obj.location.id];
  }
  if (obj.location.kind === 'CONTAINER') {
    return resolveObjectNodeId(obj.location.id, objects, characterNodes, visited);
  }
  return undefined;
}

/**
 * In-Reach Calculus: CoLocated ∧ ContainerAccessible ∧ GripAffordance ∧ Capability
 */
export function inReach(characterId: string, objectId: string, ctx: AttemptFilterContext): boolean {
  const obj = ctx.objects[objectId];
  if (!obj) return false;

  const charNode = ctx.characterNodes[characterId];
  if (!charNode) return false;

  // 1. Co-location and container accessibility check
  if (obj.location.kind === 'NODE') {
    if (obj.location.id !== charNode) return false;
  } else if (obj.location.kind === 'CARRIER') {
    if (obj.location.id !== characterId) return false;
  } else if (obj.location.kind === 'CONTAINER') {
    let currentContainerId: string | undefined = obj.location.id;
    const visitedContainers = new Set<string>();
    let containerAccessible = false;

    while (currentContainerId) {
      if (visitedContainers.has(currentContainerId)) return false;
      visitedContainers.add(currentContainerId);

      const parent = ctx.objects[currentContainerId];
      if (!parent || parent.containerState !== 'OPEN') return false;

      if (parent.location.kind === 'NODE') {
        if (parent.location.id === charNode) {
          containerAccessible = true;
          break;
        }
        return false;
      } else if (parent.location.kind === 'CARRIER') {
        if (parent.location.id === characterId) {
          containerAccessible = true;
          break;
        }
        return false;
      } else if (parent.location.kind === 'CONTAINER') {
        currentContainerId = parent.location.id;
      } else {
        return false;
      }
    }

    if (!containerAccessible) return false;
  }

  // 3. Grip affordance
  const binding = ctx.restraint.bindings[characterId]?.level || 'UNRESTRAINED';
  if (!restraintAllowsGrip(binding, obj.sizeClass)) return false;

  // 4. Capability slot (A5 stub)
  const impaired = ctx.capabilities[characterId]?.impairedCapabilities || [];
  if (impaired.includes('GRIP_COARSE')) return false;

  return true;
}

/**
 * Joint Attention Coverage (G-C): Opportunity is observed if ANY co-located captor attends without a lapse.
 * Uses `ctx.seats.captorCharacterIds` indirection — invariant to single/multi-villain binding (B1-safe).
 */
export function isObserved(
  targetRef: { kind: 'NODE' | 'OBJECT' | 'CHARACTER'; id: string },
  ctx: AttemptFilterContext
): boolean {
  const targetNodeId =
    targetRef.kind === 'NODE'
      ? targetRef.id
      : targetRef.kind === 'CHARACTER'
      ? ctx.characterNodes[targetRef.id]
      : resolveObjectNodeId(targetRef.id, ctx.objects, ctx.characterNodes);

  if (!targetNodeId) return false;

  // CC1 regression guard: empty attention ledger = always-attending
  if (Object.keys(ctx.attention).length === 0) return true;

  for (const captorId of ctx.seats.captorCharacterIds) {
    const captorNode = ctx.characterNodes[captorId];
    if (captorNode !== targetNodeId) continue;

    const att = ctx.attention[captorId];
    if (!att) return true; // Missing attention record defaults to attending

    const hasActiveLapse = att.lapse?.active && att.lapse.expiresAtFictionalTime > ctx.fictionalTime;
    if (hasActiveLapse) continue;

    if (!att.attendingTo || att.attendingTo.id === targetRef.id || att.attendingTo.id === targetNodeId) {
      return true;
    }

    // If target is an object, captor also observes it if attending to its direct container or carrier
    if (targetRef.kind === 'OBJECT') {
      const obj = ctx.objects[targetRef.id];
      if (obj && att.attendingTo.id === obj.location.id) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Executability Gate: Evaluates whether a character can attempt an action
 */
export function canAttempt(
  characterId: string,
  verb: string,
  targetId: string,
  ctx: AttemptFilterContext
): CanAttemptResult {
  // 1. Restraint & Lock gate (physical binding and locked topology/containers)
  const restraintResult = checkRestraint(characterId, verb, targetId, ctx);
  if (!restraintResult.allowed) {
    return restraintResult;
  }

  const impaired = ctx.capabilities[characterId]?.impairedCapabilities || [];

  // Locomotion gating (capability impairments)
  if (['FLEE', 'INVESTIGATE', 'CLOSE_IN', 'HIDE'].includes(verb)) {
    if (impaired.includes('LOCOMOTION_NORMAL') || impaired.includes('LOCOMOTION_RAPID')) {
      return { allowed: false, reasonCode: 'CAPABILITY_IMPAIRED', provenance: 'Locomotion capability impaired.' };
    }
  }

  // Manipulation / Object gating (reach)
  if (['FORTIFY', 'TRAP', 'PICK_LOCK'].includes(verb) || ctx.objects[targetId]) {
    if (ctx.objects[targetId] && !inReach(characterId, targetId, ctx)) {
      return { allowed: false, reasonCode: 'OUT_OF_REACH', provenance: `Object ${targetId} is not in reach.` };
    }
  }

  return { allowed: true, reasonCode: 'ALLOWED', provenance: 'Attempt permitted under world state.' };
}

/**
 * Deterministic Routine Drift: clamp(base + Σ modifiers, min, max)
 * Hash-jitter ±ε tiebreaker ONLY — no free PRNG (R2).
 * Fired modifier IDs are receipt provenance (CC3).
 */
export function computeDrift(
  routine: RoutineState,
  ctx: AttemptFilterContext
): { driftMinutes: number; firedModifierIds: string[] } {
  let deltaSum = 0;
  const firedModifierIds: string[] = [];

  for (const mod of routine.modifiers || []) {
    let matched = false;
    const p = mod.predicate;

    switch (p.kind) {
      case 'CO_LOCATION':
        matched = Boolean(
          ctx.characterNodes?.[p.charA] &&
          ctx.characterNodes?.[p.charB] &&
          ctx.characterNodes[p.charA] === ctx.characterNodes[p.charB]
        );
        break;
      case 'RESTRAINT_LEVEL':
        matched = (ctx.restraint?.bindings?.[p.characterId]?.level || 'UNRESTRAINED') === p.level;
        break;
      case 'OBJECT_PRESENT':
        matched = Boolean(
          ctx.objects?.[p.objectId] &&
          (ctx.objects[p.objectId]?.location.id === p.nodeId ||
            resolveObjectNodeId(p.objectId, ctx.objects || {}, ctx.characterNodes || {}) === p.nodeId)
        );
        break;
      case 'CLOCK_PHASE':
        matched = Boolean(
          ctx.clocks &&
          ctx.clocks[p.clockId] &&
          ctx.clocks[p.clockId] === p.minPhase
        );
        break;
      case 'RELATIONSHIP_STANCE':
        matched = Boolean(
          ctx.relationships?.some(
            (r) =>
              ((r.charA === p.charA && r.charB === p.charB) ||
                (r.charA === p.charB && r.charB === p.charA)) &&
              r.stance.toLowerCase() === p.stance.toLowerCase()
          )
        );
        break;
      default:
        matched = false;
    }

    if (matched) {
      deltaSum += mod.deltaMinutes;
      firedModifierIds.push(mod.id);
    }
  }

  const clamped = Math.max(
    routine.varianceBand.minMinutes,
    Math.min(routine.varianceBand.maxMinutes, deltaSum)
  );
  return { driftMinutes: clamped, firedModifierIds };
}

/**
 * CC2 Prompt Budget Guard Ratchet (spec now, implemented when first reader injects)
 */
export function assertWorldStatePromptBudget(promptSection: string, maxChars = 1200): void {
  if (promptSection.length > maxChars) {
    throw new Error(`[CC2 BUDGET VIOLATION] World state prompt section exceeded ${maxChars} chars (got ${promptSection.length}).`);
  }
}

export {
  type HeadlessProbeStep,
  type ProbeTraceEntry,
  type SoundproofFragmentFixture,
  type WindowSpec,
  runHeadlessProbe,
  assertWindowBar,
  assertDiegeticTraceGuard,
} from './headlessProbe';
