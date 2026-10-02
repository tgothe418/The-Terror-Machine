import { describe, it, expect } from 'vitest';
import {
  projectWoundPerception,
  calculateFearResponseIntensity,
  deriveSomaticState,
  computeCharacterSalience,
  createInitialCharacterSalience,
  cloneCharacterSalience,
  cloneSalienceLedger,
  formatSomaticStatePrompt,
  salienceBySource,
} from './fearEngine';
import {
  CharacterSalience,
  FearContract,
  SalienceEvent,
  SalienceProvenanceSchema,
  SalienceEventSchema,
  SOMATIC_BAND_TOKENS,
  DEFAULT_FEAR_CONTRACT,
} from '../types/fear';
import { WoundLedger } from './deathLedger';
import { WoundFact } from '../types/death';
import { engineReducer, initialEngineState, EngineState } from '../core/engine/reducer';
import { EngineEvent } from '../core/engine/events';
import {
  RatifiedEngineFrame,
  RuntimeStateSnapshot,
  TurnReceipt,
  TransitionReceipt,
} from '../types';

describe('fearEngine - Stage 1 (Salience Core)', () => {
  describe('Wound Perception Projection (Pure & Idempotent)', () => {
    it('projects direct wounds at full fidelity with severity ordinals intact', () => {
      const ledger: WoundLedger = {
        'char-dale': [
          {
            id: 'char-dale:w1',
            characterId: 'char-dale',
            mechanism: 'glass puncture',
            location: 'left forearm',
            severity: 'serious',
            timelineMinutes: 90,
            treatability: 'tourniquet or pressure dressing',
            inflictedAtTurn: 1,
            inflictedAtFictionalTime: 60,
            treated: false,
            valence: 'accident',
          },
          {
            id: 'char-dale:w2',
            characterId: 'char-dale',
            mechanism: 'machete slash',
            location: 'chest',
            severity: 'grave',
            timelineMinutes: 15,
            treatability: 'advanced surgical trauma kit',
            inflictedAtTurn: 2,
            inflictedAtFictionalTime: 120,
            treated: false,
            valence: 'murder',
          },
        ],
      };

      const result = projectWoundPerception('char-dale', ledger);

      expect(result.characterId).toBe('char-dale');
      expect(result.wounds).toHaveLength(2);
      expect(result.wounds[0].severity).toBe('serious');
      expect(result.wounds[1].severity).toBe('grave');
      expect(result.dominantSeverity).toBe('grave');
      expect(result.hasUntreatedWounds).toBe(true);
      expect(result.hasUnsurvivableWound).toBe(false);

      // Verify full fidelity: no severity degradation
      expect(result.wounds[0].mechanism).toBe('glass puncture');
      expect(result.wounds[1].mechanism).toBe('machete slash');
    });

    it('handles waking up wounded with unknown cause / unspecified location gracefully', () => {
      const ledger: WoundLedger = {
        'char-amnesiac': [
          {
            id: 'char-amnesiac:w1',
            characterId: 'char-amnesiac',
            mechanism: '',
            location: '',
            severity: 'minor',
            timelineMinutes: 120,
            treatability: '',
            inflictedAtTurn: 0,
            inflictedAtFictionalTime: 0,
            treated: false,
            valence: 'accident',
          },
        ],
      };

      const result = projectWoundPerception('char-amnesiac', ledger);
      expect(result.wounds[0].mechanism).toBe('unknown cause');
      expect(result.wounds[0].location).toBe('unspecified');
      expect(result.wounds[0].severity).toBe('minor');
      expect(result.dominantSeverity).toBe('minor');
    });

    it('is strictly idempotent and does NOT modify the canonical ledger', () => {
      const originalWound: WoundFact = {
        id: 'char-1:w1',
        characterId: 'char-1',
        mechanism: 'bite wound',
        location: 'neck',
        severity: 'unsurvivable',
        timelineMinutes: 0,
        treatability: 'none',
        inflictedAtTurn: 3,
        inflictedAtFictionalTime: 180,
        treated: false,
        valence: 'murder',
      };
      const ledger: WoundLedger = {
        'char-1': [originalWound],
      };

      const serializedBefore = JSON.stringify(ledger);

      const pass1 = projectWoundPerception('char-1', ledger);
      const pass2 = projectWoundPerception('char-1', ledger);

      expect(pass1).toEqual(pass2);
      expect(pass1.hasUnsurvivableWound).toBe(true);
      expect(pass1.dominantSeverity).toBe('unsurvivable');

      // Assert ledger remains completely untouched
      expect(JSON.stringify(ledger)).toBe(serializedBefore);
    });

    it('integrates witnessed events into felt wounds set', () => {
      const ledger: WoundLedger = {
        'char-witness': [],
      };
      const witnessedEvents = [
        {
          id: 'ev-witness-1',
          characterId: 'char-witness',
          description: 'Saw colleague decapitated',
          severity: 'unsurvivable',
        },
      ];

      const result = projectWoundPerception('char-witness', ledger, witnessedEvents);
      expect(result.wounds).toHaveLength(1);
      expect(result.wounds[0].source).toBe('witnessed');
      expect(result.wounds[0].severity).toBe('unsurvivable');
      expect(result.dominantSeverity).toBe('unsurvivable');
    });
  });

  describe('Fear-Response Intensity Calculation', () => {
    it('calculates intensity as clamp((spike + dread) * (1 - fearlessness), 0, 1)', () => {
      const salience: CharacterSalience = {
        spike: 0.4,
        dread: 0.3,
        threatType: 'life',
        provenance: [],
        preyMode: false,
      };

      // Default fearlessness = 0
      expect(calculateFearResponseIntensity(salience, 0)).toBeCloseTo(0.7, 5);

      // Authoring fearlessness = 0.5
      expect(calculateFearResponseIntensity(salience, 0.5)).toBeCloseTo(0.35, 5);

      // Completely unshakable fanatic (fearlessness = 1.0)
      expect(calculateFearResponseIntensity(salience, 1.0)).toBe(0);
    });

    it('clamps boundary values between 0 and 1', () => {
      const highSalience: CharacterSalience = {
        spike: 0.9,
        dread: 0.8,
        threatType: 'life',
        provenance: [],
        preyMode: false,
      };

      expect(calculateFearResponseIntensity(highSalience, 0)).toBe(1.0);

      const zeroSalience: CharacterSalience = {
        spike: 0,
        dread: 0,
        threatType: 'life',
        provenance: [],
        preyMode: false,
      };

      expect(calculateFearResponseIntensity(zeroSalience, 0)).toBe(0);
    });
  });

  describe('Somatic State Derivation (Universal Vocabulary & Bands)', () => {
    it('maps intensities to the correct somatic bands and token sets', () => {
      // Band 0 (< 0.25)
      expect(deriveSomaticState(0.1)).toEqual({ band: 0, tokens: [] });
      expect(deriveSomaticState(0.249)).toEqual({ band: 0, tokens: [] });

      // Band 1 (Mild Tension, >= 0.25)
      const band1 = deriveSomaticState(0.25);
      expect(band1.band).toBe(1);
      expect(band1.tokens).toEqual(SOMATIC_BAND_TOKENS[1]);
      expect(band1.tokens).toContain('PULSE_ELEVATED');
      expect(band1.tokens).toContain('VOICE_HESITATION');
      expect(band1.tokens).toContain('RESTLESS_GAZE');

      // Band 2 (Acute Fear, >= 0.50)
      const band2 = deriveSomaticState(0.5);
      expect(band2.band).toBe(2);
      expect(band2.tokens).toEqual(SOMATIC_BAND_TOKENS[2]);
      expect(band2.tokens).toContain('HAND_TREMOR');
      expect(band2.tokens).toContain('COLD_SWEAT');

      // Band 3 (Severe Panic, >= 0.75)
      const band3 = deriveSomaticState(0.75);
      expect(band3.band).toBe(3);
      expect(band3.tokens).toEqual(SOMATIC_BAND_TOKENS[3]);
      expect(band3.tokens).toContain('HYPERVENTILATION');
      expect(band3.tokens).toContain('SPEECH_FRAGMENTED');

      // Band 4 (Breaking Point, >= 0.90)
      const band4 = deriveSomaticState(0.95);
      expect(band4.band).toBe(4);
      expect(band4.tokens).toEqual(SOMATIC_BAND_TOKENS[4]);
      expect(band4.tokens).toContain('FREEZE_IMMOBILITY');
      expect(band4.tokens).toContain('DISSOCIATIVE_STARE');
    });

    it('respects custom somatic band thresholds from fearContract', () => {
      const customContract: Partial<FearContract> = {
        somaticBands: {
          band1: 0.2,
          band2: 0.4,
          band3: 0.6,
          band4: 0.8,
        },
      };

      expect(deriveSomaticState(0.21, customContract).band).toBe(1);
      expect(deriveSomaticState(0.41, customContract).band).toBe(2);
      expect(deriveSomaticState(0.61, customContract).band).toBe(3);
      expect(deriveSomaticState(0.81, customContract).band).toBe(4);
    });

    it('formats prompt injection correctly', () => {
      expect(formatSomaticStatePrompt('Dale Brennan', 2, ['HAND_TREMOR', 'COLD_SWEAT'])).toBe(
        '[SOMATIC STATE: Dale Brennan (Band 2: HAND_TREMOR, COLD_SWEAT)]'
      );
      expect(formatSomaticStatePrompt('Dale Brennan', 0, [])).toBeNull();
    });
  });

  describe('Spike Decay & Residue Accumulation Math', () => {
    it('executes deterministic decay and exact 25% residue accumulation into dread', () => {
      const initial: CharacterSalience = {
        spike: 0.8,
        dread: 0.1,
        threatType: 'life',
        provenance: [],
        preyMode: false,
      };

      // lambdaDecay = 0.35, residueRatio = 0.25
      // decayDelta = 0.8 * 0.35 = 0.28
      // expectedSpike = 0.8 - 0.28 = 0.52
      // expectedDread = 0.1 + (0.28 * 0.25) = 0.1 + 0.07 = 0.17
      const next = computeCharacterSalience(initial, [], {
        lambdaDecay: 0.35,
        residueRatio: 0.25,
      });

      expect(next.spike).toBeCloseTo(0.52, 5);
      expect(next.dread).toBeCloseTo(0.17, 5);
    });

    it('ratchets dread: dread never decreases without an active valve', () => {
      let state = createInitialCharacterSalience({ spike: 0, dread: 0.2 });

      // Over 5 calm turns with no events, dread stays at least 0.2
      for (let t = 1; t <= 5; t++) {
        state = computeCharacterSalience(state, [], { lambdaDecay: 0.35, residueRatio: 0.25 }, [], t);
        expect(state.dread).toBeGreaterThanOrEqual(0.2);
        expect(state.spike).toBe(0);
      }
      expect(state.dread).toBe(0.2);
    });

    it('ingests discrete events into spike with full provenance audit trail', () => {
      const initial = createInitialCharacterSalience();
      const events: SalienceEvent[] = [
        {
          eventId: 'death-record-17',
          kind: 'witnessed-death',
          spikeDelta: 0.6,
          threatType: 'life',
        },
        {
          eventId: 'panic-trace-22',
          kind: 'panic-trace',
          spikeDelta: 0.2,
          threatType: 'identity',
        },
      ];

      const result = computeCharacterSalience(initial, events, {
        lambdaDecay: 0.35,
        residueRatio: 0.25,
      }, [], 1);

      // spike after ingestion: 0.8
      // decayDelta = 0.8 * 0.35 = 0.28 -> spike = 0.52
      // dread = 0 + 0.28 * 0.25 = 0.07
      expect(result.spike).toBeCloseTo(0.52, 5);
      expect(result.dread).toBeCloseTo(0.07, 5);
      expect(result.provenance).toHaveLength(2);
      expect(result.provenance[0].eventId).toBe('death-record-17');
      expect(result.provenance[1].eventId).toBe('panic-trace-22');
    });

    it('determines dominant threat type from largest current provenance weight', () => {
      const initial = createInitialCharacterSalience();
      const events: SalienceEvent[] = [
        {
          eventId: 'exposure-risk-1',
          kind: 'threat-event',
          spikeDelta: 0.3,
          threatType: 'identity',
        },
        {
          eventId: 'exposure-risk-2',
          kind: 'threat-event',
          spikeDelta: 0.4,
          threatType: 'identity',
        },
        {
          eventId: 'minor-cut',
          kind: 'wound',
          spikeDelta: 0.2,
          threatType: 'life',
        },
      ];

      const result = computeCharacterSalience(initial, events, {}, [], 1);
      expect(result.threatType).toBe('identity');
    });
  });

  describe('Release Valve Execution', () => {
    it('executes active release valve: zeroes spike and reduces dread by reductionAmount', () => {
      const state: CharacterSalience = {
        spike: 0.5,
        dread: 0.6,
        threatType: 'life',
        provenance: [],
        preyMode: true,
      };

      const contract: Partial<FearContract> = {
        releaseValves: [
          {
            id: 'dawn-breaks',
            condition: 'dawn',
            reductionAmount: 0.4,
          },
        ],
      };

      const result = computeCharacterSalience(
        state,
        [],
        contract,
        ['dawn-breaks'],
        5
      );

      // Spike is zeroed
      expect(result.spike).toBe(0);
      // Dread reduced from 0.6 to 0.2 (0.6 - 0.4)
      expect(result.dread).toBeCloseTo(0.2, 5);
    });

    it('clamps dread to 0 when valve reduction exceeds current dread', () => {
      const state: CharacterSalience = {
        spike: 0.3,
        dread: 0.2,
        threatType: 'life',
        provenance: [],
        preyMode: false,
      };

      const contract: Partial<FearContract> = {
        releaseValves: [
          {
            id: 'sanctuary-reached',
            condition: 'sanctuary',
            reductionAmount: 0.5,
          },
        ],
      };

      const result = computeCharacterSalience(state, [], contract, ['sanctuary-reached'], 6);
      expect(result.spike).toBe(0);
      expect(result.dread).toBe(0);
    });
  });

  describe('Prey-Mode Schmitt-Trigger Hysteresis', () => {
    it('enters prey mode at enter threshold (0.70) and exits only below exit threshold (0.40)', () => {
      const contract: Partial<FearContract> = {
        preyEnterThreshold: 0.70,
        preyExitThreshold: 0.40,
        lambdaDecay: 0, // Disable decay for direct threshold control test
        residueRatio: 0,
      };

      let state = createInitialCharacterSalience({ spike: 0.69, dread: 0, preyMode: false });

      // 1. At 0.69 (< 0.70), should NOT enter prey mode
      state = computeCharacterSalience(state, [], contract, [], 1);
      expect(state.preyMode).toBe(false);

      // 2. Crosses to 0.75 (>= 0.70), enters prey mode
      state = computeCharacterSalience(state, [{
        eventId: 'scare',
        kind: 'threat-event',
        spikeDelta: 0.06,
      }], contract, [], 2);
      expect(state.preyMode).toBe(true);

      // 3. Drops to 0.60 (between 0.40 and 0.70), stays in prey mode (hysteresis!)
      state = createInitialCharacterSalience({ spike: 0.60, dread: 0, preyMode: true });
      state = computeCharacterSalience(state, [], contract, [], 3);
      expect(state.preyMode).toBe(true);

      // 4. Drops to 0.41 (> 0.40), still stays in prey mode
      state = createInitialCharacterSalience({ spike: 0.41, dread: 0, preyMode: true });
      state = computeCharacterSalience(state, [], contract, [], 4);
      expect(state.preyMode).toBe(true);

      // 5. Drops to 0.39 (<= 0.40), EXITS prey mode
      state = createInitialCharacterSalience({ spike: 0.39, dread: 0, preyMode: true });
      state = computeCharacterSalience(state, [], contract, [], 5);
      expect(state.preyMode).toBe(false);
    });
  });

  describe('Deep Clone Helpers', () => {
    it('clones character salience with independent provenance array', () => {
      const original: CharacterSalience = {
        spike: 0.5,
        dread: 0.3,
        threatType: 'life',
        provenance: [
          {
            eventId: 'ev-1',
            kind: 'wound',
            spikeDelta: 0.5,
            dreadDelta: 0,
            turn: 1,
          },
        ],
        preyMode: false,
      };

      const cloned = cloneCharacterSalience(original);
      expect(cloned).toEqual(original);

      cloned.provenance.push({
        eventId: 'ev-2',
        kind: 'other',
        spikeDelta: 0.1,
        dreadDelta: 0.1,
        turn: 2,
      });

      expect(original.provenance).toHaveLength(1);
      expect(cloned.provenance).toHaveLength(2);
    });

    it('clones salience ledger with full character independence', () => {
      const originalLedger = {
        'char-1': createInitialCharacterSalience({ spike: 0.4 }),
      };

      const clonedLedger = cloneSalienceLedger(originalLedger);
      expect(clonedLedger).toEqual(originalLedger);

      clonedLedger['char-1'].spike = 0.9;
      expect(originalLedger['char-1'].spike).toBe(0.4);
    });
  });

  describe('Snapshot / Retake Integration (Invariant 7: Zero Retake Leakage)', () => {
    it('restores salienceLedger and full provenance exactly across TURN_RETAKEN', () => {
      // 1. Set up initial state with turn 0 salience ledger
      const initialSalience: CharacterSalience = {
        spike: 0.2,
        dread: 0.1,
        threatType: 'life',
        provenance: [
          {
            eventId: 'init-event',
            kind: 'other',
            spikeDelta: 0.2,
            dreadDelta: 0.1,
            turn: 0,
          },
        ],
        preyMode: false,
      };

      const startState: EngineState = {
        ...initialEngineState,
        turnCount: 1,
        salienceLedger: {
          'char-dale': initialSalience,
        },
      };

      // 2. Turn Committed: frame mutates salience with new spike and provenance
      const mutatedSalience: CharacterSalience = {
        spike: 0.8,
        dread: 0.4,
        threatType: 'freedom',
        provenance: [
          ...initialSalience.provenance,
          {
            eventId: 'gunshot-turn-2',
            kind: 'threat-event',
            spikeDelta: 0.6,
            dreadDelta: 0.3,
            turn: 2,
          },
        ],
        preyMode: true,
      };

      const frame: RatifiedEngineFrame = {
        narrative_blocks: [{ type: 'prose', content: 'A gunshot rings out.' }],
        logic_state: {
          salience_ledger: {
            'char-dale': mutatedSalience,
          },
        },
      };

      const dummyPreSnapshot: RuntimeStateSnapshot = {
        version: 1,
        currentNodeId: 'ROOM_1',
        turnCount: 1,
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        phase: 'LATENT',
        tension: 0,
        coherence: 1,
        reconciliationRevision: 0,
        activeFlags: [],
      };

      const dummyTurnReceipt: TurnReceipt = {
        turnNumber: 1,
        nodeBefore: 'ROOM_1',
        requestedTarget: null,
        accepted: true,
        nodeAfter: 'ROOM_1',
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        tension: 0,
        preSnapshot: dummyPreSnapshot,
      };

      const dummyTransitionReceipt: TransitionReceipt = {
        requestedNodeId: 'ROOM_1',
        accepted: true,
        fromNodeId: 'ROOM_1',
        toNodeId: 'ROOM_1',
        reason: 'TRANSITION_ACCEPTED',
      };

      const committedEvent: EngineEvent = {
        type: 'TURN_COMMITTED',
        payload: {
          commandText: 'Take cover behind the desk',
          formattedText: 'Take cover behind the desk',
          frame,
          turnReceipt: dummyTurnReceipt,
          preSnapshot: dummyPreSnapshot,
          transitionReceipt: dummyTransitionReceipt,
        },
      };

      const committedState = engineReducer(startState, committedEvent);

      // Assert mutated state took effect
      expect(committedState.salienceLedger?.['char-dale'].spike).toBe(0.8);
      expect(committedState.salienceLedger?.['char-dale'].provenance).toHaveLength(2);
      expect(committedState.salienceLedger?.['char-dale'].preyMode).toBe(true);

      // 3. In-turn modification test: Ensure deep cloning prevents retroactive mutation of checkpoint
      committedState.salienceLedger?.['char-dale'].provenance.push({
        eventId: 'rogue-future-leak',
        kind: 'other',
        spikeDelta: 0.9,
        dreadDelta: 0.9,
        turn: 99,
      });

      // 4. Retake Turn
      const retakenEvent: EngineEvent = {
        type: 'TURN_RETAKEN',
      };

      const retakenState = engineReducer(committedState, retakenEvent);

      // Assert EXACT rollback to pre-turn salience with zero provenance leakage
      expect(retakenState.salienceLedger?.['char-dale'].spike).toBe(0.2);
      expect(retakenState.salienceLedger?.['char-dale'].dread).toBe(0.1);
      expect(retakenState.salienceLedger?.['char-dale'].threatType).toBe('life');
      expect(retakenState.salienceLedger?.['char-dale'].preyMode).toBe(false);
      expect(retakenState.salienceLedger?.['char-dale'].provenance).toHaveLength(1);
      expect(retakenState.salienceLedger?.['char-dale'].provenance[0].eventId).toBe('init-event');
    });
  });

  describe('Zod Schemas & Contract Validation', () => {
    it('validates SomaticTokenSchema', async () => {
      const { SomaticTokenSchema } = await import('../types/fear');
      expect(SomaticTokenSchema.safeParse('PULSE_ELEVATED').success).toBe(true);
      expect(SomaticTokenSchema.safeParse('HAND_TREMOR').success).toBe(true);
      expect(SomaticTokenSchema.safeParse('HYPERVENTILATION').success).toBe(true);
      expect(SomaticTokenSchema.safeParse('FREEZE_IMMOBILITY').success).toBe(true);
      expect(SomaticTokenSchema.safeParse('INVALID_TOKEN').success).toBe(false);
    });

    it('validates SalienceProvenanceSchema', async () => {
      const { SalienceProvenanceSchema } = await import('../types/fear');
      const valid = {
        eventId: 'death-record-17',
        kind: 'witnessed-death',
        spikeDelta: 0.6,
        dreadDelta: 0.2,
        turn: 3,
        threatType: 'life',
      };
      expect(SalienceProvenanceSchema.safeParse(valid).success).toBe(true);

      const invalid = {
        eventId: '',
        kind: 'invalid-kind',
        spikeDelta: 'not-a-number',
      };
      expect(SalienceProvenanceSchema.safeParse(invalid).success).toBe(false);
    });

    it('validates CharacterSalienceSchema and enforces bounds [0, 1]', async () => {
      const { CharacterSalienceSchema } = await import('../types/fear');
      const valid = {
        spike: 0.5,
        dread: 0.3,
        threatType: 'freedom',
        provenance: [],
        preyMode: false,
      };
      expect(CharacterSalienceSchema.safeParse(valid).success).toBe(true);

      const outOfBounds = {
        spike: 1.5,
        dread: -0.1,
        threatType: 'life',
        provenance: [],
        preyMode: false,
      };
      expect(CharacterSalienceSchema.safeParse(outOfBounds).success).toBe(false);
    });

    it('parses FearContractSchema with default values', async () => {
      const { FearContractSchema, DEFAULT_FEAR_CONTRACT } = await import('../types/fear');
      const parsed = FearContractSchema.parse({});
      expect(parsed.lambdaDecay).toBe(DEFAULT_FEAR_CONTRACT.lambdaDecay);
      expect(parsed.residueRatio).toBe(DEFAULT_FEAR_CONTRACT.residueRatio);
      expect(parsed.preyEnterThreshold).toBe(DEFAULT_FEAR_CONTRACT.preyEnterThreshold);
      expect(parsed.preyExitThreshold).toBe(DEFAULT_FEAR_CONTRACT.preyExitThreshold);
      expect(parsed.somaticBands.band1).toBe(0.25);
      expect(parsed.somaticBands.band4).toBe(0.90);
      expect(parsed.threatWeights.life).toBe(1.0);
      expect(parsed.villainGazeAuthorized).toBe(false);
    });
  });

  describe('Edge Cases: Multiple Valves, Tie Breaking, NaN Safety, and Treated Wounds', () => {
    it('applies multiple active release valves additively in a single turn', () => {
      const state: CharacterSalience = {
        spike: 0.7,
        dread: 0.8,
        threatType: 'life',
        provenance: [],
        preyMode: true,
      };

      const contract: Partial<FearContract> = {
        releaseValves: [
          { id: 'dawn', condition: 'dawn-breaks', reductionAmount: 0.3 },
          { id: 'sanctuary', condition: 'sanctuary-reached', reductionAmount: 0.3 },
        ],
      };

      const result = computeCharacterSalience(state, [], contract, ['dawn', 'sanctuary'], 10);
      expect(result.spike).toBe(0);
      // Dread reduced by 0.3 + 0.3 = 0.6 (0.8 - 0.6 = 0.2)
      expect(result.dread).toBeCloseTo(0.2, 5);
    });

    it('preserves current threat type on weight tie', () => {
      const state: CharacterSalience = {
        spike: 0,
        dread: 0,
        threatType: 'identity',
        provenance: [
          {
            eventId: 'ev-1',
            kind: 'threat-event',
            spikeDelta: 0.4,
            dreadDelta: 0,
            turn: 1,
            threatType: 'life',
          },
          {
            eventId: 'ev-2',
            kind: 'threat-event',
            spikeDelta: 0.4,
            dreadDelta: 0,
            turn: 1,
            threatType: 'identity',
          },
        ],
        preyMode: false,
      };

      // Both life and identity have 0.4 weight; since current is 'identity', it should remain 'identity'
      const result = computeCharacterSalience(state, [], {}, [], 2);
      expect(result.threatType).toBe('identity');
    });

    it('handles treated wounds: treated wounds do not mark hasUntreatedWounds', () => {
      const ledger: WoundLedger = {
        'char-healed': [
          {
            id: 'char-healed:w1',
            characterId: 'char-healed',
            mechanism: 'laceration',
            location: 'arm',
            severity: 'minor',
            timelineMinutes: 100,
            treatability: 'bandage',
            inflictedAtTurn: 1,
            inflictedAtFictionalTime: 60,
            treated: true,
            treatedAtFictionalTime: 90,
            valence: 'accident',
          },
        ],
      };

      const result = projectWoundPerception('char-healed', ledger);
      expect(result.hasUntreatedWounds).toBe(false);
      expect(result.hasUnsurvivableWound).toBe(false);
      expect(result.wounds[0].treated).toBe(true);
    });

    it('handles empty wound ledger and empty witnessed events safely', () => {
      const result = projectWoundPerception('char-clean', {});
      expect(result.wounds).toHaveLength(0);
      expect(result.dominantSeverity).toBeNull();
      expect(result.hasUntreatedWounds).toBe(false);
      expect(result.hasUnsurvivableWound).toBe(false);
    });

    it('handles NaN or invalid inputs safely without throwing', () => {
      const salienceWithNaN: CharacterSalience = {
        spike: NaN,
        dread: NaN,
        threatType: 'life',
        provenance: [],
        preyMode: false,
      };

      expect(calculateFearResponseIntensity(salienceWithNaN, NaN)).toBe(0);
      expect(deriveSomaticState(NaN).band).toBe(0);

      const result = computeCharacterSalience(salienceWithNaN, [{
        eventId: 'test',
        kind: 'other',
        spikeDelta: NaN,
        dreadDelta: NaN,
      }], { lambdaDecay: NaN, residueRatio: NaN });

      expect(result.spike).toBe(0);
      expect(result.dread).toBe(0);
    });
  });

  describe('HG4 Packet B5 — Per-Villain Fear/Salience Provenance', () => {
    describe('computeCharacterSalience — Source & Perceived Source Attribution', () => {
      it('threads sourceId and perceivedSourceId from events to provenance entries', () => {
        const initial = createInitialCharacterSalience({ threatType: 'life' });
        const events: SalienceEvent[] = [
          {
            eventId: 'ev-attack-1',
            kind: 'wound',
            spikeDelta: 0.4,
            dreadDelta: 0.1,
            turn: 3,
            sourceId: 'villain-gravedigger',
            perceivedSourceId: 'villain-gravedigger',
          },
        ];

        const updated = computeCharacterSalience(initial, events, {}, [], 3, 'char-dale');
        expect(updated.provenance).toHaveLength(1);
        expect(updated.provenance[0].sourceId).toBe('villain-gravedigger');
        expect(updated.provenance[0].perceivedSourceId).toBe('villain-gravedigger');

        // Validates cleanly against Zod schemas
        expect(() => SalienceEventSchema.parse(events[0])).not.toThrow();
        expect(() => SalienceProvenanceSchema.parse(updated.provenance[0])).not.toThrow();
      });

      it('leaves absent source fields absent on provenance entries (not empty strings or undefined placeholders)', () => {
        const initial = createInitialCharacterSalience({ threatType: 'life' });
        const events: SalienceEvent[] = [
          {
            eventId: 'ev-anon-1',
            kind: 'threat-event',
            spikeDelta: 0.3,
            dreadDelta: 0.05,
            turn: 1,
          },
        ];

        const updated = computeCharacterSalience(initial, events, {}, [], 1, 'char-sarah');
        expect(updated.provenance).toHaveLength(1);
        expect(updated.provenance[0].sourceId).toBeUndefined();
        expect(updated.provenance[0].perceivedSourceId).toBeUndefined();
        expect(updated.provenance[0].sourceId).not.toBe('');
        expect(updated.provenance[0].perceivedSourceId).not.toBe('');

        // Schema validation passes for unattributed provenance
        expect(() => SalienceProvenanceSchema.parse(updated.provenance[0])).not.toThrow();
      });

      it('preserves existing salience tests without regression when events omit source fields', () => {
        const initial = createInitialCharacterSalience({ threatType: 'life' });
        const updated = computeCharacterSalience(initial, [
          { eventId: 'legacy-1', kind: 'other', spikeDelta: 0.2 },
        ]);
        expect(updated.spike).toBeCloseTo(0.2 * (1 - DEFAULT_FEAR_CONTRACT.lambdaDecay), 4);
        expect(updated.provenance[0].eventId).toBe('legacy-1');
        expect(updated.provenance[0].sourceId).toBeUndefined();
        expect(updated.provenance[0].perceivedSourceId).toBeUndefined();
      });
    });

    describe('salienceBySource — Fear Aggregation by Source', () => {
      it('returns an empty record for null, undefined, or empty provenance', () => {
        expect(salienceBySource(null)).toEqual({});
        expect(salienceBySource(undefined)).toEqual({});
        expect(salienceBySource(createInitialCharacterSalience({ threatType: 'life' }))).toEqual({});
      });

      it('aggregates spike, dread, and event count keyed by perceivedSourceId', () => {
        const salience: CharacterSalience = {
          spike: 0.6,
          dread: 0.3,
          threatType: 'life',
          preyMode: false,
          provenance: [
            {
              eventId: 'ev-1',
              kind: 'wound',
              spikeDelta: 0.4,
              dreadDelta: 0.1,
              turn: 1,
              sourceId: 'villain-a',
              perceivedSourceId: 'villain-a',
            },
            {
              eventId: 'ev-2',
              kind: 'threat-event',
              spikeDelta: 0.2,
              dreadDelta: 0.05,
              turn: 2,
              sourceId: 'villain-a',
              perceivedSourceId: 'villain-a',
            },
          ],
        };

        const result = salienceBySource(salience);
        expect(result['villain-a']).toBeDefined();
        expect(result['villain-a'].spike).toBeCloseTo(0.6, 5);
        expect(result['villain-a'].dread).toBeCloseTo(0.15, 5);
        expect(result['villain-a'].events).toBe(2);
      });

      it('prefers perceivedSourceId over sourceId when both are present', () => {
        const salience: CharacterSalience = {
          spike: 0.5,
          dread: 0.2,
          threatType: 'life',
          preyMode: false,
          provenance: [
            {
              eventId: 'ev-frame',
              kind: 'wound',
              spikeDelta: 0.5,
              dreadDelta: 0.2,
              turn: 1,
              sourceId: 'actual-assassin',
              perceivedSourceId: 'framed-rival',
            },
          ],
        };

        const result = salienceBySource(salience);
        expect(result['framed-rival']).toBeDefined();
        expect(result['actual-assassin']).toBeUndefined();
        expect(result['framed-rival'].events).toBe(1);
      });

      it('falls back to sourceId when perceivedSourceId is absent', () => {
        const salience: CharacterSalience = {
          spike: 0.3,
          dread: 0.1,
          threatType: 'life',
          preyMode: false,
          provenance: [
            {
              eventId: 'ev-sniper',
              kind: 'wound',
              spikeDelta: 0.3,
              dreadDelta: 0.1,
              turn: 1,
              sourceId: 'distant-sniper',
            },
          ],
        };

        const result = salienceBySource(salience);
        expect(result['distant-sniper']).toBeDefined();
        expect(result['distant-sniper'].events).toBe(1);
      });

      it('buckets unattributed events under "unknown"', () => {
        const salience: CharacterSalience = {
          spike: 0.2,
          dread: 0.1,
          threatType: 'life',
          preyMode: false,
          provenance: [
            {
              eventId: 'ev-creak',
              kind: 'panic-trace',
              spikeDelta: 0.2,
              dreadDelta: 0.1,
              turn: 1,
            },
          ],
        };

        const result = salienceBySource(salience);
        expect(result['unknown']).toBeDefined();
        expect(result['unknown'].spike).toBeCloseTo(0.2, 5);
        expect(result['unknown'].dread).toBeCloseTo(0.1, 5);
        expect(result['unknown'].events).toBe(1);
      });
    });

    describe('formatSomaticStatePrompt — Dominant Fear Source Attribution', () => {
      const cast = [
        { id: 'char-dale', name: 'Dale Brennan' },
        { id: 'char-sarah', name: 'Sarah Porter' },
        { id: 'villain-1', name: 'The Caretaker' },
        { id: 'villain-2', name: 'The Lurker' },
      ];

      it('emits [FEAR SOURCE: <Name> — driven by <SourceName>] for single attributed villain', () => {
        const salienceLedger: Record<string, CharacterSalience> = {
          'char-dale': {
            spike: 0.4,
            dread: 0.3,
            threatType: 'life',
            preyMode: false,
            provenance: [
              {
                eventId: 'ev-1',
                kind: 'wound',
                spikeDelta: 0.4,
                dreadDelta: 0.3,
                turn: 1,
                sourceId: 'villain-1',
                perceivedSourceId: 'villain-1',
              },
            ],
          },
        };

        const prompt = formatSomaticStatePrompt(salienceLedger, cast, {});
        expect(prompt).not.toBeNull();
        expect(prompt).toContain('[SOMATIC STATE: Dale Brennan');
        expect(prompt).toContain('[FEAR SOURCE: Dale Brennan — driven by The Caretaker]');
      });

      it('resolves dominant source when multiple sources contribute', () => {
        const salienceLedger: Record<string, CharacterSalience> = {
          'char-dale': {
            spike: 0.6,
            dread: 0.3,
            threatType: 'life',
            preyMode: true,
            provenance: [
              {
                eventId: 'ev-minor',
                kind: 'threat-event',
                spikeDelta: 0.1,
                dreadDelta: 0.05,
                turn: 1,
                sourceId: 'villain-1',
                perceivedSourceId: 'villain-1',
              },
              {
                eventId: 'ev-major',
                kind: 'wound',
                spikeDelta: 0.5,
                dreadDelta: 0.25,
                turn: 2,
                sourceId: 'villain-2',
                perceivedSourceId: 'villain-2',
              },
            ],
          },
        };

        const prompt = formatSomaticStatePrompt(salienceLedger, cast, {});
        expect(prompt).not.toBeNull();
        // villain-2 weight (0.5+0.25=0.75) > villain-1 weight (0.1+0.05=0.15)
        expect(prompt).toContain('[FEAR SOURCE: Dale Brennan — driven by The Lurker]');
        expect(prompt).not.toContain('driven by The Caretaker');
      });

      it('deterministically breaks ties by first-seen source', () => {
        const salienceLedger: Record<string, CharacterSalience> = {
          'char-dale': {
            spike: 0.5,
            dread: 0.5,
            threatType: 'life',
            preyMode: true,
            provenance: [
              {
                eventId: 'ev-1',
                kind: 'threat-event',
                spikeDelta: 0.3,
                dreadDelta: 0.1,
                turn: 1,
                perceivedSourceId: 'villain-1',
              },
              {
                eventId: 'ev-2',
                kind: 'threat-event',
                spikeDelta: 0.3,
                dreadDelta: 0.1,
                turn: 2,
                perceivedSourceId: 'villain-2',
              },
            ],
          },
        };

        const prompt = formatSomaticStatePrompt(salienceLedger, cast, {});
        expect(prompt).not.toBeNull();
        // Both have weight 0.4. villain-1 was seen first; first-seen wins
        expect(prompt).toContain('[FEAR SOURCE: Dale Brennan — driven by The Caretaker]');
        expect(prompt).not.toContain('driven by The Lurker');
      });

      it('omits fear source line when events are unattributed ("unknown")', () => {
        const salienceLedger: Record<string, CharacterSalience> = {
          'char-dale': {
            spike: 0.4,
            dread: 0.3,
            threatType: 'life',
            preyMode: false,
            provenance: [
              {
                eventId: 'ev-ghost',
                kind: 'panic-trace',
                spikeDelta: 0.4,
                dreadDelta: 0.3,
                turn: 1,
              },
            ],
          },
        };

        const prompt = formatSomaticStatePrompt(salienceLedger, cast, {});
        expect(prompt).not.toBeNull();
        expect(prompt).toContain('[SOMATIC STATE: Dale Brennan');
        expect(prompt).not.toContain('[FEAR SOURCE:');
      });

      it('diegetic containment: never reveals sourceId when perceivedSourceId differs', () => {
        const salienceLedger: Record<string, CharacterSalience> = {
          'char-sarah': {
            spike: 0.5,
            dread: 0.3,
            threatType: 'life',
            preyMode: false,
            provenance: [
              {
                eventId: 'ev-ambush',
                kind: 'wound',
                spikeDelta: 0.5,
                dreadDelta: 0.3,
                turn: 1,
                sourceId: 'villain-1',            // Actual: The Caretaker
                perceivedSourceId: 'villain-2',   // Believed: The Lurker
              },
            ],
          },
        };

        const prompt = formatSomaticStatePrompt(salienceLedger, cast, {});
        expect(prompt).not.toBeNull();
        expect(prompt).toContain('[FEAR SOURCE: Sarah Porter — driven by The Lurker]');
        expect(prompt).not.toContain('The Caretaker');
      });

      it('falls back to character ID if source is not found in cast', () => {
        const salienceLedger: Record<string, CharacterSalience> = {
          'char-dale': {
            spike: 0.4,
            dread: 0.3,
            threatType: 'life',
            preyMode: false,
            provenance: [
              {
                eventId: 'ev-unregistered',
                kind: 'wound',
                spikeDelta: 0.4,
                dreadDelta: 0.3,
                turn: 1,
                perceivedSourceId: 'shadow-entity-99',
              },
            ],
          },
        };

        const prompt = formatSomaticStatePrompt(salienceLedger, cast, {});
        expect(prompt).not.toBeNull();
        expect(prompt).toContain('[FEAR SOURCE: Dale Brennan — driven by shadow-entity-99]');
      });

      it('preserves single-character overload behavior without emitting fear source line', () => {
        const singleResult = formatSomaticStatePrompt('Dale Brennan', 2, ['HAND_TREMOR', 'COLD_SWEAT']);
        expect(singleResult).toBe('[SOMATIC STATE: Dale Brennan (Band 2: HAND_TREMOR, COLD_SWEAT)]');
        expect(singleResult).not.toContain('[FEAR SOURCE:');
      });
    });
  });
});
