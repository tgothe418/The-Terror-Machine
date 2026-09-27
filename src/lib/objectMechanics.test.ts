import { describe, it, expect } from 'vitest';
import type { AttemptFilterContext, WorldObjectLedger, RestraintLedger } from '../types/worldState';
import {
  evaluateObjectTransition,
  applyObjectTransition,
  applyLockTransition,
  reachFailureReason,
} from './objectMechanics';
import { resolveObjectNodeId, inReach } from './worldPredicates';

describe('HG4 Packet 2 — Object Mechanics', () => {
  const createBaseContext = (overrides?: Partial<AttemptFilterContext>): AttemptFilterContext => ({
    restraint: { bindings: {}, locks: {} },
    objects: {},
    attention: {},
    routines: {},
    capabilities: {},
    seats: {
      captorCharacterIds: ['captor-1'],
      preyCharacterIds: ['player-1'],
    },
    fictionalTime: 100,
    characterNodes: {
      'player-1': 'node-kitchen',
      'captor-1': 'node-foyer',
    },
    topologyConnections: [
      { fromNodeId: 'node-kitchen', toNodeId: 'node-foyer', status: 'OPEN' },
    ],
    ...overrides,
  });

  describe('reachFailureReason', () => {
    it('returns NOT_AN_OBJECT for non-existent object', () => {
      const ctx = createBaseContext();
      const res = reachFailureReason('player-1', 'nonexistent', ctx);
      expect(res).not.toBeNull();
      expect(res?.code).toBe('NOT_AN_OBJECT');
      expect(res?.provenance).toContain('does not exist in the world ledger');
    });

    it('returns OUT_OF_REACH when character has no node', () => {
      const ctx = createBaseContext({
        objects: {
          'obj-1': {
            objectId: 'obj-1',
            name: 'Knife',
            location: { kind: 'NODE', id: 'node-kitchen' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
        characterNodes: {},
      });
      const res = reachFailureReason('player-1', 'obj-1', ctx);
      expect(res?.code).toBe('OUT_OF_REACH');
      expect(res?.provenance).toContain('has no node');
    });

    it('returns OUT_OF_REACH when object is in another node', () => {
      const ctx = createBaseContext({
        objects: {
          'obj-1': {
            objectId: 'obj-1',
            name: 'Knife',
            location: { kind: 'NODE', id: 'node-foyer' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const res = reachFailureReason('player-1', 'obj-1', ctx);
      expect(res?.code).toBe('OUT_OF_REACH');
      expect(res?.provenance).toContain('in node node-foyer; character is in node-kitchen');
    });

    it('returns CONTAINER_CLOSED when parent container is closed', () => {
      const ctx = createBaseContext({
        objects: {
          safe: {
            objectId: 'safe',
            name: 'Iron Safe',
            location: { kind: 'NODE', id: 'node-kitchen' },
            containerState: 'CLOSED',
            affordances: [],
            sizeClass: 'HEAVY',
            effects: [],
          },
          letter: {
            objectId: 'letter',
            name: 'Letter',
            location: { kind: 'CONTAINER', id: 'safe' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const res = reachFailureReason('player-1', 'letter', ctx);
      expect(res?.code).toBe('CONTAINER_CLOSED');
      expect(res?.provenance).toContain('inside closed container safe');
    });

    it('returns OUT_OF_REACH when carried by another character', () => {
      const ctx = createBaseContext({
        objects: {
          gun: {
            objectId: 'gun',
            name: 'Revolver',
            location: { kind: 'CARRIER', id: 'captor-1' },
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
      });
      const res = reachFailureReason('player-1', 'gun', ctx);
      expect(res?.code).toBe('OUT_OF_REACH');
      expect(res?.provenance).toContain('carried by captor-1');
    });

    it('returns RESTRAINT_BINDING when WRISTS_BOUND_FRONT and object is STANDARD/HEAVY (provenance names sizeClass)', () => {
      const ctx = createBaseContext({
        restraint: {
          bindings: {
            'player-1': { characterId: 'player-1', level: 'WRISTS_BOUND_FRONT' },
          },
          locks: {},
        },
        objects: {
          crowbar: {
            objectId: 'crowbar',
            name: 'Crowbar',
            location: { kind: 'NODE', id: 'node-kitchen' },
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
      });
      const res = reachFailureReason('player-1', 'crowbar', ctx);
      expect(res?.code).toBe('RESTRAINT_BINDING');
      expect(res?.provenance).toContain('STANDARD');
    });

    it('returns RESTRAINT_BINDING when bound behind or hogtied', () => {
      const ctx = createBaseContext({
        restraint: {
          bindings: {
            'player-1': { characterId: 'player-1', level: 'WRISTS_BOUND_BEHIND' },
          },
          locks: {},
        },
        objects: {
          pin: {
            objectId: 'pin',
            name: 'Hairpin',
            location: { kind: 'NODE', id: 'node-kitchen' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const res = reachFailureReason('player-1', 'pin', ctx);
      expect(res?.code).toBe('RESTRAINT_BINDING');
      expect(res?.provenance).toContain('denies object manipulation');
    });

    it('returns CAPABILITY_IMPAIRED when GRIP_COARSE is impaired', () => {
      const ctx = createBaseContext({
        capabilities: {
          'player-1': { impairedCapabilities: ['GRIP_COARSE'] },
        },
        objects: {
          pin: {
            objectId: 'pin',
            name: 'Hairpin',
            location: { kind: 'NODE', id: 'node-kitchen' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const res = reachFailureReason('player-1', 'pin', ctx);
      expect(res?.code).toBe('CAPABILITY_IMPAIRED');
      expect(res?.provenance).toContain('Grip capability impaired for player-1');
    });

    it('returns null when object is fully reachable', () => {
      const ctx = createBaseContext({
        objects: {
          key: {
            objectId: 'key',
            name: 'Brass Key',
            location: { kind: 'NODE', id: 'node-kitchen' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      expect(reachFailureReason('player-1', 'key', ctx)).toBeNull();
    });
  });

  describe('PICKUP', () => {
    it('accepts PICKUP for co-located object, and applyObjectTransition yields CARRIER location leaving original ledger unmutated', () => {
      const initialLedger: WorldObjectLedger = {
        key: {
          objectId: 'key',
          name: 'Brass Key',
          location: { kind: 'NODE', id: 'node-kitchen' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      };
      const ctx = createBaseContext({ objects: initialLedger });
      const proposal = { objectId: 'key', transition: 'PICKUP' as const };

      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(true);
      expect(decision.reasonCode).toBe('ALLOWED');

      const nextLedger = applyObjectTransition(initialLedger, 'player-1', proposal, ctx);
      expect(nextLedger.key.location).toEqual({ kind: 'CARRIER', id: 'player-1' });
      // Immutability: original ledger must remain untouched
      expect(initialLedger.key.location).toEqual({ kind: 'NODE', id: 'node-kitchen' });
    });

    it('denies PICKUP when already carried', () => {
      const ctx = createBaseContext({
        objects: {
          key: {
            objectId: 'key',
            name: 'Brass Key',
            location: { kind: 'CARRIER', id: 'player-1' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const proposal = { objectId: 'key', transition: 'PICKUP' as const };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('ALREADY_IN_STATE');
      expect(decision.provenance).toContain('already carries key');
    });

    it('denies PICKUP when out of reach', () => {
      const ctx = createBaseContext({
        objects: {
          key: {
            objectId: 'key',
            name: 'Brass Key',
            location: { kind: 'NODE', id: 'node-foyer' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const proposal = { objectId: 'key', transition: 'PICKUP' as const };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('OUT_OF_REACH');
    });
  });

  describe('DROP', () => {
    it('accepts DROP when carried and places object in current node', () => {
      const initialLedger: WorldObjectLedger = {
        key: {
          objectId: 'key',
          name: 'Brass Key',
          location: { kind: 'CARRIER', id: 'player-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      };
      const ctx = createBaseContext({ objects: initialLedger });
      const proposal = { objectId: 'key', transition: 'DROP' as const };

      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(true);
      expect(decision.reasonCode).toBe('ALLOWED');

      const nextLedger = applyObjectTransition(initialLedger, 'player-1', proposal, ctx);
      expect(nextLedger.key.location).toEqual({ kind: 'NODE', id: 'node-kitchen' });
      expect(initialLedger.key.location).toEqual({ kind: 'CARRIER', id: 'player-1' });
    });

    it('denies DROP when not carrying the object', () => {
      const ctx = createBaseContext({
        objects: {
          key: {
            objectId: 'key',
            name: 'Brass Key',
            location: { kind: 'NODE', id: 'node-kitchen' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const proposal = { objectId: 'key', transition: 'DROP' as const };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('ALREADY_IN_STATE');
      expect(decision.provenance).toContain('is not carrying key');
    });

    it('denies DROP when character has no node', () => {
      const ctx = createBaseContext({
        characterNodes: {},
        objects: {
          gem: {
            objectId: 'gem',
            name: 'Gem',
            location: { kind: 'CARRIER', id: 'player-1' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const proposal = { objectId: 'gem', transition: 'DROP' as const };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('OUT_OF_REACH');
      expect(decision.provenance).toContain('has no node');
    });
  });

  describe('PLACE_IN', () => {
    it('accepts PLACE_IN when both object and open container are in reach', () => {
      const initialLedger: WorldObjectLedger = {
        gem: {
          objectId: 'gem',
          name: 'Ruby',
          location: { kind: 'CARRIER', id: 'player-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        box: {
          objectId: 'box',
          name: 'Wooden Box',
          location: { kind: 'NODE', id: 'node-kitchen' },
          containerState: 'OPEN',
          affordances: [],
          sizeClass: 'STANDARD',
          effects: [],
        },
      };
      const ctx = createBaseContext({ objects: initialLedger });
      const proposal = {
        objectId: 'gem',
        transition: 'PLACE_IN' as const,
        targetContainerId: 'box',
      };

      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(true);
      expect(decision.reasonCode).toBe('ALLOWED');

      const nextLedger = applyObjectTransition(initialLedger, 'player-1', proposal, ctx);
      expect(nextLedger.gem.location).toEqual({ kind: 'CONTAINER', id: 'box' });
    });

    it('denies PLACE_IN when container is closed', () => {
      const ctx = createBaseContext({
        objects: {
          gem: {
            objectId: 'gem',
            name: 'Ruby',
            location: { kind: 'CARRIER', id: 'player-1' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
          box: {
            objectId: 'box',
            name: 'Wooden Box',
            location: { kind: 'NODE', id: 'node-kitchen' },
            containerState: 'CLOSED',
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
      });
      const proposal = {
        objectId: 'gem',
        transition: 'PLACE_IN' as const,
        targetContainerId: 'box',
      };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('CONTAINER_CLOSED');
    });

    it('denies PLACE_IN when targetContainerId is missing or target is not a container', () => {
      const ctx = createBaseContext({
        objects: {
          gem: {
            objectId: 'gem',
            name: 'Ruby',
            location: { kind: 'CARRIER', id: 'player-1' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
          rock: {
            objectId: 'rock',
            name: 'Rock',
            location: { kind: 'NODE', id: 'node-kitchen' },
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
      });
      // Missing targetContainerId
      const proposalNoTarget = { objectId: 'gem', transition: 'PLACE_IN' as const };
      const d1 = evaluateObjectTransition('player-1', proposalNoTarget, ctx);
      expect(d1.accepted).toBe(false);
      expect(d1.reasonCode).toBe('NOT_A_CONTAINER');

      // Target is not a container (has no containerState)
      const proposalRock = {
        objectId: 'gem',
        transition: 'PLACE_IN' as const,
        targetContainerId: 'rock',
      };
      const d2 = evaluateObjectTransition('player-1', proposalRock, ctx);
      expect(d2.accepted).toBe(false);
      expect(d2.reasonCode).toBe('NOT_A_CONTAINER');
    });

    it('denies PLACE_IN with ALREADY_IN_STATE when object is already in the target container', () => {
      const ctx = createBaseContext({
        objects: {
          gem: {
            objectId: 'gem',
            name: 'Ruby',
            location: { kind: 'CONTAINER', id: 'box' },
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
          box: {
            objectId: 'box',
            name: 'Wooden Box',
            location: { kind: 'NODE', id: 'node-kitchen' },
            containerState: 'OPEN',
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
      });
      const proposal = {
        objectId: 'gem',
        transition: 'PLACE_IN' as const,
        targetContainerId: 'box',
      };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('ALREADY_IN_STATE');
    });

    it('denies PLACE_IN when trying to place an object inside itself', () => {
      const ctx = createBaseContext({
        objects: {
          box: {
            objectId: 'box',
            name: 'Box',
            location: { kind: 'NODE', id: 'node-kitchen' },
            containerState: 'OPEN',
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
      });
      const proposal = { objectId: 'box', transition: 'PLACE_IN' as const, targetContainerId: 'box' };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('NOT_A_CONTAINER');
      expect(decision.provenance).toContain('inside itself');
    });

    it('denies PLACE_IN when placing an ancestor container into its descendant container', () => {
      const ctx = createBaseContext({
        objects: {
          backpack: {
            objectId: 'backpack',
            name: 'Backpack',
            location: { kind: 'NODE', id: 'node-kitchen' },
            containerState: 'OPEN',
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
          pouch: {
            objectId: 'pouch',
            name: 'Pouch',
            location: { kind: 'CONTAINER', id: 'backpack' },
            containerState: 'OPEN',
            affordances: [],
            sizeClass: 'LIGHT',
            effects: [],
          },
        },
      });
      const proposal = { objectId: 'backpack', transition: 'PLACE_IN' as const, targetContainerId: 'pouch' };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('NOT_A_CONTAINER');
      expect(decision.provenance).toContain('descendant');
    });
  });

  describe('OPEN and CLOSE', () => {
    it('opens a closed container and closes an open container', () => {
      const initialLedger: WorldObjectLedger = {
        box: {
          objectId: 'box',
          name: 'Wooden Box',
          location: { kind: 'NODE', id: 'node-kitchen' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'STANDARD',
          effects: [],
        },
      };
      const ctx = createBaseContext({ objects: initialLedger });
      const openProposal = { objectId: 'box', transition: 'OPEN' as const };

      const dOpen = evaluateObjectTransition('player-1', openProposal, ctx);
      expect(dOpen.accepted).toBe(true);
      expect(dOpen.reasonCode).toBe('ALLOWED');

      const openedLedger = applyObjectTransition(initialLedger, 'player-1', openProposal, ctx);
      expect(openedLedger.box.containerState).toBe('OPEN');

      const ctxOpened = createBaseContext({ objects: openedLedger });
      const closeProposal = { objectId: 'box', transition: 'CLOSE' as const };
      const dClose = evaluateObjectTransition('player-1', closeProposal, ctxOpened);
      expect(dClose.accepted).toBe(true);

      const closedLedger = applyObjectTransition(openedLedger, 'player-1', closeProposal, ctxOpened);
      expect(closedLedger.box.containerState).toBe('CLOSED');
    });

    it('denies OPEN when already OPEN with ALREADY_IN_STATE', () => {
      const ctx = createBaseContext({
        objects: {
          box: {
            objectId: 'box',
            name: 'Wooden Box',
            location: { kind: 'NODE', id: 'node-kitchen' },
            containerState: 'OPEN',
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
      });
      const proposal = { objectId: 'box', transition: 'OPEN' as const };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('ALREADY_IN_STATE');
    });

    it('denies OPEN on non-container with NOT_A_CONTAINER', () => {
      const ctx = createBaseContext({
        objects: {
          chair: {
            objectId: 'chair',
            name: 'Wooden Chair',
            location: { kind: 'NODE', id: 'node-kitchen' },
            affordances: [],
            sizeClass: 'STANDARD',
            effects: [],
          },
        },
      });
      const proposal = { objectId: 'chair', transition: 'OPEN' as const };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('NOT_A_CONTAINER');
    });

    it('denies OPEN on locked container with LOCK', () => {
      const ctx = createBaseContext({
        objects: {
          chest: {
            objectId: 'chest',
            name: 'Iron Chest',
            location: { kind: 'NODE', id: 'node-kitchen' },
            containerState: 'CLOSED',
            affordances: [],
            sizeClass: 'HEAVY',
            effects: [],
          },
        },
        restraint: {
          bindings: {},
          locks: {
            'CONTAINER:chest': {
              targetRef: { kind: 'CONTAINER', id: 'chest' },
              locked: true,
              keyObjectId: 'key',
            },
          },
        },
      });
      const proposal = { objectId: 'chest', transition: 'OPEN' as const };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('LOCK');
      expect(decision.provenance).toContain('locked');
    });
  });

  describe('UNLOCK', () => {
    it('accepts UNLOCK when key is carried by actor and applies lock flip in restraint ledger', () => {
      const objects: WorldObjectLedger = {
        chest: {
          objectId: 'chest',
          name: 'Iron Chest',
          location: { kind: 'NODE', id: 'node-kitchen' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        key: {
          objectId: 'key',
          name: 'Iron Key',
          location: { kind: 'CARRIER', id: 'player-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      };
      const restraint: RestraintLedger = {
        bindings: {},
        locks: {
          'CONTAINER:chest': {
            targetRef: { kind: 'CONTAINER', id: 'chest' },
            locked: true,
            keyObjectId: 'key',
          },
        },
      };
      const ctx = createBaseContext({ objects, restraint });
      const proposal = { objectId: 'chest', transition: 'UNLOCK' as const };

      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(true);
      expect(decision.reasonCode).toBe('ALLOWED');

      const nextRestraint = applyLockTransition(restraint, decision);
      expect(nextRestraint.locks['CONTAINER:chest'].locked).toBe(false);
      // Immutability
      expect(restraint.locks['CONTAINER:chest'].locked).toBe(true);
    });

    it('denies UNLOCK when key is inside a closed container with CONTAINER_CLOSED and provenance naming the key', () => {
      const objects: WorldObjectLedger = {
        chest: {
          objectId: 'chest',
          name: 'Iron Chest',
          location: { kind: 'NODE', id: 'node-kitchen' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        safe: {
          objectId: 'safe',
          name: 'Wall Safe',
          location: { kind: 'NODE', id: 'node-kitchen' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        key: {
          objectId: 'key',
          name: 'Iron Key',
          location: { kind: 'CONTAINER', id: 'safe' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      };
      const restraint: RestraintLedger = {
        bindings: {},
        locks: {
          'CONTAINER:chest': {
            targetRef: { kind: 'CONTAINER', id: 'chest' },
            locked: true,
            keyObjectId: 'key',
          },
        },
      };
      const ctx = createBaseContext({ objects, restraint });
      const proposal = { objectId: 'chest', transition: 'UNLOCK' as const };

      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('CONTAINER_CLOSED');
      expect(decision.provenance).toContain('key');
      expect(decision.provenance).toContain('safe');
    });

    it('denies UNLOCK when lock has no keyObjectId with LOCK ("no key authored")', () => {
      const objects: WorldObjectLedger = {
        chest: {
          objectId: 'chest',
          name: 'Iron Chest',
          location: { kind: 'NODE', id: 'node-kitchen' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
      };
      const restraint: RestraintLedger = {
        bindings: {},
        locks: {
          'CONTAINER:chest': {
            targetRef: { kind: 'CONTAINER', id: 'chest' },
            locked: true,
            // keyObjectId omitted
          },
        },
      };
      const ctx = createBaseContext({ objects, restraint });
      const proposal = { objectId: 'chest', transition: 'UNLOCK' as const };

      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('LOCK');
      expect(decision.provenance).toContain('no key authored');
    });

    it('denies UNLOCK when already unlocked with ALREADY_IN_STATE', () => {
      const objects: WorldObjectLedger = {
        chest: {
          objectId: 'chest',
          name: 'Iron Chest',
          location: { kind: 'NODE', id: 'node-kitchen' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        key: {
          objectId: 'key',
          name: 'Iron Key',
          location: { kind: 'CARRIER', id: 'player-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      };
      const restraint: RestraintLedger = {
        bindings: {},
        locks: {
          'CONTAINER:chest': {
            targetRef: { kind: 'CONTAINER', id: 'chest' },
            locked: false,
            keyObjectId: 'key',
          },
        },
      };
      const ctx = createBaseContext({ objects, restraint });
      const proposal = { objectId: 'chest', transition: 'UNLOCK' as const };

      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('ALREADY_IN_STATE');
      expect(decision.provenance).toContain('already unlocked');
    });

    it('denies UNLOCK when target container is out of reach with OUT_OF_REACH', () => {
      const objects: WorldObjectLedger = {
        chest: {
          objectId: 'chest',
          name: 'Iron Chest',
          location: { kind: 'NODE', id: 'node-dungeon' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'HEAVY',
          effects: [],
        },
        key: {
          objectId: 'key',
          name: 'Iron Key',
          location: { kind: 'CARRIER', id: 'player-1' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      };
      const restraint: RestraintLedger = {
        bindings: {},
        locks: {
          'CONTAINER:chest': {
            targetRef: { kind: 'CONTAINER', id: 'chest' },
            locked: true,
            keyObjectId: 'key',
          },
        },
      };
      const ctx = createBaseContext({ objects, restraint });
      const proposal = { objectId: 'chest', transition: 'UNLOCK' as const };
      const decision = evaluateObjectTransition('player-1', proposal, ctx);
      expect(decision.accepted).toBe(false);
      expect(decision.reasonCode).toBe('OUT_OF_REACH');
      expect(decision.provenance).toContain('node-dungeon');
    });
  });

  describe('Carrier mobility and reach semantics', () => {
    it('moves effective node with carrier mobility; non-carrier in same node still cannot reach it', () => {
      const initialLedger: WorldObjectLedger = {
        gem: {
          objectId: 'gem',
          name: 'Ruby',
          location: { kind: 'NODE', id: 'node-kitchen' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
      };
      let ctx = createBaseContext({ objects: initialLedger });

      // Player picks up gem
      const nextLedger = applyObjectTransition(
        initialLedger,
        'player-1',
        { objectId: 'gem', transition: 'PICKUP' },
        ctx
      );
      ctx = { ...ctx, objects: nextLedger };

      // Gem effective node is player's node
      expect(resolveObjectNodeId('gem', ctx.objects, ctx.characterNodes)).toBe('node-kitchen');

      // Player moves to foyer
      ctx = {
        ...ctx,
        characterNodes: {
          'player-1': 'node-foyer',
          'captor-1': 'node-foyer', // Captor is now co-located with player
        },
      };

      // Gem effective node follows carrier to foyer
      expect(resolveObjectNodeId('gem', ctx.objects, ctx.characterNodes)).toBe('node-foyer');

      // Carrier reaches it
      expect(inReach('player-1', 'gem', ctx)).toBe(true);

      // Non-carrier captor in same node CANNOT reach carried object
      expect(inReach('captor-1', 'gem', ctx)).toBe(false);
      const fail = reachFailureReason('captor-1', 'gem', ctx);
      expect(fail?.code).toBe('OUT_OF_REACH');
      expect(fail?.provenance).toContain('carried by player-1');
    });
  });

  describe('Decision ordering and determinism', () => {
    it('evaluating the same proposal list twice yields identical decisions', () => {
      const objects: WorldObjectLedger = {
        key: {
          objectId: 'key',
          name: 'Key',
          location: { kind: 'NODE', id: 'node-kitchen' },
          affordances: [],
          sizeClass: 'LIGHT',
          effects: [],
        },
        box: {
          objectId: 'box',
          name: 'Box',
          location: { kind: 'NODE', id: 'node-kitchen' },
          containerState: 'CLOSED',
          affordances: [],
          sizeClass: 'STANDARD',
          effects: [],
        },
      };
      const ctx = createBaseContext({ objects });

      const proposals = [
        { objectId: 'key', transition: 'PICKUP' as const },
        { objectId: 'box', transition: 'OPEN' as const },
        { objectId: 'key', transition: 'DROP' as const },
      ];

      const pass1 = proposals.map((p) => evaluateObjectTransition('player-1', p, ctx));
      const pass2 = proposals.map((p) => evaluateObjectTransition('player-1', p, ctx));

      expect(pass1).toEqual(pass2);
      expect(pass1[0].accepted).toBe(true);
      expect(pass1[1].accepted).toBe(true);
      expect(pass1[2].accepted).toBe(false); // Can't DROP without carrying yet in pure context
    });
  });
});
