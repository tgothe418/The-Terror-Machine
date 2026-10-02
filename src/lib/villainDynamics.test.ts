import { describe, it, expect } from 'vitest';
import {
  describeVillainDynamics,
  seedVillainRelationshipsFromAnchors,
} from './villainDynamics';
import type {
  CharacterRelationshipState,
  RelationshipIntensity,
  RelationshipKind,
} from '../types/characterRelationships';
import type { ValueAnchor } from '../types/horrorGrammar';

describe('villainDynamics', () => {
  describe('describeVillainDynamics', () => {
    it('returns empty string when villainIds has fewer than 2 IDs or is invalid', () => {
      const records: CharacterRelationshipState = [
        {
          source_character_id: 'char-v1',
          target_character_id: 'char-v2',
          kind: 'HOSTILITY',
          intensity: 2,
        },
      ];

      expect(describeVillainDynamics([], records)).toBe('');
      expect(describeVillainDynamics(['char-v1'], records)).toBe('');
      expect(describeVillainDynamics(null as unknown as string[], records)).toBe('');
      expect(describeVillainDynamics(undefined as unknown as string[], records)).toBe('');
    });

    it('returns empty string when no relationships exist or relevant array is empty', () => {
      expect(describeVillainDynamics(['char-v1', 'char-v2'], [])).toBe('');
      expect(describeVillainDynamics(['char-v1', 'char-v2'], null as unknown as CharacterRelationshipState)).toBe('');
    });

    it('excludes records where either endpoint is not in villainIds', () => {
      const records: CharacterRelationshipState = [
        {
          source_character_id: 'char-v1',
          target_character_id: 'char-survivor',
          kind: 'HOSTILITY',
          intensity: 3,
        },
        {
          source_character_id: 'char-survivor',
          target_character_id: 'char-v2',
          kind: 'FEAR',
          intensity: 2,
        },
        {
          source_character_id: 'char-survivor-1',
          target_character_id: 'char-survivor-2',
          kind: 'TRUST',
          intensity: 2,
        },
      ];

      const result = describeVillainDynamics(['char-v1', 'char-v2'], records);
      expect(result).toBe('');
    });

    it('renders villain dynamics with header and bullet points for all 8 kinds and all intensities', () => {
      const allKinds: RelationshipKind[] = [
        'LOYALTY',
        'DOMINANCE',
        'FEAR',
        'SUSPICION',
        'HOSTILITY',
        'TRUST',
        'DEPENDENCE',
        'LEVERAGE',
      ];

      const expectedReadings: Record<RelationshipKind, Record<RelationshipIntensity, string>> = {
        LOYALTY: {
          3: 'will coordinate without being asked',
          2: 'reliable ally; coordinate when useful',
          1: 'tentative alignment',
        },
        DOMINANCE: {
          3: 'expects obedience; defiance will be punished',
          2: 'dominant; the other defers',
          1: 'jockeying for position',
        },
        FEAR: {
          3: 'terrified; will waver rather than cross',
          2: 'wary; avoids direct confrontation',
          1: 'uneasy',
        },
        SUSPICION: {
          3: 'actively plotting against',
          2: 'distrusts; verifies before acting',
          1: 'watchful',
        },
        HOSTILITY: {
          3: 'fracture: working at cross-purposes',
          2: 'open conflict likely',
          1: 'friction',
        },
        TRUST: {
          3: 'implicit trust',
          2: 'trusts',
          1: 'cautious trust',
        },
        DEPENDENCE: {
          3: 'cannot act without the other',
          2: 'relies on',
          1: 'leans on',
        },
        LEVERAGE: {
          3: 'owned; will obey',
          2: 'has leverage',
          1: 'minor leverage',
        },
      };

      for (const kind of allKinds) {
        for (const intensity of [1, 2, 3] as RelationshipIntensity[]) {
          const records: CharacterRelationshipState = [
            {
              source_character_id: 'char-v1',
              target_character_id: 'char-v2',
              kind,
              intensity,
            },
          ];

          const output = describeVillainDynamics(['char-v1', 'char-v2'], records);
          const expectedReading = expectedReadings[kind][intensity];
          expect(output).toBe(
            `VILLAIN DYNAMICS (rival predators in play):\n• char-v1 -> char-v2: ${kind} (${intensity}) — ${expectedReading}`
          );
        }
      }
    });

    it('uses nameOf resolver when provided, falls back to raw ID when unmapped or when nameOf throws', () => {
      const records: CharacterRelationshipState = [
        {
          source_character_id: 'char-stalker',
          target_character_id: 'char-overseer',
          kind: 'SUSPICION',
          intensity: 2,
        },
      ];

      const nameMap: Record<string, string> = {
        'char-stalker': 'The Stalker',
      };

      const resolved = describeVillainDynamics(
        ['char-stalker', 'char-overseer'],
        records,
        (id) => nameMap[id] ?? id
      );

      expect(resolved).toContain('• The Stalker -> char-overseer: SUSPICION (2) — distrusts; verifies before acting');

      // Test throwing nameOf resolver
      const faultyResolve = describeVillainDynamics(
        ['char-stalker', 'char-overseer'],
        records,
        () => {
          throw new Error('Resolver crash');
        }
      );
      expect(faultyResolve).toContain('• char-stalker -> char-overseer: SUSPICION (2) — distrusts; verifies before acting');
    });

    it('deterministically sorts output by source_character_id, target_character_id, and kind', () => {
      const records: CharacterRelationshipState = [
        {
          source_character_id: 'char-v2',
          target_character_id: 'char-v1',
          kind: 'FEAR',
          intensity: 1,
        },
        {
          source_character_id: 'char-v1',
          target_character_id: 'char-v2',
          kind: 'SUSPICION',
          intensity: 2,
        },
        {
          source_character_id: 'char-v1',
          target_character_id: 'char-v2',
          kind: 'DOMINANCE',
          intensity: 3,
        },
      ];

      const output = describeVillainDynamics(['char-v1', 'char-v2'], records);
      const lines = output.split('\n');

      expect(lines[0]).toBe('VILLAIN DYNAMICS (rival predators in play):');
      // char-v1 -> char-v2: DOMINANCE comes before char-v1 -> char-v2: SUSPICION alphabetically
      expect(lines[1]).toContain('char-v1 -> char-v2: DOMINANCE (3)');
      expect(lines[2]).toContain('char-v1 -> char-v2: SUSPICION (2)');
      expect(lines[3]).toContain('char-v2 -> char-v1: FEAR (1)');
    });
  });

  describe('seedVillainRelationshipsFromAnchors', () => {
    it('returns empty array when fewer than 2 villain IDs or anchors is invalid', () => {
      const anchors: ValueAnchor[] = [
        {
          id: 'anc-1',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v1', 'char-v2'],
          },
          label: 'Paranoid pact',
          description: 'Deep suspicion and distrust between the two predators.',
          basisSummary: 'They suspect betrayal.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-1', evidenceIds: ['ev-1'] },
        },
      ];

      expect(seedVillainRelationshipsFromAnchors(anchors, [])).toEqual([]);
      expect(seedVillainRelationshipsFromAnchors(anchors, ['char-v1'])).toEqual([]);
      expect(seedVillainRelationshipsFromAnchors(null, ['char-v1', 'char-v2'])).toEqual([]);
      expect(seedVillainRelationshipsFromAnchors(undefined, ['char-v1', 'char-v2'])).toEqual([]);
    });

    it('skips non-RELATIONSHIP holders', () => {
      const anchors = [
        {
          id: 'anc-char',
          holder: { kind: 'CHARACTER' as const, castMemberId: 'char-v1' },
          label: 'Loyal hunter',
          description: 'Devoted predator',
          basisSummary: 'Always loyal',
          provenance: { kind: 'REVIEWED_SOURCE' as const, sourceId: 'src-1', evidenceIds: ['ev-1'] },
        },
        {
          id: 'anc-place',
          holder: { kind: 'PLACE' as const, locationNodeId: 'node-lair' },
          label: 'Terrifying domain',
          description: 'Place of terror and fear',
          basisSummary: 'Afraid to enter',
          provenance: { kind: 'REVIEWED_SOURCE' as const, sourceId: 'src-1', evidenceIds: ['ev-1'] },
        },
      ] as unknown as ValueAnchor[];

      const seeded = seedVillainRelationshipsFromAnchors(anchors, ['char-v1', 'char-v2']);
      expect(seeded).toEqual([]);
    });

    it('skips anchors where either cast member is not a villain', () => {
      const anchors: ValueAnchor[] = [
        {
          id: 'anc-1',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v1', 'char-survivor'],
          },
          label: 'Hostile pursuit',
          description: 'Hatred and enemy tension.',
          basisSummary: 'Open hostility.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-1', evidenceIds: ['ev-1'] },
        },
      ];

      const seeded = seedVillainRelationshipsFromAnchors(anchors, ['char-v1', 'char-v2']);
      expect(seeded).toEqual([]);
    });

    it('correctly maps anchor text keywords to relationship kinds for SUSPICION, FEAR, LOYALTY, and DOMINANCE', () => {
      const anchors: ValueAnchor[] = [
        {
          id: 'anc-loyalty',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v1', 'char-v2'],
          },
          label: 'Blood Oath',
          description: 'A devoted pact between allies.',
          basisSummary: 'Bound as loyal allies in the harvest.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-1', evidenceIds: ['ev-1'] },
        },
        {
          id: 'anc-dominance',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v2', 'char-v3'],
          },
          label: 'Hierarchy of Fear',
          description: 'The master commands; the other must obey and submit to subservient duties.',
          basisSummary: 'Strict dominant control over the secondary hunter.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-2', evidenceIds: ['ev-2'] },
        },
        {
          id: 'anc-fear',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v3', 'char-v1'],
          },
          label: 'Dread of the Patriarch',
          description: 'Living in perpetual terror.',
          basisSummary: 'Deeply afraid of what happens if discovered.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-3', evidenceIds: ['ev-3'] },
        },
        {
          id: 'anc-suspicion',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v1', 'char-v3'],
          },
          label: 'Watched Steps',
          description: 'A wary, paranoid truce.',
          basisSummary: 'Distrust and suspicion keep both on guard.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-4', evidenceIds: ['ev-4'] },
        },
      ];

      const seeded = seedVillainRelationshipsFromAnchors(anchors, ['char-v1', 'char-v2', 'char-v3']);

      expect(seeded).toHaveLength(4);
      expect(seeded[0]).toEqual({
        source_character_id: 'char-v1',
        target_character_id: 'char-v2',
        kind: 'LOYALTY',
        intensity: 2,
      });
      expect(seeded[1]).toEqual({
        source_character_id: 'char-v2',
        target_character_id: 'char-v3',
        kind: 'DOMINANCE',
        intensity: 2,
      });
      expect(seeded[2]).toEqual({
        source_character_id: 'char-v3',
        target_character_id: 'char-v1',
        kind: 'FEAR',
        intensity: 2,
      });
      expect(seeded[3]).toEqual({
        source_character_id: 'char-v1',
        target_character_id: 'char-v3',
        kind: 'SUSPICION',
        intensity: 2,
      });
    });

    it('skips anchors without any keyword match', () => {
      const anchors: ValueAnchor[] = [
        {
          id: 'anc-neutral',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v1', 'char-v2'],
          },
          label: 'Shared workspace',
          description: 'Occupying the same physical sector.',
          basisSummary: 'Coexistence in the morgue.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-1', evidenceIds: ['ev-1'] },
        },
      ];

      const seeded = seedVillainRelationshipsFromAnchors(anchors, ['char-v1', 'char-v2']);
      expect(seeded).toEqual([]);
    });

    it('deduplicates identical source, target, and kind records', () => {
      const anchors: ValueAnchor[] = [
        {
          id: 'anc-1',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v1', 'char-v2'],
          },
          label: 'Shared Loyalty',
          description: 'Devoted alliance.',
          basisSummary: 'Loyal pact.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-1', evidenceIds: ['ev-1'] },
        },
        {
          id: 'anc-2',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v1', 'char-v2'],
          },
          label: 'Second Loyalty Anchor',
          description: 'Still an ally.',
          basisSummary: 'Firmly loyal.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-2', evidenceIds: ['ev-2'] },
        },
      ];

      const seeded = seedVillainRelationshipsFromAnchors(anchors, ['char-v1', 'char-v2']);
      expect(seeded).toHaveLength(1);
      expect(seeded[0]).toEqual({
        source_character_id: 'char-v1',
        target_character_id: 'char-v2',
        kind: 'LOYALTY',
        intensity: 2,
      });
    });

    it('respects keyword priority ordering (first matching keyword wins)', () => {
      // LOYALTY comes before DOMINANCE, HOSTILITY, etc. in KIND_KEYWORDS
      const anchors: ValueAnchor[] = [
        {
          id: 'anc-priority',
          holder: {
            kind: 'RELATIONSHIP',
            castMemberIds: ['char-v1', 'char-v2'],
          },
          label: 'Devoted Servant', // has 'devoted' (LOYALTY) and 'servant' (DOMINANCE)
          description: 'Servant with devoted obedience.',
          basisSummary: 'Master and servant ally.',
          provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-1', evidenceIds: ['ev-1'] },
        },
      ];

      const seeded = seedVillainRelationshipsFromAnchors(anchors, ['char-v1', 'char-v2']);
      expect(seeded).toHaveLength(1);
      expect(seeded[0].kind).toBe('LOYALTY');
    });

    it('ignores malformed anchor objects and invalid castMemberIds gracefully', () => {
      const anchors = [
        null,
        undefined,
        {},
        { holder: { kind: 'RELATIONSHIP', castMemberIds: ['char-v1'] } },
        { holder: { kind: 'RELATIONSHIP', castMemberIds: ['char-v1', 'char-v2', 'char-v3'] } },
        { holder: { kind: 'RELATIONSHIP', castMemberIds: null } },
      ] as unknown as ValueAnchor[];

      const seeded = seedVillainRelationshipsFromAnchors(anchors, ['char-v1', 'char-v2']);
      expect(seeded).toEqual([]);
    });
  });
});
