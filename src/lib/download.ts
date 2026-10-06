/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Message, ContextReceipt, RuntimeStateSnapshot, HorrorGrammarForensicRecord } from '../types';
import { buildEngineTurnContext, buildContextReceipt } from './buildEngineTurnContext';

/**
 * Pure canonical-state-diff helper comparing pre- and post-runtime state snapshots.
 */
export function buildCanonicalStateDiff(
  preSnapshot?: RuntimeStateSnapshot,
  postSnapshot?: RuntimeStateSnapshot
): string[] {
  if (!preSnapshot || !postSnapshot) {
    return ['Canonical snapshot diff unavailable.'];
  }

  const diffs: string[] = [];

  const scalarFields: Array<{
    key: keyof RuntimeStateSnapshot;
    label: string;
  }> = [
    { key: 'turnCount', label: 'TURN COUNT' },
    { key: 'currentNodeId', label: 'CURRENT NODE' },
    { key: 'activeVector', label: 'ACTIVE VECTOR' },
    { key: 'activeTier', label: 'ACTIVE TIER' },
    { key: 'phase', label: 'PHASE' },
    { key: 'tension', label: 'TENSION' },
    { key: 'coherence', label: 'COHERENCE' },
    { key: 'reconciliationRevision', label: 'RECONCILIATION REVISION' },
  ];

  for (const { key, label } of scalarFields) {
    const preVal = preSnapshot[key];
    const postVal = postSnapshot[key];
    if (preVal !== postVal) {
      diffs.push(`${label}: ${String(preVal)} → ${String(postVal)}`);
    }
  }

  const preFlags = new Set(preSnapshot.activeFlags || []);
  const postFlags = new Set(postSnapshot.activeFlags || []);

  const addedFlags = [...postFlags].filter((flag) => !preFlags.has(flag));
  const removedFlags = [...preFlags].filter((flag) => !postFlags.has(flag));

  if (addedFlags.length > 0) {
    diffs.push(`ACTIVE FLAGS ADDED: ${addedFlags.join(', ')}`);
  }
  if (removedFlags.length > 0) {
    diffs.push(`ACTIVE FLAGS REMOVED: ${removedFlags.join(', ')}`);
  }

  if (diffs.length === 0) {
    return ['No canonical snapshot changes.'];
  }

  return diffs;
}

export function formatStanceState(
  record: { focus?: string; stance?: string } | null | undefined
): string {
  if (!record || !record.focus || !record.stance) return 'UNSET';
  return `${record.focus}/${record.stance}`;
}

export function formatRelationshipRecordState(
  record: { source_character_id?: string; target_character_id?: string; kind?: string; intensity?: number } | null | undefined
): string {
  if (!record || typeof record.intensity !== 'number') return 'UNSET';
  return `${record.intensity}`;
}

/**
 * Converts a structured message array into a standardized markdown file and downloads it.
 */
export const exportConversationToMarkdown = (
  messages: Message[],
  sessionTitle: string = 'terror-machine-log'
): void => {
  if (!messages || messages.length === 0) {
    console.warn('// EXPORT FAILED // History buffer is empty.');
    return;
  }

  const header =
    `# THE TERROR MACHINE // CONVERSATION LOG\n` +
    `*Generated on: ${new Date().toISOString()}*\n` +
    `==================================================\n\n`;

  const body = messages
    .map((msg, index) => {
      const actor = msg.role === 'user' ? '### USER' : '### THE VOICE';

      // Handle array blocks or fall back to raw string content
      let textContent = '';
      if (Array.isArray(msg.blocks)) {
        textContent = msg.blocks.map((b: any) => b.content).join('\n');
      } else {
        textContent = msg.content || '';
      }

      return `${actor} [Turn ${index + 1}]\n\n${textContent.trim()}\n\n---`;
    })
    .join('\n\n');

  const fullContent = header + body;
  const blob = new Blob([fullContent], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const downloadLink = document.createElement('a');
  downloadLink.href = url;
  downloadLink.setAttribute('download', `${sessionTitle}-${Date.now()}.md`);

  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
};

/**
 * Triggers a browser download of a JSON object as a file.
 * @param data The object to download.
 * @param filename The name of the file (e.g., 'scenario_blueprint.json').
 */
export function generateHauntedHouseBlueprintFilename(titleOrLocation?: string): string {
  if (!titleOrLocation || typeof titleOrLocation !== 'string') {
    return 'haunted-house-scenario.json';
  }
  const clean = titleOrLocation
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = clean || 'scenario';
  return `haunted-house-${slug}.json`;
}

export function downloadJson(data: any, filename: string) {
  try {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    // Small delay before cleanup to ensure trigger in some browsers
    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }, 100);
  } catch (error) {
    console.error('Download failed:', error);
  }
}

