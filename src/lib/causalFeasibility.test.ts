import { describe, expect, it } from 'vitest';
import type {
  EngineTurnContext,
  IntentReceipt,
  TransitionReceipt,
} from '../types/engineContract';
import {
  evaluateCausalFeasibility,
  resolveExplicitCastTarget,
  extractConversationalUtterance,
  type CastTargetResolution,
} from './causalFeasibility';

function createMockContext(overrides?: Partial<EngineTurnContext>): EngineTurnContext {
  return {
    version: 1,
    scenario: {
      id: 'scen-001',
      title: 'Test Environment',
      premise: 'Test Premise',
      worldRules: [],
      setting: {
        location: 'Sector 01',
        atmosphere: 'Calm',
        timePeriod: 'Present',
      },
      startingVector: 'COGNITIVE',
      startingTier: 'LATENT',
      incitingIncident: 'None',
      pacingDirective: 'Standard',
      keyPlotElements: [],
    },
    player: {
      role: 'protagonist',
      characterId: 'char-player',
      name: 'Player Lead',
      description: 'Test Player',
      isEntity: false,
    },
    cast: [
      {
        id: 'char-001',
        name: 'Alpha Beta',
        role: 'Subject',
        description: 'Test Cast 1',
        personality: 'Direct',
        goals: 'None',
        traits: [],
        isEntity: false,
        isUserCharacter: false,
        skepticism: 0.5,
        isPresent: true,
        stance: null,
        memory: [],
      },
      {
        id: 'char-002',
        name: 'Gamma Delta',
        role: 'Subject',
        description: 'Test Cast 2',
        personality: 'Observant',
        goals: 'None',
        traits: [],
        isEntity: false,
        isUserCharacter: false,
        skepticism: 0.5,
        isPresent: false,
        stance: null,
        memory: [],
      },
      {
        id: 'char-003',
        name: 'Theta Iota',
        role: 'Subject',
        description: 'Test Cast 3',
        personality: 'Quiet',
        goals: 'None',
        traits: [],
        isEntity: false,
        isUserCharacter: false,
        expressionProfile: {
          communicationModes: ['nonverbal'],
          expressionGuidance: 'Communicates only through gestures',
        },
        skepticism: 0.5,
        isPresent: true,
        stance: null,
        memory: [],
      },
      {
        id: 'char-player',
        name: 'Player Lead',
        role: 'Subject',
        description: 'Player Character in Cast',
        personality: 'Neutral',
        goals: 'None',
        traits: [],
        isEntity: false,
        isUserCharacter: true,
        skepticism: 0.5,
        isPresent: true,
        stance: null,
        memory: [],
      },
    ],
    topology: {
      currentNodeId: 'node-001',
      readableNodeLabel: 'Chamber 1',
      allowedOutgoingExits: [
        {
          from: 'node-001',
          to: 'node-002',
          kind: 'PHYSICAL',
          userInitiated: true,
        },
      ],
    },
    runtime: {
      phase: 'LATENT',
      tension: 0,
      coherence: 1.0,
      reconciliationRevision: 0,
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      activeFlags: [],
      turnNumber: 0,
    },
    consequenceState: {
      inventory: [],
      player_injuries: [],
      psychological_status: 'STABLE',
    },
    relationshipState: [],
    memoryState: {},
    worldMemory: [],
    ...overrides,
  };
}

function createMockIntent(overrides?: Partial<IntentReceipt>): IntentReceipt {
  return {
    version: 1,
    action_kind: 'OBSERVE',
    action_subtype: null,
    pressure_direction: 'MAINTAIN',
    dramatic_tactic: 'NONE',
    intent_synergy: 'N/A',
    ...overrides,
  };
}

function createMockTransition(overrides?: Partial<TransitionReceipt>): TransitionReceipt {
  return {
    requestedNodeId: null,
    accepted: false,
    fromNodeId: 'node-001',
    toNodeId: 'node-001',
    reason: undefined,
    ...overrides,
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const prop = (obj as Record<string, unknown>)[key];
    if (prop && typeof prop === 'object' && !Object.isFrozen(prop)) {
      deepFreeze(prop);
    }
  }
  return obj;
}

