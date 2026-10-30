import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveCampaignTransition,
  identifyLivingSurvivors,
  extractSurvivingCharacterContinuity,
  CAMPAIGN_PRUNED_EPHEMERAL_KEYS,
} from './campaignContinuity';
import * as campaignContinuityModule from './campaignContinuity';
import {
  createCampaignCarryoverWhitelist,
  CampaignTransitionReceiptSchema,
  CampaignCarryoverReceiptSchema,
} from '../types/campaignContinuity';
import { Blueprint } from '../types';
import { DeathRecord } from '../types/death';
import { engineReducer, initialEngineState, type EngineState } from '../core/engine/reducer';

describe('Campaign Continuity Transition Resolver (Item 17.2)', () => {
  const starlightMotelPath = path.resolve(__dirname, '../data/blueprints/starlight_motel.json');
  const silverRestPath = path.resolve(__dirname, '../data/blueprints/silver_rest_lodge.json');
  const mortuaryPath = path.resolve(__dirname, '../data/blueprints/black_iron_mortuary.json');

  const rawStarlight = JSON.parse(fs.readFileSync(starlightMotelPath, 'utf-8')) as Blueprint;
  const rawSilverRest = JSON.parse(fs.readFileSync(silverRestPath, 'utf-8')) as Blueprint;
  const rawMortuary = JSON.parse(fs.readFileSync(mortuaryPath, 'utf-8')) as Blueprint;

  // ==========================================================================
  // 1. identifyLivingSurvivors
  // ==========================================================================
  describe('identifyLivingSurvivors', () => {
    it('returns all candidate IDs when no deaths or fatal wounds have occurred', () => {
      const sourceState = {
        blueprintId: 'scenario-starlight',
        cast: [
          { id: 'char-tommy', disposition: 'SURVIVOR' },
          { id: 'char-elena', disposition: 'SURVIVOR' },
        ],
        deathRecords: [] as DeathRecord[],
      };

      const survivors = identifyLivingSurvivors(sourceState, ['char-tommy', 'char-elena']);
      expect(survivors).toEqual(['char-elena', 'char-tommy']);
    });

    it('filters out characters present in deathRecords', () => {
      const sourceState = {
        blueprintId: 'scenario-starlight',
        cast: [
          { id: 'char-tommy', disposition: 'SURVIVOR' },
          { id: 'char-elena', disposition: 'SURVIVOR' },
        ],
        deathRecords: [
          {
            id: 'death-001',
            characterId: 'char-elena',
            characterName: 'Elena Hayes',
            woundFactIds: ['w1'],
            primaryWoundFactId: 'w1',
            valence: 'murder' as const,
            declaredAtTurn: 10,
            declaredAtFictionalTime: 600,
            isPovDeath: false,
            isSacrifice: false,
          },
        ],
      };

      const survivors = identifyLivingSurvivors(sourceState, ['char-tommy', 'char-elena']);
      expect(survivors).toEqual(['char-tommy']);
    });

    it('filters out characters explicitly marked isDead or disposition DEAD', () => {
      const sourceState = {
        blueprintId: 'scenario-starlight',
        cast: [
          { id: 'char-tommy', disposition: 'SURVIVOR' },
          { id: 'char-marcus', isDead: true },
          { id: 'char-rosa', disposition: 'DEAD' },
        ],
        deathRecords: [] as DeathRecord[],
      };

      const survivors = identifyLivingSurvivors(sourceState, ['char-tommy', 'char-marcus', 'char-rosa']);
      expect(survivors).toEqual(['char-tommy']);
    });

    it('infers survivors from sourceState.cast if candidateIds is empty or omitted', () => {
      const sourceState = {
        blueprintId: 'scenario-starlight',
        cast: [
          { id: 'char-tommy', disposition: 'SURVIVOR' },
          { id: 'char-rosa', isDead: true },
        ],
      };

      const survivors = identifyLivingSurvivors(sourceState);
      expect(survivors).toEqual(['char-tommy']);
    });
  });

  // ==========================================================================
  // 2. extractSurvivingCharacterContinuity
  // ==========================================================================
  describe('extractSurvivingCharacterContinuity', () => {
    const mockState = {
      blueprintId: 'scenario-motel',
      turnCount: 8,
      player_character_id: 'char-tommy',
      dramaturgyState: {
        characterStakes: {
          'char-tommy': {
            characterId: 'char-tommy',
            currentComposure: 42,
          },
        },
      },
      capabilityLedger: {
        'char-tommy': {
          impairedCapabilities: ['VOCAL_FULL', 'GRIP_FINE'],
        },
      },
      characterScars: {
        'char-tommy': ['Gouge on right forearm'],
      },
      player_injuries: ['Cracked ribs from hallway grapple'],
      value_state_ledger: {
        'val-tommy-trust': {
          anchorId: 'val-tommy-trust',
          condition: 'COMPROMISED' as const,
          lifecycle: 'ACTIVE' as const,
          currentFormNote: 'Trust eroded after motel betrayal',
          lastCauseReference: 'BETRAYAL',
          lastChangedTurn: 6,
          holder: { kind: 'CHARACTER', castMemberId: 'char-tommy' },
        },
      },
      bondEdges: [
        {
          fromCharacterId: 'char-tommy',
          toCharacterId: 'char-rosa',
          stance: 'trust' as const,
          provenance: 'SEED',
          note: 'Shared escape pact',
        },
        {
          fromCharacterId: 'char-tommy',
          toCharacterId: 'char-dead-npc',
          stance: 'distrust' as const,
          provenance: 'SEED',
        },
      ],
    };

    it('extracts all whitelisted continuity fields when flags are true', () => {
      const whitelist = createCampaignCarryoverWhitelist(['char-tommy', 'char-rosa']);
      const livingSurvivors = new Set(['char-tommy', 'char-rosa']);

      const continuity = extractSurvivingCharacterContinuity(
        mockState,
        'char-tommy',
        whitelist,
        livingSurvivors
      );

      expect(continuity.characterId).toBe('char-tommy');
      expect(continuity.composure).toBe(42);
      expect(continuity.scars).toEqual([
        'Cracked ribs from hallway grapple',
        'Gouge on right forearm',
      ]);
      expect(continuity.impairedCapabilities).toEqual(['GRIP_FINE', 'VOCAL_FULL']);
      expect(continuity.valueAnchors).toHaveLength(1);
      expect(continuity.valueAnchors[0].condition).toBe('COMPROMISED');
      // Epistemic containment: bond to living survivor 'char-rosa' is preserved,
      // but bond to dead 'char-dead-npc' is strictly pruned!
      expect(continuity.bonds).toHaveLength(1);
      expect(continuity.bonds[0].targetCharacterId).toBe('char-rosa');
    });

    it('enforces whitelist flags: drops scars & resets composure when carryPsychologicalScars is false', () => {
      const whitelist = createCampaignCarryoverWhitelist(['char-tommy'], {
        carryPsychologicalScars: false,
      });
      const continuity = extractSurvivingCharacterContinuity(
        mockState,
        'char-tommy',
        whitelist,
        new Set(['char-tommy'])
      );

      expect(continuity.scars).toEqual([]);
      expect(continuity.composure).toBe(100);
    });

    it('enforces whitelist flags: drops impairments when carryPhysicalImpairments is false', () => {
      const whitelist = createCampaignCarryoverWhitelist(['char-tommy'], {
        carryPhysicalImpairments: false,
      });
      const continuity = extractSurvivingCharacterContinuity(
        mockState,
        'char-tommy',
        whitelist,
        new Set(['char-tommy'])
      );

      expect(continuity.impairedCapabilities).toEqual([]);
    });

    it('enforces whitelist flags: drops value shifts when carryValueShifts is false', () => {
      const whitelist = createCampaignCarryoverWhitelist(['char-tommy'], {
        carryValueShifts: false,
      });
      const continuity = extractSurvivingCharacterContinuity(
        mockState,
        'char-tommy',
        whitelist,
        new Set(['char-tommy'])
      );

      expect(continuity.valueAnchors).toEqual([]);
    });

    it('enforces whitelist flags: drops bonds when carryRelationshipBonds is false', () => {
      const whitelist = createCampaignCarryoverWhitelist(['char-tommy', 'char-rosa'], {
        carryRelationshipBonds: false,
      });
      const continuity = extractSurvivingCharacterContinuity(
        mockState,
        'char-tommy',
        whitelist,
        new Set(['char-tommy', 'char-rosa'])
      );

      expect(continuity.bonds).toEqual([]);
    });
  });

  // ==========================================================================
  // 3. resolveCampaignTransition Pure Determinism & Immutability
  // ==========================================================================
  describe('resolveCampaignTransition: Pure Determinism & Immutability', () => {
    const sourceState = {
      blueprintId: 'scenario-starlight-motel',
      turnCount: 12,
      sessionId: 'session-run-001',
      canonicalRevision: 4,
      player_character_id: 'char-tommy',
      cast: [
        { id: 'char-tommy', name: 'Tommy Beck', isUserCharacter: true, disposition: 'SURVIVOR' },
        { id: 'char-rosa', name: 'Rosa Flores', isUserCharacter: false, disposition: 'SURVIVOR' },
        { id: 'char-frank', name: 'Frank Mercer', isUserCharacter: false, disposition: 'VILLAIN' },
      ],
      dramaturgyState: {
        characterStakes: {
          'char-tommy': { characterId: 'char-tommy', currentComposure: 35 },
          'char-rosa': { characterId: 'char-rosa', currentComposure: 60 },
        },
      },
      capabilityLedger: {
        'char-tommy': { impairedCapabilities: ['VOCAL_FULL'] },
        'char-rosa': { impairedCapabilities: ['LOCOMOTION_RAPID'] },
      },
      traumaLedger: ['Chemical burn on forearm', 'Acoustic dread in darkness'],
      value_state_ledger: {
        'val-survival-instinct': {
          anchorId: 'val-survival-instinct',
          condition: 'TRANSFORMED' as const,
          lifecycle: 'ACTIVE' as const,
          currentFormNote: 'Pure survival overriding old altruism',
          lastCauseReference: 'CLIMAX_ESCAPE',
          lastChangedTurn: 11,
          holder: { kind: 'CHARACTER', castMemberId: 'char-tommy' },
        },
      },
      bondEdges: [
        {
          fromCharacterId: 'char-tommy',
          toCharacterId: 'char-rosa',
          stance: 'trust' as const,
          provenance: 'SEED',
          note: 'Escaped together',
        },
      ],
      worldObjectLedger: {
        'obj-lighter': {
          objectId: 'obj-lighter',
          name: 'Brass Zippo Lighter',
          location: { kind: 'CARRIER' as const, id: 'char-tommy' },
          sizeClass: 'LIGHT' as const,
          affordances: ['illuminate', 'ignite'],
          effects: [],
        },
        'obj-room-6-bed': {
          objectId: 'obj-room-6-bed',
          name: 'Motel Bed',
          location: { kind: 'NODE' as const, id: 'room_6' },
          sizeClass: 'HEAVY' as const,
          affordances: ['hide_under'],
          effects: [],
        },
      },
    };

    it('produces deeply equal results across repeated runs (Strict Determinism)', () => {
      const whitelist = ['char-tommy', 'char-rosa'];
      const run1 = resolveCampaignTransition(sourceState, rawSilverRest, whitelist);
      const run2 = resolveCampaignTransition(sourceState, rawSilverRest, whitelist);

      expect(run1).toEqual(run2);
      expect(run1.receipt).toEqual(run2.receipt);
      expect(run1.carryoverReceipt).toEqual(run2.carryoverReceipt);
      expect(run1.nextState.spatialGraph).toEqual(run2.nextState.spatialGraph);
      expect(run1.nextState.traumaLedger).toEqual(run2.nextState.traumaLedger);
    });

    it('preserves complete immutability: zero mutations to sourceState or targetBlueprint', () => {
      const sourceSnapshot = JSON.parse(JSON.stringify(sourceState));
      const targetSnapshot = JSON.parse(JSON.stringify(rawSilverRest));

      const whitelist = ['char-tommy', 'char-rosa'];
      resolveCampaignTransition(sourceState, rawSilverRest, whitelist);

      expect(sourceState).toEqual(sourceSnapshot);
      expect(rawSilverRest).toEqual(targetSnapshot);
    });

    it('strictly avoids non-deterministic Date.now() / Math.random() in receipts and state', () => {
      const whitelist = ['char-tommy', 'char-rosa'];
      const result = resolveCampaignTransition(sourceState, rawSilverRest, whitelist);

      expect(result.receipt.receiptId).toBe(
        'receipt-campaign-scenario-starlight-motel-blueprint-silver-rest-lodge-turn-12'
      );
      expect(result.receipt.timestamp).toBe(
        'transition-turn-12-scenario-starlight-motel-to-blueprint-silver-rest-lodge'
      );
      expect(result.carryoverReceipt.receiptId).toBe(
        'carryover-campaign-scenario-starlight-motel-blueprint-silver-rest-lodge-turn-12'
      );
    });
  });

  // ==========================================================================
  // 4. Survival Scenarios: Full vs Partial vs Total Wipeout
  // ==========================================================================
  describe('Survival Scenarios', () => {
    const baseSource = {
      blueprintId: 'scenario-mortuary',
      turnCount: 15,
      cast: [
        { id: 'char-elena', name: 'Elena', disposition: 'SURVIVOR' },
        { id: 'char-marcus', name: 'Marcus', disposition: 'SURVIVOR' },
        { id: 'char-claire', name: 'Claire', disposition: 'SURVIVOR' },
      ],
      dramaturgyState: {
        characterStakes: {
          'char-elena': { characterId: 'char-elena', currentComposure: 50 },
          'char-marcus': { characterId: 'char-marcus', currentComposure: 30 },
          'char-claire': { characterId: 'char-claire', currentComposure: 75 },
        },
      },
    };

    it('Full survival: carries all whitelisted characters and sets start location in new blueprint', () => {
      const result = resolveCampaignTransition(baseSource, rawMortuary, [
        'char-elena',
        'char-marcus',
        'char-claire',
      ]);

      expect(result.receipt.carriedCharacters).toHaveLength(3);
      expect(result.receipt.carriedCharacters.map((c) => c.characterId)).toEqual([
        'char-claire',
        'char-elena',
        'char-marcus',
      ]);

      const targetEntryNode = result.nextState.currentNodeId;
      expect(targetEntryNode).toBeDefined();
      expect(result.nextState.castPlacement?.['char-elena']).toBe(targetEntryNode);
      expect(result.nextState.castPlacement?.['char-marcus']).toBe(targetEntryNode);
      expect(result.nextState.castPlacement?.['char-claire']).toBe(targetEntryNode);
    });

    it('Partial survival: excludes dead characters from carryover even if in whitelist', () => {
      const stateWithCasualties = {
        ...baseSource,
        deathRecords: [
          {
            id: 'death-marcus',
            characterId: 'char-marcus',
            characterName: 'Marcus',
            woundFactIds: ['w1'],
            primaryWoundFactId: 'w1',
            valence: 'accident' as const,
            declaredAtTurn: 14,
            declaredAtFictionalTime: 840,
            isPovDeath: false,
            isSacrifice: false,
          },
        ],
      };

      const result = resolveCampaignTransition(stateWithCasualties, rawMortuary, [
        'char-elena',
        'char-marcus',
        'char-claire',
      ]);

      // Marcus died, so only Elena and Claire survive!
      expect(result.receipt.carriedCharacters).toHaveLength(2);
      expect(result.receipt.carriedCharacters.map((c) => c.characterId)).toEqual([
        'char-claire',
        'char-elena',
      ]);
      expect(result.nextState.castPlacement?.['char-marcus']).toBeUndefined();
    });

    it('Total wipeout: zero survivors carried over, new scenario initializes cleanly with fresh cast', () => {
      const totalWipeoutState = {
        ...baseSource,
        deathRecords: [
          {
            id: 'death-elena',
            characterId: 'char-elena',
            characterName: 'Elena',
            woundFactIds: ['w1'],
            primaryWoundFactId: 'w1',
            valence: 'murder' as const,
            declaredAtTurn: 10,
            declaredAtFictionalTime: 600,
            isPovDeath: false,
            isSacrifice: false,
          },
          {
            id: 'death-marcus',
            characterId: 'char-marcus',
            characterName: 'Marcus',
            woundFactIds: ['w2'],
            primaryWoundFactId: 'w2',
            valence: 'accident' as const,
            declaredAtTurn: 12,
            declaredAtFictionalTime: 720,
            isPovDeath: false,
            isSacrifice: false,
          },
          {
            id: 'death-claire',
            characterId: 'char-claire',
            characterName: 'Claire',
            woundFactIds: ['w3'],
            primaryWoundFactId: 'w3',
            valence: 'sacrifice' as const,
            declaredAtTurn: 15,
            declaredAtFictionalTime: 900,
            isPovDeath: false,
            isSacrifice: true,
          },
        ],
      };

      const result = resolveCampaignTransition(totalWipeoutState, rawMortuary, [
        'char-elena',
        'char-marcus',
        'char-claire',
      ]);

      expect(result.receipt.carriedCharacters).toHaveLength(0);
      expect(result.carryoverReceipt.survivorCharacterIds).toHaveLength(0);
      expect(result.nextState.turnCount).toBe(0);
      expect(result.nextState.cast?.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 5. Schema Validation & Receipt Conformance
  // ==========================================================================
  describe('Receipt Schema Conformance', () => {
    it('validates CampaignTransitionReceipt against CampaignTransitionReceiptSchema', () => {
      const sourceState = {
        blueprintId: 'scenario-act-1',
        turnCount: 20,
        cast: [{ id: 'char-survivor-1', disposition: 'SURVIVOR' }],
        dramaturgyState: {
          characterStakes: {
            'char-survivor-1': { characterId: 'char-survivor-1', currentComposure: 66 },
          },
        },
      };

      const result = resolveCampaignTransition(sourceState, rawStarlight, ['char-survivor-1']);

      const parsedTransition = CampaignTransitionReceiptSchema.safeParse(result.receipt);
      expect(parsedTransition.success).toBe(true);

      const parsedCarryover = CampaignCarryoverReceiptSchema.safeParse(result.carryoverReceipt);
      expect(parsedCarryover.success).toBe(true);
    });

    it('contains all explicit pruned state keys in deterministic order', () => {
      const sourceState = {
        blueprintId: 'scenario-act-1',
        turnCount: 5,
        cast: [{ id: 'char-1' }],
      };

      const result = resolveCampaignTransition(sourceState, rawStarlight, ['char-1']);
      expect(result.receipt.prunedStateKeys).toEqual(Array.from(CAMPAIGN_PRUNED_EPHEMERAL_KEYS).sort());
      expect(result.carryoverReceipt.resetFields).toEqual(Array.from(CAMPAIGN_PRUNED_EPHEMERAL_KEYS).sort());
    });
  });

  // ==========================================================================
  // 6. Real Blueprint Transition: Starlight Motel -> Silver Rest Lodge
  // ==========================================================================
  describe('Real Canonical Blueprint Transition (Starlight Motel -> Silver Rest Lodge)', () => {
    it('transfers Tommy Beck with scars and vocal impairment, replacing motel topology with lodge topology', () => {
      const motelSourceState = {
        blueprintId: 'blueprint-starlight-motel',
        blueprintTitle: 'The Starlight Motel',
        turnCount: 16,
        player_character_id: 'char-tommy-beck',
        cast: [
          {
            id: 'char-tommy-beck',
            name: 'Tommy Beck',
            isUserCharacter: true,
            disposition: 'SURVIVOR',
          },
          {
            id: 'char-rosa-flores',
            name: 'Rosa Flores',
            isUserCharacter: false,
            disposition: 'SURVIVOR',
          },
          {
            id: 'char-frank-mercer',
            name: 'Frank Mercer',
            isUserCharacter: false,
            disposition: 'VILLAIN',
          },
        ],
        dramaturgyState: {
          characterStakes: {
            'char-tommy-beck': { characterId: 'char-tommy-beck', currentComposure: 45 },
            'char-rosa-flores': { characterId: 'char-rosa-flores', currentComposure: 60 },
          },
        },
        capabilityLedger: {
          'char-tommy-beck': { impairedCapabilities: ['VOCAL_FULL'] },
        },
        traumaLedger: ['Ligature scars on throat from room 6 assault'],
        value_state_ledger: {
          'val-motel-vigilance': {
            anchorId: 'val-motel-vigilance',
            condition: 'COMPROMISED' as const,
            lifecycle: 'ACTIVE' as const,
            currentFormNote: 'Hyper-vigilant after surviving the Mercers',
            lastCauseReference: 'ESCAPE',
            lastChangedTurn: 16,
            holder: { kind: 'CHARACTER', castMemberId: 'char-tommy-beck' },
          },
        },
        worldObjectLedger: {
          'obj-motel-key': {
            objectId: 'obj-motel-key',
            name: 'Room 6 Key',
            location: { kind: 'CARRIER' as const, id: 'char-tommy-beck' },
            sizeClass: 'LIGHT' as const,
            affordances: ['unlock'],
            effects: [],
          },
          'obj-motel-ice-machine': {
            objectId: 'obj-motel-ice-machine',
            name: 'Ice Machine',
            location: { kind: 'NODE' as const, id: 'ice_alley' },
            sizeClass: 'HEAVY' as const,
            affordances: [],
            effects: [],
          },
        },
      };

      const whitelist = createCampaignCarryoverWhitelist(['char-tommy-beck', 'char-rosa-flores']);
      const transitionResult = resolveCampaignTransition(
        motelSourceState,
        rawSilverRest,
        whitelist
      );

      const nextState = transitionResult.nextState;

      // 1. Cast includes carried survivors and lodge cast members
      const castIds = nextState.cast?.map((c) => c.id) || [];
      expect(castIds).toContain('char-tommy-beck');
      expect(castIds).toContain('char-rosa-flores');
      // Silver Rest Lodge host Laurent Moreau is in the cast
      expect(castIds.some((id) => id.includes('laurent') || id.includes('moreau'))).toBe(true);

      // 2. Composure preserved
      expect(
        nextState.dramaturgyState?.characterStakes?.['char-tommy-beck']?.currentComposure
      ).toBe(45);

      // 3. Physical capabilities preserved
      expect(
        nextState.capabilityLedger?.['char-tommy-beck']?.impairedCapabilities
      ).toEqual(['VOCAL_FULL']);

      // 4. Psychological scars preserved in traumaLedger
      expect(nextState.traumaLedger).toContain('Ligature scars on throat from room 6 assault');

      // 5. Value anchor carried into value_state_ledger
      expect(nextState.value_state_ledger?.['val-motel-vigilance']).toBeDefined();
      expect(nextState.value_state_ledger?.['val-motel-vigilance'].condition).toBe('COMPROMISED');

      // 6. Carried inventory: Room 6 key is in carrier inventory, but ice machine is destroyed!
      expect(nextState.worldObjectLedger?.['obj-motel-key']).toBeDefined();
      expect(nextState.worldObjectLedger?.['obj-motel-ice-machine']).toBeUndefined();

      // 7. Epistemic containment: Starlight Motel rooms (office, room_6) pruned, replaced by Lodge nodes
      const nodeIds = nextState.spatialGraph?.map((n) => n.id) || [];
      expect(nodeIds).not.toContain('room_6');
      expect(nodeIds).not.toContain('ice_alley');
      expect(nodeIds.length).toBeGreaterThan(0);

      // 8. Turn counter resets for new scenario act
      expect(nextState.turnCount).toBe(0);

      // 9. Campaign act history tracks transition
      expect(nextState.campaignActHistory).toHaveLength(1);
      const historyEntry = (nextState.campaignActHistory as Array<{ fromBlueprintId: string; toBlueprintId: string }>)[0];
      expect(historyEntry.fromBlueprintId).toBe('blueprint-starlight-motel');
      expect(historyEntry.toBlueprintId).toBe('blueprint-silver-rest-lodge');
    });
  });

  // ==========================================================================
  // 7. Engine Reducer CAMPAIGN_TRANSITION handling (Item 17.3)
  // ==========================================================================
  describe('Engine Reducer CAMPAIGN_TRANSITION handling (Item 17.3)', () => {
    it('handles CAMPAIGN_TRANSITION event, advancing to target blueprint state, clearing lastTurnCheckpoint, and attaching receipts', () => {
      const priorState = {
        ...initialEngineState,
        sessionId: 'session-old-001',
        blueprintId: 'scenario-motel',
        turnCount: 14,
        lastTurnCheckpoint: {
          version: 1 as const,
          commandText: 'Run to car',
          engineStateBefore: initialEngineState,
          engineGameStateBefore: null,
        },
        cast: [
          { id: 'char-tommy', name: 'Tommy', disposition: 'SURVIVOR', isUserCharacter: true },
          { id: 'char-rosa', name: 'Rosa', disposition: 'SURVIVOR' },
        ],
        dramaturgyState: {
          characterStakes: {
            'char-tommy': { characterId: 'char-tommy', currentComposure: 40 },
          },
        },
        capabilityLedger: {
          'char-tommy': { impairedCapabilities: ['VOCAL_FULL'] },
        },
        traumaLedger: ['Fractured wrist'],
        worldObjectLedger: {
          'obj-car-key': {
            objectId: 'obj-car-key',
            name: 'Car Key',
            location: { kind: 'CARRIER' as const, id: 'char-tommy' },
            sizeClass: 'LIGHT' as const,
            affordances: ['unlock'],
            effects: [],
          },
          'obj-room-chair': {
            objectId: 'obj-room-chair',
            name: 'Motel Chair',
            location: { kind: 'NODE' as const, id: 'room-1' },
            sizeClass: 'MEDIUM' as const,
            affordances: [],
            effects: [],
          },
        },
      };

      const whitelist = createCampaignCarryoverWhitelist(['char-tommy']);
      const nextState = engineReducer(priorState as unknown as EngineState, {
        type: 'CAMPAIGN_TRANSITION',
        targetBlueprint: rawSilverRest,
        whitelist,
      });

      expect(nextState.blueprintId).toBe('blueprint-silver-rest-lodge');
      expect(nextState.turnCount).toBe(0);
      expect(nextState.lastTurnCheckpoint).toBeNull();
      expect(nextState.campaignTransitionReceipt).toBeDefined();
      expect(nextState.campaignCarryoverReceipt).toBeDefined();
      expect(nextState.campaignTransitionReceipt?.carriedCharacters).toHaveLength(1);
      expect(nextState.campaignTransitionReceipt?.carriedCharacters[0].characterId).toBe('char-tommy');
      expect(nextState.dramaturgyState?.characterStakes?.['char-tommy']?.currentComposure).toBe(40);
      expect(nextState.capabilityLedger?.['char-tommy']?.impairedCapabilities).toEqual(['VOCAL_FULL']);
      expect(nextState.traumaLedger).toContain('Fractured wrist');
      expect(nextState.worldObjectLedger?.['obj-car-key']).toBeDefined();
      expect(nextState.worldObjectLedger?.['obj-room-chair']).toBeUndefined();
    });

    it('infers survivors from cast and deathRecords when event.whitelist is omitted', () => {
      const priorState = {
        ...initialEngineState,
        blueprintId: 'scenario-motel',
        turnCount: 8,
        cast: [
          { id: 'char-tommy', name: 'Tommy', disposition: 'SURVIVOR' },
          { id: 'char-rosa', name: 'Rosa', disposition: 'SURVIVOR' },
        ],
        deathRecords: [
          {
            id: 'death-rosa',
            characterId: 'char-rosa',
            characterName: 'Rosa',
            woundFactIds: ['w1'],
            primaryWoundFactId: 'w1',
            valence: 'murder' as const,
            declaredAtTurn: 7,
            declaredAtFictionalTime: 420,
            isPovDeath: false,
            isSacrifice: false,
          },
        ],
      };

      const nextState = engineReducer(priorState as unknown as EngineState, {
        type: 'CAMPAIGN_TRANSITION',
        targetBlueprint: rawMortuary,
      });

      // Rosa is dead in deathRecords, so only Tommy is carried forward!
      expect(nextState.campaignTransitionReceipt?.carriedCharacters.map((c) => c.characterId)).toEqual([
        'char-tommy',
      ]);
    });

    it('strictly prunes ephemeral keys from prior state', () => {
      const priorState = {
        ...initialEngineState,
        blueprintId: 'scenario-motel',
        locationTopology: { oldMap: true },
        obsoleteClocks: { clock1: 'ticking' },
        placedClues: ['bloody knife'],
        routineSchedules: { shift: 'night' },
        situatedPressureLedger: { threat: 'high' },
        sourceRoomNodes: ['room-1', 'room-2'],
        temporaryDecayMetrics: { frays: 5 },
        villainBindings: { stalker: 'active' },
        cast: [{ id: 'char-tommy' }],
      };

      const nextState = engineReducer(priorState as unknown as EngineState, {
        type: 'CAMPAIGN_TRANSITION',
        targetBlueprint: rawSilverRest,
      });

      for (const prunedKey of CAMPAIGN_PRUNED_EPHEMERAL_KEYS) {
        expect((nextState as unknown as Record<string, unknown>)[prunedKey]).toBeUndefined();
      }
    });
  });

  // ==========================================================================
  // 8. Constant Hygiene & Cap Semantics Invariant
  // ==========================================================================
  describe('Constant Hygiene & Cap Semantics Invariant', () => {
    it('ensures NO exported constant starts with MAX_ or ends with _LIMIT to prevent cap-semantics drift', () => {
      const exportedKeys = Object.keys(campaignContinuityModule);
      const capLikeConstants = exportedKeys.filter(
        (key) => key.startsWith('MAX_') || key.endsWith('_LIMIT')
      );
      expect(capLikeConstants).toEqual([]);
    });
  });
});
