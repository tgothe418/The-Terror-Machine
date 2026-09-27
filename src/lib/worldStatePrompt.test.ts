import { describe, it, expect } from 'vitest';
import type { AttemptFilterContext, WorldObjectState } from '../types/worldState';
import {
  formatWorldObjectPromptSection,
  composeWorldStatePromptSection,
  OBJECT_SECTION_CHAR_BUDGET,
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
});
