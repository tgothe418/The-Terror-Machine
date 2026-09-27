import { describe, it, expect } from 'vitest';
import type {
  AttemptFilterContext,
  SoundproofFragmentFixture,
  WindowSpec,
  HeadlessProbeStep,
} from './headlessProbe';
import {
  runHeadlessProbe,
  assertWindowBar,
  assertDiegeticTraceGuard,
} from './headlessProbe';

describe('HG4 Packet 4 — Headless Probe & Phase 1 Acceptance Bar (A1)', () => {
  const createSoundproofFixture = (): SoundproofFragmentFixture => {
    const context: AttemptFilterContext = {
      restraint: {
        bindings: {
          'player-1': { characterId: 'player-1', level: 'TIED_TO_FIXTURE' },
        },
        locks: {},
      },
      objects: {
        'drawer-1': {
          objectId: 'drawer-1',
          name: 'Metal Drawer',
          location: { kind: 'NODE', id: 'node-cell' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        'key-1': {
          objectId: 'key-1',
          name: 'Brass Key',
          location: { kind: 'CONTAINER', id: 'drawer-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
      attention: {
        warden: {
          characterId: 'warden',
          attendingTo: { kind: 'CHARACTER', id: 'player-1' },
          lapse: null,
          distractibility: 0.8,
        },
      },
      routines: {
        'rout-warden-rounds': {
          routineId: 'rout-warden-rounds',
          characterId: 'warden',
          cadence: { periodMinutes: 1, firstFireMinutes: 1 },
          steps: [
            { stepNumber: 1, nodeId: 'node-corridor', durationMinutes: 1, actionSummary: 'Patrol corridor' },
            { stepNumber: 2, nodeId: 'node-cell', durationMinutes: 1, actionSummary: 'Return to cell' },
          ],
          currentStepIndex: 0,
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
        },
      },
      capabilities: {},
      seats: {
        captorCharacterIds: ['warden'],
        preyCharacterIds: ['player-1'],
      },
      fictionalTime: 0,
      characterNodes: {
        'player-1': 'node-cell',
        warden: 'node-cell',
      },
      topologyConnections: [
        { fromNodeId: 'node-cell', toNodeId: 'node-corridor', status: 'OPEN' },
      ],
    };

    return {
      context,
      playerSeatCharacterIds: ['player-1'],
      defaultStepSeconds: 60,
      signals: {
        'node-cell': ['creaking_pipes', 'muffled_heavy_breathing'],
        'node-corridor': ['distant_humming'],
      },
    };
  };

  it('assertWindowBar: passes W1_ROUTINE_DRIFT (open on guard departure, close on return)', () => {
    const fixture = createSoundproofFixture();
    // Step 0: time 60, routine fires step 1 (warden moves to corridor)
    // Step 1: time 120, routine fires step 2 (warden returns to cell)
    const steps: HeadlessProbeStep[] = [
      { kind: 'INVESTIGATE', characterId: 'player-1', advanceSeconds: 60 },
      { kind: 'INVESTIGATE', characterId: 'player-1', advanceSeconds: 60 },
    ];

    const trace = runHeadlessProbe(fixture, steps);
    expect(trace.length).toBe(2);

    const w1: WindowSpec = {
      windowId: 'W1_ROUTINE_DRIFT',
      openPredicate: (e) =>
        Boolean(e.routineEvents?.some((rev) => rev.nodeTransition?.toNodeId === 'node-corridor')),
      closePredicate: (e) =>
        Boolean(e.routineEvents?.some((rev) => rev.nodeTransition?.toNodeId === 'node-cell')),
      expectedSignals: ['footsteps_node-cell_to_node-corridor', 'footsteps_node-corridor_to_node-cell'],
      receiptRequirement: (t) => t.some((entry) => (entry.routineEvents?.length || 0) > 0),
    };

    expect(() => assertWindowBar(trace, w1)).not.toThrow();
  });

  it('assertWindowBar: passes W2_OBJECT_REACH (open on container open, close on container shut)', () => {
    const fixture = createSoundproofFixture();
    const steps: HeadlessProbeStep[] = [
      {
        kind: 'MANIPULATE',
        characterId: 'player-1',
        targetId: 'key-1',
        mutation: (ctx) => {
          // Open drawer and untie hands so grip is possible
          ctx.objects['drawer-1'].containerState = 'OPEN';
          ctx.restraint.bindings['player-1'].level = 'UNRESTRAINED';
        },
      },
      {
        kind: 'MANIPULATE',
        characterId: 'player-1',
        targetId: 'key-1',
        mutation: (ctx) => {
          // Close drawer
          ctx.objects['drawer-1'].containerState = 'CLOSED';
        },
      },
    ];

    const trace = runHeadlessProbe(fixture, steps);

    const w2: WindowSpec = {
      windowId: 'W2_OBJECT_REACH',
      openPredicate: (e) =>
        Boolean(e.inReachResults.find((r) => r.objectId === 'key-1')?.reachable),
      closePredicate: (e) =>
        !e.inReachResults.find((r) => r.objectId === 'key-1')?.reachable,
      expectedSignals: ['creaking_pipes'],
      receiptRequirement: (t) => t.every((e) => e.inReachResults.length > 0),
    };

    expect(() => assertWindowBar(trace, w2)).not.toThrow();
  });

  it('assertWindowBar: passes W3_RESTRAINT_VERB (open on untying, close on re-binding)', () => {
    const fixture = createSoundproofFixture();
    const steps: HeadlessProbeStep[] = [
      {
        kind: 'MOVE',
        characterId: 'player-1',
        verb: 'FLEE',
        targetId: 'node-corridor',
        mutation: (ctx) => {
          ctx.restraint.bindings['player-1'].level = 'UNRESTRAINED';
        },
      },
      {
        kind: 'MOVE',
        characterId: 'player-1',
        verb: 'FLEE',
        targetId: 'node-corridor',
        mutation: (ctx) => {
          ctx.restraint.bindings['player-1'].level = 'TIED_TO_FIXTURE';
        },
      },
    ];

    const trace = runHeadlessProbe(fixture, steps);

    const w3: WindowSpec = {
      windowId: 'W3_RESTRAINT_VERB',
      openPredicate: (e) => e.canAttemptResult.allowed === true,
      closePredicate: (e) =>
        e.canAttemptResult.allowed === false &&
        e.canAttemptResult.reasonCode === 'RESTRAINT_BINDING',
      receiptRequirement: (t) => t.length === 2,
    };

    expect(() => assertWindowBar(trace, w3)).not.toThrow();
  });

  it('assertWindowBar: passes W4_ATTENTION_LAPSE (open on lapse, close on lapse expiry)', () => {
    const fixture = createSoundproofFixture();
    const steps: HeadlessProbeStep[] = [
      {
        kind: 'INVESTIGATE',
        characterId: 'player-1',
        advanceSeconds: 30, // time 30
        mutation: (ctx) => {
          // Keep warden co-located so observation is solely governed by attention
          ctx.routines = {};
          // Warden has lapse expiring at fictional time 50
          ctx.attention.warden.lapse = { active: true, expiresAtFictionalTime: 50 };
        },
      },
      {
        kind: 'INVESTIGATE',
        characterId: 'player-1',
        advanceSeconds: 30, // time 60 (> 50, lapse expired)
      },
    ];

    const trace = runHeadlessProbe(fixture, steps);

    const w4: WindowSpec = {
      windowId: 'W4_ATTENTION_LAPSE',
      openPredicate: (e) => e.isActionUnobserved === true,
      closePredicate: (e) => e.isActionUnobserved === false,
      expectedSignals: ['muffled_heavy_breathing'],
    };

    expect(() => assertWindowBar(trace, w4)).not.toThrow();
  });

  it('diegetic trace guard: asserts no blueprint internal tokens appear in traces', () => {
    const fixture = createSoundproofFixture();
    const steps: HeadlessProbeStep[] = [
      { kind: 'INVESTIGATE', characterId: 'player-1', advanceSeconds: 60 },
      { kind: 'INVESTIGATE', characterId: 'player-1', advanceSeconds: 60 },
    ];

    const trace = runHeadlessProbe(fixture, steps);
    expect(() => assertDiegeticTraceGuard(trace)).not.toThrow();

    // Injected violation triggers guard
    trace[0].signals = ['violating_varianceBand_leak'];
    expect(() => assertDiegeticTraceGuard(trace)).toThrow(/DIEGETIC TRACE VIOLATION/);

    trace[0].signals = ['violating_periodMinutes_leak'];
    expect(() => assertDiegeticTraceGuard(trace)).toThrow(/DIEGETIC TRACE VIOLATION/);

    trace[0].signals = ['violating_firstFireMinutes_leak'];
    expect(() => assertDiegeticTraceGuard(trace)).toThrow(/DIEGETIC TRACE VIOLATION/);
  });

  it('runHeadlessProbe: does not emit footsteps signal when routine locomotion is blocked/skipped', () => {
    const fixture = createSoundproofFixture();
    // Restrain warden so routine step locomotion is blocked
    fixture.context.restraint.bindings['warden'] = { characterId: 'warden', level: 'TIED_TO_FIXTURE' };

    const steps: HeadlessProbeStep[] = [
      { kind: 'INVESTIGATE', characterId: 'player-1', advanceSeconds: 60 },
    ];

    const trace = runHeadlessProbe(fixture, steps);
    expect(trace[0].routineEvents).toBeDefined();
    expect(trace[0].routineEvents?.[0].skipped?.reasonCode).toBe('RESTRAINT_BINDING');
    // Footsteps should NOT be present in signals
    const footstepsSignals = (trace[0].signals || []).filter((s) => s.startsWith('footsteps_'));
    expect(footstepsSignals).toEqual([]);
  });

  it('negative close direction: failure to close throws WINDOW BAR FAILURE', () => {
    const fixture = createSoundproofFixture();
    const steps: HeadlessProbeStep[] = [
      {
        kind: 'INVESTIGATE',
        characterId: 'player-1',
        advanceSeconds: 30,
        mutation: (ctx) => {
          // Never-ending lapse
          ctx.attention.warden.lapse = { active: true, expiresAtFictionalTime: 999999 };
        },
      },
      {
        kind: 'INVESTIGATE',
        characterId: 'player-1',
        advanceSeconds: 30,
      },
    ];

    const trace = runHeadlessProbe(fixture, steps);
    const wNeverCloses: WindowSpec = {
      windowId: 'W_NEVER_CLOSES',
      openPredicate: (e) => e.isActionUnobserved === true,
      closePredicate: (e) => e.isActionUnobserved === false,
    };

    expect(() => assertWindowBar(trace, wNeverCloses)).toThrow(
      /\[WINDOW BAR FAILURE\] Window 'W_NEVER_CLOSES' close predicate was not satisfied after opening\./
    );
  });
});
