import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Runtime, { AUTOPILOT_MINIMUM_TURN_INTERVAL_MS } from './Runtime';
import { useAppStore } from '../../store/useAppStore';
import { useEngineStore } from '../../core/store';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';
import type { RatifiedEngineFrame } from '../../types';

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

function createCommittedFrame(): RatifiedEngineFrame {
  return {
    narrative_blocks: [{ type: 'prose', content: 'The test chamber remains still.' }],
    logic_state: {
      current_phase: 'LATENT',
      suggested_tension: 1,
      cast_deltas: [],
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
    },
    valueStateReceipt: {
      version: 1,
      preState: {},
      postState: {},
      decisions: [],
    },
    characterPursuitReceipt: {
      version: 1,
      preState: {},
      postState: {},
      decisions: [],
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
    },
  } as RatifiedEngineFrame;
}

describe('Runtime Autopilot pacing', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    mockExecuteRatificationPipeline.mockReset();
    mockFetchSimulatedPlayerAction.mockReset();

    useAppStore.getState().resetSession();
    useEngineStore.getState().resetEngine();

    const blueprint = normalizeBlueprint({
      id: 'bp-autopilot-pacing',
      title: 'Autopilot Pacing Harness',
      contentScale: 1,
      contentLevelDescription: 'Test harness',
      setting: {
        location: 'Test chamber',
        atmosphere: 'Quiet',
        timePeriod: 'Unspecified',
      },
      cast: [
        {
          id: 'player-test',
          name: 'Test Player',
          role: 'Protagonist',
          description: 'A generic test participant.',
          personality: 'Careful',
          goals: 'Proceed deliberately.',
          traits: ['Patient'],
          isUserCharacter: true,
          isEntity: false,
          starting_location: 'ORIGIN',
        },
      ],
      topology: {
        nodes: ['ORIGIN'],
        connections: [],
      },
    });

    useAppStore.setState({
      sessionId: 'session-autopilot-pacing',
      blueprintId: blueprint.id,
      phase: 'ENGINE',
      currentNodeId: 'ORIGIN',
      spatialGraph: [{ id: 'ORIGIN', name: 'Origin', description: '', exits: [] }],
      history: [
        {
          id: 'opening-message',
          role: 'narrative',
          content: 'The test chamber awaits.',
          timestamp: 1,
        },
      ],
    });

    useEngineStore.setState({
      activeSessionId: 'session-autopilot-pacing',
      activeBlueprint: blueprint,
      gameState: {
        current_location: 'ORIGIN',
        player_character_id: 'player-test',
        player_role: 'protagonist',
        perspective_mode: 'protagonist',
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('paces the first Engine input, rejects duplicate starts, and aborts a pending next turn', async () => {
    mockFetchSimulatedPlayerAction.mockResolvedValue({
      success: true,
      action: 'Study the unmarked panel.',
    });
    mockExecuteRatificationPipeline.mockResolvedValue(createCommittedFrame());

    await act(async () => {
      root?.render(<Runtime />);
    });

    const engageButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Engage')
    );
    expect(engageButton).toBeDefined();

    await act(async () => {
      engageButton?.click();
      engageButton?.click();
      await Promise.resolve();
    });

    expect(mockFetchSimulatedPlayerAction).not.toHaveBeenCalled();
    expect(mockExecuteRatificationPipeline).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS - 1);
    });

    expect(mockFetchSimulatedPlayerAction).not.toHaveBeenCalled();
    expect(mockExecuteRatificationPipeline).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(1);
    expect(mockExecuteRatificationPipeline).toHaveBeenCalledTimes(1);
    expect(mockExecuteRatificationPipeline).toHaveBeenCalledWith(
      'Study the unmarked panel.',
      expect.any(Object),
      expect.anything()
    );

    const abortButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Abort')
    );
    expect(abortButton).toBeDefined();

    await act(async () => {
      abortButton?.click();
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(1);
    expect(mockExecuteRatificationPipeline).toHaveBeenCalledTimes(1);
  });

  it('does not inject an action when abort occurs during simulated-action generation', async () => {
    let resolveSimulatedAction: ((value: { success: true; action: string }) => void) | undefined;
    mockFetchSimulatedPlayerAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSimulatedAction = resolve;
        })
    );

    await act(async () => {
      root?.render(<Runtime />);
    });

    const engageButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Engage')
    );

    await act(async () => {
      engageButton?.click();
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(1);

    const abortButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Abort')
    );

    await act(async () => {
      abortButton?.click();
      resolveSimulatedAction?.({
        success: true,
        action: 'Move toward the far wall.',
      });
      await Promise.resolve();
    });

    expect(mockExecuteRatificationPipeline).not.toHaveBeenCalled();
  });

  it('passes selected mode from dropdown to fetchSimulatedPlayerAction', async () => {
    mockFetchSimulatedPlayerAction.mockResolvedValue({
      success: true,
      action: 'Check the doorway.',
    });
    mockExecuteRatificationPipeline.mockResolvedValue(createCommittedFrame());

    await act(async () => {
      root?.render(<Runtime />);
    });

    const modeSelect = container?.querySelector('select') as HTMLSelectElement | null;
    expect(modeSelect).toBeDefined();

    await act(async () => {
      if (modeSelect) {
        modeSelect.value = 'aggressive';
        modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const engageButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Engage')
    );

    await act(async () => {
      engageButton?.click();
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledWith(
      expect.any(Array),
      expect.anything(),
      expect.objectContaining({ mode: 'aggressive' })
    );
  });

  it('standard mode aborts on first non-COMMITTED turn', async () => {
    mockFetchSimulatedPlayerAction.mockResolvedValue({
      success: true,
      action: 'Attempt invalid jump.',
    });
    mockExecuteRatificationPipeline.mockRejectedValue(new Error('Turn evaluation failed'));

    await act(async () => {
      root?.render(<Runtime />);
    });

    const engageButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Engage')
    );

    await act(async () => {
      engageButton?.click();
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(1);
    expect(mockExecuteRatificationPipeline).toHaveBeenCalledTimes(1);

    // Advance time again - should NOT call action generator again because loop aborted
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS * 2);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(1);
  });

  it('provider refusal budget allows up to 3 refusals and 4th refusal aborts', async () => {
    mockFetchSimulatedPlayerAction.mockResolvedValue({
      success: false,
      code: 'PROVIDER_REFUSAL',
    });

    await act(async () => {
      root?.render(<Runtime />);
    });

    const engageButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Engage')
    );

    await act(async () => {
      engageButton?.click();
      // Refusal 1
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
      // Refusal 2
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
      // Refusal 3
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(3);
    expect(mockExecuteRatificationPipeline).not.toHaveBeenCalled();

    // Refusal 4 (exceeds budget -> aborts)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(4);

    // Further ticks should not produce more calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS * 2);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(4);
  });

  it('adversarial mode continues across FAILED turns, aborts after 3 consecutive non-COMMITTED turns, and logs report', async () => {
    const logSpy = vi.spyOn(console, 'log');

    mockFetchSimulatedPlayerAction.mockResolvedValue({
      success: true,
      action: 'Adversarial probe turn',
    });
    mockExecuteRatificationPipeline.mockRejectedValue(new Error('Validation rejection'));

    await act(async () => {
      root?.render(<Runtime />);
    });

    const modeSelect = container?.querySelector('select') as HTMLSelectElement | null;
    await act(async () => {
      if (modeSelect) {
        modeSelect.value = 'adversarial';
        modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const engageButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Engage')
    );

    await act(async () => {
      engageButton?.click();
      // Turn 1 fails
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
      // Turn 2 fails
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
      // Turn 3 fails -> hits consecutive cap
      await vi.advanceTimersByTimeAsync(AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
    });

    expect(mockFetchSimulatedPlayerAction).toHaveBeenCalledTimes(3);
    expect(mockExecuteRatificationPipeline).toHaveBeenCalledTimes(3);

    // Verify report logged to console
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        autopilotRunReport: true,
        mode: 'adversarial',
        refusals: 0,
        consecutiveNonCommittedCap: 3,
        aborted: true,
        abortReason: 'CONSECUTIVE_NON_COMMITTED_CAP',
        turnOutcomes: expect.objectContaining({
          FAILED: 3,
        }),
      })
    );
    // Contract fields from spec §6 must be present at top level
    const isReportArg = (a: unknown): boolean =>
      typeof a === 'object' &&
      a !== null &&
      'autopilotRunReport' in a &&
      (a as { autopilotRunReport: unknown }).autopilotRunReport === true;
    const reportCall = logSpy.mock.calls.find((args) => args.some(isReportArg));
    expect(reportCall).toBeDefined();
    const report = reportCall!.find(isReportArg) as unknown as Record<string, unknown>;
    expect('characterName' in report).toBe(true);
    expect('refusals' in report).toBe(true);
  });
});

