import { describe, it, expect } from 'vitest';
import type { AttemptFilterContext } from '../types/worldState';
import {
  filterOpportunitiesByAttention,
  OpportunityProposal,
} from './presentOpportunities';

describe('HG4 Packet 3 — Present Opportunities Gating', () => {
  const createBaseContext = (overrides?: Partial<AttemptFilterContext>): AttemptFilterContext => ({
    restraint: { bindings: {}, locks: {} },
    objects: {
      'lockpick-1': {
        objectId: 'lockpick-1',
        name: 'Hairpin Lockpick',
        location: { kind: 'NODE', id: 'cell-1' },
        affordances: [],
        sizeClass: 'LIGHT',
        effects: [],
      },
      'radio-1': {
        objectId: 'radio-1',
        name: 'Guard Radio',
        location: { kind: 'NODE', id: 'cell-1' },
        affordances: [],
        sizeClass: 'STANDARD',
        effects: [],
      },
    },
    attention: {
      'guard-1': {
        characterId: 'guard-1',
        attendingTo: null,
        lapse: null,
        distractibility: 0.5,
      },
    },
    routines: {},
    capabilities: {},
    seats: {
      captorCharacterIds: ['guard-1'],
      preyCharacterIds: ['player-1'],
    },
    fictionalTime: 100,
    characterNodes: {
      'player-1': 'cell-1',
      'guard-1': 'cell-1',
    },
    topologyConnections: [],
    ...overrides,
  });

  it('passes non-stealth opportunities unconditionally even when captor is vigilant', () => {
    const ctx = createBaseContext();
    const opportunities: OpportunityProposal[] = [
      {
        id: 'opp-1',
        targetKind: 'OBJECT',
        targetId: 'lockpick-1',
        requiresStealth: false,
      },
      {
        id: 'opp-2',
        targetKind: 'NODE',
        targetId: 'cell-1',
      },
    ];

    const filtered = filterOpportunitiesByAttention(opportunities, 'player-1', ctx);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((o) => o.id)).toEqual(['opp-1', 'opp-2']);
  });

  it('filters out stealth opportunities when captor is vigilant and co-located', () => {
    const ctx = createBaseContext();
    const opportunities: OpportunityProposal[] = [
      {
        id: 'opp-conspicuous',
        targetKind: 'OBJECT',
        targetId: 'lockpick-1',
        requiresStealth: false,
      },
      {
        id: 'opp-covert',
        targetKind: 'OBJECT',
        targetId: 'lockpick-1',
        requiresStealth: true,
      },
    ];

    const filtered = filterOpportunitiesByAttention(opportunities, 'player-1', ctx);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('opp-conspicuous');
  });

  it('retains stealth opportunities when captor has active distraction lapse', () => {
    const ctx = createBaseContext({
      fictionalTime: 100,
      attention: {
        'guard-1': {
          characterId: 'guard-1',
          attendingTo: null,
          lapse: { active: true, expiresAtFictionalTime: 300 },
          distractibility: 0.5,
        },
      },
    });

    const opportunities: OpportunityProposal[] = [
      {
        id: 'opp-covert',
        targetKind: 'OBJECT',
        targetId: 'lockpick-1',
        requiresStealth: true,
      },
    ];

    const filtered = filterOpportunitiesByAttention(opportunities, 'player-1', ctx);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('opp-covert');
  });

  it('retains stealth opportunities when captor is absorbed in another object', () => {
    const ctx = createBaseContext({
      attention: {
        'guard-1': {
          characterId: 'guard-1',
          attendingTo: { kind: 'OBJECT', id: 'radio-1' },
          lapse: null,
          distractibility: 0.5,
        },
      },
    });

    const opportunities: OpportunityProposal[] = [
      {
        id: 'opp-steal-pick',
        targetKind: 'OBJECT',
        targetId: 'lockpick-1',
        requiresStealth: true,
      },
    ];

    const filtered = filterOpportunitiesByAttention(opportunities, 'player-1', ctx);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('opp-steal-pick');
  });

  it('handles empty opportunities list cleanly', () => {
    const ctx = createBaseContext();
    const filtered = filterOpportunitiesByAttention([], 'player-1', ctx);
    expect(filtered).toEqual([]);
  });
});
