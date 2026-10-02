/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  RatifiedEngineFrame,
  DecayThreshold,
  DecayState,
  PlayerRole,
  RuntimeStateSnapshot,
  TurnResponseSchema,
  NarrativeBlock,
  Message,
  TransitionReceipt,
} from '../types';
import { useAppStore } from '../store/useAppStore';
import { useEngineStore } from '../core/store';
import { calculatePhysicsState } from '../core/matrix/physicsMatrix';
import { buildEngineTurnContext, buildContextReceipt } from './buildEngineTurnContext';
import { readTurnResponse, createNetworkTurnError, TurnResponseError } from './turnResponseReader';
export { TurnResponseError };
import { captureRuntimeSnapshot } from '../core/engine/snapshot';
import { streamEngineTurn } from '../services/geminiService';

export const DECAY_SCALE: DecayThreshold[] = [
  {
    stage: 'STABLE',
    maxSkepticism: 1.0,
    minSkepticism: 0.61,
    environmentalCoherence: 1.0,
    narrativeDivergence: 'NONE',
  },
  {
    stage: 'FRAYING',
    maxSkepticism: 0.6,
    minSkepticism: 0.31,
    environmentalCoherence: 0.7,
    narrativeDivergence: 'LATENT_AMBIGUITY',
  },
  {
    stage: 'UNSTABLE',
    maxSkepticism: 0.3,
    minSkepticism: 0.01,
    environmentalCoherence: 0.3,
    narrativeDivergence: 'STRUCTURAL_DISTORTION',
  },
  {
    stage: 'SHATTERED',
    maxSkepticism: 0.0,
    minSkepticism: 0.0,
    environmentalCoherence: 0.0,
    narrativeDivergence: 'TOPOLOGICAL_PARADOX',
  },
];

/**
 * @deprecated Packet 10 eliminated destructive phrase replacement in favor of non-destructive frame validation.
 * Raw prose and dialogue are preserved without token-by-token sanitization.
 */
export function applyAntiRescueLinter(rawProse: string): string {
  return rawProse;
}

/**
 * Detects clearly unsolicited out-of-character (OOC) narrator safety interventions
 * breaking the fictional frame, distinguishing them from in-world character speech,
 * internal monologue, in-scenario reprieves, or ambiguous psychological prose.
 *
 * Bounded Disposition Policy (Packet 10):
 * - Attributed Speech (Protected): All blocks of type 'dialogue', blocks with an attributed
 *   speaker, and blocks of type 'internal_monologue' are in-world persona expressions and are
 *   never flagged as frame breaches.
 * - In-Scenario Prose & Reprieves (Protected): In-world descriptions of safety, sanctuary,
 *   resting, dreams, or psychological grounding survive intact.
 * - Explicit OOC Narrator Interventions (Rejected): Prose blocks where the narrator breaks
 *   the fourth wall to address the real player with AI safety/welfare disclaimers, crisis
 *   helpline numbers, or instructions to step away from the screen are rejected with
 *   rejected_fields: ['narrative_frame'] -> FRAME_VALIDATION_REJECTED.
 * - Ambiguous Second-Person Prose (Admitted by Default): If second-person prose contains
 *   comforting or grounding language without explicit fourth-wall breaks, AI self-identification,
 *   or crisis references, it is admitted as in-scenario narration to prevent false rejections
 *   of legitimate horror reprieves and false-security tropes.
 */
