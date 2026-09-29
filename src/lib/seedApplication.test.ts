import { describe, it, expect } from 'vitest';
import { applySeedToState, canRewriteUserCircumstance } from './seedApplication';
import type { Blueprint, CastMember } from '../types';
import type { EngineState } from '../core/engine/reducer';
import { initialEngineState } from '../core/engine/reducer';
import type { ScenarioOpeningState, SeedChargeBand } from '../types/forge';
import { DEFAULT_FEAR_CONTRACT } from '../types/fear';

describe('seedApplication', () => {
  const baseCast: CastMember[] = [
    {
      id: 'char-user',
      name: 'User Protagonist',
      role: 'PROTAGONIST',
      description: 'The protagonist',
      isUserCharacter: true,
      isEntity: false,
      seed: {
        where: 'cell_01',
        doing: { mode: 'ACTIVE', verb: 'INVESTIGATE' },
        condition: { restraint: { level: 'WRISTS_BOUND_FRONT' } },
        charge: { band: 'Mild Tension' },
        knows: [{ id: 'k1', text: 'The door is locked' }],
        bonds: [{ characterId: 'char-npc', stance: 'trust' }],
        circumstance: 'Strapped to an exam table',
        inclination: 'Loosen the straps',
      },
    },
    {
      id: 'char-npc',
      name: 'Dr. Robert',
      role: 'Villain',
      description: 'The surgeon',
      isUserCharacter: false,
      isEntity: false,
      seed: {
        where: 'prep_room',
        doing: { mode: 'ACTIVE', verb: 'CLOSE_IN' },
        condition: {},
        charge: { band: 'Severe Panic' }, // Floor 0.75 >= 0.70 threshold -> preyMode true
        knows: [{ id: 'k2', text: 'Subject is in cell_01' }],
        bonds: [],
        wants: {
          kind: 'pursuit',
          text: 'Pursue subject',
          groundedIn: ['k2'],
        },
      },
    },
  ] as unknown as CastMember[];

  const openingState: ScenarioOpeningState = {
    restraint: {
      bindings: {
        'char-user': { level: 'WRISTS_BOUND_FRONT' },
      },
      locks: {
        'door-cell': {
          targetRef: { kind: 'EDGE', id: 'edge-cell-prep' },
          locked: true,
          keyObjectId: 'iron_key',
        },
      },
    },
  };

  const blueprint: Blueprint = {
    id: 'test-bp',
    title: 'Test Blueprint',
    identity: {
      title: 'Test Blueprint',
      version: '1.0',
      author: 'Test Author',
      thematicAnchor: 'Test Anchor',
    },
    topology: {
      startingNodeId: 'cell_01',
      nodes: ['cell_01', 'prep_room'],
      nodeDefinitions: [
        { id: 'cell_01', label: 'Cell 01' },
        { id: 'prep_room', label: 'Prep Room' },
      ],
      connections: [],
      anchors: [],
    },
    cast: baseCast,
    openingState,
  } as unknown as Blueprint;

  it('applies opening state and character seeds in strict deterministic order', () => {
    const state = applySeedToState(initialEngineState, blueprint);

    // 1. openingState applied
    expect(state.restraintLedger?.locks['door-cell']).toEqual({
      targetRef: { kind: 'EDGE', id: 'edge-cell-prep' },
      locked: true,
      keyObjectId: 'iron_key',
    });

    // 2. Cast placement
    expect(state.castPlacement?.['char-user']).toBe('cell_01');
    expect(state.castPlacement?.['char-npc']).toBe('prep_room');

    // 3. User circumstance & inclination
    expect(state.userCircumstance).toBe('Strapped to an exam table');
    expect(state.userInclination).toBe('Loosen the straps');

    // 4. NPC wants
    expect(state.characterWants?.['char-npc']).toEqual({
      kind: 'pursuit',
      text: 'Pursue subject',
      groundedIn: ['k2'],
    });

    // 5. Condition restraint
    expect(state.restraintLedger?.bindings['char-user']?.level).toBe('WRISTS_BOUND_FRONT');

    // 6. Charge with somatic band floor and derived preyMode
    const userSalience = state.salienceLedger?.['char-user'];
    expect(userSalience?.dread).toBe(0.25); // Mild Tension floor is 0.25
    expect(userSalience?.spike).toBe(0);
    expect(userSalience?.preyMode).toBe(false);

    const npcSalience = state.salienceLedger?.['char-npc'];
    expect(npcSalience?.dread).toBe(0.75); // Severe Panic floor is 0.75
    expect(npcSalience?.spike).toBe(0);
    expect(npcSalience?.preyMode).toBe(true); // >= 0.70 threshold

    // 7. knows and bonds with SEED provenance
    expect(state.knowledgeByCharacter?.['char-user']).toHaveLength(1);
    expect(state.knowledgeByCharacter?.['char-user'][0]).toMatchObject({
      id: 'k1',
      text: 'The door is locked',
      provenance: 'SEED',
    });

    expect(state.bondEdges).toHaveLength(1);
    expect(state.bondEdges?.[0]).toMatchObject({
      fromCharacterId: 'char-user',
      toCharacterId: 'char-npc',
      stance: 'trust',
      provenance: 'SEED',
    });

    // 8. Receipts recorded
    expect(state.seedReceipts?.length).toBeGreaterThan(0);
    expect(state.seedReceipts?.every((r) => r.provenance === 'SEED')).toBe(true);
  });

  it('correctly maps all five somatic charge bands to dread floors from contract constants', () => {
    const bands: Array<{ band: SeedChargeBand; expectedDread: number; expectedPreyMode: boolean }> = [
      { band: 'calm', expectedDread: 0.0, expectedPreyMode: false },
      { band: 'Mild Tension', expectedDread: DEFAULT_FEAR_CONTRACT.somaticBands.band1, expectedPreyMode: false },
      { band: 'Acute Fear', expectedDread: DEFAULT_FEAR_CONTRACT.somaticBands.band2, expectedPreyMode: false },
      { band: 'Severe Panic', expectedDread: DEFAULT_FEAR_CONTRACT.somaticBands.band3, expectedPreyMode: true },
      { band: 'Breaking Point', expectedDread: DEFAULT_FEAR_CONTRACT.somaticBands.band4, expectedPreyMode: true },
    ];

    for (const { band, expectedDread, expectedPreyMode } of bands) {
      const singleCastBp: Blueprint = {
        ...blueprint,
        cast: [
          {
            ...baseCast[0],
            seed: {
              ...baseCast[0].seed!,
              charge: { band },
            },
          },
        ],
      };

      const result = applySeedToState(initialEngineState, singleCastBp);
      const salience = result.salienceLedger?.['char-user'];
      expect(salience?.dread).toBe(expectedDread);
      expect(salience?.spike).toBe(0);
      expect(salience?.preyMode).toBe(expectedPreyMode);
    }
  });

  describe('canRewriteUserCircumstance', () => {
    it('returns false for undefined or unauthorized caller', () => {
      expect(canRewriteUserCircumstance()).toBe(false);
      expect(canRewriteUserCircumstance({})).toBe(false);
      expect(canRewriteUserCircumstance({ role: 'PLAYER' })).toBe(false);
    });

    it('returns true for Director seat or userConfirmed', () => {
      expect(canRewriteUserCircumstance({ isDirector: true })).toBe(true);
      expect(canRewriteUserCircumstance({ role: 'DIRECTOR' })).toBe(true);
      expect(canRewriteUserCircumstance({ role: 'director' })).toBe(true);
      expect(canRewriteUserCircumstance({ userConfirmed: true })).toBe(true);
    });
  });

  describe('Mid-run re-seed layering and Director protection', () => {
    it('protects user circumstance mid-run from unauthorized rewrites', () => {
      const midRunState: EngineState = {
        ...initialEngineState,
        turnCount: 3,
        userCircumstance: 'Original circumstance',
        userInclination: 'Original inclination',
      };

      const updatedBlueprint: Blueprint = {
        ...blueprint,
        cast: [
          {
            ...baseCast[0],
            seed: {
              ...baseCast[0].seed!,
              circumstance: 'Attempted hijack circumstance',
              inclination: 'Attempted hijack inclination',
            },
          },
          baseCast[1],
        ],
      };

      // Without Director privileges: must throw hard error
      expect(() =>
        applySeedToState(midRunState, updatedBlueprint, {
          caller: { role: 'SPECTATOR' },
        })
      ).toThrow(/restricted to the Director seat/);

      // With Director privileges: allowed to proceed
      const authResult = applySeedToState(midRunState, updatedBlueprint, {
        caller: { isDirector: true },
      });
      expect(authResult.userCircumstance).toBe('Attempted hijack circumstance');
      expect(authResult.userInclination).toBe('Attempted hijack inclination');
    });

    it('layers re-seed data over existing state without wiping existing unseeded entries', () => {
      const midRunState: EngineState = {
        ...initialEngineState,
        turnCount: 2,
        castPlacement: { 'char-user': 'cell_01', 'char-third-party': 'attic' },
        knowledgeByCharacter: {
          'char-user': [{ id: 'mid-run-fact', text: 'Discovered a secret', provenance: 'DISCOVERY' }],
        },
      };

      const reseedResult = applySeedToState(midRunState, blueprint);
      // Existing placement of third party preserved
      expect(reseedResult.castPlacement?.['char-third-party']).toBe('attic');
      // Existing knowledge preserved alongside newly seeded knowledge
      const userKnowledge = reseedResult.knowledgeByCharacter?.['char-user'];
      expect(userKnowledge?.some((k) => k.id === 'mid-run-fact')).toBe(true);
      expect(userKnowledge?.some((k) => k.id === 'k1')).toBe(true);
    });
  });
});
