import { describe, it, expect } from 'vitest';
import {
  compileSeatAwarePacingMandate,
  evaluateNextCadence,
  evaluateMacroPhaseTransitions,
  executePacingGovernor,
} from './pacingGovernor';
import {
  DramaticTurnReceiptSchema,
  PacingCadenceSchema,
  type DramaturgyRuntimeState,
  type DramaticSpine,
} from '../types/dramaturgy';

describe('Horror Grammar 2: Pacing Governor (Packet 2)', () => {
  describe('A7 & A11: Cadence Oscillation (The Breath)', () => {
    it('forces RESPITE_AFTERMATH immediately after KINETIC_RUPTURE', () => {
      const res = evaluateNextCadence('KINETIC_RUPTURE', 0);
      expect(res.nextCadence).toBe('RESPITE_AFTERMATH');
      expect(res.nextConsecutiveTurns).toBe(0);
    });

    it('holds RESPITE_AFTERMATH for 1 turn before moving to SIMMERING_DREAD', () => {
      const turn1 = evaluateNextCadence('RESPITE_AFTERMATH', 0);
      expect(turn1.nextCadence).toBe('RESPITE_AFTERMATH');
      expect(turn1.nextConsecutiveTurns).toBe(1);

      const turn2 = evaluateNextCadence('RESPITE_AFTERMATH', 1);
      expect(turn2.nextCadence).toBe('SIMMERING_DREAD');
      expect(turn2.nextConsecutiveTurns).toBe(0);
    });

    it('escalates from SIMMERING_DREAD to MOUNTING_COMPLICATION after prolonged quiet (2 turns)', () => {
      const turn1 = evaluateNextCadence('SIMMERING_DREAD', 0);
      expect(turn1.nextCadence).toBe('SIMMERING_DREAD');
      expect(turn1.nextConsecutiveTurns).toBe(1);

      const turn2 = evaluateNextCadence('SIMMERING_DREAD', 1);
      expect(turn2.nextCadence).toBe('SIMMERING_DREAD');
      expect(turn2.nextConsecutiveTurns).toBe(2);

      const turn3 = evaluateNextCadence('SIMMERING_DREAD', 2);
      expect(turn3.nextCadence).toBe('MOUNTING_COMPLICATION');
      expect(turn3.nextConsecutiveTurns).toBe(0);
    });

    it('jumps immediately to KINETIC_RUPTURE on kinetic tags or acute violence', () => {
      const res = evaluateNextCadence(
        'SIMMERING_DREAD',
        0,
        [{ tags: ['visceral_rupture'] }],
        'inspect door'
      );
      expect(res.nextCadence).toBe('KINETIC_RUPTURE');
    });

    it('respects director operator cadence override', () => {
      const res = evaluateNextCadence(
        'SIMMERING_DREAD',
        0,
        [],
        'look around',
        'RESPITE_AFTERMATH'
      );
      expect(res.nextCadence).toBe('RESPITE_AFTERMATH');
    });
  });

  describe('A5 & D1: Causal Macro-Phase Transition Gates', () => {
    const testSpine: DramaticSpine = {
      thematicPremise: 'Containment breakdown in deep isolation',
      dramaticQuestions: ['Will the anomaly remain contained?'],
      pacingProfile: 'BALANCED_HORROR',
      milestoneConditions: [
        {
          id: 'm-inciting',
          targetPhase: 'INCITING_RUPTURE',
          kind: 'DISCOVERY',
          referenceId: 'clue-cryo-leak',
          description: 'Discover breached cryo seal',
          satisfied: false,
        },
        {
          id: 'm-midpoint',
          targetPhase: 'MIDPOINT_CRISIS',
          kind: 'CLOCK_CRISIS',
          referenceId: 'subzero_chill',
          description: 'Facility temperature reaches crisis',
          satisfied: false,
        },
      ],
      impendingClocks: [],
    };

    it('does NOT advance macro-phase on turn count or time alone', () => {
      const clocks = {
        subzero_chill: {
          id: 'subzero_chill',
          name: 'Chill',
          domain: 'ENVIRONMENTAL' as const,
          currentLevel: 20,
          advanceMode: { mode: 'TIME' as const, rate: 'SLOW' as const, minutesPerPoint: 5 },
          manifestationCues: [],
          crisisThreshold: 80,
          accumulatedMinutes: 0,
        },
      };

      const res = evaluateMacroPhaseTransitions(
        'EXPOSITION_BASELINE',
        testSpine,
        clocks,
        {},
        [],
        []
      );

      expect(res.nextPhase).toBe('EXPOSITION_BASELINE');
      expect(res.transitions).toHaveLength(0);
    });

    it('advances to INCITING_RUPTURE when discovery milestone is met', () => {
      const clocks = {};
      const res = evaluateMacroPhaseTransitions(
        'EXPOSITION_BASELINE',
        testSpine,
        clocks,
        {},
        ['clue-cryo-leak'],
        []
      );

      expect(res.nextPhase).toBe('INCITING_RUPTURE');
      expect(res.transitions).toHaveLength(1);
      expect(res.transitions[0].from).toBe('EXPOSITION_BASELINE');
      expect(res.transitions[0].to).toBe('INCITING_RUPTURE');
      expect(res.transitions[0].cause).toContain('clue-cryo-leak');
    });

    it('advances to INCITING_RUPTURE when discovery milestone matches case-insensitively with whitespace', () => {
      const clocks = {};
      const res = evaluateMacroPhaseTransitions(
        'EXPOSITION_BASELINE',
        testSpine,
        clocks,
        {},
        ['  CLUE-CRYO-LEAK  '],
        []
      );

      expect(res.nextPhase).toBe('INCITING_RUPTURE');
      expect(res.transitions).toHaveLength(1);
      expect(res.transitions[0].cause).toContain('clue-cryo-leak');
    });

    it('does not advance when milestone referenceId is empty or whitespace only', () => {
      const clocks = {};
      const spineWithBlankMilestone: DramaticSpine = {
        ...testSpine,
        milestoneConditions: [
          {
            id: 'blank-ref-milestone',
            targetPhase: 'INCITING_RUPTURE',
            description: 'Blank reference test',
            kind: 'DISCOVERY',
            referenceId: '   ',
            satisfied: false,
          },
        ],
      };

      const res = evaluateMacroPhaseTransitions(
        'EXPOSITION_BASELINE',
        spineWithBlankMilestone,
        clocks,
        {},
        ['   ', ''],
        []
      );

      expect(res.nextPhase).toBe('EXPOSITION_BASELINE');
      expect(res.transitions).toHaveLength(0);
    });


    it('advances to MIDPOINT_CRISIS when clock crisis milestone is satisfied', () => {
      const clocks = {
        subzero_chill: {
          id: 'subzero_chill',
          name: 'Chill',
          domain: 'ENVIRONMENTAL' as const,
          currentLevel: 85,
          advanceMode: { mode: 'TIME' as const, rate: 'SLOW' as const, minutesPerPoint: 5 },
          manifestationCues: [],
          crisisThreshold: 80,
          accumulatedMinutes: 0,
        },
      };

      const res = evaluateMacroPhaseTransitions(
        'INCITING_RUPTURE',
        testSpine,
        clocks,
        {},
        [],
        []
      );

      expect(res.nextPhase).toBe('MIDPOINT_CRISIS');
      expect(res.transitions).toHaveLength(1);
      expect(res.transitions[0].to).toBe('MIDPOINT_CRISIS');
    });

    it('executes immediate Director operator macro-phase override', () => {
      const res = evaluateMacroPhaseTransitions(
        'EXPOSITION_BASELINE',
        testSpine,
        {},
        {},
        [],
        [],
        'CLIMACTIC_CONFRONTATION'
      );

      expect(res.nextPhase).toBe('CLIMACTIC_CONFRONTATION');
      expect(res.transitions[0].cause).toContain('Director operator override');
    });
  });

  describe('A6: Seat-Aware Mandates', () => {
    it('compiles survivor mandate emphasizing vulnerability and respite', () => {
      const survivorMandate = compileSeatAwarePacingMandate(
        'survivor',
        'COMPLICATION_ENCLOSURE',
        'RESPITE_AFTERMATH',
        0
      );
      expect(survivorMandate).toContain('lull');
      expect(survivorMandate).toContain('somatic trauma');
    });

    it('compiles villain mandate maintaining predatory initiative without constraints', () => {
      const villainMandate = compileSeatAwarePacingMandate(
        'villain',
        'COMPLICATION_ENCLOSURE',
        'SIMMERING_DREAD',
        0
      );
      expect(villainMandate).toContain('prey');
      expect(villainMandate).toContain('predatory patience');
    });

    it('compiles director mandate providing purely transparent telemetry', () => {
      const directorMandate = compileSeatAwarePacingMandate(
        'director',
        'MIDPOINT_CRISIS',
        'MOUNTING_COMPLICATION',
        1
      );
      expect(directorMandate).toContain('[PACING TELEMETRY');
    });

    it('renders a non-empty mandate for every cadence across every seat branch', () => {
      const seats = ['survivor', 'villain', 'director'] as const;
      for (const seat of seats) {
        for (const cadence of PacingCadenceSchema.options) {
          const mandate = compileSeatAwarePacingMandate(
            seat,
            'COMPLICATION_ENCLOSURE',
            cadence,
            0
          );
          expect(typeof mandate).toBe('string');
          expect(mandate.length).toBeGreaterThan(0);
          expect(mandate).not.toContain('undefined');
        }
      }
    });
  });

  describe('R1: Cadence State Machine Schema Validity', () => {
    it('emits schema-valid cadences across the full state machine sweep', () => {
      // Regression: the governor previously transitioned to a phantom
      // 'MOUNTING_PRESSURE' value absent from PacingCadenceSchema.
      for (const cadence of PacingCadenceSchema.options) {
        for (let consecutiveTurns = 0; consecutiveTurns <= 3; consecutiveTurns++) {
          const res = evaluateNextCadence(cadence, consecutiveTurns);
          const parsed = PacingCadenceSchema.safeParse(res.nextCadence);
          expect(
            parsed.success,
            `cadence ${cadence} @ turns=${consecutiveTurns} produced invalid nextCadence ${String(res.nextCadence)}`
          ).toBe(true);
        }
      }
    });
  });

  describe('End-to-End executePacingGovernor Integration', () => {
    const initialState: DramaturgyRuntimeState = {
      currentMacroPhase: 'EXPOSITION_BASELINE',
      activePacingCadence: 'SIMMERING_DREAD',
      consecutiveTurnsInCadence: 0,
      impendingClocks: {
        coolant_leak: {
          id: 'coolant_leak',
          name: 'Coolant Line Pressure',
          domain: 'STRUCTURAL',
          currentLevel: 25,
          advanceMode: { mode: 'TIME', rate: 'SLOW', minutesPerPoint: 5 },
          manifestationCues: [
            { atLevel: 20, cue: 'Frost rimes the high manifold pipe.' },
            { atLevel: 50, cue: 'Liquid nitrogen hisses through hairline fractures.' },
          ],
          diegeticInstrument: 'Coolant Gauge CV-01',
          instrumentNodeId: 'cryo_bay_a',
          crisisThreshold: 80,
          accumulatedMinutes: 0,
        },
      },
      characterStakes: {
        'char-holt': {
          characterId: 'char-holt',
          coreDesireOrNeed: 'Protect team',
          copingMechanism: 'Protocol',
          vulnerabilityOrGuilt: 'Survivor guilt',
          breakingPointTrigger: 'darkness',
          breakingPointThreshold: 20,
          isObstructed: false,
          composureSensitivity: 1.0,
          currentComposure: 30,
          liftConditions: [
            {
              kind: 'PERSUASION',
              composureRecoveryThreshold: 25,
              description: 'Persuade Holt with calm reassurance',
            },
          ],
        },
      },
      milestones: [],
      receiptHistory: [],
      discoveredClueIds: [],
    };

    it('advances state and emits valid DramaticTurnReceipt', () => {
      const result = executePacingGovernor({
        runtimeState: initialState,
        spine: null,
        playerRole: 'survivor',
        userAction: 'Step carefully through the frosted doorway into cryo bay',
        currentNodeId: 'cryo_bay_a',
        ratifiedConsequences: [
          { domain: 'PLAYER_INJURY', severity: 15 },
        ],
        elapsedFictionalMinutes: 10,
        fictionalTimeMarker: 'MOMENT:12_BEAT:04',
        turnNumber: 5,
      });

      // Receipt validation against strict Zod schema
      const parseRes = DramaticTurnReceiptSchema.safeParse(result.receipt);
      expect(parseRes.success).toBe(true);
      expect(result.receipt.turn).toBe(5);
      expect(result.receipt.fictionalTimeMarker).toBe('MOMENT:12_BEAT:04');

      // Clock advance: 10m at 5m/point = +2 points (25 -> 27)
      expect(result.nextRuntimeState.impendingClocks.coolant_leak.currentLevel).toBe(27);
      expect(result.receipt.clockAdvances).toHaveLength(1);
      expect(result.receipt.clockAdvances[0].toLevel).toBe(27);

      // Situated diegetic instrument: Character is in cryo_bay_a where Coolant Gauge CV-01 is situated
      expect(result.turnContext.diegeticReadings).toHaveLength(1);
      expect(result.turnContext.diegeticReadings[0].instrumentName).toBe('Coolant Gauge CV-01');

      // Character composure: 30 - (15 * 1.2 = 18) = 12
      expect(result.nextRuntimeState.characterStakes['char-holt'].currentComposure).toBe(12);
      expect(result.receipt.composureDeltas[0].delta).toBe(-18);
    });

    it('persists and carries discoveredClueIds forward into nextRuntimeState', () => {
      const stateWithClues: DramaturgyRuntimeState = {
        ...initialState,
        discoveredClueIds: ['prior_clue_1'],
      };

      const result = executePacingGovernor({
        runtimeState: stateWithClues,
        spine: null,
        playerRole: 'survivor',
        userAction: 'Examine desk',
        currentNodeId: 'cryo_bay_a',
        discoveredClueIds: ['prior_clue_1', 'fresh_clue_2'],
        fictionalTimeMarker: 'MOMENT:1_BEAT:1',
        turnNumber: 2,
      });

      expect(result.nextRuntimeState.discoveredClueIds).toEqual(['prior_clue_1', 'fresh_clue_2']);
    });

    it('preserves runtimeState.discoveredClueIds when input.discoveredClueIds is omitted', () => {
      const stateWithClues: DramaturgyRuntimeState = {
        ...initialState,
        discoveredClueIds: ['prior_clue_1', 'prior_clue_2'],
      };

      const result = executePacingGovernor({
        runtimeState: stateWithClues,
        spine: null,
        playerRole: 'survivor',
        userAction: 'Wait and listen',
        currentNodeId: 'cryo_bay_a',
        fictionalTimeMarker: 'MOMENT:1_BEAT:1',
        turnNumber: 2,
      });

      expect(result.nextRuntimeState.discoveredClueIds).toEqual(['prior_clue_1', 'prior_clue_2']);
    });
  });
});