export function detectOutOfCharacterNarratorCheckin(block: NarrativeBlock): {
  isBreach: boolean;
  reason?: string;
} {
  if (!block || typeof block !== 'object') {
    return { isBreach: false };
  }

  // 1. Attribution Protection: in-character dialogue or explicit speaker attribution
  const blockType = (block.type || '').toLowerCase();
  const hasSpeaker = typeof block.speaker === 'string' && block.speaker.trim().length > 0;
  if (blockType === 'dialogue' || hasSpeaker) {
    return { isBreach: false };
  }

  // 2. Character internal monologue is in-world reflection
  if (blockType === 'internal_monologue') {
    return { isBreach: false };
  }

  const rawContent =
    typeof block.content === 'string'
      ? block.content
      : typeof block.text === 'string'
        ? block.text
        : '';
  if (!rawContent || rawContent.trim().length === 0) {
    return { isBreach: false };
  }

  const content = rawContent.trim();

  // 3. Quoted speech within prose (e.g. "You are safe," she whispered.) is in-world character speech
  if (content.startsWith('"') && content.endsWith('"') && !content.slice(1, -1).includes('"')) {
    return { isBreach: false };
  }

  // 4. Inspect non-dialogue narrator prose for explicit OOC fourth-wall breaches:

  // 4a. Explicit OOC / meta-narrator markers
  const explicitMetaMarker =
    /^\[?\s*(?:ooc|out of character)\s*[:\]]/i.test(content) ||
    /\b(stepping out of character|breaking character|pausing the (story|game|simulation) to check (in )?on you)\b/i.test(
      content
    );
  if (explicitMetaMarker) {
    return {
      isBreach: true,
      reason:
        'OUT_OF_CHARACTER_NARRATOR_CHECKIN: The model used an explicit out-of-character meta marker to address the user.',
    };
  }

  // 4b. AI assistant identity self-declarations addressing the user
  const aiIdentityDisclosure =
    /\b(as an ai|as a language model|as an ai assistant|as your ai (companion|assistant|guide))\b/i.test(
      content
    );
  if (aiIdentityDisclosure) {
    return {
      isBreach: true,
      reason:
        'OUT_OF_CHARACTER_NARRATOR_CHECKIN: The narrator addressed the user as an AI language model rather than maintaining the fictional frame.',
    };
  }

  // 4c. Real-world crisis support and emergency helpline referrals
  const crisisReferral =
    /\b(crisis (hotline|lifeline|text line|helpline)|suicide prevention|call (or text )?988|reach out to a (mental health|healthcare) professional)\b/i.test(
      content
    );
  if (crisisReferral) {
    return {
      isBreach: true,
      reason:
        'OUT_OF_CHARACTER_NARRATOR_CHECKIN: The response injected real-world crisis intervention / helpline resources into narrative prose.',
    };
  }

  // 4d. Direct fourth-wall user welfare interventions instructing disengagement
  const welfareDisengagement =
    /\b(if you (are feeling|feel) (overwhelmed|distressed|unsafe|triggered))\b.*?\b(step away|take a break|stop playing|remember this is (just|only) a (game|fiction|simulation))\b/is.test(
      content
    ) ||
    /\b(remember this is (just|only) a (game|fiction|simulation))\b.*?\b(step away|take a break|your (mental health|well-being|safety))\b/is.test(
      content
    ) ||
    /\b(step away from the (screen|computer|keyboard|game))\b/i.test(content) ||
    /\b(ground yourself in (your|the) real (room|world|physical space))\b/i.test(content) ||
    /\b(take care of your real-world (well-being|mental health|safety))\b/i.test(content);
  if (welfareDisengagement) {
    return {
      isBreach: true,
      reason:
        'OUT_OF_CHARACTER_NARRATOR_CHECKIN: The narrator broke the fourth wall to instruct the user to step away or disengage for real-world welfare.',
    };
  }

  // 5. Default Bounded Disposition: Admitted as in-scenario narration
  return { isBreach: false };
}

export const calculateDecayState = (skepticism: number): DecayState => {
  // Normalize boundaries
  const normalizedSkepticism = Math.max(0.0, Math.min(1.0, skepticism));
  const threshold =
    DECAY_SCALE.find(
      (t) => normalizedSkepticism >= t.minSkepticism && normalizedSkepticism <= t.maxSkepticism
    ) || DECAY_SCALE[0];

  return {
    currentStage: threshold.stage,
    coherenceRating: threshold.environmentalCoherence,
    divergenceMode: threshold.narrativeDivergence,
  };
};

