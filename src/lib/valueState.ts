import { Blueprint } from '../types';
import {
  ValueStateLedger,
  ValueStateRecord,
  ValueStateProposal,
  ValueStateReceipt,
  ValueCondition,
  ValueLifecycle,
  HorrorGrammarAuthoringBaseline,
} from '../types/horrorGrammar';

import { isHorrorGrammarCauseReferenceValid } from './horrorGrammarCauseReferences';

export function createInitialValueStateLedger(blueprint?: Blueprint | null): ValueStateLedger {
  const ledger: ValueStateLedger = {};
  const anchors = blueprint?.horrorGrammar?.valueAnchors || [];

  for (const anchor of anchors) {
    ledger[anchor.id] = {
      anchorId: anchor.id,
      lifecycle: 'ACTIVE',
      condition: 'ESTABLISHED',
      currentFormNote: null,
      lastCauseReference: 'BASELINE',
      lastChangedTurn: 0,
    };
  }

  return ledger;
}

export interface ResolveValueStateInput {
  proposal?: ValueStateProposal | null;
  preState?: ValueStateLedger | null;
  currentTurn: number;
  authoringBaseline?: HorrorGrammarAuthoringBaseline | null;
  blueprint?: Blueprint | null;
  userCharacterId?: string | null;
  validCauses: readonly string[];
}

function resolveUserCharacterId(
  userCharacterId?: string | null,
  blueprint?: Blueprint | null,
): string | null {
  if (userCharacterId && userCharacterId.trim()) {
    return userCharacterId.trim();
  }
  if (blueprint?.userCharacterId && blueprint.userCharacterId.trim()) {
    return blueprint.userCharacterId.trim();
  }
  const userCast = blueprint?.cast?.find((c) => c.isUserCharacter);
  if (userCast?.id) {
    return userCast.id;
  }
  return null;
}

