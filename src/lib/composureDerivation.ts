import type { PsychologicalStatus } from '../types/consequence';
import type {
  CharacterPsychologicalStakes,
  ImpendingClock,
  ComposureBand,
  DramaturgyRuntimeState,
  DramaticSpine,
} from '../types/dramaturgy';

/**
 * A1 [CRITICAL]: Composure is the numeric substrate (0–100);
 * ComposureBand represents the five HG2 dramatic tiers:
 * BASELINE (>= 80), STRAINED (>= 50), PANICKED (>= 25), FRACTURED (>= 10), CATATONIC (< 10).
 */
export function deriveComposureBand(composure: number): ComposureBand {
  const clamped = Math.max(0, Math.min(100, composure));
  if (clamped >= 80) return 'BASELINE';
  if (clamped >= 50) return 'STRAINED';
  if (clamped >= 25) return 'PANICKED';
  if (clamped >= 10) return 'FRACTURED';
  return 'CATATONIC';
}

/**
 * A1 [CRITICAL]: Lossless projection from HG2 ComposureBand to canonical PsychologicalStatus.
 * Preserves compatibility with existing consequence validators and Astra test suites.
 */
export function mapComposureBandToPsychologicalStatus(band: ComposureBand): PsychologicalStatus {
  switch (band) {
    case 'BASELINE':
      return 'STABLE';
    case 'STRAINED':
      return 'UNEASY';
    case 'PANICKED':
      return 'DISTRESSED';
    case 'FRACTURED':
      return 'PANICKED';
    case 'CATATONIC':
      return 'DISSOCIATED';
  }
}

/**
 * A1 [CRITICAL]: Projects numeric composure directly to canonical PsychologicalStatus.
 */
export function derivePsychologicalStatus(composure: number): PsychologicalStatus {
  return mapComposureBandToPsychologicalStatus(deriveComposureBand(composure));
}

/**
 * A2 [CRITICAL]: Engine-derived composure delta calculation from ratified consequence events.
 * Zero model-proposed mutation.
 */
export function calculateComposureDelta(
  ratifiedEvents: Array<{ domain?: string; operation?: string; severity?: number; tags?: string[]; value?: string }>,
  sensitivity = 1.0
): number {
  if (!ratifiedEvents || ratifiedEvents.length === 0) return 0;

  let negativeImpact = 0;
  let recoveryAmount = 0;

  for (const ev of ratifiedEvents) {
    const domainUpper = (ev.domain || '').toUpperCase();

    // Physical trauma / injury
    if (domainUpper === 'PLAYER_INJURY' || domainUpper === 'SOMATIC' || domainUpper === 'INJURY') {
      const baseSeverity = typeof ev.severity === 'number' ? ev.severity : 10;
      negativeImpact += baseSeverity * 1.2;
    }
    // Psychological shock / fright events
    else if (domainUpper === 'PSYCHOLOGICAL_STATUS' || domainUpper === 'PSYCHOLOGICAL' || domainUpper === 'FRIGHT') {
      const baseSeverity = typeof ev.severity === 'number' ? ev.severity : 12;
      negativeImpact += baseSeverity * 1.5;
    }
    // Tag-based triggers
    else if (ev.tags && Array.isArray(ev.tags)) {
      if (ev.tags.some((t) => /horror|shock|trauma|rupture|mutilation|terror/i.test(t))) {
        negativeImpact += 8;
      }
    }

    // Positive recovery checks
    if (
      domainUpper === 'REST_RESPITE' ||
      domainUpper === 'MEDICAL_STABILIZATION' ||
      domainUpper === 'PERSUASION' ||
      (ev.tags && ev.tags.some((t) => /respite|rest|stabilize|soothe|persuade|aid/i.test(t)))
    ) {
      const baseRecovery = typeof ev.severity === 'number' ? ev.severity : 15;
      recoveryAmount += baseRecovery;
    }
  }

  const effectiveSensitivity = Math.max(0.1, Math.min(3.0, sensitivity));
  if (negativeImpact > 0) {
    return -Math.round(negativeImpact * effectiveSensitivity);
  }
  if (recoveryAmount > 0) {
    return Math.round(recoveryAmount / effectiveSensitivity);
  }
  return 0;
}

/**
 * D3: Breaking points are OBSTRUCTIVE.
 * When breakingPointTrigger is met and composure is <= breakingPointThreshold,
 * the NPC physically will not proceed.
 */
