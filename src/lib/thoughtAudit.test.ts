import { describe, it, expect } from 'vitest';
import { auditThoughts } from './thoughtAudit';

describe('thoughtAudit - auditThoughts', () => {
  describe('empty thoughts and empty receipts', () => {
    it('returns empty array when thoughts is empty string', () => {
      expect(auditThoughts('', {})).toEqual([]);
    });

    it('returns empty array when thoughts is whitespace only', () => {
      expect(auditThoughts('   \t\n  ', {})).toEqual([]);
    });

    it('returns empty array when receipts is null, undefined, or empty object', () => {
      expect(auditThoughts('', null)).toEqual([]);
      expect(auditThoughts('', undefined)).toEqual([]);
      expect(auditThoughts('   ', null)).toEqual([]);
      expect(auditThoughts('   ', undefined)).toEqual([]);
      expect(auditThoughts('', {})).toEqual([]);
    });

    it('handles non-string thoughts gracefully by returning empty array', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(auditThoughts(null as any, {})).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(auditThoughts(undefined as any, {})).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(auditThoughts(12345 as any, {})).toEqual([]);
    });
  });

  describe('thoughts with no proper names or entity IDs', () => {
    it('returns empty array when thoughts contains only common lowercase text', () => {
      const thoughts = 'the player is searching for clues in the dark room. everything seems quiet and calm.';
      expect(auditThoughts(thoughts, {})).toEqual([]);
    });

    it('returns empty array for standard analytical thoughts containing common stopwords', () => {
      const thoughts =
        'Evaluating the current situation. Checking whether any conditions are met. ' +
        'However, nothing unusual was observed. First, we need to inspect the perimeter.';
      expect(auditThoughts(thoughts, {})).toEqual([]);
    });

    it('ignores general English sentences that start with capitalized discourse markers', () => {
      const thoughts =
        'Suddenly, someone opened the door. Perhaps something was left behind. ' +
        'Meanwhile, everyone continued waiting. Summary: action completed successfully.';
      expect(auditThoughts(thoughts, {})).toEqual([]);
    });
  });

  describe('all referenced names match receipts (fully backed)', () => {
    it('returns empty array when all characters, items, and locations match receipt fields', () => {
      const receipts = {
        castMembers: [
          { id: 'char-frank-mercer', name: 'Frank Mercer' },
          { id: 'char-tommy-beck', name: 'Tommy Beck' },
        ],
        locations: [
          { id: 'node_motel_office', title: 'Motel Office' },
        ],
        inventory: [
          { id: 'item_rusty_key', label: 'Rusty Key' },
        ],
      };

      const thoughts =
        'Evaluating char-frank-mercer at node_motel_office with item_rusty_key. ' +
        'Frank Mercer is talking with Tommy Beck at Motel Office.';

      expect(auditThoughts(thoughts, receipts)).toEqual([]);
    });

    it('recognizes single-word character references as backed by full character names', () => {
      const receipts = {
        cast: [
          { id: 'char-frank-mercer', name: 'Frank Mercer' },
          { id: 'char-paula-mercer', name: 'Paula Mercer' },
        ],
      };

      const thoughts = 'Frank is looking for Paula near the entrance.';
      expect(auditThoughts(thoughts, receipts)).toEqual([]);
    });

    it('recognizes proper names backed by snake_case and kebab-case IDs', () => {
      const receipts = {
        nodes: ['node_motel_office'],
        items: ['item_rusty_key'],
        threads: ['thr-1-val-reactor-core'],
      };

      const thoughts = 'Examining Motel Office for the Rusty Key before Reactor Core failure occurs.';
      expect(auditThoughts(thoughts, receipts)).toEqual([]);
    });
  });

  describe('unbacked entity IDs detected', () => {
    it('detects unbacked kebab-case and snake_case entity IDs', () => {
      const receipts = {
        castMembers: [{ id: 'char-frank-mercer' }],
      };

      const thoughts =
        'Checking node_secret_tunnel and char-intruder-99 for presence along thread_ghost_ritual.';

      const result = auditThoughts(thoughts, receipts);
      expect(result).toEqual([
        'char-intruder-99',
        'node_secret_tunnel',
        'thread_ghost_ritual',
      ]);
    });

    it('detects unbacked generic kebab-case IDs with numbers or typical prefixes', () => {
      const receipts = {};
      const thoughts = 'Discovered unbacked_device and prop-12-switch in the area.';

      const result = auditThoughts(thoughts, receipts);
      expect(result).toEqual([
        'prop-12-switch',
        'unbacked_device',
      ]);
    });
  });

  describe('unbacked proper names detected', () => {
    it('detects unbacked multi-word proper names such as Sheriff Daniels and The Blackwood Manor', () => {
      const receipts = {
        castMembers: [{ id: 'char-frank-mercer', name: 'Frank Mercer' }],
      };

      const thoughts = 'Sheriff Daniels arrived outside The Blackwood Manor to investigate.';
      const result = auditThoughts(thoughts, receipts);

      expect(result).toEqual([
        'Sheriff Daniels',
        'The Blackwood Manor',
      ]);
    });

    it('detects unbacked single-word proper names not in receipts', () => {
      const receipts = {
        cast: [{ name: 'Frank Mercer' }],
      };

      const thoughts = 'Frank saw Gabriel hiding in the shadow of Morwood.';
      const result = auditThoughts(thoughts, receipts);

      expect(result).toEqual([
        'Gabriel',
        'Morwood',
      ]);
    });
  });

  describe('mixed backed and unbacked names and IDs', () => {
    it('filters out backed entities and returns only unbacked entities sorted alphabetically', () => {
      const receipts = {
        cast: [
          { id: 'char-frank-mercer', name: 'Frank Mercer' },
          { id: 'char-tommy-beck', name: 'Tommy Beck' },
        ],
        locations: [
          { id: 'node_motel_office', title: 'Motel Office' },
        ],
      };

      const thoughts =
        'Frank Mercer called Sheriff Daniels about char-tommy-beck and thread_ghost_ritual at node_motel_office.';

      const result = auditThoughts(thoughts, receipts);
      expect(result).toEqual([
        'Sheriff Daniels',
        'thread_ghost_ritual',
      ]);
    });
  });

  describe('deeply nested receipts structure', () => {
    it('deeply traverses TurnReceipts, object ledgers, and transition maps', () => {
      const deepTurnReceipt = {
        characterRelationshipReceipt: {
          version: 1,
          preState: {
            'rel-frank-paula': {
              castMemberIds: ['char-frank-mercer', 'char-paula-mercer'],
              bondType: 'SPOUSE',
            },
          },
          decisions: [
            {
              relationshipId: 'rel-frank-paula',
              reasonCode: 'STANCE_FRICTION',
            },
          ],
          boundedOutChangeIds: [],
        },
        valueStateReceipt: {
          version: 1,
          decisions: [
            {
              anchorId: 'val-reactor-core',
              causeReference: 'act-1-mercer-fuse',
            },
          ],
          boundedOutChangeIds: [],
        },
        worldObjectLedger: {
          'item_rusty_wrench': {
            id: 'item_rusty_wrench',
            label: 'Rusty Wrench',
            locationNodeId: 'node_motel_office',
          },
        },
        situatedPressureReceipt: {
          acceptedThreadId: 'thr-1-val-reactor-core',
          boundedOutChangeIds: ['thr-overflow-dropped'],
        },
        locationTopology: {
          nodes: [
            { id: 'node_motel_office', title: 'Motel Office' },
            { id: 'node_parking_lot', title: 'Parking Lot' },
          ],
        },
      };

      // Thoughts contain both deeply backed references and unbacked references
      const thoughts =
        'Frank Mercer inspected the Rusty Wrench at Motel Office while Paula Mercer observed act-1-mercer-fuse ' +
        'and thr-1-val-reactor-core. However, unbacked_demon and Sheriff Daniels were watching from The Blackwood Manor.';

      const result = auditThoughts(thoughts, deepTurnReceipt);

      expect(result).toEqual([
        'Sheriff Daniels',
        'The Blackwood Manor',
        'unbacked_demon',
      ]);
    });
  });

  describe('edge cases: punctuation, possessives, hyphenated names, casing, duplicates', () => {
    it('handles bracket, paren, and punctuation wrappers around IDs and names', () => {
      const receipts = {
        ids: ['char-frank-mercer', 'node_motel_office'],
      };

      const thoughts =
        'Identified (char-frank-mercer) inside [node_motel_office]! But who is {char-intruder-01}? ' +
        'Did "Sheriff Daniels" sign the log? Yes, (Sheriff Daniels).';

      const result = auditThoughts(thoughts, receipts);

      expect(result).toEqual([
        'char-intruder-01',
        'Sheriff Daniels',
      ]);
    });

    it('handles possessive forms on proper names and entity IDs', () => {
      const receipts = {
        castMembers: [
          { id: 'char-frank-mercer', name: 'Frank Mercer' },
        ],
      };

      // Frank's wrench: Frank is backed, so it does not leak.
      // Sheriff Daniels's badge: Sheriff Daniels is unbacked, so it leaks.
      const thoughts =
        "Frank's wrench was missing from the workshop, and Sheriff Daniels's badge was dropped nearby.";

      const result = auditThoughts(thoughts, receipts);
      expect(result).toEqual([
        'Sheriff Daniels',
      ]);
    });

    it('extracts unbacked character name when possessive references unbacked entity', () => {
      const receipts = {};
      const thoughts = "He noticed Frank's wrench left on the desk.";
      const result = auditThoughts(thoughts, receipts);

      expect(result).toEqual([
        'Frank',
      ]);
    });

    it('handles hyphenated proper names and titles', () => {
      const receipts = {
        names: ['Anne-Marie'],
      };

      const thoughts = 'Anne-Marie consulted with Dr. Jekyll-Hyde regarding the specimen.';
      const result = auditThoughts(thoughts, receipts);

      expect(result).toEqual([
        'Dr. Jekyll-Hyde',
      ]);
    });

    it('handles casing variations between thoughts and receipts', () => {
      const receipts = {
        cast: [{ id: 'char-frank-mercer', name: 'Frank Mercer' }],
        nodes: ['node_motel_office'],
      };

      const thoughts =
        'CHAR-FRANK-MERCER reported to NODE_MOTEL_OFFICE. Meanwhile, UNBACKED_OFFICER was absent.';

      const result = auditThoughts(thoughts, receipts);
      expect(result).toEqual([
        'UNBACKED_OFFICER',
      ]);
    });

    it('deduplicates multiple mentions of the same unbacked name or ID', () => {
      const receipts = {};
      const thoughts =
        'Sheriff Daniels called Sheriff Daniels because Sheriff Daniels was needed. ' +
        'Also node_secret_office and node_secret_office were flagged.';

      const result = auditThoughts(thoughts, receipts);
      expect(result).toEqual([
        'node_secret_office',
        'Sheriff Daniels',
      ]);
    });

    it('handles circular references in receipt structures without stack overflow', () => {
      const circularReceipt: Record<string, unknown> = {
        id: 'node_safe_room',
      };
      circularReceipt.self = circularReceipt;

      const thoughts = 'Resting in node_safe_room while avoiding char-nemesis.';
      const result = auditThoughts(thoughts, circularReceipt);

      expect(result).toEqual([
        'char-nemesis',
      ]);
    });
  });
});
