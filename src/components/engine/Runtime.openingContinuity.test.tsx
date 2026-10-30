/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import Runtime from './Runtime';
import { useAppStore } from '../../store/useAppStore';
import { useEngineStore } from '../../core/store';
import {
  RatifiedEngineFrame,
  FictionalTimeLedger,
} from '../../types';
import { createEngineHistoryMessage } from '../../core/engine/turnHistory';
import { executeRatificationPipeline } from '../../lib/ratificationPipeline';
import { coordinateCanonicalTurnPublication, getCanonicalSimulationState } from '../../core/engine/commitCoordinator';
import { captureRuntimeSnapshot } from '../../core/engine/snapshot';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';

const mockBlueprint: any = {
  id: 'bp_milestone_1',
  title: 'Milestone 1 Test Facility',
  author: 'Architect',
  version: '1.0.0',
  description: 'Test Facility for Milestone 1',
  contentScale: 4,
  contentLevelDescription: 'Psychological Horror',
  setting: {
    location: 'Abandoned Observation Station',
    atmosphere: 'Oppressive',
    timePeriod: '1984',
  },
  startingVector: 'COGNITIVE',
  startingTier: 'GATEWAY',
  narrativeRules: {
    incitingIncident: 'Station loses power',
    currentTensionLevel: 'buildup',
    keyPlotElements: [],
  },
  topology: {
    nodes: ['ORIGIN', 'OBSERVATION_DECK'],
    edges: [{ from: 'ORIGIN', to: 'OBSERVATION_DECK', direction: 'north', distance: 1 }],
  },
  cast: [
    {
      id: 'char_jules',
      name: 'Jules Mercer',
      role: 'protagonist',
      isUserCharacter: true,
      tier: 'GATEWAY',
      skepticism: 0.8,
      status: 'active',
      narrative_presence: 'PRESENT',
      presence_state: 'PRESENT_ACTIVE',
    },
  ],
};

const initialFictionalTimeLedger: FictionalTimeLedger = {
  moment_revision: 0,
  scene_beat_revision: 0,
  extended_revision: 0,
  last_cost: null,
};

const defaultHG1Receipts = {
  fictionalTimeReceipt: {
    version: 1 as const,
    preState: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
    acceptedCost: 'MOMENT' as const,
    postState: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
  },
  castActivityReceipt: {
    version: 1 as const,
    presentOpportunities: [],
    offscreenOpportunities: [],
    boundedOutPursuitIds: [],
    dormantCount: 0,
    notDueCount: 0,
    ledgerSnapshot: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
    scheduleSnapshotRevision: 0,
  },
  pursuitScheduleReceipt: {
    version: 1 as const,
    preState: {},
    postState: {},
  },
  castActivityProposalReceipt: {
    version: 1 as const,
    outcome: 'NO_PROPOSAL' as const,
    reasonCode: 'NO_OPPORTUNITY_CHOSEN' as const,
    admittedManifestation: false,
    acceptedEventId: null,
    preState: [],
    postState: [],
  },
  situatedPressureReceipt: {
    version: 1 as const,
    outcome: 'NO_PROPOSAL' as const,
    reasonCode: 'NO_PRESSURE_CHOSEN' as const,
    admittedManifestation: false,
    acceptedThreadId: null,
    preState: [],
    postState: [],
    boundedOutChangeIds: [],
  },
  valueStateReceipt: {
    version: 1 as const,
    preState: {},
    postState: {},
    decisions: [],
    boundedOutChangeIds: [],
  },
  characterPursuitReceipt: {
    version: 1 as const,
    preState: {},
    postState: {},
    decisions: [],
    boundedOutChangeIds: [],
  },
  characterDevelopmentReceipt: {
    version: 1 as const,
    preState: {},
    postState: {},
    decisions: [],
  },
  pressureThreadTransitionReceipt: {
    version: 1 as const,
    preState: [],
    postState: [],
    decisions: [],
    boundedOutChangeIds: [],
  },
};

