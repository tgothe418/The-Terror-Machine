import { describe, it, expect } from 'vitest';
import { getForgeClueBatteryPrompt } from './extractionContract';
import { ForgeClueBatteryOutputSchema } from '../types/forge';
import { compileClueBatteryResults } from './forgeCompiler';

describe('Forge Clue Battery (Packet D6)', () => {
  describe('getForgeClueBatteryPrompt', () => {
    it('interpolates premise and nodesJson and contains all mandatory clue rules and examples', () => {
      const premise = 'A family trapped in an isolated snowbound lodge.';
      const nodesJson = JSON.stringify([
        { id: 'foyer', label: 'Grand Foyer' },
        { id: 'nursery', label: 'Upstairs Nursery' },
        { id: 'cellar', label: 'Root Cellar' },
      ]);

      const prompt = getForgeClueBatteryPrompt(premise, nodesJson);

      expect(prompt).toContain(premise);
      expect(prompt).toContain(nodesJson);
      expect(prompt).toContain('1 to 3 physical clues');
      expect(prompt).toContain('At least 3 nodes');
      expect(prompt).toContain("Point, don't conclude");
      expect(prompt).toContain('Physically observable');
      expect(prompt).toContain('1–120 characters');
      expect(prompt).toContain("the dead daughter's ghost");
      expect(prompt).toContain('small handprints in dust');
    });
  });

  describe('ForgeClueBatteryOutputSchema', () => {
    it('accepts a valid 2-node / 3-clue payload', () => {
      const validPayload = {
        nodeClues: [
          {
            nodeId: 'nursery',
            clues: [
              { id: 'clue-nursery-1', label: 'small handprints in dust' },
              { id: 'clue-nursery-2', label: 'lullaby music box' },
              { id: 'clue-nursery-3', label: 'cracked porcelain doll' },
            ],
          },
          {
            nodeId: 'foyer',
            clues: [{ id: 'clue-foyer-1', label: 'forced lock' }],
          },
        ],
      };

      const parsed = ForgeClueBatteryOutputSchema.parse(validPayload);
      expect(parsed.nodeClues).toHaveLength(2);
      expect(parsed.nodeClues[0].clues).toHaveLength(3);
    });

    it('rejects a node with 4 clues', () => {
      const invalidPayload = {
        nodeClues: [
          {
            nodeId: 'nursery',
            clues: [
              { id: 'clue-nursery-1', label: 'clue one' },
              { id: 'clue-nursery-2', label: 'clue two' },
              { id: 'clue-nursery-3', label: 'clue three' },
              { id: 'clue-nursery-4', label: 'clue four' },
            ],
          },
        ],
      };

      expect(() => ForgeClueBatteryOutputSchema.parse(invalidPayload)).toThrow();
    });

    it('rejects an empty label', () => {
      const invalidPayload = {
        nodeClues: [
          {
            nodeId: 'nursery',
            clues: [{ id: 'clue-nursery-1', label: '   ' }],
          },
        ],
      };

      expect(() => ForgeClueBatteryOutputSchema.parse(invalidPayload)).toThrow();
    });

    it('rejects a label over 120 characters', () => {
      const invalidPayload = {
        nodeClues: [
          {
            nodeId: 'nursery',
            clues: [{ id: 'clue-nursery-1', label: 'a'.repeat(121) }],
          },
        ],
      };

      expect(() => ForgeClueBatteryOutputSchema.parse(invalidPayload)).toThrow();
    });
  });

  describe('compileClueBatteryResults', () => {
    function makeDraft() {
      return {
        topology: {
          nodeDefinitions: [
            { id: 'foyer', label: 'Grand Foyer' },
            { id: 'nursery', label: 'Upstairs Nursery' },
            { id: 'cellar', label: 'Root Cellar' },
            { id: 'attic', label: 'Dusty Attic' },
          ],
        },
      };
    }

    it('merges clues into the correct node definitions by nodeId and returns the draft', () => {
      const draft = makeDraft();
      const batteryOutput = {
        nodeClues: [
          {
            nodeId: 'foyer',
            clues: [{ id: 'clue-foyer-1', label: 'forced lock' }],
          },
          {
            nodeId: 'nursery',
            clues: [
              { id: 'clue-nursery-1', label: 'small handprints in dust' },
              { id: 'clue-nursery-2', label: 'lullaby music box' },
            ],
          },
          {
            nodeId: 'cellar',
            clues: [{ id: 'clue-cellar-1', label: 'scratches on inside of door' }],
          },
        ],
      };

      const result = compileClueBatteryResults(draft, batteryOutput);
      expect(result).toBe(draft);

      const defs = (draft.topology.nodeDefinitions as Array<{ id: string; clues?: Array<{ id: string; label: string }> }>);
      expect(defs.find((d) => d.id === 'foyer')?.clues).toEqual([
        { id: 'clue-foyer-1', label: 'forced lock' },
      ]);
      expect(defs.find((d) => d.id === 'nursery')?.clues).toEqual([
        { id: 'clue-nursery-1', label: 'small handprints in dust' },
        { id: 'clue-nursery-2', label: 'lullaby music box' },
      ]);
      expect(defs.find((d) => d.id === 'cellar')?.clues).toEqual([
        { id: 'clue-cellar-1', label: 'scratches on inside of door' },
      ]);
      expect(defs.find((d) => d.id === 'attic')?.clues).toBeUndefined();
    });

    it('throws on unknown nodeId', () => {
      const draft = makeDraft();
      const batteryOutput = {
        nodeClues: [
          { nodeId: 'foyer', clues: [{ id: 'clue-foyer-1', label: 'forced lock' }] },
          { nodeId: 'nursery', clues: [{ id: 'clue-nursery-1', label: 'small handprints in dust' }] },
          { nodeId: 'nonexistent', clues: [{ id: 'clue-nonexistent-1', label: 'strange key' }] },
        ],
      };

      expect(() => compileClueBatteryResults(draft, batteryOutput)).toThrow(
        'compileClueBatteryResults: unknown nodeId "nonexistent"'
      );
    });

    it('throws on duplicate clue id across nodes', () => {
      const draft = makeDraft();
      const batteryOutput = {
        nodeClues: [
          { nodeId: 'foyer', clues: [{ id: 'clue-dup-1', label: 'forced lock' }] },
          { nodeId: 'nursery', clues: [{ id: 'clue-dup-1', label: 'small handprints in dust' }] },
          { nodeId: 'cellar', clues: [{ id: 'clue-cellar-1', label: 'scratches on door' }] },
        ],
      };

      expect(() => compileClueBatteryResults(draft, batteryOutput)).toThrow(
        'compileClueBatteryResults: duplicate clue id "clue-dup-1"'
      );
    });

    it('throws on duplicate label (case-insensitive)', () => {
      const draft = makeDraft();
      const batteryOutput = {
        nodeClues: [
          { nodeId: 'foyer', clues: [{ id: 'clue-foyer-1', label: 'Forced Lock' }] },
          { nodeId: 'nursery', clues: [{ id: 'clue-nursery-1', label: '  forced lock  ' }] },
          { nodeId: 'cellar', clues: [{ id: 'clue-cellar-1', label: 'scratches on door' }] },
        ],
      };

      expect(() => compileClueBatteryResults(draft, batteryOutput)).toThrow(
        /compileClueBatteryResults: duplicate clue label/
      );
    });

    it('throws when only 2 nodes carry clues', () => {
      const draft = makeDraft();
      const batteryOutput = {
        nodeClues: [
          { nodeId: 'foyer', clues: [{ id: 'clue-foyer-1', label: 'forced lock' }] },
          { nodeId: 'nursery', clues: [{ id: 'clue-nursery-1', label: 'small handprints in dust' }] },
        ],
      };

      expect(() => compileClueBatteryResults(draft, batteryOutput)).toThrow(
        'compileClueBatteryResults: only 2 node(s) carry clues; at least 3 required'
      );
    });
  });
});