describe('Phase 3G.2A: Causal Feasibility Contracts', () => {
  describe('1. resolveExplicitCastTarget', () => {
    it('1. matches exact full-name case-insensitively and with punctuation', () => {
      const context = createMockContext();
      const action = 'I look at "Alpha Beta", asking for assistance!';
      const result = resolveExplicitCastTarget(action, context);

      expect(result).toEqual({
        status: 'PRESENT_ELIGIBLE',
        characterId: 'char-001',
      });
    });

    it('2. returns NONE for first-name-only or substring mentions', () => {
      const context = createMockContext();

      // First name only
      const firstNameOnly = resolveExplicitCastTarget('I speak with Alpha today.', context);
      expect(firstNameOnly).toEqual({
        status: 'NONE',
        characterId: null,
      });

      // Substring within a word
      const substringAction = resolveExplicitCastTarget('I inspect the Alphabetical index.', context);
      expect(substringAction).toEqual({
        status: 'NONE',
        characterId: null,
      });
    });

    it('3. returns AMBIGUOUS when multiple non-player cast full names match', () => {
      const context = createMockContext({
        cast: [
          {
            id: 'char-010',
            name: 'Kappa Lambda',
            role: 'Subject',
            description: '',
            personality: '',
            goals: '',
            traits: [],
            isEntity: false,
            isUserCharacter: false,
            skepticism: 0.5,
            isPresent: true,
            stance: null,
            memory: [],
          },
          {
            id: 'char-011',
            name: 'Kappa Lambda',
            role: 'Subject',
            description: '',
            personality: '',
            goals: '',
            traits: [],
            isEntity: false,
            isUserCharacter: false,
            skepticism: 0.5,
            isPresent: true,
            stance: null,
            memory: [],
          },
        ],
      });

      const duplicateNameResult = resolveExplicitCastTarget(
        'I call out to Kappa Lambda.',
        context
      );
      expect(duplicateNameResult).toEqual({
        status: 'AMBIGUOUS',
        characterId: null,
      });

      // Also when two different cast members are named in the same action
      const multiCastContext = createMockContext();
      const multiMatchResult = resolveExplicitCastTarget(
        'I speak to Alpha Beta and Gamma Delta together.',
        multiCastContext
      );
      expect(multiMatchResult).toEqual({
        status: 'AMBIGUOUS',
        characterId: null,
      });
    });

    it('4. returns ABSENT with characterId when target is not present', () => {
      const context = createMockContext();
      const action = 'I search for Gamma Delta.';
      const result = resolveExplicitCastTarget(action, context);

      expect(result).toEqual({
        status: 'ABSENT',
        characterId: 'char-002',
      });
    });

    it('5. returns INELIGIBLE with characterId when target is present but lacks spoken/mediated communication', () => {
      const context = createMockContext();
      const action = 'I try to talk to Theta Iota.';
      const result = resolveExplicitCastTarget(action, context);

      expect(result).toEqual({
        status: 'INELIGIBLE',
        characterId: 'char-003',
      });
    });

    it('6. returns PRESENT_ELIGIBLE with characterId when target is present and dialogue-eligible', () => {
      const context = createMockContext();
      const action = 'I ask Alpha Beta about the corridor.';
      const result = resolveExplicitCastTarget(action, context);

      expect(result).toEqual({
        status: 'PRESENT_ELIGIBLE',
        characterId: 'char-001',
      });
    });

    it('excludes player-controlled characters from candidate resolution', () => {
      const context = createMockContext();
      const action = 'I speak to Player Lead.';
      const result = resolveExplicitCastTarget(action, context);

      expect(result).toEqual({
        status: 'NONE',
        characterId: null,
      });
    });
  });

  describe('2. evaluateCausalFeasibility', () => {
    it('7. returns SUPPORTED / NONE and suppressStructuralDeltas: false for accepted MOVE', () => {
      const context = createMockContext();
      const intent = createMockIntent({ action_kind: 'MOVE' });
      const transition = createMockTransition({
        requestedNodeId: 'node-002',
        accepted: true,
        toNodeId: 'node-002',
      });
      const castTarget: CastTargetResolution = { status: 'NONE', characterId: null };

      const result = evaluateCausalFeasibility({
        intentReceipt: intent,
        context,
        transitionReceipt: transition,
        castTarget,
      });

      expect(result).toEqual({
        feasibility: 'SUPPORTED',
        reason_code: 'NONE',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });
    });

    it('8. returns CONSTRAINED / TOPOLOGY_LIMIT and suppressStructuralDeltas: false for rejected MOVE with concrete target', () => {
      const context = createMockContext();
      const intent = createMockIntent({ action_kind: 'MOVE' });
      const transition = createMockTransition({
        requestedNodeId: 'node-999',
        accepted: false,
        toNodeId: 'node-001',
      });
      const castTarget: CastTargetResolution = { status: 'NONE', characterId: null };

      const result = evaluateCausalFeasibility({
        intentReceipt: intent,
        context,
        transitionReceipt: transition,
        castTarget,
      });

      expect(result).toEqual({
        feasibility: 'CONSTRAINED',
        reason_code: 'TOPOLOGY_LIMIT',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });
    });

    it('9. returns UNCLEAR / NONE and suppressStructuralDeltas: false for MOVE with no concrete requested node', () => {
      const context = createMockContext();
      const intent = createMockIntent({ action_kind: 'MOVE' });
      const transition = createMockTransition({
        requestedNodeId: null,
        accepted: false,
        toNodeId: 'node-001',
      });
      const castTarget: CastTargetResolution = { status: 'NONE', characterId: null };

      const result = evaluateCausalFeasibility({
        intentReceipt: intent,
        context,
        transitionReceipt: transition,
        castTarget,
      });

      expect(result).toEqual({
        feasibility: 'UNCLEAR',
        reason_code: 'NONE',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });
    });

    it('10. covers COMMUNICATE across all five target statuses according to precedence', () => {
      const context = createMockContext();
      const intent = createMockIntent({ action_kind: 'COMMUNICATE' });
      const transition = createMockTransition();

      // ABSENT -> IMPOSSIBLE / CAST_PRESENCE_LIMIT / suppressStructuralDeltas: true
      const absentRes = evaluateCausalFeasibility({
        intentReceipt: intent,
        context,
        transitionReceipt: transition,
        castTarget: { status: 'ABSENT', characterId: 'char-002' },
      });
      expect(absentRes).toEqual({
        feasibility: 'IMPOSSIBLE',
        reason_code: 'CAST_PRESENCE_LIMIT',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: true,
      });

      // INELIGIBLE -> IMPOSSIBLE / CAST_PRESENCE_LIMIT / suppressStructuralDeltas: true
      const ineligibleRes = evaluateCausalFeasibility({
        intentReceipt: intent,
        context,
        transitionReceipt: transition,
        castTarget: { status: 'INELIGIBLE', characterId: 'char-003' },
      });
      expect(ineligibleRes).toEqual({
        feasibility: 'IMPOSSIBLE',
        reason_code: 'CAST_PRESENCE_LIMIT',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: true,
      });

      // PRESENT_ELIGIBLE -> SUPPORTED / NONE / suppressStructuralDeltas: false
      const presentEligibleRes = evaluateCausalFeasibility({
        intentReceipt: intent,
        context,
        transitionReceipt: transition,
        castTarget: { status: 'PRESENT_ELIGIBLE', characterId: 'char-001' },
      });
      expect(presentEligibleRes).toEqual({
        feasibility: 'SUPPORTED',
        reason_code: 'NONE',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });

      // NONE -> UNCLEAR / NONE / suppressStructuralDeltas: false
      const noneRes = evaluateCausalFeasibility({
        intentReceipt: intent,
        context,
        transitionReceipt: transition,
        castTarget: { status: 'NONE', characterId: null },
      });
      expect(noneRes).toEqual({
        feasibility: 'UNCLEAR',
        reason_code: 'NONE',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });

      // AMBIGUOUS -> UNCLEAR / NONE / suppressStructuralDeltas: false
      const ambiguousRes = evaluateCausalFeasibility({
        intentReceipt: intent,
        context,
        transitionReceipt: transition,
        castTarget: { status: 'AMBIGUOUS', characterId: null },
      });
      expect(ambiguousRes).toEqual({
        feasibility: 'UNCLEAR',
        reason_code: 'NONE',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });
    });

    it('11. returns UNCLEAR / NONE for all other action kinds, and SUPPORTED / NONE for SYSTEM', () => {
      const context = createMockContext();
      const transition = createMockTransition();
      const castTarget: CastTargetResolution = { status: 'NONE', characterId: null };

      const otherActionKinds = [
        'OBSERVE',
        'INVESTIGATE',
        'MANIPULATE',
        'WAIT',
        'OTHER',
      ] as const;

      for (const kind of otherActionKinds) {
        const intent = createMockIntent({ action_kind: kind });
        const res = evaluateCausalFeasibility({
          intentReceipt: intent,
          context,
          transitionReceipt: transition,
          castTarget,
        });

        expect(res).toEqual({
          feasibility: 'UNCLEAR',
          reason_code: 'NONE',
          authority_alignment: 'NOT_APPLICABLE',
          suppressStructuralDeltas: false,
        });
      }

      // SYSTEM action
      const systemIntent = createMockIntent({ action_kind: 'SYSTEM' });
      const systemRes = evaluateCausalFeasibility({
        intentReceipt: systemIntent,
        context,
        transitionReceipt: transition,
        castTarget,
      });
      expect(systemRes).toEqual({
        feasibility: 'SUPPORTED',
        reason_code: 'NONE',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });
    });

    it('12. assigns NOT_APPLICABLE for non-Antagonist and UNCLEAR for Antagonist (except SYSTEM)', () => {
      const transition = createMockTransition();
      const castTarget: CastTargetResolution = { status: 'NONE', characterId: null };
      const intent = createMockIntent({ action_kind: 'OTHER' });

      // Non-antagonist roles
      const roles = ['protagonist', 'director', 'witness', 'possessed'] as const;
      for (const role of roles) {
        const context = createMockContext({
          player: {
            role,
            characterId: 'char-player',
            name: 'Player',
            description: '',
            isEntity: false,
          },
        });
        const res = evaluateCausalFeasibility({
          intentReceipt: intent,
          context,
          transitionReceipt: transition,
          castTarget,
        });
        expect(res.authority_alignment).toBe('NOT_APPLICABLE');
      }

      // Antagonist via player.role
      const antagonistContext = createMockContext({
        player: {
          role: 'antagonist',
          characterId: 'char-player',
          name: 'Player',
          description: '',
          isEntity: false,
        },
      });
      const antagonistRes = evaluateCausalFeasibility({
        intentReceipt: intent,
        context: antagonistContext,
        transitionReceipt: transition,
        castTarget,
      });
      expect(antagonistRes.authority_alignment).toBe('UNCLEAR');

      // Antagonist via participationContext.mode
      const participationContext = createMockContext({
        player: {
          role: 'protagonist',
          characterId: 'char-player',
          name: 'Player',
          description: '',
          isEntity: false,
        },
        participationContext: {
          mode: 'antagonist',
          initialGoal: 'Test Goal',
          boundedFacts: [],
          authorityContract: {
            authority: 'Test Authority',
            limits: 'Test Limits',
          },
          victimField: {
            kind: 'individual',
            name: 'Target One',
          },
        },
      });
      const participationRes = evaluateCausalFeasibility({
        intentReceipt: intent,
        context: participationContext,
        transitionReceipt: transition,
        castTarget,
      });
      expect(participationRes.authority_alignment).toBe('UNCLEAR');

      // SYSTEM action is always NOT_APPLICABLE even for antagonist
      const systemIntent = createMockIntent({ action_kind: 'SYSTEM' });
      const systemAntagonistRes = evaluateCausalFeasibility({
        intentReceipt: systemIntent,
        context: antagonistContext,
        transitionReceipt: transition,
        castTarget,
      });
      expect(systemAntagonistRes.authority_alignment).toBe('NOT_APPLICABLE');
    });

    it('13. does not mutate input objects (verified with deep-frozen fixtures)', () => {
      const rawContext = createMockContext();
      const rawIntent = createMockIntent({ action_kind: 'MOVE' });
      const rawTransition = createMockTransition({
        requestedNodeId: 'node-999',
        accepted: false,
      });
      const rawCastTarget: CastTargetResolution = {
        status: 'ABSENT',
        characterId: 'char-002',
      };

      const frozenContext = deepFreeze(JSON.parse(JSON.stringify(rawContext)));
      const frozenIntent = deepFreeze(JSON.parse(JSON.stringify(rawIntent)));
      const frozenTransition = deepFreeze(JSON.parse(JSON.stringify(rawTransition)));
      const frozenCastTarget = deepFreeze(JSON.parse(JSON.stringify(rawCastTarget)));

      // Call resolveExplicitCastTarget with frozen context
      const castResult = resolveExplicitCastTarget(
        'I speak to Alpha Beta.',
        frozenContext
      );
      expect(castResult.status).toBe('PRESENT_ELIGIBLE');

      // Call evaluateCausalFeasibility with all frozen inputs
      const evalResult = evaluateCausalFeasibility({
        intentReceipt: frozenIntent,
        context: frozenContext,
        transitionReceipt: frozenTransition,
        castTarget: frozenCastTarget,
      });

      expect(evalResult).toEqual({
        feasibility: 'CONSTRAINED',
        reason_code: 'TOPOLOGY_LIMIT',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });

      // Deep equality check against raw original values
      expect(frozenContext).toEqual(rawContext);
      expect(frozenIntent).toEqual(rawIntent);
      expect(frozenTransition).toEqual(rawTransition);
      expect(frozenCastTarget).toEqual(rawCastTarget);
    });

    describe('Packet 1E-2 Mixed-Intent Spatial Ratification and Authority Limits', () => {
      it('14. accepts valid spatial transition for non-MOVE primary actions (OBSERVE, INVESTIGATE, MANIPULATE, WAIT, OTHER)', () => {
        const context = createMockContext();
        const acceptedTransition = createMockTransition({
          requestedNodeId: 'node-002',
          accepted: true,
          fromNodeId: 'node-001',
          toNodeId: 'node-002',
        });
        const nonMoveKinds: IntentReceipt['action_kind'][] = [
          'OBSERVE',
          'INVESTIGATE',
          'MANIPULATE',
          'WAIT',
          'OTHER',
        ];

        for (const action_kind of nonMoveKinds) {
          const intent = createMockIntent({ action_kind });
          const res = evaluateCausalFeasibility({
            intentReceipt: intent,
            context,
            transitionReceipt: acceptedTransition,
            castTarget: { status: 'NONE', characterId: null },
          });

          expect(res).toEqual({
            feasibility: 'SUPPORTED',
            reason_code: 'NONE',
            authority_alignment: 'NOT_APPLICABLE',
            suppressStructuralDeltas: false,
          });
        }
      });

      it('15. rejects invalid spatial transition for non-MOVE actions with TOPOLOGY_LIMIT', () => {
        const context = createMockContext();
        const rejectedTransition = createMockTransition({
          requestedNodeId: 'node-unknown',
          accepted: false,
          fromNodeId: 'node-001',
          toNodeId: 'node-001',
        });
        const nonMoveKinds: IntentReceipt['action_kind'][] = [
          'COMMUNICATE',
          'OBSERVE',
          'INVESTIGATE',
          'MANIPULATE',
          'WAIT',
          'OTHER',
        ];

        for (const action_kind of nonMoveKinds) {
          const intent = createMockIntent({ action_kind });
          const res = evaluateCausalFeasibility({
            intentReceipt: intent,
            context,
            transitionReceipt: rejectedTransition,
            castTarget: { status: 'NONE', characterId: null },
          });

          expect(res).toEqual({
            feasibility: 'CONSTRAINED',
            reason_code: 'TOPOLOGY_LIMIT',
            authority_alignment: 'NOT_APPLICABLE',
            suppressStructuralDeltas: false,
          });
        }
      });

      it('16. non-embodied roles (director, witness) proposing movement produce CONSTRAINED / AUTHORITY_LIMIT', () => {
        const acceptedTransition = createMockTransition({
          requestedNodeId: 'node-002',
          accepted: true,
        });

        for (const role of ['director', 'witness'] as const) {
          const context = createMockContext({
            player: {
              role,
              characterId: 'char-player',
              name: 'Observer',
              description: '',
              isEntity: false,
            },
          });
          const intent = createMockIntent({ action_kind: 'MOVE' });
          const res = evaluateCausalFeasibility({
            intentReceipt: intent,
            context,
            transitionReceipt: acceptedTransition,
            castTarget: { status: 'NONE', characterId: null },
          });

          expect(res).toEqual({
            feasibility: 'CONSTRAINED',
            reason_code: 'AUTHORITY_LIMIT',
            authority_alignment: 'NOT_APPLICABLE',
            suppressStructuralDeltas: true,
          });
        }
      });

      it('17. COMMUNICATE with absent speaker fails with CAST_PRESENCE_LIMIT even if transition is accepted', () => {
        const context = createMockContext();
        const acceptedTransition = createMockTransition({
          requestedNodeId: 'node-002',
          accepted: true,
        });
        const commIntent = createMockIntent({ action_kind: 'COMMUNICATE' });
        const res = evaluateCausalFeasibility({
          intentReceipt: commIntent,
          context,
          transitionReceipt: acceptedTransition,
          castTarget: { status: 'ABSENT', characterId: 'char-002' },
        });

        expect(res).toEqual({
          feasibility: 'IMPOSSIBLE',
          reason_code: 'CAST_PRESENCE_LIMIT',
          authority_alignment: 'NOT_APPLICABLE',
          suppressStructuralDeltas: true,
        });
      });

      it('18. COMMUNICATE with present speaker and accepted transition produces SUPPORTED / NONE', () => {
        const context = createMockContext();
        const acceptedTransition = createMockTransition({
          requestedNodeId: 'node-002',
          accepted: true,
        });
        const commIntent = createMockIntent({ action_kind: 'COMMUNICATE' });
        const res = evaluateCausalFeasibility({
          intentReceipt: commIntent,
          context,
          transitionReceipt: acceptedTransition,
          castTarget: { status: 'PRESENT_ELIGIBLE', characterId: 'char-001' },
        });

        expect(res).toEqual({
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          authority_alignment: 'NOT_APPLICABLE',
          suppressStructuralDeltas: false,
        });
      });

      it('19. resolveExplicitCastTarget returns REMOTE_ELIGIBLE when calling absent character via phone', () => {
        const context = createMockContext();
        // char-002 is Gamma Delta (absent) in mock context
        const userAction = 'Call Gamma Delta on the Nokia phone to see where they are.';
        const target = resolveExplicitCastTarget(userAction, context);

        expect(target).toEqual({
          status: 'REMOTE_ELIGIBLE',
          characterId: 'char-002',
        });
      });

      it('20. COMMUNICATE with REMOTE_ELIGIBLE produces SUPPORTED / NONE and suppressStructuralDeltas: false', () => {
        const context = createMockContext();
        const commIntent = createMockIntent({ action_kind: 'COMMUNICATE' });
        const transition = createMockTransition();
        const res = evaluateCausalFeasibility({
          intentReceipt: commIntent,
          context,
          transitionReceipt: transition,
          castTarget: { status: 'REMOTE_ELIGIBLE', characterId: 'char-002' },
        });

        expect(res).toEqual({
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          authority_alignment: 'NOT_APPLICABLE',
          suppressStructuralDeltas: false,
        });
      });

      it('21. resolveExplicitCastTarget returns REMOTE_ELIGIBLE for inflected verbs (called, dialed, radioed, texted)', () => {
        const context = createMockContext();
        expect(resolveExplicitCastTarget('I called Gamma Delta immediately.', context).status).toBe('REMOTE_ELIGIBLE');
        expect(resolveExplicitCastTarget('I dialed Gamma Delta on the console.', context).status).toBe('REMOTE_ELIGIBLE');
        expect(resolveExplicitCastTarget('I radioed Gamma Delta about the situation.', context).status).toBe('REMOTE_ELIGIBLE');
        expect(resolveExplicitCastTarget('I texted Gamma Delta the new code.', context).status).toBe('REMOTE_ELIGIBLE');
      });

      it('22. resolveExplicitCastTarget returns REMOTE_ELIGIBLE for headsets, commlinks, and speakerphones', () => {
        const context = createMockContext();
        expect(resolveExplicitCastTarget('I speak into my headset to Gamma Delta.', context).status).toBe('REMOTE_ELIGIBLE');
        expect(resolveExplicitCastTarget('I patch Gamma Delta into the commlink.', context).status).toBe('REMOTE_ELIGIBLE');
        expect(resolveExplicitCastTarget('I hail Gamma Delta over the speakerphone.', context).status).toBe('REMOTE_ELIGIBLE');
      });
    });

    describe('embodied villain authority alignment (D3)', () => {
      const transition = createMockTransition();
      const castTarget: CastTargetResolution = { status: 'NONE', characterId: null };

      function createEmbodiedVillainContext(overrides: Partial<EngineTurnContext> = {}): EngineTurnContext {
        return createMockContext({
          player: {
            role: 'antagonist',
            characterId: 'char-villain',
            name: 'Warden One',
            description: 'Enforcing warden',
            isEntity: false,
          },
          participationContext: {
            mode: 'antagonist',
            seat: { kind: 'character', name: 'Warden One' },
            initialGoal: 'Subdue target',
            boundedFacts: [],
            authorityContract: {
              authority: 'Physical manipulation and surveillance',
              limits: 'Cannot modify global geometry',
            },
            victimField: {
              kind: 'individual',
              name: 'Subject Alpha',
            },
          },
          cast: [
            {
              id: 'char-villain',
              name: 'Warden One',
              role: 'Warden',
              description: 'Enforcing warden',
              personality: '',
              goals: '',
              traits: [],
              isEntity: false,
              isUserCharacter: true,
              skepticism: 0.5,
              isPresent: true,
              stance: null,
              memory: [],
            },
          ],
          ...overrides,
        });
      }

      it('villain + MANIPULATE + embodied seat -> authority_alignment === WITHIN_CONTRACT', () => {
        const context = createEmbodiedVillainContext();
        const intent = createMockIntent({ action_kind: 'MANIPULATE' });
        const res = evaluateCausalFeasibility({
          intentReceipt: intent,
          context,
          transitionReceipt: transition,
          castTarget,
        });
        expect(res.authority_alignment).toBe('WITHIN_CONTRACT');
        expect(res.feasibility).toBe('SUPPORTED');
      });

      it('villain + COMMUNICATE + embodied -> WITHIN_CONTRACT', () => {
        const context = createEmbodiedVillainContext();
        const intent = createMockIntent({ action_kind: 'COMMUNICATE' });
        const res = evaluateCausalFeasibility({
          intentReceipt: intent,
          context,
          transitionReceipt: transition,
          castTarget,
        });
        expect(res.authority_alignment).toBe('WITHIN_CONTRACT');
      });

      it('villain + OBSERVE + embodied -> WITHIN_CONTRACT', () => {
        const context = createEmbodiedVillainContext();
        const intent = createMockIntent({ action_kind: 'OBSERVE' });
        const res = evaluateCausalFeasibility({
          intentReceipt: intent,
          context,
          transitionReceipt: transition,
          castTarget,
        });
        expect(res.authority_alignment).toBe('WITHIN_CONTRACT');
      });

      it('villain + OTHER + embodied -> authority_alignment === UNCLEAR', () => {
        const context = createEmbodiedVillainContext();
        const intent = createMockIntent({ action_kind: 'OTHER' });
        const res = evaluateCausalFeasibility({
          intentReceipt: intent,
          context,
          transitionReceipt: transition,
          castTarget,
        });
        expect(res.authority_alignment).toBe('UNCLEAR');
      });

      it('villain + MANIPULATE + force seat -> authority_alignment === UNCLEAR', () => {
        const context = createEmbodiedVillainContext({
          participationContext: {
            mode: 'antagonist',
            seat: { kind: 'force', name: 'Ambient System' },
            initialGoal: 'Subdue target',
            boundedFacts: [],
            authorityContract: {
              authority: 'System override',
              limits: 'Cannot physically touch',
            },
            victimField: {
              kind: 'individual',
              name: 'Subject Alpha',
            },
          },
        });
        const intent = createMockIntent({ action_kind: 'MANIPULATE' });
        const res = evaluateCausalFeasibility({
          intentReceipt: intent,
          context,
          transitionReceipt: transition,
          castTarget,
        });
        expect(res.authority_alignment).toBe('UNCLEAR');
      });

      it('villain + DEPLOY_HAZARD -> WITHIN_CONTRACT (regression lock on 3b)', () => {
        const context = createEmbodiedVillainContext();
        const intent = createMockIntent({ action_kind: 'DEPLOY_HAZARD' });
        const res = evaluateCausalFeasibility({
          intentReceipt: intent,
          context,
          transitionReceipt: transition,
          castTarget,
        });
        expect(res.authority_alignment).toBe('WITHIN_CONTRACT');
        expect(res.feasibility).toBe('SUPPORTED');
      });
    });

    describe('extractConversationalUtterance (Amendment 8)', () => {
      it('extracts double-quoted utterances with straight quotes', () => {
        const context = createMockContext();
        const res = extractConversationalUtterance('I look at Alpha Beta and say, "We need to get out of here."', context);
        expect(res.conversationalUtterance).toBe('We need to get out of here.');
        expect(res.addressedTargetId).toBe('char-001');
      });

      it('extracts double-quoted utterances with typographic curved quotes', () => {
        const context = createMockContext();
        const res = extractConversationalUtterance('I ask Alpha Beta “Can you reach the valve?”', context);
        expect(res.conversationalUtterance).toBe('Can you reach the valve?');
        expect(res.addressedTargetId).toBe('char-001');
      });

      it('extracts single-quoted utterances when co-occurring with speech verb and having >= 2 words', () => {
        const context = createMockContext();
        const res = extractConversationalUtterance("I whisper to Alpha Beta, 'hold your breath'", context);
        expect(res.conversationalUtterance).toBe('hold your breath');
        expect(res.addressedTargetId).toBe('char-001');
      });

      it('extracts single-quoted utterances with typographic curved quotes', () => {
        const context = createMockContext();
        const res = extractConversationalUtterance('I shout to Alpha Beta ‘take cover now’', context);
        expect(res.conversationalUtterance).toBe('take cover now');
        expect(res.addressedTargetId).toBe('char-001');
      });

      it('prevents apostrophe false-positives when no quotation is intended', () => {
        const context = createMockContext();
        const res = extractConversationalUtterance("I said don't touch the thing's seal.", context);
        expect(res.conversationalUtterance).toBeUndefined();
      });

      it('rejects single-word single-quote captures', () => {
        const context = createMockContext();
        const res = extractConversationalUtterance("I said 'Wait' to Alpha Beta.", context);
        expect(res.conversationalUtterance).toBeUndefined();
      });

      it('rejects single-quoted spans when no speech verb or cast name co-occurs', () => {
        const context = createMockContext();
        const res = extractConversationalUtterance("The 'rusted iron door' was completely sealed.", context);
        expect(res.conversationalUtterance).toBeUndefined();
      });
    });
  });
});


