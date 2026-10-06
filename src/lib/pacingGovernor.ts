import type {
  MacroPhase,
  PacingCadence,
  DramaturgyRuntimeState,
  DramaticSpine,
  DramaticTurnReceipt,
  DramaturgyTurnContext,
  ImpendingClock,
  CharacterPsychologicalStakes,
} from '../types/dramaturgy';
import {
  advanceClock,
  selectManifestationCue,
  resolveDiegeticObservation,
  calculateComposureDelta,
  evaluateBreakingPoint,
  evaluateObstructionLift,
} from './composureDerivation';
import { normalizeConsequenceLabel } from './canonicalConsequences';

export interface PacingGovernorInput {
  runtimeState: DramaturgyRuntimeState;
  spine?: DramaticSpine | null;
  playerRole: string; // survivor, villain, protagonist, antagonist, director, bystander, etc.
  userAction: string;
  currentNodeId: string;
  ratifiedConsequences?: Array<{
    domain?: string;
    operation?: string;
    severity?: number;
    tags?: string[];
    value?: string;
  }>;
  elapsedFictionalMinutes?: number;
  fictionalTimeMarker: string; // Non-empty string from FictionalTimeReceipt, monotonic under Retake
  turnNumber: number;
  discoveredClueIds?: string[];
  directorOverridePhase?: MacroPhase;
  directorOverrideCadence?: PacingCadence;
}

export interface PacingGovernorResult {
  nextRuntimeState: DramaturgyRuntimeState;
  turnContext: DramaturgyTurnContext;
  receipt: DramaticTurnReceipt;
}

const MACRO_PHASE_ORDER: Record<MacroPhase, number> = {
  EXPOSITION_BASELINE: 0,
  INCITING_RUPTURE: 1,
  COMPLICATION_ENCLOSURE: 2,
  MIDPOINT_CRISIS: 3,
  ESCALATING_VISE: 4,
  CLIMACTIC_CONFRONTATION: 5,
  AFTERMATH_DENOUEMENT: 6,
};

/**
 * A6 & A11: Compiles seat-aware textural pacing mandates.
 * Provides gentle authorial framing without overriding player action.
 */
export function compileSeatAwarePacingMandate(
  role: string,
  macroPhase: MacroPhase,
  cadence: PacingCadence,
  consecutiveTurnsInCadence: number
): string {
  const normRole = role.toLowerCase();

  // Director role: pure telemetry without behavioral mandate
  if (normRole === 'director') {
    return `[PACING TELEMETRY // Phase: ${macroPhase} | Cadence: ${cadence} | TurnsInCadence: ${consecutiveTurnsInCadence}]`;
  }

  // Villain / Antagonist seat: preserve predatory initiative and sensory hunting texture
  if (normRole === 'villain' || normRole === 'antagonist') {
    switch (cadence) {
      case 'RESPITE_AFTERMATH':
        return 'The prey has temporarily broken line-of-sight to nurse wounds or catch breath. Savor the acoustic silence and architectural resonance. Maintain predatory patience; you dictate the timing of the next approach.';
      case 'SIMMERING_DREAD':
        return 'Track subtle environmental vibrations, distant prey footsteps, and sensory leakages through the facility. Let your unseen presence permeate the corridors without immediate kinetic collision. Exercise predatory patience.';
      case 'MOUNTING_COMPLICATION':
        return 'The prey\'s escape vectors tighten. Manifest closer sensory pressure, acoustic distortion, or structural manipulation. Corner the prey with deliberate, inevitable closure.';
      case 'KINETIC_RUPTURE':
        return 'Direct physical collision or terrifying sensory breach. Strike with visceral impact; dictate the physical geometry of terror while preserving fair counterplay opportunities.';
    }
  }

  // Survivor / Protagonist / Bystander seat: vulnerability, tension breathing, and sensory horror
  switch (cadence) {
    case 'RESPITE_AFTERMATH':
      return 'Allow a necessary lull in direct physical aggression. Focus on somatic trauma, binding injuries, the acoustic weight of the silence, and quiet dread before the next escalation.';
    case 'SIMMERING_DREAD':
      return 'Build atmospheric dread through environmental decay, distant auditory cues, and claustrophobic isolation. The horror remains unseen but palpably encroaching.';
    case 'MOUNTING_COMPLICATION':
      return 'Escalate urgency. Tighten the perimeter, introduce closer auditory or somatic cues, and increase the cost of delay. Escape routes feel precarious and strained.';
    case 'KINETIC_RUPTURE':
      return 'Deliver acute physical confrontation, violent containment failure, or desperate flight. High kinetic stakes; maintain visceral sensory shock.';
  }
}

