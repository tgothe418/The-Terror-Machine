import { Blueprint } from '../types';
import {
  CharacterPursuitLedger,
  CharacterPursuitRecord,
  CharacterPursuitProposal,
  CharacterPursuitReceipt,
  PursuitStatus,
  HorrorGrammarAuthoringBaseline,
} from '../types/horrorGrammar';

import { isHorrorGrammarCauseReferenceValid } from './horrorGrammarCauseReferences';

export function createInitialCharacterPursuitLedger(
  blueprint?: Blueprint | null
): CharacterPursuitLedger {
  const ledger: CharacterPursuitLedger = {};
  const pursuits = blueprint?.horrorGrammar?.characterPursuits || [];

  for (const pursuit of pursuits) {
    ledger[pursuit.id] = {
      pursuitId: pursuit.id,
      castMemberId: pursuit.castMemberId,
      currentObjective: pursuit.objective,
      currentApproach: pursuit.presentApproach,
      currentLocationNodeId: pursuit.locationNodeId || null,
      status: pursuit.status || 'ACTIVE',
      progressSummary: 'Baseline pursuit initiated',
      lastCauseReference: 'BASELINE',
      lastActivityTurn: null,
      lastChangedTurn: 0,
      reviewWindow: pursuit.reviewWindow,
    };
  }

  return ledger;
}

export interface ResolveCharacterPursuitInput {
  proposal?: CharacterPursuitProposal | null;
  preState?: CharacterPursuitLedger | null;
  currentTurn: number;
  authoringBaseline?: HorrorGrammarAuthoringBaseline | null;
  blueprint?: Blueprint | null;
  userCharacterId?: string | null;
  validCauses: readonly string[];
}

export function resolveCharacterPursuit({
  proposal,
  preState = {},
  currentTurn,
  authoringBaseline,
  blueprint,
  userCharacterId,
  validCauses,
}: ResolveCharacterPursuitInput): CharacterPursuitReceipt {
  const normalizedPreState: CharacterPursuitLedger = { ...(preState || {}) };
  const postState: CharacterPursuitLedger = { ...normalizedPreState };
  const decisions: CharacterPursuitReceipt['decisions'] = [];

  const changes = proposal?.changes || [];
  if (changes.length === 0) {
    return {
      version: 1,
      preState: normalizedPreState,
      postState: normalizedPreState,
      decisions: [],
      boundedOutChangeIds: [],
    };
  }

  const blueprintPursuits =
    authoringBaseline?.characterPursuits || blueprint?.horrorGrammar?.characterPursuits || [];

  for (const change of changes.slice(0, 2)) {
    const {
      pursuitId,
      operation,
      expectedStatus,
      proposedObjective,
      proposedApproach,
      proposedLocationNodeId,
      proposedStatus,
      progressSummary,
      causeReference,
    } = change;

    const currentRecord = postState[pursuitId];
    const blueprintPursuit = blueprintPursuits.find((p) => p.id === pursuitId);

    if (!currentRecord && !blueprintPursuit) {
      decisions.push({
        pursuitId,
        operation,
        outcome: 'REJECTED',
        reasonCode: 'PURSUIT_NOT_FOUND',
        causeReference,
      });
      continue;
    }

    const effectiveRecord: CharacterPursuitRecord = currentRecord || {
      pursuitId,
      castMemberId: blueprintPursuit!.castMemberId,
      currentObjective: blueprintPursuit!.objective,
      currentApproach: blueprintPursuit!.presentApproach,
      currentLocationNodeId: blueprintPursuit!.locationNodeId || null,
      status: blueprintPursuit!.status,
      progressSummary: 'Baseline pursuit initiated',
      lastCauseReference: 'BASELINE',
      lastActivityTurn: null,
      lastChangedTurn: 0,
      reviewWindow: blueprintPursuit!.reviewWindow,
    };

    // User character protection
    if (effectiveRecord.castMemberId === userCharacterId) {
      decisions.push({
        pursuitId,
        operation,
        outcome: 'REJECTED',
        reasonCode: 'USER_PURSUIT_MODEL_MUTATION_FORBIDDEN',
        causeReference,
      });
      continue;
    }

    // Expected status check
    if (expectedStatus && effectiveRecord.status !== expectedStatus) {
      decisions.push({
        pursuitId,
        operation,
        outcome: 'REJECTED',
        reasonCode: 'PRE_STATUS_MISMATCH',
        causeReference,
      });
      continue;
    }

    // Cause validation
    const isCauseValid = isHorrorGrammarCauseReferenceValid(
      causeReference,
      validCauses
    );

    if (!isCauseValid) {
      decisions.push({
        pursuitId,
        operation,
        outcome: 'REJECTED',
        reasonCode: 'UNSUPPORTED_CAUSE_REFERENCE',
        causeReference,
      });
      continue;
    }

    let nextStatus: PursuitStatus = effectiveRecord.status;
    let nextObjective = effectiveRecord.currentObjective;
    let nextApproach = effectiveRecord.currentApproach;
    let nextLocation = effectiveRecord.currentLocationNodeId;

    if (operation === 'ADVANCE') {
      nextStatus = 'ACTIVE';
      if (proposedApproach) nextApproach = proposedApproach;
    } else if (operation === 'SETBACK') {
      nextStatus = 'ACTIVE';
      if (proposedApproach) nextApproach = proposedApproach;
    } else if (operation === 'REDIRECT') {
      nextStatus = 'ACTIVE';
      if (proposedObjective) nextObjective = proposedObjective;
      if (proposedApproach) nextApproach = proposedApproach;
      if (proposedLocationNodeId !== undefined) nextLocation = proposedLocationNodeId;
    } else if (operation === 'BLOCK') {
      nextStatus = 'BLOCKED';
    } else if (operation === 'COMPLETE') {
      nextStatus = 'COMPLETED';
    } else if (operation === 'ABANDON') {
      nextStatus = 'ABANDONED';
    } else if (operation === 'PAUSE') {
      nextStatus = 'DORMANT';
    } else if (operation === 'RESUME') {
      nextStatus = 'ACTIVE';
      if (proposedApproach) nextApproach = proposedApproach;
    }

    if (proposedStatus) {
      nextStatus = proposedStatus;
    }

    postState[pursuitId] = {
      ...effectiveRecord,
      status: nextStatus,
      currentObjective: nextObjective,
      currentApproach: nextApproach,
      currentLocationNodeId: nextLocation,
      progressSummary: progressSummary.trim(),
      lastCauseReference: causeReference,
      lastActivityTurn: currentTurn,
      lastChangedTurn: currentTurn,
    };

    decisions.push({
      pursuitId,
      operation,
      outcome: 'APPLIED',
      reasonCode: 'PURSUIT_TRANSITION_APPLIED',
      causeReference,
    });
  }

  const boundedOutChangeIds = changes.slice(2).map((c) => c.pursuitId);

  return {
    version: 1,
    preState: normalizedPreState,
    postState,
    decisions,
    boundedOutChangeIds,
  };
}