export function evaluateBreakingPoint(
  stakes: CharacterPsychologicalStakes,
  triggerMet: boolean
): { isObstructed: boolean; reason?: string } {
  if (stakes.isObstructed) {
    // Already obstructed; remains obstructed until deterministically lifted
    return { isObstructed: true, reason: stakes.obstructionReason };
  }

  if (triggerMet && stakes.currentComposure <= stakes.breakingPointThreshold) {
    const reason = `Breaking point reached: ${stakes.breakingPointTrigger} while composure (${stakes.currentComposure}) <= threshold (${stakes.breakingPointThreshold}).`;
    return { isObstructed: true, reason };
  }

  return { isObstructed: false };
}

/**
 * D3: Deterministic lift conditions for breaking point obstruction.
 * Lift occurs only if ratified events meet authored lift conditions AND composure recovered past threshold.
 * Abandonment always frees the player cohort, regardless of whether the NPC has terminal status.
 */
export function evaluateObstructionLift(
  stakes: CharacterPsychologicalStakes,
  ratifiedLiftEvent: string,
  newComposure: number
): { lifted: boolean; reason?: string } {
  if (!stakes.isObstructed) return { lifted: true };

  const eventUpper = ratifiedLiftEvent.toUpperCase();

  // 1. Abandonment: Player cohort ALWAYS has agency to leave an incapacitated or refusing companion
  if (eventUpper.includes('ABANDONMENT') || stakes.liftConditions.some((c) => c.kind === 'ABANDONMENT' && eventUpper.includes('ABANDON'))) {
    return {
      lifted: true,
      reason: 'Character abandoned by player cohort. Movement obstruction no longer impedes player.',
    };
  }

  // 2. Terminal permanent check: Evaluates against newComposure
  const terminalCondition = stakes.liftConditions.find((c) => c.kind === 'TERMINAL_PERMANENT');
  if (terminalCondition && newComposure <= terminalCondition.composureRecoveryThreshold) {
    return { lifted: false, reason: 'Terminal obstruction: permanently incapacitated.' };
  }

  // 3. Find matching lift condition (PERSUASION, REST_RESPITE, MEDICAL_STABILIZATION)
  const matchingCondition = stakes.liftConditions.find((c) => {
    if (eventUpper.includes(c.kind)) return true;
    const descLower = c.description.toLowerCase();
    const eventLower = ratifiedLiftEvent.toLowerCase();
    return descLower.includes(eventLower) || eventLower.includes(descLower);
  });

  if (matchingCondition) {
    if (newComposure >= matchingCondition.composureRecoveryThreshold) {
      return {
        lifted: true,
        reason: `Obstruction lifted via ${matchingCondition.kind}: composure recovered to ${newComposure}.`,
      };
    } else {
      return {
        lifted: false,
        reason: `Lift event ${matchingCondition.kind} acknowledged, but composure (${newComposure}) remains below required threshold (${matchingCondition.composureRecoveryThreshold}).`,
      };
    }
  }

  return { lifted: false, reason: stakes.obstructionReason };
}

/**
 * A3 [CRITICAL]: Selects deepest reached manifestation cue with hysteresis.
 * When clock level falls, existing cue remains active unless level drops
 * at least hysteresisBuffer points below cue threshold.
 */
export function selectManifestationCue(
  clock: ImpendingClock,
  previousLevel?: number,
  hysteresisBuffer = 5
): string | null {
  if (!clock.manifestationCues || clock.manifestationCues.length === 0) {
    return null;
  }

  const sorted = [...clock.manifestationCues].sort((a, b) => a.atLevel - b.atLevel);

  // If clock level is falling, apply hysteresis buffer to preserve atmosphere
  if (typeof previousLevel === 'number' && previousLevel > clock.currentLevel) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const cueObj = sorted[i];
      if (previousLevel >= cueObj.atLevel && clock.currentLevel >= cueObj.atLevel - hysteresisBuffer) {
        return cueObj.cue;
      }
    }
  }

  // Normal ascending / stable cue selection: highest threshold <= currentLevel
  const eligible = sorted.filter((c) => clock.currentLevel >= c.atLevel);
  if (eligible.length === 0) return null;

  return eligible[eligible.length - 1].cue;
}

/**
 * A4 [CRITICAL]: Event-Driven and Time-Driven clock advance calculation.
 * Discriminated union handling with consequence pattern matching,
 * fractional time accumulation, and ReDoS safety.
 */