export const escapeHtml = (unsafe: string | null | undefined): string => {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const getEngineLogicData = (message: any): Record<string, unknown> | null => {
  const logicData: Record<string, unknown> = {};

  if (typeof message.engine_thoughts === 'string' && message.engine_thoughts.trim()) {
    logicData.engine_thoughts = message.engine_thoughts;
  }
  if (message.logic_state !== undefined) {
    logicData.logic_state = message.logic_state;
  }
  if (message.topologyDelta !== undefined) {
    logicData.topologyDelta = message.topologyDelta;
  }
  if (message.validation !== undefined) {
    logicData.validation = message.validation;
  }
  if (message.transitionReceipt !== undefined) {
    logicData.transitionReceipt = message.transitionReceipt;
  }
  if (message.turnReceipt !== undefined) {
    logicData.turnReceipt = message.turnReceipt;
  }
  if (message.canonicalConsequenceReceipt !== undefined) {
    logicData.canonicalConsequenceReceipt = message.canonicalConsequenceReceipt;
  }
  if (message.characterStanceReceipt !== undefined) {
    logicData.characterStanceReceipt = message.characterStanceReceipt;
  }
  if (message.characterRelationshipReceipt !== undefined) {
    logicData.characterRelationshipReceipt = message.characterRelationshipReceipt;
  }
  if (message.characterMemoryReceipt !== undefined) {
    logicData.characterMemoryReceipt = message.characterMemoryReceipt;
  }
  if (message.failureReceipt !== undefined) {
    logicData.failureReceipt = message.failureReceipt;
  }
  if (message.dramaticTurnReceipt !== undefined) {
    logicData.dramaticTurnReceipt = message.dramaticTurnReceipt;
  }
  if (message.turnReceipt?.dramaticTurnReceipt !== undefined) {
    logicData.dramaticTurnReceipt =
      logicData.dramaticTurnReceipt || message.turnReceipt.dramaticTurnReceipt;
  }
  if (message.clueDiscoveryReceipt !== undefined) {
    logicData.clueDiscoveryReceipt = message.clueDiscoveryReceipt;
  }

  return Object.keys(logicData).length > 0 ? logicData : null;
};

const getEngineLogicSummary = (logicData: Record<string, unknown>): string => {
  const summary = ['TTM LOGIC'];
  const turnReceipt = logicData.turnReceipt;
  const logicState = logicData.logic_state;
  const topologyDelta = logicData.topologyDelta;
  const failureReceipt = logicData.failureReceipt;

  if (failureReceipt && typeof failureReceipt === 'object') {
    const fail = failureReceipt as Record<string, unknown>;
    if (fail.code) {
      summary.push(`FAILURE: ${String(fail.code).toUpperCase()}`);
    }
    if (fail.status != null) {
      summary.push(`STATUS: ${String(fail.status)}`);
    }
  }

  if (logicState && typeof logicState === 'object') {
    const state = logicState as Record<string, unknown>;
    if (state.current_phase != null)
      summary.push(`PHASE: ${String(state.current_phase).toUpperCase()}`);
    if (state.suggested_tension != null)
      summary.push(`TENSION: ${String(state.suggested_tension)}`);
  }

  let turn: Record<string, unknown> | undefined;
  if (turnReceipt && typeof turnReceipt === 'object') {
    turn = turnReceipt as Record<string, unknown>;
  }

  const intentReceipt = turn?.intentReceipt as Record<string, unknown> | undefined;
  if (intentReceipt && typeof intentReceipt === 'object' && intentReceipt.action_kind) {
    const kind = String(intentReceipt.action_kind).toUpperCase();
    const subtype = intentReceipt.action_subtype
      ? `/${String(intentReceipt.action_subtype).toUpperCase()}`
      : '';
    summary.push(`INTENT: ${kind}${subtype}`);
    if (intentReceipt.pressure_direction) {
      summary.push(`PRESSURE: ${String(intentReceipt.pressure_direction).toUpperCase()}`);
    }
    if (intentReceipt.intent_synergy) {
      summary.push(`SYNERGY: ${String(intentReceipt.intent_synergy).toUpperCase()}`);
    }
  } else if (logicState && typeof logicState === 'object') {
    const state = logicState as Record<string, unknown>;
    if (state.intent_classification != null) {
      summary.push(`INTENT: ${String(state.intent_classification).toUpperCase()}`);
    }
  }

  const reconciliationReceipt = turn?.narrativeReconciliationReceipt as Record<string, unknown> | undefined;
  if (reconciliationReceipt && typeof reconciliationReceipt === 'object' && reconciliationReceipt.mode) {
    summary.push(`RECONCILIATION: ${String(reconciliationReceipt.mode).toUpperCase()}`);
  }

  if (topologyDelta && typeof topologyDelta === 'object') {
    const topology = topologyDelta as Record<string, unknown>;
    if (topology.isExpansion != null)
      summary.push(`EXPANSION: ${String(Boolean(topology.isExpansion)).toUpperCase()}`);
  }

  if (turn) {
    const castReceipt = turn.castContinuityReceipt as Record<string, unknown> | undefined;
    if (
      castReceipt &&
      typeof castReceipt === 'object' &&
      castReceipt.state &&
      typeof castReceipt.state === 'object' &&
      !Array.isArray(castReceipt.state)
    ) {
      const count = Object.keys(castReceipt.state).length;
      summary.push(`CAST CONTINUITY: ${count}`);
    }

    const presenceReceipt = turn.castPresenceReceipt as Record<string, unknown> | undefined;
    if (
      presenceReceipt &&
      typeof presenceReceipt === 'object' &&
      presenceReceipt.state &&
      typeof presenceReceipt.state === 'object' &&
      !Array.isArray(presenceReceipt.state)
    ) {
      const count = Object.keys(presenceReceipt.state).length;
      summary.push(`CAST PRESENCE: ${count}`);
    }
  }

  return `[ ${summary.join(' // ')} ]`;
};

interface ParsedTelemetrySections {
  intentAndPressure: Array<{ label: string; value: string }>;
  intentSynergy: { value: string; note: string };
  narrativeReconciliation: Array<{ label: string; value: string }>;
  canonicalConsequences: {
    hasReceipt: boolean;
    decisions: Array<{
      domain: string;
      operation: string;
      value: string;
      outcome: string;
      reason: string;
      rationale?: string;
    }>;
    inventoryAdded: string[];
    inventoryRemoved: string[];
    injuriesAdded: string[];
    injuriesRemoved: string[];
    psychologicalStatusChange: { before: string; after: string } | null;
    hasChanges: boolean;
  };
  characterStance: {
    hasReceipt: boolean;
    decisions: Array<{
      characterId: string;
      focus: string;
      stance: string;
      outcome: string;
      reason: string;
      rationale?: string;
      before?: { focus: string; stance: string } | null;
      after?: { focus: string; stance: string } | null;
    }>;
    hasChanges: boolean;
  };
  characterRelationships: {
    hasReceipt: boolean;
    decisions: Array<{
      sourceCharacterId: string;
      targetCharacterId: string;
      kind: string;
      delta: number;
      outcome: string;
      reason: string;
      rationale?: string;
      before?: { source_character_id: string; target_character_id: string; kind: string; intensity: number } | null;
      after?: { source_character_id: string; target_character_id: string; kind: string; intensity: number } | null;
    }>;
    hasChanges: boolean;
  };
  characterMemory: {
    hasReceipt: boolean;
    decisions: Array<{
      characterId: string;
      fact: string;
      source: string;
      certainty: string;
      outcome: string;
      reason: string;
      rationale?: string;
      entry?: { id: string; fact: string; source: string; certainty: string; acquired_turn: number } | null;
    }>;
    hasChanges: boolean;
  };
  worldMemory: {
    hasReceipt: boolean;
    decisions: Array<{
      kind: string;
      scope: string;
      nodeId?: string | null;
      statement: string;
      outcome: string;
      reason: string;
      rationale?: string;
      entry?: {
        id: string;
        kind: string;
        scope: string;
        node_id: string | null;
        statement: string;
        established_turn: number;
      } | null;
    }>;
    hasChanges: boolean;
  };
  canonicalStateDiff: {
    diffLines: string[];
    transition: Array<{ label: string; value: string }>;
  };
  castPresenceAndInteraction: {
    presenceCount: string;
    interaction: Array<{ label: string; value: string }>;
  };
  continuityAndMemory: {
    continuityCount: string;
    acceptedDeltaCount: string;
    acceptedDeltas: string[];
    memoryEchoCandidate: string;
  };
  schemaRepairsAndValidation: {
    validation: Array<{ label: string; value: string }>;
    failure?: Array<{ label: string; value: string }>;
  };
  horrorGrammarForensics: {
    hasReceipts: boolean;
    record?: HorrorGrammarForensicRecord;
    fictionalTime?: Record<string, unknown>;
    castActivity?: {
      eligibility?: Record<string, unknown>;
      proposalReceipt?: Record<string, unknown>;
    };
    situatedPressure?: Record<string, unknown>;
    valueState?: Record<string, unknown>;
    characterPursuit?: Record<string, unknown>;
    characterDevelopment?: Record<string, unknown>;
    pressureTransitions?: Record<string, unknown>;
  };
  dramaturgyPacing: {
    hasReceipts: boolean;
    macroPhase?: string;
    pacingCadence?: string;
    phaseTransition?: {
      fromPhase?: string;
      toPhase?: string;
      gateMilestoneId?: string;
      triggeredBy?: string;
    };
    clockAdvances: Array<{ clockId: string; newLevel: number; cause: string }>;
    composureDeltas: Array<{
      characterId: string;
      oldComposure: number;
      newComposure: number;
      delta: number;
      cause: string;
    }>;
    breakingPointRefusals: Array<{ characterId: string; reason: string }>;
  };
  rawPayload: Record<string, unknown>;
}

export function parseTelemetrySections(logicData: Record<string, unknown>): ParsedTelemetrySections {
  const turn = (
    (typeof logicData.turnReceipt === 'object' && logicData.turnReceipt !== null
      ? logicData.turnReceipt
      : undefined) ||
    (typeof logicData.turn === 'object' && logicData.turn !== null
      ? logicData.turn
      : undefined)
  ) as Record<string, unknown> | undefined;

  const intentReceipt = (turn && typeof turn.intentReceipt === 'object' && turn.intentReceipt !== null
    ? turn.intentReceipt
    : undefined) as Record<string, unknown> | undefined;

  const reconciliationReceipt = (turn &&
  typeof turn.narrativeReconciliationReceipt === 'object' &&
  turn.narrativeReconciliationReceipt !== null
    ? turn.narrativeReconciliationReceipt
    : undefined) as Record<string, unknown> | undefined;

  const castPresenceReceipt = (turn &&
  typeof turn.castPresenceReceipt === 'object' &&
  turn.castPresenceReceipt !== null
    ? turn.castPresenceReceipt
    : undefined) as Record<string, unknown> | undefined;

  const castInteractionReceipt = (turn &&
  typeof turn.castInteractionReceipt === 'object' &&
  turn.castInteractionReceipt !== null
    ? turn.castInteractionReceipt
    : undefined) as Record<string, unknown> | undefined;

  const castContinuityReceipt = (turn &&
  typeof turn.castContinuityReceipt === 'object' &&
  turn.castContinuityReceipt !== null
    ? turn.castContinuityReceipt
    : undefined) as Record<string, unknown> | undefined;

  const logicState = (
    typeof logicData.logic_state === 'object' && logicData.logic_state !== null
      ? (logicData.logic_state as Record<string, unknown>)
      : undefined
  );

  const consequenceReceipt = (
    (turn &&
    typeof turn.canonicalConsequenceReceipt === 'object' &&
    turn.canonicalConsequenceReceipt !== null
      ? turn.canonicalConsequenceReceipt
      : undefined) ||
    (typeof logicData.canonicalConsequenceReceipt === 'object' &&
    logicData.canonicalConsequenceReceipt !== null
      ? logicData.canonicalConsequenceReceipt
      : undefined) ||
    (logicState &&
    typeof logicState.canonicalConsequenceReceipt === 'object' &&
    logicState.canonicalConsequenceReceipt !== null
      ? (logicState.canonicalConsequenceReceipt as Record<string, unknown>)
      : undefined)
  ) as Record<string, unknown> | undefined;

  const stanceReceipt = (
    (turn &&
    typeof turn.characterStanceReceipt === 'object' &&
    turn.characterStanceReceipt !== null
      ? turn.characterStanceReceipt
      : undefined) ||
    (typeof logicData.characterStanceReceipt === 'object' &&
    logicData.characterStanceReceipt !== null
      ? logicData.characterStanceReceipt
      : undefined) ||
    (logicState &&
    typeof logicState.characterStanceReceipt === 'object' &&
    logicState.characterStanceReceipt !== null
      ? (logicState.characterStanceReceipt as Record<string, unknown>)
      : undefined)
  ) as Record<string, unknown> | undefined;

  const relationshipReceipt = (
    (turn &&
    typeof turn.characterRelationshipReceipt === 'object' &&
    turn.characterRelationshipReceipt !== null
      ? turn.characterRelationshipReceipt
      : undefined) ||
    (typeof logicData.characterRelationshipReceipt === 'object' &&
    logicData.characterRelationshipReceipt !== null
      ? logicData.characterRelationshipReceipt
      : undefined) ||
    (logicState &&
    typeof logicState.characterRelationshipReceipt === 'object' &&
    logicState.characterRelationshipReceipt !== null
      ? (logicState.characterRelationshipReceipt as Record<string, unknown>)
      : undefined)
  ) as Record<string, unknown> | undefined;

  const memoryReceipt = (
    (turn &&
    typeof turn.characterMemoryReceipt === 'object' &&
    turn.characterMemoryReceipt !== null
      ? turn.characterMemoryReceipt
      : undefined) ||
    (typeof logicData.characterMemoryReceipt === 'object' &&
    logicData.characterMemoryReceipt !== null
      ? logicData.characterMemoryReceipt
      : undefined) ||
    (logicState &&
    typeof logicState.characterMemoryReceipt === 'object' &&
    logicState.characterMemoryReceipt !== null
      ? (logicState.characterMemoryReceipt as Record<string, unknown>)
      : undefined)
  ) as Record<string, unknown> | undefined;

  const worldMemoryReceipt = (
    (turn &&
    typeof turn.worldMemoryReceipt === 'object' &&
    turn.worldMemoryReceipt !== null
      ? turn.worldMemoryReceipt
      : undefined) ||
    (typeof logicData.worldMemoryReceipt === 'object' &&
    logicData.worldMemoryReceipt !== null
      ? logicData.worldMemoryReceipt
      : undefined) ||
    (logicState &&
    typeof logicState.worldMemoryReceipt === 'object' &&
    logicState.worldMemoryReceipt !== null
      ? (logicState.worldMemoryReceipt as Record<string, unknown>)
      : undefined)
  ) as Record<string, unknown> | undefined;

  const transitionReceipt = (
    typeof logicData.transitionReceipt === 'object' && logicData.transitionReceipt !== null
      ? logicData.transitionReceipt
      : undefined
  ) as Record<string, unknown> | undefined;

  const fictionalTimeReceipt = (
    (turn &&
    typeof turn.fictionalTimeReceipt === 'object' &&
    turn.fictionalTimeReceipt !== null
      ? turn.fictionalTimeReceipt
      : undefined) ||
    (typeof logicData.fictionalTimeReceipt === 'object' &&
    logicData.fictionalTimeReceipt !== null
      ? logicData.fictionalTimeReceipt
      : undefined)
  ) as Record<string, unknown> | undefined;

  const castActivityReceipt = (
    (turn &&
    typeof turn.castActivityReceipt === 'object' &&
    turn.castActivityReceipt !== null
      ? turn.castActivityReceipt
      : undefined) ||
    (typeof logicData.castActivityReceipt === 'object' &&
    logicData.castActivityReceipt !== null
      ? logicData.castActivityReceipt
      : undefined)
  ) as Record<string, unknown> | undefined;

  const castActivityProposalReceipt = (
    (turn &&
    typeof turn.castActivityProposalReceipt === 'object' &&
    turn.castActivityProposalReceipt !== null
      ? turn.castActivityProposalReceipt
      : undefined) ||
    (typeof logicData.castActivityProposalReceipt === 'object' &&
    logicData.castActivityProposalReceipt !== null
      ? logicData.castActivityProposalReceipt
      : undefined)
  ) as Record<string, unknown> | undefined;

  const situatedPressureReceipt = (
    (turn &&
    typeof turn.situatedPressureReceipt === 'object' &&
    turn.situatedPressureReceipt !== null
      ? turn.situatedPressureReceipt
      : undefined) ||
    (typeof logicData.situatedPressureReceipt === 'object' &&
    logicData.situatedPressureReceipt !== null
      ? logicData.situatedPressureReceipt
      : undefined)
  ) as Record<string, unknown> | undefined;

  const valueStateReceipt = (
    (turn &&
    typeof turn.valueStateReceipt === 'object' &&
    turn.valueStateReceipt !== null
      ? turn.valueStateReceipt
      : undefined) ||
    (typeof logicData.valueStateReceipt === 'object' &&
    logicData.valueStateReceipt !== null
      ? logicData.valueStateReceipt
      : undefined)
  ) as Record<string, unknown> | undefined;

  const characterPursuitReceipt = (
    (turn &&
    typeof turn.characterPursuitReceipt === 'object' &&
    turn.characterPursuitReceipt !== null
      ? turn.characterPursuitReceipt
      : undefined) ||
    (typeof logicData.characterPursuitReceipt === 'object' &&
    logicData.characterPursuitReceipt !== null
      ? logicData.characterPursuitReceipt
      : undefined)
  ) as Record<string, unknown> | undefined;

  const characterDevelopmentReceipt = (
    (turn &&
    typeof turn.characterDevelopmentReceipt === 'object' &&
    turn.characterDevelopmentReceipt !== null
      ? turn.characterDevelopmentReceipt
      : undefined) ||
    (typeof logicData.characterDevelopmentReceipt === 'object' &&
    logicData.characterDevelopmentReceipt !== null
      ? logicData.characterDevelopmentReceipt
      : undefined)
  ) as Record<string, unknown> | undefined;

  const pressureThreadTransitionReceipt = (
    (turn &&
    typeof turn.pressureThreadTransitionReceipt === 'object' &&
    turn.pressureThreadTransitionReceipt !== null
      ? turn.pressureThreadTransitionReceipt
      : undefined) ||
    (typeof logicData.pressureThreadTransitionReceipt === 'object' &&
    logicData.pressureThreadTransitionReceipt !== null
      ? logicData.pressureThreadTransitionReceipt
      : undefined)
  ) as Record<string, unknown> | undefined;

  const validation = (typeof logicData.validation === 'object' && logicData.validation !== null
    ? logicData.validation
    : undefined) as Record<string, unknown> | undefined;

  const failureReceipt = (typeof logicData.failureReceipt === 'object' &&
  logicData.failureReceipt !== null
    ? logicData.failureReceipt
    : undefined) as Record<string, unknown> | undefined;

  // 1. Intent & Pressure
  const intentAndPressure = [
    {
      label: 'Action Kind',
      value: intentReceipt?.action_kind != null ? String(intentReceipt.action_kind) : 'Not recorded',
    },
    {
      label: 'Action Subtype',
      value:
        intentReceipt?.action_subtype != null ? String(intentReceipt.action_subtype) : 'Not recorded',
    },
    {
      label: 'Pressure Direction',
      value:
        intentReceipt?.pressure_direction != null
          ? String(intentReceipt.pressure_direction)
          : 'Not recorded',
    },
    {
      label: 'Dramatic Tactic',
      value:
        intentReceipt?.dramatic_tactic != null
          ? String(intentReceipt.dramatic_tactic)
          : 'Not recorded',
    },
  ];

  // 2. Intent Synergy
  const intentSynergy = {
    value:
      intentReceipt?.intent_synergy != null
        ? String(intentReceipt.intent_synergy)
        : 'Not recorded',
    note: 'Intent–state coherence; not action outcome.',
  };

  // 3. Narrative Reconciliation
  const narrativeReconciliation = [
    {
      label: 'Mode',
      value:
        reconciliationReceipt?.mode != null
          ? String(reconciliationReceipt.mode)
          : 'Not recorded',
    },
    {
      label: 'Feasibility',
      value:
        reconciliationReceipt?.feasibility != null
          ? String(reconciliationReceipt.feasibility)
          : 'Not recorded',
    },
    {
      label: 'Reason Code',
      value:
        reconciliationReceipt?.reason_code != null
          ? String(reconciliationReceipt.reason_code)
          : 'Not recorded',
    },
    {
      label: 'Fictional Time Cost',
      value:
        reconciliationReceipt?.fictional_time_cost != null
          ? String(reconciliationReceipt.fictional_time_cost)
          : 'Not recorded',
    },
    {
      label: 'Authority Alignment',
      value:
        reconciliationReceipt?.authority_alignment != null
          ? String(reconciliationReceipt.authority_alignment)
          : 'Not recorded',
    },
  ];

  // 4. Canonical Consequences
  const decisions: Array<{
    domain: string;
    operation: string;
    value: string;
    outcome: string;
    reason: string;
    rationale?: string;
  }> = [];

  if (consequenceReceipt && Array.isArray(consequenceReceipt.decisions)) {
    for (const d of consequenceReceipt.decisions) {
      if (d && typeof d === 'object') {
        const mut = (d as any).mutation || {};
        decisions.push({
          domain: mut.domain != null ? String(mut.domain) : 'UNKNOWN',
          operation: mut.operation != null ? String(mut.operation) : 'UNKNOWN',
          value: mut.value != null ? String(mut.value) : '',
          outcome: (d as any).outcome != null ? String((d as any).outcome) : 'UNKNOWN',
          reason: (d as any).reason != null ? String((d as any).reason) : 'UNKNOWN',
          rationale:
            mut.rationale != null && String(mut.rationale).trim().length > 0
              ? String(mut.rationale)
              : undefined,
        });
      }
    }
  }

  const patchObj = (consequenceReceipt &&
  typeof consequenceReceipt.patch === 'object' &&
  consequenceReceipt.patch !== null
    ? consequenceReceipt.patch
    : undefined) as Record<string, unknown> | undefined;

  const inventoryAdded: string[] = Array.isArray(patchObj?.inventory_added)
    ? (patchObj!.inventory_added as unknown[]).map(String)
    : [];
  const inventoryRemoved: string[] = Array.isArray(patchObj?.inventory_removed)
    ? (patchObj!.inventory_removed as unknown[]).map(String)
    : [];
  const injuriesAdded: string[] = Array.isArray(patchObj?.injuries_added)
    ? (patchObj!.injuries_added as unknown[]).map(String)
    : [];
  const injuriesRemoved: string[] = Array.isArray(patchObj?.injuries_removed)
    ? (patchObj!.injuries_removed as unknown[]).map(String)
    : [];

  let psychologicalStatusChange: { before: string; after: string } | null = null;
  if (
    patchObj &&
    typeof patchObj.psychological_status_change === 'object' &&
    patchObj.psychological_status_change !== null
  ) {
    const psc = patchObj.psychological_status_change as Record<string, unknown>;
    if (psc.before != null && psc.after != null) {
      psychologicalStatusChange = {
        before: String(psc.before),
        after: String(psc.after),
      };
    }
  }

  const hasChanges =
    inventoryAdded.length > 0 ||
    inventoryRemoved.length > 0 ||
    injuriesAdded.length > 0 ||
    injuriesRemoved.length > 0 ||
    psychologicalStatusChange !== null;

  const canonicalConsequences = {
    hasReceipt: consequenceReceipt !== undefined,
    decisions,
    inventoryAdded,
    inventoryRemoved,
    injuriesAdded,
    injuriesRemoved,
    psychologicalStatusChange,
    hasChanges,
  };

  const stanceDecisions: Array<{
    characterId: string;
    focus: string;
    stance: string;
    outcome: string;
    reason: string;
    rationale?: string;
    before?: { focus: string; stance: string } | null;
    after?: { focus: string; stance: string } | null;
  }> = [];

  if (stanceReceipt && Array.isArray(stanceReceipt.decisions)) {
    for (const d of stanceReceipt.decisions) {
      if (typeof d === 'object' && d !== null) {
        const prop = (d as any).proposal;
        if (prop && typeof prop === 'object') {
          stanceDecisions.push({
            characterId: String(prop.character_id ?? ''),
            focus: String(prop.focus ?? ''),
            stance: String(prop.stance ?? ''),
            outcome: String((d as any).outcome ?? 'UNKNOWN'),
            reason: String((d as any).reason ?? 'UNKNOWN'),
            rationale:
              prop.rationale != null && String(prop.rationale).trim().length > 0
                ? String(prop.rationale)
                : undefined,
            before: (d as any).before ?? null,
            after: (d as any).after ?? null,
          });
        }
      }
    }
  }

  const characterStance = {
    hasReceipt: stanceReceipt !== undefined,
    decisions: stanceDecisions,
    hasChanges: stanceDecisions.some((d) => d.outcome === 'APPLIED'),
  };

  const relationshipDecisions: Array<{
    sourceCharacterId: string;
    targetCharacterId: string;
    kind: string;
    delta: number;
    outcome: string;
    reason: string;
    rationale?: string;
    before?: { source_character_id: string; target_character_id: string; kind: string; intensity: number } | null;
    after?: { source_character_id: string; target_character_id: string; kind: string; intensity: number } | null;
  }> = [];

  if (relationshipReceipt && Array.isArray(relationshipReceipt.decisions)) {
    for (const d of relationshipReceipt.decisions) {
      if (typeof d === 'object' && d !== null) {
        const prop = (d as any).proposal;
        if (prop && typeof prop === 'object') {
          relationshipDecisions.push({
            sourceCharacterId: String(prop.source_character_id ?? ''),
            targetCharacterId: String(prop.target_character_id ?? ''),
            kind: String(prop.kind ?? ''),
            delta: typeof prop.delta === 'number' ? prop.delta : 0,
            outcome: String((d as any).outcome ?? 'UNKNOWN'),
            reason: String((d as any).reason ?? 'UNKNOWN'),
            rationale:
              prop.rationale != null && String(prop.rationale).trim().length > 0
                ? String(prop.rationale)
                : undefined,
            before: (d as any).before ?? null,
            after: (d as any).after ?? null,
          });
        }
      }
    }
  }

  const characterRelationships = {
    hasReceipt: relationshipReceipt !== undefined,
    decisions: relationshipDecisions,
    hasChanges: relationshipDecisions.some((d) => d.outcome === 'APPLIED'),
  };

  const memoryDecisions: Array<{
    characterId: string;
    fact: string;
    source: string;
    certainty: string;
    outcome: string;
    reason: string;
    rationale?: string;
    entry?: { id: string; fact: string; source: string; certainty: string; acquired_turn: number } | null;
  }> = [];

  if (memoryReceipt && Array.isArray(memoryReceipt.decisions)) {
    for (const d of memoryReceipt.decisions) {
      if (typeof d === 'object' && d !== null) {
        const cand = (d as any).candidate;
        if (cand && typeof cand === 'object') {
          memoryDecisions.push({
            characterId: String(cand.character_id ?? ''),
            fact: String(cand.fact ?? ''),
            source: String(cand.source ?? ''),
            certainty: String(cand.certainty ?? ''),
            outcome: String((d as any).outcome ?? 'UNKNOWN'),
            reason: String((d as any).reason ?? 'UNKNOWN'),
            rationale:
              cand.rationale != null && String(cand.rationale).trim().length > 0
                ? String(cand.rationale)
                : undefined,
            entry: (d as any).entry ?? null,
          });
        }
      }
    }
  }

  const characterMemory = {
    hasReceipt: memoryReceipt !== undefined,
    decisions: memoryDecisions,
    hasChanges: memoryDecisions.some((d) => d.outcome === 'APPLIED'),
  };

  const worldMemoryDecisions: Array<{
    kind: string;
    scope: string;
    nodeId?: string | null;
    statement: string;
    outcome: string;
    reason: string;
    rationale?: string;
    entry?: {
      id: string;
      kind: string;
      scope: string;
      node_id: string | null;
      statement: string;
      established_turn: number;
    } | null;
  }> = [];

  if (worldMemoryReceipt && Array.isArray(worldMemoryReceipt.decisions)) {
    for (const d of worldMemoryReceipt.decisions) {
      if (typeof d === 'object' && d !== null) {
        const cand = (d as any).candidate;
        if (cand && typeof cand === 'object') {
          worldMemoryDecisions.push({
            kind: String(cand.kind ?? ''),
            scope: String(cand.scope ?? ''),
            nodeId: cand.node_id != null ? String(cand.node_id) : null,
            statement: String(cand.statement ?? ''),
            outcome: String((d as any).outcome ?? 'UNKNOWN'),
            reason: String((d as any).reason ?? 'UNKNOWN'),
            rationale:
              cand.rationale != null && String(cand.rationale).trim().length > 0
                ? String(cand.rationale)
                : undefined,
            entry: (d as any).entry ?? null,
          });
        }
      }
    }
  }

  const worldMemory = {
    hasReceipt: worldMemoryReceipt !== undefined,
    decisions: worldMemoryDecisions,
    hasChanges: worldMemoryDecisions.some((d) => d.outcome === 'APPLIED'),
  };

  // 5. Canonical State Diff
  const preSnapshot = turn?.preSnapshot as RuntimeStateSnapshot | undefined;
  const postSnapshot = turn?.postSnapshot as RuntimeStateSnapshot | undefined;
  const diffLines = buildCanonicalStateDiff(preSnapshot, postSnapshot);

  const transition = transitionReceipt
    ? [
        {
          label: 'Requested Node',
          value:
            transitionReceipt.requestedNodeId != null
              ? String(transitionReceipt.requestedNodeId)
              : 'None',
        },
        {
          label: 'Accepted',
          value:
            transitionReceipt.accepted != null
              ? String(transitionReceipt.accepted)
              : 'Not recorded',
        },
        {
          label: 'From Node',
          value:
            transitionReceipt.fromNodeId != null
              ? String(transitionReceipt.fromNodeId)
              : 'None',
        },
        {
          label: 'To Node',
          value:
            transitionReceipt.toNodeId != null
              ? String(transitionReceipt.toNodeId)
              : 'None',
        },
        {
          label: 'Reason',
          value:
            transitionReceipt.reason != null
              ? String(transitionReceipt.reason)
              : 'None',
        },
      ]
    : [{ label: 'Transition', value: 'Not recorded' }];

  // 5. Cast Presence & Interaction
  let presenceCount = 'Not recorded';
  if (
    castPresenceReceipt &&
    typeof castPresenceReceipt.state === 'object' &&
    castPresenceReceipt.state !== null &&
    !Array.isArray(castPresenceReceipt.state)
  ) {
    presenceCount = String(Object.keys(castPresenceReceipt.state).length);
  }

  const interaction = [
    {
      label: 'Outcome',
      value:
        castInteractionReceipt?.outcome != null
          ? String(castInteractionReceipt.outcome)
          : 'Not recorded',
    },
    {
      label: 'Addressed Character ID',
      value:
        castInteractionReceipt?.addressedCharacterId != null
          ? String(castInteractionReceipt.addressedCharacterId)
          : 'Not recorded',
    },
    {
      label: 'Responding Character ID',
      value:
        castInteractionReceipt?.respondingCharacterId != null
          ? String(castInteractionReceipt.respondingCharacterId)
          : 'Not recorded',
    },
  ];

  // 6. Continuity / Memory Candidates
  let continuityCount = 'Not recorded';
  if (
    castContinuityReceipt &&
    typeof castContinuityReceipt.state === 'object' &&
    castContinuityReceipt.state !== null &&
    !Array.isArray(castContinuityReceipt.state)
  ) {
    continuityCount = String(Object.keys(castContinuityReceipt.state).length);
  }

  let acceptedDeltaCount = 'Not recorded';
  const acceptedDeltas: string[] = [];
  if (castContinuityReceipt && Array.isArray(castContinuityReceipt.acceptedDeltas)) {
    acceptedDeltaCount = String(castContinuityReceipt.acceptedDeltas.length);
    for (const d of castContinuityReceipt.acceptedDeltas) {
      if (d && typeof d === 'object') {
        const charId = (d as any).character_id != null ? String((d as any).character_id) : 'unknown';
        const delta = (d as any).skepticism_delta != null ? String((d as any).skepticism_delta) : '0';
        acceptedDeltas.push(`${charId}: ${delta}`);
      }
    }
  }

  let memoryEchoCandidate = 'Not recorded';
  if (reconciliationReceipt) {
    const cand = reconciliationReceipt.memory_echo_candidate;
    if (typeof cand === 'string' && cand.trim().length > 0) {
      memoryEchoCandidate = cand;
    } else {
      memoryEchoCandidate = 'None';
    }
  }

  // 7. Schema Repairs and Validation
  const validationItems = [
    {
      label: 'Accepted',
      value:
        validation?.accepted != null ? String(validation.accepted) : 'Not recorded',
    },
    {
      label: 'Rejected Fields',
      value:
        Array.isArray(validation?.rejected_fields) && validation.rejected_fields.length > 0
          ? validation.rejected_fields.map((f) => String(f)).join(', ')
          : validation ? 'None' : 'Not recorded',
    },
    {
      label: 'Repair Notes',
      value:
        Array.isArray(validation?.repair_notes) && validation.repair_notes.length > 0
          ? validation.repair_notes.map((n) => String(n)).join('; ')
          : validation ? 'None' : 'Not recorded',
    },
  ];

  let failureItems: Array<{ label: string; value: string }> | undefined;
  if (failureReceipt) {
    failureItems = [
      {
        label: 'Failure Code',
        value: failureReceipt.code != null ? String(failureReceipt.code) : 'Not recorded',
      },
      {
        label: 'HTTP Status',
        value: failureReceipt.status != null ? String(failureReceipt.status) : 'Not recorded',
      },
      {
        label: 'Content Type',
        value: failureReceipt.contentType != null ? String(failureReceipt.contentType) : 'Not recorded',
      },
      {
        label: 'Message',
        value: failureReceipt.message != null ? String(failureReceipt.message) : 'Not recorded',
      },
    ];

    if (failureReceipt.diagnostics && typeof failureReceipt.diagnostics === 'object') {
      const diag = failureReceipt.diagnostics as {
        kind?: string;
        issues?: Array<{ path?: string; code?: string }>;
      };
      if (diag.kind) {
        failureItems.push({
          label: 'Diagnostic Kind',
          value: String(diag.kind),
        });
      }
      if (Array.isArray(diag.issues) && diag.issues.length > 0) {
        const rejectedPaths = diag.issues
          .map((i) => (i && typeof i.path === 'string' ? i.path : ''))
          .filter((p) => p.length > 0)
          .join(', ');
        if (rejectedPaths.length > 0) {
          failureItems.push({
            label: 'Rejected Paths',
            value: rejectedPaths,
          });
        }
      }
    }
  }

  const hgForensicsRecord = (
    turn?.horrorGrammarForensics || logicData.horrorGrammarForensics
  ) as HorrorGrammarForensicRecord | undefined;

  return {
    intentAndPressure,
    intentSynergy,
    narrativeReconciliation,
    canonicalConsequences,
    characterStance,
    characterRelationships,
    characterMemory,
    worldMemory,
    canonicalStateDiff: {
      diffLines,
      transition,
    },
    castPresenceAndInteraction: {
      presenceCount,
      interaction,
    },
    continuityAndMemory: {
      continuityCount,
      acceptedDeltaCount,
      acceptedDeltas,
      memoryEchoCandidate,
    },
    schemaRepairsAndValidation: {
      validation: validationItems,
      failure: failureItems,
    },
    horrorGrammarForensics: {
      hasReceipts: Boolean(
        hgForensicsRecord ||
        fictionalTimeReceipt ||
        castActivityReceipt ||
        castActivityProposalReceipt ||
        situatedPressureReceipt ||
        valueStateReceipt ||
        characterPursuitReceipt ||
        characterDevelopmentReceipt ||
        pressureThreadTransitionReceipt
      ),
      record: hgForensicsRecord,
      fictionalTime: fictionalTimeReceipt,
      castActivity: {
        eligibility: castActivityReceipt,
        proposalReceipt: castActivityProposalReceipt,
      },
      situatedPressure: situatedPressureReceipt,
      valueState: valueStateReceipt,
      characterPursuit: characterPursuitReceipt,
      characterDevelopment: characterDevelopmentReceipt,
      pressureTransitions: pressureThreadTransitionReceipt,
    },
    dramaturgyPacing: (() => {
      const dramReceipt = (
        (turn &&
        typeof turn.dramaticTurnReceipt === 'object' &&
        turn.dramaticTurnReceipt !== null
          ? turn.dramaticTurnReceipt
          : undefined) ||
        (typeof logicData.dramaticTurnReceipt === 'object' &&
        logicData.dramaticTurnReceipt !== null
          ? logicData.dramaticTurnReceipt
          : undefined)
      ) as Record<string, any> | undefined;

      return {
        hasReceipts: Boolean(dramReceipt),
        macroPhase: dramReceipt?.macroPhase,
        pacingCadence: dramReceipt?.pacingCadence,
        phaseTransition: dramReceipt?.phaseTransition,
        clockAdvances: Array.isArray(dramReceipt?.clockAdvances) ? dramReceipt.clockAdvances : [],
        composureDeltas: Array.isArray(dramReceipt?.composureDeltas) ? dramReceipt.composureDeltas : [],
        breakingPointRefusals: Array.isArray(dramReceipt?.breakingPointRefusals) ? dramReceipt.breakingPointRefusals : [],
      };
    })(),
    rawPayload: logicData,
  };
}

function renderHtmlTelemetrySections(logicData: Record<string, unknown>): string {
  const sections = parseTelemetrySections(logicData);

  let html = `<div class="logic-content">`;

  // 1. Intent & Pressure
  html += `<div class="telemetry-section">`;
  html += `<h4>Intent &amp; Pressure</h4>`;
  html += `<ul>`;
  for (const item of sections.intentAndPressure) {
    html += `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`;
  }
  html += `</ul>`;
  html += `</div>`;

  // 2. Intent Synergy
  html += `<div class="telemetry-section">`;
  html += `<h4>Intent Synergy</h4>`;
  html += `<ul>`;
  html += `<li><strong>Synergy:</strong> ${escapeHtml(sections.intentSynergy.value)}</li>`;
  html += `<li><small>${escapeHtml(sections.intentSynergy.note)}</small></li>`;
  html += `</ul>`;
  html += `</div>`;

  // 3. Narrative Reconciliation
  html += `<div class="telemetry-section">`;
  html += `<h4>Narrative Reconciliation</h4>`;
  html += `<ul>`;
  for (const item of sections.narrativeReconciliation) {
    html += `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`;
  }
  html += `</ul>`;
  html += `</div>`;

  // 4. Canonical Consequences
  html += `<div class="telemetry-section">`;
  html += `<h4>Canonical Consequences</h4>`;
  html += `<ul>`;
  if (!sections.canonicalConsequences.hasReceipt) {
    html += `<li><strong>Consequences:</strong> Not recorded</li>`;
  } else {
    for (const decision of sections.canonicalConsequences.decisions) {
      const rationaleText = decision.rationale
        ? ` — <em>${escapeHtml(decision.rationale)}</em>`
        : '';
      html += `<li><strong>Decision [${escapeHtml(decision.domain)} / ${escapeHtml(decision.operation)}]:</strong> ${escapeHtml(decision.value)} | Outcome: ${escapeHtml(decision.outcome)} (Reason: ${escapeHtml(decision.reason)})${rationaleText}</li>`;
    }
    if (sections.canonicalConsequences.inventoryAdded.length > 0) {
      html += `<li><strong>Inventory Added:</strong> ${escapeHtml(sections.canonicalConsequences.inventoryAdded.join(', '))}</li>`;
    }
    if (sections.canonicalConsequences.inventoryRemoved.length > 0) {
      html += `<li><strong>Inventory Removed:</strong> ${escapeHtml(sections.canonicalConsequences.inventoryRemoved.join(', '))}</li>`;
    }
    if (sections.canonicalConsequences.injuriesAdded.length > 0) {
      html += `<li><strong>Injuries Added:</strong> ${escapeHtml(sections.canonicalConsequences.injuriesAdded.join(', '))}</li>`;
    }
    if (sections.canonicalConsequences.injuriesRemoved.length > 0) {
      html += `<li><strong>Injuries Removed:</strong> ${escapeHtml(sections.canonicalConsequences.injuriesRemoved.join(', '))}</li>`;
    }
    if (sections.canonicalConsequences.psychologicalStatusChange) {
      html += `<li><strong>Psychological Status:</strong> ${escapeHtml(sections.canonicalConsequences.psychologicalStatusChange.before)} → ${escapeHtml(sections.canonicalConsequences.psychologicalStatusChange.after)}</li>`;
    }
    if (!sections.canonicalConsequences.hasChanges) {
      html += `<li>No canonical consequence changes</li>`;
    }
  }
  html += `</ul>`;
  html += `</div>`;

  // 5. Character Stance
  html += `<div class="telemetry-section">`;
  html += `<h4>Character Stance</h4>`;
  html += `<ul>`;
  if (!sections.characterStance.hasReceipt) {
    html += `<li><strong>Character Stance:</strong> Not recorded</li>`;
  } else {
    for (const decision of sections.characterStance.decisions) {
      const beforeStr = formatStanceState(decision.before);
      const afterStr = formatStanceState(decision.after);
      const beforeAfterText = ` | Before: ${beforeStr} → After: ${afterStr}`;
      const rationaleText = decision.rationale
        ? ` — <em>${escapeHtml(decision.rationale)}</em>`
        : '';
      html += `<li><strong>Decision [${escapeHtml(decision.characterId)}]:</strong> ${escapeHtml(decision.focus)} / ${escapeHtml(decision.stance)} | Outcome: ${escapeHtml(decision.outcome)} (Reason: ${escapeHtml(decision.reason)})${escapeHtml(beforeAfterText)}${rationaleText}</li>`;
    }
    if (sections.characterStance.decisions.length === 0 || !sections.characterStance.hasChanges) {
      html += `<li>No character stance changes</li>`;
    }
  }
  html += `</ul>`;
  html += `</div>`;

  // Character Relationships
  html += `<div class="telemetry-section">`;
  html += `<h4>Character Relationships</h4>`;
  html += `<ul>`;
  if (!sections.characterRelationships.hasReceipt) {
    html += `<li><strong>Character Relationships:</strong> Not recorded</li>`;
  } else {
    for (const decision of sections.characterRelationships.decisions) {
      const beforeStr = formatRelationshipRecordState(decision.before);
      const afterStr = formatRelationshipRecordState(decision.after);
      const beforeAfterText = ` | Before: ${beforeStr} → After: ${afterStr}`;
      const deltaStr = decision.delta > 0 ? `+${decision.delta}` : `${decision.delta}`;
      const rationaleText = decision.rationale
        ? ` — <em>${escapeHtml(decision.rationale)}</em>`
        : '';
      html += `<li><strong>Decision [${escapeHtml(decision.sourceCharacterId)} -&gt; ${escapeHtml(decision.targetCharacterId)} / ${escapeHtml(decision.kind)} (${escapeHtml(deltaStr)})]:</strong> Outcome: ${escapeHtml(decision.outcome)} (Reason: ${escapeHtml(decision.reason)})${escapeHtml(beforeAfterText)}${rationaleText}</li>`;
    }
    if (sections.characterRelationships.decisions.length === 0 || !sections.characterRelationships.hasChanges) {
      html += `<li>No character relationship changes</li>`;
    }
  }
  html += `</ul>`;
  html += `</div>`;

  // Character Memory
  html += `<div class="telemetry-section">`;
  html += `<h4>Character Memory</h4>`;
  html += `<ul>`;
  if (!sections.characterMemory.hasReceipt) {
    html += `<li><strong>Character Memory:</strong> Not recorded</li>`;
  } else {
    for (const decision of sections.characterMemory.decisions) {
      const rationaleText = decision.rationale
        ? ` — <em>${escapeHtml(decision.rationale)}</em>`
        : '';
      html += `<li><strong>Decision [${escapeHtml(decision.characterId)} / ${escapeHtml(decision.source)} / ${escapeHtml(decision.certainty)}]:</strong> "${escapeHtml(decision.fact)}" | Outcome: ${escapeHtml(decision.outcome)} (Reason: ${escapeHtml(decision.reason)})${rationaleText}</li>`;
    }
    if (sections.characterMemory.decisions.length === 0 || !sections.characterMemory.hasChanges) {
      html += `<li>No character memory changes</li>`;
    }
  }
  html += `</ul>`;
  html += `</div>`;

  // World Memory
  html += `<div class="telemetry-section">`;
  html += `<h4>World Memory</h4>`;
  html += `<ul>`;
  if (!sections.worldMemory.hasReceipt) {
    html += `<li><strong>World Memory:</strong> Not recorded</li>`;
  } else {
    for (const decision of sections.worldMemory.decisions) {
      const scopeLabel = decision.scope === 'GLOBAL' ? 'GLOBAL' : `NODE: ${decision.nodeId ?? 'UNSPECIFIED'}`;
      const entryText = decision.entry
        ? ` [ID: ${escapeHtml(decision.entry.id)} @ turn ${escapeHtml(String(decision.entry.established_turn))}]`
        : '';
      const rationaleText = decision.rationale
        ? ` — <em>${escapeHtml(decision.rationale)}</em>`
        : '';
      html += `<li><strong>Decision [${escapeHtml(decision.kind)} / ${escapeHtml(scopeLabel)}]:</strong> "${escapeHtml(decision.statement)}" | Outcome: ${escapeHtml(decision.outcome)} (Reason: ${escapeHtml(decision.reason)})${entryText}${rationaleText}</li>`;
    }
    if (sections.worldMemory.decisions.length === 0 || !sections.worldMemory.hasChanges) {
      html += `<li>No durable world memories added</li>`;
    }
  }
  html += `</ul>`;
  html += `</div>`;

  // 6. Canonical State Diff
  html += `<div class="telemetry-section">`;
  html += `<h4>Canonical State Diff</h4>`;
  html += `<ul>`;
  for (const diff of sections.canonicalStateDiff.diffLines) {
    html += `<li>${escapeHtml(diff)}</li>`;
  }
  for (const item of sections.canonicalStateDiff.transition) {
    html += `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`;
  }
  html += `</ul>`;
  html += `</div>`;

  // 6. Cast Presence & Interaction
  html += `<div class="telemetry-section">`;
  html += `<h4>Cast Presence &amp; Interaction</h4>`;
  html += `<ul>`;
  html += `<li><strong>Active Presence Count:</strong> ${escapeHtml(sections.castPresenceAndInteraction.presenceCount)}</li>`;
  for (const item of sections.castPresenceAndInteraction.interaction) {
    html += `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`;
  }
  html += `</ul>`;
  html += `</div>`;

  // 7. Continuity / Memory Candidates
  html += `<div class="telemetry-section">`;
  html += `<h4>Continuity / Memory Candidates</h4>`;
  html += `<ul>`;
  html += `<li><strong>Tracked Characters:</strong> ${escapeHtml(sections.continuityAndMemory.continuityCount)}</li>`;
  html += `<li><strong>Accepted Deltas Count:</strong> ${escapeHtml(sections.continuityAndMemory.acceptedDeltaCount)}</li>`;
  if (sections.continuityAndMemory.acceptedDeltas.length > 0) {
    for (const delta of sections.continuityAndMemory.acceptedDeltas) {
      html += `<li><strong>Delta:</strong> ${escapeHtml(delta)}</li>`;
    }
  }
  html += `<li><strong>Memory Echo Candidate:</strong> ${escapeHtml(sections.continuityAndMemory.memoryEchoCandidate)}</li>`;
  html += `</ul>`;
  html += `</div>`;

  // 8. Schema Repairs and Validation
  html += `<div class="telemetry-section">`;
  html += `<h4>Schema Repairs and Validation</h4>`;
  html += `<ul>`;
  for (const item of sections.schemaRepairsAndValidation.validation) {
    html += `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`;
  }
  if (sections.schemaRepairsAndValidation.failure) {
    for (const item of sections.schemaRepairsAndValidation.failure) {
      html += `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`;
    }
  }
  html += `</ul>`;
  html += `</div>`;

  // Horror Grammar 1 Forensics
  if (sections.horrorGrammarForensics.hasReceipts) {
    html += `<div class="telemetry-section">`;
    html += `<h4>Horror Grammar 1 Forensics</h4>`;
    html += `<ul>`;
    const hg = sections.horrorGrammarForensics;
    const rec = hg.record;
    if (rec) {
      html += `<li><strong>Turn Identity:</strong> Turn ${escapeHtml(String(rec.turnNumber))} | Fictional Time: Moment ${escapeHtml(String(rec.preFictionalTime.moment_revision))} → ${escapeHtml(String(rec.postFictionalTime?.moment_revision ?? rec.preFictionalTime.moment_revision))}</li>`;
      html += `<li><strong>Opportunities:</strong> Present: ${escapeHtml(rec.presentOpportunityIds.join(', ') || 'None')}, Offscreen: ${escapeHtml(rec.selectedOffscreenPursuitIds.join(', ') || 'None')}</li>`;

      const actDisp = rec.activityEvidence.disposition === 'REJECTED'
        ? 'REJECTED — NONCANONICAL'
        : rec.activityEvidence.disposition === 'ACCEPTED'
        ? 'ACCEPTED — ADMITTED'
        : 'NONE';
      html += `<li><strong>Cast Activity Proposal:</strong> Disposition: ${escapeHtml(actDisp)} (Reason: ${escapeHtml(rec.activityEvidence.reasonCode)})</li>`;
      if (rec.activityEvidence.manifestationBlock) {
        const label = rec.activityEvidence.disposition === 'REJECTED'
          ? 'REJECTED MANIFESTATION CONTENT (NONCANONICAL)'
          : 'ADMITTED MANIFESTATION CONTENT';
        html += `<li><strong>Activity Manifestation (${escapeHtml(label)}):</strong> <em>"${escapeHtml(rec.activityEvidence.manifestationBlock.content)}"</em></li>`;
      }

      const pressDisp = rec.pressureEvidence.disposition === 'REJECTED'
        ? 'REJECTED — NONCANONICAL'
        : rec.pressureEvidence.disposition === 'ACCEPTED'
        ? 'ACCEPTED — ADMITTED'
        : 'NONE';
      html += `<li><strong>Situated Pressure Proposal:</strong> Disposition: ${escapeHtml(pressDisp)} (Reason: ${escapeHtml(rec.pressureEvidence.reasonCode)})</li>`;
      if (rec.pressureEvidence.manifestationBlock) {
        const label = rec.pressureEvidence.disposition === 'REJECTED'
          ? 'REJECTED MANIFESTATION CONTENT (NONCANONICAL)'
          : 'ADMITTED MANIFESTATION CONTENT';
        html += `<li><strong>Pressure Manifestation (${escapeHtml(label)}):</strong> <em>"${escapeHtml(rec.pressureEvidence.manifestationBlock.content)}"</em></li>`;
      }
    } else {
      if (hg.fictionalTime) {
        const ft = hg.fictionalTime as any;
        html += `<li><strong>Fictional Time:</strong> Moment ${escapeHtml(String(ft.postState?.moment_revision ?? ft.moment_revision ?? '0'))}, Scene ${escapeHtml(String(ft.postState?.scene_beat_revision ?? ft.scene_beat_revision ?? '0'))}, Extended ${escapeHtml(String(ft.postState?.extended_revision ?? ft.extended_revision ?? '0'))} (Cost: ${escapeHtml(String(ft.costApplied ?? ft.last_cost ?? 'NONE'))})</li>`;
      }
      if (hg.castActivity?.eligibility) {
        const el = hg.castActivity.eligibility as any;
        const presCount = Array.isArray(el.presentOpportunities) ? el.presentOpportunities.length : 0;
        const offCount = Array.isArray(el.offscreenOpportunities) ? el.offscreenOpportunities.length : 0;
        html += `<li><strong>Cast Activity Opportunities:</strong> ${presCount} present, ${offCount} offscreen</li>`;
      }
      if (hg.castActivity?.proposalReceipt) {
        const ar = hg.castActivity.proposalReceipt as any;
        html += `<li><strong>Cast Activity Proposal:</strong> Outcome: ${escapeHtml(String(ar.outcome))} (Reason: ${escapeHtml(String(ar.reasonCode))}) | Admitted: ${escapeHtml(String(ar.admittedManifestation))}</li>`;
      }
      if (hg.situatedPressure) {
        const pr = hg.situatedPressure as any;
        html += `<li><strong>Situated Pressure Proposal:</strong> Outcome: ${escapeHtml(String(pr.outcome))} (Reason: ${escapeHtml(String(pr.reasonCode))}) | Admitted: ${escapeHtml(String(pr.admittedManifestation))}</li>`;
      }
    }
    if (hg.valueState && Array.isArray((hg.valueState as any).decisions)) {
      for (const d of (hg.valueState as any).decisions) {
        html += `<li><strong>Value Decision [${escapeHtml(String(d.anchorId))} / ${escapeHtml(String(d.operation))}]:</strong> Outcome: ${escapeHtml(String(d.outcome))} (Reason: ${escapeHtml(String(d.reasonCode))}, Cause: ${escapeHtml(String(d.causeReference))})</li>`;
      }
    }
    if (hg.characterPursuit && Array.isArray((hg.characterPursuit as any).decisions)) {
      for (const d of (hg.characterPursuit as any).decisions) {
        html += `<li><strong>Pursuit Decision [${escapeHtml(String(d.pursuitId))} / ${escapeHtml(String(d.operation))}]:</strong> Outcome: ${escapeHtml(String(d.outcome))} (Reason: ${escapeHtml(String(d.reasonCode))}, Cause: ${escapeHtml(String(d.causeReference))})</li>`;
      }
    }
    if (hg.characterDevelopment && Array.isArray((hg.characterDevelopment as any).decisions)) {
      for (const d of (hg.characterDevelopment as any).decisions) {
        html += `<li><strong>Character Development Decision [${escapeHtml(String(d.castMemberId))} / ${escapeHtml(String(d.operation))}]:</strong> Outcome: ${escapeHtml(String(d.outcome))} (Reason: ${escapeHtml(String(d.reasonCode))}, Cause: ${escapeHtml(String(d.causeReference))})</li>`;
      }
    }
    if (hg.pressureTransitions && Array.isArray((hg.pressureTransitions as any).decisions)) {
      for (const d of (hg.pressureTransitions as any).decisions) {
        html += `<li><strong>Pressure Transition [${escapeHtml(String(d.threadId))} -> ${escapeHtml(String(d.proposedStatus))}]:</strong> Outcome: ${escapeHtml(String(d.outcome))} (Reason: ${escapeHtml(String(d.reasonCode))}, Cause: ${escapeHtml(String(d.causeReference))})</li>`;
      }
    }
    html += `</ul>`;
    html += `</div>`;
  }

  // Dramaturgical Pacing & Causal Clocks (HG2)
  if (sections.dramaturgyPacing?.hasReceipts) {
    html += `<div class="telemetry-section">`;
    html += `<h4>Dramaturgical Pacing &amp; Causal Clocks (HG2)</h4>`;
    html += `<ul>`;
    const dp = sections.dramaturgyPacing;
    html += `<li><strong>Macro-Phase:</strong> ${escapeHtml(dp.macroPhase || 'EXPOSITION_BASELINE')} | <strong>Cadence:</strong> ${escapeHtml(dp.pacingCadence || 'SIMMERING_DREAD')}</li>`;
    if (dp.phaseTransition) {
      html += `<li><strong style="color: #f59e0b;">Phase Transition:</strong> ${escapeHtml(dp.phaseTransition.fromPhase || '')} → ${escapeHtml(dp.phaseTransition.toPhase || '')} (Gate: ${escapeHtml(dp.phaseTransition.gateMilestoneId || 'N/A')}, Trigger: ${escapeHtml(dp.phaseTransition.triggeredBy || 'CAUSAL_GATE')})</li>`;
    }
    if (dp.clockAdvances.length > 0) {
      html += `<li><strong>Impending Clock Advances:</strong>`;
      html += `<ul>`;
      for (const adv of dp.clockAdvances) {
        html += `<li>[${escapeHtml(adv.clockId)}]: Level ${escapeHtml(String(adv.newLevel))} — <em>${escapeHtml(adv.cause)}</em></li>`;
      }
      html += `</ul></li>`;
    }
    if (dp.composureDeltas.length > 0) {
      html += `<li><strong>Composure Deltas:</strong>`;
      html += `<ul>`;
      for (const cd of dp.composureDeltas) {
        const sign = cd.delta > 0 ? `+${cd.delta}` : `${cd.delta}`;
        html += `<li>${escapeHtml(cd.characterId)}: ${cd.oldComposure} → ${cd.newComposure} (${sign}) — <em>${escapeHtml(cd.cause)}</em></li>`;
      }
      html += `</ul></li>`;
    }
    if (dp.breakingPointRefusals.length > 0) {
      html += `<li><strong style="color: #ef4444;">Breaking Point Refusals (D3):</strong>`;
      html += `<ul>`;
      for (const ref of dp.breakingPointRefusals) {
        html += `<li><strong>${escapeHtml(ref.characterId)}:</strong> ${escapeHtml(ref.reason)}</li>`;
      }
      html += `</ul></li>`;
    }
    html += `</ul>`;
    html += `</div>`;
  }

  // 9. Raw Structured Payload
  html += `<details class="raw-payload-panel">`;
  html += `<summary class="speaker-label speaker-engine">Raw Structured Payload</summary>`;
  html += `<pre><code>${escapeHtml(JSON.stringify(sections.rawPayload, null, 2))}</code></pre>`;
  html += `</details>`;

  html += `</div>`;
  return html;
}

function renderMarkdownTelemetrySections(logicData: Record<string, unknown>): string {
  const sections = parseTelemetrySections(logicData);

  let md = '';

  // 1. Intent & Pressure
  md += `#### Intent & Pressure\n`;
  for (const item of sections.intentAndPressure) {
    md += `- **${item.label}:** ${item.value}\n`;
  }
  md += `\n`;

  // 2. Intent Synergy
  md += `#### Intent Synergy\n`;
  md += `- **Synergy:** ${sections.intentSynergy.value}\n`;
  md += `- *${sections.intentSynergy.note}*\n\n`;

  // 3. Narrative Reconciliation
  md += `#### Narrative Reconciliation\n`;
  for (const item of sections.narrativeReconciliation) {
    md += `- **${item.label}:** ${item.value}\n`;
  }
  md += `\n`;

  // 4. Canonical Consequences
  md += `#### Canonical Consequences\n`;
  if (!sections.canonicalConsequences.hasReceipt) {
    md += `- **Consequences:** Not recorded\n\n`;
  } else {
    for (const decision of sections.canonicalConsequences.decisions) {
      const rationaleText = decision.rationale ? ` — *${decision.rationale}*` : '';
      md += `- **Decision [${decision.domain} / ${decision.operation}]:** ${decision.value} | Outcome: ${decision.outcome} (Reason: ${decision.reason})${rationaleText}\n`;
    }
    if (sections.canonicalConsequences.inventoryAdded.length > 0) {
      md += `- **Inventory Added:** ${sections.canonicalConsequences.inventoryAdded.join(', ')}\n`;
    }
    if (sections.canonicalConsequences.inventoryRemoved.length > 0) {
      md += `- **Inventory Removed:** ${sections.canonicalConsequences.inventoryRemoved.join(', ')}\n`;
    }
    if (sections.canonicalConsequences.injuriesAdded.length > 0) {
      md += `- **Injuries Added:** ${sections.canonicalConsequences.injuriesAdded.join(', ')}\n`;
    }
    if (sections.canonicalConsequences.injuriesRemoved.length > 0) {
      md += `- **Injuries Removed:** ${sections.canonicalConsequences.injuriesRemoved.join(', ')}\n`;
    }
    if (sections.canonicalConsequences.psychologicalStatusChange) {
      md += `- **Psychological Status:** ${sections.canonicalConsequences.psychologicalStatusChange.before} → ${sections.canonicalConsequences.psychologicalStatusChange.after}\n`;
    }
    if (!sections.canonicalConsequences.hasChanges) {
      md += `- No canonical consequence changes\n`;
    }
    md += `\n`;
  }

  // 5. Character Stance
  md += `#### Character Stance\n`;
  if (!sections.characterStance.hasReceipt) {
    md += `- **Character Stance:** Not recorded\n\n`;
  } else {
    for (const decision of sections.characterStance.decisions) {
      const beforeStr = formatStanceState(decision.before);
      const afterStr = formatStanceState(decision.after);
      const beforeAfterText = ` | Before: ${beforeStr} → After: ${afterStr}`;
      const rationaleText = decision.rationale ? ` — *${decision.rationale}*` : '';
      md += `- **Decision [${decision.characterId}]:** ${decision.focus} / ${decision.stance} | Outcome: ${decision.outcome} (Reason: ${decision.reason})${beforeAfterText}${rationaleText}\n`;
    }
    if (sections.characterStance.decisions.length === 0 || !sections.characterStance.hasChanges) {
      md += `- No character stance changes\n`;
    }
    md += `\n`;
  }

  // Character Relationships
  md += `#### Character Relationships\n`;
  if (!sections.characterRelationships.hasReceipt) {
    md += `- **Character Relationships:** Not recorded\n\n`;
  } else {
    for (const decision of sections.characterRelationships.decisions) {
      const beforeStr = formatRelationshipRecordState(decision.before);
      const afterStr = formatRelationshipRecordState(decision.after);
      const beforeAfterText = ` | Before: ${beforeStr} → After: ${afterStr}`;
      const deltaStr = decision.delta > 0 ? `+${decision.delta}` : `${decision.delta}`;
      const rationaleText = decision.rationale ? ` — *${decision.rationale}*` : '';
      md += `- **Decision [${decision.sourceCharacterId} -> ${decision.targetCharacterId} / ${decision.kind} (${deltaStr})]:** Outcome: ${decision.outcome} (Reason: ${decision.reason})${beforeAfterText}${rationaleText}\n`;
    }
    if (sections.characterRelationships.decisions.length === 0 || !sections.characterRelationships.hasChanges) {
      md += `- No character relationship changes\n`;
    }
    md += `\n`;
  }

  // Character Memory
  md += `#### Character Memory\n`;
  if (!sections.characterMemory.hasReceipt) {
    md += `- **Character Memory:** Not recorded\n\n`;
  } else {
    for (const decision of sections.characterMemory.decisions) {
      const rationaleText = decision.rationale ? ` — *${decision.rationale}*` : '';
      md += `- **Decision [${decision.characterId} / ${decision.source} / ${decision.certainty}]:** "${decision.fact}" | Outcome: ${decision.outcome} (Reason: ${decision.reason})${rationaleText}\n`;
    }
    if (sections.characterMemory.decisions.length === 0 || !sections.characterMemory.hasChanges) {
      md += `- No character memory changes\n`;
    }
    md += `\n`;
  }

  // World Memory
  md += `#### World Memory\n`;
  if (!sections.worldMemory.hasReceipt) {
    md += `- **World Memory:** Not recorded\n\n`;
  } else {
    for (const decision of sections.worldMemory.decisions) {
      const scopeLabel = decision.scope === 'GLOBAL' ? 'GLOBAL' : `NODE: ${decision.nodeId ?? 'UNSPECIFIED'}`;
      const entryText = decision.entry
        ? ` [ID: ${decision.entry.id} @ turn ${decision.entry.established_turn}]`
        : '';
      const rationaleText = decision.rationale ? ` — *${decision.rationale}*` : '';
      md += `- **Decision [${decision.kind} / ${scopeLabel}]:** "${decision.statement}" | Outcome: ${decision.outcome} (Reason: ${decision.reason})${entryText}${rationaleText}\n`;
    }
    if (sections.worldMemory.decisions.length === 0 || !sections.worldMemory.hasChanges) {
      md += `- No durable world memories added\n`;
    }
    md += `\n`;
  }

  // 6. Canonical State Diff
  md += `#### Canonical State Diff\n`;
  for (const diff of sections.canonicalStateDiff.diffLines) {
    md += `- ${diff}\n`;
  }
  for (const item of sections.canonicalStateDiff.transition) {
    md += `- **${item.label}:** ${item.value}\n`;
  }
  md += `\n`;

  // 6. Cast Presence & Interaction
  md += `#### Cast Presence & Interaction\n`;
  md += `- **Active Presence Count:** ${sections.castPresenceAndInteraction.presenceCount}\n`;
  for (const item of sections.castPresenceAndInteraction.interaction) {
    md += `- **${item.label}:** ${item.value}\n`;
  }
  md += `\n`;

  // 7. Continuity / Memory Candidates
  md += `#### Continuity / Memory Candidates\n`;
  md += `- **Tracked Characters:** ${sections.continuityAndMemory.continuityCount}\n`;
  md += `- **Accepted Deltas Count:** ${sections.continuityAndMemory.acceptedDeltaCount}\n`;
  if (sections.continuityAndMemory.acceptedDeltas.length > 0) {
    for (const delta of sections.continuityAndMemory.acceptedDeltas) {
      md += `- **Delta:** ${delta}\n`;
    }
  }
  md += `- **Memory Echo Candidate:** ${sections.continuityAndMemory.memoryEchoCandidate}\n\n`;

  // 8. Schema Repairs and Validation
  md += `#### Schema Repairs and Validation\n`;
  for (const item of sections.schemaRepairsAndValidation.validation) {
    md += `- **${item.label}:** ${item.value}\n`;
  }
  if (sections.schemaRepairsAndValidation.failure) {
    for (const item of sections.schemaRepairsAndValidation.failure) {
      md += `- **${item.label}:** ${item.value}\n`;
    }
  }
  md += `\n`;

  // Horror Grammar 1 Forensics
  if (sections.horrorGrammarForensics.hasReceipts) {
    md += `#### Horror Grammar 1 Forensics\n`;
    const hg = sections.horrorGrammarForensics;
    const rec = hg.record;
    if (rec) {
      md += `- **Turn Identity:** Turn ${rec.turnNumber} | Fictional Time: Moment ${rec.preFictionalTime.moment_revision} → ${rec.postFictionalTime?.moment_revision ?? rec.preFictionalTime.moment_revision}\n`;
      md += `- **Opportunities:** Present: ${rec.presentOpportunityIds.join(', ') || 'None'}, Offscreen: ${rec.selectedOffscreenPursuitIds.join(', ') || 'None'}\n`;

      const actDisp = rec.activityEvidence.disposition === 'REJECTED'
        ? 'REJECTED — NONCANONICAL'
        : rec.activityEvidence.disposition === 'ACCEPTED'
        ? 'ACCEPTED — ADMITTED'
        : 'NONE';
      md += `- **Cast Activity Proposal:** Disposition: ${actDisp} (Reason: ${rec.activityEvidence.reasonCode})\n`;
      if (rec.activityEvidence.manifestationBlock) {
        const label = rec.activityEvidence.disposition === 'REJECTED'
          ? 'REJECTED MANIFESTATION CONTENT (NONCANONICAL)'
          : 'ADMITTED MANIFESTATION CONTENT';
        md += `> **[${label}]:** "${rec.activityEvidence.manifestationBlock.content}"\n`;
      }

      const pressDisp = rec.pressureEvidence.disposition === 'REJECTED'
        ? 'REJECTED — NONCANONICAL'
        : rec.pressureEvidence.disposition === 'ACCEPTED'
        ? 'ACCEPTED — ADMITTED'
        : 'NONE';
      md += `- **Situated Pressure Proposal:** Disposition: ${pressDisp} (Reason: ${rec.pressureEvidence.reasonCode})\n`;
      if (rec.pressureEvidence.manifestationBlock) {
        const label = rec.pressureEvidence.disposition === 'REJECTED'
          ? 'REJECTED MANIFESTATION CONTENT (NONCANONICAL)'
          : 'ADMITTED MANIFESTATION CONTENT';
        md += `> **[${label}]:** "${rec.pressureEvidence.manifestationBlock.content}"\n`;
      }
    } else {
      if (hg.fictionalTime) {
        const ft = hg.fictionalTime as any;
        md += `- **Fictional Time:** Moment ${ft.postState?.moment_revision ?? ft.moment_revision ?? '0'}, Scene ${ft.postState?.scene_beat_revision ?? ft.scene_beat_revision ?? '0'}, Extended ${ft.postState?.extended_revision ?? ft.extended_revision ?? '0'} (Cost: ${ft.costApplied ?? ft.last_cost ?? 'NONE'})\n`;
      }
      if (hg.castActivity?.eligibility) {
        const el = hg.castActivity.eligibility as any;
        const presCount = Array.isArray(el.presentOpportunities) ? el.presentOpportunities.length : 0;
        const offCount = Array.isArray(el.offscreenOpportunities) ? el.offscreenOpportunities.length : 0;
        md += `- **Cast Activity Opportunities:** ${presCount} present, ${offCount} offscreen\n`;
      }
      if (hg.castActivity?.proposalReceipt) {
        const ar = hg.castActivity.proposalReceipt as any;
        md += `- **Cast Activity Proposal:** Outcome: ${ar.outcome} (Reason: ${ar.reasonCode}) | Admitted: ${ar.admittedManifestation}\n`;
      }
      if (hg.situatedPressure) {
        const pr = hg.situatedPressure as any;
        md += `- **Situated Pressure Proposal:** Outcome: ${pr.outcome} (Reason: ${pr.reasonCode}) | Admitted: ${pr.admittedManifestation}\n`;
      }
    }
    if (hg.valueState && Array.isArray((hg.valueState as any).decisions)) {
      for (const d of (hg.valueState as any).decisions) {
        md += `- **Value Decision [${d.anchorId} / ${d.operation}]:** Outcome: ${d.outcome} (Reason: ${d.reasonCode}, Cause: ${d.causeReference})\n`;
      }
    }
    if (hg.characterPursuit && Array.isArray((hg.characterPursuit as any).decisions)) {
      for (const d of (hg.characterPursuit as any).decisions) {
        md += `- **Pursuit Decision [${d.pursuitId} / ${d.operation}]:** Outcome: ${d.outcome} (Reason: ${d.reasonCode}, Cause: ${d.causeReference})\n`;
      }
    }
    if (hg.characterDevelopment && Array.isArray((hg.characterDevelopment as any).decisions)) {
      for (const d of (hg.characterDevelopment as any).decisions) {
        md += `- **Character Development Decision [${d.castMemberId} / ${d.operation}]:** Outcome: ${d.outcome} (Reason: ${d.reasonCode}, Cause: ${d.causeReference})\n`;
      }
    }
    if (hg.pressureTransitions && Array.isArray((hg.pressureTransitions as any).decisions)) {
      for (const d of (hg.pressureTransitions as any).decisions) {
        md += `- **Pressure Transition [${d.threadId} -> ${d.proposedStatus}]:** Outcome: ${d.outcome} (Reason: ${d.reasonCode}, Cause: ${d.causeReference})\n`;
      }
    }
    md += `\n`;
  }

  // Dramaturgical Pacing & Causal Clocks (HG2)
  if (sections.dramaturgyPacing?.hasReceipts) {
    md += `#### Dramaturgical Pacing & Causal Clocks (HG2)\n`;
    const dp = sections.dramaturgyPacing;
    md += `- **Macro-Phase:** ${dp.macroPhase || 'EXPOSITION_BASELINE'} | **Cadence:** ${dp.pacingCadence || 'SIMMERING_DREAD'}\n`;
    if (dp.phaseTransition) {
      md += `- **Phase Transition:** ${dp.phaseTransition.fromPhase || ''} → ${dp.phaseTransition.toPhase || ''} (Gate: ${dp.phaseTransition.gateMilestoneId || 'N/A'}, Trigger: ${dp.phaseTransition.triggeredBy || 'CAUSAL_GATE'})\n`;
    }
    if (dp.clockAdvances.length > 0) {
      md += `- **Impending Clock Advances:**\n`;
      for (const adv of dp.clockAdvances) {
        md += `  - [${adv.clockId}]: Level ${adv.newLevel} — *${adv.cause}*\n`;
      }
    }
    if (dp.composureDeltas.length > 0) {
      md += `- **Composure Deltas:**\n`;
      for (const cd of dp.composureDeltas) {
        const sign = cd.delta > 0 ? `+${cd.delta}` : `${cd.delta}`;
        md += `  - ${cd.characterId}: ${cd.oldComposure} → ${cd.newComposure} (${sign}) — *${cd.cause}*\n`;
      }
    }
    if (dp.breakingPointRefusals.length > 0) {
      md += `- **Breaking Point Refusals (D3):**\n`;
      for (const ref of dp.breakingPointRefusals) {
        md += `  - **${ref.characterId}:** ${ref.reason}\n`;
      }
    }
    md += `\n`;
  }

  // 8. Raw Structured Payload
  md += `#### Raw Structured Payload\n`;
  md += `\`\`\`json\n${JSON.stringify(sections.rawPayload, null, 2)}\n\`\`\`\n\n`;

  return md;
}

export const buildEngineLogContent = (
  messages: any[],
  format: 'md' | 'html',
  title: string = 'engine-telemetry',
  blueprint?: any,
  capturedAt: Date = new Date()
) => {
  if (!messages || messages.length === 0) {
    return null;
  }

  const timestamp = capturedAt.toISOString();
  let content = '';
  let mimeType = '';
  let extension = '';

  // 1. Resolve Context Receipt (either recorded in messages or synthesized from blueprint)
  let receipt: ContextReceipt | null = null;
  const recordedReceiptMsg = messages.find((m) => m && m.contextReceipt);
  if (recordedReceiptMsg?.contextReceipt) {
    receipt = recordedReceiptMsg.contextReceipt;
  } else if (blueprint && typeof blueprint === 'object') {
    try {
      const turnContext = buildEngineTurnContext({ blueprint });
      receipt = buildContextReceipt(turnContext, blueprint);
    } catch {
      receipt = null;
    }
  }

  // 2. Helper to resolve user perspective label
  const resolveUserLabel = (msg: any): string => {
    if (msg.userCharacterName) return msg.userCharacterName;
    if (receipt?.resolvedPlayerName) return receipt.resolvedPlayerName;
    if (receipt?.selectedRole) return String(receipt.selectedRole).toUpperCase();
    if (blueprint?.cast && Array.isArray(blueprint.cast)) {
      const userChar = blueprint.cast.find((c: any) => c.isUserCharacter);
      if (userChar?.name) return userChar.name;
    }
    return 'Protagonist';
  };

  if (format === 'html') {
    mimeType = 'text/html;charset=utf-8;';
    extension = 'html';
    content = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>The Terror Machine // Telemetry Stream - ${escapeHtml(title)}</title>
        <style>
          body { 
            background-color: #000000; 
            color: #d1d5db; 
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; 
            padding: 3rem 2rem; 
            max-width: 900px; 
            margin: 0 auto; 
            line-height: 1.7; 
          }
          .meta-header {
            color: #52525b;
            font-size: 0.75rem;
            letter-spacing: 0.1em;
            border-bottom: 1px solid #18181b;
            padding-bottom: 1.5rem;
            margin-bottom: 2rem;
            text-transform: uppercase;
          }
          .context-receipt {
            background-color: #09090b;
            border: 1px solid #27272a;
            border-radius: 4px;
            padding: 1.25rem;
            margin-bottom: 2.5rem;
            font-size: 0.8rem;
          }
          .receipt-header {
            color: #a1a1aa;
            font-weight: bold;
            margin-bottom: 0.75rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .receipt-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 0.5rem;
            color: #d4d4d8;
          }
          .receipt-item { line-height: 1.5; }
          .receipt-key { color: #71717a; text-transform: uppercase; font-size: 0.75rem; margin-right: 0.25rem; }
          .receipt-val { font-weight: 600; color: #f4f4f5; }
          .receipt-sub { color: #71717a; font-size: 0.75rem; }
          .turn {
            margin-bottom: 3.5rem;
            padding-bottom: 1.5rem;
          }
          .user-input {
            color: #71717a;
            font-size: 0.95rem;
            font-style: italic;
            margin-bottom: 1.5rem;
            padding-left: 1rem;
            border-left: 2px solid #27272a;
          }
          .block-prose {
            margin-bottom: 1.25rem;
            color: #e4e4e7;
          }
          .block-dialogue { 
            color: #a1a1aa; 
            font-style: italic; 
            margin-bottom: 1.25rem; 
            padding-left: 1.25rem; 
            border-left: 2px solid #3f3f46; 
          }
          .block-system_voice { 
            color: #ef4444; 
            font-weight: 700; 
            text-transform: uppercase; 
            margin-bottom: 1.25rem; 
            letter-spacing: 0.05em; 
          }
          .logic-panel { 
            background-color: #09090b; 
            border: 1px dashed #27272a; 
            margin-top: 1.5rem; 
            border-radius: 4px;
            font-size: 0.8rem;
          }
          summary {
            padding: 0.75rem 1rem;
            color: #52525b;
            cursor: pointer;
            user-select: none;
            font-weight: bold;
            outline: none;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          summary:hover {
            color: #a1a1aa;
            background-color: #121214;
          }
          .logic-content {
            padding: 1rem;
            border-top: 1px dashed #27272a;
            color: #e4e4e7;
            background-color: #09090b;
          }
          .telemetry-section {
            margin-bottom: 1.25rem;
            padding-bottom: 0.75rem;
            border-bottom: 1px solid #18181b;
          }
          .telemetry-section h4 {
            color: #22c55e;
            font-size: 0.85rem;
            letter-spacing: 0.05em;
            margin: 0 0 0.5rem 0;
            text-transform: uppercase;
          }
          .telemetry-section ul {
            margin: 0;
            padding-left: 1.25rem;
            list-style-type: square;
          }
          .telemetry-section li {
            margin-bottom: 0.25rem;
            line-height: 1.5;
            color: #d1d5db;
          }
          .telemetry-section strong {
            color: #a1a1aa;
          }
          .raw-payload-panel {
            margin-top: 1rem;
            border: 1px solid #27272a;
            border-radius: 4px;
            background-color: #020617;
          }
          .raw-payload-panel pre {
            margin: 0;
            padding: 1rem;
            color: #22c55e;
            overflow-x: auto;
            white-space: pre-wrap;
          }
          .speaker-label { font-size: 0.75rem; font-weight: bold; margin-bottom: 0.25rem; font-family: sans-serif; letter-spacing: 0.05em; text-transform: uppercase; }
          .speaker-user { color: #60a5fa; } /* Blue */
          .speaker-character { color: #a78bfa; } /* Purple */
          .speaker-voice { color: #f87171; } /* Red */
          .speaker-engine { color: #4ade80; } /* Green */
        </style>
      </head>
      <body>
        <div class="meta-header">
          THE TERROR MACHINE // RUNTIME CORE TELEMETRY METRICS<br>
          TRACE CAPTURE ID: ${capturedAt.getTime()}<br>
          TIMESTAMP: ${timestamp}
        </div>

        ${
          receipt
            ? `
        <div class="context-receipt">
          <div class="receipt-header">[ CONTEXT RECEIPT // SCENARIO BINDING v${receipt.version} ]</div>
          <div class="receipt-grid">
            <div class="receipt-item"><span class="receipt-key">SCENARIO:</span> <span class="receipt-val">${escapeHtml(receipt.scenarioTitle)}</span> ${receipt.blueprintId ? `<span class="receipt-sub">(${escapeHtml(receipt.blueprintId)})</span>` : ''}</div>
            <div class="receipt-item"><span class="receipt-key">ROLE:</span> <span class="receipt-val">${escapeHtml(String(receipt.selectedRole).toUpperCase())}</span> | <span class="receipt-key">BOUND PLAYER:</span> <span class="receipt-val">${escapeHtml(receipt.resolvedPlayerName)}</span> ${receipt.resolvedPlayerId ? `<span class="receipt-sub">(ID: ${escapeHtml(receipt.resolvedPlayerId)})</span>` : ''}</div>
            <div class="receipt-item"><span class="receipt-key">ORIGIN NODE:</span> <span class="receipt-val">${escapeHtml(receipt.readableNodeLabel)}</span> <span class="receipt-sub">(${escapeHtml(receipt.currentNodeId)})</span></div>
            <div class="receipt-item"><span class="receipt-key">COORDINATE:</span> <span class="receipt-val">[${escapeHtml(receipt.activeVector)}, ${escapeHtml(receipt.activeTier)}]</span></div>
            <div class="receipt-item"><span class="receipt-key">ROSTER &amp; RULES:</span> <span class="receipt-val">${receipt.castCount} Cast Members | ${receipt.worldRuleCount} World Rules</span></div>
            <div class="receipt-item"><span class="receipt-key">TOPOLOGY:</span> <span class="receipt-val">${receipt.topologyNodeCount} Nodes | ${receipt.topologyConnectionCount} Connections</span></div>
          </div>
        </div>
        `
            : ''
        }
    `;

    messages.forEach((msg) => {
      content += `<div class="turn">`;
      if (msg.role === 'user') {
        const userCharName = resolveUserLabel(msg);
        content += `<div class="speaker-label speaker-user">[ USER: ${escapeHtml(userCharName)} ]</div>`;
        content += `<div class="user-input">&gt; ${escapeHtml(msg.content)}</div>`;
      } else {
        // Parse Engine Array Content
        const renderBlock = (block: any) => {
          if (block.type === 'engine_thoughts') return;
          if (block.type === 'system_voice') {
            content += `<div class="speaker-label speaker-voice">[ THE VOICE ]</div>`;
          } else if (block.type === 'dialogue' && block.speaker) {
            content += `<div class="speaker-label speaker-character">[ CHARACTER: ${escapeHtml(block.speaker)} ]</div>`;
          } else if (block.type === 'internal_monologue' && block.speaker) {
            content += `<div class="speaker-label speaker-character">[ THOUGHT: ${escapeHtml(block.speaker)} ]</div>`;
          }
          content += `<div class="block-${block.type || 'prose'}">${escapeHtml(block.content)}</div>`;
        };

        if (Array.isArray(msg.content)) {
          msg.content.forEach(renderBlock);
        } else if (msg.blocks && Array.isArray(msg.blocks)) {
          msg.blocks.forEach(renderBlock);
        } else {
          content += `<div class="block-prose">${escapeHtml(msg.content)}</div>`;
        }

        // Keep the structured Engine decision record between narrative turns.
        const logicData = getEngineLogicData(msg);
        if (logicData) {
          const summary = getEngineLogicSummary(logicData);
          const readableSections = renderHtmlTelemetrySections(logicData);

          content += `
            <details class="logic-panel">
              <summary class="speaker-label speaker-engine">${escapeHtml(summary)}</summary>
              ${readableSections}
            </details>
          `;
        }
      }
      content += `</div>`;
    });
    content += `</body></html>`;
  } else {
    // Markdown Standard Flow
    mimeType = 'text/markdown;charset=utf-8;';
    extension = 'md';
    content = `# THE TERROR MACHINE // METRIC LOG\n*Captured: ${timestamp}*\n\n---\n\n`;

    if (receipt) {
      content +=
        `### [ CONTEXT RECEIPT // SCENARIO BINDING v${receipt.version} ]\n` +
        `- **Scenario:** ${receipt.scenarioTitle} ${receipt.blueprintId ? `(${receipt.blueprintId})` : ''}\n` +
        `- **Player Role:** ${String(receipt.selectedRole).toUpperCase()} | **Bound Player:** ${receipt.resolvedPlayerName} ${receipt.resolvedPlayerId ? `(ID: ${receipt.resolvedPlayerId})` : ''}\n` +
        `- **Origin Node:** ${receipt.readableNodeLabel} (\`${receipt.currentNodeId}\`)\n` +
        `- **Coordinate:** [${receipt.activeVector}, ${receipt.activeTier}]\n` +
        `- **Authoring:** ${receipt.castCount} Cast Members | ${receipt.worldRuleCount} World Rules\n` +
        `- **Topology:** ${receipt.topologyNodeCount} Nodes | ${receipt.topologyConnectionCount} Connections\n\n` +
        `---\n\n`;
    }

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        const userCharName = resolveUserLabel(msg);
        content += `**[ USER: ${userCharName} ]**\n> ${msg.content}\n\n`;
      } else {
        const blocks = Array.isArray(msg.content) ? msg.content : msg.blocks || [];
        if (blocks.length > 0) {
          blocks.forEach((block: any) => {
            if (block.type === 'engine_thoughts') return;
            if (block.type === 'system_voice') content += `**[ THE VOICE ]**\n${block.content}\n\n`;
            else if (block.type === 'dialogue' && block.speaker)
              content += `**[ CHARACTER: ${block.speaker} ]**\n${block.content}\n\n`;
            else if (block.type === 'internal_monologue' && block.speaker)
              content += `**[ THOUGHT: ${block.speaker} ]**\n${block.content}\n\n`;
            else content += `${block.content}\n\n`;
          });
        } else {
          content += `${msg.content}\n\n`;
        }

        const logicData = getEngineLogicData(msg);
        if (logicData) {
          content += renderMarkdownTelemetrySections(logicData);
        }
      }
      content += `---\n\n`;
    });
  }

  return { content, mimeType, extension };
};

export function generateTelemetryFilename(
  scenarioTitle?: string,
  roleOrSeat?: string,
  date: Date = new Date(),
  format: 'html' | 'md' = 'html'
): string {
  const cleanSlug = (str?: string): string => {
    if (!str || typeof str !== 'string') return '';
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const titleSlug = cleanSlug(scenarioTitle) || 'scenario';
  const roleSlug = cleanSlug(roleOrSeat) || 'session';
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD

  return `${titleSlug}_${roleSlug}_${dateStr}.${format}`;
}

export const exportEngineLog = (
  messages: any[],
  format: 'md' | 'html',
  title: string = 'engine-telemetry',
  blueprint?: any
) => {
  const capturedAt = new Date();
  const output = buildEngineLogContent(messages, format, title, blueprint, capturedAt);
  if (!output) {
    console.warn('// ENGINE EXPORT FAILED // Empty array state passed.');
    return;
  }

  const recordedReceipt = messages.find((m) => m?.contextReceipt)?.contextReceipt;
  const scenarioTitle =
    blueprint?.identity?.title ||
    blueprint?.title ||
    blueprint?.setting?.location ||
    recordedReceipt?.scenarioTitle ||
    (title !== 'engine-telemetry' ? title : 'scenario');

  let seatOrRole = 'session';
  if (recordedReceipt?.selectedRole) {
    seatOrRole = recordedReceipt.resolvedPlayerName
      ? `${recordedReceipt.selectedRole}-${recordedReceipt.resolvedPlayerName}`
      : recordedReceipt.selectedRole;
  } else if (blueprint?.hauntedHouse?.recommendedParticipationMode) {
    const rec = blueprint.hauntedHouse.recommendedParticipationMode;
    const seatName = blueprint.hauntedHouse?.participationContext?.seat?.name;
    seatOrRole = seatName ? `${rec}-${seatName}` : rec;
  }

  const filename = generateTelemetryFilename(scenarioTitle, seatOrRole, capturedAt, format);

  const { content, mimeType } = output;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');
  downloadLink.href = url;
  downloadLink.setAttribute('download', filename);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
};

/**
 * Builds pure literary Markdown of the scenario session, completely stripped
 * of raw JSON receipts, engine thoughts, and telemetry hashes.
 */
export const buildChronicleProseContent = (
  messages: any[],
  blueprint?: any,
  capturedAt: Date = new Date()
): { content: string; mimeType: string; filename: string } | null => {
  if (!messages || messages.length === 0) {
    return null;
  }

  const recordedReceipt = messages.find((m) => m?.contextReceipt)?.contextReceipt;
  const scenarioTitle =
    blueprint?.identity?.title ||
    blueprint?.title ||
    blueprint?.setting?.location ||
    recordedReceipt?.scenarioTitle ||
    'The Terror Machine';

  const setting =
    blueprint?.setting?.location ||
    blueprint?.thematicPremise ||
    blueprint?.identity?.subtitle ||
    '';

  const dateFormatted = capturedAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let content = `# ${scenarioTitle}\n`;
  if (setting) {
    content += `*${setting}*\n`;
  }
  content += `\n*Chronicle inscribed: ${dateFormatted}*\n\n---\n\n`;

  const resolveUserLabel = (msg: any): string => {
    if (msg.userCharacterName) return msg.userCharacterName;
    if (recordedReceipt?.resolvedPlayerName) return recordedReceipt.resolvedPlayerName;
    if (recordedReceipt?.selectedRole) return String(recordedReceipt.selectedRole).toUpperCase();
    if (blueprint?.cast && Array.isArray(blueprint.cast)) {
      const userChar = blueprint.cast.find((c: any) => c.isUserCharacter);
      if (userChar?.name) return userChar.name;
    }
    return 'Protagonist';
  };

  messages.forEach((msg) => {
    if (msg.role === 'user') {
      const userCharName = resolveUserLabel(msg);
      const cleanInput = typeof msg.content === 'string'
        ? msg.content.replace(/^\[USER_ACTION:\s*([^\]]+)\]/i, '$1').trim()
        : String(msg.content || '').trim();
      if (cleanInput) {
        content += `> **${userCharName}** — *${cleanInput}*\n\n`;
      }
    } else {
      const blocks = Array.isArray(msg.content) ? msg.content : msg.blocks || [];
      if (blocks.length > 0) {
        blocks.forEach((block: any) => {
          if (block.type === 'engine_thoughts') return;
          if (block.type === 'dialogue' && block.speaker) {
            const cleanSpoken = String(block.content || '').replace(/^["“”']|["“”']$/g, '');
            content += `**${block.speaker}**:\n"${cleanSpoken}"\n\n`;
          } else if (block.type === 'internal_monologue' && block.speaker) {
            content += `*${block.speaker} considers:*\n*${block.content}*\n\n`;
          } else if (block.type === 'soliloquy' && block.speaker) {
            const cleanSpoken = String(block.content || '').replace(/^["“”']|["“”']$/g, '');
            content += `*${block.speaker} mutters softly:*\n"${cleanSpoken}"\n\n`;
          } else if (block.type === 'system_voice') {
            content += `> *${block.content}*\n\n`;
          } else if (block.type === 'transmission' && block.speaker) {
            content += `**[ TRANSMISSION // ${block.speaker} ]**\n> "${block.content}"\n\n`;
          } else {
            content += `${block.content}\n\n`;
          }
        });
      } else if (typeof msg.content === 'string' && msg.content.trim()) {
        content += `${msg.content}\n\n`;
      }
    }
  });

  const cleanSlug = (str?: string): string => {
    if (!str || typeof str !== 'string') return '';
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const titleSlug = cleanSlug(scenarioTitle) || 'scenario';
  const timestampStr = capturedAt.toISOString().slice(0, 10);
  const filename = `${titleSlug}_chronicle_${timestampStr}.md`;

  return {
    content,
    mimeType: 'text/markdown;charset=utf-8;',
    filename,
  };
};

export const exportChronicleProse = (
  messages: any[],
  blueprint?: any
) => {
  const capturedAt = new Date();
  const output = buildChronicleProseContent(messages, blueprint, capturedAt);
  if (!output) {
    console.warn('// CHRONICLE EXPORT FAILED // Empty array state passed.');
    return;
  }

  const { content, mimeType, filename } = output;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');
  downloadLink.href = url;
  downloadLink.setAttribute('download', filename);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
};