/**
 * A7 & A11: Evaluates the next pacing cadence (The Breath).
 * Forces a respite lull after kinetic rupture to prevent fatigue,
 * and escalates after prolonged quiet to prevent stagnation.
 */
export function evaluateNextCadence(
  currentCadence: PacingCadence,
  consecutiveTurns: number,
  ratifiedConsequences?: Array<{ tags?: string[] }>,
  userAction = '',
  overrideCadence?: PacingCadence
): { nextCadence: PacingCadence; nextConsecutiveTurns: number } {
  if (overrideCadence) {
    return { nextCadence: overrideCadence, nextConsecutiveTurns: 0 };
  }

  // Check for immediate kinetic triggers in consequences or user action
  const hasKineticTrigger =
    (ratifiedConsequences &&
      ratifiedConsequences.some((ev) =>
        ev.tags?.some((t) => /rupture|attack|breach|flee|chase|strike|violence|collision/i.test(t))
      )) ||
    /\b(attack|flee|sprint|charge|shoot|smash|rupture|strike|grapple|kill)\b/i.test(userAction);

  if (hasKineticTrigger && currentCadence !== 'KINETIC_RUPTURE') {
    return { nextCadence: 'KINETIC_RUPTURE', nextConsecutiveTurns: 0 };
  }

  // Cadence oscillation state machine
  switch (currentCadence) {
    case 'KINETIC_RUPTURE':
      // The Breath: Mandatory respite after kinetic rupture (A11 gentle calibration)
      return { nextCadence: 'RESPITE_AFTERMATH', nextConsecutiveTurns: 0 };

    case 'RESPITE_AFTERMATH':
      // Hold respite for 1-2 turns, then transition to simmering dread
      if (consecutiveTurns >= 1) {
        return { nextCadence: 'SIMMERING_DREAD', nextConsecutiveTurns: 0 };
      }
      return { nextCadence: 'RESPITE_AFTERMATH', nextConsecutiveTurns: consecutiveTurns + 1 };

    case 'SIMMERING_DREAD':
      // If lingering in quiet for 2+ consecutive turns, escalate to mounting pressure
      if (consecutiveTurns >= 2) {
        return { nextCadence: 'MOUNTING_COMPLICATION', nextConsecutiveTurns: 0 };
      }
      return { nextCadence: 'SIMMERING_DREAD', nextConsecutiveTurns: consecutiveTurns + 1 };

    case 'MOUNTING_COMPLICATION':
      // After mounting pressure, either rupture or release back to simmering dread
      if (consecutiveTurns >= 2) {
        return { nextCadence: 'SIMMERING_DREAD', nextConsecutiveTurns: 0 };
      }
      return { nextCadence: 'MOUNTING_COMPLICATION', nextConsecutiveTurns: consecutiveTurns + 1 };
  }
}

/**
 * A5 [CRITICAL] & D1: Evaluates causal macro-phase transition gates.
 * Transitions occur STRICTLY when authored milestone conditions or clock crisis
 * thresholds are satisfied. Never on elapsed turns or time alone.
 */