export const validateEngineFrame = (rawPayload: any): RatifiedEngineFrame => {
  const rejected: string[] = [];
  const notes: string[] = [];

  // 1. Structural Check
  if (!rawPayload || typeof rawPayload !== 'object') {
    return createFailedFrame('CRITICAL_ERROR', 'Payload is completely malformed or undefined.');
  }

  // 2. Extract and Normalize
  const blocks = (
    Array.isArray(rawPayload.narrative_blocks) ? rawPayload.narrative_blocks : []
  ).map((b: any) => {
    const content = b.content;

    if (b.type === 'dialogue' && b.speaker) {
      const spk = String(b.speaker).toUpperCase().trim();
      if (spk === 'THE VOICE' || spk === 'VOICE') {
        return { ...b, content, speaker: 'SYSTEM ANOMALY' };
      }
    }
    return { ...b, content };
  });
  const logic = rawPayload.logic_state || {};
  const thoughts = rawPayload.engine_thoughts || rawPayload.engine_logic || '';

  // 3. Validation Logic
  if (blocks.length === 0) {
    rejected.push('narrative_blocks');
    notes.push('Warning: Engine returned zero narrative blocks.');
  }

  // Check for narrative frame breaches (unsolicited out-of-character narrator check-ins)
  for (const block of blocks) {
    const checkin = detectOutOfCharacterNarratorCheckin(block);
    if (checkin.isBreach) {
      rejected.push('narrative_frame');
      notes.push(
        checkin.reason ||
          'OUT_OF_CHARACTER_NARRATOR_CHECKIN: The engine detected an unsolicited out-of-character safety intervention breaking the fictional frame.'
      );
      break;
    }
  }

  const accepted = rejected.length === 0;

  const matrixMutation =
    logic.matrix_mutation ||
    (logic.matrix_shift
      ? {
          next_vector: logic.matrix_shift.next_vector,
          next_tier: logic.matrix_shift.next_tier,
        }
      : null);

  return {
    narrative_blocks: blocks,
    engine_thoughts: String(thoughts),
    logic_state: {
      current_phase: logic.current_phase || 'LATENT',
      requested_transition: logic.requested_transition || null,
      suggested_tension: logic.suggested_tension,
      matrix_mutation: matrixMutation,
      terminal_flags: Array.isArray(logic.terminal_flags) ? logic.terminal_flags : [],
      cast_ledger: Array.isArray(logic.cast_ledger) ? logic.cast_ledger : [],
      cast_deltas: Array.isArray(logic.cast_deltas) ? logic.cast_deltas : [],
      cast_arrivals: Array.isArray(logic.cast_arrivals)
        ? logic.cast_arrivals.filter((id: unknown) => typeof id === 'string')
        : [],
      cast_departures: Array.isArray(logic.cast_departures)
        ? logic.cast_departures.filter((id: unknown) => typeof id === 'string')
        : [],
      dramaturgyState: logic.dramaturgyState || null,
    },
    topologyDelta: rawPayload.topologyDelta || null,
    wound_facts: Array.isArray(rawPayload.wound_facts) ? rawPayload.wound_facts : [],
    treatment_proposals: Array.isArray(rawPayload.treatment_proposals) ? rawPayload.treatment_proposals : [],
    objectTransitions: Array.isArray(rawPayload.objectTransitions) && rawPayload.objectTransitions.length > 0 ? rawPayload.objectTransitions : undefined,
    objectTransitionReceipt: Array.isArray(rawPayload.objectTransitionReceipt) ? rawPayload.objectTransitionReceipt : undefined,
    attentionTransitions: Array.isArray(rawPayload.attentionTransitions) && rawPayload.attentionTransitions.length > 0 ? rawPayload.attentionTransitions : undefined,
    attentionTransitionReceipt: Array.isArray(rawPayload.attentionTransitionReceipt) ? rawPayload.attentionTransitionReceipt : undefined,
    validation: {
      accepted,
      rejected_fields: rejected,
      repair_notes: notes,
    },
  };
};

const createFailedFrame = (errorType: string, note: string): RatifiedEngineFrame => ({
  narrative_blocks: [
    { type: 'system_voice', content: '[ SYSTEM FAILURE: UNABLE TO RENDER REALITY CONSTRUCT ]' },
  ],
  engine_thoughts: 'FATAL PARSE ERROR.',
  logic_state: {
    current_phase: 'LATENT',
    terminal_flags: [],
    cast_ledger: [],
    cast_deltas: [],
  },
  topologyDelta: { isExpansion: false },
  validation: { accepted: false, rejected_fields: [errorType], repair_notes: [note] },
});

/**
 * Projects playable narrative blocks from simulation state for prompt history.
 * Combines accepted opening narration from history with canonical storyLog,
 * preserving chronological order, bounded history limits, and preventing duplicate opening entries
 * while excluding failure messages, system diagnostics, and rejected candidate turns.
 */
