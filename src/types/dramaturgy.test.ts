import { describe, it, expect } from 'vitest';
import {
  DramaticTurnReceiptSchema,
  DramaturgyRuntimeStateSchema,
  DramaticSpineSchema,
  DramaturgyTurnContextSchema,
  type ImpendingClock,
  type CharacterPsychologicalStakes,
} from './dramaturgy';
import {
  deriveComposureBand,
  derivePsychologicalStatus,
  calculateComposureDelta,
  evaluateBreakingPoint,
  evaluateObstructionLift,
  selectManifestationCue,
  advanceClock,
  resolveDiegeticObservation,
  initializeDramaturgyRuntimeState,
} from '../lib/composureDerivation';
import { geminiTurnResponseJsonSchema } from '../../server/ai/geminiTurnJsonSchema';

describe('Horror Grammar 2: Dramaturgy Schemas & Contracts (Packet 1)', () => {
  describe('A1 [CRITICAL]: Composure / psychological_status Derivation', () => {
    it('maps numeric composure to 5 HG2 ComposureBands and canonical PsychologicalStatus', () => {
      expect(deriveComposureBand(100)).toBe('BASELINE');
      expect(derivePsychologicalStatus(100)).toBe('STABLE');

      expect(deriveComposureBand(80)).toBe('BASELINE');
      expect(derivePsychologicalStatus(80)).toBe('STABLE');

      expect(deriveComposureBand(79)).toBe('STRAINED');
      expect(derivePsychologicalStatus(79)).toBe('UNEASY');

      expect(deriveComposureBand(50)).toBe('STRAINED');
      expect(derivePsychologicalStatus(50)).toBe('UNEASY');

      expect(deriveComposureBand(49)).toBe('PANICKED');
      expect(derivePsychologicalStatus(49)).toBe('DISTRESSED');

      expect(deriveComposureBand(25)).toBe('PANICKED');
      expect(derivePsychologicalStatus(25)).toBe('DISTRESSED');

      expect(deriveComposureBand(24)).toBe('FRACTURED');
      expect(derivePsychologicalStatus(24)).toBe('PANICKED');

      expect(deriveComposureBand(10)).toBe('FRACTURED');
      expect(derivePsychologicalStatus(10)).toBe('PANICKED');

      expect(deriveComposureBand(9)).toBe('CATATONIC');
      expect(derivePsychologicalStatus(9)).toBe('DISSOCIATED');

      expect(deriveComposureBand(0)).toBe('CATATONIC');
      expect(derivePsychologicalStatus(0)).toBe('DISSOCIATED');
    });

    it('clamps composure out-of-bounds cleanly without throwing', () => {
      expect(deriveComposureBand(-15)).toBe('CATATONIC');
      expect(derivePsychologicalStatus(-15)).toBe('DISSOCIATED');

      expect(deriveComposureBand(150)).toBe('BASELINE');
      expect(derivePsychologicalStatus(150)).toBe('STABLE');
    });

    it('derives composure deltas from normalized consequence events deterministically', () => {
      const delta = calculateComposureDelta(
        [
          { domain: 'PLAYER_INJURY', severity: 10 },
          { domain: 'PSYCHOLOGICAL_STATUS', severity: 10 },
        ],
        1.0
      );
      // Injury: 10 * 1.2 = 12. Psychological: 10 * 1.5 = 15. Total = -27.
      expect(delta).toBe(-27);
    });

    it('does NOT penalize benign inventory additions with composure drops', () => {
      const delta = calculateComposureDelta(
        [{ domain: 'INVENTORY', operation: 'ADD', value: 'Flashlight' }],
        1.0
      );
      expect(delta).toBe(0);
    });

    it('calculates positive composure recovery for respite and medical events', () => {
      const delta = calculateComposureDelta(
        [{ domain: 'REST_RESPITE', severity: 20 }],
        1.0
      );
      expect(delta).toBeGreaterThan(0);
    });

    it('scales composure deltas by authored sensitivity', () => {
      const lowSensDelta = calculateComposureDelta([{ domain: 'PLAYER_INJURY', severity: 10 }], 0.5);
      const highSensDelta = calculateComposureDelta([{ domain: 'PLAYER_INJURY', severity: 10 }], 2.0);
      expect(Math.abs(highSensDelta)).toBeGreaterThan(Math.abs(lowSensDelta));
    });
  });

  describe('A2 [CRITICAL]: Zero Model-Proposed Mutation in Provider Schemas', () => {
    it('asserts that provider JSON response schema contains NO composure or clock mutation fields', () => {
      const schemaStr = JSON.stringify(geminiTurnResponseJsonSchema);
      expect(typeof schemaStr).toBe('string');
      expect(schemaStr).not.toContain('composure');
      expect(schemaStr).not.toContain('clock_advance');
      expect(schemaStr).not.toContain('impending_clock');
      expect(schemaStr).not.toContain('macro_phase');
      expect(schemaStr).not.toContain('pacing_cadence');
      expect(schemaStr).not.toContain('breaking_point');
    });
  });

  describe('A3 [CRITICAL]: Threshold-Keyed Manifestation Cues & Hysteresis', () => {
    const testClock: ImpendingClock = {
      id: 'subzero_chill',
      name: 'Ambient Subzero Chill',
      domain: 'ENVIRONMENTAL',
      currentLevel: 45,
      advanceMode: { mode: 'TIME', rate: 'SLOW', minutesPerPoint: 5 },
      manifestationCues: [
        { atLevel: 10, cue: 'A faint condensation rime frosts the stainless steel handles.' },
        { atLevel: 30, cue: 'Breath blooms in dense, billowing clouds of vapor.' },
        { atLevel: 60, cue: 'Linoleum tiles become dangerously slick with black frost.' },
        { atLevel: 90, cue: 'Liquid coolant lines groan and fracture under thermal shock.' },
      ],
      crisisThreshold: 80,
      accumulatedMinutes: 0,
    };

    it('selects the deepest reached manifestation cue', () => {
      // At level 45, the 30% cue is the deepest reached (60% not reached yet)
      const cue = selectManifestationCue(testClock);
      expect(cue).toBe('Breath blooms in dense, billowing clouds of vapor.');
    });

    it('preserves cue under hysteresis when clock drops within the buffer window', () => {
      // Previous level was 62 (which manifested the 60% cue). Current dropped to 58 (within 5pt buffer)
      const fallingClock = { ...testClock, currentLevel: 58 };
      const cueWithHysteresis = selectManifestationCue(fallingClock, 62, 5);
      expect(cueWithHysteresis).toBe('Linoleum tiles become dangerously slick with black frost.');

      // Drops further to 52 (outside 5pt buffer: 60 - 5 = 55) -> drops back to 30% cue
      const droppedClock = { ...testClock, currentLevel: 52 };
      const droppedCue = selectManifestationCue(droppedClock, 62, 5);
      expect(droppedCue).toBe('Breath blooms in dense, billowing clouds of vapor.');
    });

    it('returns highest cue when current level exceeds all thresholds', () => {
      const highClock = { ...testClock, currentLevel: 95 };
      const cue = selectManifestationCue(highClock);
      expect(cue).toBe('Liquid coolant lines groan and fracture under thermal shock.');
    });

    it('returns null when current level is below the lowest threshold', () => {
      const lowClock = { ...testClock, currentLevel: 5 };
      const cue = selectManifestationCue(lowClock);
      expect(cue).toBeNull();
    });
  });

  describe('A4 [CRITICAL]: Discriminated Advance Modes (TIME vs EVENT)', () => {
    it('advances TIME-based clocks and preserves fractional minutes in accumulator', () => {
      const timeClock: ImpendingClock = {
        id: 'water_rise',
        name: 'Sump Water Level',
        domain: 'ENVIRONMENTAL',
        currentLevel: 10,
        advanceMode: { mode: 'TIME', rate: 'RAPID', minutesPerPoint: 2 },
        manifestationCues: [],
        crisisThreshold: 80,
        accumulatedMinutes: 1,
      };

      // Turn 1: 2 minutes elapsed. Total with accumulator (1) = 3 minutes.
      // 3 / 2 = +1 point, remainder 1 minute.
      const res = advanceClock(timeClock, { elapsedMinutes: 2 });
      expect(res.advanced).toBe(true);
      expect(res.newLevel).toBe(11);
      expect(res.newAccumulatedMinutes).toBe(1);
    });

    it('advances EVENT-based clocks matching consequence patterns without multi-counting', () => {
      const eventClock: ImpendingClock = {
        id: 'entity_adaptation',
        name: 'Entity-41 Sensor Adaptation',
        domain: 'BEHAVIORAL',
        currentLevel: 20,
        advanceMode: {
          mode: 'EVENT',
          consequencePatterns: ['acoustic', 'screech', 'fire_flare'],
          pointsPerEvent: 15,
        },
        manifestationCues: [],
        crisisThreshold: 90,
        accumulatedMinutes: 0,
      };

      // Event 1 matches both 'acoustic' and 'screech', but must only count ONCE
      const res = advanceClock(eventClock, {
        ratifiedConsequences: ['acoustic_screech_echo', 'unrelated_door_opened'],
      });
      expect(res.advanced).toBe(true);
      expect(res.newLevel).toBe(35); // 20 + 15 (counted once)
      expect(res.cause).toContain('1 matching consequence');
    });

    it('clamps clock advances at 100 maximum level', () => {
      const eventClock: ImpendingClock = {
        id: 'entity_adaptation',
        name: 'Entity-41 Sensor Adaptation',
        domain: 'BEHAVIORAL',
        currentLevel: 95,
        advanceMode: {
          mode: 'EVENT',
          consequencePatterns: ['rupture'],
          pointsPerEvent: 20,
        },
        manifestationCues: [],
        crisisThreshold: 90,
        accumulatedMinutes: 0,
      };

      const res = advanceClock(eventClock, {
        ratifiedConsequences: ['hull_rupture_confirmed'],
      });
      expect(res.newLevel).toBe(100);
    });

    it('does not advance EVENT-based clocks when consequences do not match', () => {
      const eventClock: ImpendingClock = {
        id: 'entity_adaptation',
        name: 'Entity-41 Sensor Adaptation',
        domain: 'BEHAVIORAL',
        currentLevel: 20,
        advanceMode: {
          mode: 'EVENT',
          consequencePatterns: ['chemical_splash'],
          pointsPerEvent: 15,
        },
        manifestationCues: [],
        crisisThreshold: 90,
        accumulatedMinutes: 0,
      };

      const res = advanceClock(eventClock, {
        ratifiedConsequences: ['player_opened_door', 'holt_whispered'],
      });
      expect(res.advanced).toBe(false);
      expect(res.newLevel).toBe(20);
    });
  });

  describe('D2: Situated Diegetic Instrument Observation', () => {
    const instrumentClock: ImpendingClock = {
      id: 'hydraulic_pressure',
      name: 'Auxiliary Hydraulic Pressure',
      domain: 'STRUCTURAL',
      currentLevel: 62,
      advanceMode: { mode: 'TIME', rate: 'SLOW', minutesPerPoint: 5 },
      manifestationCues: [],
      diegeticInstrument: 'Auxiliary Pressure Gauge AG-04',
      instrumentNodeId: 'histology_lab',
      crisisThreshold: 85,
      accumulatedMinutes: 0,
    };

    it('permits observation when character is at the instrument node', () => {
      const obs = resolveDiegeticObservation(instrumentClock, 'histology_lab');
      expect(obs).not.toBeNull();
      expect(obs?.instrumentName).toBe('Auxiliary Pressure Gauge AG-04');
      expect(obs?.level).toBe(62);
      expect(obs?.readingText).toContain('Level 62%');
    });

    it('strictly forbids observation when character is in a different chamber', () => {
      const obs = resolveDiegeticObservation(instrumentClock, 'autopsy_suite_b');
      expect(obs).toBeNull();
    });
  });

  describe('D3: Breaking Points & Deterministic Lift Conditions', () => {
    const testStakes: CharacterPsychologicalStakes = {
      characterId: 'char-holt',
      coreDesireOrNeed: 'Adhere to security protocol and survive',
      copingMechanism: 'Rigid adherence to procedure',
      vulnerabilityOrGuilt: 'Failed to protect the research team',
      breakingPointTrigger: 'Severe physical darkness or abandonment',
      breakingPointThreshold: 20,
      isObstructed: false,
      composureSensitivity: 1.0,
      currentComposure: 15,
      liftConditions: [
        {
          kind: 'PERSUASION',
          composureRecoveryThreshold: 30,
          description: 'Dr. Ross successfully reassures and stabilizes Holt with dialogue',
        },
        {
          kind: 'REST_RESPITE',
          composureRecoveryThreshold: 25,
          description: 'Holt rests in quiet secured chamber',
        },
        {
          kind: 'MEDICAL_STABILIZATION',
          composureRecoveryThreshold: 40,
          description: 'Administer neuro-sedative ampoule',
        },
        {
          kind: 'ABANDONMENT',
          composureRecoveryThreshold: 0,
          description: 'Player abandons Holt, removing movement obstruction for self',
        },
      ],
    };

    it('triggers physical obstruction when trigger is met and composure <= threshold', () => {
      const evalRes = evaluateBreakingPoint(testStakes, true);
      expect(evalRes.isObstructed).toBe(true);
      expect(evalRes.reason).toContain('Breaking point reached');
    });

    it('does not trigger obstruction if composure is above threshold even if trigger occurs', () => {
      const calmStakes = { ...testStakes, currentComposure: 60 };
      const evalRes = evaluateBreakingPoint(calmStakes, true);
      expect(evalRes.isObstructed).toBe(false);
    });

    it('evaluates deterministic lift via persuasion when composure recovers', () => {
      const obstructedStakes = { ...testStakes, isObstructed: true };
      const liftRes = evaluateObstructionLift(obstructedStakes, 'PERSUASION', 35);
      expect(liftRes.lifted).toBe(true);
      expect(liftRes.reason).toContain('Obstruction lifted via PERSUASION');
    });

    it('evaluates deterministic lift via REST_RESPITE and MEDICAL_STABILIZATION', () => {
      const obstructedStakes = { ...testStakes, isObstructed: true };
      const respiteLift = evaluateObstructionLift(obstructedStakes, 'REST_RESPITE', 26);
      expect(respiteLift.lifted).toBe(true);

      const medLift = evaluateObstructionLift(obstructedStakes, 'Administer neuro-sedative ampoule', 45);
      expect(medLift.lifted).toBe(true);
    });

    it('rejects lift if composure has not recovered past required threshold', () => {
      const obstructedStakes = { ...testStakes, isObstructed: true };
      const liftRes = evaluateObstructionLift(obstructedStakes, 'PERSUASION', 22);
      expect(liftRes.lifted).toBe(false);
      expect(liftRes.reason).toContain('remains below required threshold');
    });

    it('permits deterministic lift via ABANDONMENT even if character has TERMINAL_PERMANENT', () => {
      const terminalStakes: CharacterPsychologicalStakes = {
        ...testStakes,
        isObstructed: true,
        liftConditions: [
          {
            kind: 'TERMINAL_PERMANENT',
            composureRecoveryThreshold: 100,
            description: 'Permanent catatonic seizure',
          },
          {
            kind: 'ABANDONMENT',
            composureRecoveryThreshold: 0,
            description: 'Leave Holt behind',
          },
        ],
      };

      // Normal recovery blocked by terminal condition
      const normalTry = evaluateObstructionLift(terminalStakes, 'PERSUASION', 80);
      expect(normalTry.lifted).toBe(false);

      // Abandonment successfully lifts movement obstruction for player cohort
      const abandonTry = evaluateObstructionLift(terminalStakes, 'ABANDONMENT', 10);
      expect(abandonTry.lifted).toBe(true);
    });
  });

  describe('A10: DramaticTurnReceipt Schema Validation', () => {
    it('validates compliant DramaticTurnReceipt adhering to exact specification', () => {
      const receipt = {
        turn: 14,
        fictionalTimeMarker: 'MOMENT:34_BEAT:12',
        transitions: [
          {
            from: 'COMPLICATION_ENCLOSURE',
            to: 'MIDPOINT_CRISIS',
            cause: 'Auxiliary breaker tripped and primary airlock sealed',
          },
        ],
        clockAdvances: [
          {
            clockId: 'subzero_chill',
            fromLevel: 25,
            toLevel: 30,
            cause: 'Advanced +5 points via 10m fictional time (SLOW)',
          },
        ],
        composureDeltas: [
          {
            characterId: 'char-holt',
            delta: -15,
            cause: 'Compound radial fracture and acoustic screeching',
          },
        ],
        cadence: 'KINETIC_RUPTURE',
      };

      const parsed = DramaticTurnReceiptSchema.safeParse(receipt);
      expect(parsed.success).toBe(true);
    });

    it('rejects invalid DramaticTurnReceipt with malformed phase or unconstrained numbers', () => {
      const invalidReceipt = {
        turn: -1,
        fictionalTimeMarker: '',
        transitions: [{ from: 'NON_EXISTENT_PHASE', to: 'MIDPOINT_CRISIS', cause: '' }],
        clockAdvances: [{ clockId: '', fromLevel: 150, toLevel: 200, cause: '' }],
        composureDeltas: [],
        cadence: 'INVALID_CADENCE',
      };
      const parsed = DramaticTurnReceiptSchema.safeParse(invalidReceipt);
      expect(parsed.success).toBe(false);
    });
  });

  describe('Dramaturgy Schemas & Legacy Blueprint Preservation', () => {
    it('validates DramaticSpineSchema and DramaticMilestoneConditionSchema', () => {
      const spine = {
        thematicPremise: 'The facility suffocates in subzero silence.',
        dramaticQuestions: ['Will anyone survive containment breach?'],
        pacingProfile: 'SLOW_BURN_DREAD' as const,
        milestoneConditions: [
          {
            id: 'm1',
            targetPhase: 'INCITING_RUPTURE' as const,
            kind: 'DISCOVERY' as const,
            referenceId: 'Cryo-vault breached',
            description: 'Player verifies breach',
          },
        ],
        impendingClocks: [],
      };
      expect(DramaticSpineSchema.safeParse(spine).success).toBe(true);
    });

    it('DramaticSpineSchema.parse accepts a well-formed spine with 2 milestones (including CLOCK_CRISIS) and 1 clock', () => {
      const wellFormedSpine = {
        thematicPremise: 'The facility suffocates in subzero silence.',
        dramaticQuestions: ['Will anyone survive containment breach?'],
        pacingProfile: 'BALANCED_HORROR' as const,
        milestoneConditions: [
          {
            id: 'milestone-1',
            targetPhase: 'INCITING_RUPTURE' as const,
            kind: 'CLOCK_CRISIS' as const,
            referenceId: 'clock-subzero',
            description: 'Subzero chill reaches crisis point',
            satisfied: false,
          },
          {
            id: 'milestone-2',
            targetPhase: 'MIDPOINT_CRISIS' as const,
            kind: 'DISCOVERY' as const,
            referenceId: 'black_box_recorder',
            description: 'Player discovers the black box recorder',
            satisfied: false,
          },
        ],
        impendingClocks: [
          {
            id: 'clock-subzero',
            name: 'Subzero Chill',
            domain: 'ENVIRONMENTAL' as const,
            currentLevel: 0,
            advanceMode: { mode: 'TIME' as const, rate: 'SLOW' as const, minutesPerPoint: 5 },
            crisisThreshold: 80,
            manifestationCues: [{ atLevel: 50, cue: 'Frost rimes the bulkheads.' }],
          },
        ],
      };
      const parsed = DramaticSpineSchema.parse(wellFormedSpine);
      expect(parsed.milestoneConditions).toHaveLength(2);
      expect(parsed.impendingClocks).toHaveLength(1);
      expect(parsed.milestoneConditions[0].referenceId).toBe(parsed.impendingClocks[0].id);
    });

    it('DramaticSpineSchema.parse rejects a milestone with empty id', () => {
      const invalidSpine = {
        milestoneConditions: [
          {
            id: '',
            targetPhase: 'INCITING_RUPTURE' as const,
            kind: 'DISCOVERY' as const,
            description: 'Empty milestone ID',
          },
        ],
      };
      expect(() => DramaticSpineSchema.parse(invalidSpine)).toThrow();
    });

    it('validates DramaturgyTurnContextSchema', () => {
      const context = {
        macroPhase: 'INCITING_RUPTURE',
        activePacingCadence: 'SIMMERING_DREAD',
        pacingDirective: 'Emphasize sensory isolation.',
        activeClockManifestations: ['Rime frosts glass.'],
        diegeticReadings: [],
        companionFrictionDirectives: {},
      };
      expect(DramaturgyTurnContextSchema.safeParse(context).success).toBe(true);
    });

    it('initializes default DramaturgyRuntimeState cleanly for unspined Blueprints', () => {
      const defaultState = DramaturgyRuntimeStateSchema.parse({});
      expect(defaultState.currentMacroPhase).toBe('EXPOSITION_BASELINE');
      expect(defaultState.activePacingCadence).toBe('SIMMERING_DREAD');
      expect(defaultState.consecutiveTurnsInCadence).toBe(0);
      expect(Object.keys(defaultState.impendingClocks)).toHaveLength(0);
      expect(Object.keys(defaultState.characterStakes)).toHaveLength(0);
    });

    it('drops blank-ID clocks when initializing dramaturgy runtime state', () => {
      const mkClock = (id: string): ImpendingClock => ({
        id,
        name: 'Test Clock',
        domain: 'ENVIRONMENTAL',
        currentLevel: 0,
        advanceMode: { mode: 'TIME', rate: 'SLOW', minutesPerPoint: 10 },
        manifestationCues: [],
        crisisThreshold: 80,
        accumulatedMinutes: 0,
      });
      const state = initializeDramaturgyRuntimeState({
        dramaticSpine: {
          impendingClocks: [mkClock('clock-1'), mkClock(''), mkClock('   ')],
        },
      });
      expect(Object.keys(state.impendingClocks)).toEqual(['clock-1']);
      expect(state.impendingClocks['clock-1'].name).toBe('Test Clock');
    });
  });
});
