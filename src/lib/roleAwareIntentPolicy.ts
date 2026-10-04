import type {
  EngineTurnContext,
  IntentReceipt,
  NarrativeReconciliationProposal,
} from '../types/engineContract';
import type { CausalFeasibilityResult } from './causalFeasibility';

function hasCompleteExplicitAntagonistContract(context: EngineTurnContext): boolean {
  if (
    context.participationContext?.mode !== 'antagonist' &&
    context.participationContext?.mode !== 'villain'
  ) {
    return false;
  }
  const authorityContract = context.participationContext.authorityContract;
  if (!authorityContract) {
    return false;
  }
  const authority = authorityContract.authority;
  const limits = authorityContract.limits;
  return (
    typeof authority === 'string' &&
    authority.trim().length > 0 &&
    typeof limits === 'string' &&
    limits.trim().length > 0
  );
}

export function applyRoleAwareIntentPolicy(input: {
  base: CausalFeasibilityResult;
  intentReceipt: IntentReceipt;
  context: EngineTurnContext;
  proposedAuthorityAlignment: NarrativeReconciliationProposal['authority_alignment'];
}): CausalFeasibilityResult {
  const effectiveRole =
    input.context.participationContext?.mode ?? input.context.player.role;

  if (input.intentReceipt.action_kind === 'SYSTEM') {
    return {
      feasibility: input.base.feasibility,
      reason_code: input.base.reason_code,
      suppressStructuralDeltas: input.base.suppressStructuralDeltas,
      authority_alignment: 'NOT_APPLICABLE',
    };
  }

  const isHardStructuralBoundary =
    input.base.suppressStructuralDeltas === true &&
    (input.base.reason_code === 'TOPOLOGY_LIMIT' ||
      input.base.reason_code === 'CAST_PRESENCE_LIMIT');

  if (isHardStructuralBoundary) {
    let normalizedAuthorityAlignment: NarrativeReconciliationProposal['authority_alignment'] =
      'NOT_APPLICABLE';

    if (effectiveRole === 'antagonist' || effectiveRole === 'villain') {
      if (!hasCompleteExplicitAntagonistContract(input.context)) {
        normalizedAuthorityAlignment = 'EXCEEDS_CONTRACT';
      } else {
        if (input.proposedAuthorityAlignment === 'NOT_APPLICABLE') {
          normalizedAuthorityAlignment = 'UNCLEAR';
        } else {
          normalizedAuthorityAlignment = input.proposedAuthorityAlignment;
        }
      }
    }

    return {
      feasibility: input.base.feasibility,
      reason_code: input.base.reason_code,
      suppressStructuralDeltas: input.base.suppressStructuralDeltas,
      authority_alignment: normalizedAuthorityAlignment,
    };
  }

  if (
    effectiveRole === 'protagonist' ||
    effectiveRole === 'survivor' ||
    effectiveRole === 'bystander' ||
    effectiveRole === 'possessed'
  ) {
    return {
      feasibility: input.base.feasibility,
      reason_code: input.base.reason_code,
      suppressStructuralDeltas: input.base.suppressStructuralDeltas,
      authority_alignment: 'NOT_APPLICABLE',
    };
  }

  if (effectiveRole === 'director') {
    const actionKind = input.intentReceipt.action_kind;
    if (actionKind === 'MOVE' || actionKind === 'MANIPULATE') {
      return {
        feasibility: 'CONSTRAINED',
        reason_code: 'AUTHORITY_LIMIT',
        suppressStructuralDeltas: true,
        authority_alignment: 'NOT_APPLICABLE',
      };
    }
    if (actionKind === 'OTHER') {
      return {
        feasibility: 'UNCLEAR',
        reason_code: 'AUTHORITY_LIMIT',
        suppressStructuralDeltas: false,
        authority_alignment: 'NOT_APPLICABLE',
      };
    }
    return {
      feasibility: input.base.feasibility,
      reason_code: input.base.reason_code,
      suppressStructuralDeltas: input.base.suppressStructuralDeltas,
      authority_alignment: 'NOT_APPLICABLE',
    };
  }

  if (effectiveRole === 'witness') {
    const actionKind = input.intentReceipt.action_kind;
    if (actionKind === 'OBSERVE' || actionKind === 'WAIT') {
      return {
        feasibility: input.base.feasibility,
        reason_code: input.base.reason_code,
        suppressStructuralDeltas: input.base.suppressStructuralDeltas,
        authority_alignment: 'NOT_APPLICABLE',
      };
    }
    return {
      feasibility: 'CONSTRAINED',
      reason_code: 'AUTHORITY_LIMIT',
      suppressStructuralDeltas: true,
      authority_alignment: 'NOT_APPLICABLE',
    };
  }

  if (effectiveRole === 'antagonist' || effectiveRole === 'villain') {
    if (!hasCompleteExplicitAntagonistContract(input.context)) {
      return {
        feasibility: 'IMPOSSIBLE',
        reason_code: 'AUTHORITY_LIMIT',
        suppressStructuralDeltas: true,
        authority_alignment: 'EXCEEDS_CONTRACT',
      };
    }

    if (input.proposedAuthorityAlignment === 'EXCEEDS_CONTRACT') {
      return {
        feasibility: 'CONSTRAINED',
        reason_code: 'AUTHORITY_LIMIT',
        suppressStructuralDeltas: true,
        authority_alignment: 'EXCEEDS_CONTRACT',
      };
    }

    if (input.base.authority_alignment === 'WITHIN_CONTRACT') {
      return {
        feasibility: input.base.feasibility,
        reason_code: input.base.reason_code,
        suppressStructuralDeltas: input.base.suppressStructuralDeltas,
        authority_alignment: 'WITHIN_CONTRACT',
      };
    }

    if (
      input.proposedAuthorityAlignment === 'UNCLEAR' ||
      input.proposedAuthorityAlignment === 'NOT_APPLICABLE'
    ) {
      return {
        feasibility: 'UNCLEAR',
        reason_code: 'AUTHORITY_LIMIT',
        suppressStructuralDeltas: false,
        authority_alignment: 'UNCLEAR',
      };
    }

    // WITHIN_CONTRACT
    return {
      feasibility: input.base.feasibility,
      reason_code: input.base.reason_code,
      suppressStructuralDeltas: input.base.suppressStructuralDeltas,
      authority_alignment: 'WITHIN_CONTRACT',
    };
  }

  return {
    feasibility: input.base.feasibility,
    reason_code: input.base.reason_code,
    suppressStructuralDeltas: input.base.suppressStructuralDeltas,
    authority_alignment: 'NOT_APPLICABLE',
  };
}