export function projectPlayableStoryBlocks(state: {
  history?: Message[];
  storyLog?: NarrativeBlock[];
}): NarrativeBlock[] {
  const storyLogBlocks = state.storyLog || [];
  const historyMessages = state.history || [];

  const isFailedOrSystemMessage = (msg: Message): boolean => {
    if (msg.role === 'system') return true;
    if (msg.validation && !msg.validation.accepted) return true;
    if (msg.turnReceipt && !msg.turnReceipt.accepted) return true;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (
      content.startsWith('[CRITICAL ENGINE FAILURE]') ||
      content.startsWith('[TURN_FAILED]') ||
      content.startsWith('[ SYSTEM:') ||
      content.startsWith('[SYSTEM:')
    ) {
      return true;
    }
    return false;
  };

  const serializeBlock = (b: NarrativeBlock): string =>
    `${(b.type || 'prose').toLowerCase()}:${(b.speaker || '').trim()}:${(b.content || b.text || '').trim()}`;

  const historyBlocks: NarrativeBlock[] = [];
  for (const msg of historyMessages) {
    if (isFailedOrSystemMessage(msg)) continue;
    if (msg.role === 'user') continue;

    if (Array.isArray(msg.blocks) && msg.blocks.length > 0) {
      for (const b of msg.blocks) {
        if (b && typeof b === 'object') {
          historyBlocks.push(b);
        }
      }
    } else if (
      (msg.role === 'assistant' || msg.role === 'narrative') &&
      typeof msg.content === 'string' &&
      msg.content.trim().length > 0
    ) {
      historyBlocks.push({
        type: 'prose',
        content: msg.content.trim(),
      });
    }
  }

  if (storyLogBlocks.length > 0) {
    const seen = new Set(storyLogBlocks.map(serializeBlock));
    const missingPreBlocks: NarrativeBlock[] = [];
    for (const b of historyBlocks) {
      const key = serializeBlock(b);
      if (!seen.has(key)) {
        missingPreBlocks.push(b);
        seen.add(key);
      }
    }
    return [...missingPreBlocks, ...storyLogBlocks];
  }

  const result: NarrativeBlock[] = [];
  const seen = new Set<string>();
  for (const b of historyBlocks) {
    const key = serializeBlock(b);
    if (!seen.has(key)) {
      result.push(b);
      seen.add(key);
    }
  }
  return result;
}

export function formatRecentHistory(blocks: NarrativeBlock[]): string {
  return blocks
    .slice(-6)
    .map((block) => {
      const type = (block.type || 'PROSE').toUpperCase();
      const speaker =
        block.type === 'dialogue' && block.speaker
          ? ` | ${block.speaker}`
          : '';
      return `[${type}${speaker}]: ${(block.content || '').substring(0, 60)}...`;
    })
    .join('\n');
}

