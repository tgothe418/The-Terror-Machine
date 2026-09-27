import type {
  AttemptFilterContext,
  CanAttemptResult,
  RoutineEvent,
} from '../types/worldState';
export type { AttemptFilterContext };
import { canAttempt, inReach, isObserved } from './worldPredicates';
import {
  evaluateRoutineTick,
  applyRoutineTick,
  routineNodeTransitions,
  routineAttentionWrites,
} from './routineMechanics';

export interface HeadlessProbeStep {
  kind: 'MOVE' | 'MANIPULATE' | 'INVESTIGATE' | 'WAIT' | 'CUSTOM';
  characterId: string;
  verb?: string;
  targetId?: string;
  advanceSeconds?: number;
  mutation?: (ctx: AttemptFilterContext) => void;
}

export interface ProbeTraceEntry {
  stepIndex: number;
  fictionalTime?: number;
  step?: HeadlessProbeStep;
  canAttemptResult: CanAttemptResult;
  inReachResults: Array<{ objectId: string; reachable: boolean }>;
  observedResult?: boolean;
  isActionUnobserved?: boolean;
  routineEvents?: RoutineEvent[];
  signals?: string[];
}

export interface SoundproofFragmentFixture {
  context: AttemptFilterContext;
  playerSeatCharacterIds?: string[];
  defaultStepSeconds?: number;
  signals?: Record<string, string[]>;
}

export interface WindowSpec {
  windowId: string;
  openPredicate: (entry: ProbeTraceEntry, trace: ProbeTraceEntry[]) => boolean;
  closePredicate: (entry: ProbeTraceEntry, trace: ProbeTraceEntry[]) => boolean;
  expectedSignals?: string[];
  receiptRequirement?: (trace: ProbeTraceEntry[]) => boolean;
}

export const FORBIDDEN_BLUEPRINT_TOKENS = [
  'varianceBand',
  'cadenceFictionalClock',
  'periodMinutes',
  'firstFireMinutes',
  'phaseOffsetMinutes',
  'modifiers',
  'affordances',
  'impairedCapabilities',
  'effects',
];

/**
 * Diegetic trace guard: asserts that probe traces and signals never expose
 * blueprint authoring schema tokens or internal engine ledger mechanics.
 */
export function assertDiegeticTraceGuard(trace: ProbeTraceEntry[]): void {
  for (const entry of trace) {
    for (const sig of entry.signals || []) {
      for (const token of FORBIDDEN_BLUEPRINT_TOKENS) {
        if (sig.toLowerCase().includes(token.toLowerCase())) {
          throw new Error(
            `[DIEGETIC TRACE VIOLATION] Trace signal contains blueprint token '${token}': "${sig}"`
          );
        }
      }
    }
  }
}

/**
 * Headless Probe Engine: runs deterministic step sequences against a fixture,
 * advancing time, executing routine machine commits, gating attempts, and recording traces.
 */
