import type {
  AttemptFilterContext,
  AttentionTarget,
  RoutineEvent,
  RoutineState,
} from '../types/worldState';
import { computeDrift } from './worldPredicates';

/**
 * Filter routines due for evaluation at ctx.fictionalTime.
 * A routine is due if:
 *   (r.nextFireFictionalTime ?? r.cadence.firstFireMinutes * 60) <= ctx.fictionalTime
 * Results are deterministically sorted by routineId ascending.
 */
export function dueRoutines(ctx: AttemptFilterContext): RoutineState[] {
  if (!ctx.routines) return [];
  const all = Object.values(ctx.routines);
  return all
    .filter((r) => {
      const nextFire = r.nextFireFictionalTime ?? r.cadence.firstFireMinutes * 60;
      return nextFire <= ctx.fictionalTime;
    })
    .sort((a, b) => a.routineId.localeCompare(b.routineId));
}

/**
 * Evaluates ticks for all due routines in ctx.
 * Routines are machine commits on the fictional clock.
 * Disruption is state, not failure: blocked steps are emitted with skipped reason codes.
 */
export function evaluateRoutineTick(
  ctx: AttemptFilterContext,
  playerSeatCharacterIds: string[] = []
): RoutineEvent[] {
  const due = dueRoutines(ctx);
  const events: RoutineEvent[] = [];

  for (const routine of due) {
    if (!routine.steps || routine.steps.length === 0) continue;

    const stepIndex = (routine.currentStepIndex ?? 0) % routine.steps.length;
    const step = routine.steps[stepIndex];
    if (!step) continue;

    // Sovereignty axiom: player-seat characters cannot carry routines
    if (playerSeatCharacterIds.includes(routine.characterId)) {
      events.push({
        routineId: routine.routineId,
        characterId: routine.characterId,
        stepNumber: step.stepNumber,
        firedAtFictionalTime: ctx.fictionalTime,
        driftMinutes: 0,
        firedModifierIds: [],
        skipped: {
          reasonCode: 'PLAYER_SEAT',
          provenance: 'Routines cannot be bound to player seat.',
        },
      });
      continue;
    }

    const fromNodeId = ctx.characterNodes[routine.characterId];
    let skipped: RoutineEvent['skipped'] | undefined;
    let nodeTransition: { fromNodeId: string; toNodeId: string } | undefined;
    let attentionSet: AttentionTarget | undefined;

    // Check locomotion if target node differs from current node
    if (step.nodeId !== fromNodeId) {
      const bindingLevel = ctx.restraint?.bindings?.[routine.characterId]?.level;
      if (bindingLevel === 'TIED_TO_FIXTURE' || bindingLevel === 'FULL_HOGTIE') {
        skipped = {
          reasonCode: 'RESTRAINT_BINDING',
          provenance: 'Locomotion blocked by physical restraint.',
        };
      } else {
        const impaired = ctx.capabilities?.[routine.characterId]?.impairedCapabilities || [];
        if (impaired.includes('LOCOMOTION_NORMAL') || impaired.includes('LOCOMOTION_RAPID')) {
          skipped = {
            reasonCode: 'CAPABILITY_IMPAIRED',
            provenance: 'Locomotion capability impaired.',
          };
        } else {
          nodeTransition = {
            fromNodeId: fromNodeId || 'unknown',
            toNodeId: step.nodeId,
          };
        }
      }
    }

    if (!skipped && step.attentionTarget) {
      attentionSet = step.attentionTarget;
    }

    const { driftMinutes, firedModifierIds } = computeDrift(routine, ctx);

    events.push({
      routineId: routine.routineId,
      characterId: routine.characterId,
      stepNumber: step.stepNumber,
      firedAtFictionalTime: ctx.fictionalTime,
      driftMinutes,
      firedModifierIds,
      ...(nodeTransition ? { nodeTransition } : {}),
      ...(attentionSet ? { attentionSet } : {}),
      ...(skipped ? { skipped } : {}),
    });
  }

  return events;
}

/**
 * Pure non-mutating update of routine ledger following routine events.
 * For each fired event:
 * - Advances step pointer: (currentStepIndex + 1) % steps.length
 * - Sets lastFiredFictionalTime = event.firedAtFictionalTime
 * - Sets nextFireFictionalTime = event.firedAtFictionalTime + (cadence.periodMinutes * 60) + (driftMinutes * 60)
 */
export function applyRoutineTick(
  routineLedger: Record<string, RoutineState>,
  events: RoutineEvent[],
  _ctx?: AttemptFilterContext
): Record<string, RoutineState> {
  void _ctx;
  const nextLedger: Record<string, RoutineState> = JSON.parse(JSON.stringify(routineLedger));

  for (const event of events) {
    const routine = nextLedger[event.routineId];
    if (!routine) continue;

    if (routine.steps && routine.steps.length > 0) {
      routine.currentStepIndex = ((routine.currentStepIndex ?? 0) + 1) % routine.steps.length;
    }
    routine.lastFiredFictionalTime = event.firedAtFictionalTime;
    routine.nextFireFictionalTime = Math.max(
      0,
      event.firedAtFictionalTime +
        routine.cadence.periodMinutes * 60 +
        event.driftMinutes * 60
    );
  }

  return nextLedger;
}

/**
 * Extracts character node transitions to commit to state.castPlacement.
 * Filters out skipped events and events without node transitions.
 */
export function routineNodeTransitions(
  events: RoutineEvent[],
  routineLedger?: Record<string, RoutineState>
): Array<{ characterId: string; nodeId: string }> {
  const transitions: Array<{ characterId: string; nodeId: string }> = [];
  for (const e of events) {
    if (e.skipped || !e.nodeTransition) continue;
    const characterId = e.characterId || routineLedger?.[e.routineId]?.characterId;
    if (characterId) {
      transitions.push({
        characterId,
        nodeId: e.nodeTransition.toNodeId,
      });
    }
  }
  return transitions;
}

/**
 * Extracts character attention targets to commit to state.attentionLedger.
 * Filters out skipped events and events without attention writes.
 */
export function routineAttentionWrites(
  events: RoutineEvent[],
  routineLedger?: Record<string, RoutineState>
): Array<{ characterId: string; target: AttentionTarget }> {
  const writes: Array<{ characterId: string; target: AttentionTarget }> = [];
  for (const e of events) {
    if (e.skipped || !e.attentionSet) continue;
    const characterId = e.characterId || routineLedger?.[e.routineId]?.characterId;
    if (characterId) {
      writes.push({
        characterId,
        target: e.attentionSet,
      });
    }
  }
  return writes;
}