export function evaluateMacroPhaseTransitions(
  currentPhase: MacroPhase,
  spine: DramaticSpine | null | undefined,
  clocks: Record<string, ImpendingClock>,
  characterStakes: Record<string, CharacterPsychologicalStakes>,
  discoveredClueIds: string[] = [],
  ratifiedConsequences: Array<{ tags?: string[]; value?: string }> = [],
  directorOverridePhase?: MacroPhase
): {
  nextPhase: MacroPhase;
  transitions: Array<{ from: MacroPhase; to: MacroPhase; cause: string }>;
  updatedMilestones: Array<DramaticSpine['milestoneConditions'][number]>;
} {
  if (directorOverridePhase && directorOverridePhase !== currentPhase) {
    return {
      nextPhase: directorOverridePhase,
      transitions: [
        {
          from: currentPhase,
          to: directorOverridePhase,
          cause: 'Director operator override manually transitioned macro-phase',
        },
      ],
      updatedMilestones: spine?.milestoneConditions ? [...spine.milestoneConditions] : [],
    };
  }

  // Unspined legacy blueprint: remain at current phase (Amendment A7)
  if (!spine || !spine.milestoneConditions || spine.milestoneConditions.length === 0) {
    return {
      nextPhase: currentPhase,
      transitions: [],
      updatedMilestones: [],
    };
  }

  const currentOrder = MACRO_PHASE_ORDER[currentPhase] ?? 0;
  let targetPhaseCandidate: MacroPhase = currentPhase;
  let transitionCause = '';
  const updatedMilestones = spine.milestoneConditions.map((m) => ({ ...m }));

  // Evaluate each authored milestone condition
  for (const milestone of updatedMilestones) {
    if (milestone.satisfied) continue;

    const milestoneOrder = MACRO_PHASE_ORDER[milestone.targetPhase] ?? 0;
    // Causal transition can only advance the story
    if (milestoneOrder <= currentOrder) continue;

    let satisfied = false;
    let cause = '';

    switch (milestone.kind) {
      case 'DISCOVERY': {
        const normRef = normalizeConsequenceLabel(milestone.referenceId || '').toLowerCase();
        if (
          normRef.length > 0 &&
          discoveredClueIds.some((id) => {
            const normId = normalizeConsequenceLabel(id).toLowerCase();
            return normId.length > 0 && normId === normRef;
          })
        ) {
          satisfied = true;
          cause = `Discovered required clue: ${milestone.referenceId} (${milestone.description})`;
        }
        break;
      }
      case 'CLOCK_CRISIS': {
        const targetClock = milestone.referenceId ? clocks[milestone.referenceId] : null;
        if (targetClock && targetClock.currentLevel >= targetClock.crisisThreshold) {
          satisfied = true;
          cause = `Clock "${targetClock.name}" reached crisis threshold (${targetClock.currentLevel}% >= ${targetClock.crisisThreshold}%)`;
        }
        break;
      }
      case 'COMPOSURE_THRESHOLD': {
        const targetStakes = milestone.referenceId ? characterStakes[milestone.referenceId] : null;
        const threshold = milestone.thresholdValue ?? 20;
        if (targetStakes && targetStakes.currentComposure <= threshold) {
          satisfied = true;
          cause = `Character "${targetStakes.characterId}" composure dropped below threshold (${targetStakes.currentComposure} <= ${threshold})`;
        }
        break;
      }
      case 'AUTHORED_TRIGGER': {
        const pattern = milestone.referenceId || '';
        const regex = new RegExp(pattern, 'i');
        const match = ratifiedConsequences.some(
          (c) =>
            (c.value && regex.test(c.value)) ||
            (c.tags && c.tags.some((t) => regex.test(t)))
        );
        if (match) {
          satisfied = true;
          cause = `Authored trigger consequence satisfied: ${milestone.description}`;
        }
        break;
      }
    }

    if (satisfied) {
      milestone.satisfied = true;
      if (milestoneOrder > (MACRO_PHASE_ORDER[targetPhaseCandidate] ?? 0)) {
        targetPhaseCandidate = milestone.targetPhase;
        transitionCause = cause;
      }
    }
  }

  // Also check if any clock has exceeded its crisis threshold without an explicit milestone
  for (const clock of Object.values(clocks)) {
    if (clock.currentLevel >= clock.crisisThreshold) {
      // Automatic escalation from EXPOSITION_BASELINE or INCITING_RUPTURE to MIDPOINT_CRISIS if unhandled
      if (currentOrder < MACRO_PHASE_ORDER.MIDPOINT_CRISIS) {
        if (MACRO_PHASE_ORDER.MIDPOINT_CRISIS > (MACRO_PHASE_ORDER[targetPhaseCandidate] ?? 0)) {
          targetPhaseCandidate = 'MIDPOINT_CRISIS';
          transitionCause = `Impending clock "${clock.name}" crossed critical threshold (${clock.currentLevel}%)`;
        }
      }
    }
  }

  if (targetPhaseCandidate !== currentPhase) {
    return {
      nextPhase: targetPhaseCandidate,
      transitions: [
        {
          from: currentPhase,
          to: targetPhaseCandidate,
          cause: transitionCause || `Causal conditions satisfied for ${targetPhaseCandidate}`,
        },
      ],
      updatedMilestones,
    };
  }

  return {
    nextPhase: currentPhase,
    transitions: [],
    updatedMilestones,
  };
}

