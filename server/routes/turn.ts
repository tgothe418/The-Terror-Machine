import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SseStream } from '../utils/sse';
import {
  TurnRequestSchema,
  type TurnResult,
  type NarrativeBlock,
  TurnResponse,
  normalizeParticipationContext,
  type EngineTurnContext,
} from '../schemas/engine';
import type {
  CanonicalConsequenceProposal,
  CanonicalConsequenceReceipt,
} from '../../src/types/consequence';
import type {
  CharacterStanceProposal,
  CharacterStanceReceipt,
  CharacterStanceById,
} from '../../src/types/characterStance';
import { resolveCharacterStance } from '../../src/lib/characterStance';
import type {
  CharacterRelationshipProposal,
  CharacterRelationshipReceipt,
} from '../../src/types/characterRelationships';
import { resolveCharacterRelationships } from '../../src/lib/characterRelationships';
import { describeVillainDynamics } from '../../src/lib/villainDynamics';
import { isVillainCastMember } from '../../src/lib/castVillain';
import type {
  CharacterMemoryProposal,
  CharacterMemoryReceipt,
} from '../../src/types/characterMemory';
import { resolveCharacterMemory } from '../../src/lib/characterMemory';
import {
  WorldMemoryProposal,
  WorldMemoryReceipt,
} from '../../src/types/worldMemory';
import { resolveWorldMemory, selectSituatedWorldMemory } from '../../src/lib/worldMemory';
import { resolveCastActivity } from '../../src/lib/castActivity';
import {
  resolveSituatedPressure,
  resolvePressureThreadTransitions,
} from '../../src/lib/situatedPressure';
import { resolveValueState } from '../../src/lib/valueState';
import { resolveCharacterPursuit } from '../../src/lib/characterPursuits';
import { resolveCharacterDevelopment } from '../../src/lib/characterDevelopment';
import {
  buildHorrorGrammarValidCauses,
  HG1_CAUSE_REFERENCE_PROMPT,
} from '../../src/lib/horrorGrammarCauseReferences';
import { advanceFictionalTimeLedger } from '../../src/lib/fictionalTime';
import { advancePursuitScheduleLedger } from '../../src/lib/castActivityEligibility';
import type {
  FictionalTimeReceipt,
  PursuitScheduleReceipt,
} from '../../src/types/horrorGrammar';
import { executePacingGovernor } from '../../src/lib/pacingGovernor';
import {
  DramaturgyRuntimeStateSchema,
  type DramaturgyRuntimeState,
  type DramaticTurnReceipt,
} from '../../src/types/dramaturgy';
import {
  generateStructuredResponse,
  EngineTurnStructuredResponseContract,
  type StructuredResponseContract,
  ProviderRefusalError,
  EmptyProviderResponseError,
  ProviderRequestRejectedError,
  ProviderPrepaymentDepletedError,
  ProviderRateLimitError,
  ProviderCapacityError,
} from '../utils/aiClient';
import { GEMINI_TURN_NULL_SENTINEL } from '../ai/geminiTurnTransport';
import { resolveTransition } from '../engine/transitionResolver';
import { clampSkepticismDelta } from '../../src/lib/castContinuity';
import { createIntentReceipt } from '../../src/lib/intentReceipt';
import { createNarrativeReconciliationReceipt } from '../../src/lib/narrativeReconciliation';
import { resolveCanonicalConsequences } from '../../src/lib/canonicalConsequences';
import {
  evaluateCausalFeasibility,
  resolveExplicitCastTarget,
  type CastTargetResolution,
  type CausalFeasibilityResult,
} from '../../src/lib/causalFeasibility';
import { applyRoleAwareIntentPolicy } from '../../src/lib/roleAwareIntentPolicy';
import {
  createIntentBoundCastInteractionReceipt,
  getIntentBoundAddressedCharacterId,
  getSpatiallyRatifiableRequestedTransition,
  getThresholdBoundTopologyDelta,
} from '../../src/lib/intentConsequenceBridge';
import {
  buildAuditoryContext,
  validateAndNormalizeVocalization,
  formatVocalizationPromptDirective,
  isRecognizedAmbientSpeaker,
  REMOTE_DISCONNECT_PATTERNS,
  RECOGNIZED_AMBIENT_SPEAKER_PATTERN,
} from '../../src/lib/vocalizationEngine';
import { formatSomaticStatePrompt } from '../../src/lib/fearEngine';
import type {
  IntentReceipt,
  NarrativeReconciliationReceipt,
  TransitionReceipt,
  CastInteractionReceipt,
} from '../../src/types/engineContract';
import type {
  TurnFailureDiagnostics,
  TurnFailureDiagnosticIssue,
} from '../../src/types';

