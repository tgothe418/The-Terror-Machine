import { describe, it, expect } from 'vitest';
import {
  evaluateSubmitResponse,
  canVillainPerceiveSubmission,
  rankSubmissionPerception,
  resolveSubmitResponder,
  isHumanVillainSeat,
  applySubmitOutcomeStance,
} from './submitContract';
import { TopologyConnection } from './cohortBehaviors';
import type { CohortState } from '../types/cohort';
import type { SpatialNode } from '../types';

describe('submitContract - Turn N+1 Villain Response Contract (§5.4)', () => {
  const baseConnections: TopologyConnection[] = [
    { fromNodeId: 'hall-1', toNodeId: 'hall-2', status: 'OPEN', kind: 'DOOR' },
    { fromNodeId: 'hall-2', toNodeId: 'attic', status: 'LOCKED', kind: 'DOOR' },
  ];

  describe('Diegetic Perception Gating', () => {
    it('perceives submission when villain and victim are co-located in the same node', () => {
      const placement = {
        'villain-jason': 'hall-1',
        'victim-dale': 'hall-1',
      };

      const perceivable = canVillainPerceiveSubmission(
        'villain-jason',
        'victim-dale',
        placement,
        baseConnections
      );
      expect(perceivable).toBe(true);

      const result = evaluateSubmitResponse({
        villainId: 'villain-jason',
        submittedCharId: 'victim-dale',
        castPlacement: placement,
        topologyConnections: baseConnections,
      });

      expect(result.canPerceive).toBe(true);
      expect(result.outcome).toBe('REJECT'); // default fallback
    });

    it('perceives submission when villain is in an adjacent node with an OPEN edge', () => {
      const placement = {
        'villain-jason': 'hall-1',
        'victim-dale': 'hall-2',
      };

      const perceivable = canVillainPerceiveSubmission(
        'villain-jason',
        'victim-dale',
        placement,
        baseConnections
      );
      expect(perceivable).toBe(true);
    });

    it('blocks perception when villain is behind a LOCKED door or in a distant node', () => {
      const placement = {
        'villain-jason': 'hall-1',
        'victim-dale': 'attic', // Behind locked door from hall-2, disconnected from hall-1
      };

      const perceivable = canVillainPerceiveSubmission(
        'villain-jason',
        'victim-dale',
        placement,
        baseConnections
      );
      expect(perceivable).toBe(false);

      const result = evaluateSubmitResponse({
        villainId: 'villain-jason',
        submittedCharId: 'victim-dale',
        castPlacement: placement,
        topologyConnections: baseConnections,
      });

      expect(result.canPerceive).toBe(false);
      expect(result.outcome).toBe('UNPERCEIVED');
      expect(result.targetStancePostState).toBe('SUBMITTED');
    });
  });

  describe('Human Villain Decision Presentation (Invariant 6)', () => {
    it('presents choice payload to human villain without overriding player sovereignty', () => {
      const result = evaluateSubmitResponse({
        villainId: 'player-bateman',
        submittedCharId: 'victim-colleague',
        isVillainHuman: true,
      });

      expect(result.canPerceive).toBe(true);
      expect(result.outcome).toBe('AWAITING_HUMAN_CHOICE');
      expect(result.humanPromptPayload).toBeDefined();
      expect(result.humanPromptPayload?.villainId).toBe('player-bateman');
      expect(result.humanPromptPayload?.targetCharacterId).toBe('victim-colleague');
      expect(result.humanPromptPayload?.suggestedOptions.length).toBeGreaterThanOrEqual(4);
      expect(result.targetStancePostState).toBe('SUBMITTED');
    });
  });

  describe('Autonomous NPC Authored Contract Evaluation', () => {
    it('evaluates authored ACCEPT contract: spares victim', () => {
      const result = evaluateSubmitResponse({
        villainId: 'villain-cultist-leader',
        submittedCharId: 'victim-dale',
        submitResponseContract: {
          'villain-cultist-leader': 'ACCEPT',
        },
      });

      expect(result.outcome).toBe('ACCEPT');
      expect(result.targetStancePostState).toBe('WITHDRAWN');
      expect(result.description).toContain('accepting');
    });

    it('evaluates authored PUNISH contract: inflicts calculated harm/humiliation', () => {
      const result = evaluateSubmitResponse({
        villainId: 'villain-inquisitor',
        submittedCharId: 'victim-dale',
        submitResponseContract: {
          'villain-inquisitor': 'PUNISH',
        },
      });

      expect(result.outcome).toBe('PUNISH');
      expect(result.targetStancePostState).toBe('AFRAID');
      expect(result.description).toContain('punishes');
    });

    it('evaluates authored IGNORE contract: steps past victim', () => {
      const result = evaluateSubmitResponse({
        villainId: 'villain-golem',
        submittedCharId: 'victim-dale',
        submitResponseContract: {
          'villain-golem': 'IGNORE',
        },
      });

      expect(result.outcome).toBe('IGNORE');
      expect(result.targetStancePostState).toBe('WITHDRAWN');
      expect(result.description).toContain('contempt');
    });

    it('evaluates authored REJECT contract and defaults to REJECT when unauthored', () => {
      const explicitReject = evaluateSubmitResponse({
        villainId: 'villain-slasher',
        submittedCharId: 'victim-dale',
        submitResponseContract: {
          'villain-slasher': 'REJECT',
        },
      });
      expect(explicitReject.outcome).toBe('REJECT');
      expect(explicitReject.targetStancePostState).toBe('AFRAID');

      const defaultReject = evaluateSubmitResponse({
        villainId: 'villain-unknown',
        submittedCharId: 'victim-dale',
        submitResponseContract: {},
      });
      expect(defaultReject.outcome).toBe('REJECT');
      expect(defaultReject.targetStancePostState).toBe('AFRAID');
    });

    it('evaluates custom authored responses with exact outcome preservation', () => {
      const customResponse = evaluateSubmitResponse({
        villainId: 'villain-overlord',
        submittedCharId: 'victim-dale',
        submitResponseContract: {
          'villain-overlord': 'ENSLAVE',
        },
      });
      expect(customResponse.outcome).toBe('ENSLAVE');
      expect(customResponse.targetStancePostState).toBe('WITHDRAWN');
      expect(customResponse.description).toContain('ENSLAVE');
    });

    it('perceives submission when connection is defined from submitted character node in spatialGraph', () => {
      const spatialGraph = [
        {
          id: 'node-a',
          name: 'Node A',
          description: '',
          exits: [],
        },
        {
          id: 'node-b',
          name: 'Node B',
          description: '',
          exits: [{ description: 'north', targetNodeId: 'node-a', isOpen: true }],
        },
      ];

      const result = evaluateSubmitResponse({
        villainId: 'villain-a',
        submittedCharId: 'victim-b',
        castPlacement: {
          'villain-a': 'node-a',
          'victim-b': 'node-b',
        },
        spatialGraph,
      });

      expect(result.canPerceive).toBe(true);
    });
  });

  describe('rankSubmissionPerception', () => {
    it('returns 0 when villain and submitted character are in the same node', () => {
      const placement = { 'villain-nemesis': 'sanctum', 'char-target': 'sanctum' };
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', placement)).toBe(0);
    });

    it('returns 1 when villain and submitted character are adjacent via OPEN edge', () => {
      const placement = { 'villain-nemesis': 'hall-1', 'char-target': 'hall-2' };
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', placement, baseConnections)).toBe(1);

      // Symmetrical test (reversed direction edge)
      const reverseConnections: TopologyConnection[] = [
        { fromNodeId: 'hall-2', toNodeId: 'hall-1', status: 'OPEN', kind: 'DOOR' },
      ];
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', placement, reverseConnections)).toBe(1);
    });

    it('returns 1 when villain and submitted character are adjacent via open exit in spatialGraph', () => {
      const placement = { 'villain-nemesis': 'room-a', 'char-target': 'room-b' };
      const spatialGraph: SpatialNode[] = [
        { id: 'room-a', name: 'Room A', description: '', exits: [{ targetNodeId: 'room-b', isOpen: true, description: 'Door to Room B' }] },
        { id: 'room-b', name: 'Room B', description: '', exits: [] },
      ];
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', placement, undefined, spatialGraph)).toBe(1);

      // Exit from target to villain
      const reverseGraph: SpatialNode[] = [
        { id: 'room-a', name: 'Room A', description: '', exits: [] },
        { id: 'room-b', name: 'Room B', description: '', exits: [{ targetNodeId: 'room-a', isOpen: true, description: 'Door to Room A' }] },
      ];
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', placement, undefined, reverseGraph)).toBe(1);
    });

    it('returns null when edge is closed or locked', () => {
      const placement = { 'villain-nemesis': 'hall-2', 'char-target': 'attic' };
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', placement, baseConnections)).toBe(null);
    });

    it('returns 0 when no placement map is provided (fallback)', () => {
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', undefined)).toBe(0);
    });

    it('returns 0 when characters are unmapped in placement map (fallback)', () => {
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', { 'villain-nemesis': 'hall-1' })).toBe(0);
      expect(rankSubmissionPerception('villain-nemesis', 'char-target', { 'char-target': 'hall-1' })).toBe(0);
    });
  });

  describe('resolveSubmitResponder', () => {
    it('picks the same-node villain over an adjacent one', () => {
      const placement = {
        'villain-adj': 'hall-1',
        'villain-here': 'hall-2',
        'char-target': 'hall-2',
      };
      // villain-adj is first in roster, but villain-here is in same node (rank 0 vs rank 1)
      const responder = resolveSubmitResponder(
        ['villain-adj', 'villain-here'],
        'char-target',
        placement,
        baseConnections
      );
      expect(responder).toEqual({ villainId: 'villain-here', rank: 0 });
    });

    it('breaks ties using roster order when two villains share the same rank', () => {
      const placement = {
        'villain-first': 'hall-1',
        'villain-second': 'hall-1',
        'char-target': 'hall-1',
      };
      const orderA = resolveSubmitResponder(
        ['villain-first', 'villain-second'],
        'char-target',
        placement,
        baseConnections
      );
      expect(orderA).toEqual({ villainId: 'villain-first', rank: 0 });

      const orderB = resolveSubmitResponder(
        ['villain-second', 'villain-first'],
        'char-target',
        placement,
        baseConnections
      );
      expect(orderB).toEqual({ villainId: 'villain-second', rank: 0 });
    });

    it('returns null when no villain can perceive the submission', () => {
      const placement = {
        'villain-far': 'attic',
        'char-target': 'hall-1',
      };
      const responder = resolveSubmitResponder(
        ['villain-far'],
        'char-target',
        placement,
        baseConnections
      );
      expect(responder).toBeNull();
    });

    it('returns null for an empty villain list or invalid input', () => {
      const placement = { 'char-target': 'hall-1' };
      expect(resolveSubmitResponder([], 'char-target', placement, baseConnections)).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(resolveSubmitResponder(null as any, 'char-target', placement, baseConnections)).toBeNull();
    });
  });

  describe('isHumanVillainSeat', () => {
    it('returns true when mode is villain regardless of seat kind or entity flag', () => {
      expect(isHumanVillainSeat('villain', undefined, false)).toBe(true);
      expect(isHumanVillainSeat('villain', 'force', true)).toBe(true);
      expect(isHumanVillainSeat('villain', 'stalker', false)).toBe(true);
    });

    it('returns true when mode is antagonist with non-force seat and non-entity bound char', () => {
      expect(isHumanVillainSeat('antagonist', 'stalker', false)).toBe(true);
      expect(isHumanVillainSeat('antagonist', undefined, false)).toBe(true);
    });

    it('returns false when mode is antagonist with force seat', () => {
      expect(isHumanVillainSeat('antagonist', 'force', false)).toBe(false);
      expect(isHumanVillainSeat('antagonist', 'force', true)).toBe(false);
    });

    it('returns false when mode is antagonist with entity bound char', () => {
      expect(isHumanVillainSeat('antagonist', 'stalker', true)).toBe(false);
      expect(isHumanVillainSeat('antagonist', undefined, true)).toBe(false);
    });

    it('returns false for other participation modes', () => {
      expect(isHumanVillainSeat('protagonist', undefined, false)).toBe(false);
      expect(isHumanVillainSeat('observer', undefined, false)).toBe(false);
    });

    it('returns false when participation mode is undefined or null', () => {
      expect(isHumanVillainSeat(undefined, undefined, false)).toBe(false);
      expect(isHumanVillainSeat(null, undefined, false)).toBe(false);
    });
  });

  describe('applySubmitOutcomeStance', () => {
    const initialCohort: CohortState = {
      status: 'ACTIVE',
      collectivePhase: 'ONSET',
      peakPhase: 'ONSET',
      ratifiedRatchetPhase: 'ONSET',
      successionVulnerabilityWindowRemaining: 0,
      dormantCastCognition: {},
      institutionalMemory: {},
      recentReceipts: [],
      members: {
        'char-target': {
          characterId: 'char-target',
          isSeatHolder: false,
          tenureTurns: 1,
          affinities: {},
          cognition: {
            characterId: 'char-target',
            skepticism: 0.8,
            cognitiveDissonance: 0,
            ingestedEvidenceIds: [],
            hypotheses: {},
          },
          stance: { focus: 'PLAYER', stance: 'SUBMITTED' },
          salience: { spike: 0, dread: 0, preyMode: false, threatType: 'life', provenance: [] },
        },
      },
    };

    it('sets post-state stance while preserving existing focus', () => {
      const updated = applySubmitOutcomeStance(initialCohort, 'char-target', 'AFRAID');
      expect(updated.members['char-target'].stance).toEqual({
        focus: 'PLAYER',
        stance: 'AFRAID',
      });
    });

    it('defaults focus to SITUATION if focus was missing or non-string', () => {
      const cohortNoFocus: CohortState = {
        ...initialCohort,
        members: {
          'char-target': {
            ...initialCohort.members['char-target'],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stance: { stance: 'SUBMITTED' } as any,
          },
        },
      };
      const updated = applySubmitOutcomeStance(cohortNoFocus, 'char-target', 'WITHDRAWN');
      expect(updated.members['char-target'].stance).toEqual({
        focus: 'SITUATION',
        stance: 'WITHDRAWN',
      });
    });

    it('is a pure function that does not mutate the input state', () => {
      const frozenCohort = Object.freeze(JSON.parse(JSON.stringify(initialCohort)));
      const updated = applySubmitOutcomeStance(frozenCohort, 'char-target', 'GUARDED');
      expect(updated).not.toBe(frozenCohort);
      const updatedStance = updated.members['char-target'].stance;
      expect(typeof updatedStance === 'object' && updatedStance?.stance).toBe('GUARDED');
      const frozenStance = frozenCohort.members['char-target'].stance;
      expect(typeof frozenStance === 'object' && frozenStance?.stance).toBe('SUBMITTED');
    });

    it('returns cohortState unchanged if submittedCharId is unknown', () => {
      const updated = applySubmitOutcomeStance(initialCohort, 'non-existent-char', 'AFRAID');
      expect(updated).toBe(initialCohort);
    });
  });
});
