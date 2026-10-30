import { describe, it, expect } from 'vitest';
import type {
  Blueprint,
  CanonicalConsequenceProposal,
  IntentReceipt,
  NarrativeReconciliationReceipt,
  CastInteractionReceipt,
  EngineTurnContext,
  CharacterStanceProposal,
  LocationTopology,
  AcousticMedium,
  VocalDelivery,
} from '../types';
import type {
  ValueStateLedger,
  ValueStateProposal,
  CharacterPursuitLedger,
  CharacterPursuitProposal,
  SituatedPressureThread,
  PressureThreadTransitionProposal,
  SituatedPressureProposal,
} from '../types/horrorGrammar';
import type {
  AttemptFilterContext,
} from '../types/worldState';
import type {
  DramaticSpine,
  DramaturgyRuntimeState,
} from '../types/dramaturgy';
import type { CohortMember } from '../types/cohort';
import type { CharacterSalience, FearContract } from '../types/fear';

// Mechanics under test
import {
  resolveCharacterPursuit,
  createInitialCharacterPursuitLedger,
} from './characterPursuits';
import {
  resolveValueState,
  createInitialValueStateLedger,
  selectPressuredAnchors,
} from './valueState';
import {
  resolveSituatedPressure,
  resolvePressureThreadTransitions,
} from './situatedPressure';
import {
  canAttempt,
} from './worldPredicates';
import {
  resolveCharacterStance,
  deriveFocusFlipBeats,
  createCharacterStanceState,
} from './characterStance';
import {
  calculateComposureDelta,
  deriveComposureBand,
  derivePsychologicalStatus,
  evaluateBreakingPoint,
  evaluateObstructionLift,
} from './composureDerivation';
import {
  computeCharacterSalience,
} from './fearEngine';
import {
  scoreCandidateBehavior,
  DEFAULT_AFFINITIES,
} from './cohortEngine';
import {
  executePacingGovernor,
} from './pacingGovernor';
import {
  resolveCanonicalConsequences,
  createCanonicalConsequenceState,
} from './canonicalConsequences';
import {
  resolveAcousticAudience,
  scanTurnForVoiceViolations,
  VoiceViolationReceiptSchema,
} from './vocalizationEngine';
import { buildEngineTurnContext } from './buildEngineTurnContext';
import { normalizeBlueprint } from './normalizeBlueprint';

// Blueprint fixture
import starlightMotelRaw from '../data/blueprints/starlight_motel.json';

