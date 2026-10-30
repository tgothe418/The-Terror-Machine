/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Runtime from './Runtime';
import { useAppStore } from '../../store/useAppStore';
import { useEngineStore } from '../../core/store';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';
import { TurnResponseError } from '../../lib/turnResponseReader';
import type { ScenarioBlueprint, RatifiedEngineFrame } from '../../types';

const { mockExecuteRatificationPipeline, mockFetchSimulatedPlayerAction } = vi.hoisted(() => ({
  mockExecuteRatificationPipeline: vi.fn(),
  mockFetchSimulatedPlayerAction: vi.fn(),
}));

vi.mock('../../lib/ratificationPipeline', () => ({
  executeRatificationPipeline: mockExecuteRatificationPipeline,
}));

vi.mock('../../services/geminiService', () => ({
  fetchSimulatedPlayerAction: mockFetchSimulatedPlayerAction,
  triggerMemoryForge: vi.fn(),
}));

function createValidFrame(text = 'A cold wind whispers through the empty hall.'): RatifiedEngineFrame {
  return {
    narrative_blocks: [{ type: 'prose', content: text }],
    logic_state: {
      current_phase: 'LATENT',
      suggested_tension: 20,
      cast_deltas: [],
    },
    canonicalConsequenceReceipt: {
      version: 1,
      pre_state: {
        inventory: [],
        player_injuries: [],
        psychological_status: 'UNEASY',
      },
      post_state: {
        inventory: ['ancient_amulet'],
        player_injuries: [],
        psychological_status: 'UNEASY',
      },
      patch: {
        inventory_added: ['ancient_amulet'],
        inventory_removed: [],
        injuries_added: [],
        injuries_removed: [],
        psychological_status_change: null,
      },
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
    fictionalTimeReceipt: {
      version: 1,
      preState: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: 'UNCLEAR' },
      acceptedCost: 'MOMENT',
      postState: { moment_revision: 1, scene_beat_revision: 0, extended_revision: 0, last_cost: 'MOMENT' },
    },
    castActivityReceipt: {
      version: 1,
      presentOpportunities: [],
      offscreenOpportunities: [],
      boundedOutPursuitIds: [],
      dormantCount: 0,
      notDueCount: 0,
      ledgerSnapshot: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: 'UNCLEAR' },
      scheduleSnapshotRevision: 0,
    },
    pursuitScheduleReceipt: {
      version: 1,
      preState: {},
      postState: {},
    },
    castActivityProposalReceipt: {
      version: 1,
      outcome: 'NO_PROPOSAL',
      reasonCode: 'NO_OPPORTUNITY_CHOSEN',
      admittedManifestation: false,
      acceptedEventId: null,
      preState: [],
      postState: [],
    },
    situatedPressureReceipt: {
      version: 1,
      outcome: 'NO_PROPOSAL',
      reasonCode: 'NO_PRESSURE_CHOSEN',
      admittedManifestation: false,
      acceptedThreadId: null,
      preState: [],
      postState: [],
      boundedOutChangeIds: [],
    },
    valueStateReceipt: {
      version: 1,
      preState: {},
      postState: {},
      decisions: [],
      boundedOutChangeIds: [],
    },
    characterPursuitReceipt: {
      version: 1,
      preState: {},
      postState: {},
      decisions: [],
      boundedOutChangeIds: [],
    },
    characterDevelopmentReceipt: {
      version: 1,
      preState: {},
      postState: {},
      decisions: [],
    },
    pressureThreadTransitionReceipt: {
      version: 1,
      preState: [],
      postState: [],
      decisions: [],
      boundedOutChangeIds: [],
    },
  };
}

const blueprintA: ScenarioBlueprint = {
  id: 'bp-session-a',
  title: 'Chamber of Session A',
  contentScale: 4,
  contentLevelDescription: 'Psychological Horror',
  setting: { location: 'Sub-level A', atmosphere: 'Cold', timePeriod: '1984' },
  cast: [],
  narrativeRules: { incitingIncident: 'Incident A', currentTensionLevel: 'buildup', keyPlotElements: [] },
};

