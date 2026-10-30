import { describe, it, expect } from 'vitest';
import {
  CHARACTER_STANCES,
  STANCE_FOCI,
  MAX_STANCE_CHANGES_PER_TURN,
  MAX_STANCE_RATIONALE_LENGTH,
  STANCE_DECISION_OUTCOMES,
  STANCE_DECISION_REASONS,
  CharacterStanceSchema,
  StanceFocusSchema,
  CharacterStanceRecordSchema,
  CharacterStanceByIdSchema,
  CharacterStanceChangeProposalSchema,
  CharacterStanceProposalSchema,
  CharacterStanceDecisionSchema,
  CharacterStanceReceiptSchema,
  CharacterStanceDecision,
  CharacterStanceReceipt,
  CharacterStanceById,
  CharacterStanceProposal,
  EngineTurnContext,
  IntentReceipt,
  NarrativeReconciliationReceipt,
  CastInteractionReceipt,
} from '../types';
import {
  createCharacterStanceState,
  resolveCharacterStance,
  deriveFocusFlipBeats,
  FocusFlipDescriberBeat,
} from './characterStance';

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object') {
      deepFreeze(val);
    }
  }
  return obj;
}

function createMockContext(overrides?: Partial<EngineTurnContext>): EngineTurnContext {
  return {
    version: 1,
    scenario: {
      id: 'sc-01',
      title: 'The Enclosure',
      premise: 'Testing premises',
      worldRules: [],
      setting: {
        location: 'Facility',
        atmosphere: 'Cold',
        timePeriod: 'Present',
      },
      startingVector: 'COGNITIVE',
      startingTier: 'LATENT',
      incitingIncident: 'Breach',
      pacingDirective: 'Slow burn',
      keyPlotElements: [],
    },
    player: {
      role: 'protagonist',
      characterId: 'char-player',
      name: 'Agent Protagonist',
      description: 'The protagonist',
      isEntity: false,
    },
    cast: [
      {
        id: 'char-player',
        name: 'Agent Protagonist',
        role: 'Protagonist',
        description: 'The protagonist',
        personality: 'Determined',
        goals: 'Investigate',
        traits: ['Resolute'],
        isEntity: false,
        isUserCharacter: true,
        skepticism: 0.2,
        isPresent: true,
        stance: null,
        memory: [],
      },
      {
        id: 'char-npc-1',
        name: 'Dr. Evelyn Moore',
        role: 'Researcher',
        description: 'Chief Scientist',
        personality: 'Analytical',
        goals: 'Containment',
        traits: ['Methodical'],
        isEntity: false,
        isUserCharacter: false,
        skepticism: 0.5,
        isPresent: true,
        stance: null,
        memory: [],
      },
      {
        id: 'char-npc-2',
        name: 'Officer Davis',
        role: 'Security',
        description: 'Guard',
        personality: 'Alert',
        goals: 'Survival',
        traits: ['Vigilant'],
        isEntity: false,
        isUserCharacter: false,
        skepticism: 0.8,
        isPresent: true,
        stance: null,
        memory: [],
      },
      {
        id: 'char-absent',
        name: 'Technician Chen',
        role: 'Tech',
        description: 'Absent tech',
        personality: 'Nervous',
        goals: 'Escape',
        traits: ['Skittish'],
        isEntity: false,
        isUserCharacter: false,
        skepticism: 0.4,
        isPresent: false,
        stance: null,
        memory: [],
      },
      {
        id: 'char-player-companion',
        name: 'User Companion',
        role: 'Player Character',
        description: 'Secondary user character',
        personality: 'Loyal',
        goals: 'Assist',
        traits: [],
        isEntity: false,
        isUserCharacter: true,
        skepticism: 0.1,
        isPresent: true,
        stance: null,
        memory: [],
      },
    ],
    topology: {
      currentNodeId: 'lab-a',
      readableNodeLabel: 'Laboratory A',
      allowedOutgoingExits: [],
    },
    runtime: {
      phase: 'LATENT',
      tension: 10,
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
    intent_synergy: 'SUCCESS',
    ...overrides,
  };
}

function createMockReconciliation(
  overrides?: Partial<NarrativeReconciliationReceipt>
): NarrativeReconciliationReceipt {
  return {
    version: 1,
    mode: 'CANONICAL',
    feasibility: 'SUPPORTED',
    reason_code: 'NONE',
    fictional_time_cost: 'MOMENT',
    authority_alignment: 'WITHIN_CONTRACT',
    memory_echo_candidate: null,
    revision_increment: 0,
    ...overrides,
  };
}

function createMockCastInteraction(
  overrides?: Partial<CastInteractionReceipt>
): CastInteractionReceipt {
  return {
    version: 1,
    addressedCharacterId: null,
    respondingCharacterId: null,
    outcome: 'NONE',
    ...overrides,
  };
}

describe('Phase 3H.2A: Character Stance Contracts & Pure Resolver', () => {
  describe('1. Schema & Contract Strictness', () => {
    it('validates closed vocabularies and limits', () => {
      expect(CHARACTER_STANCES).toEqual([
        'OPEN',
        'GUARDED',
        'RESISTANT',
        'HOSTILE',
        'AFRAID',
        'WITHDRAWN',
        'SUBMITTED',
      ]);
      expect(STANCE_FOCI).toEqual(['PLAYER', 'SITUATION']);
      expect(MAX_STANCE_CHANGES_PER_TURN).toBe(2);
      expect(MAX_STANCE_RATIONALE_LENGTH).toBe(240);
      expect(STANCE_DECISION_OUTCOMES).toEqual(['APPLIED', 'REJECTED', 'NO_CHANGE']);
      expect(STANCE_DECISION_REASONS).toEqual([
        'APPLIED',
        'RECONCILIATION_SUPPRESSED',
        'ROLE_NOT_AUTHORIZED',
        'ACTION_NOT_AUTHORIZED',
        'UNKNOWN_CHARACTER',
        'PLAYER_CHARACTER',
        'CHARACTER_ABSENT',
        'COMMUNICATION_TARGET_MISMATCH',
        'NO_CHANGE',
      ]);
    });

    it('rejects invalid enum values for stance and focus', () => {
      expect(CharacterStanceSchema.safeParse('FRIENDLY').success).toBe(false);
      expect(CharacterStanceSchema.safeParse('OPEN').success).toBe(true);
      expect(StanceFocusSchema.safeParse('ENVIRONMENT').success).toBe(false);
      expect(StanceFocusSchema.safeParse('PLAYER').success).toBe(true);
      expect(StanceFocusSchema.safeParse('SITUATION').success).toBe(true);
    });

    it('enforces strict schemas rejecting unknown keys at every layer', () => {
      // CharacterStanceRecordSchema
      expect(
        CharacterStanceRecordSchema.safeParse({
          focus: 'PLAYER',
          stance: 'OPEN',
          extra: 123,
        }).success
      ).toBe(false);

      // CharacterStanceByIdSchema
      expect(
        CharacterStanceByIdSchema.safeParse({
          'char-1': { focus: 'PLAYER', stance: 'OPEN' },
        }).success
      ).toBe(true);

      // CharacterStanceChangeProposalSchema
      expect(
        CharacterStanceChangeProposalSchema.safeParse({
          character_id: 'char-npc-1',
          focus: 'PLAYER',
          stance: 'GUARDED',
          rationale: 'Observed movement',
          unknownField: true,
        }).success
      ).toBe(false);

      // CharacterStanceProposalSchema max length
      expect(
        CharacterStanceProposalSchema.safeParse({
          changes: [
            {
              character_id: 'char-1',
              focus: 'PLAYER',
              stance: 'OPEN',
              rationale: 'One',
            },
            {
              character_id: 'char-2',
              focus: 'PLAYER',
              stance: 'GUARDED',
              rationale: 'Two',
            },
            {
              character_id: 'char-3',
              focus: 'PLAYER',
              stance: 'AFRAID',
              rationale: 'Three',
            },
          ],
        }).success
      ).toBe(false);

      // CharacterStanceDecisionSchema
      expect(
        CharacterStanceDecisionSchema.safeParse({
          proposal: {
            character_id: 'char-1',
            focus: 'PLAYER',
            stance: 'OPEN',
            rationale: 'Valid rationale',
          },
          outcome: 'APPLIED',
          reason: 'APPLIED',
          before: null,
          after: { focus: 'PLAYER', stance: 'OPEN' },
          extraKey: 'forbidden',
        }).success
      ).toBe(false);

      // CharacterStanceReceiptSchema
      expect(
        CharacterStanceReceiptSchema.safeParse({
          version: 1,
          pre_state: {},
          post_state: {},
          decisions: [],
          unsolicited: 'payload',
        }).success
      ).toBe(false);
    });

    it('enforces string bounds on character_id and rationale', () => {
      // Empty trimmed character_id
      expect(
        CharacterStanceChangeProposalSchema.safeParse({
          character_id: '   ',
          focus: 'PLAYER',
          stance: 'OPEN',
          rationale: 'Valid rationale',
        }).success
      ).toBe(false);

      // Overlength character_id (>120)
      expect(
        CharacterStanceChangeProposalSchema.safeParse({
          character_id: 'a'.repeat(121),
          focus: 'PLAYER',
          stance: 'OPEN',
          rationale: 'Valid rationale',
        }).success
      ).toBe(false);

      // Empty trimmed rationale
      expect(
        CharacterStanceChangeProposalSchema.safeParse({
          character_id: 'char-1',
          focus: 'PLAYER',
          stance: 'OPEN',
          rationale: '   ',
        }).success
      ).toBe(false);

      // Overlength rationale (>240)
      expect(
        CharacterStanceChangeProposalSchema.safeParse({
          character_id: 'char-1',
          focus: 'PLAYER',
          stance: 'OPEN',
          rationale: 'r'.repeat(241),
        }).success
      ).toBe(false);
    });
  });

  describe('2. State Normalization (createCharacterStanceState)', () => {
    it('normalizes, trims keys, discards invalid records, and returns deterministic lexical key ordering', () => {
      const input: CharacterStanceById = {
        'char-z': { focus: 'SITUATION', stance: 'HOSTILE' },
        '  char-b  ': { focus: 'PLAYER', stance: 'GUARDED' },
        'char-a': { focus: 'PLAYER', stance: 'OPEN' },
        '': { focus: 'PLAYER', stance: 'AFRAID' },
        '   ': { focus: 'PLAYER', stance: 'WITHDRAWN' },
      };

      const normalized = createCharacterStanceState(input);
      const keys = Object.keys(normalized);

      expect(keys).toEqual(['char-a', 'char-b', 'char-z']);
      expect(normalized['char-a']).toEqual({ focus: 'PLAYER', stance: 'OPEN' });
      expect(normalized['char-b']).toEqual({ focus: 'PLAYER', stance: 'GUARDED' });
      expect(normalized['char-z']).toEqual({ focus: 'SITUATION', stance: 'HOSTILE' });
    });

    it('returns fresh object and fresh record references without mutating input', () => {
      const originalRecord = { focus: 'PLAYER' as const, stance: 'GUARDED' as const };
      const input: CharacterStanceById = { 'char-1': originalRecord };

      const result = createCharacterStanceState(input);

      expect(result).toEqual(input);
      expect(result).not.toBe(input);
      expect(result['char-1']).not.toBe(originalRecord);

      // Mutating result does not affect input
      result['char-1'].stance = 'HOSTILE';
      expect(input['char-1'].stance).toBe('GUARDED');
    });

    it('handles null, undefined, or non-object inputs safely', () => {
      expect(createCharacterStanceState(null)).toEqual({});
      expect(createCharacterStanceState(undefined)).toEqual({});
      expect(createCharacterStanceState({} as unknown as CharacterStanceById)).toEqual({});
    });
  });

  describe('3. Rejection Reasons & Precedence Order', () => {
    it('Precedence 1 (RECONCILIATION_SUPPRESSED) takes precedence over all subsequent rules', () => {
      const context = createMockContext({
        player: {
          role: 'director', // Role would also trigger ROLE_NOT_AUTHORIZED
          characterId: 'char-player',
          name: 'Director',
          description: '',
          isEntity: false,
        },
      });

      // 1a. mode is NOT_REQUIRED
      const res1 = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'unknown-npc', // Unknown would trigger UNKNOWN_CHARACTER
              focus: 'PLAYER',
              stance: 'HOSTILE',
              rationale: 'Direct threat',
            },
          ],
        },
        currentState: {},
        context,
        intentReceipt: createMockIntent({ action_kind: 'WAIT' }), // WAIT would trigger ACTION_NOT_AUTHORIZED
        reconciliationReceipt: createMockReconciliation({ mode: 'NOT_REQUIRED' }),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res1.decisions[0].outcome).toBe('REJECTED');
      expect(res1.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

      // 1b. mode is EXPERIENTIAL_REANCHORED
      const res2 = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'GUARDED',
              rationale: 'Reanchored event',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent(),
        reconciliationReceipt: createMockReconciliation({ mode: 'EXPERIENTIAL_REANCHORED' }),
        castInteractionReceipt: createMockCastInteraction(),
      });
      expect(res2.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

      // 1c. feasibility is IMPOSSIBLE
      const res3 = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'GUARDED',
              rationale: 'Impossible jump',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent(),
        reconciliationReceipt: createMockReconciliation({ feasibility: 'IMPOSSIBLE' }),
        castInteractionReceipt: createMockCastInteraction(),
      });
      expect(res3.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

      // 1d. action is SYSTEM
      const res4 = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'GUARDED',
              rationale: 'System tick',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'SYSTEM' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });
      expect(res4.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');
    });

    it('Precedence 2 (ROLE_NOT_AUTHORIZED) triggers when role is unauthorized and precedence 1 is satisfied', () => {
      const contextDirector = createMockContext({
        player: {
          role: 'director',
          characterId: null,
          name: 'Director',
          description: '',
          isEntity: false,
        },
      });

      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'GUARDED',
              rationale: 'Director prompt',
            },
          ],
        },
        currentState: {},
        context: contextDirector,
        intentReceipt: createMockIntent({ action_kind: 'WAIT' }), // WAIT is lower precedence than ROLE
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions[0].outcome).toBe('REJECTED');
      expect(res.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');
    });

    it('Precedence 3 (ACTION_NOT_AUTHORIZED) triggers for WAIT action', () => {
      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'unknown-npc', // Unknown is lower precedence than WAIT
              focus: 'PLAYER',
              stance: 'GUARDED',
              rationale: 'Waiting calmly',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'WAIT' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions[0].outcome).toBe('REJECTED');
      expect(res.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');
    });

    it('Precedence 4 (UNKNOWN_CHARACTER) triggers when character is not in cast', () => {
      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-unknown-ghost',
              focus: 'PLAYER',
              stance: 'HOSTILE',
              rationale: 'Unseen entity',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions[0].outcome).toBe('REJECTED');
      expect(res.decisions[0].reason).toBe('UNKNOWN_CHARACTER');
    });

    it('Precedence 5 (PLAYER_CHARACTER) triggers for player character or isUserCharacter', () => {
      // 5a. context.player.characterId match
      const res1 = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-player',
              focus: 'SITUATION',
              stance: 'AFRAID',
              rationale: 'Self panic',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });
      expect(res1.decisions[0].reason).toBe('PLAYER_CHARACTER');

      // 5b. isUserCharacter match
      const res2 = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-player-companion',
              focus: 'PLAYER',
              stance: 'WITHDRAWN',
              rationale: 'Companion reflex',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });
      expect(res2.decisions[0].reason).toBe('PLAYER_CHARACTER');
    });

    it('Precedence 6 (CHARACTER_ABSENT) triggers when cast member isPresent is false', () => {
      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-absent',
              focus: 'PLAYER',
              stance: 'AFRAID',
              rationale: 'Remote thought',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions[0].outcome).toBe('REJECTED');
      expect(res.decisions[0].reason).toBe('CHARACTER_ABSENT');
    });

    it('Precedence 7 (COMMUNICATION_TARGET_MISMATCH) triggers for COMMUNICATE when target does not match', () => {
      // Player communicates with char-npc-1, but proposal modifies char-npc-2
      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-2',
              focus: 'PLAYER',
              stance: 'HOSTILE',
              rationale: 'Overheard comment',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'COMMUNICATE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction({
          addressedCharacterId: 'char-npc-1',
          respondingCharacterId: 'char-npc-1',
          outcome: 'RESPONDED',
        }),
      });

      expect(res.decisions[0].outcome).toBe('REJECTED');
      expect(res.decisions[0].reason).toBe('COMMUNICATION_TARGET_MISMATCH');
    });

    it('Precedence 8 (NO_CHANGE) triggers when focus and stance match current state', () => {
      const currentState: CharacterStanceById = {
        'char-npc-1': { focus: 'PLAYER', stance: 'GUARDED' },
      };

      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'GUARDED',
              rationale: 'Remaining guarded',
            },
          ],
        },
        currentState,
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions[0].outcome).toBe('NO_CHANGE');
      expect(res.decisions[0].reason).toBe('NO_CHANGE');
      expect(res.decisions[0].before).toEqual({ focus: 'PLAYER', stance: 'GUARDED' });
      expect(res.decisions[0].after).toEqual({ focus: 'PLAYER', stance: 'GUARDED' });
      expect(res.post_state['char-npc-1']).toEqual({ focus: 'PLAYER', stance: 'GUARDED' });
    });

    it('Precedence 9 (APPLIED) applies valid stance changes', () => {
      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'HOSTILE',
              rationale: 'Intimidating gesture',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'INVESTIGATE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions[0].outcome).toBe('APPLIED');
      expect(res.decisions[0].reason).toBe('APPLIED');
      expect(res.decisions[0].before).toBeNull();
      expect(res.decisions[0].after).toEqual({ focus: 'PLAYER', stance: 'HOSTILE' });
      expect(res.post_state['char-npc-1']).toEqual({ focus: 'PLAYER', stance: 'HOSTILE' });
    });
  });

  describe('4. Identity & Cast Lookup Precision', () => {
    it('requires exact ID matching and rejects character names as IDs', () => {
      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'Dr. Evelyn Moore', // Name instead of id 'char-npc-1'
              focus: 'PLAYER',
              stance: 'RESISTANT',
              rationale: 'Attempting to address by name',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions[0].outcome).toBe('REJECTED');
      expect(res.decisions[0].reason).toBe('UNKNOWN_CHARACTER');
    });
  });

  describe('5. Communication Action Target Policy', () => {
    it('accepts addressedCharacterId during COMMUNICATE', () => {
      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'OPEN',
              rationale: 'Spoke directly with reassuring tone',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'COMMUNICATE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction({
          addressedCharacterId: 'char-npc-1',
          respondingCharacterId: null,
          outcome: 'ADDRESS_UNANSWERED',
        }),
      });

      expect(res.decisions[0].outcome).toBe('APPLIED');
      expect(res.decisions[0].reason).toBe('APPLIED');
    });

    it('accepts respondingCharacterId during COMMUNICATE even if addressed was different or null', () => {
      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-2',
              focus: 'SITUATION',
              stance: 'AFRAID',
              rationale: 'Officer interjected in panic',
            },
          ],
        },
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'COMMUNICATE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction({
          addressedCharacterId: 'char-npc-1',
          respondingCharacterId: 'char-npc-2',
          outcome: 'MISMATCH',
        }),
      });

      expect(res.decisions[0].outcome).toBe('APPLIED');
      expect(res.decisions[0].reason).toBe('APPLIED');
    });

    it('allows non-communication actions without any castInteraction target', () => {
      const actions = ['OBSERVE', 'INVESTIGATE', 'MOVE', 'MANIPULATE', 'OTHER'] as const;

      for (const action_kind of actions) {
        const res = resolveCharacterStance({
          proposal: {
            changes: [
              {
                character_id: 'char-npc-1',
                focus: 'SITUATION',
                stance: 'GUARDED',
                rationale: `Witnessed action ${action_kind}`,
              },
            ],
          },
          currentState: {},
          context: createMockContext(),
          intentReceipt: createMockIntent({ action_kind }),
          reconciliationReceipt: createMockReconciliation(),
          castInteractionReceipt: createMockCastInteraction({ outcome: 'NONE' }),
        });

        expect(res.decisions[0].outcome).toBe('APPLIED');
        expect(res.decisions[0].reason).toBe('APPLIED');
      }
    });
  });

  describe('6. Role Authorization & Participation Mode', () => {
    it('authorizes protagonist and possessed roles', () => {
      for (const role of ['protagonist', 'possessed'] as const) {
        const context = createMockContext({
          player: {
            role,
            characterId: 'char-player',
            name: 'Player',
            description: '',
            isEntity: false,
          },
        });

        const res = resolveCharacterStance({
          proposal: {
            changes: [
              {
                character_id: 'char-npc-1',
                focus: 'PLAYER',
                stance: 'RESISTANT',
                rationale: `Action by ${role}`,
              },
            ],
          },
          currentState: {},
          context,
          intentReceipt: createMockIntent({ action_kind: 'MANIPULATE' }),
          reconciliationReceipt: createMockReconciliation(),
          castInteractionReceipt: createMockCastInteraction(),
        });

        expect(res.decisions[0].outcome).toBe('APPLIED');
        expect(res.decisions[0].reason).toBe('APPLIED');
      }
    });

    it('authorizes antagonist ONLY when authority_alignment is WITHIN_CONTRACT', () => {
      const context = createMockContext({
        player: {
          role: 'antagonist',
          characterId: 'char-player',
          name: 'Antagonist',
          description: '',
          isEntity: false,
        },
      });

      // 1. Within contract -> Authorized
      const resValid = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'AFRAID',
              rationale: 'Antagonist menacing demeanor',
            },
          ],
        },
        currentState: {},
        context,
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation({
          authority_alignment: 'WITHIN_CONTRACT',
        }),
        castInteractionReceipt: createMockCastInteraction(),
      });
      expect(resValid.decisions[0].outcome).toBe('APPLIED');
      expect(resValid.decisions[0].reason).toBe('APPLIED');

      // 2. Exceeds contract -> Rejected
      const resExceeds = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'AFRAID',
              rationale: 'Antagonist overreach',
            },
          ],
        },
        currentState: {},
        context,
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation({
          authority_alignment: 'EXCEEDS_CONTRACT',
        }),
        castInteractionReceipt: createMockCastInteraction(),
      });
      expect(resExceeds.decisions[0].outcome).toBe('REJECTED');
      expect(resExceeds.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');

      // 3. Unclear alignment -> Rejected
      const resUnclear = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'AFRAID',
              rationale: 'Unclear contract',
            },
          ],
        },
        currentState: {},
        context,
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation({
          authority_alignment: 'UNCLEAR',
        }),
        castInteractionReceipt: createMockCastInteraction(),
      });
      expect(resUnclear.decisions[0].outcome).toBe('REJECTED');
      expect(resUnclear.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');
    });

    it('rejects director and witness roles', () => {
      for (const role of ['director', 'witness'] as const) {
        const context = createMockContext({
          player: {
            role,
            characterId: null,
            name: role,
            description: '',
            isEntity: false,
          },
        });

        const res = resolveCharacterStance({
          proposal: {
            changes: [
              {
                character_id: 'char-npc-1',
                focus: 'PLAYER',
                stance: 'GUARDED',
                rationale: `Action by ${role}`,
              },
            ],
          },
          currentState: {},
          context,
          intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
          reconciliationReceipt: createMockReconciliation(),
          castInteractionReceipt: createMockCastInteraction(),
        });

        expect(res.decisions[0].outcome).toBe('REJECTED');
        expect(res.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');
      }
    });

    it('uses participationContext.mode over context.player.role when present', () => {
      const context = createMockContext({
        player: {
          role: 'director', // player.role is director
          characterId: null,
          name: 'Director',
          description: '',
          isEntity: false,
        },
        participationContext: {
          mode: 'protagonist',
          initialGoal: 'Investigate the anomaly',
          boundedFacts: [],
        },
      });

      const res = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'OPEN',
              rationale: 'Active participation action',
            },
          ],
        },
        currentState: {},
        context,
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions[0].outcome).toBe('APPLIED');
      expect(res.decisions[0].reason).toBe('APPLIED');
    });
  });

  describe('7. Multi-Proposal Sequential Resolution & State Invariance', () => {
    it('applies change when only focus changes or only stance changes', () => {
      const currentState: CharacterStanceById = {
        'char-npc-1': { focus: 'PLAYER', stance: 'GUARDED' },
      };

      // Change only focus
      const resFocus = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'SITUATION',
              stance: 'GUARDED',
              rationale: 'Shifting attention to the room',
            },
          ],
        },
        currentState,
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(resFocus.decisions[0].outcome).toBe('APPLIED');
      expect(resFocus.post_state['char-npc-1']).toEqual({ focus: 'SITUATION', stance: 'GUARDED' });

      // Change only stance
      const resStance = resolveCharacterStance({
        proposal: {
          changes: [
            {
              character_id: 'char-npc-1',
              focus: 'PLAYER',
              stance: 'WITHDRAWN',
              rationale: 'Stepping back in silence',
            },
          ],
        },
        currentState,
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(resStance.decisions[0].outcome).toBe('APPLIED');
      expect(resStance.post_state['char-npc-1']).toEqual({ focus: 'PLAYER', stance: 'WITHDRAWN' });
    });

    it('processes two ordered proposals sequentially so later changes see earlier accepted changes', () => {
      const proposal: CharacterStanceProposal = {
        changes: [
          {
            character_id: 'char-npc-1',
            focus: 'PLAYER',
            stance: 'RESISTANT',
            rationale: 'Initial resistance',
          },
          {
            character_id: 'char-npc-1',
            focus: 'PLAYER',
            stance: 'HOSTILE',
            rationale: 'Escalated to hostile',
          },
        ],
      };

      const res = resolveCharacterStance({
        proposal,
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions).toHaveLength(2);

      expect(res.decisions[0].outcome).toBe('APPLIED');
      expect(res.decisions[0].before).toBeNull();
      expect(res.decisions[0].after).toEqual({ focus: 'PLAYER', stance: 'RESISTANT' });

      expect(res.decisions[1].outcome).toBe('APPLIED');
      expect(res.decisions[1].before).toEqual({ focus: 'PLAYER', stance: 'RESISTANT' });
      expect(res.decisions[1].after).toEqual({ focus: 'PLAYER', stance: 'HOSTILE' });

      expect(res.post_state['char-npc-1']).toEqual({ focus: 'PLAYER', stance: 'HOSTILE' });
    });

    it('processes two changes for two different characters and yields deterministic sorted post_state', () => {
      const proposal: CharacterStanceProposal = {
        changes: [
          {
            character_id: 'char-npc-2',
            focus: 'SITUATION',
            stance: 'AFRAID',
            rationale: 'Davis alarmed',
          },
          {
            character_id: 'char-npc-1',
            focus: 'PLAYER',
            stance: 'GUARDED',
            rationale: 'Moore guarded',
          },
        ],
      };

      const res = resolveCharacterStance({
        proposal,
        currentState: {},
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.decisions).toHaveLength(2);
      expect(res.decisions[0].proposal.character_id).toBe('char-npc-2');
      expect(res.decisions[1].proposal.character_id).toBe('char-npc-1');

      // Post-state keys are sorted lexically: 'char-npc-1', then 'char-npc-2'
      expect(Object.keys(res.post_state)).toEqual(['char-npc-1', 'char-npc-2']);
      expect(res.post_state['char-npc-1']).toEqual({ focus: 'PLAYER', stance: 'GUARDED' });
      expect(res.post_state['char-npc-2']).toEqual({ focus: 'SITUATION', stance: 'AFRAID' });
    });

    it('handles empty proposal returning a valid unchanged version 1 receipt', () => {
      const currentState: CharacterStanceById = {
        'char-npc-1': { focus: 'PLAYER', stance: 'GUARDED' },
      };

      const res = resolveCharacterStance({
        proposal: { changes: [] },
        currentState,
        context: createMockContext(),
        intentReceipt: createMockIntent({ action_kind: 'OBSERVE' }),
        reconciliationReceipt: createMockReconciliation(),
        castInteractionReceipt: createMockCastInteraction(),
      });

      expect(res.version).toBe(1);
      expect(res.decisions).toEqual([]);
      expect(res.pre_state).toEqual(currentState);
      expect(res.post_state).toEqual(currentState);
      expect(CharacterStanceReceiptSchema.safeParse(res).success).toBe(true);
    });

    it('guarantees pure execution against deep-frozen inputs and outputs schema-valid receipt', () => {
      const currentState: CharacterStanceById = deepFreeze({
        'char-npc-1': { focus: 'PLAYER', stance: 'OPEN' },
      });

      const proposal: CharacterStanceProposal = deepFreeze({
        changes: [
          {
            character_id: 'char-npc-1',
            focus: 'PLAYER',
            stance: 'GUARDED',
            rationale: 'Observed subtle shift',
          },
          {
            character_id: 'char-npc-2',
            focus: 'SITUATION',
            stance: 'HOSTILE',
            rationale: 'Hostile posture',
          },
        ],
      });

      const context: EngineTurnContext = deepFreeze(createMockContext());
      const intentReceipt: IntentReceipt = deepFreeze(createMockIntent({ action_kind: 'INVESTIGATE' }));
      const reconciliationReceipt: NarrativeReconciliationReceipt = deepFreeze(createMockReconciliation());
      const castInteractionReceipt: CastInteractionReceipt = deepFreeze(createMockCastInteraction());

      const receipt = resolveCharacterStance({
        proposal,
        currentState,
        context,
        intentReceipt,
        reconciliationReceipt,
        castInteractionReceipt,
      });

      const parseResult = CharacterStanceReceiptSchema.safeParse(receipt);
      expect(parseResult.success).toBe(true);

      expect(receipt.version).toBe(1);
      expect(receipt.decisions).toHaveLength(2);
      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.decisions[1].outcome).toBe('APPLIED');
      expect(receipt.post_state['char-npc-1']).toEqual({ focus: 'PLAYER', stance: 'GUARDED' });
      expect(receipt.post_state['char-npc-2']).toEqual({ focus: 'SITUATION', stance: 'HOSTILE' });
    });
  });

  describe('Item 7: Focus-flip describer beat (deriveFocusFlipBeats)', () => {
    it('emits a describer beat when an applied decision flips focus from PLAYER to SITUATION', () => {
      const decisions: CharacterStanceDecision[] = [
        {
          proposal: {
            character_id: 'char-npc-1',
            focus: 'SITUATION',
            stance: 'GUARDED',
            rationale: 'Shifting attention toward the breach',
          },
          outcome: 'APPLIED',
          reason: 'APPLIED',
          before: { focus: 'PLAYER', stance: 'GUARDED' },
          after: { focus: 'SITUATION', stance: 'GUARDED' },
        },
      ];

      const beats = deriveFocusFlipBeats(decisions);

      expect(beats).toEqual<FocusFlipDescriberBeat[]>([
        {
          character_id: 'char-npc-1',
          previousFocus: 'PLAYER',
          currentFocus: 'SITUATION',
          beat: 'char-npc-1 shifts focus from PLAYER to SITUATION',
        },
      ]);
    });

    it('emits a describer beat when an applied decision flips focus from SITUATION to PLAYER', () => {
      const decisions: CharacterStanceDecision[] = [
        {
          proposal: {
            character_id: 'char-npc-2',
            focus: 'PLAYER',
            stance: 'HOSTILE',
            rationale: 'Turning suspicion back onto the player',
          },
          outcome: 'APPLIED',
          reason: 'APPLIED',
          before: { focus: 'SITUATION', stance: 'OPEN' },
          after: { focus: 'PLAYER', stance: 'HOSTILE' },
        },
      ];

      const beats = deriveFocusFlipBeats(decisions);

      expect(beats).toEqual<FocusFlipDescriberBeat[]>([
        {
          character_id: 'char-npc-2',
          previousFocus: 'SITUATION',
          currentFocus: 'PLAYER',
          beat: 'char-npc-2 shifts focus from SITUATION to PLAYER',
        },
      ]);
    });

    it('emits nothing when focus is unchanged even if stance changed', () => {
      const decisions: CharacterStanceDecision[] = [
        {
          proposal: {
            character_id: 'char-npc-1',
            focus: 'PLAYER',
            stance: 'HOSTILE',
            rationale: 'Escalating hostility against the player',
          },
          outcome: 'APPLIED',
          reason: 'APPLIED',
          before: { focus: 'PLAYER', stance: 'GUARDED' },
          after: { focus: 'PLAYER', stance: 'HOSTILE' },
        },
      ];

      const beats = deriveFocusFlipBeats(decisions);
      expect(beats).toEqual([]);
    });

    it('emits nothing on initial stance creation when before is null', () => {
      const decisions: CharacterStanceDecision[] = [
        {
          proposal: {
            character_id: 'char-npc-1',
            focus: 'PLAYER',
            stance: 'GUARDED',
            rationale: 'Initial stance established',
          },
          outcome: 'APPLIED',
          reason: 'APPLIED',
          before: null,
          after: { focus: 'PLAYER', stance: 'GUARDED' },
        },
      ];

      const beats = deriveFocusFlipBeats(decisions);
      expect(beats).toEqual([]);
    });

    it('emits nothing on rejected proposals even if focus was proposed to change', () => {
      const decisions: CharacterStanceDecision[] = [
        {
          proposal: {
            character_id: 'char-npc-1',
            focus: 'SITUATION',
            stance: 'AFRAID',
            rationale: 'Panic suppression rejected',
          },
          outcome: 'REJECTED',
          reason: 'ACTION_NOT_AUTHORIZED',
          before: { focus: 'PLAYER', stance: 'OPEN' },
          after: { focus: 'PLAYER', stance: 'OPEN' },
        },
      ];

      const beats = deriveFocusFlipBeats(decisions);
      expect(beats).toEqual([]);
    });

    it('emits nothing on NO_CHANGE decisions', () => {
      const decisions: CharacterStanceDecision[] = [
        {
          proposal: {
            character_id: 'char-npc-1',
            focus: 'PLAYER',
            stance: 'GUARDED',
            rationale: 'No change',
          },
          outcome: 'NO_CHANGE',
          reason: 'NO_CHANGE',
          before: { focus: 'PLAYER', stance: 'GUARDED' },
          after: { focus: 'PLAYER', stance: 'GUARDED' },
        },
      ];

      const beats = deriveFocusFlipBeats(decisions);
      expect(beats).toEqual([]);
    });

    it('accepts a CharacterStanceReceipt object and extracts focus flips accurately', () => {
      const receipt: CharacterStanceReceipt = {
        version: 1,
        pre_state: {
          'char-npc-1': { focus: 'PLAYER', stance: 'GUARDED' },
          'char-npc-2': { focus: 'SITUATION', stance: 'OPEN' },
        },
        post_state: {
          'char-npc-1': { focus: 'SITUATION', stance: 'WITHDRAWN' },
          'char-npc-2': { focus: 'PLAYER', stance: 'HOSTILE' },
        },
        decisions: [
          {
            proposal: {
              character_id: 'char-npc-1',
              focus: 'SITUATION',
              stance: 'WITHDRAWN',
              rationale: 'Retreating into observation',
            },
            outcome: 'APPLIED',
            reason: 'APPLIED',
            before: { focus: 'PLAYER', stance: 'GUARDED' },
            after: { focus: 'SITUATION', stance: 'WITHDRAWN' },
          },
          {
            proposal: {
              character_id: 'char-npc-2',
              focus: 'PLAYER',
              stance: 'HOSTILE',
              rationale: 'Focusing threat directly on player',
            },
            outcome: 'APPLIED',
            reason: 'APPLIED',
            before: { focus: 'SITUATION', stance: 'OPEN' },
            after: { focus: 'PLAYER', stance: 'HOSTILE' },
          },
        ],
      };

      const beats = deriveFocusFlipBeats(receipt);

      expect(beats).toHaveLength(2);
      expect(beats[0]).toEqual({
        character_id: 'char-npc-1',
        previousFocus: 'PLAYER',
        currentFocus: 'SITUATION',
        beat: 'char-npc-1 shifts focus from PLAYER to SITUATION',
      });
      expect(beats[1]).toEqual({
        character_id: 'char-npc-2',
        previousFocus: 'SITUATION',
        currentFocus: 'PLAYER',
        beat: 'char-npc-2 shifts focus from SITUATION to PLAYER',
      });
    });

    it('filters mixed decisions in receipt preserving sequential order', () => {
      const receipt: CharacterStanceReceipt = {
        version: 1,
        pre_state: {},
        post_state: {},
        decisions: [
          // 1. Initial creation (before === null): emit nothing
          {
            proposal: {
              character_id: 'char-new',
              focus: 'PLAYER',
              stance: 'OPEN',
              rationale: 'New character',
            },
            outcome: 'APPLIED',
            reason: 'APPLIED',
            before: null,
            after: { focus: 'PLAYER', stance: 'OPEN' },
          },
          // 2. Focus flip: emit beat
          {
            proposal: {
              character_id: 'char-npc-1',
              focus: 'SITUATION',
              stance: 'GUARDED',
              rationale: 'Distracted by noise',
            },
            outcome: 'APPLIED',
            reason: 'APPLIED',
            before: { focus: 'PLAYER', stance: 'GUARDED' },
            after: { focus: 'SITUATION', stance: 'GUARDED' },
          },
          // 3. Stance changed but focus unchanged: emit nothing
          {
            proposal: {
              character_id: 'char-npc-2',
              focus: 'PLAYER',
              stance: 'AFRAID',
              rationale: 'Fear increased',
            },
            outcome: 'APPLIED',
            reason: 'APPLIED',
            before: { focus: 'PLAYER', stance: 'GUARDED' },
            after: { focus: 'PLAYER', stance: 'AFRAID' },
          },
          // 4. Rejected decision: emit nothing
          {
            proposal: {
              character_id: 'char-npc-3',
              focus: 'PLAYER',
              stance: 'HOSTILE',
              rationale: 'Absent character rejected',
            },
            outcome: 'REJECTED',
            reason: 'CHARACTER_ABSENT',
            before: { focus: 'SITUATION', stance: 'GUARDED' },
            after: { focus: 'SITUATION', stance: 'GUARDED' },
          },
        ],
      };

      const beats = deriveFocusFlipBeats(receipt);
      expect(beats).toHaveLength(1);
      expect(beats[0]).toEqual({
        character_id: 'char-npc-1',
        previousFocus: 'PLAYER',
        currentFocus: 'SITUATION',
        beat: 'char-npc-1 shifts focus from PLAYER to SITUATION',
      });
    });

    it('returns empty array when input decisions or receipt decisions are empty', () => {
      expect(deriveFocusFlipBeats([])).toEqual([]);
      expect(
        deriveFocusFlipBeats({
          version: 1,
          pre_state: {},
          post_state: {},
          decisions: [],
        })
      ).toEqual([]);
    });

    it('operates purely without mutating deep-frozen inputs', () => {
      const receipt: CharacterStanceReceipt = deepFreeze({
        version: 1 as const,
        pre_state: {
          'char-npc-1': { focus: 'PLAYER' as const, stance: 'GUARDED' as const },
        },
        post_state: {
          'char-npc-1': { focus: 'SITUATION' as const, stance: 'GUARDED' as const },
        },
        decisions: [
          {
            proposal: {
              character_id: 'char-npc-1',
              focus: 'SITUATION' as const,
              stance: 'GUARDED' as const,
              rationale: 'Pure test',
            },
            outcome: 'APPLIED' as const,
            reason: 'APPLIED' as const,
            before: { focus: 'PLAYER' as const, stance: 'GUARDED' as const },
            after: { focus: 'SITUATION' as const, stance: 'GUARDED' as const },
          },
        ],
      });

      const beats = deriveFocusFlipBeats(receipt);
      expect(beats).toHaveLength(1);
      expect(beats[0].beat).toBe('char-npc-1 shifts focus from PLAYER to SITUATION');
    });
  });
});

