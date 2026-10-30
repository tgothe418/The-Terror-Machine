import {
  Blueprint,
  EngineTurnContext,
} from '../types';
import {
  SituatedPressureProposal,
  SituatedPressureReceipt,
  SituatedPressureThread,
  CastActivityReceipt,
  MAX_ACTIVE_PRESSURE_THREADS,
} from '../types/horrorGrammar';
import { isHorrorGrammarCauseReferenceValid } from './horrorGrammarCauseReferences';
import { getEligibleEvidenceRegistryMap } from './evidenceRegistry';

export interface ResolveSituatedPressureInput {
  proposal?: SituatedPressureProposal | null;
  activityReceipt?: CastActivityReceipt | null;
  currentContext: EngineTurnContext;
  preThreads?: SituatedPressureThread[] | null;
  currentTurn: number;
  blueprint?: Blueprint | null;
}

/**
 * Pure, deterministic ratifier for Situated Pressure proposals.
 */
export function resolveSituatedPressure({
  proposal,
  activityReceipt,
  currentContext,
  preThreads,
  currentTurn,
  blueprint,
}: ResolveSituatedPressureInput): SituatedPressureReceipt {
  const normalizedPreState = preThreads ? [...preThreads] : [];

  // Early return for missing/null proposal or kind='NONE'
  if (!proposal || proposal.kind === 'NONE') {
    const reason =
      proposal && proposal.kind === 'NONE'
        ? proposal.reason || 'PRESSURE_NOT_CALLED_FOR'
        : 'PRESSURE_NOT_CALLED_FOR';
    return {
      version: 1,
      outcome: 'NO_PROPOSAL',
      reasonCode: reason,
      preState: normalizedPreState,
      postState: normalizedPreState,
      admittedManifestation: false,
      acceptedThreadId: null,
      proposalSnapshot: proposal ? { kind: 'NONE', reason } : undefined,
      boundedOutChangeIds: [],
    };
  }

  const {
    proposalId,
    valueAnchorId,
    sourceReference,
    operator,
    affectedDimension,
    adverseProspect,
    authorityReferences = [],
    persistenceTarget,
    responseWindowOpen,
    manifestationBlock,
  } = proposal;

  const proposalSnapshot = {
    kind: 'PRESSURE' as const,
    proposalId,
    valueAnchorId,
    sourceReference: sourceReference ?? '',
    operator,
    affectedDimension,
    adverseProspect,
    authorityReferences: [...authorityReferences],
    persistenceTarget,
    responseWindowOpen,
    hasManifestationBlock: !!manifestationBlock,
  };

  // Step 3: Check response window FIRST
  if (responseWindowOpen !== true) {
    return {
      version: 1,
      outcome: 'REJECTED',
      reasonCode: 'RESPONSE_WINDOW_CLOSED',
      preState: normalizedPreState,
      postState: normalizedPreState,
      admittedManifestation: false,
      acceptedThreadId: null,
      proposalSnapshot,
      boundedOutChangeIds: [],
    };
  }

  // Value Anchor must exist in Blueprint baseline
  const availableAnchors =
    currentContext.horrorGrammar?.authoringBaseline?.valueAnchors ||
    blueprint?.horrorGrammar?.valueAnchors ||
    currentContext.horrorGrammar?.relevantValueAnchors ||
    [];
  const matchingAnchor = availableAnchors.find((a) => a.id === valueAnchorId);

  if (!matchingAnchor) {
    return {
      version: 1,
      outcome: 'REJECTED',
      reasonCode: 'VALUE_ANCHOR_NOT_FOUND',
      preState: normalizedPreState,
      postState: normalizedPreState,
      admittedManifestation: false,
      acceptedThreadId: null,
      proposalSnapshot,
      boundedOutChangeIds: [],
    };
  }

  const isVillainProtagonist =
    currentContext.villainProtagonist === true ||
    blueprint?.villainProtagonist === true;

  // Exact canonical evidence registry lookup
  const registryMap = getEligibleEvidenceRegistryMap(
    isVillainProtagonist && !currentContext.villainProtagonist
      ? { ...currentContext, villainProtagonist: true }
      : currentContext,
    null,
    null,
    normalizedPreState
  );

  let validatedSourceRef = sourceReference;

  const isSelfSourceClaim =
    sourceReference === 'SELF' ||
    (Boolean(currentContext.player?.characterId) &&
      sourceReference === currentContext.player.characterId);

  if (isSelfSourceClaim) {
    if (!isVillainProtagonist) {
      return {
        version: 1,
        outcome: 'REJECTED',
        reasonCode: 'UNAUTHORIZED_PRESSURE_CLAIM',
        preState: normalizedPreState,
        postState: normalizedPreState,
        admittedManifestation: false,
        acceptedThreadId: null,
        proposalSnapshot,
        boundedOutChangeIds: [],
      };
    }
    validatedSourceRef = sourceReference;
  } else {
    // Check if sourceReference claims same-turn activity
    const actProposal = activityReceipt?.proposalSnapshot as
      | { kind?: string; proposalId?: string; castMemberId?: string }
      | undefined;
    const isActivitySourceClaim =
      sourceReference === 'ACTIVITY' ||
      Boolean(activityReceipt?.acceptedEventId && sourceReference === activityReceipt.acceptedEventId) ||
      Boolean(
        actProposal &&
          actProposal.kind === 'ACTIVITY' &&
          actProposal.proposalId &&
          sourceReference === actProposal.proposalId
      ) ||
      (Boolean(activityReceipt) &&
        activityReceipt?.outcome === 'REJECTED' &&
        actProposal &&
        actProposal.kind === 'ACTIVITY' &&
        actProposal.castMemberId &&
        sourceReference.includes(actProposal.castMemberId));

    if (isActivitySourceClaim) {
      if (!activityReceipt || activityReceipt.outcome !== 'ACCEPTED') {
        return {
          version: 1,
          outcome: 'REJECTED',
          reasonCode: 'ACTIVITY_SOURCE_NOT_ACCEPTED',
          preState: normalizedPreState,
          postState: normalizedPreState,
          admittedManifestation: false,
          acceptedThreadId: null,
          proposalSnapshot,
          boundedOutChangeIds: [],
        };
      }
      validatedSourceRef = activityReceipt.acceptedEventId || 'ACTIVITY';
    } else if (sourceReference === 'BASELINE') {
      validatedSourceRef = 'BASELINE';
    } else {
      // Check against pre-state threads, recent committed activity events, or canonical registry
      const isPreThread = normalizedPreState.some((t) => t.id === sourceReference);
      const isPreEvent = (currentContext.horrorGrammar?.runtimeState?.recentActivityEvents || []).some(
        (e) => e.id === sourceReference
      );
      const matchInRegistry = registryMap.get(sourceReference);

      if (!isPreThread && !isPreEvent && !matchInRegistry) {
        return {
          version: 1,
          outcome: 'REJECTED',
          reasonCode: 'INVALID_SOURCE_REFERENCE',
          preState: normalizedPreState,
          postState: normalizedPreState,
          admittedManifestation: false,
          acceptedThreadId: null,
          proposalSnapshot,
          boundedOutChangeIds: [],
        };
      }

      if (matchInRegistry) {
        if (
          matchInRegistry.category === 'OPPORTUNITY' ||
          matchInRegistry.category === 'EXPRESSION_CAPABILITY'
        ) {
          return {
            version: 1,
            outcome: 'REJECTED',
            reasonCode: 'UNAUTHORIZED_PRESSURE_CLAIM',
            preState: normalizedPreState,
            postState: normalizedPreState,
            admittedManifestation: false,
            acceptedThreadId: null,
            proposalSnapshot,
            boundedOutChangeIds: [],
          };
        }
      }
    }
  }

  // 3b. Authority references validation
  const authorityRefs = proposal.authorityReferences || [];
  for (const ref of authorityRefs) {
    const matchInRegistry = registryMap.get(ref);
    const isPreThread = normalizedPreState.some((t) => t.id === ref);
    const isPreEvent = (currentContext.horrorGrammar?.runtimeState?.recentActivityEvents || []).some(
      (e) => e.id === ref
    );
    const isAcceptedActivity =
      activityReceipt?.outcome === 'ACCEPTED' &&
      (ref === 'ACTIVITY' || ref === activityReceipt.acceptedEventId);

    if (!matchInRegistry && !isPreThread && !isPreEvent && !isAcceptedActivity) {
      return {
        version: 1,
        outcome: 'REJECTED',
        reasonCode: 'INVALID_AUTHORITY_REFERENCE',
        preState: normalizedPreState,
        postState: normalizedPreState,
        admittedManifestation: false,
        acceptedThreadId: null,
        proposalSnapshot,
        boundedOutChangeIds: [],
      };
    }

    if (matchInRegistry) {
      if (
        matchInRegistry.category === 'OPPORTUNITY' ||
        matchInRegistry.category === 'EXPRESSION_CAPABILITY'
      ) {
        const isSpeakerMatchingActor =
          manifestationBlock?.type === 'dialogue' &&
          (currentContext.cast || []).some(
            (c) => c.name === manifestationBlock.speaker && c.id === matchInRegistry.ownerRef
          );
        if (!isSpeakerMatchingActor) {
          return {
            version: 1,
            outcome: 'REJECTED',
            reasonCode: 'UNAUTHORIZED_PRESSURE_CLAIM',
            preState: normalizedPreState,
            postState: normalizedPreState,
            admittedManifestation: false,
            acceptedThreadId: null,
            proposalSnapshot,
            boundedOutChangeIds: [],
          };
        }
      }
    }
  }

  // 5. Validate manifestation block
  if (manifestationBlock) {
    if (manifestationBlock.type === 'dialogue') {
      // Environmental or non-character pressure cannot use dialogue
      const isActivitySource =
        sourceReference === 'ACTIVITY' ||
        (Boolean(activityReceipt?.acceptedEventId) &&
          sourceReference === activityReceipt?.acceptedEventId) ||
        (currentContext.horrorGrammar?.runtimeState?.recentActivityEvents || []).some(
          (e) => e.id === sourceReference
        ) ||
        registryMap.get(sourceReference)?.category === 'ACTIVITY_EVENT';

      if (!isActivitySource && matchingAnchor.holder.kind !== 'CHARACTER') {
        return {
          version: 1,
          outcome: 'REJECTED',
          reasonCode: 'ENVIRONMENTAL_PRESSURE_CANNOT_USE_DIALOGUE',
          preState: normalizedPreState,
          postState: normalizedPreState,
          admittedManifestation: false,
          acceptedThreadId: null,
          proposalSnapshot,
          boundedOutChangeIds: [],
        };
      }

      const speakerName = manifestationBlock.speaker?.trim();
      const speakerCast = (currentContext.cast || []).find((c) => c.name === speakerName);
      if (
        !speakerCast ||
        speakerCast.isUserCharacter ||
        speakerCast.id === currentContext.player.characterId
      ) {
        return {
          version: 1,
          outcome: 'REJECTED',
          reasonCode: 'INVALID_PRESSURE_MANIFESTATION_SPEAKER',
          preState: normalizedPreState,
          postState: normalizedPreState,
          admittedManifestation: false,
          acceptedThreadId: null,
          proposalSnapshot,
          boundedOutChangeIds: [],
        };
      }
    }
  }

  // 6. Check existing thread or thread limit
  const existingThreadIndex = normalizedPreState.findIndex(
    (t) => t.valueAnchorId === valueAnchorId && t.status === 'OPEN'
  );

  let threadId = proposalId || `thr-${currentTurn}-${valueAnchorId}`;
  let postState: SituatedPressureThread[];

  if (existingThreadIndex >= 0) {
    // Update existing open thread
    const existing = normalizedPreState[existingThreadIndex];
    threadId = existing.id;
    const updatedThread: SituatedPressureThread = {
      ...existing,
      sourceReference: validatedSourceRef,
      operator,
      affectedDimension,
      adverseProspect: adverseProspect.trim(),
      manifestationSummary: manifestationBlock
        ? manifestationBlock.content.slice(0, 200)
        : existing.manifestationSummary,
      lastChangedTurn: currentTurn,
      persistenceTarget,
      authorityReferences,
    };

    postState = [...normalizedPreState];
    postState[existingThreadIndex] = updatedThread;
  } else {
    // Check capacity limit
    const openThreadsCount = normalizedPreState.filter((t) => t.status === 'OPEN').length;
    if (openThreadsCount >= MAX_ACTIVE_PRESSURE_THREADS) {
      const droppedId =
        (proposal as { id?: string; proposalId?: string }).id ?? proposal.proposalId;
      return {
        version: 1,
        outcome: 'REJECTED',
        reasonCode: 'MAX_PRESSURE_THREADS_REACHED',
        preState: normalizedPreState,
        postState: normalizedPreState,
        admittedManifestation: false,
        acceptedThreadId: null,
        proposalSnapshot,
        boundedOutChangeIds: droppedId ? [droppedId] : [],
      };
    }

    // Create new thread with holder directly copied from the canonical anchor
    const newThread: SituatedPressureThread = {
      id: threadId,
      valueAnchorId: matchingAnchor.id,
      holder: matchingAnchor.holder, // Copied from accepted Anchor, never trusted from echo
      sourceReference: validatedSourceRef,
      operator,
      affectedDimension,
      adverseProspect: adverseProspect.trim(),
      manifestationSummary: manifestationBlock ? manifestationBlock.content.slice(0, 200) : null,
      status: 'OPEN',
      createdTurn: currentTurn,
      lastChangedTurn: currentTurn,
      persistenceTarget,
      authorityReferences,
    };

    postState = [...normalizedPreState, newThread];
  }

  const isSelfSourced = isVillainProtagonist && isSelfSourceClaim;

  return {
    version: 1,
    outcome: 'ACCEPTED',
    reasonCode: isSelfSourced ? 'SELF_SOURCED_PRESSURE' : 'PRESSURE_RATIFIED',
    preState: normalizedPreState,
    postState,
    admittedManifestation: !!manifestationBlock,
    acceptedThreadId: threadId,
    proposalSnapshot,
    boundedOutChangeIds: [],
  };
}