export function buildZodDiagnostics(zodError: z.ZodError): TurnFailureDiagnostics {
  const issues: TurnFailureDiagnosticIssue[] = [];
  const seen = new Set<string>();

  for (const issue of zodError.issues) {
    if (issues.length >= 12) break;
    const path = (issue.path && issue.path.length > 0 ? issue.path.join('.') : '$').slice(0, 240);
    const code = (issue.code || 'invalid_schema').slice(0, 60);
    const key = `${path}::${code}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({ path, code });
    }
  }

  return {
    kind: 'SCHEMA_VALIDATION',
    issues: issues.length > 0 ? issues : [{ path: '$', code: 'invalid_schema' }],
  };
}

export function buildJsonParseDiagnostics(): TurnFailureDiagnostics {
  return {
    kind: 'JSON_PARSE',
    issues: [{ path: '$', code: 'invalid_json' }],
  };
}

export function buildDialogueDiagnostics(): TurnFailureDiagnostics {
  return {
    kind: 'DIALOGUE_CONTRACT',
    issues: [{ path: 'narrative_blocks', code: 'dialogue_contract_violation' }],
  };
}

export function enforceNarrativeReconciliationBoundaries<T extends TurnResult>(
  result: T,
  reconciliationReceipt?: NarrativeReconciliationReceipt
): T {
  const mode = reconciliationReceipt
    ? reconciliationReceipt.mode
    : result.reconciliation_proposal.mode;

  if (mode === 'EXPERIENTIAL_REANCHORED') {
    return {
      ...result,
      logic_state: {
        ...result.logic_state,
        requested_transition: null,
        cast_deltas: [],
      },
      topologyDelta: { isExpansion: false, newNodeDef: null },
    };
  }
  return result;
}

export interface FinalizeTurnCausalityParams {
  result: TurnResult;
  userAction: string;
  context: EngineTurnContext;
  isExpansionExpected?: boolean;
}

export interface FinalizeTurnCausalityResult {
  boundedResult: TurnResult;
  intentReceipt: IntentReceipt;
  narrativeReconciliationReceipt: NarrativeReconciliationReceipt;
  transitionReceipt: TransitionReceipt;
  castTarget: CastTargetResolution;
  causal: CausalFeasibilityResult;
}

export function finalizeTurnCausality({
  result,
  userAction,
  context,
  isExpansionExpected = false,
}: FinalizeTurnCausalityParams): FinalizeTurnCausalityResult {
  // 1. Build intentReceipt from result.intent_proposal with the existing version-1 builder.
  const intentReceipt = createIntentReceipt(result.intent_proposal);

  // 2. Resolve castTarget with resolveExplicitCastTarget(userAction, context).
  const castTarget = resolveExplicitCastTarget(userAction, context);

  // 3. Authorize expansion first (expansion precedence).
  const effectiveRole =
    context.participationContext?.mode ?? context.player.role;

  const boundedTopologyDelta = getThresholdBoundTopologyDelta({
    userAction,
    effectiveRole,
    isExpansionExpected,
    proposedTopologyDelta: result.topologyDelta,
  });
  const isExpansionAuthorized = boundedTopologyDelta.isExpansion === true;

  // 4. Compute spatially ratifiable requested transition (suppressed if expansion is authorized).
  const knownNodes = [
    {
      id: context.topology.currentNodeId,
      label: context.topology.readableNodeLabel,
      name: context.topology.readableNodeLabel,
    },
    ...context.topology.allowedOutgoingExits.map((exit) => ({ id: exit.to })),
  ];

  const ratifiableRequestedTransition = getSpatiallyRatifiableRequestedTransition({
    userAction,
    proposedTarget: result.logic_state.requested_transition,
    isExpansionAuthorized,
    currentNodeId: context.topology.currentNodeId,
    nodes: knownNodes,
  });

  const resultWithRatifiableTransition = {
    ...result,
    logic_state: {
      ...result.logic_state,
      requested_transition: ratifiableRequestedTransition,
    },
    topologyDelta: boundedTopologyDelta,
  };

  // 5. Run the existing deterministic transition resolver against the spatially ratifiable requested transition.
  const preliminaryTransitionReceipt = resolveTransition({
    currentNodeId: context.topology.currentNodeId,
    requestedTransition: ratifiableRequestedTransition,
    allowedOutgoingExits: context.topology.allowedOutgoingExits,
    activeFlags: context.runtime.activeFlags || [],
  });

  // 6. Call evaluateCausalFeasibility with the intent receipt, authoritative context, preliminary transition receipt, and cast target.
  const baseCausal = evaluateCausalFeasibility({
    intentReceipt,
    context,
    transitionReceipt: preliminaryTransitionReceipt,
    castTarget,
  });

  // 7. Apply role-aware intent policy over the base causal evaluation.
  const causal = applyRoleAwareIntentPolicy({
    base: baseCausal,
    intentReceipt,
    context,
    proposedAuthorityAlignment: result.reconciliation_proposal.authority_alignment,
  });

  // 8. Build a fresh server-normalized reconciliation proposal from the policy result:
  const serverProposal = {
    ...result.reconciliation_proposal,
    feasibility: causal.feasibility,
    reason_code: causal.reason_code,
    authority_alignment: causal.authority_alignment,
    mode: causal.suppressStructuralDeltas
      ? ('EXPERIENTIAL_REANCHORED' as const)
      : result.reconciliation_proposal.mode,
  };

  // 9. Pass serverProposal through the existing createNarrativeReconciliationReceipt builder.
  const narrativeReconciliationReceipt = createNarrativeReconciliationReceipt(
    serverProposal,
    effectiveRole
  );

  // 10. Enforce narrative reconciliation boundaries so its decision uses the final reconciliation receipt.
  const boundedResult = enforceNarrativeReconciliationBoundaries(
    resultWithRatifiableTransition,
    narrativeReconciliationReceipt
  );

  // 11. Run the existing deterministic transition resolver again against the bounded result.
  const transitionReceipt = resolveTransition({
    currentNodeId: context.topology.currentNodeId,
    requestedTransition: boundedResult.logic_state.requested_transition,
    allowedOutgoingExits: context.topology.allowedOutgoingExits,
    activeFlags: context.runtime.activeFlags || [],
  });

  return {
    boundedResult,
    intentReceipt,
    narrativeReconciliationReceipt,
    transitionReceipt,
    castTarget,
    causal,
  };
}

export function finalizeCanonicalConsequences(input: {
  proposal: CanonicalConsequenceProposal;
  context: EngineTurnContext;
  intentReceipt: IntentReceipt;
  narrativeReconciliationReceipt: NarrativeReconciliationReceipt;
}): CanonicalConsequenceReceipt {
  const effectiveRole =
    input.context.participationContext?.mode ?? input.context.player.role;

  return resolveCanonicalConsequences({
    proposal: input.proposal,
    currentState: input.context.consequenceState,
    intentReceipt: input.intentReceipt,
    reconciliationReceipt: input.narrativeReconciliationReceipt,
    effectiveRole,
  });
}

export function finalizeCharacterStance(input: {
  proposal: CharacterStanceProposal;
  context: EngineTurnContext;
  intentReceipt: IntentReceipt;
  narrativeReconciliationReceipt: NarrativeReconciliationReceipt;
  castInteractionReceipt: CastInteractionReceipt;
}): CharacterStanceReceipt {
  const currentState: CharacterStanceById = {};
  for (const member of input.context.cast) {
    if (member.stance) {
      currentState[member.id] = { focus: member.stance.focus, stance: member.stance.stance };
    }
  }

  return resolveCharacterStance({
    proposal: input.proposal,
    currentState,
    context: input.context,
    intentReceipt: input.intentReceipt,
    reconciliationReceipt: input.narrativeReconciliationReceipt,
    castInteractionReceipt: input.castInteractionReceipt,
  });
}

export function finalizeCharacterRelationships(input: {
  proposal: CharacterRelationshipProposal;
  context: EngineTurnContext;
  intentReceipt: IntentReceipt;
  narrativeReconciliationReceipt: NarrativeReconciliationReceipt;
  castInteractionReceipt: CastInteractionReceipt;
}): CharacterRelationshipReceipt {
  return resolveCharacterRelationships({
    proposal: input.proposal,
    currentState: input.context.relationshipState,
    context: input.context,
    intentReceipt: input.intentReceipt,
    reconciliationReceipt: input.narrativeReconciliationReceipt,
    castInteractionReceipt: input.castInteractionReceipt,
  });
}

export function finalizeCharacterMemory(input: {
  proposal: CharacterMemoryProposal;
  context: EngineTurnContext;
  intentReceipt: IntentReceipt;
  narrativeReconciliationReceipt: NarrativeReconciliationReceipt;
  castInteractionReceipt: CastInteractionReceipt;
}): CharacterMemoryReceipt {
  return resolveCharacterMemory({
    proposal: input.proposal,
    currentState: input.context.memoryState,
    currentTurn: input.context.runtime.turnNumber,
    context: input.context,
    intentReceipt: input.intentReceipt,
    reconciliationReceipt: input.narrativeReconciliationReceipt,
    castInteractionReceipt: input.castInteractionReceipt,
  });
}

export function finalizeWorldMemory(input: {
  proposal: WorldMemoryProposal;
  context: EngineTurnContext;
  intentReceipt: IntentReceipt;
  narrativeReconciliationReceipt: NarrativeReconciliationReceipt;
  castInteractionReceipt: CastInteractionReceipt;
}): WorldMemoryReceipt {
  return resolveWorldMemory({
    proposal: input.proposal,
    currentState: input.context.worldMemory || [],
    currentTurn: input.context.runtime.turnNumber,
    context: input.context,
    intentReceipt: input.intentReceipt,
    reconciliationReceipt: input.narrativeReconciliationReceipt,
    castInteractionReceipt: input.castInteractionReceipt,
  });
}

export {
  REMOTE_DISCONNECT_PATTERNS,
  RECOGNIZED_AMBIENT_SPEAKER_PATTERN,
  isRecognizedAmbientSpeaker,
  buildAuditoryContext,
  validateAndNormalizeVocalization,
  formatVocalizationPromptDirective,
};

export function validateDialogueBlocks(
  blocks: Array<{ type: string; speaker?: string | null; [key: string]: unknown }>,
  context: EngineTurnContext,
  explicitlyAddressedSpeakerId: string | null = null,
  userAction?: string,
  recentHistory?: Array<{ role: string; content: string }> | string,
  arrivedCastIds?: ReadonlySet<string>
): string | null {
  if (!Array.isArray(blocks) || !context || !Array.isArray(context.cast)) {
    return null;
  }

  const auditoryContext = buildAuditoryContext(
    context,
    userAction,
    recentHistory,
    arrivedCastIds,
    explicitlyAddressedSpeakerId
  );

  const { error, normalizedBlocks } = validateAndNormalizeVocalization(
    blocks,
    auditoryContext
  );

  if (!error && Array.isArray(blocks)) {
    for (let i = 0; i < normalizedBlocks.length; i++) {
      if (blocks[i]) {
        Object.assign(blocks[i], normalizedBlocks[i]);
      }
    }
  }

  return error;
}

export function resolveDialogueSpeakerId(
  narrativeBlocks: Array<{ type: string; speaker?: string | null; content?: string }>,
  context: EngineTurnContext
): string | null {
  const dialogueBlocks = narrativeBlocks.filter((b) => b.type === 'dialogue');
  if (dialogueBlocks.length !== 1) return null;
  const speaker = dialogueBlocks[0].speaker?.trim();
  if (!speaker) return null;
  if (isRecognizedAmbientSpeaker(speaker)) {
    return null;
  }
  const matchingMembers = context.cast.filter(
    (member) => member.name === speaker || member.id === speaker
  );
  return matchingMembers.length === 1 ? matchingMembers[0].id : null;
}

export function normalizeCastSkepticismDeltas(
  deltas: Array<{ character_id: string; skepticism_delta: number }>,
  context: EngineTurnContext,
): Array<{ character_id: string; skepticism_delta: number }> {
  const eligibleIds = new Set(
    context.cast
      .filter(
        (member) =>
          member.id !== context.player.characterId && !member.isUserCharacter,
      )
      .map((member) => member.id),
  );
  const accepted = new Set<string>();
  const normalized: Array<{ character_id: string; skepticism_delta: number }> = [];

  for (const delta of deltas) {
    if (!eligibleIds.has(delta.character_id) || accepted.has(delta.character_id)) {
      continue;
    }

    const skepticismDelta = clampSkepticismDelta(delta.skepticism_delta);
    if (skepticismDelta === 0) continue;

    accepted.add(delta.character_id);
    normalized.push({
      character_id: delta.character_id,
      skepticism_delta: skepticismDelta,
    });
  }

  return normalized;
}

export function formatCastLedger(context: EngineTurnContext): string {
  if (context.cast.length === 0) {
    return '• Solitary subject.';
  }

  return context.cast
    .map((member) => {
      const profile = member.expressionProfile;
      const expressionLines = profile
        ? [
            `Communication modes: ${profile.communicationModes.join(', ')}.`,
            `Expression guidance: ${profile.expressionGuidance}`,
            profile.silenceGuidance
              ? `Silence guidance: ${profile.silenceGuidance}`
              : null,
          ]
            .filter(Boolean)
            .join(' ')
        : 'Communication modes: spoken (legacy compatibility; no additional expression guidance).';

      const behaviorLines = [
        member.personality ? `Personality: ${member.personality}` : null,
        member.goals ? `Goals: ${member.goals}` : null,
        member.traits.length > 0 ? `Traits: ${member.traits.join(', ')}.` : null,
      ]
        .filter(Boolean)
        .join(' ');

      const skepticismFormatted = (typeof member.skepticism === 'number'
        ? member.skepticism
        : 0.5
      ).toFixed(2);

      const presenceMarker = member.isPresent ? 'Presence: HERE' : 'Presence: ELSEWHERE';

      return `• ${member.name} (ID: ${member.id}, Role: ${member.role}, Entity: ${member.isEntity ? 'TRUE' : 'FALSE'}, Skepticism: ${skepticismFormatted}, ${presenceMarker}): ${member.description || 'No additional details.'} ${behaviorLines} ${expressionLines}`
        .replace(/\s+/g, ' ')
        .trim();
    })
    .join('\n');
}

export function normalizeTurnRequestPayload(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const payload = body as Record<string, unknown>;

  const sanitizeParticipation = (pc: unknown) => {
    if (!pc || typeof pc !== 'object') return;
    const p = pc as Record<string, unknown>;
    if (p.seat && typeof p.seat === 'object') {
      const seat = p.seat as Record<string, unknown>;
      if (typeof seat.ability === 'string' && seat.ability.length > 2500) {
        seat.ability = seat.ability.trim().slice(0, 2500);
      }
      if (typeof seat.limitation === 'string' && seat.limitation.length > 2500) {
        seat.limitation = seat.limitation.trim().slice(0, 2500);
      }
    }
    if (p.authorityContract && typeof p.authorityContract === 'object') {
      const auth = p.authorityContract as Record<string, unknown>;
      if (typeof auth.authority === 'string' && auth.authority.length > 2500) {
        auth.authority = auth.authority.trim().slice(0, 2500);
      }
      if (typeof auth.limits === 'string' && auth.limits.length > 2500) {
        auth.limits = auth.limits.trim().slice(0, 2500);
      }
    }
    if (p.victimField && typeof p.victimField === 'object') {
      const vf = p.victimField as Record<string, unknown>;
      if (typeof vf.description === 'string' && vf.description.length > 300) {
        vf.description = vf.description.trim().slice(0, 300);
      }
      if (typeof vf.goal === 'string' && vf.goal.length > 200) {
        vf.goal = vf.goal.trim().slice(0, 200);
      }
      if (typeof vf.knownFact === 'string' && vf.knownFact.length > 200) {
        vf.knownFact = vf.knownFact.trim().slice(0, 200);
      }
      if (Array.isArray(vf.members)) {
        for (const m of vf.members) {
          if (m && typeof m === 'object') {
            const mem = m as Record<string, unknown>;
            if (typeof mem.description === 'string' && mem.description.length > 300) {
              mem.description = mem.description.trim().slice(0, 300);
            }
            if (typeof mem.goal === 'string' && mem.goal.length > 200) {
              mem.goal = mem.goal.trim().slice(0, 200);
            }
            if (typeof mem.knownFact === 'string' && mem.knownFact.length > 200) {
              mem.knownFact = mem.knownFact.trim().slice(0, 200);
            }
          }
        }
      }
    }
    if (Array.isArray(p.boundedFacts)) {
      p.boundedFacts = p.boundedFacts.map((f: unknown) =>
        typeof f === 'string' ? f.trim().slice(0, 250) : f
      );
    }
  };

  if (payload.context && typeof payload.context === 'object') {
    const ctx = payload.context as Record<string, unknown>;
    if (ctx.participationContext) {
      sanitizeParticipation(ctx.participationContext);
    }
  }
  if (payload.participationContext) {
    sanitizeParticipation(payload.participationContext);
  }

  return payload;
}

export interface ProcessTurnResult {
  finalResponse: TurnResponse;
  composedNarrativeBlocks: NarrativeBlock[];
}

export async function processTurnExecution(
  parsedRequest: z.infer<typeof TurnRequestSchema>
): Promise<ProcessTurnResult> {
  const {
    userAction,
    recentHistory,
    systemDirective,
    isExpansionExpected,
    stateContext,
    context,
  } = parsedRequest;

  if (!context.horrorGrammar) {
    const err = new Error('Invalid turn request: context.horrorGrammar is required for Engine turn processing') as Error & { code?: string };
    err.code = 'MISSING_HORROR_GRAMMAR_CONTEXT';
    throw err;
  }

    const worldRulesFormatted = context.scenario.worldRules.length > 0
      ? context.scenario.worldRules.map((r) => `• ${r}`).join('\n')
      : '• No explicit world constraints recorded.';

    const castLedgerFormatted = formatCastLedger(context);

    const inventoryFormatted =
      context.consequenceState.inventory.length > 0
        ? context.consequenceState.inventory.join(', ')
        : 'None';
    const injuriesFormatted =
      context.consequenceState.player_injuries.length > 0
        ? context.consequenceState.player_injuries.join(', ')
        : 'None';
    const psychStatusFormatted = context.consequenceState.psychological_status;

    const exitsFormatted = context.topology.allowedOutgoingExits.length > 0
      ? context.topology.allowedOutgoingExits.map((e) => `• Exit to ${e.to} (Kind: ${e.kind}, User Initiated: ${e.userInitiated}${e.requires && e.requires.length > 0 ? `, Requires: ${e.requires.join(', ')}` : ''})`).join('\n')
      : '• No unsealed exits.';

    const keyPlotElementsFormatted = context.scenario.keyPlotElements.length > 0
      ? context.scenario.keyPlotElements.join(' | ')
      : 'Standard narrative progression.';

    let participationSection = '';
    if (context.participationContext) {
      const pc = context.participationContext;
      const boundedFactsFormatted =
        pc.boundedFacts && pc.boundedFacts.length > 0
          ? pc.boundedFacts.map((f) => `- ${f}`).join('\n')
          : 'None established';

      if (pc.mode === 'antagonist' || pc.mode === 'villain') {
        const normalizedPc = normalizeParticipationContext(pc) || pc;
        const isForce = normalizedPc.seat?.kind === 'force';
        const isHumanVillain =
          pc.mode === 'villain' ||
          (!isForce && normalizedPc.seat?.kind !== 'force' && !context.cast.find((c) => c.id === context.player.characterId)?.isEntity);
        const authorityText =
          normalizedPc.authorityContract?.authority ||
          'Only already authored and ratified scenario facts apply. Grants no new reach, perception, mutation, omniscience, or control until re-inducted with an explicit Authority Contract.';
        const limitsText =
          normalizedPc.authorityContract?.limits ||
          'Strictly bounded to authored scenario facts and ratified state. Grants no new reach, perception, mutation, omniscience, or control without an explicit Authority Contract.';

        let victimSection = '';
        if (pc.victimField) {
          if (pc.victimField.kind === 'individual') {
            victimSection = `Victim Target: Individual (${pc.victimField.name})
Victim Description: ${pc.victimField.description || 'Target subject within enclosure'}
${pc.victimField.goal ? `Victim Immediate Goal: ${pc.victimField.goal}\n` : ''}${pc.victimField.knownFact ? `Known Intelligence: ${pc.victimField.knownFact}\n` : ''}`;
          } else {
            const memberProfiles =
              pc.victimField.members && pc.victimField.members.length > 0
                ? pc.victimField.members
                    .map(
                      (m) =>
                        `  • ${m.name}${m.description ? ` - ${m.description}` : ''}${m.goal ? ` (Goal: ${m.goal})` : ''}${m.knownFact ? ` [Intel: ${m.knownFact}]` : ''}`
                    )
                    .join('\n')
                : '  (No individually distinguished member profiles; collective target)';
            victimSection = `Victim Target: Group (${pc.victimField.collectiveDesignation})
Group Overview: ${pc.victimField.description || 'Target collective within enclosure'}
Named Member Profiles:
${memberProfiles}`;
          }
        } else {
          victimSection = 'Victim Target: Subjects present within scenario enclosure.';
        }

        const villainSeatIds = context.cast
          .filter((c) => isVillainCastMember(c))
          .map((c) => c.id);
        const villainDynamicsBlock = describeVillainDynamics(
          villainSeatIds,
          context.relationshipState,
          (id) => context.cast.find((c) => c.id === id)?.name ?? id
        );

        participationSection = `\n[${isHumanVillain ? 'VILLAIN / PREDATOR' : 'ANTAGONIST'} SIMULATION CONTRACT & AUTHORITY BOUNDARIES]
Role Identity: ${pc.seat?.name || (isHumanVillain ? 'Predatory Villain' : 'Unknown Opposition')}
Seat Kind: ${isHumanVillain ? 'Human Sociopath / Predatory Stalker' : isForce ? 'Environmental / Unseen Force' : 'Embodied Physical Entity / Avatar'}
Manifestation: ${pc.seat?.description || 'N/A'}
Current Objective: ${pc.initialGoal}

[AUTHORITY CONTRACT]
Granted Authority Scope: ${authorityText}

[LIMITS, ANCHORS & COUNTERPLAY]
Operational Limits & Boundaries: ${limitsText}

[TARGET FIELD / PREY & BYSTANDERS]
${victimSection}
${villainDynamicsBlock ? `\n${villainDynamicsBlock}\n` : ''}
Bounded Facts:
${boundedFactsFormatted}

Agency Directives:
1. USER AGENCY: The user input represents the direct intent, speech, and actions of the controlled ${isHumanVillain ? 'Villain' : 'Antagonist'} (${pc.seat?.name || 'Opposition'}).
2. ${isHumanVillain ? 'SOCIAL CAMOUFLAGE & PREDATORY FRICTION' : 'AUTHORED SCOPE'}: ${
  isHumanVillain
    ? 'The user operates as a human predator (e.g. serial killer, sociopath, or stalker). Actively dramatize the friction between their polished social mask and their intrusive, escalating homicidal impulses. Show other characters socializing, conversing, gossiping, or reacting with confusion or rising suspicion. Do NOT leave the environment empty or inert. If the player is in an enclosure alone, introduce active social world friction: the telephone ringing, an intercom buzzing, an unexpected visitor knocking, friends or lovers demanding dinner commitments, or urgent messages delivered. If the player calls someone, that character answers with their authored personality and social expectations.'
    : 'Permit actions and perceptions expressly granted by the Authority Contract and apparatus controls, including environmental actuation, atmospheric venting, bulkhead lockdown, electrical relays, hazard deployment, and surveillance across the facility.'
}
3. AUTONOMOUS TARGET & PREY SIMULATION: You MUST actively dramatize the other characters' independent human reactions to the ${isHumanVillain ? 'Villain' : 'Antagonist'}. They are living entities pursuing survival goals from the Cast Ledger. If unprovoked, they converse, advance repairs, check exits, whisper plans, or display unaware vulnerability. If confronted, threatened, or attacked, show their terror, desperate evasive tactics, frantic attempts to barricade or escape, arming themselves with improvised tools, bargaining, or anatomical trauma. Do NOT treat other characters as inert, frozen, or passive observers.
4. ${isHumanVillain ? 'PREDATORY SENSORIUM' : 'INHUMAN SENSORIUM & PERSPECTIVE'}: Frame narrative prose through the cold, calculating, or detached perception of the ${isHumanVillain ? 'Villain: sensory fixation on status symbols, grooming, clothing, smells of perfume/blood, and clinical evaluation of victim vulnerability' : 'Antagonist: optical surveillance feeds with scanlines and timestamps, acoustic resonance along ducts and grates, biometric telemetry spikes, and distant mechanical hums'}. Do NOT recast any Victim as the player Protagonist.
5. BOUNDARY ENFORCEMENT: Do not invent broader authority or reach than the contract grants. If an attempted action exceeds stated limits, social exposure risk, or physical rules, make the boundary legible to the user in narrative prose without claiming forbidden mutations occurred.
6. CANONICAL STATE: All spatial transitions and lasting world mutations remain subject to engine ratification and strict topology authorization.
`;
      } else if (pc.mode === 'bystander') {
        let seatDetails = `Mode: BYSTANDER\nSeat: ${pc.seat?.name || 'Bystander'} (Mundane Civilian / Unaware Collateral)\nDescription: ${pc.seat?.description || 'N/A'}`;
        if (pc.seat?.ability) seatDetails += `\nAptitude/Vector: ${pc.seat.ability}`;
        if (pc.seat?.limitation) seatDetails += `\nLimitation/Boundary: ${pc.seat.limitation}`;
        seatDetails += `\nInitial Core Goal: ${pc.initialGoal}`;

        participationSection = `\n[BYSTANDER SIMULATION CONTRACT & AGENCY BOUNDARIES]
${seatDetails}
Bounded Facts:
${boundedFactsFormatted}
Agency Directives:
1. USER AGENCY: The user operates a civilian bystander caught in or adjacent to the horror scenario.
2. MUNDANE PRIORITIES & SELF-PRESERVATION: The user's character is NOT the heroic savior or the central victim; they have ordinary civilian concerns (finishing their coffee, locking up, calling the police, clocking out, asking why strange sounds are coming from the cellar, or desperately minding their own business).
3. SURREAL HORROR CONTRAST: Dramatize the jarring, eerie contrast between the ordinary, everyday world and the bizarre horror or violence unfolding around them. Honor pragmatic, self-preserving, or bewildered choices ("None of my business", "I'm calling the cops and staying in the car").
4. OBJECTIVE ADJUDICATION: Adjudicate their attempted physical and social actions realistically. Do not force them to confront monsters if they choose to retreat, hide, or call for help.
`;
      } else if (pc.mode === 'protagonist' || pc.mode === 'survivor') {
        let seatDetails = `Mode: SURVIVOR / PROTAGONIST\nSeat: ${pc.seat?.name || 'Survivor'} (${pc.seat?.kind || 'survivor'})\nDescription: ${pc.seat?.description || 'N/A'}`;
        if (pc.seat?.ability) seatDetails += `\nAptitude/Vector: ${pc.seat.ability}`;
        if (pc.seat?.limitation) seatDetails += `\nLimitation/Boundary: ${pc.seat.limitation}`;
        if (!context.player.openingAimDisposition) {
          // Legacy participation path only
          seatDetails += `\nInitial Core Goal: ${pc.initialGoal}`;
        }

        participationSection = `\n[PARTICIPATION CONTRACT & AGENCY BOUNDARIES]
${seatDetails}
Bounded Facts:
${boundedFactsFormatted}
Agency Directives:
1. USER AGENCY: The user operates the mortal survivor seat. Adjudicate their attempted physical and cognitive actions within their limitations. Narrate the world and environment consequences objectively.
2. LIVING COMPANION INTERACTION: Present companions sharing the space are independent mortals with their own fears, social friction, and observations. Weave their presence, body language, tension, and occasional spontaneous comments naturally into the scene alongside the player's actions. Never isolate the player in an empty void when companions are present.
`;
      } else if (pc.mode === 'director') {
        participationSection = `\n[PARTICIPATION CONTRACT & AGENCY BOUNDARIES]
Mode: DIRECTOR
Seat: Director (External Narrative Framing & Pacing Authority)
Initial Core Goal: ${pc.initialGoal}
Bounded Facts:
${boundedFactsFormatted}
Agency Directive:
The user acts as an external scene director. A direction is a proposal for focus, pressure, framing, pacing, or reveal/withhold—not a direct edit of canonical facts, topology, or actor outcomes. The Engine retains sole authority over physical consistency, state reconciliation, and causal world rules.
`;
      }
    }

    const eligiblePresentCharacters = context.cast.filter(
      (member) =>
        member.id !== context.player.characterId &&
        !member.isUserCharacter &&
        member.isPresent
    );

    const eligiblePresentCharactersFormatted =
      eligiblePresentCharacters.length > 0
        ? eligiblePresentCharacters
            .map((member) => `• ${member.name} (ID: ${member.id})`)
            .join('\n')
        : '• No present eligible non-player characters.';

    const characterStanceFormatted =
      eligiblePresentCharacters.length > 0
        ? eligiblePresentCharacters
            .map((member) => {
              const stanceStr = member.stance
                ? `${member.stance.focus}/${member.stance.stance}`
                : 'UNSET';
              return `• ${member.name} (ID: ${member.id}): ${stanceStr}`;
            })
            .join('\n')
        : '• No present eligible non-player characters.';

    const characterRelationshipsFormatted =
      context.relationshipState.length > 0
        ? context.relationshipState
            .map(
              (r) =>
                `• ${r.source_character_id} -> ${r.target_character_id} (${r.kind}: ${r.intensity})`
            )
            .join('\n')
        : '• No established relationships.';

    const characterMemoryFormatted =
      eligiblePresentCharacters.length > 0
        ? eligiblePresentCharacters
            .map((member) => {
              const memories = member.memory || [];
              if (memories.length === 0) {
                return `• ${member.name} (ID: ${member.id}): (No memories recorded)`;
              }
              const list = memories
                .map(
                  (m) =>
                    `  - [${m.certainty}/${m.source} @ turn ${m.acquired_turn}]: "${m.fact}"`
                )
                .join('\n');
              return `• ${member.name} (ID: ${member.id}):\n${list}`;
            })
            .join('\n')
        : '• No present eligible non-player characters.';

    const situatedWorldMemory = selectSituatedWorldMemory(
      context.worldMemory,
      context.topology.currentNodeId
    );

    const worldMemoryFormatted =
      situatedWorldMemory.length > 0
        ? situatedWorldMemory
            .map((m) => {
              const scopeStr = m.scope === 'GLOBAL' ? 'GLOBAL' : `NODE: ${m.node_id}`;
              return `• [${m.id}] ${m.kind} (${scopeStr}) @ turn ${m.established_turn}: "${m.statement}"`;
            })
            .join('\n')
        : '• No durable world memories recorded.';

    const HG1_PROMPT_CAPS = Object.freeze({
      presentOpportunities: 6,
      offscreenOpportunities: 2,
      valueAnchors: 8,
      pursuitOverlays: 8,
      developmentFacts: 12,
      pressureThreads: 5,
      evidenceEntries: 12,
      textCharacters: 500,
    });

    const clipPromptText = (value: string | null | undefined): string => {
      const normalized = (value || '').trim();
      return normalized.length <= HG1_PROMPT_CAPS.textCharacters
        ? normalized
        : `${normalized.slice(0, HG1_PROMPT_CAPS.textCharacters - 1)}…`;
    };

    let horrorGrammarSection = '';
    if (context.horrorGrammar) {
      // ARCHITECTURAL SCAFFOLDING (Phase 4: Multi-Node AI Traversal & Cohort Intelligence):
      // Opportunity pool pre-filter boundary. Currently, non-player character activities are
      // constrained to pre-generated candidates in context.horrorGrammar.presentActorOpportunities
      // and offscreenPursuitOpportunities. Phase 4 will expand this with autonomous pathfinding,
      // spatial herding, and emergent behavioral vectors (ADAPTIVE, INSURGENT, PANIC).
      const hg = context.horrorGrammar;

      const presentOpps = [...hg.presentActorOpportunities]
        .sort(
          (a, b) =>
            a.castMemberId.localeCompare(b.castMemberId) ||
            (a.pursuitId || '').localeCompare(b.pursuitId || '')
        )
        .slice(0, HG1_PROMPT_CAPS.presentOpportunities);

      const presentOppsFormatted =
        presentOpps.length > 0
          ? presentOpps
              .map(
                (o) =>
                  `• [PRESENT] Cast ID: ${o.castMemberId}${
                    o.objective ? ` | Objective: "${clipPromptText(o.objective)}"` : ''
                  }${
                    o.presentApproach
                      ? ` | Approach: "${clipPromptText(o.presentApproach)}"`
                      : ''
                  }`
              )
              .join('\n')
          : '• None';

      const offscreenOpps = [...hg.offscreenPursuitOpportunities]
        .sort(
          (a, b) =>
            a.castMemberId.localeCompare(b.castMemberId) ||
            (a.pursuitId || '').localeCompare(b.pursuitId || '')
        )
        .slice(0, HG1_PROMPT_CAPS.offscreenOpportunities);

      const offscreenOppsFormatted =
        offscreenOpps.length > 0
          ? offscreenOpps
              .map(
                (o) =>
                  `• [OFFSCREEN] Cast ID: ${o.castMemberId}${
                    o.objective ? ` | Objective: "${clipPromptText(o.objective)}"` : ''
                  }${
                    o.presentApproach
                      ? ` | Approach: "${clipPromptText(o.presentApproach)}"`
                      : ''
                  }${o.reviewWindow ? ` | Window: ${o.reviewWindow}` : ''}`
              )
              .join('\n')
          : '• None';

      const cappedOpps = [...presentOpps, ...offscreenOpps];
      const relevantNonUserDataCastIds = new Set(
        cappedOpps
          .map((o) => o.castMemberId)
          .filter((id) => id !== context.player.characterId)
      );
      const relevantPursuitIds = new Set(
        cappedOpps.map((o) => o.pursuitId).filter((id): id is string => !!id)
      );

      const relevantAnchors = [...hg.relevantValueAnchors]
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, HG1_PROMPT_CAPS.valueAnchors);

      const valueAnchorsFormatted =
        relevantAnchors.length > 0
          ? relevantAnchors
              .map(
                (v) =>
                  `• [${v.id}] ${clipPromptText(v.label)}: "${clipPromptText(
                    v.description
                  )}" (Holder: ${v.holder.kind})`
              )
              .join('\n')
          : '• None';

      const valueState = (hg.runtimeState?.valueState || {}) as Record<
        string,
        import('../../src/types/horrorGrammar').ValueStateRecord
      >;
      const valueStatesFormatted =
        relevantAnchors.length > 0
          ? relevantAnchors
              .map((v) => {
                const s = valueState[v.id];
                const cond = s?.condition || 'ESTABLISHED';
                const life = s?.lifecycle || 'ACTIVE';
                const note = s?.currentFormNote
                  ? ` | Form: "${clipPromptText(s.currentFormNote)}"`
                  : '';
                return `• [${v.id}] Condition: ${cond} | Lifecycle: ${life}${note}`;
              })
              .join('\n')
          : '• None';

      const pursuitState = (hg.runtimeState?.characterPursuits || {}) as Record<
        string,
        import('../../src/types/horrorGrammar').CharacterPursuitRecord
      >;
      const relevantPursuits = Object.values(pursuitState)
        .filter(
          (p) =>
            p.castMemberId !== context.player.characterId &&
            (relevantNonUserDataCastIds.has(p.castMemberId) ||
              relevantPursuitIds.has(p.pursuitId))
        )
        .sort((a, b) => a.pursuitId.localeCompare(b.pursuitId))
        .slice(0, HG1_PROMPT_CAPS.pursuitOverlays);

      const pursuitOverlaysFormatted =
        relevantPursuits.length > 0
          ? relevantPursuits
              .map(
                (p) =>
                  `• [${p.pursuitId}] Cast ID: ${p.castMemberId} | Status: ${
                    p.status
                  } | Objective: "${clipPromptText(
                    p.currentObjective
                  )}" | Approach: "${clipPromptText(
                    p.currentApproach
                  )}" | Location: ${
                    p.currentLocationNodeId || 'NONE'
                  } | Progress: "${clipPromptText(p.progressSummary)}"`
              )
              .join('\n')
          : '• None';

      const devState = (hg.runtimeState?.characterDevelopment || {}) as Record<
        string,
        import('../../src/types/horrorGrammar').CharacterDevelopmentFact[]
      >;
      const devFactList: import('../../src/types/horrorGrammar').CharacterDevelopmentFact[] =
        [];
      for (const [castId, facts] of Object.entries(devState)) {
        if (
          castId === context.player.characterId ||
          !relevantNonUserDataCastIds.has(castId) ||
          !Array.isArray(facts)
        )
          continue;
        for (const f of facts) {
          if (f.lifecycle === 'ACTIVE') {
            devFactList.push(f);
          }
        }
      }
      devFactList.sort(
        (a, b) =>
          a.castMemberId.localeCompare(b.castMemberId) ||
          a.id.localeCompare(b.id)
      );
      const cappedDevFacts = devFactList.slice(
        0,
        HG1_PROMPT_CAPS.developmentFacts
      );
      const devFactsFormatted =
        cappedDevFacts.length > 0
          ? cappedDevFacts
              .map(
                (f) =>
                  `• [${f.id}] Cast ID: ${f.castMemberId} | ${
                    f.dimension
                  }: "${clipPromptText(f.statement)}"`
              )
              .join('\n')
          : '• None';

      const activeThreads = [...(hg.runtimeState?.activePressureThreads || [])]
        .filter((t) => t.status === 'OPEN')
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, HG1_PROMPT_CAPS.pressureThreads);

      const activeThreadsFormatted =
        activeThreads.length > 0
          ? activeThreads
              .map(
                (t) =>
                  `• [${t.id}] Anchor: ${t.valueAnchorId} | Status: ${
                    t.status
                  } | Operator: ${t.operator} | Dimension: ${
                    t.affectedDimension
                  } | Adverse Prospect: "${clipPromptText(t.adverseProspect)}"`
              )
              .join('\n')
          : '• None';

      const evidenceEntries = [...(hg.evidenceRegistry || [])]
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, HG1_PROMPT_CAPS.evidenceEntries);

      const evidenceFormatted =
        evidenceEntries.length > 0
          ? evidenceEntries
              .map(
                (e) =>
                  `• [${e.id}] ${e.category} | Owner: ${
                    e.ownerRef
                  } | "${clipPromptText(e.description)}"`
              )
              .join('\n')
          : '• None';

      horrorGrammarSection = `\n[CAST ACTIVITY OPPORTUNITY POOL (OBSERVATIONAL)]
Fictional Time Revisions: Moment ${hg.fictionalTime.moment_revision} | Scene Beat ${hg.fictionalTime.scene_beat_revision} | Extended ${hg.fictionalTime.extended_revision} (Last Cost: ${hg.fictionalTime.last_cost || 'None'})
Present Opportunities:
${presentOppsFormatted}
Offscreen Opportunities (Max 2):
${offscreenOppsFormatted}
Relevant Value Anchors:
${valueAnchorsFormatted}
Current Value States:
${valueStatesFormatted}
Current Character Pursuit Overlays:
${pursuitOverlaysFormatted}
Current Character Development Facts:
${devFactsFormatted}
Active Pressure Threads (Eligible for Transition):
${activeThreadsFormatted}
Available Authority Evidence:
${evidenceFormatted}
${HG1_CAUSE_REFERENCE_PROMPT}
Authority Directive:
${hg.authorityInstruction}
`;
    }

    let dramaturgySection = '';
    if (context.dramaturgyContext) {
      const dCtx = context.dramaturgyContext;
      const clockLines = (dCtx.activeClockManifestations || [])
        .map((m) => `• [IMPENDING CLOCK MANIFESTATION]: ${m}`)
        .join('\n');
      const diegeticLines = (dCtx.diegeticReadings || [])
        .map((r) => `• [DIAGNOSTIC INSTRUMENT READING // ${r.instrumentName}]: ${r.readingText}`)
        .join('\n');
      const frictionLines = Object.entries(dCtx.companionFrictionDirectives || {})
        .map(([id, directive]) => `• [COMPANION FRICTION // ${id}]: ${directive}`)
        .join('\n');

      dramaturgySection = `\n[DRAMATURGICAL STATE // PHASE: ${dCtx.macroPhase} // CADENCE: ${dCtx.activePacingCadence}]
Pacing Mandate (${context.player.role.toUpperCase()} Seat):
${dCtx.pacingDirective}
${clockLines ? `${clockLines}\n` : ''}${diegeticLines ? `${diegeticLines}\n` : ''}${frictionLines ? `${frictionLines}\n` : ''}`;
    }

    let playerStartingOrientationBlock = '';
    if (
      context.player.openingAimDisposition === 'ACCEPTED_REFERENCE' ||
      context.player.openingAimDisposition === 'CREATOR_OVERRIDE'
    ) {
      if (context.player.openingAim && context.player.openingAim.trim()) {
        playerStartingOrientationBlock = `\n[PLAYER STARTING ORIENTATION]\n${context.player.openingAim.trim()}${
          context.player.sovereigntyInstruction ? `\nNote: ${context.player.sovereigntyInstruction}` : ''
        }`;
      }
    } else if (context.player.openingAimDisposition === 'NONE_DECLARED') {
      playerStartingOrientationBlock = `\n[PLAYER STARTING ORIENTATION]\nNone declared. Note: ${
        context.player.sovereigntyInstruction ||
        'No opening aim was declared for this character. The Engine must never infer, fabricate, or supply an unchosen starting goal or quest.'
      }`;
    }

    const isSystemInit = userAction === 'SYSTEM_INIT';
    const openingEstablishmentDirective = isSystemInit
      ? `\n\n[OPENING SCENE ESTABLISHMENT DIRECTIVE - SYSTEM_INIT]
This is the opening turn of the simulation (Turn 0). Your primary purpose is to establish the foundation of the story, setting the scene, sensory tone, characters, and playable perspective in a natural, atmospheric way. DO NOT plunge immediately into violent crisis, screaming, sprinting, or chaotic action (avoid in media res).

Follow these opening establishment mandates:
1. SET THE SCENE & SENSORY TONE:
   - Ground the narration in the physical architecture and spatial reality of the starting chamber: ${context.topology.readableNodeLabel} (Location: ${context.scenario.setting.location}).
   - Evoke sensory textures: lighting, acoustics, temperature, smells, machinery hums or weather, and the prevailing atmosphere (${context.scenario.setting.atmosphere || 'tense, ominous'}).
   - Establish the tangible boundaries and physical enclosure before any crisis or anomaly erupts.

2. DEFINE THE PLAYABLE PERSPECTIVE:
   - Introduce the user-controlled character naturally: ${context.player.name} (${context.player.role}) - ${context.player.description || 'operative'}.
   - Ground their physical posture, immediate sensory focus, what they are wearing or holding, and their baseline orientation in the space.
   - Ground who they are through natural observation and physical embodiment, avoiding artificial exposition dumps or breaking character.

3. ESTABLISH PRESENT CAST MEMBERS & OPENING DIALOGUE:
${
  eligiblePresentCharacters.length > 0
    ? `   - Visibly introduce all cast members physically present in the room (marked HERE in CAST LEDGER: ${eligiblePresentCharacters.map((c) => c.name).join(', ')}).
   - Describe where they are located relative to the player, what they are currently doing, and their observable emotional baseline.
   - You MUST include exactly ONE dialogue block from a present companion (${eligiblePresentCharacters.map((c) => c.name).join(', ')}) or an ambient attendant (e.g. an eager question from a child, an anxious remark from a spouse, or a formal announcement from an attendant) to break the silence and establish living character voices right from the opening turn.
   - DO NOT make the player-controlled character (${context.player.name}) the speaker of a dialogue block.`
    : `   - The player character (${context.player.name}) is currently ALONE in this starting chamber. There are NO non-player companions present here.
   - Do NOT emit interpersonal room dialogue blocks.
   - You may include an internal monologue block (type: "internal_monologue", speaker: "${context.player.name}") reflecting their private thoughts or psychological state, or a muttered soliloquy block (type: "soliloquy", speaker: "${context.player.name}"), or emit pure prose blocks.`
}

4. AVOID "IN MEDIA RES" CHAOS:
   - Do NOT drop the player mid-sprint, mid-screaming, or in the middle of sudden physical violence.
   - Begin at the quiet threshold: the moments immediately preceding or leading into the anomaly, the arrival, the waiting room, the quiet briefing, the ticking clock, or the subtle initial tremor.
   - Allow the user room to observe, orient themselves, and decide their first action.`
      : '';

    const castResolution = resolveExplicitCastTarget(userAction, context);
    const explicitlyAddressedMember =
      castResolution.characterId
        ? context.cast.find((c) => c.id === castResolution.characterId)
        : null;

    const preTurnAuditoryContext = buildAuditoryContext(
      context,
      userAction,
      recentHistory,
      undefined,
      explicitlyAddressedMember?.id ?? null
    );
    const vocalizationPromptDirective =
      formatVocalizationPromptDirective(preTurnAuditoryContext);
    const rawSomaticState = context.salienceLedger;
    const somaticStateFormatted = rawSomaticState
      ? formatSomaticStatePrompt(
          rawSomaticState,
          context.cast || [],
          context.fearContract || {}
        )
      : null;
    const somaticSection =
      somaticStateFormatted && somaticStateFormatted.trim().length > 0
        ? `\n[SOMATIC & PHYSIOLOGICAL STATE]\n${somaticStateFormatted}\n`
        : '';

    // Construct the dense, authoritative contract prompt
    const prompt = `[SCENARIO CONTRACT]
Title: ${context.scenario.title}
Premise: ${context.scenario.premise || 'Not provided'}
World Rules:
${worldRulesFormatted}
Setting: ${context.scenario.setting.location} | ${context.scenario.setting.atmosphere || 'Standard'} | ${context.scenario.setting.timePeriod || 'Present'}
Inciting Incident: ${context.scenario.incitingIncident || 'None'}
Pacing Directive: ${context.scenario.pacingDirective || 'None'}
Key Plot Elements: ${keyPlotElementsFormatted}
${participationSection}
[PLAYABLE PERSPECTIVE]
Role: ${context.player.role}
Character: ${context.player.name} (ID: ${context.player.characterId || 'N/A'}) - ${context.player.description || 'Standard operative'}
Entity Status: ${context.player.isEntity ? 'Entity' : 'Mortal'}${playerStartingOrientationBlock}

[CAST LEDGER]
${castLedgerFormatted}
${somaticSection}${horrorGrammarSection}
${dramaturgySection}
[CHARACTER DIALOGUE CONTRACT]
- DIALOGUE EXPECTATION & LIVING VOICES: Fiction lives through conversation. When non-player companions or ambient attendants are physically co-present (marked HERE in CAST LEDGER), you SHOULD include exactly ONE dialogue block in the turn response (typically alongside 1–2 prose blocks). Do not leave scenes entirely mute when people share the space.
- SPONTANEOUS COMPANION SPEECH: Characters have independent agency. Even during non-communicative actions (e.g. OBSERVE, INVESTIGATE, WAIT, MANIPULATE, MOVE), a present companion or ambient figure SHOULD speak, whisper, ask an anxious question, or react aloud to what is happening.
- ADDRESSED COMMUNICATE TARGET: When the USER ACTION explicitly addresses a cast member (COMMUNICATE <Name>), that member is the primary and only permitted dialogue speaker for this turn.
- UNSOLICITED OR AMBIENT SPEAKER: When no specific cast member was addressed, any eligible present companion (or a recognized ambient extra) may speak.
- Up to 3 total narrative_blocks may be emitted in the turn response (the ideal rhythm is 1–2 prose blocks and 1 dialogue block).
- Recognized ambient service and background characters (waiters, cab drivers, doormen, attendants, flight attendants, technicians, etc.) may speak at most one concise dialogue block to provide living texture.
- Arbitrary named characters or hallucinated major cast remain strictly forbidden.
- For a dialogue block from an authorized cast member, type must be "dialogue", speaker must be the character's exact CAST LEDGER name or ID, and content must contain only that character's concise utterance.
- Never fabricate a speaker, an alias, a new cast member, or a line of dialogue for the player-controlled character. The user's typed action already represents that character's words and choices.
- A cast member with nonverbal as its only communication mode must not receive a dialogue block. Render its response, if any, as prose or environmental description.
- Treat expression and silence guidance as behavioral constraints, not permission to add facts, powers, locations, or knowledge.
- A cast member's full name is an addressed-speaker target only when action_kind is COMMUNICATE. In other action kinds, a name may identify the subject, object, or observed person and must not be treated as an attempted conversation merely because it appears in the action text.

[AUTHORED CAST BEHAVIOR & LIVING PRESENCE]
- LIVING DRAMATIZATION: Present characters (marked HERE in CAST LEDGER) are physically co-present in the room with the player. They are NOT static props or silent statues. Narrative prose should actively depict their visible reactions, physical posture, nervous habits, breathing, glances, or interactions with the environment and each other. Depict at least one specific physical micro-action from a present companion in the prose blocks (e.g. shifting weight, checking exits, fidgeting with tools, listening intently, bracing against walls).
- Personality, goals, and traits constrain each cast member's tone, immediate priorities, and willingness to disclose information.
- Treat them as authored characterization only. They do not authorize new facts, powers, locations, knowledge, cast members, or outcomes.
- If authored behavior conflicts with a communication-mode or silence directive, honor the communication directive.

[CAST PRESENCE & REMOTE CHANNELS]
- Presence is authoritative. A CAST LEDGER member marked HERE is physically in the current room; ELSEWHERE means they are physically located in another node.
- An ELSEWHERE member must not be described as physically present in the room, but MAY receive a dialogue block via remote communication (e.g. telephone, intercom, radio, cellular, voicemail) when the player contacts them or when an incoming call/message arrives.
- When the player calls, pages, or radios a character, that character answers with their authored personality and social expectations, unless dead, incapacitated, or actively refusing to answer. Dialogue over telephone lines is encouraged.

[DYNAMIC CAST ARRIVALS & AGENCY]
Cast members have spatial agency. When summoned by the player (e.g. telephone invitation, intercom request) or driven by their authored goals (e.g. arriving for an appointment, meeting, or checking a disturbance), propose their arrival in logic_state.cast_arrivals: ['character-id']. Once arriving, that character may speak co-presently upon entry.

[CAST CONTINUITY]
- Each CAST LEDGER skepticism value is a bounded continuity signal: 1.00 is strongly rational/anchored; 0.00 is complete surrender to the scenario's abnormal reality.
- logic_state.cast_deltas is optional. Emit a delta only for an eligible non-player cast member whose observable experience during this turn materially changed that signal.
- Emit at most one delta per eligible cast member. Each delta must be between -0.15 and 0.15. Use an empty array when no material change occurred.
- A continuity delta controls no facts, authority, location, injury, action, relationship, or outcome. It only informs later characterization.

[CHARACTER STANCE CONTRACT]
Current Stances:
${characterStanceFormatted}
- character_stance_proposal.changes describes proposed observable stance changes; it is not itself state.
- Stance is an observable immediate orientation (focus: PLAYER or SITUATION; stance: OPEN, GUARDED, RESISTANT, HOSTILE, AFRAID, WITHDRAWN, SUBMITTED), not personality, emotion narration, relationship, memory, location, or action.
- Use exact cast IDs and propose at most two changes.
- Use an empty array when no material observable change occurred.
- Do not repeat unchanged stance.
- Absent and player-controlled characters are ineligible.
- On COMMUNICATE, propose only for the addressed/responding character.
- WAIT and SYSTEM_INIT require an empty changes array.
- Write no stance data inside logic_state.
- A proposal may be rejected while ordinary prose is preserved.

[CHARACTER RELATIONSHIP CONTRACT]
Player Character ID: ${context.player.characterId || 'N/A'}
Eligible Present Non-Player Characters:
${eligiblePresentCharactersFormatted}
Current Relationships:
${characterRelationshipsFormatted}
- character_relationship_proposal.changes describes proposed durable relational shifts; it is not itself state.
- Relationships are directed TRUST, HOSTILITY, DEPENDENCE, or LEVERAGE signals with intensity 1..3.
- Propose only delta: 1 or delta: -1; the server owns resulting intensity.
// ARCHITECTURAL SCAFFOLDING (Phase 4: Multi-Node AI Traversal & Cohort Intelligence):
// Relationship hub-and-spoke constraint. Currently, exactly one endpoint MUST be the player character
// and the other a present eligible non-player. Phase 4 will generalize character_relationship_proposal
// to full cast topological graph (NPC <-> NPC relationships, rivalries, alliances).
- Exactly one endpoint must be the player character and the other a present eligible non-player.
- On COMMUNICATE, the non-player endpoint must be addressed/responding.
- Use at most two changes and an empty array when no durable relational change occurred.
- A momentary mood belongs to stance, not relationships.
- Facts belong to later memory, not relationships.
- OBSERVE, WAIT, OTHER, and SYSTEM_INIT require an empty relationship proposal.
- Write no relationship data in logic_state.
- A proposal may be rejected while ordinary prose is preserved.

[CHARACTER MEMORY CONTRACT]
Player Character ID: ${context.player.characterId || 'N/A'}
Eligible Present Non-Player Characters:
${eligiblePresentCharactersFormatted}
Current Memories by Character:
${characterMemoryFormatted}
- character_memory_proposal.candidates proposes durable facts for one exact eligible present non-player character; it is not state.
- Use an exact cast ID and at most two candidates; use an empty array when no new durable fact exists.
- TOLD requires COMMUNICATE and the addressed or responding character.
- OBSERVED is allowed only for a present character witnessing OBSERVE, INVESTIGATE, MOVE, or MANIPULATE.
- Do not record emotion, stance, relationship intensity, personality, speculation presented as fact, hidden information, narration style, instructions, or scene summaries.
- Use KNOWN only for directly established information and BELIEVED only for a received but unverified claim.
- Do not repeat a fact already in that exact character ledger.
- WAIT, OTHER, and SYSTEM_INIT require an empty candidate array.
- Write no character memory in logic_state, lore_and_memory, or memory-echo metadata.
- A rejected candidate does not suppress ordinary prose.

[WORLD MEMORY CONTRACT]
Current World Memories:
${worldMemoryFormatted}
- world_memory_proposal.candidates proposes durable world facts or conditions established by this turn; it is not state.
- Candidates are durable world facts or conditions established by this turn, not summaries, style notes, instructions, character beliefs, hidden information, speculation, or repetitions.
- Use at most two candidates and an empty array when nothing durable was established.
- Use the exact kind/action matrix:
  • ESTABLISHED_FACT: OBSERVE, INVESTIGATE, COMMUNICATE
  • DISCOVERED_EVIDENCE: OBSERVE, INVESTIGATE, MANIPULATE
  • ENVIRONMENTAL_CONDITION: MOVE, MANIPULATE
  • PERSISTENT_CONSEQUENCE: MOVE, MANIPULATE
- GLOBAL is permitted only for an ESTABLISHED_FACT; all other new entries are NODE-scoped to the exact current node ID (${context.topology.currentNodeId}).
- Every candidate must include node_id. Use "${GEMINI_TURN_NULL_SENTINEL}" for GLOBAL scope and the exact current node ID for NODE scope.
- A fact from COMMUNICATE requires a material response from the addressed character.
- Character-specific knowledge belongs only in character_memory_proposal.
- Do not repeat an existing ledger statement at the same identity.
- WAIT, OTHER, and SYSTEM_INIT require an empty candidate array.
- Write no world memory into logic_state, lore_and_memory, memory echo, narrative reconciliation, or another proposal.
- A rejected candidate does not suppress ordinary prose.

[CANONICAL CONSEQUENCE CONTRACT]
Current Inventory: ${inventoryFormatted}
Current Player Injuries: ${injuriesFormatted}
Current Psychological Status: ${psychStatusFormatted}
- consequence_proposal.mutations describes proposed canonical changes; it is not itself state.
- Use an empty array when nothing materially changes.
- Never repeat unchanged state as a mutation.
- Inventory ADD/REMOVE requires an attempted MANIPULATE action.
- Injury ADD requires MOVE or MANIPULATE; injury REMOVE requires MANIPULATE.
- Psychological SET uses only the five closed status labels: STABLE, UNEASY, DISTRESSED, PANICKED, DISSOCIATED.
- Discovery ADD proposes a clue/evidence label the character just discovered (OBSERVE, INVESTIGATE, or MANIPULATE only); use the evidence label exactly as it appears in the scenario.
- Do not propose more than four mutations.
- Do not write these values in logic_state.
- SYSTEM_INIT must emit an empty mutation array.
- A proposal may be rejected while ordinary prose is preserved.

[CAST ACTIVITY PROPOSAL CONTRACT]
// ARCHITECTURAL SCAFFOLDING (Phase 4: Multi-Node AI Traversal & Cohort Intelligence):
// Single cast_activity_proposal bottleneck. Currently, the turn schema permits at most one
// non-User activity per turn (or kind: "NONE"). Phase 4 will evolve cast_activity_proposal
// into an array of concurrent cohort proposals across topological nodes.
- cast_activity_proposal proposes at most one self-originating non-User activity from the Opportunity Pool above, or kind: "NONE".
- STRONG PREFERENCE: Propose kind 'ACTIVITY' whenever the Opportunity Pool is non-empty. Characters in horror scenarios DO things — they check locks, whisper warnings, rummage through drawers, peer out windows, clutch weapons, or monitor equipment. Only emit kind 'NONE' when the Opportunity Pool is genuinely empty or the scene demands absolute frozen stillness (e.g., hiding from an active predator in the same room).
- kind: "NONE" (with a reason string) is valid on every turn regardless of phase or tension.
- For kind: "ACTIVITY", you must choose an eligible castMemberId from the Opportunity Pool. An offscreen character requires their exact pursuitId.
- State a concise activitySummary, authorityReferences from scenario context, and a valid perceptionPath:
  • DIRECT: co-present in the same room.
  • MEDIATED: intercom/radio/terminal.
  • LOCAL_TRACE: tangible environmental trace or disturbance left at the current location.
  • UNOBSERVED: activity occurs elsewhere with no immediate sensory perception (omit manifestationBlock).
- An isolated manifestationBlock (prose or dialogue) describes ONLY this activity. If type is "dialogue", the "speaker" field is REQUIRED and must match the non-User actor (castMemberId). If speaker is omitted or unknown, you must set type to "prose".
- NEVER propose actions, decisions, thoughts, feelings, or choices for the player-controlled character.
- Do NOT copy unratified activity prose into base narrative_blocks, engine_thoughts, or logic_state.

[SITUATED PRESSURE PROPOSAL CONTRACT]
- situated_pressure_proposal proposes at most one value-anchored prospective pressure event, or kind: "NONE".
- kind: "NONE" (with a reason string) is valid on every turn regardless of phase or tension.
- For kind: "PRESSURE", cite a valid valueAnchorId from the scenario anchors above and a sourceReference ("ACTIVITY" or canonical condition).
- Choose an operator (EXPOSE, CONSTRAIN_ACCESS, ACCELERATE, CORRUPT_TRUST, DEGRADE_CAPABILITY, CLOSE_DISTANCE, DESTABILIZE_KNOWLEDGE, VIOLATE_EXPECTATION, IMPOSE_COST, OTHER) and affectedDimension (ACCESS, KNOWLEDGE, TIME, TRUST, EXPOSURE, CAPABILITY, SAFETY, RELATIONSHIP, FREEDOM, IDENTITY, OTHER).
- State an adverseProspect: a prospective threat to the value, not proof that the worst has already happened.
- Set responseWindowOpen: true. Keep the response window open for the player.
- An isolated manifestationBlock presents the sensory realization of this emerging threat. If type is "dialogue", "speaker" is required; otherwise use type "prose".
- NEVER conclude the outcome, dictate the player's reaction, or choose for the player.
- Do NOT copy unratified pressure prose into base narrative_blocks, engine_thoughts, or logic_state.

[VALUE STATE PROPOSAL CONTRACT]
- value_state_proposal proposes bounded changes to existing reviewed value anchors only.
- It must use exact anchor IDs, allowed operations (SET_CONDITION, REVISE, RETIRE, RESTORE) and conditions (ESTABLISHED, THREATENED, COMPROMISED, SECURED, LOST, TRANSFORMED), and a valid cause reference.
- It must not declare the worst outcome merely because pressure was proposed.
- It emits changes: [] when no causally supported material change occurred.

[CHARACTER PURSUIT PROPOSAL CONTRACT]
- character_pursuit_proposal proposes bounded overlays for exact existing non-User pursuits only.
- It must use exact pursuit IDs, valid operations (ADVANCE, SETBACK, REDIRECT, BLOCK, COMPLETE, ABANDON, PAUSE, RESUME), and a valid cause reference.
- It cannot create a new objective for the User-controlled character or reinterpret the User's aim.
- It emits changes: [] when no supported pursuit change occurred.

[CHARACTER DEVELOPMENT PROPOSAL CONTRACT]
- character_development_proposal proposes bounded facts for non-User characters only.
- It requires an observable/canonical cause and must not infer hidden thoughts, unobserved motives, or personality changes from atmosphere alone.
- It cannot target the User-controlled character.
- It emits changes: [] when no supported development occurred.

[PRESSURE THREAD TRANSITION CONTRACT]
- pressure_transition_proposal may target an exact active pressure-thread ID only.
- It must use an allowed terminal transition (RESOLVED, REALIZED, RELEASED, TRANSFORMED) and a valid cause reference.
- It cannot resolve, realize, release, or transform a thread merely because the model wants narrative closure.
- It emits transitions: [] when no supported transition occurred.

[INTERPRETATION & CAUSAL RECONCILIATION CONTRACT]
- intent_proposal.action_subtype is optional at the provider boundary. Include FLEE or HIDE only when applicable; otherwise omit it.
- reconciliation_proposal.memory_echo_candidate is optional at the provider boundary. Include a non-empty candidate only when applicable; otherwise omit it.
- "${GEMINI_TURN_NULL_SENTINEL}" is reserved only for world_memory_proposal.candidates[].node_id when scope is GLOBAL. Never use it in narrative prose or any other field.
- The intent_proposal and reconciliation_proposal interpret an attempted action; they are metadata, never player commands or proof of success.
- intent_synergy is intent–state coherence, not outcome.
- Pressure direction is a dramatic reading. DE_ESCALATE and ESCALATE do not directly change tension or state.
- Every structurally valid free-form action receives natural prose, including dangerous, ineffective, or physically impossible attempts.
- Blueprint world rules decide whether strange effects can be canonical.
- Unsupported effects may receive one vivid experiential beat, but the prose must re-anchor to authoritative reality in the same turn.
- Do not automatically diagnose the beat as a dream, psychosis, hallucination, or Hell. Use such language only when the authored fiction supports it.
- Plausible consequences of an attempted act may be described. The unsupported declared effect itself cannot create powers, destroy topology, move cast, or establish facts.
- fictional_time_cost classifies the elapsed fictional time for this turn (MOMENT, SCENE_BEAT, EXTENDED, or UNCLEAR), which causally advances the authoritative fictional time ledger and drives pursuit review schedules while every response remains one committed turn.
- A memory echo is a telemetry candidate only. It does not write lore_and_memory or character continuity.
- For an Antagonist, compare the attempt with the explicit Authority Contract and counterplay limits. authority_alignment remains a narrative reading, not a mutation command.
- A cast member's full name is an addressed-speaker target only when action_kind is COMMUNICATE. In other action kinds, a name may identify the subject, object, or observed person and must not be treated as an attempted conversation merely because it appears in the action text.
- None of the field names or enum labels should appear in ordinary narrative prose unless those words arise naturally in the fiction.
- For SYSTEM_INIT, require action_kind: SYSTEM, omit action_subtype, use mode: NOT_REQUIRED, and omit memory_echo_candidate.

[TOPOLOGY BOUNDARY]
Current Node: ${context.topology.readableNodeLabel} (ID: ${context.topology.currentNodeId})
Allowed Exits:
${exitsFormatted}

[RUNTIME CONDITIONS]
Coordinate: Vector=${context.runtime.activeVector}, Tier=${context.runtime.activeTier}
Phase: ${context.runtime.phase}
Tension: ${context.runtime.tension}
Coherence: ${context.runtime.coherence}
Reconciliation Revision: ${context.runtime.reconciliationRevision}

[SYSTEM DIRECTIVE]
${systemDirective}

[NARRATIVE OUTPUT BOUNDARY]
- Emit no more than 3 total narrative_blocks.
- When companions or ambient figures are present, include exactly 1 dialogue block alongside 1–2 prose blocks so the room is not mute.

[SPATIAL INTERPRETATION CONTRACT]
- action_kind records the dominant action only. A turn may also contain dialogue, observation, investigation, manipulation, and physical movement.
- Never discard a completed physical move merely because another action is dominant.
- The User's natural-language action is sufficient movement authority. Do not require a separate navigation command or confirmation.

LITERAL AUTHORED MOVEMENT:
- If the action completes movement through an allowed authored exit, set logic_state.requested_transition to that exit's exact target node ID.
- This rule applies even when action_kind is COMMUNICATE, OBSERVE, INVESTIGATE, MANIPULATE, WAIT, or OTHER.
- Dialogue may itself authorize immediate movement. If the User invites or permits a present guide to lead them through a known exit and the narration has the party move, requested_transition is mandatory.
- Never narrate physical arrival in another authored node without proposing the matching exact target ID.

PERCEPTUAL OR ANOMALOUS DISPLACEMENT:
- When Blueprint rules, current horror conditions, or established recent fiction support a hallucinated, remembered, dreamlike, non-Euclidean, or otherwise subjective apparent location, prose may depict that apparent location while the physical node remains unchanged.
- For purely perceptual displacement, omit logic_state.requested_transition and emit no topology expansion.
- Use reconciliation mode MIXED when prose and physical spatial reality intentionally diverge.
- Do not diagnose or immediately dissolve the experience unless the authored fiction and current dramatic context call for it.

PHYSICAL WORLD EXPANSION:
- Propose topology expansion only when the supplied threshold override authorizes the recognized unmapped boundary.
- The dominant action_kind does not by itself authorize or forbid expansion.

NON-MOVEMENT:
- For SYSTEM_INIT and exact [USER_ACTION: OBSERVE], omit requested_transition and emit no expansion.
- If physical movement is blocked, incomplete, or ambiguous, keep the physical node unchanged. The prose may express the attempt, obstruction, uncertainty, or a supported anomalous experience.

--- RECENT HISTORY ---
${recentHistory}
--- END HISTORY ---

[USER ACTION]: ${userAction}${openingEstablishmentDirective}${isExpansionExpected ? '\n\n[SYSTEM OVERRIDE: Threshold entry detected. If the user action is a real movement attempt across the detected unmapped boundary, set `isExpansion: true` and populate `newNodeDef`. Otherwise, set isExpansion: false and omit newNodeDef.]' : '\n\n[TOPOLOGY DIRECTIVE: Static authored topology active. Do NOT create new canonical physical nodes. Set isExpansion: false and omit newNodeDef.]'}${(() => {
  const hasSurrealWorldRule = (context.scenario.worldRules || []).some((r) =>
    /\b(surreal|hallucinat|perceptual breakdown|dream|nightmare|delusion|fractur)\b/i.test(r)
  );
  const isPerceptionFractured =
    (context.runtime.coherence !== undefined && context.runtime.coherence < 0.5) ||
    context.runtime.phase === 'SURREAL' ||
    hasSurrealWorldRule;

  let reconciliationDirective = '';
  if (stateContext.reconciliationRevision > 0) {
    if (isPerceptionFractured) {
      reconciliationDirective = `\n[MEMORY REVISION ID: ${stateContext.reconciliationRevision}. User perception fractured.]`;
    } else {
      reconciliationDirective = `\n[NARRATIVE RECONCILIATION: Turn revision active. Maintain causal consistency.]`;
    }
  }

  const stateCtx = stateContext as Record<string, unknown> | undefined;
  const runtimeCtx = context.runtime as Record<string, unknown> | undefined;
  const isLastTransitionRejected = Boolean(
    stateCtx?.lastTransitionRejected ||
    stateCtx?.lastTransitionBlocked ||
    (stateCtx?.lastTransition as Record<string, unknown> | undefined)?.accepted === false ||
    runtimeCtx?.lastTransitionRejected ||
    runtimeCtx?.lastTransitionBlocked ||
    (runtimeCtx?.lastTransition as Record<string, unknown> | undefined)?.accepted === false
  );

  const navigationNote = isLastTransitionRejected
    ? '\n[NAVIGATION NOTE: The requested physical movement could not be completed. Narrate the physical obstacle, locked door, boundary, or hesitation naturally without breaking reality.]'
    : '';

  return `${reconciliationDirective}${navigationNote}`;
})()}${vocalizationPromptDirective}`;

    // Extract roster context from in-scope context (destructured from parsedRequest)
    const scenarioCastIds = context.cast.map((c) => c.id);
    const activeCastIds = context.cast
      .filter((m) => m.id !== context.player.characterId && !m.isUserCharacter && m.isPresent)
      .map((m) => m.id);

    // Per-request contract instance to eliminate concurrent race conditions
    const turnContract: StructuredResponseContract<TurnResult> = {
      ...EngineTurnStructuredResponseContract,
      normalizationContext: {
        scenarioCastIds,
        activeCastIds,
      },
    };

    // Call the LLM with strict Zod schema enforcement
    const engineResponse = await generateStructuredResponse(prompt, turnContract);

    const {
      boundedResult,
      intentReceipt,
      narrativeReconciliationReceipt,
      transitionReceipt,
      castTarget,
    } = finalizeTurnCausality({
      result: engineResponse,
      userAction,
      context,
      isExpansionExpected,
    });

    const explicitlyAddressedSpeakerId = getIntentBoundAddressedCharacterId(
      intentReceipt,
      castTarget
    );

    const cast_arrivals = Array.isArray(engineResponse.logic_state?.cast_arrivals)
      ? engineResponse.logic_state.cast_arrivals
      : [];
    const validArrivals = cast_arrivals.filter(
      (id: string) =>
        context.cast.some((member) => member.id === id) &&
        id !== context.player.characterId
    );
    const arrivedCastIds = new Set<string>(validArrivals);

    const cast_departures = Array.isArray(engineResponse.logic_state?.cast_departures)
      ? engineResponse.logic_state.cast_departures
      : [];
    const validDepartures = cast_departures.filter(
      (id: string) =>
        context.cast.some((member) => member.id === id) &&
        id !== context.player.characterId
    );

    // Publish the validated arrival/departure lists — never the raw model
    // proposals — so the client presence ledger can apply them deterministically.
    boundedResult.logic_state.cast_arrivals = validArrivals;
    boundedResult.logic_state.cast_departures = validDepartures;

    const auditoryContext = buildAuditoryContext(
      context,
      userAction,
      recentHistory,
      arrivedCastIds,
      explicitlyAddressedSpeakerId
    );

    const { error: dialogueContractError, normalizedBlocks } =
      validateAndNormalizeVocalization(
        boundedResult.narrative_blocks,
        auditoryContext
      );

    if (dialogueContractError) {
      console.error('[API /turn] Model dialogue contract mismatch:', dialogueContractError);
      const err = new Error('Model output violated dialogue contract') as Error & { code?: string };
      err.code = 'DIALOGUE_CONTRACT_VIOLATION';
      throw err;
    }

    boundedResult.narrative_blocks = normalizedBlocks;

    const respondingCharacterId = resolveDialogueSpeakerId(normalizedBlocks, context);

    const castInteractionReceipt = createIntentBoundCastInteractionReceipt({
      intentReceipt,
      castTarget,
      respondingCharacterId,
    });

    boundedResult.logic_state.cast_deltas = normalizeCastSkepticismDeltas(
      boundedResult.logic_state.cast_deltas,
      context
    );

    const canonicalConsequenceReceipt = finalizeCanonicalConsequences({
      proposal: engineResponse.consequence_proposal,
      context,
      intentReceipt,
      narrativeReconciliationReceipt,
    });

    const hgContext = context.horrorGrammar;
    const hgRuntime = hgContext.runtimeState;
    const hgBaseline = hgContext.authoringBaseline;

    const castActivityProposalReceipt = resolveCastActivity({
      proposal: engineResponse.cast_activity_proposal,
      eligibilityReceipt: hgContext.activityEligibility,
      currentContext: context,
      preEvents: hgRuntime.recentActivityEvents || [],
      currentTurn: context.runtime.turnNumber,
    });

    const situatedPressureReceipt = resolveSituatedPressure({
      proposal: engineResponse.situated_pressure_proposal,
      activityReceipt: castActivityProposalReceipt,
      currentContext: context,
      preThreads: hgRuntime?.activePressureThreads || [],
      currentTurn: context.runtime.turnNumber,
    });

    const validCauses = buildHorrorGrammarValidCauses({
      actionKind: intentReceipt.action_kind,
      acceptedActivityEventId: castActivityProposalReceipt.acceptedEventId,
      appliedConsequenceReferences: (canonicalConsequenceReceipt.decisions || [])
        .filter((decision) => decision.outcome === 'APPLIED')
        .map(
          (decision) =>
            `csq-${decision.mutation.domain}-${decision.mutation.operation}`
        ),
    });

    const valueStateReceipt = resolveValueState({
      proposal: engineResponse.value_state_proposal,
      preState: hgRuntime?.valueState || {},
      currentTurn: context.runtime.turnNumber,
      authoringBaseline: hgBaseline,
      userCharacterId: context.player.characterId,
      validCauses,
    });

    const characterPursuitReceipt = resolveCharacterPursuit({
      proposal: engineResponse.character_pursuit_proposal,
      preState: hgRuntime?.characterPursuits || {},
      currentTurn: context.runtime.turnNumber,
      authoringBaseline: hgBaseline,
      userCharacterId: context.player.characterId,
      validCauses,
    });

    const characterDevelopmentReceipt = resolveCharacterDevelopment({
      proposal: engineResponse.character_development_proposal,
      preState: hgRuntime?.characterDevelopment || {},
      currentTurn: context.runtime.turnNumber,
      userCharacterId: context.player.characterId,
      validCauses,
    });

    const pressureThreadTransitionReceipt = resolvePressureThreadTransitions({
      proposal: engineResponse.pressure_transition_proposal,
      preThreads: situatedPressureReceipt.postState,
      currentTurn: context.runtime.turnNumber,
      validCauses,
    });

    const characterStanceReceipt = finalizeCharacterStance({
      proposal: engineResponse.character_stance_proposal,
      context,
      intentReceipt,
      narrativeReconciliationReceipt,
      castInteractionReceipt,
    });

    const characterRelationshipReceipt = finalizeCharacterRelationships({
      proposal: engineResponse.character_relationship_proposal,
      context,
      intentReceipt,
      narrativeReconciliationReceipt,
      castInteractionReceipt,
    });

    const characterMemoryReceipt = finalizeCharacterMemory({
      proposal: engineResponse.character_memory_proposal,
      context,
      intentReceipt,
      narrativeReconciliationReceipt,
      castInteractionReceipt,
    });

    const worldMemoryReceipt = finalizeWorldMemory({
      proposal: engineResponse.world_memory_proposal,
      context,
      intentReceipt,
      narrativeReconciliationReceipt,
      castInteractionReceipt,
    });

    // 5. Deterministic Fictional Time & Pursuit Schedule Derivation
    let fictionalTimeReceipt: FictionalTimeReceipt;
    if (userAction === 'SYSTEM_INIT') {
      fictionalTimeReceipt = {
        version: 1,
        preState: hgRuntime.fictionalTime,
        acceptedCost: 'NONE',
        postState: hgRuntime.fictionalTime,
      };
    } else {
      const reconCost = narrativeReconciliationReceipt.fictional_time_cost || 'UNCLEAR';
      fictionalTimeReceipt = advanceFictionalTimeLedger(hgRuntime.fictionalTime, reconCost);
    }

    let pursuitScheduleReceipt: PursuitScheduleReceipt;
    if (userAction === 'SYSTEM_INIT') {
      pursuitScheduleReceipt = {
        version: 1,
        preState: hgRuntime.pursuitSchedule,
        postState: hgRuntime.pursuitSchedule,
      };
    } else {
      const postSchedule = advancePursuitScheduleLedger({
        preSchedule: hgRuntime.pursuitSchedule,
        eligibilityReceipt: hgContext.activityEligibility,
        fictionalTime: fictionalTimeReceipt.postState,
        turnNumber: context.runtime.turnNumber + 1,
        characterPursuits: hgBaseline.characterPursuits,
      });
      pursuitScheduleReceipt = {
        version: 1,
        preState: hgRuntime.pursuitSchedule,
        postState: postSchedule,
      };
    }

    // 5b. Deterministic Dramaturgical Story Engine Derivation (HG2 Packet 2)
    const dramaturgyRuntime: DramaturgyRuntimeState = context.dramaturgyRuntimeState
      ? {
          ...context.dramaturgyRuntimeState,
          discoveredClueIds: context.dramaturgyRuntimeState.discoveredClueIds ?? [],
        }
      : (context.dramaturgyContext
        ? {
            currentMacroPhase: context.dramaturgyContext.macroPhase,
            activePacingCadence: context.dramaturgyContext.activePacingCadence,
            consecutiveTurnsInCadence: 0,
            impendingClocks: {},
            characterStakes: {},
            milestones: [],
            receiptHistory: [],
            discoveredClueIds: [],
          }
        : {
            currentMacroPhase: 'EXPOSITION_BASELINE',
            activePacingCadence: 'SIMMERING_DREAD',
            consecutiveTurnsInCadence: 0,
            impendingClocks: {},
            characterStakes: {},
            milestones: [],
            receiptHistory: [],
            discoveredClueIds: [],
          });

    const carriedClueIds: string[] = dramaturgyRuntime.discoveredClueIds ?? [];
    const newClueIds: string[] = canonicalConsequenceReceipt.decisions
      .filter((d) => d.outcome === 'APPLIED' && d.mutation.domain === 'DISCOVERY')
      .map((d) => d.mutation.value);
    const discoveredClueIds: string[] = [...new Set([...carriedClueIds, ...newClueIds])];

    const dramaticGovResult = executePacingGovernor({
      runtimeState: dramaturgyRuntime,
      spine: context.dramaticSpine || null,
      playerRole: context.player.role,
      userAction,
      currentNodeId: context.topology.currentNodeId,
      discoveredClueIds,
      ratifiedConsequences: canonicalConsequenceReceipt.decisions
        .filter((d) => d.outcome === 'APPLIED')
        .map((d) => ({
          domain: d.mutation.domain,
          operation: d.mutation.operation,
          value: d.mutation.value,
        })),
      elapsedFictionalMinutes:
        fictionalTimeReceipt.acceptedCost === 'EXTENDED'
          ? 15
          : fictionalTimeReceipt.acceptedCost === 'SCENE_BEAT'
            ? 5
            : 1,
      fictionalTimeMarker: `MOMENT:${fictionalTimeReceipt.postState.moment_revision}_BEAT:${fictionalTimeReceipt.postState.scene_beat_revision}`,
      turnNumber: context.runtime.turnNumber + 1,
    });

    // Fail-closed admission: engine-computed dramaturgy state must satisfy the
    // schema before it may enter canonical post-state. The response is the
    // state carrier, so refusing the response preserves the client's prior
    // canonical state untouched.
    const dramaticOutputCheck = DramaturgyRuntimeStateSchema.safeParse(
      dramaticGovResult.nextRuntimeState
    );
    if (!dramaticOutputCheck.success) {
      console.error(
        '[HG2 GOVERNOR OUTPUT INVALID] Pacing governor produced schema-invalid dramaturgy state; failing turn closed.',
        JSON.stringify(dramaticOutputCheck.error.issues.slice(0, 4))
      );
      const err = new Error(
        'The pacing governor produced invalid dramaturgy state. The turn was refused and canonical state is unchanged.'
      ) as Error & { code?: string };
      err.code = 'DRAMATURGY_STATE_INVALID';
      throw err;
    }

    const dramaticTurnReceipt: DramaticTurnReceipt = dramaticGovResult.receipt;

    // 6. Isolated narrative composition
    const composedNarrativeBlocks: NarrativeBlock[] = [...boundedResult.narrative_blocks];
    if (
      castActivityProposalReceipt.admittedManifestation &&
      engineResponse.cast_activity_proposal?.kind === 'ACTIVITY' &&
      engineResponse.cast_activity_proposal.manifestationBlock
    ) {
      composedNarrativeBlocks.push(engineResponse.cast_activity_proposal.manifestationBlock as unknown as NarrativeBlock);
    }
    if (
      situatedPressureReceipt.admittedManifestation &&
      engineResponse.situated_pressure_proposal?.kind === 'PRESSURE' &&
      engineResponse.situated_pressure_proposal.manifestationBlock
    ) {
      composedNarrativeBlocks.push(engineResponse.situated_pressure_proposal.manifestationBlock as unknown as NarrativeBlock);
    }

    // 7. Build typed developer forensic record (Packet 1-8)
    const actProp = engineResponse.cast_activity_proposal;
    const pressProp = engineResponse.situated_pressure_proposal;

    const activityEvidence: import('../../src/types/horrorGrammar').ForensicActivityEvidence = {
      disposition:
        castActivityProposalReceipt.outcome === 'ACCEPTED'
          ? 'ACCEPTED'
          : castActivityProposalReceipt.outcome === 'REJECTED'
            ? 'REJECTED'
            : 'NONE',
      reasonCode: castActivityProposalReceipt.reasonCode,
      admittedToNarrative: castActivityProposalReceipt.admittedManifestation,
      proposalId: actProp?.kind === 'ACTIVITY' ? actProp.proposalId : null,
      castMemberId: actProp?.kind === 'ACTIVITY' ? actProp.castMemberId : null,
      pursuitId: actProp?.kind === 'ACTIVITY' ? actProp.pursuitId || null : null,
      locationNodeId: actProp?.kind === 'ACTIVITY' ? actProp.locationNodeId || null : null,
      perceptionPath: actProp?.kind === 'ACTIVITY' ? actProp.perceptionPath : null,
      activitySummary: actProp?.kind === 'ACTIVITY' ? actProp.activitySummary : null,
      authorityReferences: actProp?.kind === 'ACTIVITY' ? actProp.authorityReferences || [] : [],
      manifestationBlock: actProp?.kind === 'ACTIVITY' ? actProp.manifestationBlock || null : null,
      acceptedEventId: castActivityProposalReceipt.acceptedEventId,
    };

    const pressureEvidence: import('../../src/types/horrorGrammar').ForensicPressureEvidence = {
      disposition:
        situatedPressureReceipt.outcome === 'ACCEPTED'
          ? 'ACCEPTED'
          : situatedPressureReceipt.outcome === 'REJECTED'
            ? 'REJECTED'
            : 'NONE',
      reasonCode: situatedPressureReceipt.reasonCode,
      admittedToNarrative: situatedPressureReceipt.admittedManifestation,
      proposalId: pressProp?.kind === 'PRESSURE' ? pressProp.proposalId : null,
      valueAnchorId: pressProp?.kind === 'PRESSURE' ? pressProp.valueAnchorId : null,
      sourceReference: pressProp?.kind === 'PRESSURE' ? pressProp.sourceReference : null,
      operator: pressProp?.kind === 'PRESSURE' ? pressProp.operator : null,
      affectedDimension: pressProp?.kind === 'PRESSURE' ? pressProp.affectedDimension : null,
      adverseProspect: pressProp?.kind === 'PRESSURE' ? pressProp.adverseProspect : null,
      authorityReferences: pressProp?.kind === 'PRESSURE' ? pressProp.authorityReferences || [] : [],
      manifestationBlock: pressProp?.kind === 'PRESSURE' ? pressProp.manifestationBlock || null : null,
      acceptedThreadId: situatedPressureReceipt.acceptedThreadId,
    };

    const presentOpportunityIds = (hgContext.presentActorOpportunities || []).map(
      (o: { opportunityId?: string; castMemberId?: string }) => o.opportunityId || `opp-present-${o.castMemberId}`
    );
    const selectedOffscreenPursuitIds = (hgContext.offscreenPursuitOpportunities || [])
      .map((o) => o.pursuitId)
      .filter((id): id is string => Boolean(id));

    const horrorGrammarForensics: import('../../src/types/horrorGrammar').HorrorGrammarForensicRecord = {
      version: 1,
      turnNumber: context.runtime.turnNumber,
      preFictionalTime: hgContext.fictionalTime,
      presentOpportunityIds,
      selectedOffscreenPursuitIds,
      boundedOutPursuitIds: hgContext.activityEligibility.boundedOutPursuitIds,
      dormantCount: hgContext.activityEligibility.dormantCount,
      notDueCount: hgContext.activityEligibility.notDueCount,
      activityEvidence,
      pressureEvidence,
      causalDecisions: {
        valueDecisions: valueStateReceipt.decisions || [],
        pursuitDecisions: characterPursuitReceipt.decisions || [],
        developmentDecisions: characterDevelopmentReceipt.decisions || [],
        pressureTransitions: pressureThreadTransitionReceipt.decisions || [],
      },
      composedNarrativeBlockCount: composedNarrativeBlocks.length,
    };

    const finalResponse: TurnResponse = {
      narrative_blocks: composedNarrativeBlocks,
      logic_state: {
        ...boundedResult.logic_state,
        dramaturgyState: dramaticGovResult.nextRuntimeState,
      },
      topologyDelta: boundedResult.topologyDelta,
      transitionReceipt,
      castInteractionReceipt,
      intentReceipt,
      narrativeReconciliationReceipt,
      canonicalConsequenceReceipt,
      characterStanceReceipt,
      characterRelationshipReceipt,
      characterMemoryReceipt,
      worldMemoryReceipt,
      fictionalTimeReceipt,
      castActivityReceipt: hgContext.activityEligibility,
      pursuitScheduleReceipt,
      castActivityProposalReceipt,
      situatedPressureReceipt,
      valueStateReceipt,
      characterPursuitReceipt,
      characterDevelopmentReceipt,
      pressureThreadTransitionReceipt,
      horrorGrammarForensics,
      dramaticTurnReceipt,
    };

    return {
      finalResponse,
      composedNarrativeBlocks,
    };
}