export interface ExecuteRatificationPipelineOptions {
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export function isPreviousTransitionRejected(
  receipt?: TransitionReceipt | null
): boolean {
  if (!receipt) return false;
  return receipt.accepted === false && receipt.reason !== 'NO_MOVEMENT_REQUESTED';
}

export const executeRatificationPipeline = async (
  userAction: string,
  suppliedSnapshot?: RuntimeStateSnapshot,
  options?: ExecuteRatificationPipelineOptions
): Promise<RatifiedEngineFrame> => {
  const state = useAppStore.getState();
  const engineState = useEngineStore.getState();

  // Exactly one pre-turn snapshot: use suppliedSnapshot if provided, otherwise fallback-capture for internal/SYSTEM_INIT
  const preSnapshot = suppliedSnapshot || captureRuntimeSnapshot(state);

  const currentTension = preSnapshot.tension;
  const currentCoherence = preSnapshot.coherence;
  const physicsMatrix = calculatePhysicsState(currentTension, currentCoherence, {
    blueprint: engineState.activeBlueprint,
    participationContext: state.participationContext || engineState.participationContext || null,
  });

  const selectedRole = (engineState.gameState?.player_role as PlayerRole) || 'protagonist';
  const playerCharacterId = engineState.gameState?.player_character_id;

  const acceptedTriggerReferences: string[] = [];
  const rawEvents = engineState.gameState?.activity_events || [];
  for (const evt of rawEvents) {
    acceptedTriggerReferences.push(evt.id);
    if (Array.isArray(evt.authorityReferences)) {
      for (const ref of evt.authorityReferences) {
        if (ref && !acceptedTriggerReferences.includes(ref)) {
          acceptedTriggerReferences.push(ref);
        }
      }
    }
  }
  const rawThreads = engineState.gameState?.pressure_threads || [];
  for (const thread of rawThreads) {
    acceptedTriggerReferences.push(thread.id);
  }
  const rawFlags = state.activeMemory?.systemFlags || preSnapshot.activeFlags || [];
  for (const f of rawFlags) {
    if (f && !acceptedTriggerReferences.includes(f)) {
      acceptedTriggerReferences.push(f);
    }
  }

  const turnContext = buildEngineTurnContext({
    blueprint: engineState.activeBlueprint,
    selectedRole,
    selectedCharacterId: playerCharacterId,
    spatialGraph: state.spatialGraph,
    participationContext: state.participationContext || engineState.participationContext || null,
    characterContinuity: engineState.gameState?.character_continuity,
    characterPresence: engineState.gameState?.character_presence,
    consequenceState: {
      inventory: engineState.gameState?.inventory,
      player_injuries: engineState.gameState?.player_injuries,
      psychological_status: engineState.gameState?.psychological_status,
    },
    characterStance: engineState.gameState?.character_stance,
    characterRelationships: engineState.gameState?.character_relationships,
    characterMemory: engineState.gameState?.character_memory,
    worldMemory: engineState.gameState?.world_memory,
    fictionalTimeLedger: engineState.gameState?.fictional_time_ledger,
    pursuitScheduleLedger: engineState.gameState?.pursuit_schedule_ledger,
    activityEvents: engineState.gameState?.activity_events,
    pressureThreads: engineState.gameState?.pressure_threads,
    valueStateLedger: engineState.gameState?.value_state_ledger,
    characterPursuitLedger: engineState.gameState?.character_pursuit_ledger,
    characterDevelopmentLedger: engineState.gameState?.character_development_ledger,
    dramaturgyRuntimeState: engineState.gameState?.dramaturgy_state,
    acceptedTriggerReferences,
    runtimeState: {
      ...preSnapshot,
      playerCharacterId,
      worldMemory: engineState.gameState?.world_memory,
      fictionalTimeLedger: engineState.gameState?.fictional_time_ledger,
      pursuitScheduleLedger: engineState.gameState?.pursuit_schedule_ledger,
      activityEvents: engineState.gameState?.activity_events,
      pressureThreads: engineState.gameState?.pressure_threads,
      valueStateLedger: engineState.gameState?.value_state_ledger,
      characterPursuitLedger: engineState.gameState?.character_pursuit_ledger,
      characterDevelopmentLedger: engineState.gameState?.character_development_ledger,
      dramaturgyRuntimeState: engineState.gameState?.dramaturgy_state,
    },
  });

  // Distill the history to a compressed array instead of full prose
  const recentHistory = formatRecentHistory(projectPlayableStoryBlocks(state));

  const currentNode = state.spatialGraph?.find((n: any) => n.id === preSnapshot.currentNodeId);
  let matchingExitDirection: string | null = null;

  if (currentNode && (currentNode as any).exits) {
    const exits = (currentNode as any).exits;
    const attemptedExit = exits.find(
      (exit: any) =>
        exit.description && userAction.toLowerCase().includes(exit.description.toLowerCase())
    );

    if (
      attemptedExit &&
      (attemptedExit.targetNodeId === 'NODE_UNMAPPED' ||
        attemptedExit.targetNodeId.startsWith('unmaterialized_'))
    ) {
      matchingExitDirection = attemptedExit.description;
    }
  }

  // SYSTEM_INIT is strictly non-expanding
  const isExpansionExpected = userAction !== 'SYSTEM_INIT' && !!matchingExitDirection;

  const lastAssistantMessage = [...(state.history || [])]
    .reverse()
    .find((m) => m.role === 'assistant');
  const previousTransitionReceipt: TransitionReceipt | null | undefined =
    (suppliedSnapshot as any)?.transitionReceipt ??
    (suppliedSnapshot as any)?.lastTransitionReceipt ??
    (state as any).transitionReceipt ??
    (state as any).lastTransitionReceipt ??
    lastAssistantMessage?.transitionReceipt ??
    null;

  const previousTransitionRejected = isPreviousTransitionRejected(previousTransitionReceipt);

  const payload = {
    userAction,
    recentHistory,
    systemDirective: physicsMatrix.generativeDirective,
    isExpansionExpected,
    stateContext: {
      currentNodeId: preSnapshot.currentNodeId,
      currentPhase: preSnapshot.phase,
      tensionLevel: currentTension,
      reconciliationRevision: preSnapshot.reconciliationRevision,
      activeVector: preSnapshot.activeVector,
      activeTier: preSnapshot.activeTier,
      ...(previousTransitionRejected ? { lastTransitionRejected: true } : {}),
    },
    context: turnContext,
  };

  let rawJson: unknown;
  let responseStatus: number | null = null;
  let responseContentType: string | null = null;

  if (options?.onToken) {
    try {
      rawJson = await streamEngineTurn(
        payload,
        { onToken: options.onToken },
        options.signal
      );
      responseStatus = 200;
    } catch (streamErr: any) {
      if (streamErr instanceof TurnResponseError) throw streamErr;
      if (streamErr?.code === 'MODEL_CONTRACT_MISMATCH') {
        throw new TurnResponseError({
          code: 'MODEL_CONTRACT_MISMATCH',
          message: streamErr.message,
          diagnostics: streamErr.diagnostics,
        });
      }
      if (streamErr?.code === 'PROVIDER_REFUSAL') {
        throw new TurnResponseError({
          code: 'PROVIDER_REFUSAL',
          message: streamErr.message,
        });
      }
      throw createNetworkTurnError();
    }
  } else {
    let response: Response;
    try {
      response = await fetch('/api/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: options?.signal,
      });
    } catch {
      throw createNetworkTurnError();
    }

    responseStatus = response.status;
    responseContentType = response.headers?.get?.('content-type') || null;
    rawJson = await readTurnResponse<unknown>(response);
  }

