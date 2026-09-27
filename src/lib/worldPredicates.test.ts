import { describe, it, expect } from 'vitest';
import {
  canAttempt,
  inReach,
  isObserved,
  computeDrift,
  restraintAllowsGrip,
  assertWorldStatePromptBudget,
  runHeadlessProbe,
  resolveObjectNodeId,
} from './worldPredicates';
import type { AttemptFilterContext, RoutineState } from '../types/worldState';

describe('HG4 Packet 0 — World Predicates & Attempt Filter', () => {
  const baseContext: AttemptFilterContext = {
    restraint: { bindings: {}, locks: {} },
    objects: {},
    attention: {},
    routines: {},
    capabilities: {},
    seats: { captorCharacterIds: ['villain-1'], preyCharacterIds: ['prey-1'] },
    fictionalTime: 1000,
    characterNodes: { 'prey-1': 'room-cell', 'villain-1': 'room-cell' },
    topologyConnections: [],
  };

  it('Grip Matrix: binding level × sizeClass', () => {
    expect(restraintAllowsGrip('UNRESTRAINED', 'HEAVY')).toBe(true);
    expect(restraintAllowsGrip('WRISTS_BOUND_FRONT', 'LIGHT')).toBe(true);
    expect(restraintAllowsGrip('WRISTS_BOUND_FRONT', 'STANDARD')).toBe(false);
    expect(restraintAllowsGrip('WRISTS_BOUND_BEHIND', 'LIGHT')).toBe(false);
    expect(restraintAllowsGrip('FULL_HOGTIE', 'LIGHT')).toBe(false);
  });

  it('inReach: rejects co-located object if container is closed', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      objects: {
        'safe-1': {
          objectId: 'safe-1',
          name: 'Safe',
          location: { kind: 'NODE', id: 'room-cell' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        'key-1': {
          objectId: 'key-1',
          name: 'Key',
          location: { kind: 'CONTAINER', id: 'safe-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
    };
    expect(inReach('prey-1', 'key-1', ctx)).toBe(false);
    ctx.objects['safe-1'].containerState = 'OPEN';
    expect(inReach('prey-1', 'key-1', ctx)).toBe(true);
  });

  it('inReach: rejects object if physical grip capability is impaired', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      objects: {
        'scalpel-1': {
          objectId: 'scalpel-1',
          name: 'Scalpel',
          location: { kind: 'NODE', id: 'room-cell' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
      capabilities: {
        'prey-1': { impairedCapabilities: ['GRIP_COARSE'] },
      },
    };
    expect(inReach('prey-1', 'scalpel-1', ctx)).toBe(false);
  });

  it('inReach: handles carrier location and missing objects', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      objects: {
        'flask-1': {
          objectId: 'flask-1',
          name: 'Flask',
          location: { kind: 'CARRIER', id: 'prey-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        'other-flask': {
          objectId: 'other-flask',
          name: 'Flask',
          location: { kind: 'CARRIER', id: 'villain-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
    };
    expect(inReach('prey-1', 'flask-1', ctx)).toBe(true);
    expect(inReach('prey-1', 'other-flask', ctx)).toBe(false);
    expect(inReach('prey-1', 'nonexistent', ctx)).toBe(false);
  });

  it('isObserved: defaults to true on empty attention ledger (CC1 regression guard)', () => {
    expect(isObserved({ kind: 'CHARACTER', id: 'prey-1' }, baseContext)).toBe(true);
  });

  it('isObserved: multi-villain joint coverage with active lapses', () => {
    const multiCaptorCtx: AttemptFilterContext = {
      ...baseContext,
      seats: { captorCharacterIds: ['stevie', 'shelly'], preyCharacterIds: ['tess'] },
      characterNodes: { tess: 'room-trailer', stevie: 'room-trailer', shelly: 'room-trailer' },
      attention: {
        stevie: {
          characterId: 'stevie',
          attendingTo: { kind: 'CHARACTER', id: 'tess' },
          lapse: null,
          distractibility: 0.2,
        },
        shelly: {
          characterId: 'shelly',
          attendingTo: { kind: 'CHARACTER', id: 'tess' },
          lapse: { active: true, expiresAtFictionalTime: 1200 },
          distractibility: 0.8,
        },
      },
      fictionalTime: 1050,
    };
    // Shelly has lapse, but Stevie attends → observed
    expect(isObserved({ kind: 'CHARACTER', id: 'tess' }, multiCaptorCtx)).toBe(true);
    // Both lapse → unobserved
    multiCaptorCtx.attention.stevie.lapse = { active: true, expiresAtFictionalTime: 1200 };
    expect(isObserved({ kind: 'CHARACTER', id: 'tess' }, multiCaptorCtx)).toBe(false);
  });

  it('canAttempt: gates locomotion and object interactions', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      restraint: {
        bindings: {
          'prey-1': { characterId: 'prey-1', level: 'WRISTS_BOUND_FRONT' },
        },
        locks: {},
      },
      objects: {
        'rock-1': {
          objectId: 'rock-1',
          name: 'Heavy Rock',
          location: { kind: 'NODE', id: 'room-cell' },
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
      },
    };

    // Can still flee with wrists bound front
    expect(canAttempt('prey-1', 'FLEE', 'room-hall', ctx).allowed).toBe(true);

    // Cannot interact with heavy object when wrists bound front
    const objAttempt = canAttempt('prey-1', 'TAKE', 'rock-1', ctx);
    expect(objAttempt.allowed).toBe(false);
    expect(objAttempt.reasonCode).toBe('OUT_OF_REACH');

    // Tied to fixture denies movement
    ctx.restraint.bindings['prey-1'].level = 'TIED_TO_FIXTURE';
    const moveAttempt = canAttempt('prey-1', 'FLEE', 'room-hall', ctx);
    expect(moveAttempt.allowed).toBe(false);
    expect(moveAttempt.reasonCode).toBe('RESTRAINT_BINDING');

    // Locomotion impairment denies movement
    ctx.restraint.bindings['prey-1'].level = 'UNRESTRAINED';
    ctx.capabilities['prey-1'] = { impairedCapabilities: ['LOCOMOTION_RAPID'] };
    const impairedMove = canAttempt('prey-1', 'FLEE', 'room-hall', ctx);
    expect(impairedMove.allowed).toBe(false);
    expect(impairedMove.reasonCode).toBe('CAPABILITY_IMPAIRED');
  });

  it('computeDrift: clamps modifier sum within variance band', () => {
    const routine: RoutineState = {
      routineId: 'rout-guard',
      characterId: 'villain-1',
      cadence: { periodMinutes: 60, firstFireMinutes: 60 },
      steps: [],
      varianceBand: { minMinutes: -10, maxMinutes: 20 },
      modifiers: [
        { id: 'mod-1', predicate: { kind: 'CO_LOCATION', charA: 'prey-1', charB: 'villain-1' }, deltaMinutes: 15 },
        { id: 'mod-2', predicate: { kind: 'CO_LOCATION', charA: 'prey-1', charB: 'villain-1' }, deltaMinutes: 10 },
      ],
      lastFiredFictionalTime: 0,
    };
    const res = computeDrift(routine, baseContext);
    expect(res.driftMinutes).toBe(20); // 15+10=25, clamped to 20
    expect(res.firedModifierIds).toEqual(['mod-1', 'mod-2']);
  });

  it('computeDrift: deterministic — same state yields same drift (R2)', () => {
    const routine: RoutineState = {
      routineId: 'rout-test',
      characterId: 'villain-1',
      cadence: { periodMinutes: 60, firstFireMinutes: 60 },
      steps: [],
      varianceBand: { minMinutes: 0, maxMinutes: 30 },
      modifiers: [
        { id: 'mod-1', predicate: { kind: 'CO_LOCATION', charA: 'prey-1', charB: 'villain-1' }, deltaMinutes: 5 },
      ],
      lastFiredFictionalTime: 0,
    };
    const a = computeDrift(routine, baseContext);
    const b = computeDrift(routine, baseContext);
    expect(a.driftMinutes).toBe(b.driftMinutes);
    expect(a.firedModifierIds).toEqual(b.firedModifierIds);
  });

  it('computeDrift: clamps to minMinutes and handles RESTRAINT_LEVEL and OBJECT_PRESENT', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      restraint: {
        bindings: {
          'prey-1': { characterId: 'prey-1', level: 'WRISTS_BOUND_BEHIND' },
        },
        locks: {},
      },
      objects: {
        'obj-1': {
          objectId: 'obj-1',
          name: 'Item',
          location: { kind: 'NODE', id: 'room-cell' },
          affordances: [],
          sizeClass: 'STANDARD',
          effects: [],
        },
      },
    };

    const routine: RoutineState = {
      routineId: 'rout-min',
      characterId: 'villain-1',
      cadence: { periodMinutes: 60, firstFireMinutes: 60 },
      steps: [],
      varianceBand: { minMinutes: -5, maxMinutes: 25 },
      modifiers: [
        {
          id: 'mod-restraint',
          predicate: { kind: 'RESTRAINT_LEVEL', characterId: 'prey-1', level: 'WRISTS_BOUND_BEHIND' },
          deltaMinutes: -10,
        },
        {
          id: 'mod-obj',
          predicate: { kind: 'OBJECT_PRESENT', nodeId: 'room-cell', objectId: 'obj-1' },
          deltaMinutes: -2,
        },
      ],
      lastFiredFictionalTime: 0,
    };

    const res = computeDrift(routine, ctx);
    expect(res.driftMinutes).toBe(-5); // -10 + -2 = -12, clamped to minMinutes -5
    expect(res.firedModifierIds).toEqual(['mod-restraint', 'mod-obj']);
  });

  it('resolveObjectNodeId: resolves direct, carrier, and nested container locations safely', () => {
    const objects = {
      'table-1': {
        objectId: 'table-1',
        name: 'Table',
        location: { kind: 'NODE' as const, id: 'room-cell' },
        affordances: [],
        sizeClass: 'HEAVY' as const,
        effects: [],
      },
      'backpack-1': {
        objectId: 'backpack-1',
        name: 'Backpack',
        location: { kind: 'CARRIER' as const, id: 'prey-1' },
        containerState: 'OPEN' as const,
        affordances: [],
        sizeClass: 'STANDARD' as const,
        effects: [],
      },
      'pouch-1': {
        objectId: 'pouch-1',
        name: 'Pouch',
        location: { kind: 'CONTAINER' as const, id: 'backpack-1' },
        containerState: 'OPEN' as const,
        affordances: [],
        sizeClass: 'LIGHT' as const,
        effects: [],
      },
      'gem-1': {
        objectId: 'gem-1',
        name: 'Gem',
        location: { kind: 'CONTAINER' as const, id: 'pouch-1' },
        affordances: [],
        sizeClass: 'LIGHT' as const,
        effects: [],
      },
      'cycle-a': {
        objectId: 'cycle-a',
        name: 'A',
        location: { kind: 'CONTAINER' as const, id: 'cycle-b' },
        affordances: [],
        sizeClass: 'LIGHT' as const,
        effects: [],
      },
      'cycle-b': {
        objectId: 'cycle-b',
        name: 'B',
        location: { kind: 'CONTAINER' as const, id: 'cycle-a' },
        affordances: [],
        sizeClass: 'LIGHT' as const,
        effects: [],
      },
    };
    const charNodes = { 'prey-1': 'room-cell' };

    expect(resolveObjectNodeId('table-1', objects, charNodes)).toBe('room-cell');
    expect(resolveObjectNodeId('backpack-1', objects, charNodes)).toBe('room-cell');
    expect(resolveObjectNodeId('pouch-1', objects, charNodes)).toBe('room-cell');
    expect(resolveObjectNodeId('gem-1', objects, charNodes)).toBe('room-cell');
    expect(resolveObjectNodeId('cycle-a', objects, charNodes)).toBeUndefined();
    expect(resolveObjectNodeId('nonexistent', objects, charNodes)).toBeUndefined();
  });

  it('inReach: handles carried containers, nested containers, and cyclic containers', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      objects: {
        'backpack-1': {
          objectId: 'backpack-1',
          name: 'Backpack',
          location: { kind: 'CARRIER', id: 'prey-1' },
          containerState: 'OPEN',
          affordances: [],
          sizeClass: 'STANDARD',
          effects: [],
        },
        'pen-1': {
          objectId: 'pen-1',
          name: 'Pen',
          location: { kind: 'CONTAINER', id: 'backpack-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        'villain-pouch': {
          objectId: 'villain-pouch',
          name: 'Villain Pouch',
          location: { kind: 'CARRIER', id: 'villain-1' },
          containerState: 'OPEN',
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        'villain-coin': {
          objectId: 'villain-coin',
          name: 'Coin',
          location: { kind: 'CONTAINER', id: 'villain-pouch' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        'chest-1': {
          objectId: 'chest-1',
          name: 'Chest',
          location: { kind: 'NODE', id: 'room-cell' },
          containerState: 'OPEN',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        'box-in-chest': {
          objectId: 'box-in-chest',
          name: 'Box',
          location: { kind: 'CONTAINER', id: 'chest-1' },
          containerState: 'OPEN',
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        'ring-in-box': {
          objectId: 'ring-in-box',
          name: 'Ring',
          location: { kind: 'CONTAINER', id: 'box-in-chest' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
    };

    // Prey can reach pen in own open backpack
    expect(inReach('prey-1', 'pen-1', ctx)).toBe(true);

    // If backpack is closed, prey cannot reach pen
    ctx.objects['backpack-1'].containerState = 'CLOSED';
    expect(inReach('prey-1', 'pen-1', ctx)).toBe(false);
    ctx.objects['backpack-1'].containerState = 'OPEN';

    // Prey cannot reach coin inside villain's pouch
    expect(inReach('prey-1', 'villain-coin', ctx)).toBe(false);

    // Prey can reach ring in nested container (chest -> box -> ring)
    expect(inReach('prey-1', 'ring-in-box', ctx)).toBe(true);

    // If outer chest is closed, ring is unreachable
    ctx.objects['chest-1'].containerState = 'CLOSED';
    expect(inReach('prey-1', 'ring-in-box', ctx)).toBe(false);
  });

  it('isObserved: correctly observes objects in containers and carried by characters', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      seats: { captorCharacterIds: ['villain-1'], preyCharacterIds: ['prey-1'] },
      characterNodes: { 'prey-1': 'room-cell', 'villain-1': 'room-cell' },
      objects: {
        'safe-1': {
          objectId: 'safe-1',
          name: 'Safe',
          location: { kind: 'NODE', id: 'room-cell' },
          containerState: 'OPEN',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        'key-1': {
          objectId: 'key-1',
          name: 'Key',
          location: { kind: 'CONTAINER', id: 'safe-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        'flask-1': {
          objectId: 'flask-1',
          name: 'Flask',
          location: { kind: 'CARRIER', id: 'prey-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
      attention: {
        'villain-1': {
          characterId: 'villain-1',
          attendingTo: null, // general room attention
          lapse: null,
          distractibility: 0.5,
        },
      },
      fictionalTime: 1000,
    };

    // Both key in container and flask on carrier are observed by co-located captor with null attendingTo
    expect(isObserved({ kind: 'OBJECT', id: 'key-1' }, ctx)).toBe(true);
    expect(isObserved({ kind: 'OBJECT', id: 'flask-1' }, ctx)).toBe(true);

    // Captor focused on safe observes key inside it
    ctx.attention['villain-1'].attendingTo = { kind: 'OBJECT', id: 'safe-1' };
    expect(isObserved({ kind: 'OBJECT', id: 'key-1' }, ctx)).toBe(true);

    // Captor focused on prey observes flask carried by prey
    ctx.attention['villain-1'].attendingTo = { kind: 'CHARACTER', id: 'prey-1' };
    expect(isObserved({ kind: 'OBJECT', id: 'flask-1' }, ctx)).toBe(true);

    // Captor focused specifically on a different object (safe) does NOT observe flask
    ctx.attention['villain-1'].attendingTo = { kind: 'OBJECT', id: 'safe-1' };
    expect(isObserved({ kind: 'OBJECT', id: 'flask-1' }, ctx)).toBe(false);

    // Captor in a different room cannot observe the object
    ctx.characterNodes['villain-1'] = 'room-hall';
    expect(isObserved({ kind: 'OBJECT', id: 'key-1' }, ctx)).toBe(false);
  });

  it('computeDrift: matches OBJECT_PRESENT when object is in a container or carried at that node', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      characterNodes: { 'prey-1': 'room-cell', 'villain-1': 'room-cell' },
      objects: {
        'chest-1': {
          objectId: 'chest-1',
          name: 'Chest',
          location: { kind: 'NODE', id: 'room-cell' },
          containerState: 'OPEN',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        'medkit-1': {
          objectId: 'medkit-1',
          name: 'Medkit',
          location: { kind: 'CONTAINER', id: 'chest-1' },
          affordances: [],
          sizeClass: 'STANDARD',
          effects: [],
        },
        'radio-1': {
          objectId: 'radio-1',
          name: 'Radio',
          location: { kind: 'CARRIER', id: 'prey-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
    };

    const routine: RoutineState = {
      routineId: 'rout-obj-presence',
      characterId: 'villain-1',
      cadence: { periodMinutes: 60, firstFireMinutes: 60 },
      steps: [],
      varianceBand: { minMinutes: 0, maxMinutes: 30 },
      modifiers: [
        {
          id: 'mod-container-obj',
          predicate: { kind: 'OBJECT_PRESENT', nodeId: 'room-cell', objectId: 'medkit-1' },
          deltaMinutes: 10,
        },
        {
          id: 'mod-carried-obj',
          predicate: { kind: 'OBJECT_PRESENT', nodeId: 'room-cell', objectId: 'radio-1' },
          deltaMinutes: 5,
        },
      ],
      lastFiredFictionalTime: 0,
    };

    const res = computeDrift(routine, ctx);
    expect(res.driftMinutes).toBe(15);
    expect(res.firedModifierIds).toEqual(['mod-container-obj', 'mod-carried-obj']);
  });

  it('computeDrift: handles RELATIONSHIP_STANCE and CLOCK_PHASE', () => {
    const ctx: AttemptFilterContext = {
      ...baseContext,
      relationships: [
        { charA: 'villain-1', charB: 'prey-1', stance: 'HOSTILE' },
      ],
      clocks: {
        midnight_countdown: 'PHASE_TENSION',
      },
    };

    const routine: RoutineState = {
      routineId: 'rout-rel-clock',
      characterId: 'villain-1',
      cadence: { periodMinutes: 60, firstFireMinutes: 60 },
      steps: [],
      varianceBand: { minMinutes: -10, maxMinutes: 20 },
      modifiers: [
        {
          id: 'mod-rel',
          predicate: { kind: 'RELATIONSHIP_STANCE', charA: 'prey-1', charB: 'villain-1', stance: 'HOSTILE' },
          deltaMinutes: 8,
        },
        {
          id: 'mod-clock',
          predicate: { kind: 'CLOCK_PHASE', clockId: 'midnight_countdown', minPhase: 'PHASE_TENSION' },
          deltaMinutes: 5,
        },
        {
          id: 'mod-mismatch',
          predicate: { kind: 'CLOCK_PHASE', clockId: 'other_clock', minPhase: 'PHASE_TENSION' },
          deltaMinutes: 10,
        },
      ],
    };

    const res = computeDrift(routine, ctx);
    expect(res.driftMinutes).toBe(13); // 8 + 5 = 13
    expect(res.firedModifierIds).toEqual(['mod-rel', 'mod-clock']);
  });

  it('CC2 Ratchet: assertWorldStatePromptBudget enforces character cap', () => {
    expect(() => assertWorldStatePromptBudget('short prompt')).not.toThrow();
    expect(() => assertWorldStatePromptBudget('x'.repeat(1201))).toThrow(/CC2 BUDGET VIOLATION/);
  });

  it('runHeadlessProbe: stub returns empty trace (full impl in P4)', () => {
    expect(runHeadlessProbe({}, [])).toEqual([]);
  });
});
