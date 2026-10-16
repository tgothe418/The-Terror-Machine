import { describe, it, expect } from 'vitest';
import type { Blueprint } from '../types';
import type { ValueAnchor } from '../types/horrorGrammar';
import type { CohortState } from '../types/cohort';
import { resolveVillainOperationalProfile } from './castVillain';
import {
  describeVillainDynamics,
  seedVillainRelationshipsFromAnchors,
} from './villainDynamics';
import {
  resolveSubmitResponder,
  evaluateSubmitResponse,
  applySubmitOutcomeStance,
} from './submitContract';
import {
  computeCharacterSalience,
  salienceBySource,
  formatSomaticStatePrompt,
} from './fearEngine';

const FRANK = 'char-frank-mercer';
const PAULA = 'char-paula-mercer';
const TOMMY = 'char-tommy-beck';

const villains = [
  {
    villainId: FRANK,
    name: 'Frank Mercer',
    operationalProfile: {
      kind: 'APPARATUS' as const,
      name: 'Frank Mercer',
      apparatusControls: [
        {
          id: 'control-1',
          name: 'Master keys',
          kind: 'MECHANICAL' as const,
          affectedNodeIds: [],
          availableActions: ['ACTIVATE' as const],
          status: 'ONLINE' as const,
        },
      ],
      preyCohort: [],
      sadisticDirectives: ['Punish weakness'],
      telemetryFeeds: [],
    },
    castSeedPersona: {
      description: 'Motel owner',
      personality: 'Genial, patient, contemptuous of weakness',
      goals: 'Keep turnover quiet',
      traits: ['Cold Patience'],
    },
  },
  {
    villainId: PAULA,
    name: 'Paula Mercer',
    operationalProfile: {
      kind: 'APPARATUS' as const,
      name: 'Paula Mercer',
      apparatusControls: [
        {
          id: 'control-1',
          name: 'Office ledger',
          kind: 'MECHANICAL' as const,
          affectedNodeIds: [],
          availableActions: ['ACTIVATE' as const],
          status: 'ONLINE' as const,
        },
      ],
      preyCohort: [],
      sadisticDirectives: ['Collect the obedient'],
      telemetryFeeds: [],
    },
    castSeedPersona: {
      description: 'Co-owner',
      personality: 'Warm, meticulous, steel-spined',
      goals: 'Protect the operation',
      traits: ['Bookkeeper\u2019s Memory'],
    },
  },
];

const anchors: ValueAnchor[] = [
  {
    id: 'anchor-loyalty',
    holder: { kind: 'RELATIONSHIP', castMemberIds: [PAULA, FRANK] },
    label: "Paula's loyalty to Frank",
    description: 'Paula is fiercely loyal to Frank and has never wavered.',
    basisSummary: 'Twenty-three years of shared operation.',
    provenance: { kind: 'CREATOR_DEFINED' },
  },
  {
    id: 'anchor-suspicion',
    holder: { kind: 'RELATIONSHIP', castMemberIds: [PAULA, FRANK] },
    label: 'Paula suspects Frank',
    description:
      'Paula suspects Frank has been choosing guests without telling her; she distrusts his secrecy.',
    basisSummary: 'Three vacancies never entered the ledger.',
    provenance: { kind: 'CREATOR_DEFINED' },
  },
];

const submitContracts: Record<string, 'ACCEPT' | 'REJECT' | 'PUNISH' | 'IGNORE'> = {
  [FRANK]: 'PUNISH',
  [PAULA]: 'ACCEPT',
  default: 'REJECT',
};

const castNames = [
  { id: FRANK, name: 'Frank Mercer' },
  { id: PAULA, name: 'Paula Mercer' },
  { id: TOMMY, name: 'Tommy Beck' },
];

const nameOf = (id: string): string =>
  castNames.find((c) => c.id === id)?.name ?? id;

function createMinimalCohortState(): CohortState {
  return {
    status: 'ACTIVE',
    collectivePhase: 'ONSET',
    peakPhase: 'ONSET',
    ratifiedRatchetPhase: 'ONSET',
    successionVulnerabilityWindowRemaining: 0,
    dormantCastCognition: {},
    institutionalMemory: {},
    recentReceipts: [],
    members: {
      [TOMMY]: {
        characterId: TOMMY,
        isSeatHolder: false,
        tenureTurns: 1,
        affinities: {},
        cognition: {
          characterId: TOMMY,
          skepticism: 0.5,
          cognitiveDissonance: 0,
          ingestedEvidenceIds: [],
          hypotheses: {},
        },
        stance: { focus: 'SITUATION', stance: 'SUBMITTED' },
        salience: {
          spike: 0,
          dread: 0,
          preyMode: false,
          threatType: 'life',
          provenance: [],
        },
      },
    },
  };
}