export interface ResolvePressureThreadTransitionsInput {
  proposal?: import('../types/horrorGrammar').PressureThreadTransitionProposal | null;
  preThreads?: SituatedPressureThread[] | null;
  currentTurn: number;
  validCauses: readonly string[];
}

export function resolvePressureThreadTransitions({
  proposal,
  preThreads = [],
  currentTurn,
  validCauses,
}: ResolvePressureThreadTransitionsInput): import('../types/horrorGrammar').PressureThreadTransitionReceipt {
  const normalizedPreState = Array.isArray(preThreads) ? [...preThreads] : [];
  const postState = [...normalizedPreState];
  const decisions: import('../types/horrorGrammar').PressureThreadTransitionReceipt['decisions'] = [];

  const transitions = proposal?.transitions || [];
  if (transitions.length === 0) {
    return {
      version: 1,
      preState: normalizedPreState,
      postState: normalizedPreState,
      decisions: [],
      boundedOutChangeIds: [],
    };
  }

  for (const trans of transitions.slice(0, 2)) {
    const { threadId, proposedStatus, causeReference, replacementAdverseProspect } = trans;

    const threadIndex = postState.findIndex((t) => t.id === threadId);
    if (threadIndex < 0) {
      decisions.push({
        threadId,
        proposedStatus,
        outcome: 'REJECTED',
        reasonCode: 'THREAD_NOT_FOUND',
        causeReference,
      });
      continue;
    }

    const currentThread = postState[threadIndex];
    if (currentThread.status !== 'OPEN') {
      decisions.push({
        threadId,
        proposedStatus,
        outcome: 'REJECTED',
        reasonCode: 'THREAD_ALREADY_CLOSED',
        causeReference,
      });
      continue;
    }

    const isCauseValid = isHorrorGrammarCauseReferenceValid(
      causeReference,
      validCauses
    );

    if (!isCauseValid) {
      decisions.push({
        threadId,
        proposedStatus,
        outcome: 'REJECTED',
        reasonCode: 'UNSUPPORTED_CAUSE_REFERENCE',
        causeReference,
      });
      continue;
    }

    if (proposedStatus === 'TRANSFORMED') {
      // Close existing thread as TRANSFORMED
      postState[threadIndex] = {
        ...currentThread,
        status: 'TRANSFORMED',
        lastChangedTurn: currentTurn,
      };

      // Create new replacement thread
      const newThreadId = `thr-${currentTurn}-${currentThread.valueAnchorId}-trans`;
      const replacementThread: SituatedPressureThread = {
        id: newThreadId,
        valueAnchorId: currentThread.valueAnchorId,
        holder: currentThread.holder,
        sourceReference: causeReference,
        operator: currentThread.operator,
        affectedDimension: currentThread.affectedDimension,
        adverseProspect: replacementAdverseProspect?.trim() || currentThread.adverseProspect,
        manifestationSummary: null,
        status: 'OPEN',
        createdTurn: currentTurn,
        lastChangedTurn: currentTurn,
        persistenceTarget: currentThread.persistenceTarget,
        authorityReferences: currentThread.authorityReferences || [],
      };

      postState.push(replacementThread);
    } else {
      postState[threadIndex] = {
        ...currentThread,
        status: proposedStatus as SituatedPressureThread['status'],
        lastChangedTurn: currentTurn,
      };
    }

    decisions.push({
      threadId,
      proposedStatus,
      outcome: 'APPLIED',
      reasonCode: 'PRESSURE_TRANSITION_APPLIED',
      causeReference,
    });
  }

  const boundedOutChangeIds = transitions.slice(2).map((t) => t.threadId);

  return {
    version: 1,
    preState: normalizedPreState,
    postState,
    decisions,
    boundedOutChangeIds,
  };
}

