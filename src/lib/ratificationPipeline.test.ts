/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { executeRatificationPipeline, formatRecentHistory, projectPlayableStoryBlocks, TurnResponseError, isPreviousTransitionRejected } from './ratificationPipeline';
import { useAppStore } from '../store/useAppStore';
import { useEngineStore } from '../core/store';
import { engineReducer } from '../core/engine/reducer';
import { Blueprint, RuntimeStateSnapshot, LogicState, SpatialNode } from '../types';
import type { EngineTurnContext } from '../types/engineContract';
import { normalizeBlueprint } from './normalizeBlueprint';

describe('executeRatificationPipeline single pre-turn snapshot lifecycle', () => {
  const originalFetch = globalThis.fetch;

  const defaultConsequenceReceipt = {
    version: 1 as const,
    pre_state: {
      inventory: [],
      player_injuries: [],
      psychological_status: 'STABLE' as const,
    },
    post_state: {
      inventory: [],
      player_injuries: [],
      psychological_status: 'STABLE' as const,
    },
    patch: {
      inventory_added: [],
      inventory_removed: [],
      injuries_added: [],
      injuries_removed: [],
      psychological_status_change: null,
    },
    decisions: [],
  };

  const defaultCharacterStanceReceipt = {
    version: 1 as const,
    pre_state: {},
    post_state: {},
    decisions: [],
  };

  const defaultCharacterRelationshipReceipt = {
    version: 1 as const,
    pre_state: [],
    post_state: [],
    decisions: [],
  };

  const defaultCharacterMemoryReceipt = {
    version: 1 as const,
    pre_state: {},
    post_state: {},
    decisions: [],
  };

  const defaultWorldMemoryReceipt = {
    version: 1 as const,
    pre_state: [],
    post_state: [],
    decisions: [],
  };

  const defaultHG1Receipts = {
    fictionalTimeReceipt: {
      version: 1 as const,
      preState: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
      acceptedCost: 'MOMENT' as const,
      postState: { moment_revision: 1, scene_beat_revision: 0, extended_revision: 0, last_cost: 'MOMENT' as const },
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
    },
    valueStateReceipt: {
      version: 1 as const,
      preState: {},
      postState: {},
      decisions: [],
    },
    characterPursuitReceipt: {
      version: 1 as const,
      preState: {},
      postState: {},
      decisions: [],
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
    },
  };

  beforeEach(() => {
    useEngineStore.getState().resetEngine();
    useAppStore.getState().resetSession();

    // Set EngineStore active blueprint
    useEngineStore.setState({
      activeBlueprint: {
        title: 'Test Chamber',
        topology: { nodes: ['STORE_NODE_ORIGIN', 'SUPPLIED_SANCTUM_NODE'], connections: [] },
      } as unknown as Blueprint,
    });

    // Set AppStore to a baseline state
    useAppStore.setState({
      currentNodeId: 'STORE_NODE_ORIGIN',
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      tensionLevel: 10,
      phase: 'LATENT',
      turnCount: 1,
      reconciliationRevision: 0,
      activeMemory: { systemFlags: ['FLAG_A'], somaState: [], geomState: [] },
      storyLog: [],
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses the exact passed preSnapshot for context and network payload without re-capturing from store', async () => {
    // Distinct supplied snapshot differing from current store state
    const suppliedSnapshot: RuntimeStateSnapshot = {
      version: 1,
      sessionId: 'sess_custom_99',
      blueprintId: 'bp_custom_88',
      turnCount: 5,
      currentNodeId: 'SUPPLIED_SANCTUM_NODE',
      activeVector: 'SOMATIC',
      activeTier: 'GATEWAY',
      phase: 'MANIFEST',
      tension: 75,
      coherence: 0.8,
      decayRate: 0.02,
      reconciliationRevision: 4,
      activeFlags: ['FLAG_SUPPLIED_SPECIAL'],
    };

    let capturedRequestBody: {
      stateContext: {
        currentNodeId?: string;
        activeVector?: string;
        activeTier?: string;
        tensionLevel?: number;
        currentPhase?: string;
        reconciliationRevision?: number;
      };
      context: {
        topology: { currentNodeId: string };
        runtime: {
          activeVector: string;
          activeTier: string;
          tension: number;
          phase: string;
          reconciliationRevision: number;
        };
      };
    } | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedRequestBody = JSON.parse(init.body as string);
      }
      return new Response(
        JSON.stringify({
          narrative_blocks: [{ type: 'prose', content: 'The iron heavy air vibrates.' }],
          logic_state: {
            current_phase: 'MANIFEST',
            suggested_tension: 80,
          },
          topologyDelta: { isExpansion: false },
          validation: { accepted: true },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const frame = await executeRatificationPipeline('Check the glyphs', suppliedSnapshot);

    // 1. Verify that network payload received the exact supplied snapshot coordinates and context
    expect(capturedRequestBody).not.toBeNull();
    expect(capturedRequestBody?.stateContext.currentNodeId).toBe('SUPPLIED_SANCTUM_NODE');
    expect(capturedRequestBody?.stateContext.activeVector).toBe('SOMATIC');
    expect(capturedRequestBody?.stateContext.activeTier).toBe('GATEWAY');
    expect(capturedRequestBody?.stateContext.tensionLevel).toBe(75);
    expect(capturedRequestBody?.stateContext.currentPhase).toBe('MANIFEST');
    expect(capturedRequestBody?.stateContext.reconciliationRevision).toBe(4);

    // Context runtime/topology matches supplied snapshot, not the different store state
    expect(capturedRequestBody?.context.topology.currentNodeId).toBe('SUPPLIED_SANCTUM_NODE');
    expect(capturedRequestBody?.context.runtime.activeVector).toBe('SOMATIC');
    expect(capturedRequestBody?.context.runtime.activeTier).toBe('GATEWAY');
    expect(capturedRequestBody?.context.runtime.tension).toBe(75);
    expect(capturedRequestBody?.context.runtime.phase).toBe('MANIFEST');
    expect(capturedRequestBody?.context.runtime.reconciliationRevision).toBe(4);

    // 2. The returned frame preserves reference identity to the exact supplied snapshot
    expect(frame.preSnapshot).toBe(suppliedSnapshot);
    expect(frame.preSnapshot?.currentNodeId).toBe('SUPPLIED_SANCTUM_NODE');
    expect(frame.preSnapshot?.activeVector).toBe('SOMATIC');
  });

  it('passes cast arrivals/departures and dramaturgy state into the ratified frame (R4)', async () => {
    const suppliedSnapshot: RuntimeStateSnapshot = {
      version: 1,
      sessionId: 'sess_arrivals_1',
      blueprintId: 'bp_arrivals_1',
      turnCount: 2,
      currentNodeId: 'AUTOPSY_B',
      activeVector: 'SOMATIC',
      activeTier: 'MANIFEST',
      phase: 'MANIFEST',
      tension: 50,
      coherence: 0.9,
      decayRate: 0.01,
      reconciliationRevision: 1,
      activeFlags: [],
    };

    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          narrative_blocks: [
            { type: 'prose', content: 'Footsteps scrape somewhere beyond the bulkhead wall.' },
          ],
          logic_state: {
            current_phase: 'MANIFEST',
            cast_arrivals: ['char-holt', 42],
            cast_departures: ['char-orderly'],
            dramaturgyState: {
              currentMacroPhase: 'COMPLICATION_ENCLOSURE',
              activePacingCadence: 'MOUNTING_COMPLICATION',
              consecutiveTurnsInCadence: 1,
              impendingClocks: {},
              characterStakes: {},
              milestones: [],
              receiptHistory: [],
            },
          },
          topologyDelta: { isExpansion: false },
          validation: { accepted: true },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const frame = await executeRatificationPipeline('Listen at the bulkhead', suppliedSnapshot);

    expect(frame.logic_state.cast_arrivals).toEqual(['char-holt']);
    expect(frame.logic_state.cast_departures).toEqual(['char-orderly']);
    expect(frame.logic_state.dramaturgyState?.activePacingCadence).toBe('MOUNTING_COMPLICATION');
    expect(frame.logic_state.dramaturgyState?.currentMacroPhase).toBe('COMPLICATION_ENCLOSURE');
  });

  it('passes characterContinuity from engine gameState and preserves cast_deltas in ratified frame', async () => {
    useEngineStore.setState({
      activeBlueprint: {
        title: 'Continuity Lab',
        cast: [
          { id: 'char-1', name: 'Alice', vulnerabilityBase: { resilience: 0.5, skepticism: 0.2, baggage: 0.5 } },
          { id: 'char-2', name: 'Bob' },
        ],
        topology: { nodes: ['LAB_01'], connections: [] },
      } as unknown as Blueprint,
      gameState: {
        character_continuity: {
          'char-1': { skepticism: 0.75 },
        },
      } as unknown as LogicState,
    });

    let sentContext: EngineTurnContext | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        sentContext = (JSON.parse(init.body as string) as { context: EngineTurnContext }).context;
      }
      return new Response(
        JSON.stringify({
          narrative_blocks: [{ type: 'prose', content: 'The lights flicker.' }],
          logic_state: {
            current_phase: 'LATENT',
            cast_deltas: [
              { character_id: 'char-1', skepticism_delta: -0.1 },
            ],
          },
          topologyDelta: { isExpansion: false },
          validation: { accepted: true },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const frame = await executeRatificationPipeline('Check lights');

    // Context received resolved character continuity
    expect(sentContext).not.toBeNull();
    const aliceInContext = sentContext?.cast.find((c) => c.id === 'char-1');
    const bobInContext = sentContext?.cast.find((c) => c.id === 'char-2');
    expect(aliceInContext?.skepticism).toBe(0.75);
    expect(bobInContext?.skepticism).toBe(0.5);

    // Frame logic_state retains cast_deltas
    expect(frame.logic_state.cast_deltas).toEqual([
      { character_id: 'char-1', skepticism_delta: -0.1 },
    ]);
    // Frame logic_state does not leak client-side character_continuity
    expect((frame.logic_state as Record<string, unknown>).character_continuity).toBeUndefined();
  });

  it('forwards the stored non-first player ID and keeps Director unbound through the real turn request payload', async () => {
    const bindingBlueprint = normalizeBlueprint({
      id: 'bp-binding-generic',
      title: 'Generic Binding Enclosure',
      contentScale: 3,
      contentLevelDescription: 'Standard',
      globalPremise: 'A generic test premise.',
      environmentalRules: ['Rules are strictly enforced.'],
      cast: [
        {
          id: 'char-1',
          name: 'Mortal One',
          role: 'Specialist',
          description: 'First generic mortal subject.',
          isEntity: false,
        },
        {
          id: 'char-2',
          name: 'Mortal Two',
          role: 'Operator',
          description: 'Second generic mortal subject.',
          isEntity: false,
        },
      ],
      setting: {
        location: 'Chamber 01',
        timePeriod: 'Present',
        atmosphere: 'Sterile',
      },
      topology: { nodes: ['STORE_NODE_ORIGIN'], connections: [] },
    });

    useEngineStore.setState({
      activeBlueprint: bindingBlueprint,
      gameState: {
        player_role: 'protagonist',
        player_character_id: 'char-2',
        perspective_mode: 'embodied',
      },
    });

    const sentContexts: EngineTurnContext[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        sentContexts.push(
          (JSON.parse(init.body as string) as { context: EngineTurnContext }).context
        );
      }
      return new Response(
        JSON.stringify({
          narrative_blocks: [{ type: 'prose', content: 'The diagnostic light remains steady.' }],
          logic_state: { current_phase: 'LATENT', suggested_tension: 10 },
          topologyDelta: { isExpansion: false },
          validation: { accepted: true },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    await executeRatificationPipeline('Inspect the diagnostic light');

    expect(sentContexts[0].player).toEqual({
      role: 'protagonist',
      characterId: 'char-2',
      name: 'Mortal Two',
      description: 'Second generic mortal subject.',
      isEntity: false,
    });
    expect(sentContexts[0].cast.find((member) => member.id === 'char-2')?.isUserCharacter).toBe(
      true
    );
    expect(sentContexts[0].cast.find((member) => member.id === 'char-1')?.isUserCharacter).toBe(
      false
    );

    useEngineStore.setState({
      gameState: {
        player_role: 'director',
        player_character_id: null,
        perspective_mode: 'director',
      },
    });

    await executeRatificationPipeline('Hold the frame');

    expect(sentContexts[1].player).toEqual({
      role: 'director',
      characterId: null,
      name: 'Director',
      description: 'External narrative director.',
      isEntity: false,
    });
    expect(sentContexts[1].cast.every((member) => member.isUserCharacter === false)).toBe(true);
  });

  it('falls back to local capture only when no snapshot is supplied (e.g. internal/SYSTEM_INIT caller)', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          narrative_blocks: [{ type: 'prose', content: 'Simulation initiated.' }],
          logic_state: { current_phase: 'LATENT', suggested_tension: 0 },
          topologyDelta: { isExpansion: false },
          validation: { accepted: true },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const frame = await executeRatificationPipeline('SYSTEM_INIT');
    expect(frame.preSnapshot).toBeDefined();
    expect(frame.preSnapshot?.currentNodeId).toBe('STORE_NODE_ORIGIN');
    expect(frame.preSnapshot?.activeVector).toBe('COGNITIVE');
    expect(frame.preSnapshot?.activeTier).toBe('LATENT');
  });

  it('rejects with STRUCTURAL_RESPONSE_MISMATCH when 2xx body fails TurnResponseSchema and leaves runtime state untouched', async () => {
    const preSnapshot: RuntimeStateSnapshot = {
      version: 1,
      turnCount: 2,
      currentNodeId: 'STORE_NODE_ORIGIN',
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      phase: 'LATENT',
      tension: 10,
      coherence: 1.0,
      reconciliationRevision: 0,
      activeFlags: [],
    };

    // 200 OK but invalid JSON structure (missing narrative_blocks and logic_state)
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          corrupted: true,
          random_payload: 12345,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    let caughtError: TurnResponseError | null = null;
    try {
      await executeRatificationPipeline('Examine console', preSnapshot);
    } catch (err) {
      caughtError = err as TurnResponseError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('STRUCTURAL_RESPONSE_MISMATCH');
    expect(caughtError?.status).toBe(200);

    // Verify engineReducer handling when dispatched as TURN_FAILED
    const appState = useAppStore.getState();
    const nextState = engineReducer(appState, {
      type: 'TURN_FAILED',
      payload: {
        commandText: 'Examine console',
        errorCategory: caughtError?.code || 'STRUCTURAL_RESPONSE_MISMATCH',
        errorMessage: caughtError?.message || '',
        statusCode: caughtError?.status,
        contentType: caughtError?.contentType,
        preSnapshot,
      },
    });

    expect(nextState.turnCount).toBe(appState.turnCount);
    expect(nextState.currentNodeId).toBe(appState.currentNodeId);
    expect(nextState.activeVector).toBe(appState.activeVector);
    expect(nextState.activeTier).toBe(appState.activeTier);
    expect(nextState.tensionLevel).toBe(appState.tensionLevel);

    const failMsg = nextState.history[1];
    expect(failMsg.role).toBe('assistant');
    expect(failMsg.turnReceipt?.accepted).toBe(false);
    expect(failMsg.turnReceipt?.preSnapshot).toEqual(preSnapshot);
    expect(failMsg.turnReceipt?.postSnapshot).toEqual(preSnapshot);
  });

  it('rejects with FRAME_VALIDATION_REJECTED when schema-valid body fails ratification (e.g. empty narrative_blocks) and leaves runtime state untouched', async () => {
    const preSnapshot: RuntimeStateSnapshot = {
      version: 1,
      turnCount: 2,
      currentNodeId: 'STORE_NODE_ORIGIN',
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      phase: 'LATENT',
      tension: 10,
      coherence: 1.0,
      reconciliationRevision: 0,
      activeFlags: [],
    };

    // Schema-valid format for TurnResultSchema/TurnResponseSchema, but narrative_blocks is empty
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          narrative_blocks: [], // Rejected by ratification rule: narrative_blocks must not be empty
          logic_state: {
            current_phase: 'MANIFEST',
            suggested_tension: 30,
          },
          topologyDelta: { isExpansion: false },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    let caughtError: TurnResponseError | null = null;
    try {
      await executeRatificationPipeline('Listen closely', preSnapshot);
    } catch (err) {
      caughtError = err as TurnResponseError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('FRAME_VALIDATION_REJECTED');

    // Verify engineReducer handling when dispatched as TURN_FAILED
    const appState = useAppStore.getState();
    const nextState = engineReducer(appState, {
      type: 'TURN_FAILED',
      payload: {
        commandText: 'Listen closely',
        errorCategory: caughtError?.code || 'FRAME_VALIDATION_REJECTED',
        errorMessage: caughtError?.message || '',
        statusCode: caughtError?.status,
        contentType: caughtError?.contentType,
        preSnapshot,
      },
    });

    expect(nextState.turnCount).toBe(appState.turnCount);
    expect(nextState.currentNodeId).toBe(appState.currentNodeId);
    expect(nextState.activeVector).toBe(appState.activeVector);
    expect(nextState.activeTier).toBe(appState.activeTier);

    const failMsg = nextState.history[1];
    expect(failMsg.role).toBe('assistant');
    expect(failMsg.turnReceipt?.accepted).toBe(false);
    expect(failMsg.turnReceipt?.preSnapshot).toEqual(preSnapshot);
    expect(failMsg.turnReceipt?.postSnapshot).toEqual(preSnapshot);
  });

  it('preserves dialogue speaker attribution in compact history', () => {
    expect(formatRecentHistory([
      { type: 'dialogue', speaker: 'Jules Mercer', content: 'The receiver only repeats what it heard.' },
      { type: 'prose', content: 'Rain tightens against the shutters.' },
    ])).toBe(
      '[DIALOGUE | Jules Mercer]: The receiver only repeats what it heard....\n' +
      '[PROSE]: Rain tightens against the shutters....'
    );
  });

  describe('Packet 03 - projectPlayableStoryBlocks continuity projection', () => {
    it('projects opening narrative from history when storyLog is empty', () => {
      const state = {
        history: [
          {
            id: 'open-1',
            role: 'assistant' as const,
            content: 'A brass bell hangs motionless.',
            blocks: [{ type: 'prose', content: 'A brass bell hangs motionless.' }],
            timestamp: 100,
          },
        ],
        storyLog: [],
      };

      const blocks = projectPlayableStoryBlocks(state);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toBe('A brass bell hangs motionless.');
    });

    it('deduplicates identical opening blocks present in both history and storyLog', () => {
      const state = {
        history: [
          {
            id: 'open-1',
            role: 'assistant' as const,
            content: 'A brass bell hangs motionless.',
            blocks: [{ type: 'prose', content: 'A brass bell hangs motionless.' }],
            timestamp: 100,
          },
        ],
        storyLog: [
          { type: 'prose', content: 'A brass bell hangs motionless.' },
          { type: 'prose', content: 'You step closer to the bell.' },
        ],
      };

      const blocks = projectPlayableStoryBlocks(state);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].content).toBe('A brass bell hangs motionless.');
      expect(blocks[1].content).toBe('You step closer to the bell.');
    });

    it('excludes failure messages, system diagnostics, and rejected candidate frames from playable context', () => {
      const state = {
        history: [
          {
            id: 'open-1',
            role: 'assistant' as const,
            content: 'A brass bell hangs motionless.',
            blocks: [{ type: 'prose', content: 'A brass bell hangs motionless.' }],
            timestamp: 100,
          },
          {
            id: 'fail-1',
            role: 'assistant' as const,
            content: '[CRITICAL ENGINE FAILURE]: 500 Network error.',
            timestamp: 101,
          },
          {
            id: 'fail-2',
            role: 'assistant' as const,
            content: '[TURN_FAILED] Provider refusal.',
            turnReceipt: { accepted: false } as any,
            timestamp: 102,
          },
          {
            id: 'sys-1',
            role: 'assistant' as const,
            content: '[ SYSTEM: NEURAL LINK SEVERED ]',
            timestamp: 103,
          },
          {
            id: 'rej-1',
            role: 'assistant' as const,
            content: 'Hallucinated text',
            validation: { accepted: false, rejected_fields: ['ERR'], repair_notes: [] },
            timestamp: 104,
          },
        ],
        storyLog: [],
      };

      const blocks = projectPlayableStoryBlocks(state);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toBe('A brass bell hangs motionless.');
    });
  });

  it('preserves valid server castInteractionReceipt through ratification pipeline onto returned frame', async () => {
    const preSnapshot: RuntimeStateSnapshot = {
      version: 1,
      sessionId: 'sess_1',
      blueprintId: 'bp_1',
      turnCount: 2,
      currentNodeId: 'STORE_NODE_ORIGIN',
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      phase: 'LATENT',
      tension: 10,
      coherence: 1.0,
      decayRate: 0.01,
      reconciliationRevision: 0,
      activeFlags: [],
    };

    const serverReceipt = {
      version: 1,
      addressedCharacterId: 'char-a',
      respondingCharacterId: 'char-a',
      outcome: 'RESPONDED' as const,
    };

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          narrative_blocks: [
            { type: 'dialogue', speaker: 'Cast Member A', content: 'Affirmative.' },
          ],
          logic_state: {
            current_phase: 'LATENT',
            suggested_tension: 15,
          },
          transitionReceipt: {
            requestedNodeId: 'STORE_NODE_ORIGIN',
            accepted: true,
            fromNodeId: 'STORE_NODE_ORIGIN',
            toNodeId: 'STORE_NODE_ORIGIN',
            reason: 'TRANSITION_ACCEPTED',
          },
          castInteractionReceipt: serverReceipt,
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const result = await executeRatificationPipeline('Speak to Cast Member A', preSnapshot);

    expect(result.castInteractionReceipt).toBeDefined();
    expect(result.castInteractionReceipt).toEqual(serverReceipt);
    expect(result.castInteractionReceipt?.outcome).toBe('RESPONDED');
    expect(result.castInteractionReceipt?.addressedCharacterId).toBe('char-a');
    expect(result.castInteractionReceipt?.respondingCharacterId).toBe('char-a');
  });

  it('preserves valid server intent and reconciliation receipts through ratification pipeline onto returned frame', async () => {
    const preSnapshot: RuntimeStateSnapshot = {
      version: 1,
      sessionId: 'sess_1',
      blueprintId: 'bp_1',
      turnCount: 3,
      currentNodeId: 'STORE_NODE_ORIGIN',
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      phase: 'LATENT',
      tension: 20,
      coherence: 0.9,
      decayRate: 0.01,
      reconciliationRevision: 0,
      activeFlags: [],
    };

    const serverIntentReceipt = {
      version: 1 as const,
      action_kind: 'INVESTIGATE' as const,
      action_subtype: null,
      pressure_direction: 'ESCALATE' as const,
      dramatic_tactic: 'FIXATION' as const,
      intent_synergy: 'N/A' as const,
    };

    const serverReconciliationReceipt = {
      version: 1 as const,
      mode: 'CANONICAL' as const,
      feasibility: 'SUPPORTED' as const,
      reason_code: 'NONE' as const,
      fictional_time_cost: 'MOMENT' as const,
      authority_alignment: 'NOT_APPLICABLE' as const,
      memory_echo_candidate: null,
      revision_increment: 0 as const,
    };

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          narrative_blocks: [
            { type: 'prose', content: 'You examine the rusted metal hinges.' },
          ],
          logic_state: {
            current_phase: 'LATENT',
            suggested_tension: 25,
          },
          intentReceipt: serverIntentReceipt,
          narrativeReconciliationReceipt: serverReconciliationReceipt,
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const result = await executeRatificationPipeline('Search the hinges', preSnapshot);

    expect(result.intentReceipt).toBeDefined();
    expect(result.intentReceipt).toEqual(serverIntentReceipt);
    expect(result.narrativeReconciliationReceipt).toBeDefined();
    expect(result.narrativeReconciliationReceipt).toEqual(serverReconciliationReceipt);
  });

  it('submits actions with old collision keywords to /api/turn even in high-tension/low-coherence ONTOLOGICAL_SHEAR state without client-side interception', async () => {
    // Configure high tension and low coherence state that previously triggered ONTOLOGICAL_SHEAR
    useAppStore.setState({
      tensionLevel: 90,
      storyLog: [
        { type: 'prose', content: 'The walls twist under severe geometric stress.' },
      ],
    });

    const highTensionLowCoherenceSnapshot: RuntimeStateSnapshot = {
      version: 1,
      sessionId: 'sess_shear',
      blueprintId: 'bp_shear',
      turnCount: 8,
      currentNodeId: 'STORE_NODE_ORIGIN',
      activeVector: 'COSMIC',
      activeTier: 'TERMINAL',
      phase: 'TERMINAL',
      tension: 90,
      coherence: 0.1,
      decayRate: 0.05,
      reconciliationRevision: 1,
      activeFlags: [],
    };

    let fetchCalled = false;
    let requestAction = '';

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      fetchCalled = true;
      if (init?.body) {
        requestAction = JSON.parse(init.body as string).userAction;
      }
      return new Response(
        JSON.stringify({
          narrative_blocks: [
            { type: 'prose', content: 'The impossible door creaks, answering your touch.' },
          ],
          logic_state: {
            current_phase: 'TERMINAL',
            suggested_tension: 95,
          },
          intentReceipt: {
            version: 1,
            action_kind: 'MANIPULATE',
            action_subtype: null,
            pressure_direction: 'ESCALATE',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          },
          narrativeReconciliationReceipt: {
            version: 1,
            mode: 'CANONICAL',
            feasibility: 'SUPPORTED',
            reason_code: 'NONE',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'NOT_APPLICABLE',
            memory_echo_candidate: null,
            revision_increment: 0,
          },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const result = await executeRatificationPipeline('Open the impossible door', highTensionLowCoherenceSnapshot);

    // 1. Fetch was invoked directly
    expect(fetchCalled).toBe(true);
    expect(requestAction).toBe('Open the impossible door');

    // 2. Server's ordinary narrative prose is returned
    expect(result.narrative_blocks).toHaveLength(1);
    expect(result.narrative_blocks[0].type).toBe('prose');
    expect(result.narrative_blocks[0].content).toBe('The impossible door creaks, answering your touch.');

    // 3. No client-side system correction replaced the response
    expect(result.narrative_blocks[0].type).not.toBe('system_voice');
    expect(result.reconciliation).toBeUndefined();
  });

  it('Packet 1E-2 Runtime Chain Proof: mixed dialogue-plus-movement commits nodeAfter and projects next turn context', async () => {
    // 1. Setup spatial graph with ENTRY_HALL -> RECORDS_OFFICE connection
    const spatialGraph: SpatialNode[] = [
      {
        id: 'ENTRY_HALL',
        name: 'Entry Hall',
        description: 'A quiet entrance corridor.',
        connectedNodes: ['RECORDS_OFFICE'],
        exits: [
          {
            description: 'records office door',
            targetNodeId: 'RECORDS_OFFICE',
            isOpen: true,
            kind: 'PHYSICAL',
            userInitiated: true,
          },
        ],
      },
      {
        id: 'RECORDS_OFFICE',
        name: 'Records Office',
        description: 'Filing cabinets line the wall.',
        connectedNodes: ['ENTRY_HALL', 'ARCHIVE_VAULT'],
        exits: [
          {
            description: 'back to hall',
            targetNodeId: 'ENTRY_HALL',
            isOpen: true,
            kind: 'PHYSICAL',
            userInitiated: true,
          },
          {
            description: 'vault door',
            targetNodeId: 'ARCHIVE_VAULT',
            isOpen: true,
            kind: 'PHYSICAL',
            userInitiated: true,
          },
        ],
      },
    ];

    useAppStore.setState({
      currentNodeId: 'ENTRY_HALL',
      spatialGraph,
      turnCount: 1,
      storyLog: [],
    });

    useEngineStore.setState({
      activeBlueprint: {
        title: 'Facility Baseline',
        topology: {
          nodes: ['ENTRY_HALL', 'RECORDS_OFFICE'],
          connections: [
            { from: 'ENTRY_HALL', to: 'RECORDS_OFFICE', userInitiated: true },
            { from: 'RECORDS_OFFICE', to: 'ENTRY_HALL', userInitiated: true },
          ],
        },
      } as unknown as Blueprint,
    });

    const preSnapshot: RuntimeStateSnapshot = {
      version: 1,
      sessionId: 'sess_chain_1',
      blueprintId: 'bp_chain_1',
      turnCount: 1,
      currentNodeId: 'ENTRY_HALL',
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      tension: 20,
      phase: 'LATENT',
      coherence: 1.0,
      decayRate: 0.05,
      reconciliationRevision: 0,
      activeFlags: [],
    };

    interface OutboundTurnPayload {
      userAction: string;
      context: EngineTurnContext;
      [key: string]: unknown;
    }

    let capturedPayload: OutboundTurnPayload | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string) as OutboundTurnPayload;
      }
      return new Response(
        JSON.stringify({
          narrative_blocks: [
            {
              type: 'prose',
              content: 'You walk alongside the guide into the records office as she begins to speak.',
            },
          ],
          logic_state: {
            current_phase: 'LATENT',
            suggested_tension: 25,
            requested_transition: 'RECORDS_OFFICE',
          },
          intentReceipt: {
            version: 1,
            action_kind: 'COMMUNICATE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'SUCCESS',
          },
          narrativeReconciliationReceipt: {
            version: 1,
            mode: 'CANONICAL',
            feasibility: 'SUPPORTED',
            reason_code: 'NONE',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'NOT_APPLICABLE',
            memory_echo_candidate: null,
            revision_increment: 0,
          },
          transitionReceipt: {
            requestedNodeId: 'RECORDS_OFFICE',
            accepted: true,
            fromNodeId: 'ENTRY_HALL',
            toNodeId: 'RECORDS_OFFICE',
            reason: 'TRANSITION_ACCEPTED',
          },
          castInteractionReceipt: {
            version: 1,
            addressedCharacterId: 'char-guide',
            respondingCharacterId: 'char-guide',
            outcome: 'RESPONDED',
          },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const ratifiedFrame = await executeRatificationPipeline(
      'I follow the guide into the records office while asking about the missing files',
      preSnapshot
    );

    // 1. Initial turn verification: outgoing context started at ENTRY_HALL
    expect(capturedPayload?.context.topology.currentNodeId).toBe('ENTRY_HALL');
    expect(ratifiedFrame.transitionReceipt?.accepted).toBe(true);
    expect(ratifiedFrame.transitionReceipt?.toNodeId).toBe('RECORDS_OFFICE');

    // 2. Commit the ratified frame through the engine reducer
    const baseEngineState = useEngineStore.getState() as unknown as Parameters<typeof engineReducer>[0];
    const nextEngineState = engineReducer(
      {
        ...baseEngineState,
        currentNodeId: 'ENTRY_HALL',
        spatialGraph,
      },
      {
        type: 'TURN_COMMITTED',
        payload: {
          commandText:
            'I follow the guide into the records office while asking about the missing files',
          formattedText:
            'You walk alongside the guide into the records office as she begins to speak.',
          frame: ratifiedFrame,
          transitionReceipt: ratifiedFrame.transitionReceipt,
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'ENTRY_HALL',
            requestedTarget: 'RECORDS_OFFICE',
            accepted: true,
            nodeAfter: 'RECORDS_OFFICE',
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
            tension: 20,
            preSnapshot,
            postSnapshot: { ...preSnapshot, turnCount: 2, currentNodeId: 'RECORDS_OFFICE' },
          },
          preSnapshot,
        },
      }
    );

    // Verify engine state committed the node advance
    expect(nextEngineState.currentNodeId).toBe('RECORDS_OFFICE');

    // Update app store to reflect committed turn
    useAppStore.setState({
      currentNodeId: 'RECORDS_OFFICE',
      turnCount: 2,
    });

    // 3. Next turn execution: captures snapshot from new committed node RECORDS_OFFICE
    const nextSnapshot: RuntimeStateSnapshot = {
      ...preSnapshot,
      turnCount: 2,
      currentNodeId: 'RECORDS_OFFICE',
    };

    let nextCapturedPayload: OutboundTurnPayload | null = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        nextCapturedPayload = JSON.parse(init.body as string) as OutboundTurnPayload;
      }
      return new Response(
        JSON.stringify({
          narrative_blocks: [{ type: 'prose', content: 'You look around the records office.' }],
          logic_state: { current_phase: 'LATENT', suggested_tension: 25 },
          intentReceipt: {
            version: 1,
            action_kind: 'OBSERVE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          },
          narrativeReconciliationReceipt: {
            version: 1,
            mode: 'CANONICAL',
            feasibility: 'SUPPORTED',
            reason_code: 'NONE',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'NOT_APPLICABLE',
            memory_echo_candidate: null,
            revision_increment: 0,
          },
          transitionReceipt: {
            requestedNodeId: null,
            accepted: false,
            fromNodeId: 'RECORDS_OFFICE',
            toNodeId: 'RECORDS_OFFICE',
            reason: 'NO_MOVEMENT_REQUESTED',
          },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: defaultWorldMemoryReceipt,
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    await executeRatificationPipeline('I look at the rows of filing cabinets', nextSnapshot);

    // 4. Outbound context for turn 2 projects RECORDS_OFFICE and its allowed exits
    expect(nextCapturedPayload?.context.topology.currentNodeId).toBe('RECORDS_OFFICE');
    const exitTargets = (nextCapturedPayload?.context.topology.allowedOutgoingExits || []).map(
      (e: { to: string }) => e.to
    );
    expect(exitTargets).toContain('ENTRY_HALL');
    expect(exitTargets).toContain('ARCHIVE_VAULT');
  });

  it('Packet 01: threads accepted runtime world memory into the production request context and preserves facts across turns', async () => {
    const runtimeFact = {
      id: 'wm_01',
      statement: 'The outer gate is padlocked.',
      kind: 'PERSISTENT_CONSEQUENCE' as const,
      scope: 'GLOBAL' as const,
      node_id: null,
      established_turn: 1,
    };

    // 1. Seed Engine store with established world memory
    useEngineStore.setState({
      gameState: {
        ...(useEngineStore.getState().gameState as any),
        world_memory: [runtimeFact],
      },
    });

    let capturedPayload: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return new Response(
        JSON.stringify({
          narrative_blocks: [{ type: 'prose', content: 'The padlock holds.' }],
          logic_state: {
            current_phase: 'DISCOVERY',
            suggested_tension: 40,
          },
          topologyDelta: { isExpansion: false },
          validation: { accepted: true },
          canonicalConsequenceReceipt: defaultConsequenceReceipt,
          characterStanceReceipt: defaultCharacterStanceReceipt,
          characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
          characterMemoryReceipt: defaultCharacterMemoryReceipt,
          worldMemoryReceipt: {
            version: 1,
            pre_state: [runtimeFact],
            post_state: [runtimeFact],
            decisions: [],
          },
          ...defaultHG1Receipts,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const frame = await executeRatificationPipeline('Check the outer gate');

    // Verify context received the exact runtime world memory fact
    expect(capturedPayload?.context.worldMemory).toHaveLength(1);
    expect(capturedPayload?.context.worldMemory[0].statement).toBe('The outer gate is padlocked.');

    // Verify ratified frame logic_state and worldMemoryReceipt post_state preserved the fact
    expect(frame.worldMemoryReceipt?.post_state[0].statement).toBe('The outer gate is padlocked.');
    expect(frame.logic_state?.world_memory?.[0].statement).toBe('The outer gate is padlocked.');
  });

  describe('lastTransitionRejected wiring (D2/F4)', () => {
    it('isPreviousTransitionRejected returns true only for rejected movement (not accepted or NO_MOVEMENT_REQUESTED)', () => {
      expect(isPreviousTransitionRejected(null)).toBe(false);
      expect(isPreviousTransitionRejected(undefined)).toBe(false);
      expect(
        isPreviousTransitionRejected({
          requestedNodeId: 'room_6',
          accepted: true,
          fromNodeId: 'office',
          toNodeId: 'room_6',
        })
      ).toBe(false);
      expect(
        isPreviousTransitionRejected({
          requestedNodeId: null,
          accepted: false,
          fromNodeId: 'office',
          toNodeId: 'office',
          reason: 'NO_MOVEMENT_REQUESTED',
        })
      ).toBe(false);
      expect(
        isPreviousTransitionRejected({
          requestedNodeId: 'hallway',
          accepted: false,
          fromNodeId: 'office',
          toNodeId: 'office',
          reason: 'UNKNOWN_OR_UNCONNECTED_TARGET',
        })
      ).toBe(true);
      expect(
        isPreviousTransitionRejected({
          requestedNodeId: 'room_7',
          accepted: false,
          fromNodeId: 'office',
          toNodeId: 'office',
          reason: 'NON_USER_INITIATED_EDGE',
        })
      ).toBe(true);
    });

    it('injects lastTransitionRejected: true into stateContext when previous turn movement was rejected', async () => {
      let capturedBody: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string);
        }
        return new Response(
          JSON.stringify({
            narrative_blocks: [{ type: 'prose', content: 'You hesitate before the dark doorway.' }],
            logic_state: { current_phase: 'LATENT', suggested_tension: 10 },
            topologyDelta: { isExpansion: false },
            validation: { accepted: true },
            canonicalConsequenceReceipt: defaultConsequenceReceipt,
            characterStanceReceipt: defaultCharacterStanceReceipt,
            characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
            characterMemoryReceipt: defaultCharacterMemoryReceipt,
            worldMemoryReceipt: defaultWorldMemoryReceipt,
            ...defaultHG1Receipts,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      // Stub state with a previous assistant message whose transition was rejected
      useAppStore.setState({
        history: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Frank tries the door.',
            transitionReceipt: {
              requestedNodeId: 'hallway',
              accepted: false,
              fromNodeId: 'office',
              toNodeId: 'office',
              reason: 'UNKNOWN_OR_UNCONNECTED_TARGET',
            },
          } as any,
        ],
      });

      await executeRatificationPipeline('Turn handle');
      expect(capturedBody?.stateContext?.lastTransitionRejected).toBe(true);
    });

    it('omits lastTransitionRejected from stateContext when previous turn had no movement requested or was accepted', async () => {
      let capturedBody: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string);
        }
        return new Response(
          JSON.stringify({
            narrative_blocks: [{ type: 'prose', content: 'You inspect the ledger.' }],
            logic_state: { current_phase: 'LATENT', suggested_tension: 10 },
            topologyDelta: { isExpansion: false },
            validation: { accepted: true },
            canonicalConsequenceReceipt: defaultConsequenceReceipt,
            characterStanceReceipt: defaultCharacterStanceReceipt,
            characterRelationshipReceipt: defaultCharacterRelationshipReceipt,
            characterMemoryReceipt: defaultCharacterMemoryReceipt,
            worldMemoryReceipt: defaultWorldMemoryReceipt,
            ...defaultHG1Receipts,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      // Stub state with NO_MOVEMENT_REQUESTED
      useAppStore.setState({
        history: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Frank reads the book.',
            transitionReceipt: {
              requestedNodeId: null,
              accepted: false,
              fromNodeId: 'office',
              toNodeId: 'office',
              reason: 'NO_MOVEMENT_REQUESTED',
            },
          } as any,
        ],
      });

      await executeRatificationPipeline('Read ledger');
      expect(capturedBody?.stateContext?.lastTransitionRejected).toBeUndefined();
    });
  });
});
