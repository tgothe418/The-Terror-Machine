import { describe, it, expect } from 'vitest';
import {
  evaluateVerbRestraint,
  evaluateLockState,
  checkRestraint,
  VERB_RESTRAINT_REQUIREMENTS,
} from './restraintMechanics';
import type { AttemptFilterContext } from '../types/worldState';

describe('HG4 Packet 1 — Restraint Mechanics', () => {
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

  describe('evaluateVerbRestraint', () => {
    it('UNRESTRAINED character can attempt all verbs', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'UNRESTRAINED' as const } },
          locks: {},
        },
      };
      expect(evaluateVerbRestraint('prey-1', 'FLEE', ctx).allowed).toBe(true);
      expect(evaluateVerbRestraint('prey-1', 'FORTIFY', ctx).allowed).toBe(true);
      expect(evaluateVerbRestraint('prey-1', 'PICK_LOCK', ctx).allowed).toBe(true);
    });

    it('WRISTS_BOUND_FRONT denies fine-motor verbs (FORTIFY, TRAP, PICK_LOCK)', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'WRISTS_BOUND_FRONT' as const } },
          locks: {},
        },
      };
      expect(evaluateVerbRestraint('prey-1', 'FORTIFY', ctx).allowed).toBe(false);
      expect(evaluateVerbRestraint('prey-1', 'TRAP', ctx).allowed).toBe(false);
      expect(evaluateVerbRestraint('prey-1', 'PICK_LOCK', ctx).allowed).toBe(false);
      expect(evaluateVerbRestraint('prey-1', 'FLEE', ctx).allowed).toBe(true); // Locomotion still works
    });

    it('WRISTS_BOUND_BEHIND denies all manipulation verbs', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'WRISTS_BOUND_BEHIND' as const } },
          locks: {},
        },
      };
      expect(evaluateVerbRestraint('prey-1', 'FORTIFY', ctx).allowed).toBe(false);
      expect(evaluateVerbRestraint('prey-1', 'FLEE', ctx).allowed).toBe(true); // Locomotion still works
    });

    it('TIED_TO_FIXTURE denies locomotion verbs', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'TIED_TO_FIXTURE' as const } },
          locks: {},
        },
      };
      expect(evaluateVerbRestraint('prey-1', 'FLEE', ctx).allowed).toBe(false);
      expect(evaluateVerbRestraint('prey-1', 'INVESTIGATE', ctx).allowed).toBe(false);
    });

    it('FULL_HOGTIE denies all physical verbs except SUBMIT', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'FULL_HOGTIE' as const } },
          locks: {},
        },
      };
      expect(evaluateVerbRestraint('prey-1', 'FLEE', ctx).allowed).toBe(false);
      expect(evaluateVerbRestraint('prey-1', 'FORTIFY', ctx).allowed).toBe(false);
      expect(evaluateVerbRestraint('prey-1', 'SUBMIT', ctx).allowed).toBe(true); // Always available
    });

    it('Unmapped verbs (vocal, PARLEY, WARN) have no restraint gate', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'FULL_HOGTIE' as const } },
          locks: {},
        },
      };
      expect(evaluateVerbRestraint('prey-1', 'PARLEY', ctx).allowed).toBe(true);
      expect(evaluateVerbRestraint('prey-1', 'WARN', ctx).allowed).toBe(true);
    });
  });

  describe('evaluateLockState', () => {
    it('Locked edge returns LOCK reason code', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: {},
          locks: {
            'EDGE:room-cell->room-hallway': {
              targetRef: { kind: 'EDGE' as const, id: 'room-cell->room-hallway' },
              locked: true,
            },
          },
        },
      };
      const result = evaluateLockState({ kind: 'EDGE', id: 'room-cell->room-hallway' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('LOCK');
    });

    it('Unlocked edge returns ALLOWED', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: {},
          locks: {
            'EDGE:room-cell->room-hallway': {
              targetRef: { kind: 'EDGE' as const, id: 'room-cell->room-hallway' },
              locked: false,
            },
          },
        },
      };
      expect(evaluateLockState({ kind: 'EDGE', id: 'room-cell->room-hallway' }, ctx).allowed).toBe(true);
    });

    it('Missing lock state defaults to ALLOWED (additive-only invariant)', () => {
      expect(evaluateLockState({ kind: 'EDGE', id: 'nonexistent-edge' }, baseContext).allowed).toBe(true);
    });
  });

  describe('checkRestraint (composite)', () => {
    it('Composite check: verb allowed but target locked → LOCK failure', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'UNRESTRAINED' as const } },
          locks: {
            'EDGE:room-cell->room-hallway': {
              targetRef: { kind: 'EDGE' as const, id: 'room-cell->room-hallway' },
              locked: true,
            },
          },
        },
      };
      const result = checkRestraint('prey-1', 'FLEE', 'room-hallway', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('LOCK');
    });

    it('Composite check: verb denied by binding → RESTRAINT_BINDING failure', () => {
      const ctx = {
        ...baseContext,
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'TIED_TO_FIXTURE' as const } },
          locks: {},
        },
      };
      const result = checkRestraint('prey-1', 'FLEE', 'room-hallway', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RESTRAINT_BINDING');
    });

    it('Composite check: no restraint data → ALLOWED (additive-only)', () => {
      const result = checkRestraint('prey-1', 'FLEE', 'room-hallway', baseContext);
      expect(result.allowed).toBe(true);
      expect(result.reasonCode).toBe('ALLOWED');
    });

    it('Composite check: container target locked → LOCK failure', () => {
      const ctx: AttemptFilterContext = {
        ...baseContext,
        objects: {
          'chest-1': {
            objectId: 'chest-1',
            name: 'Old Chest',
            location: { kind: 'NODE', id: 'room-cell' },
            containerState: 'CLOSED',
            affordances: ['OPEN'],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
        restraint: {
          bindings: { 'prey-1': { characterId: 'prey-1', level: 'UNRESTRAINED' as const } },
          locks: {
            'CONTAINER:chest-1': {
              targetRef: { kind: 'CONTAINER' as const, id: 'chest-1' },
              locked: true,
              keyObjectId: 'brass-key',
            },
          },
        },
      };
      const result = checkRestraint('prey-1', 'INVESTIGATE', 'chest-1', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('LOCK');
      expect(result.provenance).toContain('Key: brass-key');
    });
  });

  describe('VERB_RESTRAINT_REQUIREMENTS', () => {
    it('All 16 HG2 verbs are mapped or explicitly unmapped', () => {
      const hg2Verbs = [
        'CLOSE_IN',
        'TRAP',
        'DENY',
        'HIDE',
        'FLEE',
        'MISDIRECT',
        'PURSUE_AGENDA',
        'MOURN',
        'PARLEY',
        'FRACTURE',
        'WARN',
        'RECRUIT',
        'FORTIFY',
        'INVESTIGATE',
        'PICK_LOCK',
        'SUBMIT',
      ];
      for (const verb of hg2Verbs) {
        // Vocal verbs and SUBMIT are intentionally unmapped (no restraint gate)
        const vocalVerbs = [
          'PARLEY',
          'WARN',
          'MOURN',
          'RECRUIT',
          'FRACTURE',
          'DENY',
          'MISDIRECT',
          'PURSUE_AGENDA',
        ];
        if (vocalVerbs.includes(verb) || verb === 'SUBMIT') {
          expect(VERB_RESTRAINT_REQUIREMENTS[verb]).toBeUndefined();
        } else {
          expect(VERB_RESTRAINT_REQUIREMENTS[verb]).toBeDefined();
        }
      }
    });
  });
});
