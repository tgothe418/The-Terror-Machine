import { checkRestraint } from '../../lib/restraintMechanics';
import type { AttemptFilterContext, CanAttemptResult } from '../../types/worldState';
import type { EngineProposal } from '../../types/engineContract';

export interface RestraintFailureReceipt {
  accepted: false;
  reasonCode: 'RESTRAINT_BINDING' | 'LOCK' | string;
  reason: string;
  provenance: string;
  action: {
    characterId: string;
    verb: string;
    targetId: string | null;
  };
  narrative_blocks: [];
}

/**
 * Builds a fail-closed restraint rejection receipt without calling the model.
 * Emits turn receipt with RESTRAINT_BINDING or LOCK reason code and provenance string.
 */
export function buildRestraintFailureReceipt(
  action: EngineProposal,
  restraintCheck: CanAttemptResult
): RestraintFailureReceipt {
  return {
    accepted: false,
    reasonCode: restraintCheck.reasonCode,
    reason: restraintCheck.provenance,
    provenance: restraintCheck.provenance,
    action: {
      characterId: action.characterId,
      verb: action.verb,
      targetId: action.targetId ?? null,
    },
    narrative_blocks: [],
  };
}

/**
 * Turn execution pipeline filter: checks restraint before model generation phase.
 * If restraint check fails, returns fail-closed receipt without calling the model.
 */
export function executeRestraintFilter(
  action: EngineProposal,
  filterContext: AttemptFilterContext
): { allowed: true; check: CanAttemptResult } | { allowed: false; receipt: RestraintFailureReceipt } {
  const restraintCheck = checkRestraint(
    action.characterId,
    action.verb,
    action.targetId || null,
    filterContext
  );

  if (!restraintCheck.allowed) {
    return {
      allowed: false,
      receipt: buildRestraintFailureReceipt(action, restraintCheck),
    };
  }

  return {
    allowed: true,
    check: restraintCheck,
  };
}
