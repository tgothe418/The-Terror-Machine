import { describe, it, expect } from 'vitest';
import type { AttemptFilterContext, RoutineState, RoutineEvent } from '../types/worldState';
import {
  dueRoutines,
  evaluateRoutineTick,
  applyRoutineTick,
  routineNodeTransitions,
  routineAttentionWrites,
} from './routineMechanics';

describe('HG4 Packet 4 — Routine Mechanics', () => {
  const baseContext: AttemptFilterContext = {
    restraint: { bindings: {}, locks: {} },
    objects: {},
    attention: {},
    routines: {},
    capabilities: {},
    seats: {
      captorCharacterIds: ['captor-1'],
      preyCharacterIds: ['prey-1'],
    },
    fictionalTime: 600, // 10 minutes
    characterNodes: {
      'captor-1': 'node-corridor',
      'prey-1': 'node-cell',
    },
    topologyConnections: [],
  };

  it('dueRoutines: deterministic selection sorted by routineId ascending', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      fictionalTime: 1200,
      routines: {
        'z-patrol': {
          routineId: 'z-patrol',
          characterId: 'captor-1',
          cadence: { periodMinutes: 20, firstFireMinutes: 10 },
          steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Patrol' }],
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
        'a-patrol': {
          routineId: 'a-patrol',
          characterId: 'captor-1',
          cadence: { periodMinutes: 20, firstFireMinutes: 10 },
          steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Patrol' }],
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
        'm-future': {
          routineId: 'm-future',
          characterId: 'captor-1',
          cadence: { periodMinutes: 20, firstFireMinutes: 30 },
          steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Patrol' }],
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
      },
    };

    const due = dueRoutines(ctx);
    expect(due.map((r) => r.routineId)).toEqual(['a-patrol', 'z-patrol']);
  });

  it('dueRoutines: uninitialized nextFireFictionalTime initializes from firstFireMinutes', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      fictionalTime: 600, // exactly 10 minutes (600s)
      routines: {
        'rout-1': {
          routineId: 'rout-1',
          characterId: 'captor-1',
          cadence: { periodMinutes: 30, firstFireMinutes: 10 },
          steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Check' }],
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
        'rout-not-due': {
          routineId: 'rout-not-due',
          characterId: 'captor-1',
          cadence: { periodMinutes: 30, firstFireMinutes: 11 },
          steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Check' }],
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
      },
    };

    const due = dueRoutines(ctx);
    expect(due.length).toBe(1);
    expect(due[0].routineId).toBe('rout-1');
  });

  it('evaluateRoutineTick & applyRoutineTick: fire happy path advances pointer modulo length with drift', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      fictionalTime: 600,
      routines: {
        'rout-sweep': {
          routineId: 'rout-sweep',
          characterId: 'captor-1',
          cadence: { periodMinutes: 15, firstFireMinutes: 10 },
          steps: [
            { stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Inspect cell' },
            { stepNumber: 2, nodeId: 'node-yard', durationMinutes: 10, actionSummary: 'Inspect yard' },
          ],
          currentStepIndex: 0,
          varianceBand: { minMinutes: -2, maxMinutes: 5 },
          modifiers: [
            {
              id: 'mod-yard-co',
              predicate: { kind: 'CO_LOCATION', charA: 'captor-1', charB: 'prey-1' },
              deltaMinutes: 3,
            },
          ],
        },
      },
    };

    const events = evaluateRoutineTick(ctx, ['prey-1']);
    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.routineId).toBe('rout-sweep');
    expect(event.stepNumber).toBe(1);
    expect(event.firedAtFictionalTime).toBe(600);
    expect(event.nodeTransition).toEqual({
      fromNodeId: 'node-corridor',
      toNodeId: 'node-cell',
    });
    expect(event.skipped).toBeUndefined();

    // Apply tick
    const nextLedger = applyRoutineTick(ctx.routines, events, ctx);
    const updated = nextLedger['rout-sweep'];
    expect(updated.currentStepIndex).toBe(1); // pointer advanced to step 2
    expect(updated.lastFiredFictionalTime).toBe(600);
    // period is 15m (900s), drift is 0 (characters not co-located at start), nextFire = 600 + 900 = 1500
    expect(updated.nextFireFictionalTime).toBe(1500);

    // Node transition extraction
    const transitions = routineNodeTransitions(events, nextLedger);
    expect(transitions).toEqual([{ characterId: 'captor-1', nodeId: 'node-cell' }]);
  });

  it('evaluateRoutineTick: calculates drift and firedModifierIds from RELATIONSHIP_STANCE', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      fictionalTime: 600,
      relationships: [
        { charA: 'captor-1', charB: 'prey-1', stance: 'SUSPICIOUS' },
      ],
      routines: {
        'rout-inspect': {
          routineId: 'rout-inspect',
          characterId: 'captor-1',
          cadence: { periodMinutes: 20, firstFireMinutes: 10 },
          steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Inspect' }],
          varianceBand: { minMinutes: -10, maxMinutes: 10 },
          modifiers: [
            {
              id: 'mod-suspicious',
              predicate: { kind: 'RELATIONSHIP_STANCE', charA: 'captor-1', charB: 'prey-1', stance: 'SUSPICIOUS' },
              deltaMinutes: -5,
            },
          ],
        },
      },
    };

    const events = evaluateRoutineTick(ctx);
    expect(events[0].driftMinutes).toBe(-5);
    expect(events[0].firedModifierIds).toEqual(['mod-suspicious']);

    const updatedLedger = applyRoutineTick(ctx.routines, events, ctx);
    // period 20m (1200s) + drift -5m (-300s) = 900s; nextFire = 600 + 900 = 1500
    expect(updatedLedger['rout-inspect'].nextFireFictionalTime).toBe(1500);
  });

  it('evaluateRoutineTick: disruption by TIED_TO_FIXTURE blocks movement, pointer still advances', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      fictionalTime: 600,
      restraint: {
        bindings: {
          'captor-1': { characterId: 'captor-1', level: 'TIED_TO_FIXTURE' },
        },
        locks: {},
      },
      routines: {
        'rout-tied': {
          routineId: 'rout-tied',
          characterId: 'captor-1',
          cadence: { periodMinutes: 10, firstFireMinutes: 10 },
          steps: [
            { stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Struggle move' },
            { stepNumber: 2, nodeId: 'node-corridor', durationMinutes: 5, actionSummary: 'Stand' },
          ],
          currentStepIndex: 0,
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
      },
    };

    const events = evaluateRoutineTick(ctx);
    expect(events.length).toBe(1);
    expect(events[0].skipped).toEqual({
      reasonCode: 'RESTRAINT_BINDING',
      provenance: 'Locomotion blocked by physical restraint.',
    });
    expect(events[0].nodeTransition).toBeUndefined();

    // routineNodeTransitions filters out skipped events
    expect(routineNodeTransitions(events)).toEqual([]);

    // applyRoutineTick still advances pointer and updates fire times
    const updated = applyRoutineTick(ctx.routines, events, ctx);
    expect(updated['rout-tied'].currentStepIndex).toBe(1);
    expect(updated['rout-tied'].lastFiredFictionalTime).toBe(600);
  });

  it('evaluateRoutineTick: player-seat routine skipped with PLAYER_SEAT', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      fictionalTime: 600,
      routines: {
        'rout-player': {
          routineId: 'rout-player',
          characterId: 'prey-1', // bound to player seat
          cadence: { periodMinutes: 10, firstFireMinutes: 10 },
          steps: [{ stepNumber: 1, nodeId: 'node-corridor', durationMinutes: 5, actionSummary: 'Attempt' }],
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
      },
    };

    const events = evaluateRoutineTick(ctx, ['prey-1']);
    expect(events.length).toBe(1);
    expect(events[0].skipped).toEqual({
      reasonCode: 'PLAYER_SEAT',
      provenance: 'Routines cannot be bound to player seat.',
    });
    expect(events[0].nodeTransition).toBeUndefined();
  });

  it('evaluateRoutineTick: step attentionTarget records attentionSet and extracts writes', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      fictionalTime: 600,
      characterNodes: { 'captor-1': 'node-cell' }, // already at node-cell
      routines: {
        'rout-att': {
          routineId: 'rout-att',
          characterId: 'captor-1',
          cadence: { periodMinutes: 10, firstFireMinutes: 10 },
          steps: [
            {
              stepNumber: 1,
              nodeId: 'node-cell',
              durationMinutes: 5,
              actionSummary: 'Watch prey',
              attentionTarget: { kind: 'CHARACTER', id: 'prey-1' },
            },
          ],
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
      },
    };

    const events = evaluateRoutineTick(ctx);
    expect(events[0].attentionSet).toEqual({ kind: 'CHARACTER', id: 'prey-1' });

    const writes = routineAttentionWrites(events, ctx.routines);
    expect(writes).toEqual([
      { characterId: 'captor-1', target: { kind: 'CHARACTER', id: 'prey-1' } },
    ]);
  });

  it('determinism: identical state yields identical events (zero PRNG)', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      fictionalTime: 600,
      routines: {
        'rout-det': {
          routineId: 'rout-det',
          characterId: 'captor-1',
          cadence: { periodMinutes: 15, firstFireMinutes: 10 },
          steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Check' }],
          varianceBand: { minMinutes: -3, maxMinutes: 3 },
          modifiers: [],
        },
      },
    };

    const ev1 = evaluateRoutineTick(ctx);
    const ev2 = evaluateRoutineTick(ctx);
    expect(ev1).toEqual(ev2);
  });

  it('empty routine ledger returns empty array', () => {
    const ctx: AttemptFilterContext = { ...baseContext, routines: {} };
    expect(dueRoutines(ctx)).toEqual([]);
    expect(evaluateRoutineTick(ctx)).toEqual([]);
    expect(applyRoutineTick({}, [])).toEqual({});
  });

  it('applyRoutineTick: clamps nextFireFictionalTime to non-negative even if period + drift is negative', () => {
    const routine: RoutineState = {
      routineId: 'rout-extreme-neg',
      characterId: 'captor-1',
      cadence: { periodMinutes: 5, firstFireMinutes: 0 },
      steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Patrol' }],
      varianceBand: { minMinutes: -20, maxMinutes: 0 },
      modifiers: [],
    };

    const event: RoutineEvent = {
      routineId: 'rout-extreme-neg',
      characterId: 'captor-1',
      stepNumber: 1,
      firedAtFictionalTime: 60,
      driftMinutes: -10, // 5m period + -10m drift = -5m (-300s). 60 - 300 = -240s
      firedModifierIds: [],
    };

    const nextLedger = applyRoutineTick({ 'rout-extreme-neg': routine }, [event]);
    expect(nextLedger['rout-extreme-neg'].nextFireFictionalTime).toBe(0);
  });
});
