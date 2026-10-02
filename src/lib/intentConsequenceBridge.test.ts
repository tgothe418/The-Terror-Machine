import { describe, expect, it } from 'vitest';
import {
  createIntentBoundCastInteractionReceipt,
  getIntentBoundAddressedCharacterId,
  getSpatiallyRatifiableRequestedTransition,
  getThresholdBoundTopologyDelta,
} from './intentConsequenceBridge';
import type { IntentReceipt, TopologyDelta } from '../types/engineContract';
import type { CastTargetResolution } from './causalFeasibility';

function createMockIntentReceipt(action_kind: IntentReceipt['action_kind']): IntentReceipt {
  return {
    version: 1,
    action_kind,
    action_subtype: null,
    pressure_direction: 'MAINTAIN',
    dramatic_tactic: 'NONE',
    intent_synergy: 'N/A',
  };
}

const mockProposedExpansion: TopologyDelta = {
  isExpansion: true,
  exitDirection: 'NORTH',
  newNodeDef: {
    id: 'EXPANDED_NODE_01',
    geometry: 'Subterranean Vault',
    hazards: ['toxic_fumes'],
    exitVectors: [
      {
        direction: 'SOUTH',
        targetNodeId: 'ORIGIN_NODE',
      },
    ],
  },
};

describe('intentConsequenceBridge', () => {
  describe('getSpatiallyRatifiableRequestedTransition', () => {
    it('1. Preserves proposed transition across all natural language action kinds', () => {
      const naturalActions = [
        'I follow the guide into the records office while asking about the missing files',
        'I step into the records office and observe the room',
        'I examine the desk in the records office',
        'I move into the records office',
      ];

      for (const userAction of naturalActions) {
        expect(
          getSpatiallyRatifiableRequestedTransition({
            userAction,
            proposedTarget: 'RECORDS_OFFICE',
          })
        ).toBe('RECORDS_OFFICE');
      }
    });

    it('2. Suppresses transition for synthetic non-movement commands (SYSTEM_INIT and [USER_ACTION: OBSERVE])', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'SYSTEM_INIT',
          proposedTarget: 'RECORDS_OFFICE',
        })
      ).toBeNull();

      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: '[USER_ACTION: OBSERVE]',
          proposedTarget: 'RECORDS_OFFICE',
        })
      ).toBeNull();
    });

    it('3. Suppresses mapped transition when expansion is authorized (Expansion Precedence)', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'I push through the unmapped fissure into the dark cavern',
          proposedTarget: 'RECORDS_OFFICE',
          isExpansionAuthorized: true,
        })
      ).toBeNull();
    });

    it('4. Returns null for non-string or whitespace-only targets', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'I walk forward',
          proposedTarget: null,
        })
      ).toBeNull();

      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'I walk forward',
          proposedTarget: undefined,
        })
      ).toBeNull();

      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'I walk forward',
          proposedTarget: '   ',
        })
      ).toBeNull();
    });
  });

  describe('getIntentBoundAddressedCharacterId', () => {
    it('Only COMMUNICATE + PRESENT_ELIGIBLE returns an addressed ID', () => {
      const commReceipt = createMockIntentReceipt('COMMUNICATE');
      const presentEligibleTarget: CastTargetResolution = {
        status: 'PRESENT_ELIGIBLE',
        characterId: 'char-elena',
      };

      expect(
        getIntentBoundAddressedCharacterId(commReceipt, presentEligibleTarget)
      ).toBe('char-elena');

      const nonEligibleStatuses: CastTargetResolution[] = [
        { status: 'NONE', characterId: null },
        { status: 'AMBIGUOUS', characterId: null },
        { status: 'ABSENT', characterId: 'char-elena' },
        { status: 'INELIGIBLE', characterId: 'char-elena' },
      ];

      for (const target of nonEligibleStatuses) {
        expect(getIntentBoundAddressedCharacterId(commReceipt, target)).toBeNull();
      }
    });

    it('returns null for all non-COMMUNICATE action kinds even if castTarget is PRESENT_ELIGIBLE', () => {
      const nonCommKinds: IntentReceipt['action_kind'][] = [
        'OBSERVE',
        'INVESTIGATE',
        'MOVE',
        'MANIPULATE',
        'WAIT',
        'SYSTEM',
        'OTHER',
      ];

      const presentEligibleTarget: CastTargetResolution = {
        status: 'PRESENT_ELIGIBLE',
        characterId: 'char-elena',
      };

      for (const kind of nonCommKinds) {
        const receipt = createMockIntentReceipt(kind);
        expect(
          getIntentBoundAddressedCharacterId(receipt, presentEligibleTarget)
        ).toBeNull();
      }
    });
  });

  describe('createIntentBoundCastInteractionReceipt', () => {
    it('A pure MANIPULATE action naming an eligible cast member with no dialogue produces NONE, not ADDRESS_UNANSWERED', () => {
      const manipReceipt = createMockIntentReceipt('MANIPULATE');
      const presentEligibleTarget: CastTargetResolution = {
        status: 'PRESENT_ELIGIBLE',
        characterId: 'char-elena',
      };

      const receipt = createIntentBoundCastInteractionReceipt({
        intentReceipt: manipReceipt,
        castTarget: presentEligibleTarget,
        respondingCharacterId: null,
      });

      expect(receipt).toEqual({
        version: 1,
        addressedCharacterId: null,
        respondingCharacterId: null,
        outcome: 'NONE',
      });
    });

    it('Non-communication spontaneous dialogue produces UNSOLICITED_DIALOGUE', () => {
      const observeReceipt = createMockIntentReceipt('OBSERVE');
      const presentEligibleTarget: CastTargetResolution = {
        status: 'PRESENT_ELIGIBLE',
        characterId: 'char-elena',
      };

      const receipt = createIntentBoundCastInteractionReceipt({
        intentReceipt: observeReceipt,
        castTarget: presentEligibleTarget,
        respondingCharacterId: 'char-elena',
      });

      expect(receipt).toEqual({
        version: 1,
        addressedCharacterId: null,
        respondingCharacterId: 'char-elena',
        outcome: 'UNSOLICITED_DIALOGUE',
      });
    });

    it('Targeted communication covers responded, unanswered, and mismatch outcomes through existing builder', () => {
      const commReceipt = createMockIntentReceipt('COMMUNICATE');
      const presentEligibleTarget: CastTargetResolution = {
        status: 'PRESENT_ELIGIBLE',
        characterId: 'char-elena',
      };

      // Responded: addressed == responding
      const respondedReceipt = createIntentBoundCastInteractionReceipt({
        intentReceipt: commReceipt,
        castTarget: presentEligibleTarget,
        respondingCharacterId: 'char-elena',
      });
      expect(respondedReceipt).toEqual({
        version: 1,
        addressedCharacterId: 'char-elena',
        respondingCharacterId: 'char-elena',
        outcome: 'RESPONDED',
      });

      // Unanswered: addressed != null, responding == null
      const unansweredReceipt = createIntentBoundCastInteractionReceipt({
        intentReceipt: commReceipt,
        castTarget: presentEligibleTarget,
        respondingCharacterId: null,
      });
      expect(unansweredReceipt).toEqual({
        version: 1,
        addressedCharacterId: 'char-elena',
        respondingCharacterId: null,
        outcome: 'ADDRESS_UNANSWERED',
      });

      // Mismatch: addressed != null, responding != null && addressed != responding
      const mismatchReceipt = createIntentBoundCastInteractionReceipt({
        intentReceipt: commReceipt,
        castTarget: presentEligibleTarget,
        respondingCharacterId: 'char-jules',
      });
      expect(mismatchReceipt).toEqual({
        version: 1,
        addressedCharacterId: 'char-elena',
        respondingCharacterId: 'char-jules',
        outcome: 'MISMATCH',
      });
    });
  });

  describe('getThresholdBoundTopologyDelta', () => {
    it('1. Preserves expansion for non-MOVE dominant kinds when threshold is expected for embodied roles', () => {
      const embodiedRoles = ['protagonist', 'antagonist', 'possessed'];
      const actions = [
        'I examine the fissure while stepping inside',
        'I talk to the guide and cross the unmapped archway',
        'I wait as the shifting threshold opens',
      ];

      for (const effectiveRole of embodiedRoles) {
        for (const userAction of actions) {
          const result = getThresholdBoundTopologyDelta({
            userAction,
            effectiveRole,
            isExpansionExpected: true,
            proposedTopologyDelta: mockProposedExpansion,
          });
          expect(result).toEqual(mockProposedExpansion);
          expect(result.isExpansion).toBe(true);
        }
      }
    });

    it('2. Suppresses expansion when isExpansionExpected is false', () => {
      const result = getThresholdBoundTopologyDelta({
        userAction: 'I walk forward',
        effectiveRole: 'protagonist',
        isExpansionExpected: false,
        proposedTopologyDelta: mockProposedExpansion,
      });
      expect(result).toEqual({ isExpansion: false, newNodeDef: null });
    });

    it('3. Suppresses expansion for non-embodied roles (director, witness)', () => {
      for (const effectiveRole of ['director', 'witness']) {
        const result = getThresholdBoundTopologyDelta({
          userAction: 'I move through the boundary',
          effectiveRole,
          isExpansionExpected: true,
          proposedTopologyDelta: mockProposedExpansion,
        });
        expect(result).toEqual({ isExpansion: false, newNodeDef: null });
      }
    });

    it('4. Suppresses expansion for synthetic commands (SYSTEM_INIT and [USER_ACTION: OBSERVE])', () => {
      expect(
        getThresholdBoundTopologyDelta({
          userAction: 'SYSTEM_INIT',
          effectiveRole: 'protagonist',
          isExpansionExpected: true,
          proposedTopologyDelta: mockProposedExpansion,
        })
      ).toEqual({ isExpansion: false, newNodeDef: null });

      expect(
        getThresholdBoundTopologyDelta({
          userAction: '[USER_ACTION: OBSERVE]',
          effectiveRole: 'protagonist',
          isExpansionExpected: true,
          proposedTopologyDelta: mockProposedExpansion,
        })
      ).toEqual({ isExpansion: false, newNodeDef: null });
    });

    it('5. Suppresses expansion when proposedTopologyDelta is invalid or missing newNodeDef', () => {
      expect(
        getThresholdBoundTopologyDelta({
          userAction: 'I walk forward',
          effectiveRole: 'protagonist',
          isExpansionExpected: true,
          proposedTopologyDelta: null,
        })
      ).toEqual({ isExpansion: false, newNodeDef: null });

      expect(
        getThresholdBoundTopologyDelta({
          userAction: 'I walk forward',
          effectiveRole: 'protagonist',
          isExpansionExpected: true,
          proposedTopologyDelta: { isExpansion: true, newNodeDef: null },
        })
      ).toEqual({ isExpansion: false, newNodeDef: null });
    });
  });

  describe('getSpatiallyRatifiableRequestedTransition normalization (D2/F1)', () => {
    const nodes = [
      { id: 'office', label: 'Motel Office', name: 'Office' },
      { id: 'parking_lot', label: 'Parking Lot', name: 'Parking Lot' },
      { id: 'room_6', label: 'Room 6', name: 'Room Six' },
    ];

    it('preserves exact ID passthrough ("room_6" → "room_6")', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'I run towards room 6',
          proposedTarget: 'room_6',
          currentNodeId: 'office',
          nodes,
        })
      ).toBe('room_6');
    });

    it('normalizes case and hyphen variants ("Room-6", "ROOM_6" → "room_6")', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'I run towards Room-6',
          proposedTarget: 'Room-6',
          currentNodeId: 'office',
          nodes,
        })
      ).toBe('room_6');

      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'I run towards ROOM_6',
          proposedTarget: 'ROOM_6',
          currentNodeId: 'office',
          nodes,
        })
      ).toBe('room_6');
    });

    it('matches node label and name ("Room 6", "Room Six" → "room_6")', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'Head to Room 6',
          proposedTarget: 'Room 6',
          currentNodeId: 'office',
          nodes,
        })
      ).toBe('room_6');

      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'Head to Room Six',
          proposedTarget: 'Room Six',
          currentNodeId: 'office',
          nodes,
        })
      ).toBe('room_6');
    });

    it('returns null on current-node echo ("office" or "Office" with currentNodeId "office")', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'Stay in the office',
          proposedTarget: 'office',
          currentNodeId: 'office',
          nodes,
        })
      ).toBeNull();

      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'Stay in the office',
          proposedTarget: 'Office',
          currentNodeId: 'office',
          nodes,
        })
      ).toBeNull();
    });

    it('passes through unknown targets unchanged ("hallway" → "hallway")', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'Step into the hallway',
          proposedTarget: 'hallway',
          currentNodeId: 'office',
          nodes,
        })
      ).toBe('hallway');
    });

    it('preserves trim-only behavior without throwing when nodes is undefined or empty', () => {
      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'Walk somewhere',
          proposedTarget: '  room_6  ',
          currentNodeId: 'office',
        })
      ).toBe('room_6');

      expect(
        getSpatiallyRatifiableRequestedTransition({
          userAction: 'Stay here',
          proposedTarget: 'office',
          currentNodeId: 'office',
          nodes: [],
        })
      ).toBeNull();
    });
  });
});
