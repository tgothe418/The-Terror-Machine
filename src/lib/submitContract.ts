import { FearContract } from '../types/fear';
import { CharacterStance } from '../types/characterStance';
import { TopologyConnection } from './cohortBehaviors';
import { SpatialNode } from '../types';

export type SubmitOutcome =
  | 'ACCEPT'
  | 'REJECT'
  | 'PUNISH'
  | 'IGNORE'
  | 'AWAITING_HUMAN_CHOICE'
  | 'UNPERCEIVED'
  | string;

export interface HumanSubmitChoicePromptPayload {
  villainId: string;
  targetCharacterId: string;
  description: string;
  suggestedOptions: string[];
}

export interface EvaluateSubmitResponseParams {
  villainId: string;
  submittedCharId: string;
  submitResponseContract?: Record<string, 'ACCEPT' | 'REJECT' | 'PUNISH' | 'IGNORE' | string>;
  isVillainHuman?: boolean;
  spatialGraph?: SpatialNode[];
  castPlacement?: Record<string, string>; // characterId -> nodeId
  topologyConnections?: TopologyConnection[];
  fearContract?: Partial<FearContract>;
}

export interface SubmitResponseResult {
  canPerceive: boolean;
  outcome: SubmitOutcome;
  humanPromptPayload?: HumanSubmitChoicePromptPayload;
  description: string;
  targetStancePostState: CharacterStance;
}

import type { CohortState } from '../types/cohort';

/**
 * Ranks diegetic perception of a submission:
 * - 0: Co-located in the same node (or fallback if unplaced)
 * - 1: Directly adjacent node via OPEN edge or exit
 * - null: Unperceived (blocked, locked, or distant)
 */
export function rankSubmissionPerception(
  villainId: string,
  submittedCharId: string,
  castPlacement?: Record<string, string>,
  topologyConnections?: TopologyConnection[],
  spatialGraph?: SpatialNode[]
): 0 | 1 | null {
  if (!castPlacement) return 0;
  const villainNode = castPlacement[villainId];
  const submittedNode = castPlacement[submittedCharId];
  if (!villainNode || !submittedNode) return 0;
  if (villainNode === submittedNode) return 0;
  if (topologyConnections && Array.isArray(topologyConnections)) {
    const directEdge = topologyConnections.find(
      (c) =>
        ((c.fromNodeId === villainNode && c.toNodeId === submittedNode) ||
          (c.fromNodeId === submittedNode && c.toNodeId === villainNode)) &&
        c.status === 'OPEN'
    );
    if (directEdge) return 1;
  }
  if (spatialGraph && Array.isArray(spatialGraph)) {
    const vNode = spatialGraph.find((n) => n.id === villainNode);
    if (vNode?.exits?.some((e) => e.targetNodeId === submittedNode && e.isOpen !== false)) return 1;
    const sNode = spatialGraph.find((n) => n.id === submittedNode);
    if (sNode?.exits?.some((e) => e.targetNodeId === villainNode && e.isOpen !== false)) return 1;
  }
  return null;
}

/**
 * Checks whether the villain can diegetically perceive the submission.
 * Same node -> true; directly adjacent node via OPEN edge -> true; otherwise false.
 */
export function canVillainPerceiveSubmission(
  villainId: string,
  submittedCharId: string,
  castPlacement?: Record<string, string>,
  topologyConnections?: TopologyConnection[],
  spatialGraph?: SpatialNode[]
): boolean {
  return rankSubmissionPerception(villainId, submittedCharId, castPlacement, topologyConnections, spatialGraph) !== null;
}

export function resolveSubmitResponder(
  villainIds: string[],
  submittedCharId: string,
  castPlacement?: Record<string, string>,
  topologyConnections?: TopologyConnection[],
  spatialGraph?: SpatialNode[]
): { villainId: string; rank: 0 | 1 } | null {
  if (!Array.isArray(villainIds) || villainIds.length === 0) return null;
  let best: { villainId: string; rank: 0 | 1 } | null = null;
  for (const villainId of villainIds) {
    const rank = rankSubmissionPerception(villainId, submittedCharId, castPlacement, topologyConnections, spatialGraph);
    if (rank === null) continue;
    if (!best || rank < best.rank) {
      best = { villainId, rank };
    }
  }
  return best;
}

export function isHumanVillainSeat(
  participationMode: string | undefined | null,
  seatKind: string | undefined | null,
  boundCharIsEntity: boolean | undefined
): boolean {
  if (participationMode !== 'antagonist' && participationMode !== 'villain') return false;
  if (participationMode === 'villain') return true;
  return seatKind !== 'force' && !boundCharIsEntity;
}

