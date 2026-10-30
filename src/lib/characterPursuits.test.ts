import { describe, it, expect } from 'vitest';
import {
  createInitialCharacterPursuitLedger,
  resolveCharacterPursuit,
} from './characterPursuits';
import { normalizeBlueprint } from './normalizeBlueprint';
import { Blueprint } from '../types';

describe('characterPursuits unit tests', () => {
  const createMockBlueprint = (): Blueprint =>
    normalizeBlueprint({
      id: 'bp_1',
      title: 'Research Station Epsilon',
      userCharacterId: 'char_player',
      cast: [
        {
          id: 'char_player',
          name: 'Dr. Evans',
          isUserCharacter: true,
          role: 'Lead',
          description: 'Lead researcher',
          personality: 'Stoic',
          goals: 'Finish project',
          traits: ['Focused'],
          isEntity: false,
          behaviorVector: 'COGNITIVE',
          starting_location: 'LAB_A',
        },
        {
          id: 'char_ally',
          name: 'Dr. Aris',
          isUserCharacter: false,
          role: 'Technician',
          description: 'Engineer',
          personality: 'Cautious',
          goals: 'Keep power running',
          traits: ['Analytical'],
          isEntity: false,
          behaviorVector: 'COGNITIVE',
          starting_location: 'MAINTENANCE',
        },
      ],
      topology: { nodes: ['LAB_A', 'MAINTENANCE'], connections: [] },
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED',
        pursuitReviews: {
          char_ally: 'REVIEWED',
        },
        valueAnchors: [],
        characterPursuits: [
          {
            id: 'pur_aris_repair',
            castMemberId: 'char_ally',
            objective: 'Restore the coolant line',
            presentApproach: 'Searching maintenance lockers',
            reviewWindow: 'SCENE_BEAT',
            status: 'ACTIVE',
            basisSummary: 'Technician maintenance protocol',
            provenance: { kind: 'CREATOR_DEFINED' },
          },
        ],
      },
    }) as Blueprint;

  it('initializes runtime character pursuit ledger from blueprint', () => {
    const bp = createMockBlueprint();
    const ledger = createInitialCharacterPursuitLedger(bp);
    expect(ledger.pur_aris_repair).toBeDefined();
    expect(ledger.pur_aris_repair.castMemberId).toBe('char_ally');
    expect(ledger.pur_aris_repair.status).toBe('ACTIVE');
    expect(ledger.pur_aris_repair.currentObjective).toBe('Restore the coolant line');
  });

  it('applies ADVANCE operation with updated approach and valid cause', () => {
    const bp = createMockBlueprint();
    const preState = createInitialCharacterPursuitLedger(bp);
    const receipt = resolveCharacterPursuit({
      proposal: {
        changes: [
          {
            pursuitId: 'pur_aris_repair',
            operation: 'ADVANCE',
            expectedStatus: 'ACTIVE',
            proposedApproach: 'Found the replacement valve and soldering iron',
            progressSummary: 'Secured repair components in maintenance',
            causeReference: 'act-1-aris-search',
            rationale: 'Offscreen search successful.',
          },
        ],
      },
      preState,
      currentTurn: 2,
      blueprint: bp,
      userCharacterId: 'char_player',
      validCauses: ['act-1-aris-search'],
    });

    expect(receipt.decisions[0].outcome).toBe('APPLIED');
    expect(receipt.postState.pur_aris_repair.currentApproach).toBe(
      'Found the replacement valve and soldering iron'
    );
    expect(receipt.postState.pur_aris_repair.lastActivityTurn).toBe(2);
  });

  it('applies COMPLETE operation and transitions status to COMPLETED', () => {
    const bp = createMockBlueprint();
    const preState = createInitialCharacterPursuitLedger(bp);
    const receipt = resolveCharacterPursuit({
      proposal: {
        changes: [
          {
            pursuitId: 'pur_aris_repair',
            operation: 'COMPLETE',
            progressSummary: 'Coolant line fully restored and pressurization holding',
            causeReference: 'act-2-aris-repair',
            rationale: 'Repair task finished.',
          },
        ],
      },
      preState,
      currentTurn: 3,
      blueprint: bp,
      userCharacterId: 'char_player',
      validCauses: ['act-2-aris-repair'],
    });

    expect(receipt.decisions[0].outcome).toBe('APPLIED');
    expect(receipt.postState.pur_aris_repair.status).toBe('COMPLETED');
  });

  it('rejects pursuit change citing unsupported cause', () => {
    const bp = createMockBlueprint();
    const preState = createInitialCharacterPursuitLedger(bp);
    const receipt = resolveCharacterPursuit({
      proposal: {
        changes: [
          {
            pursuitId: 'pur_aris_repair',
            operation: 'BLOCK',
            progressSummary: 'Blocked by monster',
            causeReference: 'fabricated-cause',
            rationale: 'Something blocked her.',
          },
        ],
      },
      preState,
      currentTurn: 1,
      blueprint: bp,
      userCharacterId: 'char_player',
      validCauses: ['act-1-aris-search'],
    });

    expect(receipt.decisions[0].outcome).toBe('REJECTED');
    expect(receipt.decisions[0].reasonCode).toBe('UNSUPPORTED_CAUSE_REFERENCE');
    expect(receipt.postState.pur_aris_repair.status).toBe('ACTIVE');
  });

  describe('boundedOutChangeIds', () => {
    it('returns empty array when changes count is within cap', () => {
      const bp = createMockBlueprint();
      const preState = createInitialCharacterPursuitLedger(bp);
      const receipt = resolveCharacterPursuit({
        proposal: {
          changes: [
            {
              pursuitId: 'pur_aris_repair',
              operation: 'ADVANCE',
              proposedApproach: 'Checking tool kit',
              progressSummary: 'Checking tools',
              causeReference: 'act-1-aris-search',
              rationale: 'Checking tools.',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['act-1-aris-search'],
      });

      expect(receipt.boundedOutChangeIds).toEqual([]);
    });

    it('submits cap + 2 changes and records exact dropped IDs into boundedOutChangeIds', () => {
      const bp = createMockBlueprint();
      const preState = createInitialCharacterPursuitLedger(bp);
      const receipt = resolveCharacterPursuit({
        proposal: {
          changes: [
            {
              pursuitId: 'pur_1',
              operation: 'ADVANCE',
              proposedApproach: 'Approach 1',
              progressSummary: 'Progress 1',
              causeReference: 'cause-1',
              rationale: 'First change',
            },
            {
              pursuitId: 'pur_2',
              operation: 'ADVANCE',
              proposedApproach: 'Approach 2',
              progressSummary: 'Progress 2',
              causeReference: 'cause-1',
              rationale: 'Second change',
            },
            {
              pursuitId: 'pur_3',
              operation: 'ADVANCE',
              proposedApproach: 'Approach 3',
              progressSummary: 'Progress 3',
              causeReference: 'cause-1',
              rationale: 'Third change (dropped)',
            },
            {
              pursuitId: 'pur_4',
              operation: 'ADVANCE',
              proposedApproach: 'Approach 4',
              progressSummary: 'Progress 4',
              causeReference: 'cause-1',
              rationale: 'Fourth change (dropped)',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['cause-1'],
      });

      expect(receipt.boundedOutChangeIds).toHaveLength(2);
      expect(receipt.boundedOutChangeIds).toEqual(['pur_3', 'pur_4']);
    });
  });
});
