import { describe, it, expect } from 'vitest';
import { validateSeed, validateScenarioOpeningState } from './seedValidation';
import type { CharacterSeed, ScenarioOpeningState } from '../types/forge';
import type { Blueprint, CastMember } from '../types';

describe('seedValidation', () => {
  const baseCast: CastMember[] = [
    {
      id: 'char-user',
      name: 'User Protagonist',
      role: 'PROTAGONIST',
      description: 'The protagonist',
      isUserCharacter: true,
      isEntity: false,
    },
    {
      id: 'char-villain',
      name: 'The Stalker',
      role: 'VILLAIN',
      description: 'The antagonist',
      isUserCharacter: false,
      isEntity: false,
      disposition: 'VILLAIN',
    },
    {
      id: 'char-ally',
      name: 'An Ally',
      role: 'SURVIVOR',
      description: 'A friendly survivor',
      isUserCharacter: false,
      isEntity: false,
      disposition: 'SURVIVOR',
    },
  ] as unknown as CastMember[];

  const topologyNodeIds = new Set(['room_a', 'room_b', 'room_c']);

  const baseBlueprint: Blueprint = {
    id: 'test-bp',
    title: 'Test Blueprint',
    identity: {
      title: 'Test Blueprint',
      version: '1.0',
      author: 'Test Author',
      thematicAnchor: 'Test Anchor',
    },
    topology: {
      startingNodeId: 'room_a',
      nodes: ['room_a', 'room_b', 'room_c'],
      nodeDefinitions: [
        { id: 'room_a', label: 'Room A' },
        { id: 'room_b', label: 'Room B' },
        { id: 'room_c', label: 'Room C' },
      ],
      connections: [],
      anchors: [],
    },
    cast: baseCast,
  } as unknown as Blueprint;

  const createTestSeed = (overrides: Partial<CharacterSeed> = {}): CharacterSeed => ({
    where: 'room_a',
    doing: { mode: 'SUSPENDED' },
    condition: {},
    charge: { band: 'calm' },
    knows: [],
    bonds: [],
    ...overrides,
  });

  describe('validateSeed - Seed-vs-Blueprint', () => {
    it('rejects unknown where node', () => {
      const seed = createTestSeed({
        where: 'nonexistent_room',
        circumstance: 'Alone in the dark',
        inclination: 'Survive',
      });
      const res = validateSeed(seed, baseCast[0], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('does not exist in topology'))).toBe(true);
    });

    it('rejects condition restraint binder not in cast', () => {
      const seed = createTestSeed({
        where: 'room_a',
        condition: {
          restraint: {
            level: 'WRISTS_BOUND_FRONT',
            boundByCharacterId: 'ghost-binder',
          },
        },
        circumstance: 'Bound to a chair',
        inclination: 'Escape',
      });
      const res = validateSeed(seed, baseCast[0], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('boundByCharacterId "ghost-binder" not found in cast'))).toBe(true);
    });

    it('rejects condition restraint tiedToNodeId not in topology', () => {
      const seed = createTestSeed({
        where: 'room_a',
        condition: {
          restraint: {
            level: 'TIED_TO_FIXTURE',
            tiedToNodeId: 'void_node',
          },
        },
        circumstance: 'Tied',
        inclination: 'Escape',
      });
      const res = validateSeed(seed, baseCast[0], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('tiedToNodeId "void_node" not found in topology'))).toBe(true);
    });

    it('rejects bond referencing unknown character ID', () => {
      const seed = createTestSeed({
        bonds: [{ characterId: 'missing-friend', stance: 'trust' }],
        circumstance: 'Waiting',
        inclination: 'Wait',
      });
      const res = validateSeed(seed, baseCast[0], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('unknown character ID "missing-friend"'))).toBe(true);
    });

    it('warns on dramatic inconsistency when binder is seeded at a different node', () => {
      const castWithSeeds: CastMember[] = [
        {
          ...baseCast[0],
        },
        {
          ...baseCast[1],
          seed: createTestSeed({
            where: 'room_b', // Villain is in room_b
            doing: { mode: 'ACTIVE', verb: 'INVESTIGATE' },
            wants: { kind: 'state', text: 'Hunt' },
          }),
        },
      ];

      const userSeed = createTestSeed({
        where: 'room_a', // User is in room_a
        condition: {
          restraint: {
            level: 'WRISTS_BOUND_FRONT',
            boundByCharacterId: 'char-villain',
          },
        },
        circumstance: 'Bound by villain',
        inclination: 'Escape',
      });

      const res = validateSeed(userSeed, castWithSeeds[0], baseBlueprint, castWithSeeds, topologyNodeIds);
      expect(res.valid).toBe(true); // Warning does not invalidate
      expect(res.warnings.some((w) => w.includes('Dramatic inconsistency'))).toBe(true);
    });
  });

  describe('validateSeed - Seed-vs-Seed (S4a Invariants)', () => {
    it('detects bilocation when routine step node differs from seed.where', () => {
      const blueprintWithRoutines = {
        ...baseBlueprint,
        routines: [
          {
            routineId: 'patrol',
            characterId: 'char-villain',
            steps: [
              { stepNumber: 1, actionSummary: 'Guard B', nodeId: 'room_b' },
            ],
          },
        ],
      };

      const seed = createTestSeed({
        where: 'room_a', // Located at room_a
        doing: {
          mode: 'ACTIVE',
          verb: 'INVESTIGATE',
          routineStep: '1', // Step 1 is in room_b!
        },
        wants: { kind: 'state', text: 'Patrol' },
      });

      const res = validateSeed(seed, baseCast[1], blueprintWithRoutines, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('Bilocation violation'))).toBe(true);
    });

    it('rejects ACTIVE doing mode without a verb', () => {
      const seed = createTestSeed({
        doing: { mode: 'ACTIVE' },
        wants: { kind: 'state', text: 'Do things' },
      });
      const res = validateSeed(seed, baseCast[1], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('without a declared verb'))).toBe(true);
    });

    it('rejects ACTIVE doing mode with unrecognized verb', () => {
      const seed = createTestSeed({
        doing: { mode: 'ACTIVE', verb: 'FLY_AWAY' },
        wants: { kind: 'state', text: 'Do things' },
      });
      const res = validateSeed(seed, baseCast[1], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('not a recognized restraint-gated verb'))).toBe(true);
    });

    it('rejects ACTIVE doing mode with verb denied by restraint level', () => {
      const seed = createTestSeed({
        condition: {
          restraint: { level: 'TIED_TO_FIXTURE' }, // TIED_TO_FIXTURE denies PICK_LOCK
        },
        doing: { mode: 'ACTIVE', verb: 'PICK_LOCK' },
        wants: { kind: 'state', text: 'Pick lock' },
      });
      const res = validateSeed(seed, baseCast[1], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('Restraint denied'))).toBe(true);
    });

    it('allows ACTIVE doing mode with verb permitted under restraint level', () => {
      const seed = createTestSeed({
        condition: {
          restraint: { level: 'WRISTS_BOUND_FRONT' }, // WRISTS_BOUND_FRONT permits INVESTIGATE
        },
        doing: { mode: 'ACTIVE', verb: 'INVESTIGATE' },
        wants: { kind: 'state', text: 'Look around' },
      });
      const res = validateSeed(seed, baseCast[1], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('rejects SUSPENDED doing mode declaring a verb', () => {
      const seed = createTestSeed({
        doing: { mode: 'SUSPENDED', verb: 'INVESTIGATE' },
        wants: { kind: 'state', text: 'Sleep' },
      });
      const res = validateSeed(seed, baseCast[1], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('cannot declare a verb in SUSPENDED doing mode'))).toBe(true);
    });

    it('rejects ACTIVE doing mode declaring oneShot', () => {
      const seed = createTestSeed({
        doing: { mode: 'ACTIVE', verb: 'INVESTIGATE', oneShot: { label: 'Quick check' } },
        wants: { kind: 'state', text: 'Look' },
      });
      const res = validateSeed(seed, baseCast[1], baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('cannot declare oneShot in ACTIVE doing mode'))).toBe(true);
    });
  });

  describe('validateSeed - Seed-vs-Seed (S4b Law 6 Grounding)', () => {
    it('hard-errors when opposition NPC pursuit wants has empty groundedIn citations', () => {
      const oppositionMember: CastMember = {
        ...baseCast[1],
        role: 'INVESTIGATOR',
        name: 'Lead Investigator',
      };
      const seed = createTestSeed({
        doing: { mode: 'ACTIVE', verb: 'CLOSE_IN' },
        wants: {
          kind: 'pursuit',
          text: 'Pursue target',
          groundedIn: [], // Empty!
        },
      });
      const res = validateSeed(seed, oppositionMember, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('requires non-empty groundedIn citations'))).toBe(true);
    });

    it('hard-errors when opposition NPC pursuit wants cites unresolvable knowledge ID', () => {
      const oppositionMember: CastMember = {
        ...baseCast[1],
        role: 'INVESTIGATOR',
        name: 'Lead Investigator',
      };
      const seed = createTestSeed({
        doing: { mode: 'ACTIVE', verb: 'CLOSE_IN' },
        knows: [{ id: 'known_fact_1', text: 'Fact 1' }],
        wants: {
          kind: 'pursuit',
          text: 'Pursue target',
          groundedIn: ['unknown_fact_99'], // Unresolvable!
        },
      });
      const res = validateSeed(seed, oppositionMember, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('cites unresolvable knowledge ID(s): unknown_fact_99'))).toBe(true);
    });

    it('accepts opposition NPC pursuit wants with valid knowledge citations', () => {
      const oppositionMember: CastMember = {
        ...baseCast[1],
        role: 'INVESTIGATOR',
        name: 'Lead Investigator',
      };
      const seed = createTestSeed({
        doing: { mode: 'ACTIVE', verb: 'CLOSE_IN' },
        knows: [{ id: 'victim_last_seen', text: 'Victim was seen entering room_a' }],
        wants: {
          kind: 'pursuit',
          text: 'Pursue victim',
          groundedIn: ['victim_last_seen'],
        },
      });
      const res = validateSeed(seed, oppositionMember, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('warns instead of hard-erroring when non-opposition NPC pursuit is ungrounded', () => {
      const allyMember: CastMember = {
        ...baseCast[2], // SURVIVOR (non-opposition)
      };
      const seed = createTestSeed({
        doing: { mode: 'ACTIVE', verb: 'CLOSE_IN' },
        wants: {
          kind: 'pursuit',
          text: 'Search for help',
          groundedIn: [],
        },
      });
      const res = validateSeed(seed, allyMember, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(true); // Warning only for non-opposition
      expect(res.warnings.some((w) => w.includes('requires non-empty groundedIn citations'))).toBe(true);
    });

    it('exempts user character from Law 6 pursuit grounding', () => {
      const userMember = baseCast[0];
      const seed = createTestSeed({
        circumstance: 'Trapped',
        inclination: 'Break free',
      });
      const res = validateSeed(seed, userMember, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.warnings).toHaveLength(0);
    });
  });

  describe('validateScenarioOpeningState', () => {
    it('passes for undefined openingState', () => {
      const res = validateScenarioOpeningState(undefined, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('errors when restraint binds an unknown character ID', () => {
      const openingState: ScenarioOpeningState = {
        restraint: {
          bindings: {
            'ghost-char': { level: 'WRISTS_BOUND_FRONT' },
          },
        },
      };
      const res = validateScenarioOpeningState(openingState, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('unknown character ID "ghost-char"'))).toBe(true);
    });

    it('errors when restraint has invalid level', () => {
      const openingState: ScenarioOpeningState = {
        restraint: {
          bindings: {
            'char-user': { level: 'SUPER_TIED' },
          },
        },
      };
      const res = validateScenarioOpeningState(openingState, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('invalid restraint level "SUPER_TIED"'))).toBe(true);
    });

    it('errors when boundByCharacterId not in cast', () => {
      const openingState: ScenarioOpeningState = {
        restraint: {
          bindings: {
            'char-user': { level: 'WRISTS_BOUND_FRONT', boundByCharacterId: 'ghost-binder' },
          },
        },
      };
      const res = validateScenarioOpeningState(openingState, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('boundByCharacterId "ghost-binder" not found in cast'))).toBe(true);
    });

    it('errors when tiedToNodeId not in topology', () => {
      const openingState: ScenarioOpeningState = {
        restraint: {
          bindings: {
            'char-user': { level: 'TIED_TO_FIXTURE', tiedToNodeId: 'nonexistent-post' },
          },
        },
      };
      const res = validateScenarioOpeningState(openingState, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('tiedToNodeId "nonexistent-post" not found in topology'))).toBe(true);
    });

    it('passes for valid openingState', () => {
      const openingState: ScenarioOpeningState = {
        restraint: {
          bindings: {
            'char-user': {
              level: 'WRISTS_BOUND_FRONT',
              boundByCharacterId: 'char-villain',
              tiedToNodeId: 'room_a',
            },
          },
          locks: {
            'door_1': {
              targetRef: { kind: 'EDGE', id: 'edge-a-b' },
              locked: true,
              keyObjectId: 'key_rusty',
            },
          },
        },
      };
      const res = validateScenarioOpeningState(openingState, baseBlueprint, baseCast, topologyNodeIds);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  });
});