describe('Cross-Mechanic Interaction Integration Suite (HG2 Pure Determinism)', () => {
  const blueprint: Blueprint = normalizeBlueprint(starlightMotelRaw);

  const defaultIntentReceipt: IntentReceipt = {
    version: 1,
    action_kind: 'INVESTIGATE',
    action_subtype: null,
    pressure_direction: 'MAINTAIN',
    dramatic_tactic: 'NONE',
    intent_synergy: 'SUCCESS',
  };

  const defaultReconciliationReceipt: NarrativeReconciliationReceipt = {
    version: 1,
    feasibility: 'SUPPORTED',
    mode: 'CANONICAL',
    reason_code: 'NONE',
    fictional_time_cost: 'MOMENT',
    authority_alignment: 'WITHIN_CONTRACT',
    memory_echo_candidate: null,
  };

  const defaultCastInteractionReceipt: CastInteractionReceipt = {
    version: 1,
    addressedCharacterId: null,
    respondingCharacterId: null,
    outcome: 'NONE',
  };

  const createAttemptContext = (overrides?: Partial<AttemptFilterContext>): AttemptFilterContext => ({
    restraint: { bindings: {}, locks: {} },
    objects: {},
    attention: {},
    routines: {},
    capabilities: {},
    seats: {
      captorCharacterIds: ['char-frank-mercer', 'char-paula-mercer'],
      preyCharacterIds: ['char-tommy-beck', 'char-rosa-delgado', 'char-eddie-marsh'],
    },
    fictionalTime: 120,
    characterNodes: {
      'char-tommy-beck': 'room_6',
      'char-rosa-delgado': 'room_7',
      'char-frank-mercer': 'office',
      'char-paula-mercer': 'office',
      'char-eddie-marsh': 'parking_lot',
    },
    topologyConnections: [
      { fromNodeId: 'office', toNodeId: 'parking_lot', status: 'OPEN' },
      { fromNodeId: 'parking_lot', toNodeId: 'room_6', status: 'OPEN' },
      { fromNodeId: 'parking_lot', toNodeId: 'room_7', status: 'OPEN' },
      { fromNodeId: 'room_7', toNodeId: 'ice_alley', status: 'OPEN' },
      { fromNodeId: 'ice_alley', toNodeId: 'highway_edge', status: 'OPEN' },
    ],
    ...overrides,
  });

  const createEngineContext = (
    overrides?: Partial<EngineTurnContext>,
    extraBaselineAnchors?: import('../types/horrorGrammar').ValueAnchor[]
  ): EngineTurnContext => {
    const base = buildEngineTurnContext({
      blueprint,
      selectedRole: 'protagonist',
      runtimeState: {
        currentNodeId: 'room_7',
      },
    });
    return {
      ...base,
      ...overrides,
      cast: (overrides?.cast || base.cast).map((c) => ({
        ...c,
        isPresent: true,
      })),
      horrorGrammar: base.horrorGrammar
        ? {
            ...base.horrorGrammar,
            authoringBaseline: {
              ...base.horrorGrammar.authoringBaseline,
              valueAnchors: [
                ...base.horrorGrammar.authoringBaseline.valueAnchors,
                ...(extraBaselineAnchors || []),
              ],
            },
          }
        : base.horrorGrammar,
    };
  };

  // ==========================================================================
  // Interaction 1: fear × pursuit
  // ==========================================================================
  describe('1. Fear × Pursuit — Composure attrition, breaking-point obstruction, and locomotion/stance gating', () => {
    it('escalating fear drives breaking-point obstruction, gating locomotion via canAttempt and resolving pursuit BLOCK', () => {
      // 1. Initial State: Rosa Delgado is at room_7 with baseline composure (80)
      const initialComposure = 80;
      expect(deriveComposureBand(initialComposure)).toBe('BASELINE');
      expect(derivePsychologicalStatus(initialComposure)).toBe('STABLE');

      const rosaStakes = {
        characterId: 'char-rosa-delgado',
        coreDesireOrNeed: 'Find a working telephone line',
        copingMechanism: 'Systematic perimeter checks',
        breakingPointTrigger: 'Severely rattled by signs of physical violence',
        breakingPointThreshold: 25,
        isObstructed: false,
        liftConditions: [
          {
            kind: 'PERSUASION' as const,
            composureRecoveryThreshold: 30,
            description: 'Persuaded by Tommy Beck that escape remains viable',
          },
        ],
        composureSensitivity: 1.0,
        currentComposure: initialComposure,
      };

      const pursuitLedger: CharacterPursuitLedger = createInitialCharacterPursuitLedger(blueprint);
      expect(pursuitLedger['pursuit-rosa-triage']).toBeDefined();
      expect(pursuitLedger['pursuit-rosa-triage'].status).toBe('ACTIVE');

      // 2. Severe horror event occurs: Rosa discovers blood along the ice alley window
      const severeShockEvents = [
        {
          domain: 'PSYCHOLOGICAL_STATUS',
          severity: 28,
          tags: ['horror', 'rupture', 'mutilation'],
        },
        {
          domain: 'SOMATIC',
          severity: 20,
        },
      ];
      const delta = calculateComposureDelta(severeShockEvents, rosaStakes.composureSensitivity);
      expect(delta).toBeLessThanOrEqual(-60);

      const shatteredComposure = Math.max(0, initialComposure + delta);
      expect(shatteredComposure).toBeLessThanOrEqual(20);
      expect(deriveComposureBand(shatteredComposure)).toBe('FRACTURED');
      expect(derivePsychologicalStatus(shatteredComposure)).toBe('PANICKED');

      // 3. Breaking point is evaluated and confirms obstruction
      const breakingEvaluation = evaluateBreakingPoint(
        { ...rosaStakes, currentComposure: shatteredComposure },
        true
      );
      expect(breakingEvaluation.isObstructed).toBe(true);
      expect(breakingEvaluation.reason).toContain('Breaking point reached');

      // 4. Locomotion gating: terror induces temporary locomotion impairment
      const panickedContext = createAttemptContext({
        capabilities: {
          'char-rosa-delgado': {
            impairedCapabilities: ['LOCOMOTION_RAPID'],
            provenance: ['Paralyzed by acute panic'],
          },
        },
      });

      const attemptResult = canAttempt(
        'char-rosa-delgado',
        'FLEE',
        'highway_edge',
        panickedContext
      );
      expect(attemptResult.allowed).toBe(false);
      expect(attemptResult.reasonCode).toBe('CAPABILITY_IMPAIRED');
      expect(attemptResult.impairedSlot).toBe('LOCOMOTION_RAPID');

      // 5. Pursuit transition resolution: engine blocks Rosa's triage pursuit due to terror
      const validCauses = ['BASELINE', 'USER_ACTION', 'csq-PSYCHOLOGICAL_STATUS-SET'];
      const pursuitProposal: CharacterPursuitProposal = {
        changes: [
          {
            pursuitId: 'pursuit-rosa-triage',
            operation: 'BLOCK',
            expectedStatus: 'ACTIVE',
            proposedStatus: 'BLOCKED',
            progressSummary: 'Overcome by terror at the ice alley window; unable to proceed.',
            causeReference: 'csq-PSYCHOLOGICAL_STATUS-SET',
            rationale: 'Severe panic rendered character unable to maintain reconnaissance.',
          },
        ],
      };

      const pursuitReceipt = resolveCharacterPursuit({
        proposal: pursuitProposal,
        preState: pursuitLedger,
        currentTurn: 2,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });

      expect(pursuitReceipt.version).toBe(1);
      expect(pursuitReceipt.decisions).toHaveLength(1);
      expect(pursuitReceipt.decisions[0]).toEqual({
        pursuitId: 'pursuit-rosa-triage',
        operation: 'BLOCK',
        outcome: 'APPLIED',
        reasonCode: 'PURSUIT_TRANSITION_APPLIED',
        causeReference: 'csq-PSYCHOLOGICAL_STATUS-SET',
      });
      expect(pursuitReceipt.postState['pursuit-rosa-triage'].status).toBe('BLOCKED');
      expect(pursuitReceipt.boundedOutChangeIds).toEqual([]);
    });

    it('deterministic lift conditions restore composure and permit pursuit resumption', () => {
      // 1. Rosa is currently obstructed in BLOCKED state
      const initialLedger: CharacterPursuitLedger = createInitialCharacterPursuitLedger(blueprint);
      initialLedger['pursuit-rosa-triage'].status = 'BLOCKED';
      initialLedger['pursuit-rosa-triage'].progressSummary = 'Blocked by panic';

      const obstructedStakes = {
        characterId: 'char-rosa-delgado',
        coreDesireOrNeed: 'Find a working telephone line',
        copingMechanism: 'Systematic perimeter checks',
        breakingPointTrigger: 'Severely rattled by signs of physical violence',
        breakingPointThreshold: 25,
        isObstructed: true,
        obstructionReason: 'Breaking point reached: panic paralysis.',
        liftConditions: [
          {
            kind: 'PERSUASION' as const,
            composureRecoveryThreshold: 35,
            description: 'Persuaded by Tommy Beck that escape remains viable',
          },
        ],
        composureSensitivity: 1.0,
        currentComposure: 15,
      };

      // 2. Tommy provides successful persuasion and reassurance
      const recoveryEvents = [
        {
          domain: 'PERSUASION',
          severity: 25,
          tags: ['persuade', 'aid', 'stabilize'],
        },
      ];
      const delta = calculateComposureDelta(recoveryEvents, obstructedStakes.composureSensitivity);
      expect(delta).toBeGreaterThanOrEqual(25);

      const restoredComposure = obstructedStakes.currentComposure + delta; // 15 + 25 = 40
      expect(restoredComposure).toBeGreaterThanOrEqual(35);

      const liftResult = evaluateObstructionLift(obstructedStakes, 'PERSUASION', restoredComposure);
      expect(liftResult.lifted).toBe(true);
      expect(liftResult.reason).toContain('Obstruction lifted via PERSUASION');

      // 3. Clear capability impairment and verify canAttempt allows locomotion
      const restoredContext = createAttemptContext({
        capabilities: {
          'char-rosa-delgado': {
            impairedCapabilities: [],
          },
        },
      });
      const attemptResult = canAttempt(
        'char-rosa-delgado',
        'INVESTIGATE',
        'ice_alley',
        restoredContext
      );
      expect(attemptResult.allowed).toBe(true);
      expect(attemptResult.reasonCode).toBe('ALLOWED');

      // 4. Pursuit RESUME proposal succeeds
      const validCauses = ['BASELINE', 'USER_ACTION', 'csq-REST_RESPITE-ADD'];
      const resumeProposal: CharacterPursuitProposal = {
        changes: [
          {
            pursuitId: 'pursuit-rosa-triage',
            operation: 'RESUME',
            expectedStatus: 'BLOCKED',
            proposedStatus: 'ACTIVE',
            proposedApproach: 'Carefully resume testing window locks under Tommy’s watch',
            progressSummary: 'Composure restored; Rosa re-engages perimeter survey.',
            causeReference: 'USER_ACTION',
            rationale: 'Obstruction lifted via teammate persuasion.',
          },
        ],
      };

      const receipt = resolveCharacterPursuit({
        proposal: resumeProposal,
        preState: initialLedger,
        currentTurn: 3,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });

      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.postState['pursuit-rosa-triage'].status).toBe('ACTIVE');
      expect(receipt.boundedOutChangeIds).toEqual([]);
    });

    it('somatic fear spikes shift cohort affinities toward FLEE and produce stance focus-flip beats', () => {
      // 1. Cohort Member under baseline vs terrorized salience
      const baselineMember: CohortMember = {
        characterId: 'char-rosa-delgado',
        isSeatHolder: false,
        tenureTurns: 2,
        affinities: { ...DEFAULT_AFFINITIES },
        cognition: {
          characterId: 'char-rosa-delgado',
          skepticism: 0.5,
          cognitiveDissonance: 0,
          ingestedEvidenceIds: [],
          hypotheses: {},
        },
        salience: {
          spike: 0,
          dread: 0,
          threatType: 'life',
          provenance: [],
          preyMode: false,
        },
      };

      const terrorSalience: CharacterSalience = {
        spike: 0.85,
        dread: 0.65,
        threatType: 'life',
        provenance: [],
        preyMode: true,
      };

      const terrorizedMember: CohortMember = {
        ...baselineMember,
        salience: terrorSalience,
      };

      const fearContract: Partial<FearContract> = {
        threatWeights: { life: 1.0, freedom: 1.0, identity: 1.0 },
      };

      const baselineFlee = scoreCandidateBehavior('FLEE', baselineMember, 1.0, {
        salience: baselineMember.salience,
        fearContract,
      });
      const terrorFlee = scoreCandidateBehavior('FLEE', terrorizedMember, 1.0, {
        salience: terrorizedMember.salience,
        fearContract,
      });
      expect(terrorFlee - baselineFlee).toBeGreaterThan(0.5);

      const baselineInvestigate = scoreCandidateBehavior('INVESTIGATE', baselineMember, 1.0, {
        salience: baselineMember.salience,
        fearContract,
      });
      const terrorInvestigate = scoreCandidateBehavior('INVESTIGATE', terrorizedMember, 1.0, {
        salience: terrorizedMember.salience,
        fearContract,
      });
      expect(terrorInvestigate - baselineInvestigate).toBeLessThan(-0.5);

      // 2. Character stance shifts focus from SITUATION to PLAYER
      const preStanceState = createCharacterStanceState({
        'char-rosa-delgado': {
          focus: 'SITUATION',
          stance: 'GUARDED',
        },
      });

      const stanceProposal: CharacterStanceProposal = {
        changes: [
          {
            character_id: 'char-rosa-delgado',
            focus: 'PLAYER',
            stance: 'AFRAID',
            rationale: 'Rosa turns from the darkened hallway directly toward Tommy in fear.',
          },
        ],
      };

      const stanceReceipt = resolveCharacterStance({
        proposal: stanceProposal,
        currentState: preStanceState,
        context: createEngineContext({
          participationContext: { mode: 'protagonist' } as unknown as EngineTurnContext['participationContext'],
        }),
        intentReceipt: defaultIntentReceipt,
        reconciliationReceipt: defaultReconciliationReceipt,
        castInteractionReceipt: defaultCastInteractionReceipt,
      });

      expect(stanceReceipt.decisions).toHaveLength(1);
      expect(stanceReceipt.decisions[0].outcome).toBe('APPLIED');

      // 3. Focus-flip describer beat is deterministically emitted
      const focusBeats = deriveFocusFlipBeats(stanceReceipt);
      expect(focusBeats).toHaveLength(1);
      expect(focusBeats[0]).toEqual({
        character_id: 'char-rosa-delgado',
        previousFocus: 'SITUATION',
        currentFocus: 'PLAYER',
        beat: 'char-rosa-delgado shifts focus from SITUATION to PLAYER',
      });
    });

    it('panic rout overflow strictly enforces pursuit boundedOutChangeIds and protects user character', () => {
      const ledger = createInitialCharacterPursuitLedger(blueprint);
      const validCauses = ['BASELINE', 'USER_ACTION'];

      // Submit 4 pursuit changes (cap is 2) plus an attempt to mutate the user character's pursuit
      const overflowingProposal: CharacterPursuitProposal = {
        changes: [
          {
            pursuitId: 'pursuit-frank-harvest',
            operation: 'SETBACK',
            progressSummary: 'Frank momentarily delayed by power outage',
            causeReference: 'USER_ACTION',
            rationale: 'Interrupted by generator surge',
          },
          {
            pursuitId: 'pursuit-paula-audit',
            operation: 'PAUSE',
            progressSummary: 'Paula stops counting as footsteps approach',
            causeReference: 'BASELINE',
            rationale: 'Hears noise in hallway',
          },
          {
            pursuitId: 'pursuit-rosa-triage',
            operation: 'SETBACK',
            progressSummary: 'Excess change 1',
            causeReference: 'BASELINE',
            rationale: 'Dropped due to per-turn cap',
          },
          {
            pursuitId: 'pursuit-eddie-rig',
            operation: 'PAUSE',
            progressSummary: 'Excess change 2',
            causeReference: 'BASELINE',
            rationale: 'Dropped due to per-turn cap',
          },
        ],
      };

      const receipt = resolveCharacterPursuit({
        proposal: overflowingProposal,
        preState: ledger,
        currentTurn: 4,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });

      // Exactly 2 decisions applied, 2 bounded out
      expect(receipt.decisions).toHaveLength(2);
      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.decisions[1].outcome).toBe('APPLIED');
      expect(receipt.boundedOutChangeIds).toEqual(['pursuit-rosa-triage', 'pursuit-eddie-rig']);
    });
  });

  // ==========================================================================
  // Interaction 2: pursuit × values
  // ==========================================================================
  describe('2. Pursuit × Values — Pursuit progression driving value anchor degradation and ranking', () => {
    it('pursuit setback and abandonment drive value anchor degradation from ESTABLISHED -> THREATENED -> COMPROMISED', () => {
      const pursuitLedger = createInitialCharacterPursuitLedger(blueprint);
      const valueLedger = createInitialValueStateLedger(blueprint);

      expect(valueLedger['anchor-paula-loyalty'].condition).toBe('ESTABLISHED');
      expect(pursuitLedger['pursuit-paula-audit'].status).toBe('ACTIVE');

      const validCauses = ['BASELINE', 'USER_ACTION', 'csq-PURSUIT-SETBACK', 'csq-PURSUIT-ABANDON'];

      // Beat 1: Frank confronts Paula during her audit -> pursuit setback
      const setbackProposal: CharacterPursuitProposal = {
        changes: [
          {
            pursuitId: 'pursuit-paula-audit',
            operation: 'SETBACK',
            expectedStatus: 'ACTIVE',
            proposedApproach: 'Conceal the registration receipts inside the laundry hamper',
            progressSummary: 'Frank entered the linen closet unexpectedly; Paula forced to hide papers.',
            causeReference: 'USER_ACTION',
            rationale: 'Hostile proximity interrupted record examination.',
          },
        ],
      };

      const pursuitReceipt1 = resolveCharacterPursuit({
        proposal: setbackProposal,
        preState: pursuitLedger,
        currentTurn: 5,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });
      expect(pursuitReceipt1.decisions[0].outcome).toBe('APPLIED');
      expect(pursuitReceipt1.postState['pursuit-paula-audit'].status).toBe('ACTIVE');

      // Setback causes loyalty anchor to become THREATENED
      const valueProposal1: ValueStateProposal = {
        changes: [
          {
            anchorId: 'anchor-paula-loyalty',
            operation: 'SET_CONDITION',
            expectedBeforeCondition: 'ESTABLISHED',
            proposedCondition: 'THREATENED',
            proposedFormNote: 'Suspicion that Frank is operating without her consent',
            causeReference: 'csq-PURSUIT-SETBACK',
            rationale: 'Interruption confirmed Frank was hiding motel room turnover.',
          },
        ],
      };

      const valueReceipt1 = resolveValueState({
        proposal: valueProposal1,
        preState: valueLedger,
        currentTurn: 5,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });

      expect(valueReceipt1.decisions[0].outcome).toBe('APPLIED');
      expect(valueReceipt1.postState['anchor-paula-loyalty'].condition).toBe('THREATENED');
      expect(valueReceipt1.boundedOutChangeIds).toEqual([]);

      // Beat 2: Frank destroys the master ledger, forcing Paula to ABANDON her audit
      const abandonProposal: CharacterPursuitProposal = {
        changes: [
          {
            pursuitId: 'pursuit-paula-audit',
            operation: 'ABANDON',
            expectedStatus: 'ACTIVE',
            proposedStatus: 'ABANDONED',
            progressSummary: 'Ledger burned in the incinerator; audit is permanently impossible.',
            causeReference: 'USER_ACTION',
            rationale: 'Physical evidence destroyed by Frank.',
          },
        ],
      };

      const pursuitReceipt2 = resolveCharacterPursuit({
        proposal: abandonProposal,
        preState: pursuitReceipt1.postState,
        currentTurn: 6,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });
      expect(pursuitReceipt2.decisions[0].outcome).toBe('APPLIED');
      expect(pursuitReceipt2.postState['pursuit-paula-audit'].status).toBe('ABANDONED');

      // Abandonment causes loyalty anchor to become COMPROMISED
      const valueProposal2: ValueStateProposal = {
        changes: [
          {
            anchorId: 'anchor-paula-loyalty',
            operation: 'SET_CONDITION',
            expectedBeforeCondition: 'THREATENED',
            proposedCondition: 'COMPROMISED',
            proposedFormNote: 'Twenty-three years of mutual loyalty shattered',
            causeReference: 'csq-PURSUIT-ABANDON',
            rationale: 'Destruction of ledger proved Frank intends to sacrifice Paula.',
          },
        ],
      };

      const valueReceipt2 = resolveValueState({
        proposal: valueProposal2,
        preState: valueReceipt1.postState,
        currentTurn: 6,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });

      expect(valueReceipt2.decisions[0].outcome).toBe('APPLIED');
      expect(valueReceipt2.postState['anchor-paula-loyalty'].condition).toBe('COMPROMISED');
      expect(valueReceipt2.boundedOutChangeIds).toEqual([]);
    });

    it('selectPressuredAnchors deterministically ranks anchors by pressure severity with alphabetical tie-breaking', () => {
      const mockLedger: ValueStateLedger = {
        'anchor-eddie-rig': {
          anchorId: 'anchor-eddie-rig',
          lifecycle: 'ACTIVE',
          condition: 'ESTABLISHED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 0,
        },
        'anchor-paula-loyalty': {
          anchorId: 'anchor-paula-loyalty',
          lifecycle: 'ACTIVE',
          condition: 'COMPROMISED',
          currentFormNote: 'Shattered loyalty',
          lastCauseReference: 'csq-PURSUIT-ABANDON',
          lastChangedTurn: 6,
        },
        'anchor-tommy-home': {
          anchorId: 'anchor-tommy-home',
          lifecycle: 'ACTIVE',
          condition: 'THREATENED',
          currentFormNote: 'Car blocked by snow drift',
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 2,
        },
        'anchor-paula-suspicion': {
          anchorId: 'anchor-paula-suspicion',
          lifecycle: 'ACTIVE',
          condition: 'THREATENED',
          currentFormNote: 'Verifying vacancies',
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 1,
        },
        'anchor-safe-haven': {
          anchorId: 'anchor-safe-haven',
          lifecycle: 'ACTIVE',
          condition: 'SECURED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 0,
        },
      };

      const ranked = selectPressuredAnchors(mockLedger);
      expect(ranked).toHaveLength(5);

      // Rank order: COMPROMISED (6) > THREATENED (5) > ESTABLISHED (2) > SECURED (1)
      // Rank 1: COMPROMISED
      expect(ranked[0].anchorId).toBe('anchor-paula-loyalty');
      expect(ranked[0].condition).toBe('COMPROMISED');

      // Rank 2 & 3: THREATENED tie broken by anchorId ('anchor-paula-suspicion' < 'anchor-tommy-home')
      expect(ranked[1].anchorId).toBe('anchor-paula-suspicion');
      expect(ranked[1].condition).toBe('THREATENED');
      expect(ranked[2].anchorId).toBe('anchor-tommy-home');
      expect(ranked[2].condition).toBe('THREATENED');

      // Rank 4: ESTABLISHED
      expect(ranked[3].anchorId).toBe('anchor-eddie-rig');
      expect(ranked[3].condition).toBe('ESTABLISHED');

      // Rank 5: SECURED
      expect(ranked[4].anchorId).toBe('anchor-safe-haven');
      expect(ranked[4].condition).toBe('SECURED');
    });

    it('simultaneous multi-mechanic cascade enforces dual boundedOutChangeIds independently', () => {
      const pursuitLedger = createInitialCharacterPursuitLedger(blueprint);
      const valueLedger = createInitialValueStateLedger(blueprint);

      const validCauses = ['BASELINE', 'USER_ACTION'];

      // 4 pursuit changes (cap is 2)
      const pursuitProposal: CharacterPursuitProposal = {
        changes: [
          {
            pursuitId: 'pursuit-frank-harvest',
            operation: 'SETBACK',
            causeReference: 'USER_ACTION',
            progressSummary: 'P1',
            rationale: 'R1',
          },
          {
            pursuitId: 'pursuit-paula-audit',
            operation: 'PAUSE',
            causeReference: 'BASELINE',
            progressSummary: 'P2',
            rationale: 'R2',
          },
          {
            pursuitId: 'pursuit-rosa-triage',
            operation: 'BLOCK',
            causeReference: 'BASELINE',
            progressSummary: 'P3-overflow',
            rationale: 'R3',
          },
          {
            pursuitId: 'pursuit-eddie-rig',
            operation: 'ABANDON',
            causeReference: 'BASELINE',
            progressSummary: 'P4-overflow',
            rationale: 'R4',
          },
        ],
      };

      const pursuitReceipt = resolveCharacterPursuit({
        proposal: pursuitProposal,
        preState: pursuitLedger,
        currentTurn: 7,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });

      expect(pursuitReceipt.decisions).toHaveLength(2);
      expect(pursuitReceipt.boundedOutChangeIds).toEqual(['pursuit-rosa-triage', 'pursuit-eddie-rig']);

      // 5 value changes (cap is 3)
      const valueProposal: ValueStateProposal = {
        changes: [
          {
            anchorId: 'anchor-paula-loyalty',
            operation: 'SET_CONDITION',
            proposedCondition: 'THREATENED',
            causeReference: 'USER_ACTION',
            rationale: 'V1',
          },
          {
            anchorId: 'anchor-paula-suspicion',
            operation: 'SET_CONDITION',
            proposedCondition: 'THREATENED',
            causeReference: 'BASELINE',
            rationale: 'V2',
          },
          {
            anchorId: 'anchor-tommy-home',
            operation: 'SET_CONDITION',
            proposedCondition: 'THREATENED',
            causeReference: 'USER_ACTION',
            rationale: 'V3',
          },
          {
            anchorId: 'anchor-extra-1',
            operation: 'SET_CONDITION',
            proposedCondition: 'THREATENED',
            causeReference: 'USER_ACTION',
            rationale: 'V4-overflow',
          },
          {
            anchorId: 'anchor-extra-2',
            operation: 'SET_CONDITION',
            proposedCondition: 'THREATENED',
            causeReference: 'USER_ACTION',
            rationale: 'V5-overflow',
          },
        ],
      };

      const valueReceipt = resolveValueState({
        proposal: valueProposal,
        preState: valueLedger,
        currentTurn: 7,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });

      expect(valueReceipt.decisions).toHaveLength(3);
      expect(valueReceipt.boundedOutChangeIds).toEqual(['anchor-extra-1', 'anchor-extra-2']);
    });
  });

  // ==========================================================================
  // Interaction 3: values × discovery
  // ==========================================================================
  describe('3. Values × Discovery — Diegetic clue revelations compounding value anchor pressure and situated pressure threads', () => {
    it('clue discovery consequence provides diegetic cause for value compromise and spawns admitted situated pressure thread', () => {
      // 1. Discovery consequence mutation resolved via resolveCanonicalConsequences
      const consequenceProposal: CanonicalConsequenceProposal = {
        mutations: [
          {
            domain: 'DISCOVERY',
            operation: 'ADD',
            value: 'Hidden Registration Page for Room 4',
            rationale: 'Discovered taped under the counter drawer.',
          },
        ],
      };

      const consequenceReceipt = resolveCanonicalConsequences({
        proposal: consequenceProposal,
        currentState: createCanonicalConsequenceState(),
        intentReceipt: defaultIntentReceipt,
        reconciliationReceipt: defaultReconciliationReceipt,
        effectiveRole: 'protagonist',
      });

      expect(consequenceReceipt.decisions).toHaveLength(1);
      expect(consequenceReceipt.decisions[0].outcome).toBe('APPLIED');
      expect(consequenceReceipt.decisions[0].mutation.domain).toBe('DISCOVERY');

      // 2. Value state transition triggered by the discovery
      const valueLedger = createInitialValueStateLedger(blueprint);
      const validCauses = ['BASELINE', 'USER_ACTION', 'csq-DISCOVERY-ADD'];

      const valueProposal: ValueStateProposal = {
        changes: [
          {
            anchorId: 'anchor-paula-suspicion',
            operation: 'SET_CONDITION',
            expectedBeforeCondition: 'ESTABLISHED',
            proposedCondition: 'COMPROMISED',
            proposedFormNote: 'Irrefutable proof of unauthorized harvesting',
            causeReference: 'csq-DISCOVERY-ADD',
            rationale: 'The registration page bears Frank’s handwriting and marks a guest never logged.',
          },
        ],
      };

      const valueReceipt = resolveValueState({
        proposal: valueProposal,
        preState: valueLedger,
        currentTurn: 8,
        authoringBaseline: blueprint.horrorGrammar,
        blueprint,
        userCharacterId: 'char-tommy-beck',
        validCauses,
      });

      expect(valueReceipt.decisions[0].outcome).toBe('APPLIED');
      expect(valueReceipt.postState['anchor-paula-suspicion'].condition).toBe('COMPROMISED');
      expect(valueReceipt.boundedOutChangeIds).toEqual([]);

      // 3. Spawning a Situated Pressure thread tied to the compromised value anchor
      const pressureProposal: SituatedPressureProposal = {
        kind: 'PRESSURE',
        proposalId: 'prop-pres-ledger-confrontation',
        valueAnchorId: 'anchor-paula-suspicion',
        sourceReference: 'BASELINE',
        operator: 'EXPOSE',
        affectedDimension: 'TRUST',
        adverseProspect: 'Paula will discover that Tommy has seen the hidden registration page.',
        authorityReferences: [],
        persistenceTarget: 'PRESSURE_THREAD',
        responseWindowOpen: true,
      };

      const engineContext = createEngineContext();
      const pressureReceipt = resolveSituatedPressure({
        proposal: pressureProposal,
        currentContext: engineContext,
        preThreads: [],
        currentTurn: 8,
        blueprint,
      });

      expect(pressureReceipt.outcome).toBe('ACCEPTED');
      expect(pressureReceipt.admittedManifestation).toBe(false);
      expect(pressureReceipt.acceptedThreadId).toBe('prop-pres-ledger-confrontation');
      expect(pressureReceipt.postState).toHaveLength(1);
      expect(pressureReceipt.postState[0].id).toBe('prop-pres-ledger-confrontation');
      expect(pressureReceipt.postState[0].status).toBe('OPEN');
      expect(pressureReceipt.boundedOutChangeIds).toEqual([]);
    });

    it('subsequent discovery drives pressure thread transition with boundedOutChangeIds enforcement', () => {
      const existingThread: SituatedPressureThread = {
        id: 'thr-8-anchor-paula-suspicion',
        valueAnchorId: 'anchor-paula-suspicion',
        holder: {
          kind: 'RELATIONSHIP',
          castMemberIds: ['char-paula-mercer', 'char-frank-mercer'],
        },
        sourceReference: 'BASELINE',
        operator: 'EXPOSE',
        affectedDimension: 'TRUST',
        adverseProspect: 'Paula will discover that Tommy has seen the hidden registration page.',
        manifestationSummary: null,
        status: 'OPEN',
        createdTurn: 8,
        lastChangedTurn: 8,
        persistenceTarget: 'PRESSURE_THREAD',
        authorityReferences: [],
      };

      const validCauses = ['cause-confrontation', 'BASELINE'];

      // Submit 3 transitions (cap is 2)
      const transitionProposal: PressureThreadTransitionProposal = {
        transitions: [
          {
            threadId: 'thr-8-anchor-paula-suspicion',
            proposedStatus: 'REALIZED',
            causeReference: 'cause-confrontation',
            rationale: 'Paula heard Tommy whisper about the page to Rosa',
          },
          {
            threadId: 'thr-extra-1',
            proposedStatus: 'RESOLVED',
            causeReference: 'cause-confrontation',
            rationale: 'Valid transition 2',
          },
          {
            threadId: 'thr-extra-2',
            proposedStatus: 'RELEASED',
            causeReference: 'cause-confrontation',
            rationale: 'Overflow transition 3',
          },
        ],
      };

      const receipt = resolvePressureThreadTransitions({
        proposal: transitionProposal,
        preThreads: [existingThread],
        currentTurn: 9,
        validCauses,
      });

      expect(receipt.decisions).toHaveLength(2);
      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.decisions[0].reasonCode).toBe('PRESSURE_TRANSITION_APPLIED');
      expect(receipt.postState[0].status).toBe('REALIZED');
      // Transition cap is 2; 3rd thread ID is bounded out
      expect(receipt.boundedOutChangeIds).toEqual(['thr-extra-2']);
    });

    it('reaching MAX_ACTIVE_PRESSURE_THREADS rejects further pressure proposals with boundedOutChangeIds', () => {
      const activeThreads: SituatedPressureThread[] = [
        {
          id: 'thr-1',
          valueAnchorId: 'anchor-paula-loyalty',
          holder: { kind: 'RELATIONSHIP', castMemberIds: ['char-paula-mercer', 'char-frank-mercer'] },
          sourceReference: 'BASELINE',
          operator: 'CONSTRAIN_ACCESS',
          affectedDimension: 'SAFETY',
          adverseProspect: 'Thread 1',
          manifestationSummary: null,
          status: 'OPEN',
          createdTurn: 1,
          lastChangedTurn: 1,
          persistenceTarget: 'PRESSURE_THREAD',
          authorityReferences: [],
        },
        {
          id: 'thr-2',
          valueAnchorId: 'anchor-paula-suspicion',
          holder: { kind: 'RELATIONSHIP', castMemberIds: ['char-paula-mercer', 'char-frank-mercer'] },
          sourceReference: 'BASELINE',
          operator: 'EXPOSE',
          affectedDimension: 'TRUST',
          adverseProspect: 'Thread 2',
          manifestationSummary: null,
          status: 'OPEN',
          createdTurn: 2,
          lastChangedTurn: 2,
          persistenceTarget: 'PRESSURE_THREAD',
          authorityReferences: [],
        },
        {
          id: 'thr-3',
          valueAnchorId: 'anchor-tommy-home',
          holder: { kind: 'CHARACTER', castMemberId: 'char-tommy-beck' },
          sourceReference: 'BASELINE',
          operator: 'CLOSE_DISTANCE',
          affectedDimension: 'FREEDOM',
          adverseProspect: 'Thread 3',
          manifestationSummary: null,
          status: 'OPEN',
          createdTurn: 3,
          lastChangedTurn: 3,
          persistenceTarget: 'PRESSURE_THREAD',
          authorityReferences: [],
        },
        {
          id: 'thr-4',
          valueAnchorId: 'anchor-safe-haven',
          holder: { kind: 'PLACE', nodeId: 'highway_edge' },
          sourceReference: 'BASELINE',
          operator: 'CONSTRAIN_ACCESS',
          affectedDimension: 'ACCESS',
          adverseProspect: 'Thread 4',
          manifestationSummary: null,
          status: 'OPEN',
          createdTurn: 4,
          lastChangedTurn: 4,
          persistenceTarget: 'PRESSURE_THREAD',
          authorityReferences: [],
        },
        {
          id: 'thr-5',
          valueAnchorId: 'anchor-eddie-rig',
          holder: { kind: 'CHARACTER', castMemberId: 'char-eddie-marsh' },
          sourceReference: 'BASELINE',
          operator: 'ACCELERATE',
          affectedDimension: 'TIME',
          adverseProspect: 'Thread 5',
          manifestationSummary: null,
          status: 'OPEN',
          createdTurn: 5,
          lastChangedTurn: 5,
          persistenceTarget: 'PRESSURE_THREAD',
          authorityReferences: [],
        },
      ];

      // Provide context with authoring baseline containing all 5 anchors plus the 6th overflow anchor
      const extraAnchors: import('../types/horrorGrammar').ValueAnchor[] = [
        {
          id: 'anchor-safe-haven',
          holder: { kind: 'PLACE', nodeId: 'highway_edge' },
          label: 'Safe Haven',
          description: 'Escape to the interstate',
          basisSummary: 'Highway route',
          provenance: { kind: 'CREATOR_DEFINED' },
        },
        {
          id: 'anchor-eddie-rig',
          holder: { kind: 'CHARACTER', castMemberId: 'char-eddie-marsh' },
          label: 'Eddie’s Rig',
          description: 'The diesel engine cooling in the lot',
          basisSummary: 'Last transport',
          provenance: { kind: 'CREATOR_DEFINED' },
        },
        {
          id: 'anchor-overflow',
          holder: { kind: 'SCENARIO' },
          label: 'Sanctuary Illusion',
          description: 'Belief that roadside motels are safe',
          basisSummary: 'Civilian expectation',
          provenance: { kind: 'CREATOR_DEFINED' },
        },
      ];
      const contextWithAnchors = createEngineContext(undefined, extraAnchors);

      const overflowProposal: SituatedPressureProposal = {
        kind: 'PRESSURE',
        proposalId: 'prop-pres-overflow',
        valueAnchorId: 'anchor-overflow',
        sourceReference: 'BASELINE',
        operator: 'ACCELERATE',
        affectedDimension: 'TIME',
        adverseProspect: 'Blizzard seals the room doors completely.',
        authorityReferences: [],
        persistenceTarget: 'PRESSURE_THREAD',
        responseWindowOpen: true,
      };

      const receipt = resolveSituatedPressure({
        proposal: overflowProposal,
        currentContext: contextWithAnchors,
        preThreads: activeThreads,
        currentTurn: 10,
        blueprint,
      });

      expect(receipt.outcome).toBe('REJECTED');
      expect(receipt.reasonCode).toBe('MAX_PRESSURE_THREADS_REACHED');
      expect(receipt.boundedOutChangeIds).toEqual(['prop-pres-overflow']);
    });
  });

  // ==========================================================================
  // Interaction 4: discovery × fear
  // ==========================================================================
  describe('4. Discovery × Fear — Horrific truth reveals triggering milestone phase shifts, somatic terror, capability impairments, and acoustic voice violations', () => {
    it('irreversible truth revelation satisfies discovery milestone, triggering macro-phase transition and catastrophic composure collapse', () => {
      // 1. Dramatic spine with DISCOVERY milestone
      const spine: DramaticSpine = {
        thematicPremise: 'The most dangerous predator is the one you invited in.',
        dramaticQuestions: ['Will Tommy survive the night?'],
        pacingProfile: 'SLOW_BURN_DREAD',
        milestoneConditions: [
          {
            id: 'milestone-harvesting-confirmed',
            targetPhase: 'INCITING_RUPTURE',
            description: 'The traveler confirms the motel is a slaughterhouse.',
            kind: 'DISCOVERY',
            referenceId: 'Bloodied bone saw in Room 4 crawlspace',
            satisfied: false,
          },
        ],
        impendingClocks: [],
      };

      const dramaturgyRuntime: DramaturgyRuntimeState = {
        currentMacroPhase: 'EXPOSITION_BASELINE',
        activePacingCadence: 'SIMMERING_DREAD',
        consecutiveTurnsInCadence: 3,
        impendingClocks: {},
        characterStakes: {},
        milestones: spine.milestoneConditions,
        receiptHistory: [],
        discoveredClueIds: [],
      };

      // 2. Execute pacing governor with the discovered clue
      const govResult = executePacingGovernor({
        runtimeState: dramaturgyRuntime,
        spine,
        playerRole: 'protagonist',
        turnNumber: 11,
        userAction: 'Search the Room 4 crawlspace',
        currentNodeId: 'room_7',
        fictionalTimeMarker: 'turn-11-23:45',
        discoveredClueIds: ['Bloodied bone saw in Room 4 crawlspace'],
      });

      expect(govResult.nextRuntimeState.currentMacroPhase).toBe('INCITING_RUPTURE');
      expect(govResult.receipt.transitions).toHaveLength(1);
      expect(govResult.receipt.transitions[0]).toEqual({
        from: 'EXPOSITION_BASELINE',
        to: 'INCITING_RUPTURE',
        cause: 'Discovered required clue: Bloodied bone saw in Room 4 crawlspace (The traveler confirms the motel is a slaughterhouse.)',
      });
      expect(govResult.nextRuntimeState.discoveredClueIds).toContain(
        'Bloodied bone saw in Room 4 crawlspace'
      );

      // 3. Composure collapse from discovery shock
      const shockEvents = [
        {
          domain: 'PSYCHOLOGICAL_STATUS',
          severity: 25,
        },
        {
          domain: 'SOMATIC',
          severity: 15,
        },
        {
          tags: ['horror', 'rupture', 'mutilation', 'terror'],
        },
      ];
      const delta = calculateComposureDelta(shockEvents, 1.0);
      expect(delta).toBeLessThanOrEqual(-45);

      const shatteredComposure = Math.max(0, 75 + delta);
      expect(shatteredComposure).toBeLessThanOrEqual(30);
      expect(deriveComposureBand(shatteredComposure)).toBe('FRACTURED');
      expect(derivePsychologicalStatus(shatteredComposure)).toBe('PANICKED');

      // 4. Somatic salience ratchets past preyEnterThreshold into preyMode
      const fearContract: FearContract = {
        fearlessness: {},
        mortalityBelief: {},
        threatWeights: { life: 1.0, freedom: 1.0, identity: 1.0 },
        lambdaDecay: 0.35,
        residueRatio: 0.25,
        preyEnterThreshold: 0.70,
        preyExitThreshold: 0.40,
        somaticBands: { band1: 0.25, band2: 0.50, band3: 0.75, band4: 0.90 },
        releaseValves: [],
        villainGazeAuthorized: false,
        submitResponse: {},
      };

      const salience = computeCharacterSalience(
        {
          spike: 0.2,
          dread: 0.3,
          threatType: 'life',
          provenance: [],
          preyMode: false,
        },
        [
          {
            eventId: 'ev-saw-discovery',
            kind: 'threat-event',
            spikeDelta: 0.6,
            dreadDelta: 0.45,
            threatType: 'life',
            turn: 11,
          },
        ],
        fearContract
      );

      expect(salience.dread).toBeGreaterThanOrEqual(0.70);
      expect(salience.preyMode).toBe(true);
    });

    it('somatic terror collapse impairs vocal and physical capabilities, gating canAttempt across vocal and locomotion verbs', () => {
      // Acute fear induces vocal choking (VOCAL_FULL impaired) and locomotion paralysis (LOCOMOTION_RAPID impaired)
      const impairedContext = createAttemptContext({
        capabilities: {
          'char-tommy-beck': {
            impairedCapabilities: ['VOCAL_FULL', 'LOCOMOTION_RAPID'],
            provenance: ['Terror paralysis and constriction of throat'],
          },
        },
      });

      // 1. Full-voice action (SHOUT) denied with VOCAL_FULL impaired slot
      const shoutResult = canAttempt(
        'char-tommy-beck',
        'SHOUT',
        'office',
        impairedContext
      );
      expect(shoutResult.allowed).toBe(false);
      expect(shoutResult.reasonCode).toBe('CAPABILITY_IMPAIRED');
      expect(shoutResult.impairedSlot).toBe('VOCAL_FULL');

      // 2. Full-voice action (CALL) denied with VOCAL_FULL impaired slot
      const callResult = canAttempt(
        'char-tommy-beck',
        'CALL',
        'char-rosa-delgado',
        impairedContext
      );
      expect(callResult.allowed).toBe(false);
      expect(callResult.reasonCode).toBe('CAPABILITY_IMPAIRED');
      expect(callResult.impairedSlot).toBe('VOCAL_FULL');

      // 3. Spoken speech verb (PARLEY without whisper delivery) denied with VOCAL_FULL impaired slot
      const parleySpokenResult = canAttempt(
        'char-tommy-beck',
        'PARLEY',
        'char-frank-mercer',
        impairedContext,
        'spoken'
      );
      expect(parleySpokenResult.allowed).toBe(false);
      expect(parleySpokenResult.reasonCode).toBe('CAPABILITY_IMPAIRED');
      expect(parleySpokenResult.impairedSlot).toBe('VOCAL_FULL');

      // 4. Whispered speech (WHISPER verb) is allowed because VOCAL_WHISPER is NOT impaired
      const whisperResult = canAttempt(
        'char-tommy-beck',
        'WHISPER',
        'char-rosa-delgado',
        impairedContext
      );
      expect(whisperResult.allowed).toBe(true);
      expect(whisperResult.reasonCode).toBe('ALLOWED');

      // 5. General speech with whisper delivery is allowed
      const parleyWhisperResult = canAttempt(
        'char-tommy-beck',
        'WARN',
        'char-rosa-delgado',
        impairedContext,
        'whisper'
      );
      expect(parleyWhisperResult.allowed).toBe(true);
      expect(parleyWhisperResult.reasonCode).toBe('ALLOWED');

      // 6. Rapid locomotion (FLEE) denied with LOCOMOTION_RAPID impaired slot
      const fleeResult = canAttempt(
        'char-tommy-beck',
        'FLEE',
        'parking_lot',
        impairedContext
      );
      expect(fleeResult.allowed).toBe(false);
      expect(fleeResult.reasonCode).toBe('CAPABILITY_IMPAIRED');
      expect(fleeResult.impairedSlot).toBe('LOCOMOTION_RAPID');
    });

    it('acoustic audience routing and scanTurnForVoiceViolations strictly audit vocal violations and unhearable responses', () => {
      const topology: LocationTopology = {
        nodes: ['room_6', 'parking_lot', 'office'],
        connections: [
          // room_6 <-> parking_lot (exterior door, acousticBleed false when storm door closed)
          {
            from: 'room_6',
            to: 'parking_lot',
            kind: 'door',
            status: 'OPEN',
            acousticBleed: false,
          },
          // parking_lot <-> office (office door with acoustic bleed)
          {
            from: 'parking_lot',
            to: 'office',
            kind: 'door',
            status: 'OPEN',
            acousticBleed: true,
          },
        ],
      };

      const characterNodes = {
        'char-tommy-beck': 'room_6',
        'char-rosa-delgado': 'room_6',
        'char-eddie-marsh': 'parking_lot',
        'char-frank-mercer': 'office',
      };

      // 1. Acoustic audience routing verification
      // A direct whisper in room_6 only reaches co-located occupants
      const whisperAudience = resolveAcousticAudience(
        'direct' as AcousticMedium,
        topology,
        'room_6',
        characterNodes,
        'whisper' as VocalDelivery
      );
      expect(whisperAudience).toEqual(['char-rosa-delgado', 'char-tommy-beck']);

      // A direct shout in room_6 reaches room_6 and adjacent parking_lot
      const shoutAudience = resolveAcousticAudience(
        'direct' as AcousticMedium,
        topology,
        'room_6',
        characterNodes,
        'shout' as VocalDelivery
      );
      expect(shoutAudience).toContain('char-rosa-delgado');
      expect(shoutAudience).toContain('char-tommy-beck');
      expect(shoutAudience).toContain('char-eddie-marsh');
      // Non-adjacent distance=2 office excluded
      expect(shoutAudience).not.toContain('char-frank-mercer');

      // 2. scanTurnForVoiceViolations audit
      // Violation Case A: Character with VOCAL_FULL impaired delivers full-voice 'shout'
      const impairedShoutNarrative: Array<Record<string, unknown>> = [
        {
          type: 'dialogue',
          speaker: 'char-tommy-beck',
          delivery: 'shout',
          medium: 'direct',
          content: 'Rosa, run!',
        },
      ];

      const impairedViolations = scanTurnForVoiceViolations({
        turnNumber: 12,
        narrativeBlocks: impairedShoutNarrative,
        capabilities: {
          'char-tommy-beck': {
            impairedCapabilities: ['VOCAL_FULL'],
          },
        },
        topology,
        characterNodes,
      });

      expect(impairedViolations).toHaveLength(1);
      const violation1 = impairedViolations[0];
      expect(violation1.characterId).toBe('char-tommy-beck');
      expect(violation1.violatedRule).toBe('VOCAL_FULL');
      expect(violation1.impairedSlot).toBe('VOCAL_FULL');
      expect(violation1.evidence).toContain('VOCAL_FULL capability is impaired');
      expect(() => VoiceViolationReceiptSchema.parse(violation1)).not.toThrow();

      // Violation Case B: Whisper delivered in room_6 is addressed or reacted to by Frank in office (distance 2, unhearable)
      const routingViolationNarrative: Array<Record<string, unknown>> = [
        {
          type: 'dialogue',
          speaker: 'char-tommy-beck',
          delivery: 'whisper',
          medium: 'direct',
          addressedCharacterId: 'char-frank-mercer',
          content: 'We need to stay quiet.',
        },
      ];

      const routingViolations = scanTurnForVoiceViolations({
        turnNumber: 13,
        narrativeBlocks: routingViolationNarrative,
        capabilities: {
          'char-tommy-beck': { impairedCapabilities: [] },
        },
        topology,
        characterNodes,
      });

      expect(routingViolations).toHaveLength(1);
      const violation2 = routingViolations[0];
      expect(violation2.characterId).toBe('char-frank-mercer');
      expect(violation2.violatedRule).toBe('UNHEARABLE_AUDIENCE_ROUTING');
      expect(() => VoiceViolationReceiptSchema.parse(violation2)).not.toThrow();

      // Compliant Case C: Valid whisper delivered to co-located Rosa produces ZERO violations
      const compliantNarrative: Array<Record<string, unknown>> = [
        {
          type: 'dialogue',
          speaker: 'char-tommy-beck',
          delivery: 'whisper',
          medium: 'direct',
          addressedCharacterId: 'char-rosa-delgado',
          content: 'Rosa, don’t look out that window.',
        },
      ];

      const cleanViolations = scanTurnForVoiceViolations({
        turnNumber: 14,
        narrativeBlocks: compliantNarrative,
        capabilities: {
          'char-tommy-beck': { impairedCapabilities: ['VOCAL_FULL'] },
        },
        topology,
        characterNodes,
      });

      expect(cleanViolations).toEqual([]);
    });
  });
});
