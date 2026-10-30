import * as fs from 'fs';
import * as path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Blueprint, BlueprintSchema } from '../types';
import { useAppStore } from '../store/useAppStore';
import { buildEngineTurnContext } from '../lib/buildEngineTurnContext';
import { useEngineStore } from './store';
import {
  CampaignTransitionReceiptSchema,
  CampaignCarryoverReceiptSchema,
} from '../types/campaignContinuity';

const starlightMotelPath = path.resolve(__dirname, '../data/blueprints/starlight_motel.json');
const silverRestPath = path.resolve(__dirname, '../data/blueprints/silver_rest_lodge.json');
const mortuaryPath = path.resolve(__dirname, '../data/blueprints/black_iron_mortuary.json');

const rawStarlight = JSON.parse(fs.readFileSync(starlightMotelPath, 'utf-8')) as Blueprint;
const rawSilverRest = JSON.parse(fs.readFileSync(silverRestPath, 'utf-8')) as Blueprint;
const rawMortuary = JSON.parse(fs.readFileSync(mortuaryPath, 'utf-8')) as Blueprint;

describe('Engine blueprint ingress', () => {
  beforeEach(() => {
    useEngineStore.getState().resetEngine();
    useAppStore.getState().resetSession();
  });

  it('preserves the exact reference for an already canonical Blueprint', () => {
    const reviewedBlueprint = BlueprintSchema.parse({
      id: 'reviewed-blueprint',
      title: 'Reviewed Enclosure',
      identity: {
        title: 'Reviewed Enclosure',
        version: '1.0',
        author: 'Author',
        thematicAnchor: 'Containment',
      },
      setting: {
        location: 'Observation Deck',
        atmosphere: 'Cold fluorescents',
        timePeriod: 'Present',
      },
      cast: [],
      topology: { nodes: [], connections: [] },
    });

    useEngineStore.getState().setBlueprint(reviewedBlueprint, 'protagonist');

    expect(useEngineStore.getState().activeBlueprint).toBe(reviewedBlueprint);
  });

  it('normalizes a partial payload even when BlueprintSchema can supply defaults', () => {
    const partialBlueprint = { title: 'Legacy Intake' };

    expect(BlueprintSchema.safeParse(partialBlueprint).success).toBe(true);

    useEngineStore.getState().setBlueprint(partialBlueprint, 'protagonist');

    const activeBlueprint = useEngineStore.getState().activeBlueprint;
    expect(activeBlueprint).not.toBe(partialBlueprint);
    expect(activeBlueprint?.identity.title).toBe('Legacy Intake');
    expect(activeBlueprint?.cast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Unknown', role: 'Subject' }),
      ])
    );
    expect(activeBlueprint?.topology).toEqual({
      nodes: [],
      nodeDefinitions: [],
      connections: [],
      anchors: [],
    });
  });

  it('binds explicit selectedCharacterId correctly on setBlueprint', () => {
    const blueprint = BlueprintSchema.parse({
      id: 'bp-multi-cast',
      title: 'Multi-Cast Scenario',
      identity: {
        title: 'Multi-Cast Scenario',
        version: '1.0',
        author: 'Author',
        thematicAnchor: 'Testing',
      },
      setting: {
        location: 'Hall',
        atmosphere: 'Cold',
        timePeriod: 'Present',
      },
      cast: [
        {
          id: 'char-1',
          name: 'First Cast',
          role: 'Guard',
          description: 'Guard',
          personality: 'Alert',
          goals: 'Protect',
          traits: [],
          isEntity: false,
        },
        {
          id: 'char-2',
          name: 'Second Cast',
          role: 'Medic',
          description: 'Medic',
          personality: 'Gentle',
          goals: 'Heal',
          traits: [],
          isEntity: false,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'NODE_SELECTED' },
        },
      ],
      topology: {
        nodes: ['NODE_DEFAULT', 'NODE_SELECTED'],
        connections: [],
        startingNodeId: 'NODE_DEFAULT',
      },
    });

    useEngineStore.getState().setBlueprint(blueprint, 'protagonist', null, 'char-2');

    const gameState = useEngineStore.getState().gameState;
    expect(gameState?.player_role).toBe('protagonist');
    expect(gameState?.player_character_id).toBe('char-2');
    expect(gameState?.perspective_mode).toBe('embodied');
    const appState = useAppStore.getState();
    expect(appState.currentNodeId).toBe('NODE_SELECTED');

    const firstTurnContext = buildEngineTurnContext({
      blueprint,
      selectedRole: gameState?.player_role,
      selectedCharacterId: gameState?.player_character_id,
      spatialGraph: appState.spatialGraph,
      runtimeState: { currentNodeId: appState.currentNodeId },
    });
    expect(firstTurnContext.player.characterId).toBe('char-2');
    expect(firstTurnContext.topology.currentNodeId).toBe('NODE_SELECTED');
    expect(firstTurnContext.cast.find((member) => member.id === 'char-2')?.isPresent).toBe(true);
  });

  it('fails closed and preserves prior state if binding validation throws', () => {
    const blueprint = BlueprintSchema.parse({
      id: 'bp-multi-cast',
      title: 'Multi-Cast Scenario',
      identity: {
        title: 'Multi-Cast Scenario',
        version: '1.0',
        author: 'Author',
        thematicAnchor: 'Testing',
      },
      setting: {
        location: 'Hall',
        atmosphere: 'Cold',
        timePeriod: 'Present',
      },
      cast: [
        {
          id: 'char-1',
          name: 'First Cast',
          role: 'Guard',
          description: 'Guard',
          personality: 'Alert',
          goals: 'Protect',
          traits: [],
          isEntity: false,
        },
      ],
      topology: { nodes: ['HALL'], connections: [] },
    });

    expect(() => {
      useEngineStore.getState().setBlueprint(blueprint, 'protagonist', null, 'nonexistent-id');
    }).toThrow();

    // Store state remains null/unmutated
    expect(useEngineStore.getState().activeBlueprint).toBeNull();
    expect(useEngineStore.getState().gameState).toBeNull();
  });
});