/**
 * Main Dramaturgical Story Governor Turn Evaluator.
 * Deterministically computes next state, emits DramaticTurnReceipt,
 * and compiles DramaturgyTurnContext for prompt injection.
 */
export function executePacingGovernor(input: PacingGovernorInput): PacingGovernorResult {
  const {
    runtimeState,
    spine,
    playerRole,
    userAction,
    currentNodeId,
    ratifiedConsequences = [],
    elapsedFictionalMinutes = 0,
    fictionalTimeMarker,
    turnNumber,
    discoveredClueIds = runtimeState.discoveredClueIds ?? [],
    directorOverridePhase,
    directorOverrideCadence,
  } = input;

  // 1. Advance Impending Clocks (A4, D2)
  const updatedClocks: Record<string, ImpendingClock> = {};
  const clockAdvances: DramaticTurnReceipt['clockAdvances'] = [];
  const activeClockManifestations: string[] = [];
  const diegeticReadings: DramaturgyTurnContext['diegeticReadings'] = [];

  const consequenceStrings: string[] = ratifiedConsequences.map(
    (c) => `${c.domain || ''} ${c.operation || ''} ${c.value || ''} ${(c.tags || []).join(' ')}`.trim()
  );

  for (const [id, clock] of Object.entries(runtimeState.impendingClocks)) {
    const advanceResult = advanceClock(clock, {
      elapsedMinutes: elapsedFictionalMinutes,
      ratifiedConsequences: consequenceStrings,
    });

    const updatedClock: ImpendingClock = {
      ...clock,
      currentLevel: advanceResult.newLevel,
      accumulatedMinutes: advanceResult.newAccumulatedMinutes ?? clock.accumulatedMinutes ?? 0,
    };
    updatedClocks[id] = updatedClock;

    if (advanceResult.advanced) {
      clockAdvances.push({
        clockId: id,
        fromLevel: clock.currentLevel,
        toLevel: advanceResult.newLevel,
        cause: advanceResult.cause,
      });
    }

    // Select threshold-keyed manifestation cue with hysteresis (A3)
    const cue = selectManifestationCue(updatedClock, clock.currentLevel);
    if (cue) {
      activeClockManifestations.push(cue);
    }

    // Situated diegetic instrument observation (D2)
    const diegeticObs = resolveDiegeticObservation(updatedClock, currentNodeId);
    if (diegeticObs) {
      diegeticReadings.push(diegeticObs);
    }
  }

  // 2. Compute Character Stakes & Obstructive Breaking Points (A1, A2, D3)
  const updatedStakes: Record<string, CharacterPsychologicalStakes> = {};
  const composureDeltas: DramaticTurnReceipt['composureDeltas'] = [];
  const companionFrictionDirectives: Record<string, string> = {};

  for (const [charId, stakes] of Object.entries(runtimeState.characterStakes)) {
    const delta = calculateComposureDelta(ratifiedConsequences, stakes.composureSensitivity);
    const newComposure = Math.max(0, Math.min(100, stakes.currentComposure + delta));

    if (delta !== 0) {
      composureDeltas.push({
        characterId: charId,
        delta,
        cause: delta < 0
          ? `Somatic/psychological trauma impact (${delta})`
          : `Respite/medical stabilization recovery (+${delta})`,
      });
    }

    // Check if breaking point trigger occurred in userAction or consequences
    const triggerRegex = new RegExp(stakes.breakingPointTrigger, 'i');
    const triggerMet =
      triggerRegex.test(userAction) ||
      consequenceStrings.some((s) => triggerRegex.test(s));

    // Breaking point evaluation (D3)
    let isObstructed = stakes.isObstructed;
    let obstructionReason = stakes.obstructionReason;

    if (isObstructed) {
      // Evaluate deterministic lift conditions
      const liftEvent = consequenceStrings.join(' ') || userAction;
      const liftCheck = evaluateObstructionLift(stakes, liftEvent, newComposure);
      if (liftCheck.lifted) {
        isObstructed = false;
        obstructionReason = undefined;
      } else {
        obstructionReason = liftCheck.reason || obstructionReason;
      }
    } else {
      const bpCheck = evaluateBreakingPoint(
        { ...stakes, currentComposure: newComposure },
        triggerMet
      );
      if (bpCheck.isObstructed) {
        isObstructed = true;
        obstructionReason = bpCheck.reason;
      }
    }

    if (isObstructed && obstructionReason) {
      companionFrictionDirectives[charId] = `[NPC REFUSAL // ${charId}]: ${obstructionReason}`;
    }

    updatedStakes[charId] = {
      ...stakes,
      currentComposure: newComposure,
      isObstructed,
      obstructionReason,
    };
  }

  // 3. Evaluate Causal Macro-Phase Transitions (A5, D1)
  const phaseEval = evaluateMacroPhaseTransitions(
    runtimeState.currentMacroPhase,
    spine,
    updatedClocks,
    updatedStakes,
    discoveredClueIds,
    ratifiedConsequences,
    directorOverridePhase
  );

  // 4. Evaluate Pacing Cadence (The Breath) (A7, A11)
  const cadenceEval = evaluateNextCadence(
    runtimeState.activePacingCadence,
    runtimeState.consecutiveTurnsInCadence,
    ratifiedConsequences,
    userAction,
    directorOverrideCadence
  );

  // 5. Compile Seat-Aware Pacing Mandate (A6, A11)
  const pacingDirective = compileSeatAwarePacingMandate(
    playerRole,
    phaseEval.nextPhase,
    cadenceEval.nextCadence,
    cadenceEval.nextConsecutiveTurns
  );

  // 6. Assemble Monotonic DramaticTurnReceipt (A10)
  const receipt: DramaticTurnReceipt = {
    turn: turnNumber,
    fictionalTimeMarker,
    transitions: phaseEval.transitions,
    clockAdvances,
    composureDeltas,
    cadence: cadenceEval.nextCadence,
  };

  // 7. Update Runtime Dramaturgy State
  const nextRuntimeState: DramaturgyRuntimeState = {
    currentMacroPhase: phaseEval.nextPhase,
    activePacingCadence: cadenceEval.nextCadence,
    consecutiveTurnsInCadence: cadenceEval.nextConsecutiveTurns,
    impendingClocks: updatedClocks,
    characterStakes: updatedStakes,
    milestones: phaseEval.updatedMilestones,
    receiptHistory: [...runtimeState.receiptHistory, receipt],
    discoveredClueIds: [...discoveredClueIds],
  };

  // 8. Assemble Turn Context for Prompt Injection
  const turnContext: DramaturgyTurnContext = {
    macroPhase: phaseEval.nextPhase,
    activePacingCadence: cadenceEval.nextCadence,
    pacingDirective,
    activeClockManifestations,
    diegeticReadings,
    companionFrictionDirectives,
  };

  return {
    nextRuntimeState,
    turnContext,
    receipt,
  };
}
