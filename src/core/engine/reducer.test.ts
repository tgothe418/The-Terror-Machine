/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { engineReducer, initialEngineState } from './reducer';
import type { CommittedTurnPayload, FailedTurnPayload } from './events';
import { captureRuntimeSnapshot } from './snapshot';
import { useAppStore } from '../../store/useAppStore';
import { buildEngineLogContent } from '../../lib/download';
import { buildEngineTurnContext } from '../../lib/buildEngineTurnContext';
import type {
  CanonicalConsequenceReceipt,
  HorrorVector,
  NarrativeReconciliationReceipt,
  LogicState,
  ScenarioBlueprint,
  Message,
} from '../../types';
import type {
  WorldObjectLedger,
  RestraintLedger,
  ObjectTransitionProposal,
  AttentionLedger,
  AttentionTransitionProposal,
} from '../../types/worldState';

describe('engineReducer atomic turn commits', () => {
  it('atomically commits a successful turn and updates state in a single step', () => {
    const startState = {
      ...initialEngineState,
      currentNodeId: 'ORIGIN',
      spatialGraph: [
        { id: 'ORIGIN', name: 'Origin', description: '', exits: [] },
        { id: 'INNER_SANCTUM', name: 'Inner Sanctum', description: '', exits: [] },
      ],
    };

    const preSnapshot = captureRuntimeSnapshot(startState);
    const payload: CommittedTurnPayload = {
      commandText: 'Inspect the ancient mirror',
      formattedText: 'The glass ripples with cold silver light.',
      preSnapshot,
      frame: {
        engine_thoughts: 'Player engages with anomaly.',
        narrative_blocks: [
          { type: 'sensory', content: 'The glass ripples with cold silver light.' },
        ],
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 45,
          terminal_flags: ['FLAG_MIRROR_TOUCHED'],
        },
      },
      transitionReceipt: {
        requestedNodeId: 'INNER_SANCTUM',
        accepted: true,
        fromNodeId: 'ORIGIN',
        toNodeId: 'INNER_SANCTUM',
        reason: 'TRANSITION_ACCEPTED',
      },
      turnReceipt: {
        turnNumber: 1,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'INNER_SANCTUM',
        accepted: true,
        reason: 'TRANSITION_ACCEPTED',
        nodeAfter: 'INNER_SANCTUM',
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        tension: 45,
        preSnapshot,
      },
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload,
    });

    expect(nextState.turnCount).toBe(1);
    expect(nextState.currentNodeId).toBe('INNER_SANCTUM');
    expect(nextState.currentPhase).toBe('MANIFEST');
    expect(nextState.tensionLevel).toBe(45);
    expect(nextState.activeMemory.systemFlags).toContain('FLAG_MIRROR_TOUCHED');
    expect(nextState.history.length).toBe(2);
    expect(nextState.history[0].role).toBe('user');
    expect(nextState.history[0].content).toBe('Inspect the ancient mirror');
    expect(nextState.history[1].role).toBe('assistant');
    expect(nextState.history[1].turnReceipt?.accepted).toBe(true);
    expect(nextState.storyLog?.length).toBe(1);
  });

  it('atomically handles a failed turn without incrementing turnCount or modifying position', () => {
    const startState = {
      ...initialEngineState,
      turnCount: 3,
      currentNodeId: 'LIBRARY',
      tensionLevel: 20,
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    const payload: FailedTurnPayload = {
      commandText: 'Open the locked hatch',
      errorCategory: 'MODEL_CONTRACT_MISMATCH',
      errorMessage: 'Invalid output format',
      statusCode: 502,
      preSnapshot,
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_FAILED',
      payload,
    });

    expect(nextState.turnCount).toBe(3);
    expect(nextState.currentNodeId).toBe('LIBRARY');
    expect(nextState.tensionLevel).toBe(20);
    expect(nextState.history.length).toBe(2);
    expect(nextState.history[0].role).toBe('user');
    expect(nextState.history[1].role).toBe('assistant');
    expect(nextState.history[1].turnReceipt?.accepted).toBe(false);
    expect(nextState.history[1].turnReceipt?.reason).toContain('MODEL_CONTRACT_MISMATCH');
  });

  it('records a non-JSON turn failure receipt safely with exact message and no state progression', () => {
    const startState = {
      ...initialEngineState,
      turnCount: 5,
      currentNodeId: 'SUITE_1408',
      currentPhase: 'MANIFEST' as const,
      tensionLevel: 65,
      activeVector: 'SOMATIC' as const,
      activeTier: 'GATEWAY' as const,
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    const failureReceipt = {
      code: 'NON_JSON_TURN_RESPONSE' as const,
      status: 502,
      contentType: 'text/html',
      message: 'The turn service returned an unexpected non-JSON response. The session state was not changed.',
    };

    const payload: FailedTurnPayload = {
      commandText: 'Examine the telephone',
      failureReceipt,
      errorCategory: failureReceipt.code,
      errorMessage: failureReceipt.message,
      statusCode: failureReceipt.status,
      contentType: failureReceipt.contentType,
      preSnapshot,
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_FAILED',
      payload,
    });

    expect(nextState.turnCount).toBe(5);
    expect(nextState.currentNodeId).toBe('SUITE_1408');
    expect(nextState.currentPhase).toBe('MANIFEST');
    expect(nextState.tensionLevel).toBe(65);
    expect(nextState.activeVector).toBe('SOMATIC');
    expect(nextState.activeTier).toBe('GATEWAY');

    // Exactly 1 user action and 1 failure message recorded
    expect(nextState.history.length).toBe(2);
    expect(nextState.history[0].role).toBe('user');
    expect(nextState.history[0].content).toBe('Examine the telephone');

    const failMsg = nextState.history[1];
    expect(failMsg.role).toBe('assistant');
    expect(failMsg.content).toBe(
      '[ENGINE FAILURE // NON_JSON_TURN_RESPONSE // HTTP 502]\nThe turn service returned an unexpected non-JSON response. The session state was not changed.'
    );
    expect(failMsg.content).not.toContain('<!doctype');
    expect(failMsg.content).not.toContain('<html');
    expect(failMsg.failureReceipt).toEqual(failureReceipt);
    expect(failMsg.turnReceipt?.accepted).toBe(false);
    expect(failMsg.turnReceipt?.nodeBefore).toBe('SUITE_1408');
    expect(failMsg.turnReceipt?.nodeAfter).toBe('SUITE_1408');
    expect(failMsg.turnReceipt?.activeVector).toBe('SOMATIC');
    expect(failMsg.turnReceipt?.activeTier).toBe('GATEWAY');
    expect(failMsg.turnReceipt?.preSnapshot?.activeVector).toBe('SOMATIC');
    expect(failMsg.turnReceipt?.preSnapshot?.activeTier).toBe('GATEWAY');
    expect(failMsg.turnReceipt?.postSnapshot?.activeVector).toBe('SOMATIC');
    expect(failMsg.turnReceipt?.postSnapshot?.activeTier).toBe('GATEWAY');
  });

  it('presents upstream HTML warm-up responses as runtime notices while preserving the full receipt', () => {
    const startState = {
      ...initialEngineState,
      turnCount: 5,
      currentNodeId: 'SUITE_1408',
    };

    const preSnapshot = captureRuntimeSnapshot(startState);
    const failureReceipt = {
      code: 'NON_JSON_TURN_RESPONSE' as const,
      status: 200,
      contentType: 'text/html',
      message: 'The turn service returned an unexpected non-JSON response. The session state was not changed.',
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_FAILED',
      payload: {
        commandText: 'Wait for the runtime',
        failureReceipt,
        errorCategory: failureReceipt.code,
        errorMessage: failureReceipt.message,
        statusCode: failureReceipt.status,
        contentType: failureReceipt.contentType,
        preSnapshot,
      },
    });

    const failMsg = nextState.history[1];
    expect(failMsg.content).toBe(
      '[RUNTIME NOTICE // DEVELOPMENT HOST RESTART]\nThe development runtime is restarting. Your state was not changed. Please retry shortly.'
    );
    expect(failMsg.content).not.toContain('[ENGINE FAILURE');
    expect(failMsg.failureReceipt).toEqual(failureReceipt);
    expect(failMsg.turnReceipt?.reason).toContain('FAILED: NON_JSON_TURN_RESPONSE');
    expect(nextState.turnCount).toBe(5);
    expect(nextState.currentNodeId).toBe('SUITE_1408');
  });

  it('preserves canonical coordinates when no matrix mutation is returned', () => {
    const startState = {
      ...initialEngineState,
      activeVector: 'COSMIC' as const,
      activeTier: 'MANIFEST' as const,
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    const payload: CommittedTurnPayload = {
      commandText: 'Wait silently',
      formattedText: 'The silence thickens.',
      preSnapshot,
      frame: {
        engine_thoughts: 'Player waits.',
        narrative_blocks: [{ type: 'sensory', content: 'The silence thickens.' }],
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 50,
        },
      },
      turnReceipt: {
        turnNumber: 1,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'ORIGIN',
        accepted: true,
        nodeAfter: 'ORIGIN',
        activeVector: 'COSMIC',
        activeTier: 'MANIFEST',
        tension: 50,
        preSnapshot,
      },
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload,
    });

    expect(nextState.activeVector).toBe('COSMIC');
    expect(nextState.activeTier).toBe('MANIFEST');
    expect(nextState.history[1].turnReceipt?.activeVector).toBe('COSMIC');
    expect(nextState.history[1].turnReceipt?.activeTier).toBe('MANIFEST');
  });

  it('atomically changes both coordinates when valid complete next_vector and next_tier mutation is returned', () => {
    const startState = {
      ...initialEngineState,
      activeVector: 'SOMATIC' as const,
      activeTier: 'LATENT' as const,
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    const payload: CommittedTurnPayload = {
      commandText: 'Touch the strange glyph',
      formattedText: 'Your mind unfurls into mathematical abstraction.',
      preSnapshot,
      frame: {
        engine_thoughts: 'Matrix shift triggered.',
        narrative_blocks: [{ type: 'prose', content: 'Your mind unfurls.' }],
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 60,
          matrix_mutation: {
            next_vector: 'COGNITIVE',
            next_tier: 'MANIFEST',
          },
        },
      },
      turnReceipt: {
        turnNumber: 1,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'ORIGIN',
        accepted: true,
        nodeAfter: 'ORIGIN',
        activeVector: 'SOMATIC',
        activeTier: 'LATENT',
        tension: 60,
        preSnapshot,
      },
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload,
    });

    expect(nextState.activeVector).toBe('COGNITIVE');
    expect(nextState.activeTier).toBe('MANIFEST');
    expect(nextState.history[1].turnReceipt?.activeVector).toBe('COGNITIVE');
    expect(nextState.history[1].turnReceipt?.activeTier).toBe('MANIFEST');
  });

  it('changes neither coordinate when matrix mutation is partial or invalid', () => {
    const startState = {
      ...initialEngineState,
      activeVector: 'SOMATIC' as const,
      activeTier: 'GATEWAY' as const,
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    // Partial mutation (missing next_tier)
    const partialPayload: CommittedTurnPayload = {
      commandText: 'Blink',
      formattedText: 'Nothing happens.',
      preSnapshot,
      frame: {
        engine_thoughts: 'Partial shift ignored.',
        narrative_blocks: [{ type: 'prose', content: 'Nothing happens.' }],
        logic_state: {
          matrix_mutation: {
            next_vector: 'COSMIC',
          },
        },
      },
      turnReceipt: {
        turnNumber: 1,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'ORIGIN',
        accepted: true,
        nodeAfter: 'ORIGIN',
        activeVector: 'SOMATIC',
        activeTier: 'GATEWAY',
        tension: 0,
        preSnapshot,
      },
    };

    const stateAfterPartial = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload: partialPayload,
    });
    expect(stateAfterPartial.activeVector).toBe('SOMATIC');
    expect(stateAfterPartial.activeTier).toBe('GATEWAY');

    // Invalid mutation string
    const invalidPayload: CommittedTurnPayload = {
      commandText: 'Blink again',
      formattedText: 'Still nothing.',
      preSnapshot,
      frame: {
        engine_thoughts: 'Invalid shift ignored.',
        narrative_blocks: [{ type: 'prose', content: 'Still nothing.' }],
        logic_state: {
          matrix_mutation: {
            next_vector: 'UNKNOWN_VEC' as unknown as HorrorVector,
            next_tier: 'MANIFEST',
          },
        },
      },
      turnReceipt: {
        turnNumber: 1,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'ORIGIN',
        accepted: true,
        nodeAfter: 'ORIGIN',
        activeVector: 'SOMATIC',
        activeTier: 'GATEWAY',
        tension: 0,
        preSnapshot,
      },
    };

    const stateAfterInvalid = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload: invalidPayload,
    });
    expect(stateAfterInvalid.activeVector).toBe('SOMATIC');
    expect(stateAfterInvalid.activeTier).toBe('GATEWAY');
  });

  it('records distinct pre-snapshot and post-snapshot reflecting accepted state transition', () => {
    const startState = {
      ...initialEngineState,
      turnCount: 2,
      currentNodeId: 'CELLAR',
      spatialGraph: [
        { id: 'CELLAR', name: 'Cellar', description: '', exits: [] },
        { id: 'ATTIC', name: 'Attic', description: '', exits: [] },
      ],
      tensionLevel: 15,
      activeVector: 'SOMATIC' as const,
      activeTier: 'GATEWAY' as const,
      reconciliationRevision: 1,
    };

    const preSnapshot = {
      version: 1 as const,
      turnCount: 2,
      currentNodeId: 'CELLAR',
      activeVector: 'SOMATIC' as const,
      activeTier: 'GATEWAY' as const,
      phase: 'LATENT',
      tension: 15,
      coherence: 1.0,
      decayRate: 0,
      reconciliationRevision: 1,
      activeFlags: [] as readonly string[],
    };

    const payload: CommittedTurnPayload = {
      commandText: 'Climb stairs to Attic',
      formattedText: 'You emerge into the dusty attic.',
      preSnapshot,
      frame: {
        engine_thoughts: 'Transition to ATTIC accepted.',
        narrative_blocks: [{ type: 'prose', content: 'You emerge into the dusty attic.' }],
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 40,
          matrix_mutation: {
            next_vector: 'COSMIC',
            next_tier: 'MANIFEST',
          },
        },
      },
      transitionReceipt: {
        requestedNodeId: 'ATTIC',
        accepted: true,
        fromNodeId: 'CELLAR',
        toNodeId: 'ATTIC',
        reason: 'TRANSITION_ACCEPTED',
      },
      turnReceipt: {
        turnNumber: 3,
        nodeBefore: 'CELLAR',
        requestedTarget: 'ATTIC',
        accepted: true,
        nodeAfter: 'ATTIC',
        activeVector: 'COSMIC',
        activeTier: 'MANIFEST',
        tension: 40,
        preSnapshot,
      },
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload,
    });

    const receipt = nextState.history[1].turnReceipt;
    expect(receipt?.preSnapshot).toBeDefined();
    expect(receipt?.preSnapshot?.turnCount).toBe(2);
    expect(receipt?.preSnapshot?.currentNodeId).toBe('CELLAR');
    expect(receipt?.preSnapshot?.activeVector).toBe('SOMATIC');
    expect(receipt?.preSnapshot?.activeTier).toBe('GATEWAY');
    expect(receipt?.preSnapshot?.tension).toBe(15);

    expect(receipt?.postSnapshot).toBeDefined();
    expect(receipt?.postSnapshot?.turnCount).toBe(3);
    expect(receipt?.postSnapshot?.currentNodeId).toBe('ATTIC');
    expect(receipt?.postSnapshot?.activeVector).toBe('COSMIC');
    expect(receipt?.postSnapshot?.activeTier).toBe('MANIFEST');
    expect(receipt?.postSnapshot?.tension).toBe(40);
  });

  it('increments reconciliationRevision exactly once when narrativeReconciliationReceipt has EXPERIENTIAL_REANCHORED and commits turn', () => {
    const startState = {
      ...initialEngineState,
      turnCount: 4,
      reconciliationRevision: 2,
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    const reconciliationReceipt: NarrativeReconciliationReceipt = {
      version: 1,
      mode: 'EXPERIENTIAL_REANCHORED',
      feasibility: 'IMPOSSIBLE',
      reason_code: 'UNSUPPORTED_PREMISE',
      fictional_time_cost: 'MOMENT',
      authority_alignment: 'NOT_APPLICABLE',
      memory_echo_candidate: null,
      revision_increment: 1,
    };

    const payload: CommittedTurnPayload = {
      commandText: 'Take the non-existent pistol',
      formattedText: 'You reach out, but your hand grasps empty air.',
      preSnapshot,
      frame: {
        engine_thoughts: 'Experientially reanchored.',
        narrative_blocks: [
          { type: 'prose', content: 'You reach out, but your hand grasps empty air.' },
        ],
        logic_state: {
          suggested_tension: 25,
        },
        narrativeReconciliationReceipt: reconciliationReceipt,
      },
      turnReceipt: {
        turnNumber: 5,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'ORIGIN',
        accepted: true,
        nodeAfter: 'ORIGIN',
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        tension: 25,
        preSnapshot,
        narrativeReconciliationReceipt: reconciliationReceipt,
      },
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload,
    });

    expect(nextState.reconciliationRevision).toBe(3);
    expect(nextState.turnCount).toBe(5);
    expect(nextState.storyLog).toHaveLength(1);
    expect(nextState.storyLog?.[0].content).toContain('grasps empty air');
  });

  it('does not increment reconciliationRevision for CANONICAL, MIXED, or NOT_REQUIRED receipts', () => {
    const modes: Array<'CANONICAL' | 'MIXED' | 'NOT_REQUIRED'> = [
      'CANONICAL',
      'MIXED',
      'NOT_REQUIRED',
    ];

    for (const mode of modes) {
      const startState = {
        ...initialEngineState,
        turnCount: 2,
        reconciliationRevision: 5,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);

      const reconciliationReceipt: NarrativeReconciliationReceipt = {
        version: 1,
        mode,
        feasibility: mode === 'CANONICAL' ? 'SUPPORTED' : 'CONSTRAINED',
        reason_code: 'NONE',
        fictional_time_cost: 'MOMENT',
        authority_alignment: 'NOT_APPLICABLE',
        memory_echo_candidate: null,
        revision_increment: 0,
      };

      const payload: CommittedTurnPayload = {
        commandText: 'Examine surroundings',
        formattedText: 'You look around.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'You look around.' }],
          logic_state: { suggested_tension: 20 },
          narrativeReconciliationReceipt: reconciliationReceipt,
        },
        turnReceipt: {
          turnNumber: 3,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 20,
          preSnapshot,
          narrativeReconciliationReceipt: reconciliationReceipt,
        },
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      expect(nextState.reconciliationRevision).toBe(5);
      expect(nextState.turnCount).toBe(3);
    }
  });

  it('preserves legacy reconciliation increment fallback when receipts are absent', () => {
    const startState = {
      ...initialEngineState,
      turnCount: 4,
      reconciliationRevision: 2,
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    const payload: CommittedTurnPayload = {
      commandText: 'Old legacy action',
      formattedText: 'Old legacy response.',
      preSnapshot,
      frame: {
        narrative_blocks: [
          { type: 'system_voice', content: 'Legacy collision' },
        ],
        logic_state: {
          intent_classification: 'HALLUCINATION_COLLISION',
        },
      },
      turnReceipt: {
        turnNumber: 5,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'ORIGIN',
        accepted: true,
        nodeAfter: 'ORIGIN',
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        tension: 25,
        preSnapshot,
      },
    };

    const nextState = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload,
    });

    expect(nextState.reconciliationRevision).toBe(3);
  });

  it('preserves the submitted preSnapshot object by reference identity in receipt', () => {
    const submittedSnapshot = {
      version: 1 as const,
      turnCount: 10,
      currentNodeId: 'VAULT_7',
      activeVector: 'SOMATIC' as const,
      activeTier: 'TERMINAL' as const,
      phase: 'TERMINAL',
      tension: 95,
      coherence: 0.2,
      reconciliationRevision: 3,
      activeFlags: ['FLAG_ALPHA'],
    };

    const payload: CommittedTurnPayload = {
      commandText: 'Breathe',
      formattedText: 'The air burns.',
      preSnapshot: submittedSnapshot,
      frame: {
        narrative_blocks: [{ type: 'prose', content: 'The air burns.' }],
        logic_state: {
          current_phase: 'TERMINAL',
          suggested_tension: 95,
        },
      },
      turnReceipt: {
        turnNumber: 11,
        nodeBefore: 'VAULT_7',
        requestedTarget: 'VAULT_7',
        accepted: true,
        nodeAfter: 'VAULT_7',
        activeVector: 'SOMATIC',
        activeTier: 'TERMINAL',
        tension: 95,
        preSnapshot: submittedSnapshot,
      },
    };

    const nextState = engineReducer(initialEngineState, {
      type: 'TURN_COMMITTED',
      payload,
    });

    // The receipt on the history message strictly preserves the exact reference to submittedSnapshot
    expect(nextState.history[1].turnReceipt?.preSnapshot).toBe(submittedSnapshot);
  });

  it('leaves currentNodeId unchanged when transitionReceipt is rejected or absent despite turnReceipt.nodeAfter naming an existing node', () => {
    const startState = {
      ...initialEngineState,
      currentNodeId: 'ORIGIN',
      spatialGraph: [
        { id: 'ORIGIN', name: 'Origin', description: '', exits: [] },
        { id: 'EXISTING_TARGET', name: 'Existing Target', description: '', exits: [] },
      ],
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    // 1. Rejected transition receipt
    const rejectedPayload: CommittedTurnPayload = {
      commandText: 'Walk through wall to Existing Target',
      formattedText: 'The wall is solid stone.',
      preSnapshot,
      frame: {
        narrative_blocks: [{ type: 'prose', content: 'The wall is solid stone.' }],
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 20,
        },
      },
      transitionReceipt: {
        requestedNodeId: 'EXISTING_TARGET',
        accepted: false,
        fromNodeId: 'ORIGIN',
        toNodeId: 'ORIGIN',
        reason: 'TRANSITION_REJECTED',
      },
      turnReceipt: {
        turnNumber: 1,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'EXISTING_TARGET',
        accepted: false,
        nodeAfter: 'EXISTING_TARGET', // Telemetry rogue value
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        tension: 20,
        preSnapshot,
      },
    };

    const stateAfterRejected = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload: rejectedPayload,
    });

    expect(stateAfterRejected.currentNodeId).toBe('ORIGIN'); // Did NOT move to EXISTING_TARGET!

    // 2. Absent transition receipt
    const absentReceiptPayload: CommittedTurnPayload = {
      commandText: 'Teleport to Existing Target',
      formattedText: 'You remain in place.',
      preSnapshot,
      frame: {
        narrative_blocks: [{ type: 'prose', content: 'You remain in place.' }],
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 20,
        },
      },
      turnReceipt: {
        turnNumber: 1,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'EXISTING_TARGET',
        accepted: false,
        nodeAfter: 'EXISTING_TARGET', // Telemetry rogue value
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        tension: 20,
        preSnapshot,
      },
    };

    const stateAfterAbsent = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload: absentReceiptPayload,
    });

    expect(stateAfterAbsent.currentNodeId).toBe('ORIGIN'); // Still in ORIGIN
  });

  it('leaves currentNodeId unchanged when transitionReceipt is accepted but fromNodeId is stale', () => {
    const startState = {
      ...initialEngineState,
      currentNodeId: 'ORIGIN',
      spatialGraph: [
        { id: 'ORIGIN', name: 'Origin', description: '', exits: [] },
        { id: 'EXISTING_TARGET', name: 'Existing Target', description: '', exits: [] },
        { id: 'STALE_ORIGIN', name: 'Stale Origin', description: '', exits: [] },
      ],
    };

    const preSnapshot = captureRuntimeSnapshot(startState);

    // fromNodeId is STALE_ORIGIN instead of ORIGIN
    const stalePayload: CommittedTurnPayload = {
      commandText: 'Move forward',
      formattedText: 'Movement anomaly.',
      preSnapshot,
      frame: {
        narrative_blocks: [{ type: 'prose', content: 'Movement anomaly.' }],
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 20,
        },
      },
      transitionReceipt: {
        requestedNodeId: 'EXISTING_TARGET',
        accepted: true,
        fromNodeId: 'STALE_ORIGIN', // Mismatch with reducer's state.currentNodeId ('ORIGIN')
        toNodeId: 'EXISTING_TARGET',
        reason: 'TRANSITION_ACCEPTED',
      },
      turnReceipt: {
        turnNumber: 1,
        nodeBefore: 'ORIGIN',
        requestedTarget: 'EXISTING_TARGET',
        accepted: true,
        nodeAfter: 'EXISTING_TARGET',
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        tension: 20,
        preSnapshot,
      },
    };

    const stateAfterStale = engineReducer(startState, {
      type: 'TURN_COMMITTED',
      payload: stalePayload,
    });

    expect(stateAfterStale.currentNodeId).toBe('ORIGIN'); // Kept current node due to stale fromNodeId
  });

  describe('Phase 3G.5: Single-turn bounded checkpointing & TURN_RETAKEN', () => {
    it('records a valid lastTurnCheckpoint holding pre-turn state, commandText, and engineGameStateBefore on TURN_COMMITTED', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 2,
        currentNodeId: 'ORIGIN',
        activeVector: 'COGNITIVE' as const,
        activeTier: 'LATENT' as const,
        tensionLevel: 10,
        reconciliationRevision: 1,
        activeMemory: {
          systemFlags: ['FLAG_A'],
          somaState: [],
          geomState: [],
        },
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const prevGameState: LogicState = {
        current_location: 'Origin Chamber',
        player_injuries: [],
        inventory: [],
        psychological_status: 'Stable',
        player_role: 'witness',
        player_character_id: null,
        perspective_mode: 'witness',
        current_tension_level: 'buildup',
        lore_and_memory: {
          established_facts: [],
          permanent_consequences: [],
        },
        npc_fixations: [],
      };

      const payload: CommittedTurnPayload = {
        commandText: 'Examine the anomaly',
        formattedText: 'The anomaly hums with dark frequency.',
        preSnapshot,
        engineGameStateBefore: prevGameState,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'The anomaly hums.' }],
          logic_state: {
            current_phase: 'MANIFEST',
            suggested_tension: 30,
            terminal_flags: ['FLAG_B'],
          },
        },
        turnReceipt: {
          turnNumber: 3,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 30,
          preSnapshot,
        },
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      expect(nextState.turnCount).toBe(3);
      expect(nextState.tensionLevel).toBe(30);
      expect(nextState.lastTurnCheckpoint).toBeDefined();
      expect(nextState.lastTurnCheckpoint?.version).toBe(1);
      expect(nextState.lastTurnCheckpoint?.commandText).toBe('Examine the anomaly');
      expect(nextState.lastTurnCheckpoint?.engineGameStateBefore).toEqual(prevGameState);
      expect(nextState.lastTurnCheckpoint?.engineStateBefore.turnCount).toBe(2);
      expect(nextState.lastTurnCheckpoint?.engineStateBefore.tensionLevel).toBe(10);
      expect(nextState.lastTurnCheckpoint?.engineStateBefore.activeMemory.systemFlags).toEqual(['FLAG_A']);
    });

    it('unconditionally captures valid lastTurnCheckpoint on every TURN_COMMITTED including terminal turns', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 2,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const payload: CommittedTurnPayload = {
        commandText: 'Commit irreversible terminal action',
        formattedText: 'The gateway seals permanently.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'The gateway seals permanently.' }],
          logic_state: { suggested_tension: 50, terminal_flags: ['TERMINAL_CONVERGED'] },
        },
        turnReceipt: {
          turnNumber: 3,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 50,
          preSnapshot,
        },
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      expect(nextState.lastTurnCheckpoint).not.toBeNull();
      expect(nextState.lastTurnCheckpoint?.commandText).toBe('Commit irreversible terminal action');
      expect(nextState.lastTurnCheckpoint?.engineStateBefore.turnCount).toBe(2);
    });

    it('preserves existing lastTurnCheckpoint on TURN_FAILED without replacing it with failed attempt', () => {
      const priorCheckpoint = {
        version: 1 as const,
        commandText: 'Examine vault door',
        engineStateBefore: { ...initialEngineState, turnCount: 3, currentNodeId: 'CORRIDOR' },
        engineGameStateBefore: null,
      };

      const startState = {
        ...initialEngineState,
        turnCount: 4,
        currentNodeId: 'VAULT',
        tensionLevel: 25,
        lastTurnCheckpoint: priorCheckpoint,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const prevGameState: LogicState = {
        current_location: 'Vault',
        player_injuries: [],
        inventory: [],
        psychological_status: 'Tense',
        player_role: 'witness',
        player_character_id: null,
        perspective_mode: 'witness',
        current_tension_level: 'peak',
        lore_and_memory: {
          established_facts: [],
          permanent_consequences: [],
        },
        npc_fixations: [],
      };

      const payload: FailedTurnPayload = {
        commandText: 'Force door open',
        errorCategory: 'NETWORK_TIMEOUT',
        errorMessage: 'The connection timed out.',
        preSnapshot,
        engineGameStateBefore: prevGameState,
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_FAILED',
        payload,
      });

      expect(nextState.lastTurnCheckpoint).toBe(priorCheckpoint);
      expect(nextState.lastTurnCheckpoint?.commandText).toBe('Examine vault door');
      expect(nextState.lastTurnCheckpoint?.engineStateBefore.turnCount).toBe(3);
      expect(nextState.lastTurnCheckpoint?.engineStateBefore.currentNodeId).toBe('CORRIDOR');
    });

    it('restores exact pre-turn state and clears checkpoint on TURN_RETAKEN', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 2,
        currentNodeId: 'ORIGIN',
        activeVector: 'SOMATIC' as const,
        activeTier: 'GATEWAY' as const,
        tensionLevel: 15,
        reconciliationRevision: 2,
        activeMemory: {
          systemFlags: ['FLAG_INITIAL'],
          somaState: [],
          geomState: [],
        },
        history: [
          { id: '1', role: 'user' as const, content: 'Initial prompt', timestamp: 1000 },
          { id: '2', role: 'assistant' as const, content: 'Initial narrative', timestamp: 1001 },
        ],
      };

      const preSnapshot = captureRuntimeSnapshot(startState);

      // Execute a turn that advances state
      const committedPayload: CommittedTurnPayload = {
        commandText: 'Step into the abyss',
        formattedText: 'You fall into darkness.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'You fall into darkness.' }],
          logic_state: {
            current_phase: 'MANIFEST',
            suggested_tension: 65,
            terminal_flags: ['FLAG_FALLEN'],
            matrix_mutation: {
              next_vector: 'COSMIC',
              next_tier: 'MANIFEST',
            },
          },
        },
        turnReceipt: {
          turnNumber: 3,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COSMIC',
          activeTier: 'MANIFEST',
          tension: 65,
          preSnapshot,
        },
      };

      const stateAfterTurn = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload: committedPayload,
      });

      expect(stateAfterTurn.turnCount).toBe(3);
      expect(stateAfterTurn.activeVector).toBe('COSMIC');
      expect(stateAfterTurn.activeTier).toBe('MANIFEST');
      expect(stateAfterTurn.tensionLevel).toBe(65);
      expect(stateAfterTurn.activeMemory.systemFlags).toContain('FLAG_FALLEN');
      expect(stateAfterTurn.history.length).toBe(4);
      expect(stateAfterTurn.lastTurnCheckpoint).not.toBeNull();

      // Now retake the turn
      const stateAfterRetake = engineReducer(stateAfterTurn, {
        type: 'TURN_RETAKEN',
      });

      expect(stateAfterRetake.turnCount).toBe(2);
      expect(stateAfterRetake.currentNodeId).toBe('ORIGIN');
      expect(stateAfterRetake.activeVector).toBe('SOMATIC');
      expect(stateAfterRetake.activeTier).toBe('GATEWAY');
      expect(stateAfterRetake.tensionLevel).toBe(15);
      expect(stateAfterRetake.reconciliationRevision).toBe(2);
      expect(stateAfterRetake.activeMemory.systemFlags).toEqual(['FLAG_INITIAL']);
      expect(stateAfterRetake.history.length).toBe(2);
      expect(stateAfterRetake.history[0].content).toBe('Initial prompt');
      expect(stateAfterRetake.history[1].content).toBe('Initial narrative');
      expect(stateAfterRetake.lastTurnCheckpoint).toBeNull();
    });

    it('restores restraintLedger, worldObjectLedger, attentionLedger, and routineLedger on TURN_RETAKEN', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 1,
        currentNodeId: 'ORIGIN',
        restraintLedger: {
          bindings: {
            'char-1': { characterId: 'char-1', level: 'UNRESTRAINED' as const },
          },
          locks: {},
        },
        worldObjectLedger: {
          'key-1': {
            objectId: 'key-1',
            name: 'Brass Key',
            location: { kind: 'NODE' as const, id: 'ORIGIN' },
            affordances: [],
            sizeClass: 'LIGHT' as const,
            effects: [],
          },
        },
        attentionLedger: {
          'villain-1': {
            characterId: 'villain-1',
            attendingTo: null,
            lapse: null,
            distractibility: 0.5,
          },
        },
        routineLedger: {
          'rout-1': {
            routineId: 'rout-1',
            characterId: 'villain-1',
            cadenceFictionalClock: 'hourly',
            steps: [],
            varianceBand: { minMinutes: 0, maxMinutes: 10 },
            modifiers: [],
            lastFiredFictionalTime: 0,
          },
        },
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const committedPayload: CommittedTurnPayload = {
        commandText: 'Take the key',
        formattedText: 'You take the key.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'You take the key.' }],
          logic_state: {
            current_phase: 'MANIFEST',
          },
        },
        turnReceipt: {
          turnNumber: 2,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 10,
          preSnapshot,
        },
      };

      const stateAfterTurn = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload: committedPayload,
      });

      // Mutate ledgers post-turn
      stateAfterTurn.restraintLedger = {
        bindings: {
          'char-1': { characterId: 'char-1', level: 'FULL_HOGTIE' as const },
        },
        locks: {},
      };
      stateAfterTurn.worldObjectLedger = {};
      stateAfterTurn.attentionLedger = {};
      stateAfterTurn.routineLedger = {};

      const stateAfterRetake = engineReducer(stateAfterTurn, {
        type: 'TURN_RETAKEN',
      });

      expect(stateAfterRetake.restraintLedger?.bindings['char-1']?.level).toBe('UNRESTRAINED');
      expect(stateAfterRetake.worldObjectLedger?.['key-1']?.name).toBe('Brass Key');
      expect(stateAfterRetake.attentionLedger?.['villain-1']?.characterId).toBe('villain-1');
      expect(stateAfterRetake.routineLedger?.['rout-1']?.routineId).toBe('rout-1');
    });

    it('applies object transitions and UNLOCK in TURN_COMMITTED and retake restores prior object location and lock flags', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 1,
        currentNodeId: 'ORIGIN',
        selectedCharacterId: 'player-1',
        cast: [{ id: 'player-1', isUserCharacter: true }],
        restraintLedger: {
          bindings: {},
          locks: {
            'CONTAINER:box-1': {
              targetRef: { kind: 'CONTAINER' as const, id: 'box-1' },
              locked: true,
              keyObjectId: 'key-1',
            },
          },
        },
        worldObjectLedger: {
          'key-1': {
            objectId: 'key-1',
            name: 'Brass Key',
            location: { kind: 'NODE' as const, id: 'ORIGIN' },
            affordances: [],
            sizeClass: 'LIGHT' as const,
            effects: [],
          },
          'box-1': {
            objectId: 'box-1',
            name: 'Iron Box',
            location: { kind: 'NODE' as const, id: 'ORIGIN' },
            containerState: 'CLOSED' as const,
            affordances: [],
            sizeClass: 'STANDARD' as const,
            effects: [],
          },
        },
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const committedPayload: CommittedTurnPayload = {
        commandText: 'Take key and unlock box',
        formattedText: 'You take the key and unlock the box.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'You take the key and unlock the box.' }],
          logic_state: { current_phase: 'MANIFEST' },
          objectTransitions: [
            { objectId: 'key-1', transition: 'PICKUP' as const },
            { objectId: 'box-1', transition: 'UNLOCK' as const },
          ],
        },
        turnReceipt: {
          turnNumber: 2,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 10,
          preSnapshot,
        },
      };

      const stateAfterTurn = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload: committedPayload,
      });

      // 1. Verify transitions applied: key is now carried, box lock is now false
      expect(stateAfterTurn.worldObjectLedger?.['key-1']?.location).toEqual({
        kind: 'CARRIER',
        id: 'player-1',
      });
      expect(stateAfterTurn.restraintLedger?.locks['CONTAINER:box-1']?.locked).toBe(false);

      // 2. Verify receipt attached
      const lastMsg = stateAfterTurn.history[stateAfterTurn.history.length - 1];
      expect(lastMsg.turnReceipt?.objectTransitionReceipt).toHaveLength(2);
      expect(lastMsg.turnReceipt?.objectTransitionReceipt?.[0].accepted).toBe(true);
      expect(lastMsg.turnReceipt?.objectTransitionReceipt?.[0].reasonCode).toBe('ALLOWED');
      expect(lastMsg.turnReceipt?.objectTransitionReceipt?.[1].accepted).toBe(true);
      expect(lastMsg.turnReceipt?.objectTransitionReceipt?.[1].reasonCode).toBe('ALLOWED');

      // 3. Verify retake restores prior location and lock flags
      const stateAfterRetake = engineReducer(stateAfterTurn, {
        type: 'TURN_RETAKEN',
      });

      expect(stateAfterRetake.worldObjectLedger?.['key-1']?.location).toEqual({
        kind: 'NODE',
        id: 'ORIGIN',
      });
      expect(stateAfterRetake.restraintLedger?.locks['CONTAINER:box-1']?.locked).toBe(true);
    });

    it('ensures no objectTransitionReceipt field is emitted when no proposals are present (byte-identical receipts invariant)', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 1,
        currentNodeId: 'ORIGIN',
        worldObjectLedger: {
          'key-1': {
            objectId: 'key-1',
            name: 'Brass Key',
            location: { kind: 'NODE' as const, id: 'ORIGIN' },
            affordances: [],
            sizeClass: 'LIGHT' as const,
            effects: [],
          },
        },
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const committedPayload: CommittedTurnPayload = {
        commandText: 'Wait',
        formattedText: 'You wait.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'You wait.' }],
          logic_state: { current_phase: 'MANIFEST' },
        },
        turnReceipt: {
          turnNumber: 2,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 10,
          preSnapshot,
        },
      };

      const stateAfterTurn = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload: committedPayload,
      });

      const lastMsg = stateAfterTurn.history[stateAfterTurn.history.length - 1];
      expect(lastMsg.turnReceipt?.objectTransitionReceipt).toBeUndefined();
      expect('objectTransitionReceipt' in (lastMsg.turnReceipt || {})).toBe(false);
      expect(lastMsg.turnReceipt?.attentionTransitionReceipt).toBeUndefined();
      expect('attentionTransitionReceipt' in (lastMsg.turnReceipt || {})).toBe(false);
    });

    it('commits accepted attention transitions in TURN_COMMITTED and attaches attentionTransitionReceipt, and restores on retake', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 1,
        currentNodeId: 'ORIGIN',
        castPlacement: {
          'player-1': 'ORIGIN',
          'guard-1': 'ORIGIN',
        },
        cast: [
          { id: 'player-1', isUserCharacter: true, disposition: 'SURVIVOR' },
          { id: 'guard-1', isUserCharacter: false, disposition: 'HOSTILE' },
        ],
        worldObjectLedger: {
          'key-1': {
            objectId: 'key-1',
            name: 'Brass Key',
            location: { kind: 'NODE' as const, id: 'ORIGIN' },
            affordances: [],
            sizeClass: 'LIGHT' as const,
            effects: [],
          },
        },
        attentionLedger: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: null,
            distractibility: 0.5,
          },
        },
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const committedPayload: CommittedTurnPayload = {
        commandText: 'Distract guard and draw his gaze',
        formattedText: 'The guard turns toward the key.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'The guard turns toward the key.' }],
          logic_state: { current_phase: 'MANIFEST' },
          attentionTransitions: [
            {
              characterId: 'guard-1',
              transition: 'CAPTURE' as const,
              target: { kind: 'OBJECT' as const, id: 'key-1' },
            },
          ],
        },
        turnReceipt: {
          turnNumber: 2,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 10,
          preSnapshot,
        },
      };

      const stateAfterTurn = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload: committedPayload,
      });

      // 1. Verify attention transition applied: guard-1 is attending to key-1
      expect(stateAfterTurn.attentionLedger?.['guard-1']?.attendingTo).toEqual({
        kind: 'OBJECT',
        id: 'key-1',
      });

      // 2. Verify attentionTransitionReceipt attached
      const lastMsg = stateAfterTurn.history[stateAfterTurn.history.length - 1];
      expect(lastMsg.turnReceipt?.attentionTransitionReceipt).toHaveLength(1);
      expect(lastMsg.turnReceipt?.attentionTransitionReceipt?.[0].accepted).toBe(true);
      expect(lastMsg.turnReceipt?.attentionTransitionReceipt?.[0].reasonCode).toBe('ALLOWED');

      // 3. Verify retake restores prior attention ledger
      const stateAfterRetake = engineReducer(stateAfterTurn, {
        type: 'TURN_RETAKEN',
      });

      expect(stateAfterRetake.attentionLedger?.['guard-1']?.attendingTo).toBeNull();
    });

    it('ensures no attentionTransitionReceipt field is emitted when no proposals are present (byte-identical receipts invariant)', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 1,
        currentNodeId: 'ORIGIN',
        attentionLedger: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: null,
            distractibility: 0.5,
          },
        },
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const committedPayload: CommittedTurnPayload = {
        commandText: 'Wait',
        formattedText: 'You wait.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'You wait.' }],
          logic_state: { current_phase: 'MANIFEST' },
        },
        turnReceipt: {
          turnNumber: 2,
          nodeBefore: 'ORIGIN',
          requestedTarget: 'ORIGIN',
          accepted: true,
          nodeAfter: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 10,
          preSnapshot,
        },
      };

      const stateAfterTurn = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload: committedPayload,
      });

      const lastMsg = stateAfterTurn.history[stateAfterTurn.history.length - 1];
      expect(lastMsg.turnReceipt?.attentionTransitionReceipt).toBeUndefined();
      expect('attentionTransitionReceipt' in (lastMsg.turnReceipt || {})).toBe(false);
    });

    it('handles PROCESS_ATTENTION_TRANSITIONS direct dispatch', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 1,
        currentNodeId: 'ORIGIN',
        castPlacement: {
          'player-1': 'ORIGIN',
          'guard-1': 'ORIGIN',
        },
        cast: [
          { id: 'player-1', isUserCharacter: true, disposition: 'SURVIVOR' },
          { id: 'guard-1', isUserCharacter: false, disposition: 'HOSTILE' },
        ],
        attentionLedger: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: null,
            distractibility: 0.5,
          },
        },
      };

      const updated = engineReducer(startState, {
        type: 'PROCESS_ATTENTION_TRANSITIONS',
        characterId: 'guard-1',
        proposals: [
          {
            characterId: 'guard-1',
            transition: 'DISTRACT',
            durationMinutes: 5,
          },
        ],
      });

      expect(updated.attentionLedger?.['guard-1']?.lapse?.active).toBe(true);
      expect(updated.attentionLedger?.['guard-1']?.lapse?.expiresAtFictionalTime).toBe(60 + 5 * 60);
    });

    it('returns state unchanged when TURN_RETAKEN is dispatched without a checkpoint', () => {
      const stateWithoutCheckpoint = {
        ...initialEngineState,
        turnCount: 5,
        lastTurnCheckpoint: null,
      };

      const resultState = engineReducer(stateWithoutCheckpoint, {
        type: 'TURN_RETAKEN',
      });

      expect(resultState).toBe(stateWithoutCheckpoint);
      expect(resultState.turnCount).toBe(5);
    });

    it('bounds checkpoints to exactly 1 level across successive turns', () => {
      let state = {
        ...initialEngineState,
        turnCount: 0,
      };

      // Turn 1
      const preSnapshot1 = captureRuntimeSnapshot(state);
      state = engineReducer(state, {
        type: 'TURN_COMMITTED',
        payload: {
          commandText: 'Turn 1 command',
          formattedText: 'Turn 1 result',
          preSnapshot: preSnapshot1,
          frame: {
            narrative_blocks: [{ type: 'prose', content: 'Turn 1 result' }],
            logic_state: { suggested_tension: 10 },
          },
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'ORIGIN',
            requestedTarget: 'ORIGIN',
            accepted: true,
            nodeAfter: 'ORIGIN',
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
            tension: 10,
            preSnapshot: preSnapshot1,
          },
        },
      });

      expect(state.turnCount).toBe(1);
      expect(state.lastTurnCheckpoint?.commandText).toBe('Turn 1 command');
      expect(state.lastTurnCheckpoint?.engineStateBefore.turnCount).toBe(0);

      // Turn 2
      const preSnapshot2 = captureRuntimeSnapshot(state);
      state = engineReducer(state, {
        type: 'TURN_COMMITTED',
        payload: {
          commandText: 'Turn 2 command',
          formattedText: 'Turn 2 result',
          preSnapshot: preSnapshot2,
          frame: {
            narrative_blocks: [{ type: 'prose', content: 'Turn 2 result' }],
            logic_state: { suggested_tension: 20 },
          },
          turnReceipt: {
            turnNumber: 2,
            nodeBefore: 'ORIGIN',
            requestedTarget: 'ORIGIN',
            accepted: true,
            nodeAfter: 'ORIGIN',
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
            tension: 20,
            preSnapshot: preSnapshot2,
          },
        },
      });

      expect(state.turnCount).toBe(2);
      // Checkpoint holds Turn 2's pre-turn state (Turn 1 state), not Turn 0
      expect(state.lastTurnCheckpoint?.commandText).toBe('Turn 2 command');
      expect(state.lastTurnCheckpoint?.engineStateBefore.turnCount).toBe(1);

      // Retake restores Turn 1
      state = engineReducer(state, { type: 'TURN_RETAKEN' });
      expect(state.turnCount).toBe(1);
      expect(state.lastTurnCheckpoint).toBeNull();
    });

    it('preserves canonicalConsequenceReceipt in turnReceipt on committed history message', () => {
      const state = { ...initialEngineState };
      const preSnapshot = captureRuntimeSnapshot(state);

      const consequenceReceipt: CanonicalConsequenceReceipt = {
        version: 1,
        pre_state: {
          inventory: [],
          player_injuries: [],
          psychological_status: 'STABLE',
        },
        decisions: [
          {
            mutation: {
              domain: 'INVENTORY' as const,
              operation: 'ADD' as const,
              value: 'Rusty Screwdriver',
              rationale: 'Found in tool rack',
            },
            outcome: 'APPLIED' as const,
            reason: 'APPLIED' as const,
          },
        ],
        patch: {
          inventory_added: ['Rusty Screwdriver'],
          inventory_removed: [],
          injuries_added: [],
          injuries_removed: [],
          psychological_status_change: null,
        },
        post_state: {
          inventory: ['Rusty Screwdriver'],
          player_injuries: [],
          psychological_status: 'STABLE',
        },
      };

      const nextState = engineReducer(state, {
        type: 'TURN_COMMITTED',
        payload: {
          commandText: 'Take screwdriver',
          formattedText: 'You grab the rusty screwdriver.',
          preSnapshot,
          frame: {
            narrative_blocks: [{ type: 'prose', content: 'You grab the rusty screwdriver.' }],
            logic_state: { suggested_tension: 10 },
          },
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'WORKSHOP',
            requestedTarget: 'WORKSHOP',
            accepted: true,
            nodeAfter: 'WORKSHOP',
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
            tension: 10,
            preSnapshot,
            canonicalConsequenceReceipt: consequenceReceipt,
          },
        },
      });

      expect(nextState.history.length).toBe(2);
      const assistantMsg = nextState.history[1];
      expect(assistantMsg.turnReceipt?.canonicalConsequenceReceipt).toBeDefined();
      expect(assistantMsg.turnReceipt?.canonicalConsequenceReceipt?.post_state.inventory).toEqual([
        'Rusty Screwdriver',
      ]);
    });

    it('preserves existing lastTurnCheckpoint on TURN_FAILED so failed turn does not destroy retake', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 1,
        currentNodeId: 'PARLOR',
        lastTurnCheckpoint: {
          version: 1 as const,
          commandText: 'Examine bookcase',
          engineStateBefore: { ...initialEngineState, currentNodeId: 'FOYER' },
          engineGameStateBefore: null,
        },
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const failedPayload: FailedTurnPayload = {
        commandText: 'Try impossible action',
        errorCategory: 'PROVIDER_FAILURE',
        errorMessage: 'The AI provider turn generation failed.',
        statusCode: 502,
        preSnapshot,
      };

      const afterFailed = engineReducer(startState, {
        type: 'TURN_FAILED',
        payload: failedPayload,
      });

      // Checkpoint must be preserved unchanged (both reference and content)
      expect(afterFailed.lastTurnCheckpoint).toBe(startState.lastTurnCheckpoint);
      expect(afterFailed.lastTurnCheckpoint?.commandText).toBe('Examine bookcase');
      expect(afterFailed.lastTurnCheckpoint?.engineStateBefore.currentNodeId).toBe('FOYER');

      // Repeated failure must still preserve the same checkpoint
      const secondFailed = engineReducer(afterFailed, {
        type: 'TURN_FAILED',
        payload: {
          ...failedPayload,
          commandText: 'Another failing action',
        },
      });

      expect(secondFailed.lastTurnCheckpoint).toBe(startState.lastTurnCheckpoint);
      expect(secondFailed.lastTurnCheckpoint?.commandText).toBe('Examine bookcase');
    });

    it('safely normalizes raw malicious failure receipt in failTurnResult store entrypoint and purges sentinels across history, UI, telemetry, raw exports, Markdown, HTML, and prompt context', () => {
      useAppStore.getState().resetSession();

      const RAW_HTML_SENTINEL = '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1><script>stealSecrets()</script></body></html>';
      const INTERNAL_SECRET_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5:generateContent?key=AIzaSyD_LEAKED_KEY';
      const INTERNAL_STACK_TRACE = 'Error: PG connection failed at /app/server/db.ts:12:3';

      useAppStore.setState({
        sessionId: 'session-fail-proof-1',
        blueprintId: 'bp-fail-proof-1',
        turnCount: 2,
        currentNodeId: 'REACTOR_CORE',
        telemetry: {
          tension: '50',
          pacing: 'STEADY',
          castLedger: [],
          engineLogic: 'Normal operation',
        },
      });

      const preSnapshot = captureRuntimeSnapshot(useAppStore.getState());

      // Raw, un-sanitized failure receipt with malicious sentinels
      const rawUnsafePayload: FailedTurnPayload = {
        commandText: 'Examine primary containment core',
        failureReceipt: {
          code: 'MODEL_CONTRACT_MISMATCH' as any,
          status: 502,
          contentType: 'text/html; charset=utf-8',
          message: `${RAW_HTML_SENTINEL} ${INTERNAL_SECRET_URL} ${INTERNAL_STACK_TRACE}`,
        } as any,
        errorCategory: 'MODEL_CONTRACT_MISMATCH',
        errorMessage: `${RAW_HTML_SENTINEL} ${INTERNAL_SECRET_URL} ${INTERNAL_STACK_TRACE}`,
        statusCode: 502,
        contentType: 'text/html; charset=utf-8',
        preSnapshot,
      };

      // Call the store action entrypoint
      useAppStore.getState().failTurnResult(rawUnsafePayload);

      const stateAfterFail = useAppStore.getState();

      // 1. History: State contains normalized failure message without raw sentinels
      expect(stateAfterFail.history).toHaveLength(2);
      const userMsg = stateAfterFail.history[0];
      const assistantMsg = stateAfterFail.history[1];
      expect(userMsg.content).toBe('Examine primary containment core');
      expect(assistantMsg.content).not.toContain(RAW_HTML_SENTINEL);
      expect(assistantMsg.content).not.toContain('stealSecrets');
      expect(assistantMsg.content).not.toContain(INTERNAL_SECRET_URL);
      expect(assistantMsg.content).not.toContain(INTERNAL_STACK_TRACE);
      expect(assistantMsg.content).toContain('The turn service returned an invalid response structure.');

      // 2. UI Text
      const uiText = assistantMsg.content || '';
      expect(uiText).not.toContain('<!DOCTYPE');
      expect(uiText).not.toContain('AIzaSyD');

      // 3. Telemetry
      const telState = JSON.stringify(stateAfterFail.telemetry);
      expect(telState).not.toContain(RAW_HTML_SENTINEL);
      expect(telState).not.toContain(INTERNAL_SECRET_URL);
      expect(telState).not.toContain(INTERNAL_STACK_TRACE);

      // 4. Raw Export (JSON)
      const rawJsonExport = JSON.stringify(stateAfterFail.history);
      expect(rawJsonExport).not.toContain(RAW_HTML_SENTINEL);
      expect(rawJsonExport).not.toContain('stealSecrets');
      expect(rawJsonExport).not.toContain(INTERNAL_SECRET_URL);
      expect(rawJsonExport).not.toContain(INTERNAL_STACK_TRACE);

      // 5. Markdown Export
      const mdExport = buildEngineLogContent(stateAfterFail.history, 'md')?.content || '';
      expect(mdExport).not.toContain(RAW_HTML_SENTINEL);
      expect(mdExport).not.toContain('stealSecrets');
      expect(mdExport).not.toContain(INTERNAL_SECRET_URL);
      expect(mdExport).not.toContain(INTERNAL_STACK_TRACE);

      // 6. HTML Export
      const htmlExport = buildEngineLogContent(stateAfterFail.history, 'html')?.content || '';
      expect(htmlExport).not.toContain(RAW_HTML_SENTINEL);
      expect(htmlExport).not.toContain('stealSecrets');
      expect(htmlExport).not.toContain(INTERNAL_SECRET_URL);
      expect(htmlExport).not.toContain(INTERNAL_STACK_TRACE);

      // 7. Subsequent Prompt Input
      const mockBlueprint: ScenarioBlueprint = {
        id: 'bp-fail-proof-1',
        title: 'Reactor Station',
        premise: 'Deep core reactor station',
        startingVector: 'COGNITIVE',
        startingTier: 'LATENT',
        contentScale: 1,
        contentLevelDescription: 'Standard',
        narrativeRules: {
          incitingIncident: 'Coolant leak',
          currentTensionLevel: 'CALM',
          keyPlotElements: [],
        },
        setting: { location: 'Reactor Core', atmosphere: 'Humming machinery', timePeriod: 'Future' },
        cast: [
          {
            id: 'char-1',
            name: 'Specialist Ray',
            role: 'protagonist',
            description: 'Core technician',
            isUserCharacter: true,
          },
        ],
        topology: { nodes: ['REACTOR_CORE'], connections: [] },
      };

      const promptContext = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
        runtimeState: {
          currentNodeId: 'REACTOR_CORE',
        },
      });

      const serializedPrompt = JSON.stringify(promptContext);
      expect(serializedPrompt).not.toContain(RAW_HTML_SENTINEL);
      expect(serializedPrompt).not.toContain('stealSecrets');
      expect(serializedPrompt).not.toContain(INTERNAL_SECRET_URL);
      expect(serializedPrompt).not.toContain(INTERNAL_STACK_TRACE);
    });

    it('proves PROVIDER_REFUSAL sanitization across state, history, prompt context, and exports', () => {
      useAppStore.getState().resetSession();

      const REFUSAL_TEXT_SENTINEL = 'SAFETY_POLICY_TRIGGERED: Prohibited somatic violence at byte 881';
      const PROVIDER_METADATA_SENTINEL = 'gemini-2.5-pro::blockReason=SAFETY::candidate=0';
      const ENDPOINT_URL_SENTINEL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaSy_SecretKey99';
      const STACK_SENTINEL = 'at GoogleGenAI.generateContent (C:\\server\\ai\\client.ts:482:11)';
      const CREDENTIAL_SENTINEL = 'AIzaSy_SecretKey99';

      const preSnapshot = {
        version: 1 as const,
        currentNodeId: 'ORIGIN',
        activeVector: 'COGNITIVE' as const,
        activeTier: 'LATENT' as const,
        phase: 'LATENT',
        tension: 10,
        coherence: 1.0,
        reconciliationRevision: 0,
        turnCount: 0,
        activeFlags: [],
      };

      const unsafeRefusalPayload: FailedTurnPayload = {
        commandText: 'Force open the sealed valve with bare hands',
        failureReceipt: {
          code: 'PROVIDER_REFUSAL' as any,
          status: 502,
          contentType: 'application/json',
          message: `${REFUSAL_TEXT_SENTINEL} ${PROVIDER_METADATA_SENTINEL} ${ENDPOINT_URL_SENTINEL} ${STACK_SENTINEL}`,
        } as any,
        errorCategory: 'PROVIDER_REFUSAL',
        errorMessage: `${REFUSAL_TEXT_SENTINEL} ${PROVIDER_METADATA_SENTINEL} ${ENDPOINT_URL_SENTINEL} ${STACK_SENTINEL}`,
        statusCode: 502,
        contentType: 'application/json',
        preSnapshot,
      };

      useAppStore.getState().failTurnResult(unsafeRefusalPayload);

      const state = useAppStore.getState();

      // 1. History retains safe code and safe allowlisted message, zero raw sentinels
      expect(state.history).toHaveLength(2);
      const assistantMsg = state.history[1];
      expect(assistantMsg.content).toContain('The simulation model declined to generate a turn.');
      expect(assistantMsg.content).not.toContain(REFUSAL_TEXT_SENTINEL);
      expect(assistantMsg.content).not.toContain(PROVIDER_METADATA_SENTINEL);
      expect(assistantMsg.content).not.toContain(ENDPOINT_URL_SENTINEL);
      expect(assistantMsg.content).not.toContain(STACK_SENTINEL);
      expect(assistantMsg.content).not.toContain(CREDENTIAL_SENTINEL);

      // 2. Telemetry contains zero raw sentinels
      const telemetryStr = JSON.stringify(state.telemetry);
      expect(telemetryStr).not.toContain(REFUSAL_TEXT_SENTINEL);
      expect(telemetryStr).not.toContain(PROVIDER_METADATA_SENTINEL);
      expect(telemetryStr).not.toContain(ENDPOINT_URL_SENTINEL);
      expect(telemetryStr).not.toContain(STACK_SENTINEL);

      // 3. Raw JSON Export contains zero raw sentinels
      const jsonExport = JSON.stringify(state.history);
      expect(jsonExport).not.toContain(REFUSAL_TEXT_SENTINEL);
      expect(jsonExport).not.toContain(PROVIDER_METADATA_SENTINEL);
      expect(jsonExport).not.toContain(ENDPOINT_URL_SENTINEL);
      expect(jsonExport).not.toContain(CREDENTIAL_SENTINEL);

      // 4. Markdown Export contains zero raw sentinels
      const mdExport = buildEngineLogContent(state.history, 'md')?.content || '';
      expect(mdExport).not.toContain(REFUSAL_TEXT_SENTINEL);
      expect(mdExport).not.toContain(PROVIDER_METADATA_SENTINEL);
      expect(mdExport).not.toContain(ENDPOINT_URL_SENTINEL);
      expect(mdExport).not.toContain(CREDENTIAL_SENTINEL);

      // 5. HTML Export contains zero raw sentinels
      const htmlExport = buildEngineLogContent(state.history, 'html')?.content || '';
      expect(htmlExport).not.toContain(REFUSAL_TEXT_SENTINEL);
      expect(htmlExport).not.toContain(PROVIDER_METADATA_SENTINEL);
      expect(htmlExport).not.toContain(ENDPOINT_URL_SENTINEL);
      expect(htmlExport).not.toContain(CREDENTIAL_SENTINEL);
    });
  });

  describe('Packet 03 - ADD_MESSAGE opening continuity and failure exclusion', () => {
    it('projects accepted opening narrative blocks into storyLog while preserving turn count', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 0,
        history: [],
        storyLog: [],
      };

      const openingMessage: Message = {
        id: 'msg_open_01',
        role: 'assistant',
        content: 'A rusted iron key hangs on the wall.',
        blocks: [
          { type: 'prose', content: 'A rusted iron key hangs on the wall.' },
        ],
        validation: { accepted: true, rejected_fields: [], repair_notes: [] },
        timestamp: Date.now(),
      };

      const nextState = engineReducer(startState, {
        type: 'ADD_MESSAGE',
        message: openingMessage,
      });

      expect(nextState.history).toHaveLength(1);
      expect(nextState.history[0].id).toBe('msg_open_01');
      expect(nextState.storyLog).toHaveLength(1);
      expect(nextState.storyLog?.[0].content).toBe('A rusted iron key hangs on the wall.');
      expect(nextState.turnCount).toBe(0); // Opening narration does NOT advance turn count
    });

    it('prevents duplicate opening entries when identical message or blocks are added', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 0,
        history: [],
        storyLog: [],
      };

      const openingMessage: Message = {
        id: 'msg_open_02',
        role: 'assistant',
        content: 'A silver locket rests in the dust.',
        blocks: [
          { type: 'prose', content: 'A silver locket rests in the dust.' },
        ],
        timestamp: Date.now(),
      };

      const state1 = engineReducer(startState, {
        type: 'ADD_MESSAGE',
        message: openingMessage,
      });
      expect(state1.history).toHaveLength(1);
      expect(state1.storyLog).toHaveLength(1);

      // Re-dispatching the exact same message must be a no-op
      const state2 = engineReducer(state1, {
        type: 'ADD_MESSAGE',
        message: openingMessage,
      });
      expect(state2.history).toHaveLength(1);
      expect(state2.storyLog).toHaveLength(1);

      // Dispatching a different message ID with identical opening content must not duplicate in storyLog or history
      const state3 = engineReducer(state2, {
        type: 'ADD_MESSAGE',
        message: {
          id: 'msg_open_03',
          role: 'assistant',
          content: 'A silver locket rests in the dust.',
          blocks: [{ type: 'prose', content: 'A silver locket rests in the dust.' }],
          timestamp: Date.now(),
        },
      });
      expect(state3.history).toHaveLength(1);
      expect(state3.storyLog).toHaveLength(1);
    });

    it('excludes failure, diagnostic, and rejected candidate messages from storyLog', () => {
      const startState = {
        ...initialEngineState,
        turnCount: 0,
        history: [],
        storyLog: [],
      };

      // 1. Critical engine failure message
      const state1 = engineReducer(startState, {
        type: 'ADD_MESSAGE',
        message: {
          id: 'fail_01',
          role: 'assistant',
          content: '[CRITICAL ENGINE FAILURE]: The house refused to open.',
          timestamp: Date.now(),
        },
      });
      expect(state1.history).toHaveLength(1);
      expect(state1.storyLog).toHaveLength(0); // Excluded from storyLog

      // 2. System neural link severed message
      const state2 = engineReducer(state1, {
        type: 'ADD_MESSAGE',
        message: {
          id: 'sys_01',
          role: 'assistant',
          content: '[ SYSTEM: NEURAL LINK SEVERED DUE TO PROLONGED INACTIVITY. RETURNING TO HUB. ]',
          timestamp: Date.now(),
        },
      });
      expect(state2.history).toHaveLength(2);
      expect(state2.storyLog).toHaveLength(0); // Excluded from storyLog

      // 3. System role message
      const state3 = engineReducer(state2, {
        type: 'ADD_MESSAGE',
        message: {
          id: 'sys_02',
          role: 'system',
          content: 'System diagnostic ping.',
          timestamp: Date.now(),
        },
      });
      expect(state3.history).toHaveLength(3);
      expect(state3.storyLog).toHaveLength(0); // Excluded from storyLog

      // 4. Rejected candidate frame message
      const state4 = engineReducer(state3, {
        type: 'ADD_MESSAGE',
        message: {
          id: 'rej_01',
          role: 'assistant',
          content: 'Malformed text',
          validation: { accepted: false, rejected_fields: ['STRUCTURAL_ERROR'], repair_notes: [] },
          blocks: [{ type: 'prose', content: 'Malformed text' }],
          timestamp: Date.now(),
        },
      });
      expect(state4.history).toHaveLength(4);
      expect(state4.storyLog).toHaveLength(0); // Excluded from storyLog
    });
  });

  describe('Phase 3 Vocalization formatBlocks in reducer', () => {
    it('formats narrative_blocks into state.history using Phase 3 formatting rules', () => {
      const startState = {
        ...initialEngineState,
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_RESOLVED',
        payload: {
          narrative_blocks: [
            { type: 'prose', content: 'Darkness blankets the sub-station.' },
            { type: 'dialogue', speaker: 'kane', content: 'Did you hear that noise?' },
            { type: 'internal_monologue', speaker: 'Dr. Evans', content: 'The air has turned acidic.' },
            { type: 'internal_monologue', content: 'I should stay still.' },
            { type: 'soliloquy', speaker: 'Mercer', content: 'Not like this, not today.' },
            { type: 'soliloquy', content: 'Just breath.' },
            { type: 'transmission', speaker: 'COMM-RELAY', content: 'Signal degraded 80%.' },
            { type: 'transmission', content: 'Static hum.' },
          ],
        } as any,
      });

      const lastMessage = nextState.history[nextState.history.length - 1];
      expect(lastMessage.content).toBe(
        'Darkness blankets the sub-station.\n\n' +
        'KANE: Did you hear that noise?\n\n' +
        '[THOUGHT // Dr. Evans]: The air has turned acidic.\n\n' +
        '[THOUGHT // POV]: I should stay still.\n\n' +
        '[MUTTERED // Mercer]: Not like this, not today.\n\n' +
        '[MUTTERED // SELF]: Just breath.\n\n' +
        '[TRANSMISSION // COMM-RELAY]: Signal degraded 80%.\n\n' +
        '[TRANSMISSION // INTERCOM]: Static hum.'
      );
    });
  });

  describe('HG4 Packet 2 — Object state transition reducer integration', () => {
    const createBaseLedgers = (): {
      worldObjectLedger: WorldObjectLedger;
      restraintLedger: RestraintLedger;
    } => ({
      worldObjectLedger: {
        key: {
          objectId: 'key',
          name: 'Brass Key',
          location: { kind: 'NODE', id: 'node-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        chest: {
          objectId: 'chest',
          name: 'Iron Chest',
          location: { kind: 'NODE', id: 'node-1' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
      },
      restraintLedger: {
        bindings: {},
        locks: {
          'CONTAINER:chest': {
            targetRef: { kind: 'CONTAINER', id: 'chest' },
            locked: true,
            keyObjectId: 'key',
          },
        },
      },
    });

    it('commits accepted object transitions in TURN_COMMITTED and attaches objectTransitionReceipt', () => {
      const { worldObjectLedger, restraintLedger } = createBaseLedgers();
      const startState = {
        ...initialEngineState,
        currentNodeId: 'node-1',
        selectedCharacterId: 'player-1',
        castPlacement: { 'player-1': 'node-1' },
        worldObjectLedger,
        restraintLedger,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const proposals: ObjectTransitionProposal[] = [
        { objectId: 'key', transition: 'PICKUP' },
        { objectId: 'chest', transition: 'UNLOCK' },
      ];

      const payload: CommittedTurnPayload = {
        commandText: 'Take the brass key and unlock the chest',
        formattedText: 'You take the key and unlock the iron chest with a heavy click.',
        preSnapshot,
        frame: {
          engine_thoughts: 'Player picks up key and unlocks chest.',
          narrative_blocks: [
            { type: 'prose', content: 'You take the key and unlock the iron chest.' },
          ],
          logic_state: {
            suggested_tension: 30,
          },
          objectTransitions: proposals,
        } as any,
        turnReceipt: {
          turnNumber: 1,
          nodeBefore: 'node-1',
          requestedTarget: null,
          accepted: true,
          nodeAfter: 'node-1',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 30,
          preSnapshot,
        },
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      // Object location updated in worldObjectLedger
      expect(nextState.worldObjectLedger?.key.location).toEqual({
        kind: 'CARRIER',
        id: 'player-1',
      });
      // Lock state updated in restraintLedger
      expect(nextState.restraintLedger?.locks['CONTAINER:chest'].locked).toBe(false);

      // Turn receipt contains objectTransitionReceipt with decisions
      const committedReceipt = nextState.history[1].turnReceipt;
      expect(committedReceipt?.objectTransitionReceipt).toBeDefined();
      expect(committedReceipt?.objectTransitionReceipt).toHaveLength(2);
      expect(committedReceipt?.objectTransitionReceipt?.[0].accepted).toBe(true);
      expect(committedReceipt?.objectTransitionReceipt?.[0].proposal.transition).toBe('PICKUP');
      expect(committedReceipt?.objectTransitionReceipt?.[1].accepted).toBe(true);
      expect(committedReceipt?.objectTransitionReceipt?.[1].proposal.transition).toBe('UNLOCK');
    });

    it('preserves byte-identical receipts without objectTransitionReceipt on turns without proposals', () => {
      const { worldObjectLedger, restraintLedger } = createBaseLedgers();
      const startState = {
        ...initialEngineState,
        currentNodeId: 'node-1',
        selectedCharacterId: 'player-1',
        castPlacement: { 'player-1': 'node-1' },
        worldObjectLedger,
        restraintLedger,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const payload: CommittedTurnPayload = {
        commandText: 'Look around',
        formattedText: 'You look around the damp room.',
        preSnapshot,
        frame: {
          engine_thoughts: 'Inspection turn.',
          narrative_blocks: [
            { type: 'prose', content: 'You look around the damp room.' },
          ],
          logic_state: { suggested_tension: 20 },
        },
        turnReceipt: {
          turnNumber: 1,
          nodeBefore: 'node-1',
          requestedTarget: null,
          accepted: true,
          nodeAfter: 'node-1',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 20,
          preSnapshot,
        },
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      const receipt = nextState.history[1].turnReceipt;
      expect('objectTransitionReceipt' in (receipt || {})).toBe(false);
      expect(receipt?.objectTransitionReceipt).toBeUndefined();
    });

    it('retake-after-PICKUP restores prior object location and lock flags', () => {
      const { worldObjectLedger, restraintLedger } = createBaseLedgers();
      const startState = {
        ...initialEngineState,
        currentNodeId: 'node-1',
        selectedCharacterId: 'player-1',
        castPlacement: { 'player-1': 'node-1' },
        worldObjectLedger,
        restraintLedger,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const proposals: ObjectTransitionProposal[] = [
        { objectId: 'key', transition: 'PICKUP' },
        { objectId: 'chest', transition: 'UNLOCK' },
      ];

      const payload: CommittedTurnPayload = {
        commandText: 'Take key and unlock chest',
        formattedText: 'Done.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'Done.' }],
          objectTransitions: proposals,
        } as any,
        turnReceipt: {
          turnNumber: 1,
          nodeBefore: 'node-1',
          requestedTarget: null,
          accepted: true,
          nodeAfter: 'node-1',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 20,
          preSnapshot,
        },
      };

      // 1. Commit the turn
      const committedState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      expect(committedState.worldObjectLedger?.key.location).toEqual({
        kind: 'CARRIER',
        id: 'player-1',
      });
      expect(committedState.restraintLedger?.locks['CONTAINER:chest'].locked).toBe(false);

      // 2. Retake the turn
      const retakenState = engineReducer(committedState, {
        type: 'TURN_RETAKEN',
      });

      // Must restore prior object location and lock flags
      expect(retakenState.worldObjectLedger?.key.location).toEqual({
        kind: 'NODE',
        id: 'node-1',
      });
      expect(retakenState.restraintLedger?.locks['CONTAINER:chest'].locked).toBe(true);
    });

    it('handles PROCESS_OBJECT_TRANSITIONS event directly updating ledgers', () => {
      const { worldObjectLedger, restraintLedger } = createBaseLedgers();
      const startState = {
        ...initialEngineState,
        currentNodeId: 'node-1',
        selectedCharacterId: 'player-1',
        castPlacement: { 'player-1': 'node-1' },
        worldObjectLedger,
        restraintLedger,
      };

      const nextState = engineReducer(startState, {
        type: 'PROCESS_OBJECT_TRANSITIONS',
        characterId: 'player-1',
        proposals: [
          { objectId: 'key', transition: 'PICKUP' },
          { objectId: 'chest', transition: 'UNLOCK' },
        ],
      });

      expect(nextState.worldObjectLedger?.key.location).toEqual({
        kind: 'CARRIER',
        id: 'player-1',
      });
      expect(nextState.restraintLedger?.locks['CONTAINER:chest'].locked).toBe(false);
    });
  });

  describe('HG4 Packet 3 — Attention transition reducer integration', () => {
    const createBaseLedgers = (): {
      worldObjectLedger: WorldObjectLedger;
      restraintLedger: RestraintLedger;
      attentionLedger: AttentionLedger;
    } => ({
      worldObjectLedger: {
        knife: {
          objectId: 'knife',
          name: 'Hunting Knife',
          location: { kind: 'NODE', id: 'node-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
      restraintLedger: {
        bindings: {},
        locks: {},
      },
      attentionLedger: {
        'guard-1': {
          characterId: 'guard-1',
          attendingTo: null,
          lapse: null,
          distractibility: 0.5,
        },
      },
    });

    it('commits accepted attention transitions in TURN_COMMITTED and attaches attentionTransitionReceipt', () => {
      const { worldObjectLedger, restraintLedger, attentionLedger } = createBaseLedgers();
      const startState = {
        ...initialEngineState,
        currentNodeId: 'node-1',
        selectedCharacterId: 'player-1',
        castPlacement: { 'player-1': 'node-1', 'guard-1': 'node-1' },
        worldObjectLedger,
        restraintLedger,
        attentionLedger,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const proposals: AttentionTransitionProposal[] = [
        {
          characterId: 'guard-1',
          transition: 'CAPTURE',
          target: { kind: 'OBJECT', id: 'knife' },
        },
      ];

      const payload: CommittedTurnPayload = {
        commandText: 'Distract guard with knife reflection',
        formattedText: 'The guard notices the knife glimmering on the floor.',
        preSnapshot,
        frame: {
          engine_thoughts: 'Guard attention captured by knife.',
          narrative_blocks: [
            { type: 'prose', content: 'The guard notices the knife glimmering on the floor.' },
          ],
          logic_state: {
            suggested_tension: 30,
          },
          attentionTransitions: proposals,
        } as any,
        turnReceipt: {
          turnNumber: 1,
          nodeBefore: 'node-1',
          requestedTarget: null,
          accepted: true,
          nodeAfter: 'node-1',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 30,
          preSnapshot,
        },
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      // Attention target updated in attentionLedger
      expect(nextState.attentionLedger?.['guard-1'].attendingTo).toEqual({
        kind: 'OBJECT',
        id: 'knife',
      });

      // Turn receipt contains attentionTransitionReceipt with decisions
      const committedReceipt = nextState.history[1].turnReceipt;
      expect(committedReceipt?.attentionTransitionReceipt).toBeDefined();
      expect(committedReceipt?.attentionTransitionReceipt).toHaveLength(1);
      expect(committedReceipt?.attentionTransitionReceipt?.[0].accepted).toBe(true);
      expect(committedReceipt?.attentionTransitionReceipt?.[0].proposal.transition).toBe('CAPTURE');
    });

    it('preserves byte-identical receipts without attentionTransitionReceipt on turns without attention proposals', () => {
      const { worldObjectLedger, restraintLedger, attentionLedger } = createBaseLedgers();
      const startState = {
        ...initialEngineState,
        currentNodeId: 'node-1',
        selectedCharacterId: 'player-1',
        castPlacement: { 'player-1': 'node-1', 'guard-1': 'node-1' },
        worldObjectLedger,
        restraintLedger,
        attentionLedger,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const payload: CommittedTurnPayload = {
        commandText: 'Wait silently',
        formattedText: 'You remain still.',
        preSnapshot,
        frame: {
          engine_thoughts: 'Idle turn.',
          narrative_blocks: [
            { type: 'prose', content: 'You remain still.' },
          ],
          logic_state: { suggested_tension: 20 },
        },
        turnReceipt: {
          turnNumber: 1,
          nodeBefore: 'node-1',
          requestedTarget: null,
          accepted: true,
          nodeAfter: 'node-1',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 20,
          preSnapshot,
        },
      };

      const nextState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      const receipt = nextState.history[1].turnReceipt;
      expect('attentionTransitionReceipt' in (receipt || {})).toBe(false);
      expect(receipt?.attentionTransitionReceipt).toBeUndefined();
    });

    it('retake-after-CAPTURE restores prior attention state', () => {
      const { worldObjectLedger, restraintLedger, attentionLedger } = createBaseLedgers();
      const startState = {
        ...initialEngineState,
        currentNodeId: 'node-1',
        selectedCharacterId: 'player-1',
        castPlacement: { 'player-1': 'node-1', 'guard-1': 'node-1' },
        worldObjectLedger,
        restraintLedger,
        attentionLedger,
      };

      const preSnapshot = captureRuntimeSnapshot(startState);
      const proposals: AttentionTransitionProposal[] = [
        {
          characterId: 'guard-1',
          transition: 'CAPTURE',
          target: { kind: 'OBJECT', id: 'knife' },
        },
      ];

      const payload: CommittedTurnPayload = {
        commandText: 'Guard glances at knife',
        formattedText: 'Guard looks at knife.',
        preSnapshot,
        frame: {
          narrative_blocks: [{ type: 'prose', content: 'Guard looks at knife.' }],
          attentionTransitions: proposals,
        } as any,
        turnReceipt: {
          turnNumber: 1,
          nodeBefore: 'node-1',
          requestedTarget: null,
          accepted: true,
          nodeAfter: 'node-1',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          tension: 20,
          preSnapshot,
        },
      };

      // 1. Commit the turn
      const committedState = engineReducer(startState, {
        type: 'TURN_COMMITTED',
        payload,
      });

      expect(committedState.attentionLedger?.['guard-1'].attendingTo).toEqual({
        kind: 'OBJECT',
        id: 'knife',
      });

      // 2. Retake the turn
      const retakenState = engineReducer(committedState, {
        type: 'TURN_RETAKEN',
      });

      // Must restore prior attention state
      expect(retakenState.attentionLedger?.['guard-1'].attendingTo).toBeNull();
    });

    it('handles PROCESS_ATTENTION_TRANSITIONS event directly updating attentionLedger', () => {
      const { worldObjectLedger, restraintLedger, attentionLedger } = createBaseLedgers();
      const startState = {
        ...initialEngineState,
        currentNodeId: 'node-1',
        selectedCharacterId: 'player-1',
        castPlacement: { 'player-1': 'node-1', 'guard-1': 'node-1' },
        worldObjectLedger,
        restraintLedger,
        attentionLedger,
      };

      const nextState = engineReducer(startState, {
        type: 'PROCESS_ATTENTION_TRANSITIONS',
        characterId: 'player-1',
        proposals: [
          {
            characterId: 'guard-1',
            transition: 'DISTRACT',
            durationMinutes: 5,
          },
        ],
      });

      expect(nextState.attentionLedger?.['guard-1'].lapse).toEqual({
        active: true,
        expiresAtFictionalTime: 300,
      });
    });
  });
});