export function resolveValueState({
  proposal,
  preState = {},
  currentTurn,
  authoringBaseline,
  blueprint,
  userCharacterId,
  validCauses,
}: ResolveValueStateInput): ValueStateReceipt {
  const normalizedPreState: ValueStateLedger = { ...(preState || {}) };
  const postState: ValueStateLedger = { ...normalizedPreState };
  const decisions: ValueStateReceipt['decisions'] = [];

  const changes = proposal?.changes || [];
  if (changes.length === 0) {
    return {
      version: 1,
      preState: normalizedPreState,
      postState: normalizedPreState,
      decisions: [],
    };
  }

  const blueprintAnchors =
    authoringBaseline?.valueAnchors || blueprint?.horrorGrammar?.valueAnchors || [];
  const resolvedUserId = resolveUserCharacterId(
    userCharacterId,
    blueprint,
  );

  for (const change of changes.slice(0, 3)) {
    const {
      anchorId,
      operation,
      expectedBeforeCondition,
      expectedBeforeLifecycle,
      proposedCondition,
      proposedLifecycle,
      proposedFormNote = null,
      causeReference,
    } = change;

    // 1. Check anchor existence
    const currentRecord = postState[anchorId];
    const blueprintAnchor = blueprintAnchors.find((a) => a.id === anchorId);

    if (!currentRecord && !blueprintAnchor) {
      decisions.push({
        anchorId,
        operation,
        outcome: 'REJECTED',
        reasonCode: 'VALUE_ANCHOR_NOT_FOUND',
        causeReference,
      });
      continue;
    }

    const effectiveRecord: ValueStateRecord = currentRecord || {
      anchorId,
      lifecycle: 'ACTIVE',
      condition: 'ESTABLISHED',
      currentFormNote: null,
      lastCauseReference: 'BASELINE',
      lastChangedTurn: 0,
    };

    // 2. User character protection: model cannot alter what user character values
    // Trace holder identity strictly from canonical baseline (ignore model payload holder echoes)
    const isUserHeld =
      blueprintAnchor?.holder.kind === 'CHARACTER' &&
      Boolean(resolvedUserId) &&
      blueprintAnchor.holder.castMemberId === resolvedUserId;

    if (isUserHeld) {
      // Operations that retire, restore, or revise a user value are rejected
      if (operation === 'REVISE' || operation === 'RETIRE' || operation === 'RESTORE') {
        decisions.push({
          anchorId,
          operation,
          outcome: 'REJECTED',
          reasonCode: 'USER_VALUE_SUBJECTIVITY_PROTECTED',
          causeReference,
        });
        continue;
      }

      // SET_CONDITION attempts that would alter lifecycle or rewrite commitment are rejected
      if (operation === 'SET_CONDITION') {
        const attemptsLifecycleChange =
          proposedLifecycle !== undefined && proposedLifecycle !== effectiveRecord.lifecycle;
        const attemptsFormNoteChange =
          proposedFormNote !== undefined &&
          proposedFormNote !== null &&
          proposedFormNote !== effectiveRecord.currentFormNote;

        if (attemptsLifecycleChange || attemptsFormNoteChange) {
          decisions.push({
            anchorId,
            operation,
            outcome: 'REJECTED',
            reasonCode: 'USER_VALUE_SUBJECTIVITY_PROTECTED',
            causeReference,
          });
          continue;
        }
      }
    }

    // 3. Validate expected before state
    if (expectedBeforeCondition && effectiveRecord.condition !== expectedBeforeCondition) {
      decisions.push({
        anchorId,
        operation,
        outcome: 'REJECTED',
        reasonCode: 'PRECONDITION_MISMATCH',
        causeReference,
      });
      continue;
    }

    if (expectedBeforeLifecycle && effectiveRecord.lifecycle !== expectedBeforeLifecycle) {
      decisions.push({
        anchorId,
        operation,
        outcome: 'REJECTED',
        reasonCode: 'PRE_LIFECYCLE_MISMATCH',
        causeReference,
      });
      continue;
    }

    // 4. Validate cause reference
    const isCauseValid = isHorrorGrammarCauseReferenceValid(
      causeReference,
      validCauses
    );

    if (!isCauseValid) {
      decisions.push({
        anchorId,
        operation,
        outcome: 'REJECTED',
        reasonCode: 'UNSUPPORTED_CAUSE_REFERENCE',
        causeReference,
      });
      continue;
    }

    // 5. Apply validated transition
    let nextCondition: ValueCondition = effectiveRecord.condition;
    let nextLifecycle: ValueLifecycle = effectiveRecord.lifecycle;
    let nextFormNote = effectiveRecord.currentFormNote;

    if (operation === 'SET_CONDITION') {
      nextCondition = proposedCondition;
      if (!isUserHeld) {
        nextLifecycle = proposedLifecycle ?? effectiveRecord.lifecycle;
        nextFormNote = proposedFormNote ?? effectiveRecord.currentFormNote;
      }
    } else if (operation === 'REVISE') {
      nextCondition = proposedCondition;
      nextLifecycle = proposedLifecycle ?? 'REVISED';
      nextFormNote = proposedFormNote || effectiveRecord.currentFormNote;
    } else if (operation === 'RETIRE') {
      nextLifecycle = proposedLifecycle ?? 'RETIRED';
      nextCondition = proposedCondition || 'LOST';
    } else if (operation === 'RESTORE') {
      nextLifecycle = proposedLifecycle ?? 'ACTIVE';
      nextCondition = proposedCondition || 'ESTABLISHED';
      nextFormNote = null;
    }

    postState[anchorId] = {
      anchorId,
      lifecycle: nextLifecycle,
      condition: nextCondition,
      currentFormNote: nextFormNote,
      lastCauseReference: causeReference,
      lastChangedTurn: currentTurn,
    };

    decisions.push({
      anchorId,
      operation,
      outcome: 'APPLIED',
      reasonCode: 'VALUE_STATE_TRANSITION_APPLIED',
      causeReference,
    });
  }

  return {
    version: 1,
    preState: normalizedPreState,
    postState,
    decisions,
  };
}

const PRESSURE_SEVERITY_RANK: Record<ValueCondition, number> = {
  COMPROMISED: 6,
  THREATENED: 5,
  LOST: 4,
  TRANSFORMED: 3,
  ESTABLISHED: 2,
  SECURED: 1,
};

export function selectPressuredAnchors(
  valueStateLedger: ValueStateLedger,
): ValueStateRecord[] {
  if (!valueStateLedger) {
    return [];
  }

  return Object.values(valueStateLedger)
    .slice()
    .sort((a, b) => {
      const severityDiff =
        (PRESSURE_SEVERITY_RANK[b.condition] ?? 0) -
        (PRESSURE_SEVERITY_RANK[a.condition] ?? 0);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      return a.anchorId.localeCompare(b.anchorId);
    });
}

