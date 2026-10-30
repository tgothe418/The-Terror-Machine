import { describe, it, expect } from 'vitest';
import { validateHorrorGrammarTurnReceipts } from './horrorGrammarTurnValidation';
import { LogicState } from '../types';
import { TurnResponse } from '../types/engineContract';
import { SituatedPressureThread } from '../types/horrorGrammar';

function createMockTurnResponse(overrides: Partial<TurnResponse> = {}): TurnResponse {
  const sampleThread: SituatedPressureThread = {
    id: 'pt-1',
    valueAnchorId: 'va-1',
    holder: { kind: 'CHARACTER', castMemberId: 'c-1' },
    sourceReference: 'src-1',
    operator: 'ACCELERATE',
    affectedDimension: 'TIME',
    adverseProspect: 'Harm',
    manifestationSummary: null,
    status: 'OPEN',
    createdTurn: 1,
    lastChangedTurn: 1,
    persistenceTarget: 'PRESSURE_THREAD',
    authorityReferences: [],
    locationNodeId: null,
  };

  return {
    narrative_blocks: [],
    logic_state: {},
    canonicalConsequenceReceipt: {
      version: 1,
      decisions: [],
      pre_state: { inventory: [], player_injuries: [], psychological_status: 'STABLE' },
      post_state: { inventory: [], player_injuries: [], psychological_status: 'STABLE' },
      patch: {
        inventory_added: [],
        inventory_removed: [],
        injuries_added: [],
        injuries_removed: [],
        psychological_status_change: null,
      },
    },
    characterStanceReceipt: { version: 1, pre_state: {}, post_state: {}, decisions: [] },
    characterRelationshipReceipt: { version: 1, pre_state: [], post_state: [], decisions: [] },
    characterMemoryReceipt: { version: 1, pre_state: {}, post_state: {}, decisions: [] },
    worldMemoryReceipt: { version: 1, pre_state: [], post_state: [], decisions: [] },
    fictionalTimeReceipt: {
      version: 1,
      preState: { moment_revision: 1, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
      acceptedCost: 'MOMENT',
      postState: { moment_revision: 2, scene_beat_revision: 0, extended_revision: 0, last_cost: 'MOMENT' },
    },
    castActivityReceipt: {
      version: 1,
      presentOpportunities: [],
      offscreenOpportunities: [],
      boundedOutPursuitIds: [],
      dormantCount: 0,
      notDueCount: 0,
      ledgerSnapshot: { moment_revision: 1, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
      scheduleSnapshotRevision: 1,
    },
    pursuitScheduleReceipt: {
      version: 1,
      preState: {
        'p-1': {
          pursuitId: 'p-1',
          castMemberId: 'c-1',
          lastConsideredMomentRevision: 0,
          lastConsideredSceneBeatRevision: 0,
          lastConsideredExtendedRevision: 0,
          lastConsideredTurn: null,
          latestDisposition: 'OFFSCREEN_NOT_DUE',
        },
      },
      postState: {
        'p-1': {
          pursuitId: 'p-1',
          castMemberId: 'c-1',
          lastConsideredMomentRevision: 2,
          lastConsideredSceneBeatRevision: 0,
          lastConsideredExtendedRevision: 0,
          lastConsideredTurn: 1,
          latestDisposition: 'OFFSCREEN_NOT_DUE',
        },
      },
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
      postState: [sampleThread],
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
      preState: [sampleThread],
      postState: [sampleThread],
      decisions: [],
      boundedOutChangeIds: [],
    },
    ...overrides,
  };
}

describe('validateHorrorGrammarTurnReceipts', () => {
  const validPreState: LogicState = {
    fictional_time_ledger: { moment_revision: 1, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
    pursuit_schedule_ledger: {
      'p-1': {
        pursuitId: 'p-1',
        castMemberId: 'c-1',
        lastConsideredMomentRevision: 0,
        lastConsideredSceneBeatRevision: 0,
        lastConsideredExtendedRevision: 0,
        lastConsideredTurn: null,
        latestDisposition: 'OFFSCREEN_NOT_DUE',
      },
    },
    activity_events: [],
    pressure_threads: [],
    value_state_ledger: {},
    character_pursuit_ledger: {},
    character_development_ledger: {},
  };

  it('validates a complete, structurally consistent HG1 receipt chain', () => {
    const response = createMockTurnResponse();
    const result = validateHorrorGrammarTurnReceipts(validPreState, response);

    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.postState.fictional_time_ledger.moment_revision).toBe(2);
      expect(result.postState.pressure_threads).toHaveLength(1);
    }
  });

  it('fails if fictionalTimeReceipt is missing', () => {
    const response = createMockTurnResponse({ fictionalTimeReceipt: undefined });
    const result = validateHorrorGrammarTurnReceipts(validPreState, response);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('MISSING_FICTIONAL_TIME_RECEIPT');
    }
  });

  it('fails if fictional time pre-state does not match canonical state', () => {
    const response = createMockTurnResponse({
      fictionalTimeReceipt: {
        version: 1,
        preState: { moment_revision: 999, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
        acceptedCost: 'MOMENT',
        postState: { moment_revision: 1000, scene_beat_revision: 0, extended_revision: 0, last_cost: 'MOMENT' },
      },
    });
    const result = validateHorrorGrammarTurnReceipts(validPreState, response);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('FICTIONAL_TIME_PRESTATE_MISMATCH');
    }
  });

  it('fails if pursuit schedule pre-state does not match canonical state', () => {
    const response = createMockTurnResponse({
      pursuitScheduleReceipt: {
        version: 1,
        preState: {}, // Mismatched vs validPreState which has 'p-1'
        postState: {},
      },
    });
    const result = validateHorrorGrammarTurnReceipts(validPreState, response);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('PURSUIT_SCHEDULE_PRESTATE_MISMATCH');
    }
  });

  it('fails if pressure thread transition preState does not link to situated pressure postState', () => {
    const response = createMockTurnResponse({
      pressureThreadTransitionReceipt: {
        version: 1,
        preState: [], // Disagrees with situatedPressureReceipt.postState which has [sampleThread]
        postState: [],
        decisions: [],
        boundedOutChangeIds: [],
      },
    });
    const result = validateHorrorGrammarTurnReceipts(validPreState, response);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('PRESSURE_TRANSITION_LINKAGE_MISMATCH');
    }
  });

  it('fails if worldMemoryReceipt is missing', () => {
    const response = createMockTurnResponse({
      worldMemoryReceipt: undefined,
    });
    const result = validateHorrorGrammarTurnReceipts(validPreState, response);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('MISSING_WORLD_MEMORY_RECEIPT');
    }
  });

  it('fails if worldMemoryReceipt pre_state does not match canonical world_memory', () => {
    const stateWithWorldMemory: LogicState = {
      ...validPreState,
      world_memory: [
        {
          id: 'wm_01',
          statement: 'The outer gate is padlocked.',
          kind: 'PERSISTENT_CONSEQUENCE',
          scope: 'GLOBAL',
          node_id: null,
          established_turn: 1,
        },
      ],
    };
    // Response pre_state is empty while canonical has wm_01
    const response = createMockTurnResponse({
      worldMemoryReceipt: {
        version: 1,
        pre_state: [],
        post_state: [],
        decisions: [],
      },
    });
    const result = validateHorrorGrammarTurnReceipts(stateWithWorldMemory, response);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('WORLD_MEMORY_PRESTATE_MISMATCH');
    }
  });

  it('passes when worldMemoryReceipt pre_state matches canonical world_memory', () => {
    const canonicalMemory = [
      {
        id: 'wm_01',
        statement: 'The outer gate is padlocked.',
        kind: 'PERSISTENT_CONSEQUENCE' as const,
        scope: 'GLOBAL' as const,
        node_id: null,
        established_turn: 1,
        last_confirmed_turn: 1,
      },
    ];
    const stateWithWorldMemory: LogicState = {
      ...validPreState,
      world_memory: canonicalMemory,
    };
    const response = createMockTurnResponse({
      worldMemoryReceipt: {
        version: 1,
        pre_state: canonicalMemory,
        post_state: canonicalMemory,
        decisions: [],
      },
    });
    const result = validateHorrorGrammarTurnReceipts(stateWithWorldMemory, response);

    expect(result.isValid).toBe(true);
  });
});
