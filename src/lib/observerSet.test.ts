import { describe, it, expect } from 'vitest';
import { computeObserverSet } from './observerSet';
import type { AttentionLedger, WorldObjectLedger } from '../types/worldState';
import type { AcousticMedium } from '../types/vocalization';

describe('computeObserverSet primitive (Discovery 4/6)', () => {
  const defaultTrace = {
    nodeId: 'ward_a',
    medium: 'direct' as AcousticMedium,
    sourceCharacterId: 'char_culprit',
  };

  it('includes co-located character with no attention record (e.g. player character invariant)', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
      char_player: 'ward_a',
      char_npc: 'ward_a',
    };
    const attention: AttentionLedger = {
      char_npc: {
        characterId: 'char_npc',
        attendingTo: null,
        lapse: null,
        distractibility: 0.5,
      },
      // char_player has no record in attention ledger
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention,
      fictionalTime: 100,
    });

    expect(observers).toContain('char_player');
    expect(observers).toContain('char_npc');
    expect(observers).not.toContain('char_culprit');
  });

  it('excludes co-located character with an active lapse', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
      char_attentive: 'ward_a',
      char_lapsed: 'ward_a',
    };
    const attention: AttentionLedger = {
      char_attentive: {
        characterId: 'char_attentive',
        attendingTo: null,
        lapse: null,
        distractibility: 0.5,
      },
      char_lapsed: {
        characterId: 'char_lapsed',
        attendingTo: null,
        lapse: {
          active: true,
          expiresAtFictionalTime: 200,
        },
        distractibility: 0.5,
      },
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention,
      fictionalTime: 100, // 100 < 200 -> lapse is active
    });

    expect(observers).toEqual(['char_attentive']);
  });

  it('excludes character located at a different node', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
      char_nearby: 'ward_a',
      char_distant: 'hallway_b',
    };
    const attention: AttentionLedger = {
      char_nearby: {
        characterId: 'char_nearby',
        attendingTo: null,
        lapse: null,
        distractibility: 0.5,
      },
      char_distant: {
        characterId: 'char_distant',
        attendingTo: null,
        lapse: null,
        distractibility: 0.5,
      },
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention,
      fictionalTime: 50,
    });

    expect(observers).toEqual(['char_nearby']);
  });

  it('includes all co-located characters when attention ledger is empty (CC1 regression guard)', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
      char_alpha: 'ward_a',
      char_beta: 'ward_a',
      char_other_room: 'cell_3',
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention: {},
      fictionalTime: 100,
    });

    expect(observers).toEqual(['char_alpha', 'char_beta']);
  });

  it('excludes sourceCharacterId from witnessing its own trace', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
    };
    const attention: AttentionLedger = {
      char_culprit: {
        characterId: 'char_culprit',
        attendingTo: null,
        lapse: null,
        distractibility: 0.5,
      },
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention,
      fictionalTime: 10,
    });

    expect(observers).toEqual([]);
  });

  it('excludes character whose attendingTo points at a different node (mirrors isObserved)', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
      char_distracted_by_door: 'ward_a',
      char_looking_at_ward: 'ward_a',
    };
    const attention: AttentionLedger = {
      char_distracted_by_door: {
        characterId: 'char_distracted_by_door',
        attendingTo: { kind: 'NODE', id: 'hallway_b' },
        lapse: null,
        distractibility: 0.5,
      },
      char_looking_at_ward: {
        characterId: 'char_looking_at_ward',
        attendingTo: { kind: 'NODE', id: 'ward_a' },
        lapse: null,
        distractibility: 0.5,
      },
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention,
      fictionalTime: 10,
    });

    expect(observers).toEqual(['char_looking_at_ward']);
  });

  it('returns observer IDs sorted lexicographically regardless of input order', () => {
    const characterNodes = {
      zebra: 'ward_a',
      alpha: 'ward_a',
      mike: 'ward_a',
      bravo: 'ward_a',
    };
    const attention: AttentionLedger = {
      zebra: { characterId: 'zebra', attendingTo: null, lapse: null, distractibility: 0.5 },
      alpha: { characterId: 'alpha', attendingTo: null, lapse: null, distractibility: 0.5 },
      mike: { characterId: 'mike', attendingTo: null, lapse: null, distractibility: 0.5 },
      bravo: { characterId: 'bravo', attendingTo: null, lapse: null, distractibility: 0.5 },
    };

    const observers = computeObserverSet(
      { nodeId: 'ward_a', medium: 'direct' },
      { characterNodes, attention, fictionalTime: 0 }
    );

    expect(observers).toEqual(['alpha', 'bravo', 'mike', 'zebra']);
  });

  it('upholds NPC-only invariant: character id with no ledger entry is treated as attending', () => {
    const characterNodes = {
      user_character: 'ward_a',
      npc_with_state: 'ward_a',
    };
    const attention: AttentionLedger = {
      npc_with_state: {
        characterId: 'npc_with_state',
        attendingTo: { kind: 'NODE', id: 'other_room' }, // attending away
        lapse: null,
        distractibility: 0.5,
      },
    };

    const observers = computeObserverSet(
      { nodeId: 'ward_a', medium: 'direct', sourceCharacterId: 'culprit' },
      { characterNodes, attention, fictionalTime: 0 }
    );

    // user_character has no entry, so they are not filtered out by absent state
    expect(observers).toEqual(['user_character']);
  });

  it('includes character attending to sourceCharacterId directly', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
      char_watcher: 'ward_a',
      char_bystander: 'ward_a',
    };
    const attention: AttentionLedger = {
      char_watcher: {
        characterId: 'char_watcher',
        attendingTo: { kind: 'CHARACTER', id: 'char_culprit' },
        lapse: null,
        distractibility: 0.5,
      },
      char_bystander: {
        characterId: 'char_bystander',
        attendingTo: { kind: 'CHARACTER', id: 'someone_else' },
        lapse: null,
        distractibility: 0.5,
      },
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention,
      fictionalTime: 10,
    });

    expect(observers).toEqual(['char_watcher']);
  });

  it('includes character attending to an object carried by sourceCharacterId', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
      char_inspector: 'ward_a',
    };
    const objects: WorldObjectLedger = {
      bloody_knife: {
        objectId: 'bloody_knife',
        name: 'Bloody Knife',
        location: { kind: 'CARRIER', id: 'char_culprit' },
        sizeClass: 'LIGHT',
        affordances: [],
        effects: [],
      },
    };
    const attention: AttentionLedger = {
      char_inspector: {
        characterId: 'char_inspector',
        attendingTo: { kind: 'OBJECT', id: 'bloody_knife' },
        lapse: null,
        distractibility: 0.5,
      },
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention,
      fictionalTime: 10,
      objects,
    });

    expect(observers).toEqual(['char_inspector']);
  });

  it('includes character when lapse is inactive or expired', () => {
    const characterNodes = {
      char_culprit: 'ward_a',
      char_expired: 'ward_a',
      char_inactive: 'ward_a',
    };
    const attention: AttentionLedger = {
      char_expired: {
        characterId: 'char_expired',
        attendingTo: null,
        lapse: {
          active: true,
          expiresAtFictionalTime: 50, // 50 <= 50 -> expired!
        },
        distractibility: 0.5,
      },
      char_inactive: {
        characterId: 'char_inactive',
        attendingTo: null,
        lapse: {
          active: false,
          expiresAtFictionalTime: 200,
        },
        distractibility: 0.5,
      },
    };

    const observers = computeObserverSet(defaultTrace, {
      characterNodes,
      attention,
      fictionalTime: 50,
    });

    expect(observers).toEqual(['char_expired', 'char_inactive']);
  });

  it('returns empty array when trace medium is invalid', () => {
    const characterNodes = {
      char_a: 'ward_a',
    };
    const observers = computeObserverSet(
      { nodeId: 'ward_a', medium: 'telepathic' as unknown as AcousticMedium },
      { characterNodes, attention: {}, fictionalTime: 0 }
    );

    expect(observers).toEqual([]);
  });

  it('handles traces with omitted sourceCharacterId without error', () => {
    const characterNodes = {
      char_a: 'ward_a',
      char_b: 'ward_a',
    };
    const attention: AttentionLedger = {
      char_a: { characterId: 'char_a', attendingTo: null, lapse: null, distractibility: 0.5 },
      char_b: { characterId: 'char_b', attendingTo: null, lapse: null, distractibility: 0.5 },
    };

    const observers = computeObserverSet(
      { nodeId: 'ward_a', medium: 'direct' },
      { characterNodes, attention, fictionalTime: 0 }
    );

    expect(observers).toEqual(['char_a', 'char_b']);
  });
});