const blueprintB: ScenarioBlueprint = {
  id: 'bp-session-b',
  title: 'Chamber of Session B',
  contentScale: 4,
  contentLevelDescription: 'Psychological Horror',
  setting: { location: 'Sub-level B', atmosphere: 'Damp', timePeriod: '1984' },
  cast: [],
  narrativeRules: { incitingIncident: 'Incident B', currentTensionLevel: 'buildup', keyPlotElements: [] },
};

describe('Packet 02: Obsolete Turn Isolation', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    mockExecuteRatificationPipeline.mockReset();
    mockFetchSimulatedPlayerAction.mockReset();

    useAppStore.getState().resetSession();
    useEngineStore.getState().resetEngine();

    const normA = normalizeBlueprint(blueprintA);
    useAppStore.getState().initializeSession({
      blueprint: normA,
      sessionId: 'sess-a-id',
    });
    useAppStore.setState({
      history: [
        {
          id: 'opening-msg-a',
          role: 'narrative',
          content: 'Welcome to Chamber A.',
          timestamp: 100,
        },
      ],
    });
    useEngineStore.setState({
      activeSessionId: 'sess-a-id',
      activeBlueprint: normA,
      gameState: {
        current_location: 'ORIGIN',
        inventory: ['item_from_a_initial'],
        player_injuries: [],
        psychological_status: 'Calm',
        fictional_time_ledger: {
          moment_revision: 0,
          scene_beat_revision: 0,
          extended_revision: 0,
          last_cost: 'UNCLEAR',
        },
        pursuit_schedule_ledger: {},
        activity_events: [],
        pressure_threads: [],
        value_state_ledger: {},
        character_pursuit_ledger: {},
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
      act(() => root?.unmount());
      container.remove();
    }
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it('1. start A, replace with B, resolve A successfully -> B remains completely untouched', async () => {
    let resolveTurnA!: (frame: RatifiedEngineFrame) => void;
    const pendingPromiseA = new Promise<RatifiedEngineFrame>((resolve) => {
      resolveTurnA = resolve;
    });

    mockExecuteRatificationPipeline.mockImplementationOnce(() => pendingPromiseA);

    await act(async () => {
      root?.render(<Runtime />);
    });

    // Submit action in Session A via Observe button
    const observeBtn = container?.querySelector('button[title*="Observe"]') as HTMLButtonElement;
    expect(observeBtn).not.toBeNull();

    await act(async () => {
      observeBtn.click();
    });

    expect(mockExecuteRatificationPipeline).toHaveBeenCalledTimes(1);

    // Replace session A with session B while turn A is in-flight
    const normB = normalizeBlueprint(blueprintB);
    await act(async () => {
      useAppStore.getState().initializeSession({
        blueprint: normB,
        sessionId: 'sess-b-id',
      });
      useAppStore.setState({
        history: [
          {
            id: 'opening-msg-b',
            role: 'narrative',
            content: 'Welcome to Chamber B.',
            timestamp: 200,
          },
        ],
      });
      useEngineStore.setState({
        activeSessionId: 'sess-b-id',
        activeBlueprint: normB,
        gameState: {
          current_location: 'ORIGIN',
          inventory: ['item_from_b_initial'],
          player_injuries: [],
          psychological_status: 'Alert',
        },
      });
    });

    expect(useAppStore.getState().sessionId).toBe('sess-b-id');

    // Late resolve of Session A's in-flight turn
    await act(async () => {
      resolveTurnA(createValidFrame('Session A response that must be dropped.'));
      await Promise.resolve();
    });

    // Verification: Session B must not have received Session A's command, response, or inventory
    const currentApp = useAppStore.getState();
    const currentEngine = useEngineStore.getState();

    expect(currentApp.sessionId).toBe('sess-b-id');
    expect(currentApp.turnCount).toBe(0);
    expect(currentApp.history).toHaveLength(1); // Only opening-msg-b, A's message NOT appended
    expect(currentApp.history[0].id).toBe('opening-msg-b');
    expect(currentApp.lastTurnCheckpoint).toBeNull(); // A's checkpoint must NOT be installed
    expect(currentEngine.gameState?.inventory).toEqual(['item_from_b_initial']); // A's ancient_amulet NOT present
  });

  it('2. repeat with A provider refusal, malformed response, and rejected promise -> B isolated', async () => {
    // 2A: Provider refusal on A
    let rejectTurnA!: (err: any) => void;
    const pendingRefusal = new Promise<RatifiedEngineFrame>((_, reject) => {
      rejectTurnA = reject;
    });

    mockExecuteRatificationPipeline.mockImplementationOnce(() => pendingRefusal);

    await act(async () => {
      root?.render(<Runtime />);
    });

    const observeBtn = container?.querySelector('button[title*="Observe"]') as HTMLButtonElement;
    await act(async () => {
      observeBtn.click();
    });

    // Replace session A with B
    const normB = normalizeBlueprint(blueprintB);
    await act(async () => {
      useAppStore.getState().initializeSession({
        blueprint: normB,
        sessionId: 'sess-b-id',
      });
      useAppStore.setState({
        history: [{ id: 'opening-msg-b', role: 'narrative', content: 'B', timestamp: 200 }],
      });
    });

    // Reject turn A with provider refusal
    await act(async () => {
      rejectTurnA(new TurnResponseError({ code: 'PROVIDER_REFUSAL', message: 'Content refused' }));
      await Promise.resolve();
    });

    // Verify B has NO failure message, turnCount 0, and input not overwritten
    const appStateAfterRefusal = useAppStore.getState();
    expect(appStateAfterRefusal.sessionId).toBe('sess-b-id');
    expect(appStateAfterRefusal.turnCount).toBe(0);
    expect(appStateAfterRefusal.history).toHaveLength(1);
    expect(appStateAfterRefusal.history[0].id).toBe('opening-msg-b');

    const textarea = container?.querySelector('textarea');
    expect(textarea?.value).toBe(''); // Not populated with A's command

    // 2B: Malformed response on A
    let resolveMalformedA!: (val: any) => void;
    mockExecuteRatificationPipeline.mockImplementationOnce(
      () => new Promise((resolve) => { resolveMalformedA = resolve; })
    );

    // Switch back to A for another attempt
    const normA = normalizeBlueprint(blueprintA);
    await act(async () => {
      useAppStore.getState().initializeSession({
        blueprint: normA,
        sessionId: 'sess-a2-id',
      });
      useAppStore.setState({
        history: [{ id: 'opening-msg-a2', role: 'narrative', content: 'A2', timestamp: 300 }],
      });
    });

    await act(async () => {
      observeBtn.click();
    });

    // Replace with B again
    await act(async () => {
      useAppStore.getState().initializeSession({
        blueprint: normB,
        sessionId: 'sess-b2-id',
      });
      useAppStore.setState({
        history: [{ id: 'opening-msg-b2', role: 'narrative', content: 'B2', timestamp: 400 }],
      });
    });

    // Resolve with malformed object
    await act(async () => {
      resolveMalformedA({ narrative_blocks: [] }); // missing required receipts
      await Promise.resolve();
    });

    expect(useAppStore.getState().sessionId).toBe('sess-b2-id');
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().history[0].id).toBe('opening-msg-b2');

    // 2C: Network failure / rejected promise on A
    let rejectNetworkA!: (err: any) => void;
    mockExecuteRatificationPipeline.mockImplementationOnce(
      () => new Promise((_, reject) => { rejectNetworkA = reject; })
    );

    await act(async () => {
      useAppStore.getState().initializeSession({
        blueprint: normA,
        sessionId: 'sess-a3-id',
      });
      useAppStore.setState({
        history: [{ id: 'opening-msg-a3', role: 'narrative', content: 'A3', timestamp: 500 }],
      });
    });

    await act(async () => {
      observeBtn.click();
    });

    await act(async () => {
      useAppStore.getState().initializeSession({
        blueprint: normB,
        sessionId: 'sess-b3-id',
      });
      useAppStore.setState({
        history: [{ id: 'opening-msg-b3', role: 'narrative', content: 'B3', timestamp: 600 }],
      });
    });

    await act(async () => {
      rejectNetworkA(new Error('Network offline'));
      await Promise.resolve();
    });

    expect(useAppStore.getState().sessionId).toBe('sess-b3-id');
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().history[0].id).toBe('opening-msg-b3');
  });

  it('3. within one session, supersede attempt through retake + new turn at same turn count -> late result dropped', async () => {
    let resolveTurn1!: (frame: RatifiedEngineFrame) => void;
    let resolveTurn2!: (frame: RatifiedEngineFrame) => void;

    mockExecuteRatificationPipeline.mockImplementationOnce(
      () => new Promise((resolve) => { resolveTurn1 = resolve; })
    );

    await act(async () => {
      root?.render(<Runtime />);
    });

    // 1. Submit Turn 1
    const observeBtn = container?.querySelector('button[title*="Observe"]') as HTMLButtonElement;
    await act(async () => {
      observeBtn.click();
    });

    // Turn 1 resolves and commits -> turnCount = 1
    await act(async () => {
      resolveTurn1(createValidFrame('Turn 1 committed successfully.'));
      await Promise.resolve();
    });

    expect(useAppStore.getState().turnCount).toBe(1);
    expect(useAppStore.getState().history).toHaveLength(3); // opening + user + assistant
    const revAfterTurn1 = useAppStore.getState().canonicalRevision;

    // 2. Start Turn 2 (which captures preSnapshot with turnCount=1, rev=revAfterTurn1)
    mockExecuteRatificationPipeline.mockImplementationOnce(
      () => new Promise((resolve) => { resolveTurn2 = resolve; })
    );

    await act(async () => {
      observeBtn.click();
    });

    // 3. While Turn 2 is in-flight, user retakes Turn 1!
    await act(async () => {
      const retakeSuccess = useAppStore.getState().retakeLastTurn();
      expect(retakeSuccess).toBe(true);
    });

    // After retake, turnCount is back to 0, and canonicalRevision has incremented
    expect(useAppStore.getState().turnCount).toBe(0);
    const revAfterRetake = useAppStore.getState().canonicalRevision;
    expect(revAfterRetake).toBeGreaterThan(revAfterTurn1);

    // 4. User plays a replacement Turn 1, which commits!
    mockExecuteRatificationPipeline.mockImplementationOnce(() =>
      Promise.resolve(createValidFrame('Replacement Turn 1 committed.'))
    );

    await act(async () => {
      observeBtn.click();
      await Promise.resolve();
    });

    // Now turnCount has reached 1 again!
    expect(useAppStore.getState().turnCount).toBe(1);
    expect(useAppStore.getState().history).toHaveLength(3);
    expect(useAppStore.getState().history[2].content).toContain('Replacement Turn 1');

    // 5. Now the stale Turn 2 from the rewound state arrives late!
    await act(async () => {
      resolveTurn2(createValidFrame('Stale Turn 2 from rewound state.'));
      await Promise.resolve();
    });

    // Stale Turn 2 MUST be ignored: turnCount remains 1, history still only has replacement Turn 1
    expect(useAppStore.getState().turnCount).toBe(1);
    expect(useAppStore.getState().history).toHaveLength(3);
    expect(useAppStore.getState().history[2].content).toContain('Replacement Turn 1');
  });

  it('4. current successful attempt publishes exactly once; current failure leaves legitimate receipt', async () => {
    mockExecuteRatificationPipeline.mockImplementationOnce(() =>
      Promise.resolve(createValidFrame('A legitimate turn.'))
    );

    await act(async () => {
      root?.render(<Runtime />);
    });

    const observeBtn = container?.querySelector('button[title*="Observe"]') as HTMLButtonElement;
    await act(async () => {
      observeBtn.click();
      await Promise.resolve();
    });

    // Legitimate turn committed
    expect(useAppStore.getState().turnCount).toBe(1);
    expect(useAppStore.getState().history).toHaveLength(3); // opening + user + assistant
    expect(useEngineStore.getState().gameState?.inventory).toEqual(['ancient_amulet']);

    // Now execute a legitimate failure in the current session
    mockExecuteRatificationPipeline.mockImplementationOnce(() =>
      Promise.reject(new TurnResponseError({ code: 'PROVIDER_FAILURE', message: 'Provider failed' }))
    );

    await act(async () => {
      observeBtn.click();
      await Promise.resolve();
    });

    // Failure message recorded without changing canonical turnCount or inventory
    expect(useAppStore.getState().turnCount).toBe(1);
    expect(useAppStore.getState().history).toHaveLength(5); // 3 prior + user + failMsg
    const failMsg = useAppStore.getState().history[4];
    expect(failMsg.role).toBe('assistant');
    expect(failMsg.failureReceipt?.code).toBe('PROVIDER_FAILURE');
    expect(useEngineStore.getState().gameState?.inventory).toEqual(['ancient_amulet']);
  });
});
