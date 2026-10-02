import { createCastInteractionReceipt } from './castInteraction';
import type {
  CastInteractionReceipt,
  IntentReceipt,
  TopologyDelta,
} from '../types/engineContract';
import type { CastTargetResolution } from './causalFeasibility';

export interface SpatialTransitionProposalInput {
  userAction: string;
  proposedTarget: string | null | undefined;
  isExpansionAuthorized?: boolean;
  currentNodeId?: string | null;
  nodes?: Array<{ id: string; label?: string; name?: string }>;
}

export function isSyntheticNonMovementCommand(userAction: string): boolean {
  const normalized = userAction.trim().toUpperCase();
  return (
    normalized === 'SYSTEM_INIT' ||
    normalized === '[USER_ACTION: OBSERVE]'
  );
}

function normalizeSpatialKey(str: string): string {
  return str.toLowerCase().replace(/[\s-]+/g, '_');
}

export function getSpatiallyRatifiableRequestedTransition({
  userAction,
  proposedTarget,
  isExpansionAuthorized = false,
  currentNodeId,
  nodes,
}: SpatialTransitionProposalInput): string | null {
  if (isSyntheticNonMovementCommand(userAction)) {
    return null;
  }

  // Expansion Precedence: If expansion is authorized, suppress mapped transition
  if (isExpansionAuthorized) {
    return null;
  }

  // 2a. Not a string -> null
  if (typeof proposedTarget !== 'string') {
    return null;
  }

  // 2b. Trim; empty -> null
  const trimmed = proposedTarget.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // 2c. If trimmed value matches currentNodeId (exact, or normalized per step e) -> null (non-movement)
  if (currentNodeId) {
    const normalizedCurrentNode = normalizeSpatialKey(currentNodeId);
    if (trimmed === currentNodeId || normalizeSpatialKey(trimmed) === normalizedCurrentNode) {
      return null;
    }
  }

  if (nodes && nodes.length > 0) {
    // 2d. Exact node ID match
    const exactMatch = nodes.find((n) => n.id === trimmed);
    if (exactMatch) {
      return exactMatch.id;
    }

    const normalizedTrimmed = normalizeSpatialKey(trimmed);

    // 2e. Normalized match: lowercase the trimmed value and replace [\s-]+ with _, match against node IDs
    const idMatch = nodes.find((n) => normalizeSpatialKey(n.id) === normalizedTrimmed);
    if (idMatch) {
      return idMatch.id;
    }

    // 2f. Label/name match: normalize the same way and match against each node's label and name
    const labelMatch = nodes.find(
      (n) =>
        (typeof n.label === 'string' && normalizeSpatialKey(n.label) === normalizedTrimmed) ||
        (typeof n.name === 'string' && normalizeSpatialKey(n.name) === normalizedTrimmed)
    );
    if (labelMatch) {
      return labelMatch.id;
    }
  }

  // 2g. No match -> return trimmed original unchanged (passthrough)
  return trimmed;
}

export function getIntentBoundAddressedCharacterId(
  intentReceipt: IntentReceipt,
  castTarget: CastTargetResolution
): string | null {
  if (
    intentReceipt.action_kind === 'COMMUNICATE' &&
    castTarget.status === 'PRESENT_ELIGIBLE'
  ) {
    return castTarget.characterId;
  }
  return null;
}

export function createIntentBoundCastInteractionReceipt(input: {
  intentReceipt: IntentReceipt;
  castTarget: CastTargetResolution;
  respondingCharacterId: string | null;
}): CastInteractionReceipt {
  const addressedCharacterId = getIntentBoundAddressedCharacterId(
    input.intentReceipt,
    input.castTarget
  );
  return createCastInteractionReceipt({
    addressedCharacterId,
    respondingCharacterId: input.respondingCharacterId,
  });
}

export interface ThresholdBoundTopologyDeltaInput {
  userAction: string;
  effectiveRole: string;
  isExpansionExpected: boolean;
  proposedTopologyDelta: TopologyDelta | null | undefined;
}

export function isEmbodiedRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === 'protagonist' ||
    normalized === 'antagonist' ||
    normalized === 'possessed' ||
    normalized === 'survivor' ||
    normalized === 'villain' ||
    normalized === 'bystander'
  );
}

export function getThresholdBoundTopologyDelta(
  input: ThresholdBoundTopologyDeltaInput
): TopologyDelta {
  if (isSyntheticNonMovementCommand(input.userAction)) {
    return { isExpansion: false, newNodeDef: null };
  }
  if (!isEmbodiedRole(input.effectiveRole)) {
    return { isExpansion: false, newNodeDef: null };
  }
  if (!input.isExpansionExpected) {
    return { isExpansion: false, newNodeDef: null };
  }
  if (input.proposedTopologyDelta?.isExpansion !== true) {
    return { isExpansion: false, newNodeDef: null };
  }
  const newNodeDef = input.proposedTopologyDelta.newNodeDef;
  if (
    !newNodeDef ||
    typeof newNodeDef.id !== 'string' ||
    newNodeDef.id.trim().length === 0
  ) {
    return { isExpansion: false, newNodeDef: null };
  }
  return input.proposedTopologyDelta;
}
