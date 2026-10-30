import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Runtime from './Runtime';
import { useAppStore } from '../../store/useAppStore';
import { useEngineStore } from '../../core/store';
import type { RatifiedEngineFrame } from '../../types';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';
import { executeRatificationPipeline } from '../../lib/ratificationPipeline';

vi.mock('../../lib/ratificationPipeline', () => ({
  executeRatificationPipeline: vi.fn(),
}));

describe('Runtime Horror Grammar 1 Integration', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  const mockBlueprint = {
    id: 'bp-hg1-test',
    title: 'Isolation Ward Echo',
    contentScale: 2,
    contentLevelDescription: 'Psychological Horror',
    setting: {
      location: 'Sub-level 1',
      atmosphere: 'Sterile',
      timePeriod: '1999',
    },
    cast: [
      {
        id: 'char-user',
        name: 'Dr. Evans',
        role: 'Researcher',
        description: 'Lead researcher',
        personality: 'Stoic',
        goals: 'Contain sample',
        traits: ['Methodical'],
        isUserCharacter: true,
        isEntity: false,
        behaviorVector: 'COGNITIVE',
        starting_location: 'ORIGIN',
      },
      {
        id: 'char-ally',
        name: 'Technician Mercer',
        role: 'Technician',
        description: 'Station tech',
        personality: 'Nervous',
        goals: 'Fix power',
        traits: ['Cautious'],
        isUserCharacter: false,
        isEntity: false,
        behaviorVector: 'COGNITIVE',
        starting_location: 'ORIGIN',
      },
    ],
    topology: {
      nodes: ['ORIGIN'],
      connections: [],
    },
    horrorGrammar: {
      valueBaselineReview: 'REVIEWED',
      pursuitReviews: {
        'char-ally': 'REVIEWED',
      },
      valueAnchors: [
        {
          id: 'val-reactor-core',
          holder: { kind: 'PLACE', nodeId: 'ORIGIN' },
          label: 'Auxiliary Core',
          description: 'Power grid stability',
          basisSummary: 'Facility engineering',
          provenance: { kind: 'CREATOR_DEFINED' },
        },
      ],
      characterPursuits: [
        {
          id: 'pur-mercer-power',
          castMemberId: 'char-ally',
          objective: 'Restore main breakers',
          presentApproach: 'Checking junction box',
          reviewWindow: 'SCENE_BEAT',
          status: 'ACTIVE',
          basisSummary: 'Engineering protocol',
          provenance: { kind: 'CREATOR_DEFINED' },
        },
      ],
    },
  };

  beforeEach(() => {
    useAppStore.getState().resetSession();
    useEngineStore.getState().resetEngine();

    const normalized = normalizeBlueprint(mockBlueprint);

    useAppStore.setState({
      sessionId: 'sess-hg1-test',
      blueprintId: normalized.id,
      phase: 'ENGINE',
      spatialGraph: [{ id: 'ORIGIN', name: 'Origin Chamber', description: '', exits: [] }],
      currentNodeId: 'ORIGIN',
      history: [
        {
          id: 'msg-1',
          role: 'narrative',
          content: 'You stand before the auxiliary core.',
          timestamp: 1000,
        },
      ],
    });

    useEngineStore.setState({
      activeSessionId: 'sess-hg1-test',
      activeBlueprint: normalized,
      gameState: {
        current_location: 'ORIGIN',
        player_character_id: 'char-user',
        fictional_time_ledger: {
          moment_revision: 0,
          scene_beat_revision: 0,
          extended_revision: 0,
          last_cost: 'UNCLEAR',
        },
        pursuit_schedule_ledger: {},
        activity_events: [],
        pressure_threads: [],
        value_state_ledger: {
          'val-reactor-core': {
            anchorId: 'val-reactor-core',
            lifecycle: 'ACTIVE',
            condition: 'ESTABLISHED',
            currentFormNote: null,
            lastCauseReference: 'BASELINE',
            lastChangedTurn: 0,
          },
        },
        character_pursuit_ledger: {
          'pur-mercer-power': {
            pursuitId: 'pur-mercer-power',
            castMemberId: 'char-ally',
            currentObjective: 'Restore main breakers',
            currentApproach: 'Checking junction box',
            currentLocationNodeId: 'ORIGIN',
            status: 'ACTIVE',
            progressSummary: 'Baseline pursuit initiated',
            lastCauseReference: 'BASELINE',
            lastActivityTurn: null,
            lastChangedTurn: 0,
            reviewWindow: 'SCENE_BEAT',
          },
        },
        character_development_ledger: {},
        character_stance: {},
        character_relationships: [],
        character_memory: {},
        world_memory: [],
      },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root!.unmount();
      });
      container.remove();
    }
    vi.clearAllMocks();
  });

  it('commits turn with validated cast activity, situated pressure, and value overlays', async () => {
    const mockFrame: RatifiedEngineFrame = {
      narrative_blocks: [
        { type: 'prose', content: 'You check the readouts.' },
        { type: 'dialogue', speaker: 'Technician Mercer', content: 'I found the blown fuse!' },
      ],
      logic_state: {
        current_phase: 'MANIFEST',
        suggested_tension: 10,
        activity_events: [
          {
            id: 'act-1-mercer-fuse',
            castMemberId: 'char-ally',
            pursuitId: 'pur-mercer-power',
            activitySummary: 'Located the blown fuse in the junction box',
            locationNodeId: 'ORIGIN',
            perceptionPath: 'DIRECT',
            committedTurn: 1,
            authorityReferences: [],
            wasManifested: true,
          },
        ],
        pressure_threads: [
          {
            id: 'thr-1-val-reactor-core',
            valueAnchorId: 'val-reactor-core',
            holder: { kind: 'PLACE', nodeId: 'ORIGIN' },
            sourceReference: 'ACTIVITY',
            operator: 'CONSTRAIN_ACCESS',
            affectedDimension: 'ACCESS',
            adverseProspect: 'Sparks showering the control panel',
            manifestationSummary: 'Sparks showering',
            status: 'OPEN',
            createdTurn: 1,
            lastChangedTurn: 1,
            persistenceTarget: 'PRESSURE_THREAD',
            authorityReferences: [],
          },
        ],
      },
      canonicalConsequenceReceipt: {
        version: 1,
        pre_state: { inventory: [], player_injuries: [], psychological_status: 'STABLE' },
        post_state: { inventory: [], player_injuries: [], psychological_status: 'STABLE' },
        patch: {
          inventory_added: [],
          inventory_removed: [],
          injuries_added: [],
          injuries_removed: [],
          psychological_status_change: null,
        },
        decisions: [],
      },
      characterStanceReceipt: {
        version: 1,
        pre_state: {},
        post_state: {},
        decisions: [],
      },
      characterRelationshipReceipt: {
        version: 1,
        pre_state: [],
        post_state: [],
        decisions: [],
      },
      characterMemoryReceipt: {
        version: 1,
        pre_state: {},
        post_state: {},
        decisions: [],
      },
      worldMemoryReceipt: {
        version: 1,
        pre_state: [],
        post_state: [],
        decisions: [],
      },
      castActivityProposalReceipt: {
        version: 1,
        outcome: 'ACCEPTED',
        reasonCode: 'ACTIVITY_RATIFIED',
        preState: [],
        postState: [
          {
            id: 'act-1-mercer-fuse',
            castMemberId: 'char-ally',
            pursuitId: 'pur-mercer-power',
            activitySummary: 'Located the blown fuse in the junction box',
            locationNodeId: 'ORIGIN',
            perceptionPath: 'DIRECT',
            committedTurn: 1,
            authorityReferences: [],
            wasManifested: true,
          },
        ],
        admittedManifestation: true,
        acceptedEventId: 'act-1-mercer-fuse',
      },
      situatedPressureReceipt: {
        version: 1,
        outcome: 'ACCEPTED',
        reasonCode: 'PRESSURE_RATIFIED',
        preState: [],
        postState: [
          {
            id: 'thr-1-val-reactor-core',
            valueAnchorId: 'val-reactor-core',
            holder: { kind: 'PLACE', nodeId: 'ORIGIN' },
            sourceReference: 'ACTIVITY',
            operator: 'CONSTRAIN_ACCESS',
            affectedDimension: 'ACCESS',
            adverseProspect: 'Sparks showering the control panel',
            manifestationSummary: 'Sparks showering',
            status: 'OPEN',
            createdTurn: 1,
            lastChangedTurn: 1,
            persistenceTarget: 'PRESSURE_THREAD',
            authorityReferences: [],
          },
        ],
        admittedManifestation: true,
        acceptedThreadId: 'thr-1-val-reactor-core',
        boundedOutChangeIds: [],
      },
      valueStateReceipt: {
        version: 1,
        preState: {
          'val-reactor-core': {
            anchorId: 'val-reactor-core',
            lifecycle: 'ACTIVE',
            condition: 'ESTABLISHED',
            currentFormNote: null,
            lastCauseReference: 'BASELINE',
            lastChangedTurn: 0,
          },
        },
        postState: {
          'val-reactor-core': {
            anchorId: 'val-reactor-core',
            lifecycle: 'ACTIVE',
            condition: 'THREATENED',
            currentFormNote: null,
            lastCauseReference: 'act-1-mercer-fuse',
            lastChangedTurn: 1,
          },
        },
        decisions: [
          {
            anchorId: 'val-reactor-core',
            operation: 'SET_CONDITION',
            outcome: 'APPLIED',
            reasonCode: 'VALUE_STATE_TRANSITION_APPLIED',
            causeReference: 'act-1-mercer-fuse',
          },
        ],
        boundedOutChangeIds: [],
      },
      characterPursuitReceipt: {
        version: 1,
        preState: {
          'pur-mercer-power': {
            pursuitId: 'pur-mercer-power',
            castMemberId: 'char-ally',
            currentObjective: 'Restore main breakers',
            currentApproach: 'Checking junction box',
            currentLocationNodeId: 'ORIGIN',
            status: 'ACTIVE',
            progressSummary: 'Baseline pursuit initiated',
            lastCauseReference: 'BASELINE',
            lastActivityTurn: null,
            lastChangedTurn: 0,
            reviewWindow: 'SCENE_BEAT',
          },
        },
        postState: {
          'pur-mercer-power': {
            pursuitId: 'pur-mercer-power',
            castMemberId: 'char-ally',
            currentObjective: 'Restore main breakers',
            currentApproach: 'Checking junction box',
            currentLocationNodeId: 'ORIGIN',
            status: 'ACTIVE',
            progressSummary: 'Baseline pursuit initiated',
            lastCauseReference: 'BASELINE',
            lastActivityTurn: null,
            lastChangedTurn: 0,
            reviewWindow: 'SCENE_BEAT',
          },
        },
        decisions: [],
        boundedOutChangeIds: [],
      },
      characterDevelopmentReceipt: {
        version: 1,
        preState: {},
        postState: {},
        decisions: [],
      },
      fictionalTimeReceipt: {
        version: 1,
        preState: {
          moment_revision: 0,
          scene_beat_revision: 0,
          extended_revision: 0,
          last_cost: 'UNCLEAR',
        },
        acceptedCost: 'MOMENT',
        postState: {
          moment_revision: 1,
          scene_beat_revision: 0,
          extended_revision: 0,
          last_cost: 'MOMENT',
        },
      },
      castActivityReceipt: {
        version: 1,
        presentOpportunities: [],
        offscreenOpportunities: [],
        boundedOutPursuitIds: [],
        dormantCount: 0,
        notDueCount: 0,
        ledgerSnapshot: {
          moment_revision: 0,
          scene_beat_revision: 0,
          extended_revision: 0,
          last_cost: 'UNCLEAR',
        },
        scheduleSnapshotRevision: 0,
      },
      pursuitScheduleReceipt: {
        version: 1,
        preState: {},
        postState: {},
      },
      pressureThreadTransitionReceipt: {
        version: 1,
        preState: [
          {
            id: 'thr-1-val-reactor-core',
            valueAnchorId: 'val-reactor-core',
            holder: { kind: 'PLACE', nodeId: 'ORIGIN' },
            sourceReference: 'ACTIVITY',
            operator: 'CONSTRAIN_ACCESS',
            affectedDimension: 'ACCESS',
            adverseProspect: 'Sparks showering the control panel',
            manifestationSummary: 'Sparks showering',
            status: 'OPEN',
            createdTurn: 1,
            lastChangedTurn: 1,
            persistenceTarget: 'PRESSURE_THREAD',
            authorityReferences: [],
          },
        ],
        postState: [
          {
            id: 'thr-1-val-reactor-core',
            valueAnchorId: 'val-reactor-core',
            holder: { kind: 'PLACE', nodeId: 'ORIGIN' },
            sourceReference: 'ACTIVITY',
            operator: 'CONSTRAIN_ACCESS',
            affectedDimension: 'ACCESS',
            adverseProspect: 'Sparks showering the control panel',
            manifestationSummary: 'Sparks showering',
            status: 'OPEN',
            createdTurn: 1,
            lastChangedTurn: 1,
            persistenceTarget: 'PRESSURE_THREAD',
            authorityReferences: [],
          },
        ],
        decisions: [],
        boundedOutChangeIds: [],
      },
    };

    vi.mocked(executeRatificationPipeline).mockResolvedValue(mockFrame);

    await act(async () => {
      root!.render(<Runtime />);
    });

    const observeButton = container!.querySelector('button[title*="Observe"]') as HTMLButtonElement;
    expect(observeButton).toBeTruthy();

    await act(async () => {
      observeButton.click();
    });

    const finalEngineState = useEngineStore.getState();
    expect(finalEngineState.gameState?.activity_events).toHaveLength(1);
    expect(finalEngineState.gameState?.activity_events?.[0].id).toBe('act-1-mercer-fuse');
    expect(finalEngineState.gameState?.pressure_threads).toHaveLength(1);
    expect(finalEngineState.gameState?.value_state_ledger?.['val-reactor-core']?.condition).toBe(
      'THREATENED'
    );
    expect(finalEngineState.gameState?.character_pursuit_ledger).toBeDefined();
    expect(finalEngineState.gameState?.character_development_ledger).toBeDefined();
    expect(finalEngineState.gameState?.fictional_time_ledger).toBeDefined();
    expect(finalEngineState.gameState?.pursuit_schedule_ledger).toBeDefined();
  });

  it('fails turn and commits nothing if ratification throws an error (Proof 4b)', async () => {
    const priorState = useEngineStore.getState().gameState;
    const { TurnResponseError } = await import('../../lib/turnResponseReader');

    vi.mocked(executeRatificationPipeline).mockRejectedValue(
      new TurnResponseError({
        code: 'STRUCTURAL_RESPONSE_MISMATCH',
        status: 500,
        contentType: 'application/json',
        message: 'Malformed HG1 response',
      })
    );

    await act(async () => {
      root!.render(<Runtime />);
    });

    const observeButton = container!.querySelector('button[title*="Observe"]') as HTMLButtonElement;
    expect(observeButton).toBeTruthy();

    await act(async () => {
      observeButton.click();
    });

    // Game state remains completely unmutated
    expect(useEngineStore.getState().gameState).toEqual(priorState);
    expect(useAppStore.getState().turnCount).toBe(0);
  });
});