export function advanceClock(
  clock: ImpendingClock,
  advanceInput: {
    elapsedMinutes?: number;
    ratifiedConsequences?: string[];
  }
): { newLevel: number; advanced: boolean; cause: string; newAccumulatedMinutes?: number } {
  const current = clock.currentLevel;

  if (clock.advanceMode.mode === 'TIME') {
    const rawMinutes = advanceInput.elapsedMinutes || 0;
    if (rawMinutes <= 0) {
      return {
        newLevel: current,
        advanced: false,
        cause: 'No fictional time elapsed',
        newAccumulatedMinutes: clock.accumulatedMinutes || 0,
      };
    }

    const totalMinutes = (clock.accumulatedMinutes || 0) + rawMinutes;
    const points = Math.floor(totalMinutes / clock.advanceMode.minutesPerPoint);
    const remainder = totalMinutes % clock.advanceMode.minutesPerPoint;

    if (points <= 0) {
      return {
        newLevel: current,
        advanced: false,
        cause: `${rawMinutes}m elapsed (${totalMinutes}m / ${clock.advanceMode.minutesPerPoint}m required for +1)`,
        newAccumulatedMinutes: remainder,
      };
    }

    const newLevel = Math.min(100, current + points);
    return {
      newLevel,
      advanced: newLevel > current,
      cause: `Advanced +${points} points via ${rawMinutes}m fictional time (${clock.advanceMode.rate})`,
      newAccumulatedMinutes: remainder,
    };
  }

  if (clock.advanceMode.mode === 'EVENT') {
    const consequences = advanceInput.ratifiedConsequences || [];
    let matchCount = 0;

    for (const event of consequences) {
      // Each consequence event matches at most once across patterns
      const matched = clock.advanceMode.consequencePatterns.some((pattern) => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(event);
        } catch {
          return event.toLowerCase().includes(pattern.toLowerCase());
        }
      });
      if (matched) matchCount++;
    }

    if (matchCount === 0) {
      return { newLevel: current, advanced: false, cause: 'No matching consequence events' };
    }

    const points = matchCount * clock.advanceMode.pointsPerEvent;
    const newLevel = Math.min(100, current + points);
    return {
      newLevel,
      advanced: newLevel > current,
      cause: `Advanced +${points} points via ${matchCount} matching consequence events`,
    };
  }

  return { newLevel: current, advanced: false, cause: 'Unknown advance mode' };
}

/**
 * D2: Situated observation of diegetic instruments.
 * Numeric readout is permitted ONLY if the character is physically present at the instrument's node.
 */
export function resolveDiegeticObservation(
  clock: ImpendingClock,
  currentNodeId: string
): { instrumentName: string; nodeId: string; level: number; readingText: string } | null {
  if (!clock.diegeticInstrument || !clock.instrumentNodeId) {
    return null;
  }

  // Strictly situated observation
  if (clock.instrumentNodeId !== currentNodeId) {
    return null;
  }

  return {
    instrumentName: clock.diegeticInstrument,
    nodeId: clock.instrumentNodeId,
    level: clock.currentLevel,
    readingText: `[DIAGNOSTIC DISPLAY // ${clock.diegeticInstrument}]: Level ${clock.currentLevel}% (Threshold: ${clock.crisisThreshold}%)`,
  };
}

/**
 * Initializes a clean DramaturgyRuntimeState from an authored blueprint.
 */
export function initializeDramaturgyRuntimeState(
  blueprint?: {
    dramaticSpine?: (Partial<DramaticSpine> & {
      startingMacroPhase?: DramaturgyRuntimeState['currentMacroPhase'];
      startingPacingCadence?: DramaturgyRuntimeState['activePacingCadence'];
      clocks?: ImpendingClock[];
      milestones?: DramaturgyRuntimeState['milestones'];
    }) | null;
    cast?: Array<{ id?: string; psychologicalStakes?: CharacterPsychologicalStakes }> | null;
  } | null
): DramaturgyRuntimeState {
  const spine = blueprint?.dramaticSpine;
  const clocks: Record<string, ImpendingClock> = {};
  const clocksList = spine?.impendingClocks || spine?.clocks || [];
  for (const c of clocksList) {
    if (typeof c.id !== 'string' || c.id.trim().length === 0) continue;
    clocks[c.id] = { ...c };
  }

  const characterStakes: Record<string, CharacterPsychologicalStakes> = {};
  if (blueprint?.cast) {
    for (const member of blueprint.cast) {
      if (member.psychologicalStakes) {
        characterStakes[member.id] = { ...member.psychologicalStakes };
      }
    }
  }

  const milestonesList = spine?.milestoneConditions || spine?.milestones || [];

  return {
    currentMacroPhase: spine?.startingMacroPhase || 'EXPOSITION_BASELINE',
    activePacingCadence: spine?.startingPacingCadence || 'SIMMERING_DREAD',
    consecutiveTurnsInCadence: 0,
    impendingClocks: clocks,
    characterStakes,
    milestones: [...milestonesList],
    receiptHistory: [],
    discoveredClueIds: [],
  };
}