describe('HG4 Packet T1 — Multi-Villain Integration Shakedown', () => {
  describe('1. B2 — per-villain operational profiles', () => {
    it('resolves distinct operational profiles for Frank and Paula and falls back for unknown villain id', () => {
      const bp = { villains } as unknown as Blueprint;

      const frankProfile = resolveVillainOperationalProfile(FRANK, bp);
      expect(frankProfile).toBeDefined();
      expect(frankProfile?.name).toBe('Frank Mercer');
      expect(frankProfile?.apparatusControls?.[0]?.id).toBe('control-1');
      expect(frankProfile?.apparatusControls?.[0]?.name).toBe('Master keys');

      const paulaProfile = resolveVillainOperationalProfile(PAULA, bp);
      expect(paulaProfile).toBeDefined();
      expect(paulaProfile?.name).toBe('Paula Mercer');
      expect(paulaProfile?.apparatusControls?.[0]?.id).toBe('control-1');
      expect(paulaProfile?.apparatusControls?.[0]?.name).toBe('Office ledger');
      expect(paulaProfile).not.toEqual(frankProfile);

      // Unknown villain id falls back to blueprint.antagonistProfile (undefined when absent)
      expect(resolveVillainOperationalProfile('char-unknown', bp)).toBeUndefined();
    });
  });

  describe('2. B3 — villain–villain dynamics', () => {
    it('seeds LOYALTY@2 and SUSPICION@2 from anchors and formats VILLAIN DYNAMICS for 2+ villains', () => {
      const seeded = seedVillainRelationshipsFromAnchors(anchors, [FRANK, PAULA]);
      expect(seeded).toEqual([
        {
          source_character_id: PAULA,
          target_character_id: FRANK,
          kind: 'LOYALTY',
          intensity: 2,
        },
        {
          source_character_id: PAULA,
          target_character_id: FRANK,
          kind: 'SUSPICION',
          intensity: 2,
        },
      ]);

      const dynamics = describeVillainDynamics([FRANK, PAULA], seeded, nameOf);
      expect(dynamics).toContain('VILLAIN DYNAMICS');
      expect(dynamics).toContain('Paula Mercer');
      expect(dynamics).toContain('Frank Mercer');
      expect(dynamics).toContain('LOYALTY');
      expect(dynamics).toContain('SUSPICION');

      expect(describeVillainDynamics([FRANK], seeded, nameOf)).toBe('');
    });
  });

  describe('3. B4 — targeted SUBMIT', () => {
    it('selects co-located responder over roster order, evaluates per-villain contracts, and applies stance immutably', () => {
      const placement: Record<string, string> = {
        [PAULA]: 'office',
        [FRANK]: 'parking_lot',
        [TOMMY]: 'office',
      };

      const responder = resolveSubmitResponder([FRANK, PAULA], TOMMY, placement);
      expect(responder).toEqual({ villainId: PAULA, rank: 0 });

      const paulaOutcome = evaluateSubmitResponse({
        villainId: PAULA,
        submittedCharId: TOMMY,
        submitResponseContract: submitContracts,
        castPlacement: placement,
      });
      expect(paulaOutcome.outcome).toBe('ACCEPT');
      expect(paulaOutcome.targetStancePostState).toBe('WITHDRAWN');

      const frankOutcome = evaluateSubmitResponse({
        villainId: FRANK,
        submittedCharId: TOMMY,
        submitResponseContract: submitContracts,
        castPlacement: { ...placement, [FRANK]: 'office' },
      });
      expect(frankOutcome.outcome).toBe('PUNISH');
      expect(frankOutcome.targetStancePostState).toBe('AFRAID');

      const cohortState = createMinimalCohortState();
      const updatedCohort = applySubmitOutcomeStance(cohortState, TOMMY, 'WITHDRAWN');
      expect(updatedCohort.members[TOMMY].stance).toEqual({
        focus: 'SITUATION',
        stance: 'WITHDRAWN',
      });
      expect(cohortState.members[TOMMY].stance).toEqual({
        focus: 'SITUATION',
        stance: 'SUBMITTED',
      });
    });
  });

  describe('4. B5 — per-villain salience', () => {
    it('tracks sourceId and perceivedSourceId on provenance, aggregates salienceBySource, and formats [FEAR SOURCE]', () => {
      const salience = computeCharacterSalience(
        { spike: 0, dread: 0, threatType: 'life', provenance: [], preyMode: false },
        [
          {
            eventId: 'w1',
            kind: 'wound',
            spikeDelta: 0.6,
            dreadDelta: 0.1,
            turn: 3,
            threatType: 'life',
            sourceId: PAULA,
            perceivedSourceId: PAULA,
          },
        ]
      );

      expect(salience.provenance).toHaveLength(1);
      expect(salience.provenance[0].sourceId).toBe(PAULA);
      expect(salience.provenance[0].perceivedSourceId).toBe(PAULA);

      const bySource = salienceBySource(salience);
      expect(bySource[PAULA]).toBeDefined();
      expect(bySource[PAULA].spike).toBeGreaterThan(0);
      expect(bySource['unknown']).toBeUndefined();

      const prompt = formatSomaticStatePrompt({ [TOMMY]: salience }, castNames, {});
      expect(prompt).toContain('[FEAR SOURCE: Tommy Beck — driven by Paula Mercer]');
    });
  });

  describe('5. Cross-feature loop (the money test)', () => {
    it('chains B4 -> B4 -> B5 -> B5 from submission to fear source prompt attribution', () => {
      // Step 1 (B4): Tommy at Paula's node submits -> resolveSubmitResponder -> PAULA
      const placement: Record<string, string> = {
        [PAULA]: 'office',
        [FRANK]: 'parking_lot',
        [TOMMY]: 'office',
      };
      const responder = resolveSubmitResponder([FRANK, PAULA], TOMMY, placement);
      expect(responder).toEqual({ villainId: PAULA, rank: 0 });

      // Step 2 (B4): Paula's contract evaluates -> ACCEPT / WITHDRAWN; stance applied via applySubmitOutcomeStance
      const submitEval = evaluateSubmitResponse({
        villainId: responder!.villainId,
        submittedCharId: TOMMY,
        submitResponseContract: submitContracts,
        castPlacement: placement,
      });
      expect(submitEval.outcome).toBe('ACCEPT');
      expect(submitEval.targetStancePostState).toBe('WITHDRAWN');

      const initialCohort = createMinimalCohortState();
      const postSubmitCohort = applySubmitOutcomeStance(
        initialCohort,
        TOMMY,
        submitEval.targetStancePostState
      );
      expect(postSubmitCohort.members[TOMMY].stance).toEqual({
        focus: 'SITUATION',
        stance: 'WITHDRAWN',
      });

      // Step 3 (B5): Later, Paula wounds Tommy -> computeCharacterSalience -> salienceBySource -> Paula dominant
      const tommySalience = computeCharacterSalience(
        postSubmitCohort.members[TOMMY].salience,
        [
          {
            eventId: 'w1',
            kind: 'wound',
            spikeDelta: 0.6,
            dreadDelta: 0.1,
            turn: 3,
            threatType: 'life',
            sourceId: PAULA,
            perceivedSourceId: PAULA,
          },
        ]
      );
      const bySource = salienceBySource(tommySalience);
      expect(bySource[PAULA]).toBeDefined();
      expect(bySource[PAULA].spike).toBeGreaterThan(0);
      expect(bySource['unknown']).toBeUndefined();

      // Step 4 (B5): formatSomaticStatePrompt names Paula as Tommy's fear source
      const somaticPrompt = formatSomaticStatePrompt(
        { [TOMMY]: tommySalience },
        castNames,
        {}
      );
      expect(somaticPrompt).toContain(
        '[FEAR SOURCE: Tommy Beck — driven by Paula Mercer]'
      );
    });
  });

  describe('6. Negative control', () => {
    it('returns empty villain dynamics for single villain with empty anchors and null responder when no villain perceives submission', () => {
      const seeded = seedVillainRelationshipsFromAnchors([], [FRANK]);
      expect(seeded).toEqual([]);
      expect(describeVillainDynamics([FRANK], seeded, nameOf)).toBe('');

      const isolatedPlacement: Record<string, string> = {
        [FRANK]: 'parking_lot',
        [PAULA]: 'cellar',
        [TOMMY]: 'office',
      };
      expect(
        resolveSubmitResponder([FRANK, PAULA], TOMMY, isolatedPlacement)
      ).toBeNull();
    });
  });
});