export function applySubmitOutcomeStance(
  cohortState: CohortState,
  submittedCharId: string,
  postState: CharacterStance
): CohortState {
  const member = cohortState?.members?.[submittedCharId];
  if (!member) return cohortState;
  const currentStance = member.stance;
  const focus =
    currentStance && typeof currentStance === 'object' && typeof currentStance.focus === 'string'
      ? currentStance.focus
      : 'SITUATION';
  return {
    ...cohortState,
    members: {
      ...cohortState.members,
      [submittedCharId]: {
        ...member,
        stance: { focus, stance: postState },
      },
    },
  };
}

/**
 * Evaluates the Turn N+1 response contract when a character executes SUBMIT (§5.4).
 * - Turn N: Character executes SUBMIT, setting stance: 'SUBMITTED' and emitting acoustic/social pleas.
 * - Turn N+1: The villain evaluates the authored response contract:
 *   1. If villain cannot perceive the plea, stance persists without crashing (UNPERCEIVED).
 *   2. If villain is a human player, returns prompt payload presenting the choice (AWAITING_HUMAN_CHOICE).
 *   3. If villain is autonomous NPC, evaluates authored submitResponse (ACCEPT, REJECT, PUNISH, IGNORE; default REJECT).
 */
export function evaluateSubmitResponse(
  params: EvaluateSubmitResponseParams
): SubmitResponseResult {
  const {
    villainId,
    submittedCharId,
    submitResponseContract,
    isVillainHuman = false,
    spatialGraph,
    castPlacement,
    topologyConnections,
    fearContract,
  } = params;

  // 1. Gating: Diegetic Perception
  const canPerceive = canVillainPerceiveSubmission(
    villainId,
    submittedCharId,
    castPlacement,
    topologyConnections,
    spatialGraph
  );

  if (!canPerceive) {
    return {
      canPerceive: false,
      outcome: 'UNPERCEIVED',
      description: `The villain (${villainId}) is not in position to perceive ${submittedCharId}'s submission. The plea goes unheard; submission stance persists.`,
      targetStancePostState: 'SUBMITTED',
    };
  }

  // 2. Human Villain / Antagonist Sovereignty (Invariant 6)
  if (isVillainHuman) {
    return {
      canPerceive: true,
      outcome: 'AWAITING_HUMAN_CHOICE',
      humanPromptPayload: {
        villainId,
        targetCharacterId: submittedCharId,
        description: `${submittedCharId} has collapsed before you, hands raised in total surrender, begging for their life.`,
        suggestedOptions: [
          'Accept surrender and command obedience',
          'Reject the plea and strike without hesitation',
          'Inflict punishment to demonstrate absolute dominance',
          'Ignore the defenseless subject and continue forward',
        ],
      },
      description: `The victim (${submittedCharId}) has submitted. Awaiting human player decision.`,
      targetStancePostState: 'SUBMITTED',
    };
  }

  // 3. Autonomous NPC Villain Authoring Evaluation
  const authoredContract =
    submitResponseContract || fearContract?.submitResponse || {};

  // Check specific character key or villain key or default
  const rawResponse =
    authoredContract[villainId] ||
    authoredContract[submittedCharId] ||
    authoredContract['default'] ||
    'REJECT';

  const normalizedResponse = rawResponse.toUpperCase();

  switch (normalizedResponse) {
    case 'ACCEPT':
      return {
        canPerceive: true,
        outcome: 'ACCEPT',
        description: `The villain (${villainId}) pauses, accepting ${submittedCharId}'s capitulation and sparing them for now.`,
        targetStancePostState: 'WITHDRAWN',
      };

    case 'PUNISH':
      return {
        canPerceive: true,
        outcome: 'PUNISH',
        description: `The villain (${villainId}) punishes ${submittedCharId}'s weakness with calculated violence or psychological humiliation.`,
        targetStancePostState: 'AFRAID',
      };

    case 'IGNORE':
      return {
        canPerceive: true,
        outcome: 'IGNORE',
        description: `The villain (${villainId}) regards ${submittedCharId} with contempt and steps past them, pursuing a higher priority.`,
        targetStancePostState: 'WITHDRAWN',
      };

    case 'REJECT':
      return {
        canPerceive: true,
        outcome: 'REJECT',
        description: `The villain (${villainId}) rejects ${submittedCharId}'s plea without mercy.`,
        targetStancePostState: 'AFRAID',
      };

    default:
      return {
        canPerceive: true,
        outcome: normalizedResponse || 'REJECT',
        description: `The villain (${villainId}) responds with ${rawResponse} to ${submittedCharId}'s submission.`,
        targetStancePostState: 'WITHDRAWN',
      };
  }
}