function createMockOpeningFrame(detailText: string): RatifiedEngineFrame {
  return {
    narrative_blocks: [
      { type: 'prose', content: detailText },
    ],
    logic_state: {
      current_phase: 'LATENT',
      suggested_tension: 10,
      cast_deltas: [],
      terminal_flags: [],
      cast_ledger: [],
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
    characterStanceReceipt: { version: 1, pre_state: {}, post_state: {}, decisions: [] },
    characterRelationshipReceipt: { version: 1, pre_state: [], post_state: [], decisions: [] },
    characterMemoryReceipt: { version: 1, pre_state: {}, post_state: {}, decisions: [] },
    worldMemoryReceipt: { version: 1, pre_state: [], post_state: [], decisions: [] },
    intentReceipt: {
      version: 1,
      action_kind: 'OBSERVE',
      action_subtype: null,
      pressure_direction: 'MAINTAIN',
      dramatic_tactic: 'NONE',
      intent_synergy: 'N/A',
    },
    validation: { accepted: true, rejected_fields: [], repair_notes: [] },
    ...defaultHG1Receipts,
  };
}

describe('Packet 03 — Opening Continuity & Milestone 1 Closure', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  const normalizedBlueprint = normalizeBlueprint(mockBlueprint);

  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.getState().resetSession();
    useEngineStore.getState().resetEngine();

    useEngineStore.setState({
      activeSessionId: 'session_m1_test',
      activeBlueprint: normalizedBlueprint,
      gameState: {
        player_character_id: 'char_jules',
        player_role: 'protagonist',
        world_memory: [],
        character_memory: {},
        character_stance: {},
        character_relationships: [],
        fictional_time_ledger: { ...initialFictionalTimeLedger },
        pursuit_schedule_ledger: {},
        activity_events: [],
        pressure_threads: [],
        value_state_ledger: {},
        character_pursuit_ledger: {},
        character_development_ledger: {},
        inventory: [],
        player_injuries: [],
        psychological_status: 'STABLE',
        current_phase: 'LATENT',
        suggested_tension: 0,
      },
    });

    useAppStore.getState().initializeSession({
      blueprint: normalizedBlueprint,
      sessionId: 'session_m1_test',
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it('acceptance check 1: real opening acceptance action projects unique fictional detail into the first user request context', async () => {
    const UNIQUE_DETAIL = 'An antique brass compass points stubbornly northwest.';
    const openingFrame = createMockOpeningFrame(UNIQUE_DETAIL);

    // 1. Use the real opening acceptance action
    const openingMessage = createEngineHistoryMessage(UNIQUE_DETAIL, openingFrame);
    useAppStore.getState().dispatch({
      type: 'ADD_MESSAGE',
      message: openingMessage,
    });

    // Verify store state after opening acceptance
    const currentApp = useAppStore.getState();
    expect(currentApp.history).toHaveLength(1);
    expect(currentApp.storyLog).toHaveLength(1);
    expect(currentApp.turnCount).toBe(0); // Turn count untouched
    expect(useEngineStore.getState().gameState?.fictional_time_ledger).toEqual(initialFictionalTimeLedger); // Fictional time untouched

    // 2. Intercept the real pipeline fetch to capture the outbound prompt request payload
    let capturedPayload: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify(createMockOpeningFrame('Turn 1 narrative response')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // 3. Run real pipeline to build first user request
    const preSnapshot = captureRuntimeSnapshot(useAppStore.getState());
    await executeRatificationPipeline('I check the antique brass compass', preSnapshot);

    // 4. Verify unique detail is present once, in order, in recentHistory
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.recentHistory).toContain(UNIQUE_DETAIL);
    expect(capturedPayload.recentHistory).toBe(`[PROSE]: ${UNIQUE_DETAIL.substring(0, 60)}...`);

    // Verify it appears exactly once
    const occurrences = capturedPayload.recentHistory.split(UNIQUE_DETAIL.substring(0, 30)).length - 1;
    expect(occurrences).toBe(1);
  });

  it('acceptance check 2: initialization leaves turn count and fictional-time ledgers unchanged, and repeated render does not duplicate opening', async () => {
    const UNIQUE_OPENING = 'Heavy salt spray coats the observation windows.';

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(createMockOpeningFrame(UNIQUE_OPENING)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // 1. First render triggers startSimulation
    await act(async () => {
      root?.render(<Runtime />);
    });

    // Allow promise resolution and state updates
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(useAppStore.getState().turnCount).toBe(0);
    expect(useEngineStore.getState().gameState?.fictional_time_ledger?.moment_revision).toBe(0);
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().storyLog).toHaveLength(1);

    // 2. Re-render the component (simulating strict mode or state updates)
    await act(async () => {
      root?.render(<Runtime />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // Turn count, fictional time, and message history must still be 0 / 1 (not duplicated)
    expect(useAppStore.getState().turnCount).toBe(0);
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().storyLog).toHaveLength(1);
    expect(useEngineStore.getState().gameState?.fictional_time_ledger?.moment_revision).toBe(0);
  });

  it('acceptance check 3: failed and obsolete opening results do not enter a replacement session or future narrative context', async () => {
    let resolveOpeningA: (res: Response) => void;
    const openingAPromise = new Promise<Response>((resolve) => {
      resolveOpeningA = resolve;
    });

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.userAction === 'SYSTEM_INIT') {
        return openingAPromise;
      }
      return Promise.resolve(new Response(JSON.stringify(createMockOpeningFrame('Default turn')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    // 1. Mount Runtime in Session A (triggering SYSTEM_INIT for Session A)
    await act(async () => {
      root?.render(<Runtime />);
    });

    // 2. User abandons/resets Session A and initializes Session B
    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container!);

    useAppStore.getState().resetSession();
    useEngineStore.setState({ activeSessionId: 'session_b_clean' });
    useAppStore.getState().initializeSession({
      blueprint: normalizedBlueprint,
      sessionId: 'session_b_clean',
    });

    expect(useAppStore.getState().sessionId).toBe('session_b_clean');
    expect(useAppStore.getState().history).toHaveLength(0);
    expect(useAppStore.getState().storyLog).toHaveLength(0);

    // 3. Delayed Opening A now resolves with text intended for Session A
    await act(async () => {
      resolveOpeningA!(
        new Response(JSON.stringify(createMockOpeningFrame('Session A stale opening detail')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // Session B MUST NOT have received Session A's stale opening
    const sessionBState = useAppStore.getState();
    expect(sessionBState.history).toHaveLength(0);
    expect(sessionBState.storyLog).toHaveLength(0);

    // 4. Test delayed opening failure as well:
    let rejectOpeningB: (err: any) => void;
    const openingBPromise = new Promise<Response>((_, reject) => {
      rejectOpeningB = reject;
    });
    openingBPromise.catch(() => {});

    globalThis.fetch = vi.fn().mockImplementation(() => openingBPromise);
    await act(async () => {
      root?.render(<Runtime />);
    });

    // Switch to Session C
    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container!);

    useAppStore.getState().resetSession();
    useEngineStore.setState({ activeSessionId: 'session_c_clean' });
    useAppStore.getState().initializeSession({
      blueprint: normalizedBlueprint,
      sessionId: 'session_c_clean',
    });

    // Reject Opening B with network failure
    await act(async () => {
      rejectOpeningB!(new Error('500 Gateway Timeout'));
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // Session C MUST NOT have received Session B's critical engine failure
    const sessionCState = useAppStore.getState();
    expect(sessionCState.history).toHaveLength(0);
    expect(sessionCState.storyLog).toHaveLength(0);
  });

  it('acceptance check 4: complete Milestone 1 sequence end-to-end', async () => {
    const OPENING_DETAIL = 'A weather-stained journal lies open on the nav desk.';
    const WORLD_FACT = 'The journal mentions an emergency beacon frequency 142.8.';

    // --- STEP 1: Accepted opening ---
    const openingFrame = createMockOpeningFrame(OPENING_DETAIL);
    const openingMessage = createEngineHistoryMessage(OPENING_DETAIL, openingFrame);
    useAppStore.getState().dispatch({
      type: 'ADD_MESSAGE',
      message: openingMessage,
    });

    expect(useAppStore.getState().turnCount).toBe(0);
    expect(useAppStore.getState().storyLog).toHaveLength(1);
    expect(useAppStore.getState().storyLog[0].content).toBe(OPENING_DETAIL);

    // Mock fetch handlers for turns
    let lastSentPayload: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        lastSentPayload = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify(createMockOpeningFrame('Turn Response')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // --- STEP 2: User references opening detail in Turn 1 -> commits world-memory change ---
    const preSnapshotTurn1 = captureRuntimeSnapshot(useAppStore.getState());
    await executeRatificationPipeline('I read the weather-stained journal', preSnapshotTurn1);

    // Verify Turn 1 request included the opening detail
    expect(lastSentPayload.recentHistory).toContain(OPENING_DETAIL);

    // Frame returned by server for Turn 1 containing world memory change
    const turn1Frame: RatifiedEngineFrame = {
      ...createMockOpeningFrame('You decipher the scribbled coordinates and emergency frequency.'),
      worldMemoryReceipt: {
        version: 1,
        pre_state: [],
        post_state: [
          {
            id: 'wm_fact_01',
            statement: WORLD_FACT,
            kind: 'ESTABLISHED_FACT',
            scope: 'GLOBAL',
            node_id: null,
            established_turn: 1,
          },
        ],
        decisions: [
          {
            candidate: {
              statement: WORLD_FACT,
              rationale: 'Read from journal',
              kind: 'ESTABLISHED_FACT',
              scope: 'GLOBAL',
              node_id: null,
            },
            outcome: 'APPLIED',
            reason: 'APPLIED',
          },
        ],
      },
    };

    const gameStateBeforeTurn1 = JSON.parse(JSON.stringify(useEngineStore.getState().gameState));
    coordinateCanonicalTurnPublication({
      appStore: useAppStore,
      engineStore: useEngineStore,
      committedPayload: {
        commandText: 'I read the weather-stained journal',
        formattedText: 'You decipher the scribbled coordinates and emergency frequency.',
        frame: turn1Frame,
        preSnapshot: preSnapshotTurn1,
        engineGameStateBefore: gameStateBeforeTurn1,
        turnReceipt: {
          turnNumber: 1,
          nodeBefore: 'ORIGIN',
          requestedTarget: null,
          nodeAfter: 'ORIGIN',
          accepted: true,
          activeVector: 'COGNITIVE',
          activeTier: 'GATEWAY',
          tension: 10,
          preSnapshot: preSnapshotTurn1,
        },
      },
      preparedGameState: {
        ...useEngineStore.getState().gameState!,
        world_memory: [...turn1Frame.worldMemoryReceipt!.post_state],
      },
    });

    // Verify Turn 1 publication
    expect(useAppStore.getState().turnCount).toBe(1);
    expect(useEngineStore.getState().gameState?.world_memory).toHaveLength(1);
    expect(useEngineStore.getState().gameState?.world_memory[0].statement).toBe(WORLD_FACT);
    expect(useAppStore.getState().lastTurnCheckpoint).not.toBeNull();
    expect(useAppStore.getState().lastTurnCheckpoint?.engineStateBefore.turnCount).toBe(0);

    // --- STEP 3: Turn 2 with empty proposals preserving world memory fact ---
    const preSnapshotTurn2 = captureRuntimeSnapshot(useAppStore.getState());
    await executeRatificationPipeline('I adjust the dial to 142.8', preSnapshotTurn2);

    // Verify Turn 2 request included opening detail AND Turn 1 prose
    expect(lastSentPayload.recentHistory).toContain(OPENING_DETAIL);
    expect(lastSentPayload.recentHistory).toContain('You decipher the scribbled coordinates');

    const turn2Frame: RatifiedEngineFrame = {
      ...createMockOpeningFrame('Static hisses across frequency 142.8.'),
      worldMemoryReceipt: {
        version: 1,
        pre_state: [useEngineStore.getState().gameState?.world_memory[0]],
        post_state: [useEngineStore.getState().gameState?.world_memory[0]],
        decisions: [],
      },
    };

    const gameStateBeforeTurn2 = JSON.parse(JSON.stringify(useEngineStore.getState().gameState));
    coordinateCanonicalTurnPublication({
      appStore: useAppStore,
      engineStore: useEngineStore,
      committedPayload: {
        commandText: 'I adjust the dial to 142.8',
        formattedText: 'Static hisses across frequency 142.8.',
        frame: turn2Frame,
        preSnapshot: preSnapshotTurn2,
        engineGameStateBefore: gameStateBeforeTurn2,
        turnReceipt: {
          turnNumber: 2,
          nodeBefore: 'ORIGIN',
          requestedTarget: null,
          nodeAfter: 'ORIGIN',
          accepted: true,
          activeVector: 'COGNITIVE',
          activeTier: 'GATEWAY',
          tension: 15,
          preSnapshot: preSnapshotTurn2,
        },
      },
      preparedGameState: {
        ...useEngineStore.getState().gameState!,
        world_memory: [...turn2Frame.worldMemoryReceipt!.post_state],
      },
    });

    // Verify Turn 2 publication
    expect(useAppStore.getState().turnCount).toBe(2);
    expect(useEngineStore.getState().gameState?.world_memory).toHaveLength(1);
    expect(useEngineStore.getState().gameState?.world_memory[0].statement).toBe(WORLD_FACT);
    expect(useAppStore.getState().lastTurnCheckpoint?.engineStateBefore.turnCount).toBe(1);

    // --- STEP 4: Turn 3 refusal / failure preserves canon ---
    const preSnapshotTurn3 = captureRuntimeSnapshot(useAppStore.getState());
    const canonicalStateBeforeTurn3 = getCanonicalSimulationState();

    // Fail turn 3 with refusal
    useAppStore.getState().failTurnResult({
      commandText: 'I smash the dial',
      preSnapshot: preSnapshotTurn3,
      errorCategory: 'PROVIDER_REFUSAL',
      errorMessage: 'The machine resists destruction.',
      statusCode: 422,
      contentType: 'application/json',
      failureReceipt: {
        code: 'PROVIDER_REFUSAL',
        message: 'The machine resists destruction.',
        status: 422,
        contentType: 'application/json',
      },
      engineGameStateBefore: canonicalStateBeforeTurn3.gameState,
    });

    // Verify canon is preserved
    expect(useAppStore.getState().turnCount).toBe(2);
    expect(useEngineStore.getState().gameState?.world_memory).toHaveLength(1);
    expect(useEngineStore.getState().gameState?.world_memory[0].statement).toBe(WORLD_FACT);
    // Checkpoint must still be before Turn 2
    expect(useAppStore.getState().lastTurnCheckpoint?.engineStateBefore.turnCount).toBe(1);

    // --- STEP 5: Retake restores previous state (Turn 1) ---
    const retakeSuccess = useAppStore.getState().retakeLastTurn();
    expect(retakeSuccess).toBe(true);

    // Verify restored state
    expect(useAppStore.getState().turnCount).toBe(1);
    expect(useEngineStore.getState().gameState?.world_memory).toHaveLength(1);
    expect(useEngineStore.getState().gameState?.world_memory[0].statement).toBe(WORLD_FACT);
    expect(useAppStore.getState().lastTurnCheckpoint).toBeNull(); // Single turn retake consumed

    // --- STEP 6: Next request built from published stores reflects Turn 1 state ---
    const preSnapshotTurn2Retry = captureRuntimeSnapshot(useAppStore.getState());
    expect(preSnapshotTurn2Retry.turnCount).toBe(1);

    await executeRatificationPipeline('I listen carefully to the static', preSnapshotTurn2Retry);

    // Verify request built from published store reflects Turn 1 context
    expect(lastSentPayload.stateContext.currentNodeId).toBe('ORIGIN');
    expect(lastSentPayload.recentHistory).toContain(OPENING_DETAIL);
    expect(lastSentPayload.recentHistory).toContain('You decipher the scribbled coordinates');
    // And does NOT contain Turn 2 prose ('Static hisses across frequency')
    expect(lastSentPayload.recentHistory).not.toContain('Static hisses across frequency');
  });
});