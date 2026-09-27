import { describe, it, expect } from 'vitest';
import type { AttemptFilterContext, WorldObjectState } from '../types/worldState';
import {
  formatWorldObjectPromptSection,
  formatAttentionPromptSection,
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
});
