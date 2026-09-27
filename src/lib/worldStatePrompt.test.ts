import { describe, it, expect } from 'vitest';
import type { AttemptFilterContext, RoutineState, WorldObjectState } from '../types/worldState';
import {
  formatWorldObjectPromptSection,
  formatAttentionPromptSection,
  formatRoutinePromptSection,
  composeWorldStatePromptSection,
  OBJECT_SECTION_CHAR_BUDGET,
  ATTENTION_SECTION_CHAR_BUDGET,
} from './worldStatePrompt';

describe('HG4 Packet 2 — World-State Prompt Section', () => {
  const createBaseContext = (overrides?: Partial<AttemptFilterContext>): AttemptFilterContext => ({
    restraint: { bindings: {}, locks: {} },
    objects: {},
    attention: {},
    routines: {},
    capabilities: {},
    seats: {
      captorCharacterIds: [],
      preyCharacterIds: ['player-1'],
    },
    fictionalTime: 0,
    characterNodes: {
      'player-1': 'node-cell',
    },
    topologyConnections: [],
    ...overrides,
  });

  it('renders empty string for empty ledger', () => {
    const ctx = createBaseContext({ objects: {} });
    expect(formatWorldObjectPromptSection('player-1', ctx)).toBe('');
    expect(composeWorldStatePromptSection('player-1', ctx)).toBe('');
  });

  it('renders in-reach listing sorted by objectId; closed containers render (SIZE, CLOSED)', () => {
    const ctx = createBaseContext({
      objects: {
        'z-chest': {
          objectId: 'z-chest',
          name: 'Heavy Chest',
          location: { kind: 'NODE', id: 'node-cell' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        'a-knife': {
          objectId: 'a-knife',
          name: 'Rusty Knife',
          location: { kind: 'NODE', id: 'node-cell' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        'm-crate': {
          objectId: 'm-crate',
          name: 'Wooden Crate',
          location: { kind: 'NODE', id: 'node-cell' },
          containerState: 'OPEN',
          affordances: [],
          sizeClass: 'STANDARD',
          effects: [],
        },
        'out-of-reach-item': {
          objectId: 'out-of-reach-item',
          name: 'Lantern',
          location: { kind: 'NODE', id: 'node-other' },
          affordances: [],
          sizeClass: 'STANDARD',
          effects: [],
        },
      },
    });

    const result = formatWorldObjectPromptSection('player-1', ctx);
    // a-knife, m-crate, z-chest (sorted alphabetically by objectId)
    expect(result).toBe(
      '[IN REACH: Rusty Knife (LIGHT), Wooden Crate (STANDARD, OPEN), Heavy Chest (HEAVY, CLOSED)]'
    );
    expect(result).not.toContain('Lantern');
  });

  it('enforces budget ratchet on 50 in-reach objects with overflow summary and budget assertion passing', () => {
    const objects: Record<string, WorldObjectState> = {};
    for (let i = 1; i <= 50; i++) {
      const id = `item-${String(i).padStart(3, '0')}`;
      objects[id] = {
        objectId: id,
        name: `Artifact Object Number ${i}`,
        location: { kind: 'NODE', id: 'node-cell' },
        affordances: [],
        sizeClass: 'LIGHT',
        effects: [],
      };
    }

    const ctx = createBaseContext({ objects });
    const formatted = formatWorldObjectPromptSection('player-1', ctx);

    // Overflow suffix matches +\d+ more
    expect(formatted).toMatch(/\+\d+ more\]$/);

    // Extract suffix
    const match = formatted.match(/\+(\d+) more\]$/);
    expect(match).not.toBeNull();
    const omittedCount = parseInt(match![1], 10);
    expect(omittedCount).toBeGreaterThan(0);

    // The length of the item list portion must satisfy budget <= 600
    // format: [IN REACH: <parts><suffix>]
    const prefix = '[IN REACH: ';
    const suffix = ` +${omittedCount} more]`;
    const partsJoined = formatted.slice(prefix.length, formatted.length - suffix.length);
    expect(partsJoined.length).toBeLessThanOrEqual(OBJECT_SECTION_CHAR_BUDGET);

    // composeWorldStatePromptSection calls assertWorldStatePromptBudget and does NOT throw
    expect(() => composeWorldStatePromptSection('player-1', ctx)).not.toThrow();
    const composed = composeWorldStatePromptSection('player-1', ctx);
    expect(composed).toBe(formatted);
  });

  it('produces deterministic prompts from identical context', () => {
    const ctx = createBaseContext({
      objects: {
        'b-item': {
          objectId: 'b-item',
          name: 'B Item',
          location: { kind: 'NODE', id: 'node-cell' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        'a-item': {
          objectId: 'a-item',
          name: 'A Item',
          location: { kind: 'NODE', id: 'node-cell' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      },
    });

    const run1 = composeWorldStatePromptSection('player-1', ctx);
    const run2 = composeWorldStatePromptSection('player-1', ctx);
    expect(run1).toBe(run2);
  });

  describe('HG4 Packet 3 — Attention Prompt Section', () => {
    it('renders empty string when no characters are attending or attention ledger is empty', () => {
      const ctx1 = createBaseContext({ attention: {} });
      expect(formatAttentionPromptSection('player-1', ctx1)).toBe('');

      const ctx2 = createBaseContext({
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: null,
            distractibility: 0.5,
          },
        },
        characterNodes: { 'player-1': 'node-cell', 'guard-1': 'node-cell' },
      });
      expect(formatAttentionPromptSection('player-1', ctx2)).toBe('');
    });

    it('formats co-located attending characters deterministically sorted by characterId', () => {
      const ctx = createBaseContext({
        attention: {
          'z-warden': {
            characterId: 'z-warden',
            attendingTo: { kind: 'OBJECT', id: 'monitor-1' },
            lapse: null,
            distractibility: 0.2,
          },
          'a-guard': {
            characterId: 'a-guard',
            attendingTo: { kind: 'CHARACTER', id: 'player-1' },
            lapse: null,
            distractibility: 0.5,
          },
          'remote-npc': {
            characterId: 'remote-npc',
            attendingTo: { kind: 'NODE', id: 'other-node' },
            lapse: null,
            distractibility: 0.5,
          },
        },
        characterNodes: {
          'player-1': 'node-cell',
          'z-warden': 'node-cell',
          'a-guard': 'node-cell',
          'remote-npc': 'other-node',
        },
      });

      const formatted = formatAttentionPromptSection('player-1', ctx);
      expect(formatted).toBe('[ATTENDED: a-guard → player-1, z-warden → monitor-1]');
      expect(formatted).not.toContain('remote-npc');
    });

    it('enforces ATTENTION_SECTION_CHAR_BUDGET with +N more truncation indicator', () => {
      const attention: Record<string, { characterId: string; attendingTo: { kind: 'OBJECT'; id: string }; lapse: null; distractibility: number }> = {};
      const characterNodes: Record<string, string> = { 'player-1': 'node-cell' };

      for (let i = 1; i <= 30; i++) {
        const charId = `npc-captor-${String(i).padStart(3, '0')}`;
        attention[charId] = {
          characterId: charId,
          attendingTo: { kind: 'OBJECT', id: `target-monitored-device-${i}` },
          lapse: null,
          distractibility: 0.5,
        };
        characterNodes[charId] = 'node-cell';
      }

      const ctx = createBaseContext({ attention, characterNodes });
      const formatted = formatAttentionPromptSection('player-1', ctx);

      expect(formatted).toMatch(/\+\d+ more\]$/);
      const match = formatted.match(/\+(\d+) more\]$/);
      expect(match).not.toBeNull();
      const omitted = parseInt(match![1], 10);
      expect(omitted).toBeGreaterThan(0);

      const prefix = '[ATTENDED: ';
      const suffix = ` +${omitted} more]`;
      const partsJoined = formatted.slice(prefix.length, formatted.length - suffix.length);
      expect(partsJoined.length).toBeLessThanOrEqual(ATTENTION_SECTION_CHAR_BUDGET);
    });

    it('composes objects and attention together within the 1200 character ratchet budget', () => {
      const objects: Record<string, WorldObjectState> = {};
      for (let i = 1; i <= 50; i++) {
        const id = `item-${String(i).padStart(3, '0')}`;
        objects[id] = {
          objectId: id,
          name: `Artifact Object Number ${i}`,
          location: { kind: 'NODE', id: 'node-cell' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        };
      }

      const attention: Record<string, { characterId: string; attendingTo: { kind: 'OBJECT'; id: string }; lapse: null; distractibility: number }> = {};
      const characterNodes: Record<string, string> = { 'player-1': 'node-cell' };
      for (let i = 1; i <= 20; i++) {
        const charId = `npc-${String(i).padStart(3, '0')}`;
        attention[charId] = {
          characterId: charId,
          attendingTo: { kind: 'OBJECT', id: `target-${i}` },
          lapse: null,
          distractibility: 0.5,
        };
        characterNodes[charId] = 'node-cell';
      }

      const ctx = createBaseContext({ objects, attention, characterNodes });
      expect(() => composeWorldStatePromptSection('player-1', ctx)).not.toThrow();

      const composed = composeWorldStatePromptSection('player-1', ctx);
      expect(composed.length).toBeLessThanOrEqual(1200);
      expect(composed).toContain('[IN REACH:');
      expect(composed).toContain('[ATTENDED:');
    });
  });

  describe('HG4 Packet 4 — Routine Prompt Section', () => {
    it('renders empty string when no routines are in context or active', () => {
      const ctx1 = createBaseContext({ routines: {} });
      expect(formatRoutinePromptSection('player-1', ctx1)).toBe('');

      // Routine exists but lastFiredFictionalTime has not occurred
      const ctx2 = createBaseContext({
        routines: {
          'rout-1': {
            routineId: 'rout-1',
            characterId: 'captor-1',
            cadence: { periodMinutes: 10, firstFireMinutes: 10 },
            steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Patrol' }],
            varianceBand: { minMinutes: 0, maxMinutes: 0 },
            modifiers: [],
          },
        },
        characterNodes: { 'player-1': 'node-cell', 'captor-1': 'node-cell' },
      });
      expect(formatRoutinePromptSection('player-1', ctx2)).toBe('');
    });

    it('renders active-routine prompt line for co-located active steps and omits remote ones', () => {
      const ctx = createBaseContext({
        fictionalTime: 660, // 11 minutes
        characterNodes: {
          'player-1': 'node-cell',
          'captor-colocated': 'node-cell',
          'captor-remote': 'node-hall',
        },
        routines: {
          'rout-colocated': {
            routineId: 'rout-colocated',
            characterId: 'captor-colocated',
            cadence: { periodMinutes: 15, firstFireMinutes: 10 },
            steps: [
              { stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Checking cells' },
            ],
            currentStepIndex: 0,
            varianceBand: { minMinutes: 0, maxMinutes: 0 },
            modifiers: [],
            lastFiredFictionalTime: 600, // fired at 10m (600s), duration 5m (ends at 900s), current time 660s -> active!
          },
          'rout-remote': {
            routineId: 'rout-remote',
            characterId: 'captor-remote',
            cadence: { periodMinutes: 15, firstFireMinutes: 10 },
            steps: [
              { stepNumber: 1, nodeId: 'node-hall', durationMinutes: 5, actionSummary: 'Guarding hall' },
            ],
            currentStepIndex: 0,
            varianceBand: { minMinutes: 0, maxMinutes: 0 },
            modifiers: [],
            lastFiredFictionalTime: 600,
          },
        },
      });

      const formatted = formatRoutinePromptSection('player-1', ctx);
      // elapsed = 60s, duration = 300s, remaining = ceil(240/60) = 4m
      expect(formatted).toBe('[ROUTINES: captor-colocated — Checking cells step 1/1 (~4m)]');
      expect(formatted).not.toContain('captor-remote');
    });

    it('omits routines where active step duration has already elapsed', () => {
      const ctx = createBaseContext({
        fictionalTime: 1000, // duration was 300s, fired at 600s, ends at 900s < 1000s
        characterNodes: { 'player-1': 'node-cell', 'captor-1': 'node-cell' },
        routines: {
          'rout-expired': {
            routineId: 'rout-expired',
            characterId: 'captor-1',
            cadence: { periodMinutes: 15, firstFireMinutes: 10 },
            steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Inspection' }],
            currentStepIndex: 0,
            varianceBand: { minMinutes: 0, maxMinutes: 0 },
            modifiers: [],
            lastFiredFictionalTime: 600,
          },
        },
      });

      expect(formatRoutinePromptSection('player-1', ctx)).toBe('');
    });

    it('composes section passing 1200 character budget with pathological input (50 objects, 20 attention records, 12 routines)', () => {
      const objects: Record<string, WorldObjectState> = {};
      for (let i = 1; i <= 50; i++) {
        const id = `item-${String(i).padStart(3, '0')}`;
        objects[id] = {
          objectId: id,
          name: `Pathological World Item #${i} With Long Descriptive Name`,
          location: { kind: 'NODE', id: 'node-cell' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        };
      }

      const attention: Record<string, { characterId: string; attendingTo: { kind: 'OBJECT'; id: string }; lapse: null; distractibility: number }> = {};
      const characterNodes: Record<string, string> = { 'player-1': 'node-cell' };
      for (let i = 1; i <= 20; i++) {
        const charId = `guard-${String(i).padStart(3, '0')}`;
        attention[charId] = {
          characterId: charId,
          attendingTo: { kind: 'OBJECT', id: `target-device-${i}` },
          lapse: null,
          distractibility: 0.5,
        };
        characterNodes[charId] = 'node-cell';
      }

      const routines: Record<string, RoutineState> = {};
      for (let i = 1; i <= 12; i++) {
        const charId = `guard-${String(i).padStart(3, '0')}`;
        routines[`rout-${i}`] = {
          routineId: `rout-${i}`,
          characterId: charId,
          cadence: { periodMinutes: 10, firstFireMinutes: 5 },
          steps: [
            {
              stepNumber: 1,
              nodeId: 'node-cell',
              durationMinutes: 10,
              actionSummary: `Executing heavy security protocol step #${i}`,
            },
          ],
          currentStepIndex: 0,
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
          lastFiredFictionalTime: 300,
        };
      }

      const ctx = createBaseContext({ objects, attention, routines, characterNodes, fictionalTime: 400 });

      // Must not throw budget violation
      expect(() => composeWorldStatePromptSection('player-1', ctx)).not.toThrow();

      const composed = composeWorldStatePromptSection('player-1', ctx);
      expect(composed.length).toBeLessThanOrEqual(1200);
      expect(composed).toContain('[IN REACH:');
      expect(composed).toContain('[ATTENDED:');
      expect(composed).toContain('[ROUTINES:');
      expect(composed).toContain('+'); // overflow truncation triggered
    });

    it('handles undefined currentStepIndex without producing NaN in step index or crashing', () => {
      const routineWithoutCurrentIdx: unknown = {
        routineId: 'rout-noidx',
        characterId: 'captor-1',
        cadence: { periodMinutes: 10, firstFireMinutes: 5 },
        steps: [
          { stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Watching' },
        ],
        varianceBand: { minMinutes: 0, maxMinutes: 0 },
        modifiers: [],
        lastFiredFictionalTime: 300,
      };

      const ctx = createBaseContext({
        fictionalTime: 360,
        characterNodes: { 'player-1': 'node-cell', 'captor-1': 'node-cell' },
        routines: { 'rout-noidx': routineWithoutCurrentIdx as RoutineState },
      });

      const formatted = formatRoutinePromptSection('player-1', ctx);
      expect(formatted).toBe('[ROUTINES: captor-1 — Watching step 1/1 (~4m)]');
      expect(formatted).not.toContain('NaN');
    });

    it('returns empty string when maxBudget is smaller than routine prefix/suffix overhead without throwing', () => {
      const ctx = createBaseContext({
        fictionalTime: 360,
        characterNodes: { 'player-1': 'node-cell', 'captor-1': 'node-cell' },
        routines: {
          'rout-1': {
            routineId: 'rout-1',
            characterId: 'captor-1',
            cadence: { periodMinutes: 10, firstFireMinutes: 5 },
            steps: [{ stepNumber: 1, nodeId: 'node-cell', durationMinutes: 5, actionSummary: 'Watching' }],
            varianceBand: { minMinutes: 0, maxMinutes: 0 },
            modifiers: [],
            lastFiredFictionalTime: 300,
          },
        },
      });

      expect(formatRoutinePromptSection('player-1', ctx, 15)).toBe('');
      expect(formatRoutinePromptSection('player-1', ctx, 0)).toBe('');
    });
  });
});