describe('useEngineStore transitionCampaignScenario (Item 17.3)', () => {
  beforeEach(() => {
    useEngineStore.getState().resetEngine();
    useAppStore.getState().resetSession();
  });

  it('executes multi-blueprint campaign continuity from Starlight Motel to Silver Rest Lodge', () => {
    // 1. Initial scenario setup at Starlight Motel
    useEngineStore.getState().setBlueprint(rawStarlight, 'protagonist', null, 'char-tommy-beck');
    expect(useEngineStore.getState().activeBlueprint?.id).toBe('blueprint-starlight-motel');

    // 2. Simulate in-game events: turn progression, trauma, injuries, composure loss, value shift, items
    useAppStore.setState({
      turnCount: 16,
      lastTurnCheckpoint: {
        version: 1 as const,
        commandText: 'Flee motel',
        engineStateBefore: {} as unknown as import('./engine/reducer').RetakeRestorableEngineState,
        engineGameStateBefore: null,
      },
      dramaturgyState: {
        characterStakes: {
          'char-tommy-beck': {
            characterId: 'char-tommy-beck',
            coreDesireOrNeed: 'Survival',
            copingMechanism: 'Vigilance',
            breakingPointTrigger: 'Isolation',
            breakingPointThreshold: 20,
            isObstructed: false,
            liftConditions: [],
            composureSensitivity: 1.0,
            currentComposure: 45,
          },
          'char-rosa-flores': {
            characterId: 'char-rosa-flores',
            coreDesireOrNeed: 'Protect others',
            copingMechanism: 'Action',
            breakingPointTrigger: 'Helplessness',
            breakingPointThreshold: 25,
            isObstructed: false,
            liftConditions: [],
            composureSensitivity: 1.0,
            currentComposure: 60,
          },
        },
      },
      capabilityLedger: {
        'char-tommy-beck': {
          impairedCapabilities: ['VOCAL_FULL'],
          provenance: ['STRANGULATION'],
        },
      },
      traumaLedger: ['Ligature scars on neck', 'Chemical burn on right forearm'],
      worldObjectLedger: {
        'obj-zippo': {
          objectId: 'obj-zippo',
          name: 'Brass Zippo Lighter',
          location: { kind: 'CARRIER', id: 'char-tommy-beck' },
          sizeClass: 'LIGHT',
          affordances: ['ignite'],
          effects: [],
        },
        'obj-motel-ice-machine': {
          objectId: 'obj-motel-ice-machine',
          name: 'Ice Machine',
          location: { kind: 'NODE', id: 'ice_alley' },
          sizeClass: 'HEAVY',
          affordances: [],
          effects: [],
        },
      },
    });

    const currentGameState = useEngineStore.getState().gameState;
    if (currentGameState) {
      useEngineStore.getState().updateGameState({
        ...currentGameState,
        value_state_ledger: {
          ...currentGameState.value_state_ledger,
          'val-char-tommy-beck-survival': {
            anchorId: 'val-char-tommy-beck-survival',
            condition: 'TRANSFORMED',
            lifecycle: 'ACTIVE',
            currentFormNote: 'Steeled through near-death motel escape',
            lastCauseReference: 'ESCAPE',
            lastChangedTurn: 16,
          },
        },
      });
    }

    const activeSessionIdBefore = useEngineStore.getState().activeSessionId;
    expect(activeSessionIdBefore).toBeTruthy();

    // 3. Execute campaign transition to Silver Rest Lodge carrying living survivors
    const result = useEngineStore.getState().transitionCampaignScenario(
      rawSilverRest,
      ['char-tommy-beck', 'char-rosa-flores']
    );

    // 4. Verify receipts
    expect(CampaignTransitionReceiptSchema.safeParse(result.receipt).success).toBe(true);
    expect(CampaignCarryoverReceiptSchema.safeParse(result.carryoverReceipt).success).toBe(true);
    expect(result.receipt.sourceScenarioId).toBe('blueprint-starlight-motel');
    expect(result.receipt.targetBlueprintId).toBe('blueprint-silver-rest-lodge');
    expect(result.receipt.carriedCharacters.map((c) => c.characterId)).toEqual([
      'char-rosa-flores',
      'char-tommy-beck',
    ]);

    // 5. Verify useEngineStore updates
    const engine = useEngineStore.getState();
    expect(engine.activeBlueprint?.id).toBe('blueprint-silver-rest-lodge');
    expect(engine.activeSessionId).toBe(activeSessionIdBefore);
    expect(engine.lastTurnCheckpoint).toBeNull();
    expect(engine.gameState?.current_location).toBe(rawSilverRest.setting.location);
    expect(engine.gameState?.value_state_ledger?.['val-char-tommy-beck-survival']).toBeDefined();
    expect(engine.gameState?.value_state_ledger?.['val-char-tommy-beck-survival'].condition).toBe('TRANSFORMED');

    // 6. Verify useAppStore updates
    const app = useAppStore.getState();
    expect(app.blueprintId).toBe('blueprint-silver-rest-lodge');
    expect(app.turnCount).toBe(0);
    expect(app.lastTurnCheckpoint).toBeNull();

    // Composure preserved
    expect(app.dramaturgyState?.characterStakes?.['char-tommy-beck']?.currentComposure).toBe(45);
    expect(app.dramaturgyState?.characterStakes?.['char-rosa-flores']?.currentComposure).toBe(60);

    // Capability impairments preserved
    expect(app.capabilityLedger?.['char-tommy-beck']?.impairedCapabilities).toEqual(['VOCAL_FULL']);

    // Scars preserved in traumaLedger
    expect(app.traumaLedger).toContain('Ligature scars on neck');
    expect(app.traumaLedger).toContain('Chemical burn on right forearm');

    // Carried objects kept, room objects pruned
    expect(app.worldObjectLedger?.['obj-zippo']).toBeDefined();
    expect(app.worldObjectLedger?.['obj-motel-ice-machine']).toBeUndefined();

    // Topology: motel nodes pruned, lodge nodes present
    const nodeIds = app.spatialGraph.map((n) => n.id);
    expect(nodeIds).not.toContain('ice_alley');
    expect(nodeIds).not.toContain('room_6');
    expect(nodeIds.length).toBeGreaterThan(0);

    // Living survivors placed at target scenario entrance
    const targetEntry = app.currentNodeId;
    expect(app.castPlacement?.['char-tommy-beck']).toBe(targetEntry);
    expect(app.castPlacement?.['char-rosa-flores']).toBe(targetEntry);
  });

  it('executes sequential multi-blueprint transition across 3 acts tracking history', () => {
    // Act 1: Starlight Motel
    useEngineStore.getState().setBlueprint(rawStarlight, 'protagonist', null, 'char-tommy-beck');

    // Transition Act 1 -> Act 2: Silver Rest Lodge
    const result1 = useEngineStore.getState().transitionCampaignScenario(
      rawSilverRest,
      ['char-tommy-beck', 'char-rosa-flores']
    );
    expect(result1.receipt.targetBlueprintId).toBe('blueprint-silver-rest-lodge');

    // In Act 2, Rosa Flores suffers a fatal event
    useAppStore.setState({
      turnCount: 10,
      deathRecords: [
        {
          id: 'death-rosa',
          characterId: 'char-rosa-flores',
          characterName: 'Rosa Flores',
          woundFactIds: ['w1'],
          primaryWoundFactId: 'w1',
          valence: 'murder' as const,
          declaredAtTurn: 10,
          declaredAtFictionalTime: 600,
          isPovDeath: false,
          isSacrifice: false,
        },
      ],
    });

    // Transition Act 2 -> Act 3: Black Iron Mortuary
    const result2 = useEngineStore.getState().transitionCampaignScenario(
      rawMortuary,
      ['char-tommy-beck', 'char-rosa-flores']
    );

    expect(useEngineStore.getState().activeBlueprint?.id).toBe('blueprint-black-iron-mortuary');
    // Rosa died, so only Tommy survives into Black Iron Mortuary!
    expect(result2.receipt.carriedCharacters.map((c) => c.characterId)).toEqual([
      'char-tommy-beck',
    ]);

    // Act history tracks sequential campaign transition progression
    const actHistory = result2.nextState.campaignActHistory as Array<{
      actIndex: number;
      fromBlueprintId: string;
      toBlueprintId: string;
    }>;
    expect(actHistory).toHaveLength(2);
    expect(actHistory[0].actIndex).toBe(1);
    expect(actHistory[0].fromBlueprintId).toBe('blueprint-starlight-motel');
    expect(actHistory[0].toBlueprintId).toBe('blueprint-silver-rest-lodge');
    expect(actHistory[1].actIndex).toBe(2);
    expect(actHistory[1].fromBlueprintId).toBe('blueprint-silver-rest-lodge');
    expect(actHistory[1].toBlueprintId).toBe('blueprint-black-iron-mortuary');
  });

  it('supports custom sessionId and entryNodeId options during scenario transition', () => {
    useEngineStore.getState().setBlueprint(rawStarlight, 'protagonist', null, 'char-tommy-beck');

    const customSession = 'session-campaign-custom-456';
    const customEntry = 'mortuary_cold_room';

    useEngineStore.getState().transitionCampaignScenario(rawMortuary, ['char-tommy-beck'], {
      sessionId: customSession,
      entryNodeId: customEntry,
    });

    expect(useEngineStore.getState().activeSessionId).toBe(customSession);
    expect(useAppStore.getState().sessionId).toBe(customSession);
    expect(useAppStore.getState().currentNodeId).toBe(customEntry);
    expect(useAppStore.getState().castPlacement?.['char-tommy-beck']).toBe(customEntry);
  });
});