  // Parse with canonical TurnResponseSchema
  const parsedResult = TurnResponseSchema.safeParse(rawJson);
  if (!parsedResult.success) {
    throw new TurnResponseError({
      code: 'STRUCTURAL_RESPONSE_MISMATCH',
      status: responseStatus,
      contentType: responseContentType,
      message: 'The turn service returned a response that did not match the canonical contract.',
    });
  }

  const validatedEvent = validateEngineFrame(parsedResult.data);
  if (validatedEvent.validation && !validatedEvent.validation.accepted) {
    throw new TurnResponseError({
      code: 'FRAME_VALIDATION_REJECTED',
      status: responseStatus,
      contentType: responseContentType,
      message: 'The turn response failed ratification validation.',
    });
  }

  validatedEvent.preSnapshot = preSnapshot;

  if (parsedResult.data.transitionReceipt) {
    validatedEvent.transitionReceipt = parsedResult.data.transitionReceipt;
  }

  if (parsedResult.data.castInteractionReceipt) {
    validatedEvent.castInteractionReceipt = parsedResult.data.castInteractionReceipt;
  }

  validatedEvent.intentReceipt = parsedResult.data.intentReceipt;
  validatedEvent.narrativeReconciliationReceipt =
    parsedResult.data.narrativeReconciliationReceipt;
  validatedEvent.canonicalConsequenceReceipt =
    parsedResult.data.canonicalConsequenceReceipt;
  validatedEvent.characterStanceReceipt =
    parsedResult.data.characterStanceReceipt;
  validatedEvent.characterRelationshipReceipt =
    parsedResult.data.characterRelationshipReceipt;
  validatedEvent.characterMemoryReceipt =
    parsedResult.data.characterMemoryReceipt;
  validatedEvent.worldMemoryReceipt =
    parsedResult.data.worldMemoryReceipt;
  if (parsedResult.data.worldMemoryReceipt) {
    validatedEvent.logic_state = {
      ...validatedEvent.logic_state,
      world_memory: parsedResult.data.worldMemoryReceipt.post_state,
    };
  }
  if (parsedResult.data.castActivityProposalReceipt) {
    validatedEvent.castActivityProposalReceipt = parsedResult.data.castActivityProposalReceipt;
    validatedEvent.logic_state = {
      ...validatedEvent.logic_state,
      activity_events: parsedResult.data.castActivityProposalReceipt.postState,
    };
  }
  if (parsedResult.data.situatedPressureReceipt) {
    validatedEvent.situatedPressureReceipt = parsedResult.data.situatedPressureReceipt;
    validatedEvent.logic_state = {
      ...validatedEvent.logic_state,
      pressure_threads: parsedResult.data.situatedPressureReceipt.postState,
    };
  }
  if (parsedResult.data.valueStateReceipt) {
    validatedEvent.valueStateReceipt = parsedResult.data.valueStateReceipt;
    validatedEvent.logic_state = {
      ...validatedEvent.logic_state,
      value_state_ledger: parsedResult.data.valueStateReceipt.postState,
    };
  }
  if (parsedResult.data.characterPursuitReceipt) {
    validatedEvent.characterPursuitReceipt = parsedResult.data.characterPursuitReceipt;
    validatedEvent.logic_state = {
      ...validatedEvent.logic_state,
      character_pursuit_ledger: parsedResult.data.characterPursuitReceipt.postState,
    };
  }
  if (parsedResult.data.characterDevelopmentReceipt) {
    validatedEvent.characterDevelopmentReceipt = parsedResult.data.characterDevelopmentReceipt;
    validatedEvent.logic_state = {
      ...validatedEvent.logic_state,
      character_development_ledger: parsedResult.data.characterDevelopmentReceipt.postState,
    };
  }
  if (parsedResult.data.pressureThreadTransitionReceipt) {
    validatedEvent.pressureThreadTransitionReceipt =
      parsedResult.data.pressureThreadTransitionReceipt;
    validatedEvent.logic_state = {
      ...validatedEvent.logic_state,
      pressure_threads: parsedResult.data.pressureThreadTransitionReceipt.postState,
    };
  }
  if (parsedResult.data.horrorGrammarForensics) {
    validatedEvent.horrorGrammarForensics = parsedResult.data.horrorGrammarForensics;
  }
  if (parsedResult.data.wound_facts) {
    validatedEvent.wound_facts = parsedResult.data.wound_facts;
  }
  if (parsedResult.data.treatment_proposals) {
    validatedEvent.treatment_proposals = parsedResult.data.treatment_proposals;
  }
  if (parsedResult.data.objectTransitions && parsedResult.data.objectTransitions.length > 0) {
    validatedEvent.objectTransitions = parsedResult.data.objectTransitions;
  }
  if (parsedResult.data.objectTransitionReceipt) {
    validatedEvent.objectTransitionReceipt = parsedResult.data.objectTransitionReceipt;
  }
  if (parsedResult.data.attentionTransitions && parsedResult.data.attentionTransitions.length > 0) {
    validatedEvent.attentionTransitions = parsedResult.data.attentionTransitions;
  }
  if (parsedResult.data.attentionTransitionReceipt) {
    validatedEvent.attentionTransitionReceipt = parsedResult.data.attentionTransitionReceipt;
  }