export function runHeadlessProbe(
  fixture: SoundproofFragmentFixture | unknown,
  steps: HeadlessProbeStep[]
): ProbeTraceEntry[] {
  if (
    !fixture ||
    typeof fixture !== 'object' ||
    !('context' in fixture) ||
    !steps ||
    steps.length === 0
  ) {
    return [];
  }

  const f = fixture as SoundproofFragmentFixture;
  const ctx: AttemptFilterContext = JSON.parse(JSON.stringify(f.context));
  const trace: ProbeTraceEntry[] = [];
  const playerSeats = f.playerSeatCharacterIds || [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Apply optional explicit step mutation
    if (step.mutation) {
      step.mutation(ctx);
    }

    // Advance fictional time
    const advanceSec = step.advanceSeconds ?? f.defaultStepSeconds ?? 60;
    ctx.fictionalTime += advanceSec;

    // Evaluate routines
    const routineEvents = evaluateRoutineTick(ctx, playerSeats);
    if (routineEvents.length > 0) {
      ctx.routines = applyRoutineTick(ctx.routines, routineEvents, ctx);
      const transitions = routineNodeTransitions(routineEvents, ctx.routines);
      for (const t of transitions) {
        ctx.characterNodes[t.characterId] = t.nodeId;
      }
      const attWrites = routineAttentionWrites(routineEvents, ctx.routines);
      for (const w of attWrites) {
        if (!ctx.attention[w.characterId]) {
          ctx.attention[w.characterId] = {
            characterId: w.characterId,
            attendingTo: w.target,
            lapse: null,
            distractibility: 0.5,
          };
        } else {
          ctx.attention[w.characterId].attendingTo = w.target;
        }
      }
    }

    // Evaluate attempt
    const verb = step.verb || step.kind;
    const canAttemptResult = canAttempt(step.characterId, verb, step.targetId || '', ctx);

    // Evaluate reach for all objects
    const inReachResults = Object.keys(ctx.objects || {})
      .sort()
      .map((objectId) => ({
        objectId,
        reachable: inReach(step.characterId, objectId, ctx),
      }));

    // Evaluate observation
    let observedResult: boolean | undefined = undefined;
    if (step.targetId) {
      if (ctx.objects[step.targetId]) {
        observedResult = isObserved({ kind: 'OBJECT', id: step.targetId }, ctx);
      } else if (ctx.characterNodes[step.targetId]) {
        observedResult = isObserved({ kind: 'CHARACTER', id: step.targetId }, ctx);
      } else {
        observedResult = isObserved({ kind: 'NODE', id: step.targetId }, ctx);
      }
    } else {
      observedResult = isObserved({ kind: 'CHARACTER', id: step.characterId }, ctx);
    }

    // Diegetic signals
    const signals: string[] = [];
    const charNode = ctx.characterNodes[step.characterId];
    if (charNode && f.signals?.[charNode]) {
      signals.push(...f.signals[charNode]);
    }
    for (const rev of routineEvents) {
      if (!rev.skipped && rev.nodeTransition) {
        signals.push(`footsteps_${rev.nodeTransition.fromNodeId}_to_${rev.nodeTransition.toNodeId}`);
      }
    }

    trace.push({
      stepIndex: i,
      fictionalTime: ctx.fictionalTime,
      step,
      canAttemptResult,
      inReachResults,
      observedResult,
      isActionUnobserved: observedResult === false,
      routineEvents: routineEvents.length > 0 ? routineEvents : undefined,
      signals,
    });
  }

  return trace;
}

/**
 * Asserts the four-directional Phase 1 acceptance bar:
 * 1. Open: opportunity window opens
 * 2. Close: opportunity window closes after opening
 * 3. Discover: expected diegetic signals present
 * 4. Receipt: required receipts / machine events verified
 */
export function assertWindowBar(trace: ProbeTraceEntry[], window: WindowSpec): void {
  // 1. Open direction: at least one step in trace satisfies openPredicate
  const openIndex = trace.findIndex((entry) => window.openPredicate(entry, trace));
  if (openIndex === -1) {
    throw new Error(
      `[WINDOW BAR FAILURE] Window '${window.windowId}' open predicate was never satisfied in probe trace.`
    );
  }

  // 2. Close direction: at least one subsequent step satisfies closePredicate
  const closeIndex = trace.findIndex(
    (entry, idx) => idx > openIndex && window.closePredicate(entry, trace)
  );
  if (closeIndex === -1) {
    throw new Error(
      `[WINDOW BAR FAILURE] Window '${window.windowId}' close predicate was not satisfied after opening.`
    );
  }

  // 3. Discover direction: expected signals present
  if (window.expectedSignals && window.expectedSignals.length > 0) {
    const allSignals = new Set(trace.flatMap((t) => t.signals || []));
    for (const sig of window.expectedSignals) {
      if (!allSignals.has(sig)) {
        throw new Error(
          `[WINDOW BAR FAILURE] Window '${window.windowId}' expected discovery signal '${sig}' was missing.`
        );
      }
    }
  }

  // 4. Receipt presence: receipts/events present
  if (window.receiptRequirement) {
    if (!window.receiptRequirement(trace)) {
      throw new Error(
        `[WINDOW BAR FAILURE] Window '${window.windowId}' receipt requirement was not satisfied.`
      );
    }
  }
}