export function handleTurnRouteError(modelErr: unknown, res: Response) {
  if (
    modelErr instanceof ProviderPrepaymentDepletedError ||
    (modelErr as { code?: string })?.code === 'PREPAYMENT_DEPLETED'
  ) {
    console.error('[API /turn] Prepayment credits depleted');
    return res.status(429).json({
      error: 'Google AI Studio prepayment credits are depleted. Switch to an unpaid Free Tier project key or add credits in AI Studio.',
      code: 'PREPAYMENT_DEPLETED',
    });
  }
  if (
    modelErr instanceof ProviderRateLimitError ||
    (modelErr as { code?: string })?.code === 'RATE_LIMIT_EXCEEDED'
  ) {
    console.warn('[API /turn] AI Provider rate limit exceeded');
    return res.status(429).json({
      error: 'AI provider rate limit reached (15 RPM on Free Tier). Please wait a few seconds before retrying.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  }
  if (
    modelErr instanceof ProviderCapacityError ||
    (modelErr as { code?: string })?.code === 'PROVIDER_HIGH_DEMAND'
  ) {
    console.warn('[API /turn] AI Provider high demand');
    return res.status(503).json({
      error: 'AI provider is currently experiencing high demand. Please retry in a few moments.',
      code: 'PROVIDER_HIGH_DEMAND',
    });
  }
  if (
    modelErr instanceof ProviderRefusalError ||
    (modelErr as { code?: string })?.code === 'PROVIDER_REFUSAL'
  ) {
    console.warn('[API /turn] AI Provider refusal');
    return res.status(502).json({
      error: 'AI provider declined turn generation',
      code: 'PROVIDER_REFUSAL',
    });
  }
  if (
    modelErr instanceof EmptyProviderResponseError ||
    (modelErr as { code?: string })?.code === 'EMPTY_PROVIDER_RESPONSE'
  ) {
    console.error('[API /turn] AI Provider empty response:', (modelErr as Error)?.message);
    return res.status(502).json({
      error: (modelErr as Error)?.message || 'AI provider returned an empty response',
      code: 'PROVIDER_FAILURE',
    });
  }
  if (
    modelErr instanceof ProviderRequestRejectedError ||
    (modelErr as { code?: string })?.code === 'PROVIDER_REQUEST_REJECTED'
  ) {
    console.error('[API /turn] AI Provider rejected request configuration');
    return res.status(502).json({
      error: (modelErr as Error)?.message || 'AI provider rejected the turn generation request',
      code: 'PROVIDER_REQUEST_REJECTED',
    });
  }
  if (modelErr instanceof z.ZodError || (modelErr as { name?: string })?.name === 'ZodError') {
    console.error('[API /turn] Model contract mismatch:', modelErr);
    const zodError =
      modelErr instanceof z.ZodError
        ? modelErr
        : new z.ZodError((modelErr as { issues?: z.ZodIssue[] }).issues || []);
    const diagnostics = buildZodDiagnostics(zodError);
    return res.status(502).json({
      error: 'Model output violated schema contract',
      code: 'MODEL_CONTRACT_MISMATCH',
      diagnostics,
    });
  }
  if (modelErr instanceof SyntaxError) {
    console.error('[API /turn] Model JSON parse failure:', modelErr);
    const diagnostics = buildJsonParseDiagnostics();
    return res.status(502).json({
      error: 'Model output violated schema contract',
      code: 'MODEL_CONTRACT_MISMATCH',
      diagnostics,
    });
  }
  if ((modelErr as { code?: string })?.code === 'DIALOGUE_CONTRACT_VIOLATION') {
    const diagnostics = buildDialogueDiagnostics();
    return res.status(502).json({
      error: 'Model output violated dialogue contract',
      code: 'MODEL_CONTRACT_MISMATCH',
      diagnostics,
    });
  }
  if ((modelErr as { code?: string })?.code === 'DRAMATURGY_STATE_INVALID') {
    return res.status(500).json({
      error:
        'The pacing governor produced invalid dramaturgy state. The turn was refused and canonical state is unchanged.',
      code: 'DRAMATURGY_STATE_INVALID',
    });
  }
  if ((modelErr as { code?: string })?.code === 'MISSING_HORROR_GRAMMAR_CONTEXT') {
    return res.status(400).json({
      error: 'Invalid turn request: context.horrorGrammar is required for Engine turn processing',
      code: 'MISSING_HORROR_GRAMMAR_CONTEXT',
    });
  }
  console.error('[API /turn] Unexpected error:', modelErr);
  return res.status(502).json({
    error: 'AI provider turn generation failed',
    code: (modelErr as { code?: string })?.code || 'PROVIDER_FAILURE',
  });
}

export const turnRouter = Router();

turnRouter.post('/', async (req, res) => {
  let parsedRequest;
  try {
    normalizeTurnRequestPayload(req.body);
    parsedRequest = TurnRequestSchema.parse(req.body);
  } catch (err) {
    console.error('[API /turn] Request validation error:', err);
    return res.status(400).json({
      error: 'Invalid turn request',
      code: 'INVALID_REQUEST',
      details: err instanceof z.ZodError ? err.flatten() : String(err),
    });
  }

  if (!parsedRequest.context.horrorGrammar) {
    return res.status(400).json({
      error: 'Invalid turn request: context.horrorGrammar is required for Engine turn processing',
      code: 'MISSING_HORROR_GRAMMAR_CONTEXT',
    });
  }

  try {
    const { finalResponse } = await processTurnExecution(parsedRequest);
    return res.json(finalResponse);
  } catch (error: unknown) {
    return handleTurnRouteError(error, res);
  }
});

export async function handleStreamTurnRequest(req: Request, res: Response) {
  let parsedRequest;
  try {
    normalizeTurnRequestPayload(req.body);
    parsedRequest = TurnRequestSchema.parse(req.body);
  } catch (err) {
    console.error('[API /turn-stream] Request validation error:', err);
    return res.status(400).json({
      error: 'Invalid turn request',
      code: 'INVALID_REQUEST',
      details: err instanceof z.ZodError ? err.flatten() : String(err),
    });
  }

  if (!parsedRequest.context.horrorGrammar) {
    return res.status(400).json({
      error: 'Invalid turn request: context.horrorGrammar is required for Engine turn processing',
      code: 'MISSING_HORROR_GRAMMAR_CONTEXT',
    });
  }

  const sse = new SseStream(res);
  req.on('close', () => {
    sse.close();
  });

  try {
    const { finalResponse, composedNarrativeBlocks } = await processTurnExecution(parsedRequest);

    for (const block of composedNarrativeBlocks) {
      if (block.content) {
        const words = block.content.split(/(\s+)/);
        for (const word of words) {
          if (word) {
            sse.sendToken(word);
          }
        }
      }
    }

    sse.complete(finalResponse);
  } catch (error: unknown) {
    const errObj = error as { code?: string; name?: string; message?: string; issues?: z.ZodIssue[] } | null | undefined;
    let errorCode = errObj?.code || 'PROVIDER_FAILURE';
    let errorMessage = 'AI provider turn generation failed';
    let diagnostics: unknown[] = [];

    if (error instanceof ProviderPrepaymentDepletedError || errObj?.code === 'PREPAYMENT_DEPLETED') {
      errorCode = 'PREPAYMENT_DEPLETED';
      errorMessage = 'Google AI Studio prepayment credits are depleted. Switch to an unpaid Free Tier project key or add credits in AI Studio.';
    } else if (error instanceof ProviderRateLimitError || errObj?.code === 'RATE_LIMIT_EXCEEDED') {
      errorCode = 'RATE_LIMIT_EXCEEDED';
      errorMessage = 'AI provider rate limit reached (15 RPM on Free Tier). Please wait a few seconds before retrying.';
    } else if (error instanceof ProviderCapacityError || errObj?.code === 'PROVIDER_HIGH_DEMAND') {
      errorCode = 'PROVIDER_HIGH_DEMAND';
      errorMessage = 'AI provider is currently experiencing high demand. Please retry in a few moments.';
    } else if (error instanceof ProviderRefusalError || errObj?.code === 'PROVIDER_REFUSAL') {
      errorCode = 'PROVIDER_REFUSAL';
      errorMessage = 'AI provider declined turn generation';
    } else if (error instanceof EmptyProviderResponseError || errObj?.code === 'EMPTY_PROVIDER_RESPONSE') {
      errorCode = 'PROVIDER_FAILURE';
      errorMessage = errObj?.message || 'AI provider returned an empty response';
    } else if (error instanceof ProviderRequestRejectedError || errObj?.code === 'PROVIDER_REQUEST_REJECTED') {
      errorCode = 'PROVIDER_REQUEST_REJECTED';
      errorMessage = errObj?.message || 'AI provider rejected the turn generation request';
    } else if (error instanceof z.ZodError || errObj?.name === 'ZodError') {
      errorCode = 'MODEL_CONTRACT_MISMATCH';
      errorMessage = 'Model output violated schema contract';
      diagnostics = buildZodDiagnostics(error instanceof z.ZodError ? error : new z.ZodError(errObj?.issues || [])).issues;
    } else if (error instanceof SyntaxError) {
      errorCode = 'MODEL_CONTRACT_MISMATCH';
      errorMessage = 'Model output violated schema contract';
      diagnostics = buildJsonParseDiagnostics().issues;
    } else if (errObj?.code === 'DIALOGUE_CONTRACT_VIOLATION') {
      errorCode = 'MODEL_CONTRACT_MISMATCH';
      errorMessage = 'Model output violated dialogue contract';
      diagnostics = buildDialogueDiagnostics().issues;
    } else if (errObj?.code === 'DRAMATURGY_STATE_INVALID') {
      errorCode = 'DRAMATURGY_STATE_INVALID';
      errorMessage = 'The pacing governor produced invalid dramaturgy state. The turn was refused and canonical state is unchanged.';
    }

    sse.error(errorMessage, diagnostics, errorCode);
  }
}

export const turnStreamRouter = Router();
turnStreamRouter.post('/', handleStreamTurnRequest);
turnRouter.post(['/turn-stream', '/stream'], handleStreamTurnRequest);

