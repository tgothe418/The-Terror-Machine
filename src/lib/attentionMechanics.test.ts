import { describe, it, expect } from 'vitest';
import type { AttemptFilterContext, AttentionState } from '../types/worldState';
import {
  evaluateAttentionTransition,
  applyAttentionTransition,
  isActionUnobserved,
} from './attentionMechanics';

describe('HG4 Packet 3 — Attention Mechanics', () => {
  const createBaseContext = (overrides?: Partial<AttemptFilterContext>): AttemptFilterContext => ({
    restraint: { bindings: {}, locks: {} },
    objects: {
      'knife-1': {
        objectId: 'knife-1',
        name: 'Surgical Scalpel',
        location: { kind: 'NODE', id: 'cell-1' },
        affordances: [],
        sizeClass: 'LIGHT',
        effects: [],
      },
      'box-1': {
        objectId: 'box-1',
        name: 'Supply Box',
        location: { kind: 'NODE', id: 'cell-1' },
        containerState: 'OPEN',
        affordances: [],
        sizeClass: 'STANDARD',
        effects: [],
      },
      'key-1': {
        objectId: 'key-1',
        name: 'Iron Key',
        location: { kind: 'CONTAINER', id: 'box-1' },
        affordances: [],
        sizeClass: 'LIGHT',
        effects: [],
      },
      'far-item': {
        objectId: 'far-item',
        name: 'Generator Lever',
        location: { kind: 'NODE', id: 'hallway-2' },
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
      'warden-1': {
        characterId: 'warden-1',
        attendingTo: null,
        lapse: null,
        distractibility: 0.3,
      },
    },
    routines: {},
    capabilities: {},
    seats: {
      captorCharacterIds: ['guard-1', 'warden-1'],
      preyCharacterIds: ['player-1'],
    },
    fictionalTime: 1000,
    characterNodes: {
      'player-1': 'cell-1',
      'guard-1': 'cell-1',
      'warden-1': 'cell-1',
      'other-npc': 'hallway-2',
    },
    topologyConnections: [
      { fromNodeId: 'cell-1', toNodeId: 'hallway-2', status: 'OPEN' },
    ],
    ...overrides,
  });

  describe('evaluateAttentionTransition', () => {
    it('rejects character not tracked in attention ledger with NOT_AN_NPC', () => {
      const ctx = createBaseContext();
      const res = evaluateAttentionTransition(
        { characterId: 'unknown-char', transition: 'RELEASE' },
        ctx
      );
      expect(res.accepted).toBe(false);
      expect(res.reasonCode).toBe('NOT_AN_NPC');
    });

    it('rejects player character with NOT_AN_NPC (Invariant 6)', () => {
      const ctx = createBaseContext({
        attention: {
          'player-1': {
            characterId: 'player-1',
            attendingTo: null,
            lapse: null,
            distractibility: 0.5,
          },
        },
      });
      const res = evaluateAttentionTransition(
        { characterId: 'player-1', transition: 'RELEASE' },
        ctx
      );
      expect(res.accepted).toBe(false);
      expect(res.reasonCode).toBe('NOT_AN_NPC');
    });

    describe('CAPTURE', () => {
      it('requires target (TARGET_REQUIRED)', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          { characterId: 'guard-1', transition: 'CAPTURE' },
          ctx
        );
        expect(res.accepted).toBe(false);
        expect(res.reasonCode).toBe('TARGET_REQUIRED');
      });

      it('accepts CAPTURE on in-reach object', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          {
            characterId: 'guard-1',
            transition: 'CAPTURE',
            target: { kind: 'OBJECT', id: 'knife-1' },
          },
          ctx
        );
        expect(res.accepted).toBe(true);
        expect(res.reasonCode).toBe('ALLOWED');
      });

      it('denies CAPTURE on out-of-reach object (TARGET_OUT_OF_REACH)', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          {
            characterId: 'guard-1',
            transition: 'CAPTURE',
            target: { kind: 'OBJECT', id: 'far-item' },
          },
          ctx
        );
        expect(res.accepted).toBe(false);
        expect(res.reasonCode).toBe('TARGET_OUT_OF_REACH');
      });

      it('accepts CAPTURE on co-located character', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          {
            characterId: 'guard-1',
            transition: 'CAPTURE',
            target: { kind: 'CHARACTER', id: 'player-1' },
          },
          ctx
        );
        expect(res.accepted).toBe(true);
        expect(res.reasonCode).toBe('ALLOWED');
      });

      it('denies CAPTURE on non-co-located character (TARGET_OUT_OF_REACH)', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          {
            characterId: 'guard-1',
            transition: 'CAPTURE',
            target: { kind: 'CHARACTER', id: 'other-npc' },
          },
          ctx
        );
        expect(res.accepted).toBe(false);
        expect(res.reasonCode).toBe('TARGET_OUT_OF_REACH');
      });

      it('accepts CAPTURE on current node', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          {
            characterId: 'guard-1',
            transition: 'CAPTURE',
            target: { kind: 'NODE', id: 'cell-1' },
          },
          ctx
        );
        expect(res.accepted).toBe(true);
        expect(res.reasonCode).toBe('ALLOWED');
      });

      it('denies CAPTURE on different node (TARGET_OUT_OF_REACH)', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          {
            characterId: 'guard-1',
            transition: 'CAPTURE',
            target: { kind: 'NODE', id: 'hallway-2' },
          },
          ctx
        );
        expect(res.accepted).toBe(false);
        expect(res.reasonCode).toBe('TARGET_OUT_OF_REACH');
      });

      it('denies CAPTURE if already attending to target (ALREADY_IN_STATE)', () => {
        const ctx = createBaseContext({
          attention: {
            'guard-1': {
              characterId: 'guard-1',
              attendingTo: { kind: 'OBJECT', id: 'knife-1' },
              lapse: null,
              distractibility: 0.5,
            },
          },
        });
        const res = evaluateAttentionTransition(
          {
            characterId: 'guard-1',
            transition: 'CAPTURE',
            target: { kind: 'OBJECT', id: 'knife-1' },
          },
          ctx
        );
        expect(res.accepted).toBe(false);
        expect(res.reasonCode).toBe('ALREADY_IN_STATE');
      });
    });

    describe('RELEASE', () => {
      it('accepts RELEASE when attending to target', () => {
        const ctx = createBaseContext({
          attention: {
            'guard-1': {
              characterId: 'guard-1',
              attendingTo: { kind: 'OBJECT', id: 'knife-1' },
              lapse: null,
              distractibility: 0.5,
            },
          },
        });
        const res = evaluateAttentionTransition(
          { characterId: 'guard-1', transition: 'RELEASE' },
          ctx
        );
        expect(res.accepted).toBe(true);
        expect(res.reasonCode).toBe('ALLOWED');
      });

      it('denies RELEASE when already not attending (ALREADY_IN_STATE)', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          { characterId: 'guard-1', transition: 'RELEASE' },
          ctx
        );
        expect(res.accepted).toBe(false);
        expect(res.reasonCode).toBe('ALREADY_IN_STATE');
      });
    });

    describe('DISTRACT', () => {
      it('requires positive durationMinutes (DURATION_REQUIRED)', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          { characterId: 'guard-1', transition: 'DISTRACT' },
          ctx
        );
        expect(res.accepted).toBe(false);
        expect(res.reasonCode).toBe('DURATION_REQUIRED');

        const resZero = evaluateAttentionTransition(
          { characterId: 'guard-1', transition: 'DISTRACT', durationMinutes: 0 },
          ctx
        );
        expect(resZero.accepted).toBe(false);
        expect(resZero.reasonCode).toBe('DURATION_REQUIRED');
      });

      it('accepts DISTRACT with valid durationMinutes', () => {
        const ctx = createBaseContext();
        const res = evaluateAttentionTransition(
          { characterId: 'guard-1', transition: 'DISTRACT', durationMinutes: 5 },
          ctx
        );
        expect(res.accepted).toBe(true);
        expect(res.reasonCode).toBe('ALLOWED');
      });

      it('denies DISTRACT if active lapse is ongoing (ALREADY_IN_STATE)', () => {
        const ctx = createBaseContext({
          fictionalTime: 1000,
          attention: {
            'guard-1': {
              characterId: 'guard-1',
              attendingTo: null,
              lapse: { active: true, expiresAtFictionalTime: 1300 },
              distractibility: 0.5,
            },
          },
        });
        const res = evaluateAttentionTransition(
          { characterId: 'guard-1', transition: 'DISTRACT', durationMinutes: 5 },
          ctx
        );
        expect(res.accepted).toBe(false);
        expect(res.reasonCode).toBe('ALREADY_IN_STATE');
      });

      it('allows DISTRACT if prior lapse has expired based on fictional clock', () => {
        const ctx = createBaseContext({
          fictionalTime: 1300,
          attention: {
            'guard-1': {
              characterId: 'guard-1',
              attendingTo: null,
              lapse: { active: true, expiresAtFictionalTime: 1300 }, // expired at >= 1300
              distractibility: 0.5,
            },
          },
        });
        const res = evaluateAttentionTransition(
          { characterId: 'guard-1', transition: 'DISTRACT', durationMinutes: 3 },
          ctx
        );
        expect(res.accepted).toBe(true);
        expect(res.reasonCode).toBe('ALLOWED');
      });
    });
  });

  describe('applyAttentionTransition', () => {
    it('applies CAPTURE cleanly and without mutating original ledger', () => {
      const original: Record<string, AttentionState> = {
        'guard-1': {
          characterId: 'guard-1',
          attendingTo: null,
          lapse: null,
          distractibility: 0.5,
        },
      };
      const ctx = createBaseContext();
      const updated = applyAttentionTransition(
        original,
        {
          characterId: 'guard-1',
          transition: 'CAPTURE',
          target: { kind: 'OBJECT', id: 'knife-1' },
        },
        ctx
      );

      expect(updated['guard-1'].attendingTo).toEqual({ kind: 'OBJECT', id: 'knife-1' });
      expect(original['guard-1'].attendingTo).toBeNull();
    });

    it('applies RELEASE setting attendingTo to null', () => {
      const original: Record<string, AttentionState> = {
        'guard-1': {
          characterId: 'guard-1',
          attendingTo: { kind: 'OBJECT', id: 'knife-1' },
          lapse: null,
          distractibility: 0.5,
        },
      };
      const ctx = createBaseContext();
      const updated = applyAttentionTransition(
        original,
        { characterId: 'guard-1', transition: 'RELEASE' },
        ctx
      );

      expect(updated['guard-1'].attendingTo).toBeNull();
    });

    it('applies DISTRACT setting lapse expiresAtFictionalTime = fictionalTime + minutes * 60', () => {
      const original: Record<string, AttentionState> = {
        'guard-1': {
          characterId: 'guard-1',
          attendingTo: null,
          lapse: null,
          distractibility: 0.5,
        },
      };
      const ctx = createBaseContext({ fictionalTime: 600 });
      const updated = applyAttentionTransition(
        original,
        { characterId: 'guard-1', transition: 'DISTRACT', durationMinutes: 4 },
        ctx
      );

      expect(updated['guard-1'].lapse).toEqual({
        active: true,
        expiresAtFictionalTime: 600 + 4 * 60, // 840
      });
    });
  });

  describe('isActionUnobserved (Joint Coverage Invariant 4)', () => {
    it('defaults to false on empty attention ledger (CC1 regression guard)', () => {
      const ctx = createBaseContext({ attention: {} });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(false);
      expect(isActionUnobserved({ kind: 'NODE', id: 'cell-1' }, ctx)).toBe(false);
      expect(isActionUnobserved({ kind: 'CHARACTER', id: 'player-1' }, ctx)).toBe(false);
    });

    it('returns false if target node cannot be resolved', () => {
      const ctx = createBaseContext();
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'non-existent' }, ctx)).toBe(false);
    });

    it('returns false when co-located captor is vigilant (attendingTo: null)', () => {
      const ctx = createBaseContext({
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: null,
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(false);
    });

    it('returns false when co-located captor attends to target directly', () => {
      const ctx = createBaseContext({
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: { kind: 'OBJECT', id: 'knife-1' },
            lapse: null,
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(false);
    });

    it('returns false when co-located captor attends to target node', () => {
      const ctx = createBaseContext({
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: { kind: 'NODE', id: 'cell-1' },
            lapse: null,
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(false);
    });

    it('returns false when co-located captor attends to object container', () => {
      const ctx = createBaseContext({
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: { kind: 'OBJECT', id: 'box-1' },
            lapse: null,
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      // key-1 is inside box-1
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'key-1' }, ctx)).toBe(false);
    });

    it('returns false when co-located captor attends to ancestor of multi-nested container', () => {
      const ctx = createBaseContext({
        objects: {
          ...createBaseContext().objects,
          'pouch-1': {
            objectId: 'pouch-1',
            name: 'Leather Pouch',
            location: { kind: 'CONTAINER', id: 'box-1' },
            containerState: 'OPEN',
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
          'gem-1': {
            objectId: 'gem-1',
            name: 'Red Gem',
            location: { kind: 'CONTAINER', id: 'pouch-1' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: { kind: 'OBJECT', id: 'box-1' }, // attending to grandparent container!
            lapse: null,
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      // gem-1 is inside pouch-1 which is inside box-1
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'gem-1' }, ctx)).toBe(false);
    });

    it('returns false when co-located captor attends to carrier of the object', () => {
      const ctx = createBaseContext({
        objects: {
          ...createBaseContext().objects,
          'badge-1': {
            objectId: 'badge-1',
            name: 'Security Badge',
            location: { kind: 'CARRIER', id: 'warden-1' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: { kind: 'CHARACTER', id: 'warden-1' }, // attending to carrier!
            lapse: null,
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'badge-1' }, ctx)).toBe(false);
    });

    it('returns true when co-located captor attends to a different object', () => {
      const ctx = createBaseContext({
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: { kind: 'OBJECT', id: 'box-1' },
            lapse: null,
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      // knife-1 is not box-1
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(true);
    });

    it('returns true when co-located captor has an active distraction lapse', () => {
      const ctx = createBaseContext({
        fictionalTime: 100,
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: { active: true, expiresAtFictionalTime: 200 },
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(true);
    });

    it('returns false when co-located captor distraction lapse has expired', () => {
      const ctx = createBaseContext({
        fictionalTime: 200,
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: { active: true, expiresAtFictionalTime: 200 }, // expired at >= 200
            distractibility: 0.5,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(false);
    });

    it('joint coverage: returns false if 1 of 2 co-located captors is vigilant', () => {
      const ctx = createBaseContext({
        fictionalTime: 100,
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: { active: true, expiresAtFictionalTime: 200 }, // lapsed
            distractibility: 0.5,
          },
          'warden-1': {
            characterId: 'warden-1',
            attendingTo: null, // vigilant!
            lapse: null,
            distractibility: 0.3,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1', 'warden-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(false);
    });

    it('joint coverage: returns true if ALL co-located captors are either lapsed or attending elsewhere', () => {
      const ctx = createBaseContext({
        fictionalTime: 100,
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null,
            lapse: { active: true, expiresAtFictionalTime: 200 }, // lapsed
            distractibility: 0.5,
          },
          'warden-1': {
            characterId: 'warden-1',
            attendingTo: { kind: 'OBJECT', id: 'box-1' }, // attending to different object
            lapse: null,
            distractibility: 0.3,
          },
        },
        seats: {
          captorCharacterIds: ['guard-1', 'warden-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(true);
    });

    it('ignores captors located in a different node', () => {
      const ctx = createBaseContext({
        attention: {
          'guard-1': {
            characterId: 'guard-1',
            attendingTo: null, // vigilant, but in hallway-2!
            lapse: null,
            distractibility: 0.5,
          },
        },
        characterNodes: {
          'player-1': 'cell-1',
          'guard-1': 'hallway-2',
        },
        seats: {
          captorCharacterIds: ['guard-1'],
          preyCharacterIds: ['player-1'],
        },
      });
      expect(isActionUnobserved({ kind: 'OBJECT', id: 'knife-1' }, ctx)).toBe(true);
    });
  });
});
