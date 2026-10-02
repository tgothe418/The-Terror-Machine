import { describe, it, expect } from 'vitest';
import {
  CharacterRelationshipRecordSchema,
  CharacterRelationshipProposalSchema,
  CharacterRelationshipReceiptSchema,
  CharacterRelationshipRecord,
  CharacterRelationshipState,
  CharacterRelationshipProposal,
  MAX_CHARACTER_RELATIONSHIPS,
  RELATIONSHIP_KINDS,
  EngineTurnContext,
  IntentReceipt,
  NarrativeReconciliationReceipt,
  CastInteractionReceipt,
} from '../types';
import {
  createCharacterRelationshipState,
  resolveCharacterRelationships,
} from './characterRelationships';

function deepFreeze<T>(obj: T): T {
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

const mockContext: EngineTurnContext = {
  version: 1,
  scenario: {
    title: 'Test Facility',
    premise: 'Facility premise',
    worldRules: [],
    setting: {
      location: 'Chamber A',
      atmosphere: 'Sterile',
      timePeriod: 'Present',
    },
    startingVector: 'COGNITIVE',
    startingTier: 'LATENT',
    incitingIncident: 'Initial trigger',
    pacingDirective: 'Standard',
    keyPlotElements: [],
  },
  player: {
    role: 'protagonist',
    characterId: 'char-player',
    name: 'Player',
    description: 'Lead protagonist',
    isEntity: false,
  },
  cast: [
    {
      id: 'char-npc-1',
      name: 'Dr. NPC One',
      role: 'Scientist',
      description: 'Researcher',
      personality: 'Analytical',
      goals: 'Survive',
      traits: [],
      isEntity: false,
      isUserCharacter: false,
      skepticism: 0.5,
      isPresent: true,
      stance: null,
      memory: [],
    },
    {
      id: 'char-npc-2',
      name: 'Officer NPC Two',
      role: 'Guard',
      description: 'Security',
      personality: 'Gruff',
      goals: 'Defend',
      traits: [],
      isEntity: false,
      isUserCharacter: false,
      skepticism: 0.8,
      isPresent: true,
      stance: null,
      memory: [],
    },
    {
      id: 'char-absent',
      name: 'Absent NPC',
      role: 'Technician',
      description: 'Engineer',
      personality: 'Nervous',
      goals: 'Hide',
      traits: [],
      isEntity: false,
      isUserCharacter: false,
      skepticism: 0.3,
      isPresent: false,
      stance: null,
      memory: [],
    },
    {
      id: 'char-user-clone',
      name: 'User Clone',
      role: 'Co-protagonist',
      description: 'Alt user',
      personality: 'Quiet',
      goals: 'Assist',
      traits: [],
      isEntity: false,
      isUserCharacter: true,
      skepticism: 0.2,
      isPresent: true,
      stance: null,
      memory: [],
    },
  ],
  topology: {
    currentNodeId: 'node-1',
    readableNodeLabel: 'Node 1',
    allowedOutgoingExits: [],
  },
  runtime: {
    phase: 'LATENT',
    tension: 1,
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
};

const mockIntentReceipt: IntentReceipt = {
  version: 1,
  action_kind: 'COMMUNICATE',
  action_subtype: null,
  pressure_direction: 'MAINTAIN',
  dramatic_tactic: 'NONE',
  intent_synergy: 'N/A',
};

const mockReconciliationReceipt: NarrativeReconciliationReceipt = {
  version: 1,
  mode: 'CANONICAL',
  feasibility: 'SUPPORTED',
  reason_code: 'NONE',
  authority_alignment: 'NOT_APPLICABLE',
  fictional_time_cost: 'MOMENT',
  revision_increment: 0,
  memory_echo_candidate: null,
};

const mockCastInteractionReceipt: CastInteractionReceipt = {
  version: 1,
  addressedCharacterId: 'char-npc-1',
  respondingCharacterId: 'char-npc-1',
  outcome: 'RESPONDED',
};

describe('Character Relationships (Phase 3H.3A)', () => {
  describe('Contracts & Schema Validation', () => {
    it('enforces strict schemas for CharacterRelationshipRecord', () => {
      const valid = CharacterRelationshipRecordSchema.safeParse({
        source_character_id: 'char-player',
        target_character_id: 'char-npc-1',
        kind: 'TRUST',
        intensity: 1,
      });
      expect(valid.success).toBe(true);

      const invalidExtraKey = CharacterRelationshipRecordSchema.safeParse({
        source_character_id: 'char-player',
        target_character_id: 'char-npc-1',
        kind: 'TRUST',
        intensity: 1,
        extra: 'not-allowed',
      });
      expect(invalidExtraKey.success).toBe(false);

      const invalidIntensity = CharacterRelationshipRecordSchema.safeParse({
        source_character_id: 'char-player',
        target_character_id: 'char-npc-1',
        kind: 'TRUST',
        intensity: 4,
      });
      expect(invalidIntensity.success).toBe(false);

      const invalidKind = CharacterRelationshipRecordSchema.safeParse({
        source_character_id: 'char-player',
        target_character_id: 'char-npc-1',
        kind: 'LOVE',
        intensity: 1,
      });
      expect(invalidKind.success).toBe(false);
    });

    it('enforces closed relationship kinds and proposal delta literals', () => {
      expect(RELATIONSHIP_KINDS).toEqual([
        'TRUST',
        'HOSTILITY',
        'DEPENDENCE',
        'LEVERAGE',
        'SUSPICION',
        'FEAR',
        'LOYALTY',
        'DOMINANCE',
      ]);

      const validProposal = CharacterRelationshipProposalSchema.safeParse({
        changes: [
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-1',
            kind: 'DEPENDENCE',
            delta: 1,
            rationale: 'Mutual reliance established during breach containment.',
          },
          {
            source_character_id: 'char-npc-1',
            target_character_id: 'char-player',
            kind: 'LEVERAGE',
            delta: -1,
            rationale: 'Information disclosed openly without leverage retained.',
          },
        ],
      });
      expect(validProposal.success).toBe(true);

      const invalidDelta = CharacterRelationshipProposalSchema.safeParse({
        changes: [
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-1',
            kind: 'TRUST',
            delta: 2,
            rationale: 'Test',
          },
        ],
      });
      expect(invalidDelta.success).toBe(false);

      const tooManyChanges = CharacterRelationshipProposalSchema.safeParse({
        changes: [
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-1',
            kind: 'TRUST',
            delta: 1,
            rationale: 'Test 1',
          },
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-2',
            kind: 'TRUST',
            delta: 1,
            rationale: 'Test 2',
          },
          {
            source_character_id: 'char-npc-1',
            target_character_id: 'char-player',
            kind: 'TRUST',
            delta: 1,
            rationale: 'Test 3',
          },
        ],
      });
      expect(tooManyChanges.success).toBe(false);
    });
  });

  describe('Normalization & Deterministic Ordering', () => {
    it('creates normalized, sorted, deduplicated relationship state', () => {
      const raw: CharacterRelationshipState = [
        {
          source_character_id: 'char-z',
          target_character_id: 'char-player',
          kind: 'TRUST',
          intensity: 2,
        },
        {
          source_character_id: 'char-a',
          target_character_id: 'char-player',
          kind: 'HOSTILITY',
          intensity: 1,
        },
        {
          source_character_id: 'char-a',
          target_character_id: 'char-player',
          kind: 'HOSTILITY',
          intensity: 3, // duplicate tuple (char-a, char-player, HOSTILITY) -> keep first
        },
        {
          source_character_id: 'char-a',
          target_character_id: 'char-player',
          kind: 'DEPENDENCE',
          intensity: 2,
        },
      ];

      const normalized = createCharacterRelationshipState(raw);

      expect(normalized).toHaveLength(3);
      expect(normalized[0]).toEqual({
        source_character_id: 'char-a',
        target_character_id: 'char-player',
        kind: 'DEPENDENCE',
        intensity: 2,
      });
      expect(normalized[1]).toEqual({
        source_character_id: 'char-a',
        target_character_id: 'char-player',
        kind: 'HOSTILITY',
        intensity: 1,
      });
      expect(normalized[2]).toEqual({
        source_character_id: 'char-z',
        target_character_id: 'char-player',
        kind: 'TRUST',
        intensity: 2,
      });
    });

    it('treats direction and kind as distinct edge tuples', () => {
      const records: CharacterRelationshipState = [
        {
          source_character_id: 'char-player',
          target_character_id: 'char-npc-1',
          kind: 'TRUST',
          intensity: 1,
        },
        {
          source_character_id: 'char-npc-1',
          target_character_id: 'char-player',
          kind: 'TRUST',
          intensity: 2,
        },
        {
          source_character_id: 'char-player',
          target_character_id: 'char-npc-1',
          kind: 'HOSTILITY',
          intensity: 1,
        },
      ];

      const normalized = createCharacterRelationshipState(records);
      expect(normalized).toHaveLength(3);
    });

    it('caps normalized records at MAX_CHARACTER_RELATIONSHIPS (48) and discards invalid ones', () => {
      const oversized: CharacterRelationshipRecord[] = [];
      for (let i = 0; i < 60; i++) {
        oversized.push({
          source_character_id: `char-src-${String(i).padStart(2, '0')}`,
          target_character_id: 'char-player',
          kind: 'TRUST',
          intensity: 1,
        });
      }

      const normalized = createCharacterRelationshipState(oversized);
      expect(normalized).toHaveLength(MAX_CHARACTER_RELATIONSHIPS);
      expect(normalized.length).toBe(48);

      const invalidIgnored = createCharacterRelationshipState([
        {
          source_character_id: 'char-1',
          target_character_id: 'char-2',
          kind: 'TRUST',
          intensity: 5 as unknown as 1,
        },
        null as unknown as CharacterRelationshipRecord,
      ]);
      expect(invalidIgnored).toEqual([]);
    });
  });

  describe('Rejection Precedence & Guard Enforcement', () => {
    const validProposal: CharacterRelationshipProposal = {
      changes: [
        {
          source_character_id: 'char-player',
          target_character_id: 'char-npc-1',
          kind: 'TRUST',
          delta: 1,
          rationale: 'Shared shelter in containment.',
        },
      ],
    };

    it('1. Rejects with RECONCILIATION_SUPPRESSED when mode is EXPERIENTIAL_REANCHORED or IMPOSSIBLE or SYSTEM', () => {
      const resSuppressed = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: {
          ...mockReconciliationReceipt,
          mode: 'EXPERIENTIAL_REANCHORED',
        },
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(resSuppressed.decisions[0].outcome).toBe('REJECTED');
      expect(resSuppressed.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');
      expect(resSuppressed.post_state).toEqual([]);

      const resImpossible = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: {
          ...mockReconciliationReceipt,
          feasibility: 'IMPOSSIBLE',
        },
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resImpossible.decisions[0].outcome).toBe('REJECTED');
      expect(resImpossible.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

      const resSystem = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: mockContext,
        intentReceipt: {
          ...mockIntentReceipt,
          action_kind: 'SYSTEM',
        },
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resSystem.decisions[0].outcome).toBe('REJECTED');
      expect(resSystem.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');
    });

    it('2. Rejects with ROLE_NOT_AUTHORIZED for unauthorized roles or antagonist without WITHIN_CONTRACT', () => {
      const resWitness = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: {
          ...mockContext,
          player: {
            ...mockContext.player,
            role: 'witness',
          },
        },
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resWitness.decisions[0].outcome).toBe('REJECTED');
      expect(resWitness.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');

      const resDirector = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: {
          ...mockContext,
          player: {
            ...mockContext.player,
            role: 'director',
          },
        },
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resDirector.decisions[0].outcome).toBe('REJECTED');
      expect(resDirector.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');

      const resAntagonistExceeds = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: {
          ...mockContext,
          player: {
            ...mockContext.player,
            role: 'antagonist',
          },
        },
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: {
          ...mockReconciliationReceipt,
          authority_alignment: 'EXCEEDS_CONTRACT',
        },
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resAntagonistExceeds.decisions[0].outcome).toBe('REJECTED');
      expect(resAntagonistExceeds.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');

      const resAntagonistWithin = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: {
          ...mockContext,
          player: {
            ...mockContext.player,
            role: 'antagonist',
          },
        },
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: {
          ...mockReconciliationReceipt,
          authority_alignment: 'WITHIN_CONTRACT',
        },
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resAntagonistWithin.decisions[0].outcome).toBe('APPLIED');
      expect(resAntagonistWithin.decisions[0].reason).toBe('APPLIED');
    });

    it('3. Rejects with ACTION_NOT_AUTHORIZED for unpermitted action kinds (e.g. OBSERVE, WAIT, SPECIAL)', () => {
      const resObserve = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: mockContext,
        intentReceipt: {
          ...mockIntentReceipt,
          action_kind: 'OBSERVE',
        },
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resObserve.decisions[0].outcome).toBe('REJECTED');
      expect(resObserve.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');

      const resWait = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: mockContext,
        intentReceipt: {
          ...mockIntentReceipt,
          action_kind: 'WAIT',
        },
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resWait.decisions[0].outcome).toBe('REJECTED');
      expect(resWait.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');
    });

    it('4. Rejects with PLAYER_ID_UNAVAILABLE when context.player.characterId is null or empty', () => {
      const resNoPlayer = resolveCharacterRelationships({
        proposal: validProposal,
        currentState: [],
        context: {
          ...mockContext,
          player: {
            ...mockContext.player,
            characterId: null,
          },
        },
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resNoPlayer.decisions[0].outcome).toBe('REJECTED');
      expect(resNoPlayer.decisions[0].reason).toBe('PLAYER_ID_UNAVAILABLE');
    });

    it('5. Rejects with SELF_RELATIONSHIP when source and target are equal', () => {
      const resSelf = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-player',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Self reflection',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resSelf.decisions[0].outcome).toBe('REJECTED');
      expect(resSelf.decisions[0].reason).toBe('SELF_RELATIONSHIP');
    });

    it('6. Rejects with PLAYER_NOT_INVOLVED when neither or both endpoints fail exactly-one-player check', () => {
      const resNoPlayer = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-npc-1',
              target_character_id: 'char-npc-2',
              kind: 'TRUST',
              delta: 1,
              rationale: 'NPCs interacting without player',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resNoPlayer.decisions[0].outcome).toBe('REJECTED');
      expect(resNoPlayer.decisions[0].reason).toBe('PLAYER_NOT_INVOLVED');
    });

    it('7 & 8. Rejects with UNKNOWN_CHARACTER when non-player is not in cast or is flagged isUserCharacter', () => {
      const resUnknown = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-phantom',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Unknown character',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });
      expect(resUnknown.decisions[0].outcome).toBe('REJECTED');
      expect(resUnknown.decisions[0].reason).toBe('UNKNOWN_CHARACTER');

      const resUserChar = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-user-clone',
              kind: 'TRUST',
              delta: 1,
              rationale: 'User character target',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: {
          ...mockCastInteractionReceipt,
          addressedCharacterId: 'char-user-clone',
        },
      });
      expect(resUserChar.decisions[0].outcome).toBe('REJECTED');
      expect(resUserChar.decisions[0].reason).toBe('UNKNOWN_CHARACTER');
    });

    it('9. Rejects with CHARACTER_ABSENT when non-player cast member is not present', () => {
      const resAbsent = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-absent',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Absent character interaction',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: {
          ...mockCastInteractionReceipt,
          addressedCharacterId: 'char-absent',
        },
      });
      expect(resAbsent.decisions[0].outcome).toBe('REJECTED');
      expect(resAbsent.decisions[0].reason).toBe('CHARACTER_ABSENT');
    });

    it('10. For COMMUNICATE, rejects with COMMUNICATION_TARGET_MISMATCH unless non-player equals addressed or responding ID', () => {
      const resMismatch = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-2',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Interacted with NPC 2 during dialogue with NPC 1',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: {
          ...mockIntentReceipt,
          action_kind: 'COMMUNICATE',
        },
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: {
          version: 1,
          addressedCharacterId: 'char-npc-1',
          respondingCharacterId: 'char-npc-1',
          outcome: 'RESPONDED',
        },
      });
      expect(resMismatch.decisions[0].outcome).toBe('REJECTED');
      expect(resMismatch.decisions[0].reason).toBe('COMMUNICATION_TARGET_MISMATCH');

      // Non-communication actions (MOVE, INVESTIGATE, MANIPULATE) do not require communication target matching
      const resInvestigate = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-2',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Coordinated investigation',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: {
          ...mockIntentReceipt,
          action_kind: 'INVESTIGATE',
        },
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: {
          version: 1,
          addressedCharacterId: null,
          respondingCharacterId: null,
          outcome: 'NONE',
        },
      });
      expect(resInvestigate.decisions[0].outcome).toBe('APPLIED');
      expect(resInvestigate.decisions[0].reason).toBe('APPLIED');
    });
  });

  describe('State Mutations & Edge Lifecycles', () => {
    it('creates edge at intensity 1 on delta +1 when edge did not exist', () => {
      const receipt = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Shared hazard survival',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.decisions[0].reason).toBe('APPLIED');
      expect(receipt.decisions[0].before).toBeNull();
      expect(receipt.decisions[0].after).toEqual({
        source_character_id: 'char-player',
        target_character_id: 'char-npc-1',
        kind: 'TRUST',
        intensity: 1,
      });
      expect(receipt.post_state).toEqual([
        {
          source_character_id: 'char-player',
          target_character_id: 'char-npc-1',
          kind: 'TRUST',
          intensity: 1,
        },
      ]);
    });

    it('increments intensity from 1 to 2, and 2 to 3 on delta +1', () => {
      const step1 = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Deepening trust',
            },
          ],
        },
        currentState: [
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-1',
            kind: 'TRUST',
            intensity: 1,
          },
        ],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(step1.decisions[0].outcome).toBe('APPLIED');
      expect(step1.decisions[0].after?.intensity).toBe(2);

      const step2 = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Unshakable trust',
            },
          ],
        },
        currentState: step1.post_state,
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(step2.decisions[0].outcome).toBe('APPLIED');
      expect(step2.decisions[0].after?.intensity).toBe(3);
    });

    it('returns NO_CHANGE / INTENSITY_LIMIT on +1 when already at intensity 3', () => {
      const receipt = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'TRUST',
              delta: 1,
              rationale: 'Attempt to exceed max trust',
            },
          ],
        },
        currentState: [
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-1',
            kind: 'TRUST',
            intensity: 3,
          },
        ],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(receipt.decisions[0].outcome).toBe('NO_CHANGE');
      expect(receipt.decisions[0].reason).toBe('INTENSITY_LIMIT');
      expect(receipt.decisions[0].before?.intensity).toBe(3);
      expect(receipt.decisions[0].after?.intensity).toBe(3);
      expect(receipt.post_state[0].intensity).toBe(3);
    });

    it('returns NO_CHANGE / RELATIONSHIP_NOT_FOUND on delta -1 when edge does not exist', () => {
      const receipt = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'HOSTILITY',
              delta: -1,
              rationale: 'Attempt to decrease non-existent hostility',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(receipt.decisions[0].outcome).toBe('NO_CHANGE');
      expect(receipt.decisions[0].reason).toBe('RELATIONSHIP_NOT_FOUND');
      expect(receipt.decisions[0].before).toBeNull();
      expect(receipt.decisions[0].after).toBeNull();
      expect(receipt.post_state).toEqual([]);
    });

    it('decrements intensity from 3 to 2, and 2 to 1 on delta -1', () => {
      const step1 = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'HOSTILITY',
              delta: -1,
              rationale: 'Hostility cooling',
            },
          ],
        },
        currentState: [
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-1',
            kind: 'HOSTILITY',
            intensity: 3,
          },
        ],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(step1.decisions[0].outcome).toBe('APPLIED');
      expect(step1.decisions[0].after?.intensity).toBe(2);

      const step2 = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'HOSTILITY',
              delta: -1,
              rationale: 'Hostility further cooling',
            },
          ],
        },
        currentState: step1.post_state,
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(step2.decisions[0].outcome).toBe('APPLIED');
      expect(step2.decisions[0].after?.intensity).toBe(1);
    });

    it('removes edge completely and returns after: null on delta -1 at intensity 1', () => {
      const receipt = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'HOSTILITY',
              delta: -1,
              rationale: 'Hostility resolved entirely',
            },
          ],
        },
        currentState: [
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-1',
            kind: 'HOSTILITY',
            intensity: 1,
          },
        ],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.decisions[0].reason).toBe('APPLIED');
      expect(receipt.decisions[0].before).toEqual({
        source_character_id: 'char-player',
        target_character_id: 'char-npc-1',
        kind: 'HOSTILITY',
        intensity: 1,
      });
      expect(receipt.decisions[0].after).toBeNull();
      expect(receipt.post_state).toEqual([]);
    });

    it('enforces state cap of 48: blocks new creations with STATE_LIMIT but allows mutation/removal of existing records', () => {
      const fullState: CharacterRelationshipRecord[] = [];
      for (let i = 0; i < 48; i++) {
        fullState.push({
          source_character_id: `char-mock-${String(i).padStart(2, '0')}`,
          target_character_id: 'char-player',
          kind: 'TRUST',
          intensity: 2,
        });
      }
      // Add one existing edge with char-npc-1
      fullState[0] = {
        source_character_id: 'char-player',
        target_character_id: 'char-npc-1',
        kind: 'DEPENDENCE',
        intensity: 2,
      };

      // 1. Attempting to create a 49th new relationship is rejected with STATE_LIMIT
      const resCreateBlocked = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'TRUST',
              delta: 1,
              rationale: 'New relationship when full',
            },
          ],
        },
        currentState: fullState,
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(resCreateBlocked.decisions[0].outcome).toBe('REJECTED');
      expect(resCreateBlocked.decisions[0].reason).toBe('STATE_LIMIT');
      expect(resCreateBlocked.decisions[0].after).toBeNull();

      // 2. Modifying an existing edge in a full state succeeds
      const resModifyAllowed = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'DEPENDENCE',
              delta: 1,
              rationale: 'Incrementing existing in full state',
            },
          ],
        },
        currentState: fullState,
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(resModifyAllowed.decisions[0].outcome).toBe('APPLIED');
      expect(resModifyAllowed.decisions[0].after?.intensity).toBe(3);
    });

    it('evaluates ordered changes deterministically where later changes see earlier changes', () => {
      // Turn with 2 changes to same edge: +1 (creates at 1), then +1 (increments to 2)
      const receipt = resolveCharacterRelationships({
        proposal: {
          changes: [
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'LEVERAGE',
              delta: 1,
              rationale: 'Discovered leverage',
            },
            {
              source_character_id: 'char-player',
              target_character_id: 'char-npc-1',
              kind: 'LEVERAGE',
              delta: 1,
              rationale: 'Solidified leverage',
            },
          ],
        },
        currentState: [],
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(receipt.decisions).toHaveLength(2);
      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.decisions[0].before).toBeNull();
      expect(receipt.decisions[0].after?.intensity).toBe(1);

      expect(receipt.decisions[1].outcome).toBe('APPLIED');
      expect(receipt.decisions[1].before?.intensity).toBe(1);
      expect(receipt.decisions[1].after?.intensity).toBe(2);

      expect(receipt.post_state).toEqual([
        {
          source_character_id: 'char-player',
          target_character_id: 'char-npc-1',
          kind: 'LEVERAGE',
          intensity: 2,
        },
      ]);
    });
  });

  describe('Receipt Integrity & Immutability', () => {
    it('returns a valid receipt on empty proposal without modifying state', () => {
      const initial: CharacterRelationshipState = [
        {
          source_character_id: 'char-player',
          target_character_id: 'char-npc-1',
          kind: 'TRUST',
          intensity: 2,
        },
      ];

      const receipt = resolveCharacterRelationships({
        proposal: { changes: [] },
        currentState: initial,
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      expect(receipt.version).toBe(1);
      expect(receipt.pre_state).toEqual(initial);
      expect(receipt.post_state).toEqual(initial);
      expect(receipt.decisions).toEqual([]);

      const parsed = CharacterRelationshipReceiptSchema.safeParse(receipt);
      expect(parsed.success).toBe(true);
    });

    it('preserves deep-frozen inputs and outputs a valid CharacterRelationshipReceipt', () => {
      const initial: CharacterRelationshipState = [
        {
          source_character_id: 'char-player',
          target_character_id: 'char-npc-1',
          kind: 'TRUST',
          intensity: 1,
        },
      ];
      const proposal: CharacterRelationshipProposal = {
        changes: [
          {
            source_character_id: 'char-player',
            target_character_id: 'char-npc-1',
            kind: 'TRUST',
            delta: 1,
            rationale: 'Deep frozen test',
          },
        ],
      };

      deepFreeze(initial);
      deepFreeze(proposal);
      deepFreeze(mockContext);
      deepFreeze(mockIntentReceipt);
      deepFreeze(mockReconciliationReceipt);
      deepFreeze(mockCastInteractionReceipt);

      const receipt = resolveCharacterRelationships({
        proposal,
        currentState: initial,
        context: mockContext,
        intentReceipt: mockIntentReceipt,
        reconciliationReceipt: mockReconciliationReceipt,
        castInteractionReceipt: mockCastInteractionReceipt,
      });

      const parsed = CharacterRelationshipReceiptSchema.safeParse(receipt);
      expect(parsed.success).toBe(true);
      expect(receipt.post_state[0].intensity).toBe(2);
    });
  });
});
