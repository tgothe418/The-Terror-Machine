import { describe, it, expect } from 'vitest';
import {
  buildRestraintFailureReceipt,
  executeRestraintFilter,
} from './turnExecution';
import type { AttemptFilterContext } from '../../types/worldState';

describe('HG4 Packet 1 — Turn Execution Restraint Integration', () => {
  const baseContext: AttemptFilterContext = {
    restraint: { bindings: {}, locks: {} },
    objects: {},
    attention: {},
    routines: {},
    capabilities: {},
    seats: { captorCharacterIds: ['villain-1'], preyCharacterIds: ['prey-1'] },
    fictionalTime: 1000,
    characterNodes: { 'prey-1': 'room-cell', 'villain-1': 'room-hallway' },
    topologyConnections: [
      { fromNodeId: 'room-cell', toNodeId: 'room-hallway', status: 'LOCKED' },
    ],
  };

  it('buildRestraintFailureReceipt creates valid fail-closed receipt with provenance and reasonCode', () => {
    const action = { characterId: 'prey-1', verb: 'FLEE', targetId: 'room-hallway' };
    const checkResult = {
      allowed: false,
      reasonCode: 'RESTRAINT_BINDING' as const,
      provenance: 'Binding level TIED_TO_FIXTURE denies verb FLEE.',
    };

    const receipt = buildRestraintFailureReceipt(action, checkResult);
    expect(receipt.accepted).toBe(false);
    expect(receipt.reasonCode).toBe('RESTRAINT_BINDING');
    expect(receipt.provenance).toBe('Binding level TIED_TO_FIXTURE denies verb FLEE.');
    expect(receipt.action).toEqual(action);
    expect(receipt.narrative_blocks).toEqual([]);
  });

  it('executeRestraintFilter rejects bound character and skips generation (fail-closed)', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      restraint: {
        bindings: {
          'prey-1': { characterId: 'prey-1', level: 'FULL_HOGTIE' },
        },
        locks: {},
      },
    };

    const action = { characterId: 'prey-1', verb: 'FORTIFY' };
    const result = executeRestraintFilter(action, ctx);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect('receipt' in result && result.receipt.reasonCode).toBe('RESTRAINT_BINDING');
      expect('receipt' in result && result.receipt.narrative_blocks).toEqual([]);
    }
  });

  it('executeRestraintFilter rejects locked edge target and emits LOCK reasonCode', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      restraint: {
        bindings: {
          'prey-1': { characterId: 'prey-1', level: 'UNRESTRAINED' },
        },
        locks: {
          'EDGE:room-cell->room-hallway': {
            targetRef: { kind: 'EDGE', id: 'room-cell->room-hallway' },
            locked: true,
          },
        },
      },
    };

    const action = { characterId: 'prey-1', verb: 'FLEE', targetId: 'room-hallway' };
    const result = executeRestraintFilter(action, ctx);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect('receipt' in result && result.receipt.reasonCode).toBe('LOCK');
      expect('receipt' in result && result.receipt.provenance).toContain('EDGE:room-cell->room-hallway is locked.');
    }
  });

  it('executeRestraintFilter permits action when unrestrained and unlocked', () => {
    const action = { characterId: 'prey-1', verb: 'FLEE', targetId: 'room-hallway' };
    const result = executeRestraintFilter(action, baseContext);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.check.reasonCode).toBe('ALLOWED');
    }
  });
});