  // Attach context receipt for SYSTEM_INIT
  if (userAction === 'SYSTEM_INIT') {
    validatedEvent.contextReceipt = buildContextReceipt(turnContext, engineState.activeBlueprint);
  }

  // Consume server-derived deterministic HG1 receipts
  validatedEvent.fictionalTimeReceipt = parsedResult.data.fictionalTimeReceipt;
  validatedEvent.castActivityReceipt = parsedResult.data.castActivityReceipt;
  validatedEvent.pursuitScheduleReceipt = parsedResult.data.pursuitScheduleReceipt;
  if (parsedResult.data.dramaticTurnReceipt) {
    validatedEvent.dramaticTurnReceipt = parsedResult.data.dramaticTurnReceipt;
  }

  validatedEvent.logic_state = {
    ...validatedEvent.logic_state,
    fictional_time_ledger: parsedResult.data.fictionalTimeReceipt.postState,
    pursuit_schedule_ledger: parsedResult.data.pursuitScheduleReceipt.postState,
    ...(parsedResult.data.dramaticTurnReceipt
      ? { dramatic_turn_receipt: parsedResult.data.dramaticTurnReceipt }
      : {}),
  };

  // Expansion Guard:
  // If SYSTEM_INIT or no expansion was expected, suppress any rogue expansion
  if (userAction === 'SYSTEM_INIT' || !isExpansionExpected) {
    if (parsedResult.data.topologyDelta?.isExpansion) {
      validatedEvent.topologyDelta = { isExpansion: false, newNodeDef: null };
      if (!validatedEvent.validation) {
        validatedEvent.validation = { accepted: true, rejected_fields: [], repair_notes: [] };
      }
      validatedEvent.validation.repair_notes.push(
        '[GUARD] LLM emitted unexpected topology expansion; suppressed to maintain canonical graph.'
      );
    } else {
      validatedEvent.topologyDelta = parsedResult.data.topologyDelta || { isExpansion: false };
    }
  } else {
    validatedEvent.topologyDelta = parsedResult.data.topologyDelta
      ? {
          ...parsedResult.data.topologyDelta,
          exitDirection: matchingExitDirection,
        }
      : null;
  }

  return validatedEvent;
};
