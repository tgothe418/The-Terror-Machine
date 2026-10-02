import {
  PERCEPTION_PATHS,
  PRESSURE_OPERATORS,
  AFFECTED_DIMENSIONS,
  PERSISTENCE_TARGETS,
} from '../../src/types/horrorGrammar';

export interface CastNormalizationContext {
  scenarioCastIds?: string[];
  activeCastIds?: string[];
}

export const GEMINI_TURN_NULL_SENTINEL = '__TTM_NULL__' as const;

type JsonRecord = Record<string, unknown>;

const CANONICAL_PERCEPTION_PATHS = new Set<string>(PERCEPTION_PATHS);
const CANONICAL_PRESSURE_OPERATORS = new Set<string>(PRESSURE_OPERATORS);
const CANONICAL_AFFECTED_DIMENSIONS = new Set<string>(AFFECTED_DIMENSIONS);
const CANONICAL_PERSISTENCE_TARGETS = new Set<string>(PERSISTENCE_TARGETS);

export function normalizePerceptionPath(raw: string): string {
  const val = raw.trim().toUpperCase();
  if (CANONICAL_PERCEPTION_PATHS.has(val)) {
    return val;
  }
  if (
    val.includes('MEDIAT') ||
    val.includes('RADIO') ||
    val.includes('INTERCOM') ||
    val.includes('TRANSMISSION') ||
    val.includes('SPEAKER') ||
    val.includes('SCREEN') ||
    val.includes('BROADCAST')
  ) {
    return 'MEDIATED';
  }
  if (
    val.includes('TRACE') ||
    val.includes('RESIDUE') ||
    val.includes('FOOTPRINT') ||
    val.includes('EVIDENCE') ||
    val.includes('SCENT') ||
    val.includes('TRACK') ||
    val.includes('REMNANT')
  ) {
    return 'LOCAL_TRACE';
  }
  if (
    val.includes('UNOBSERVE') ||
    val.includes('UNSEEN') ||
    val.includes('HIDDEN') ||
    val.includes('OFFSCREEN') ||
    val.includes('AWAY') ||
    val.includes('NONE') ||
    val.includes('REMOTE')
  ) {
    return 'UNOBSERVED';
  }
  return 'DIRECT';
}

export function normalizePressureOperator(raw: string): string {
  const val = raw.trim().toUpperCase();
  if (CANONICAL_PRESSURE_OPERATORS.has(val)) return val;
  return 'OTHER';
}

export function normalizeAffectedDimension(raw: string): string {
  const val = raw.trim().toUpperCase();
  if (CANONICAL_AFFECTED_DIMENSIONS.has(val)) return val;
  return 'OTHER';
}

export function normalizePersistenceTarget(raw: string): string {
  const val = raw.trim().toUpperCase();
  if (CANONICAL_PERSISTENCE_TARGETS.has(val)) return val;
  if (val.includes('CONDITION')) return 'CANONICAL_CONDITION';
  if (val.includes('WORLD') || val.includes('MEMORY')) return 'WORLD_MEMORY';
  if (val.includes('SCENARIO') || val.includes('STATE')) return 'SCENARIO_STATE';
  return 'PRESSURE_THREAD';
}

const NEUTRAL_PROPOSAL_FIELDS = new Set(['kind', 'reason']);

const CAST_ACTIVITY_PROPOSAL_ACTIVE_FIELDS = new Set([
  'kind',
  'proposalId',
  'castMemberId',
  'pursuitId',
  'locationNodeId',
  'perceptionPath',
  'activitySummary',
  'authorityReferences',
  'manifestationBlock',
]);

const SITUATED_PRESSURE_PROPOSAL_ACTIVE_FIELDS = new Set([
  'kind',
  'proposalId',
  'valueAnchorId',
  'sourceReference',
  'operator',
  'affectedDimension',
  'adverseProspect',
  'authorityReferences',
  'persistenceTarget',
  'responseWindowOpen',
  'manifestationBlock',
]);

const MANIFESTATION_PROSE_FIELDS = new Set(['type', 'content']);
const MANIFESTATION_DIALOGUE_FIELDS = new Set(['type', 'speaker', 'content']);

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSentinelField(record: JsonRecord, field: string): JsonRecord {
  const value = record[field];
  if (
    value === GEMINI_TURN_NULL_SENTINEL ||
    (typeof value === 'string' && value.trim().length === 0) ||
    (typeof value === 'string' && /^(null|none|nil|n\/a)$/i.test(value.trim()))
  ) {
    return {
      ...record,
      [field]: null,
    };
  }

  return record;
}

function normalizeMissingNullableField(record: JsonRecord, field: string): JsonRecord {
  if (Object.prototype.hasOwnProperty.call(record, field)) {
    return normalizeSentinelField(record, field);
  }

  return {
    ...record,
    [field]: null,
  };
}

function projectProviderUnionBranch(
  record: JsonRecord,
  activeKind: string,
  activeFields: ReadonlySet<string>
): JsonRecord {
  const fields = record.kind === 'NONE'
    ? NEUTRAL_PROPOSAL_FIELDS
    : record.kind === activeKind
      ? activeFields
      : null;

  if (!fields) {
    return record;
  }

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => fields.has(key))
  );
}

function normalizeManifestationBlock(value: unknown): unknown {
  if (!isJsonRecord(value)) {
    return value;
  }

  const fields = value.type === 'prose'
    ? MANIFESTATION_PROSE_FIELDS
    : value.type === 'dialogue'
      ? MANIFESTATION_DIALOGUE_FIELDS
      : null;

  if (!fields) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => fields.has(key))
  );
}

function normalizeActiveManifestationBlock(record: JsonRecord): JsonRecord {
  if (!Object.prototype.hasOwnProperty.call(record, 'manifestationBlock')) {
    return record;
  }

  return {
    ...record,
    manifestationBlock: normalizeManifestationBlock(record.manifestationBlock),
  };
}

/**
 * Gemini's provider schema flattens each active/neutral discriminated union
 * into one object because the supported schema subset cannot express the
 * exact branch relationship. Project a recognized branch to its canonical
 * vocabulary before Zod validation so provider-only and opposite-branch keys
 * cannot invalidate an otherwise complete proposal. Missing fields, invalid
 * values, and unknown discriminants remain untouched and still fail closed at
 * the authoritative Zod boundary.
 */
export function normalizeCastActivityProposal(
  record: JsonRecord,
  context?: CastNormalizationContext
): JsonRecord {
  if (record.kind !== 'ACTIVITY') {
    return projectProviderUnionBranch(
      record,
      'ACTIVITY',
      CAST_ACTIVITY_PROPOSAL_ACTIVE_FIELDS
    );
  }

  const normalized: JsonRecord = { ...record };
  if (normalized.proposal_id && !normalized.proposalId) {
    normalized.proposalId = normalized.proposal_id;
  }
  if (!normalized.castMemberId) {
    normalized.castMemberId =
      normalized.cast_member_id ||
      normalized.characterId ||
      normalized.character_id ||
      normalized.castId ||
      normalized.cast_id ||
      (typeof normalized.cast_member === 'string' ? normalized.cast_member : undefined) ||
      (typeof normalized.character === 'string' ? normalized.character : undefined);
  }
  if (normalized.pursuit_id && !normalized.pursuitId) {
    normalized.pursuitId = normalized.pursuit_id;
  }
  if (normalized.location_node_id && !normalized.locationNodeId) {
    normalized.locationNodeId = normalized.location_node_id;
  }
  if (normalized.perception_path && !normalized.perceptionPath) {
    normalized.perceptionPath = normalized.perception_path;
  }
  if (normalized.activity_summary && !normalized.activitySummary) {
    normalized.activitySummary = normalized.activity_summary;
  }
  if (normalized.authority_references && !normalized.authorityReferences) {
    normalized.authorityReferences = normalized.authority_references;
  }
  if (normalized.manifestation_block && !normalized.manifestationBlock) {
    normalized.manifestationBlock = normalized.manifestation_block;
  }

  // Defensive auto-recovery for missing castMemberId (e.g. Magnum v4 omitting top-level castMemberId)
  if (
    !normalized.castMemberId ||
    typeof normalized.castMemberId !== 'string' ||
    normalized.castMemberId.trim().length === 0
  ) {
    let recoveredId: string | null = null;

    // 1. Inspect authorityReferences if present (e.g. Magnum pattern: ["[aim-char-entity-41] ... Owner: char-entity-41"])
    if (Array.isArray(normalized.authorityReferences)) {
      for (const ref of normalized.authorityReferences) {
        if (typeof ref === 'string') {
          const ownerMatch = ref.match(/Owner:\s*([a-zA-Z0-9_-]+)/i);
          if (ownerMatch && ownerMatch[1]) {
            recoveredId = ownerMatch[1];
            break;
          }
          const aimMatch = ref.match(/\[aim-([a-zA-Z0-9_-]+)/i);
          if (aimMatch && aimMatch[1]) {
            recoveredId = aimMatch[1];
            break;
          }
          const charMatch = ref.match(/\b(char-[a-zA-Z0-9_-]+)\b/i);
          if (charMatch && charMatch[1]) {
            recoveredId = charMatch[1];
            break;
          }
        }
      }
    }

    // 2. Inspect manifestationBlock speaker if present
    if (!recoveredId && isJsonRecord(normalized.manifestationBlock)) {
      const speaker = normalized.manifestationBlock.speaker;
      if (typeof speaker === 'string' && speaker.trim().length > 0) {
        recoveredId = speaker.trim();
      }
    }

    // 3. Inspect activitySummary if present
    if (!recoveredId && typeof normalized.activitySummary === 'string') {
      const charMatch = normalized.activitySummary.match(/\b(char-[a-zA-Z0-9_-]+)\b/i);
      if (charMatch && charMatch[1]) {
        recoveredId = charMatch[1];
      }
    }

    // NET-NEW: Sole-active cast member fallback when no ID could be recovered
    if (!recoveredId && context?.activeCastIds && context.activeCastIds.length === 1) {
      recoveredId = context.activeCastIds[0];
    }

    if (recoveredId) {
      normalized.castMemberId = recoveredId;
    }
  }

  // NET-NEW: Fail-closed roster check (applies to model-supplied AND recovered IDs)
  if (normalized.castMemberId && context?.scenarioCastIds) {
    if (!context.scenarioCastIds.includes(normalized.castMemberId as string)) {
      normalized.castMemberId = undefined; // Reject ungrounded / hallucinated IDs
    }
  }

  if (
    !normalized.proposalId ||
    typeof normalized.proposalId !== 'string' ||
    normalized.proposalId.trim().length === 0
  ) {
    normalized.proposalId = `prop-act-${Date.now()}`;
  }

  if (typeof normalized.locationNodeId === 'string' && !normalized.locationNodeId.trim()) {
    normalized.locationNodeId = null;
  }
  if (typeof normalized.pursuitId === 'string' && !normalized.pursuitId.trim()) {
    normalized.pursuitId = null;
  }

  if (typeof normalized.perceptionPath === 'string') {
    normalized.perceptionPath = normalizePerceptionPath(normalized.perceptionPath);
  } else if (!normalized.perceptionPath) {
    normalized.perceptionPath = 'DIRECT';
  }

  const projected = projectProviderUnionBranch(
    normalized,
    'ACTIVITY',
    CAST_ACTIVITY_PROPOSAL_ACTIVE_FIELDS
  );

  return normalizeActiveManifestationBlock(projected);
}

function normalizeSituatedPressureProposal(record: JsonRecord): JsonRecord {
  if (record.kind !== 'PRESSURE') {
    return projectProviderUnionBranch(
      record,
      'PRESSURE',
      SITUATED_PRESSURE_PROPOSAL_ACTIVE_FIELDS
    );
  }

  const normalized: JsonRecord = { ...record };
  if (normalized.proposal_id && !normalized.proposalId) {
    normalized.proposalId = normalized.proposal_id;
  }
  if (normalized.value_anchor_id && !normalized.valueAnchorId) {
    normalized.valueAnchorId = normalized.value_anchor_id;
  }
  if (normalized.source_reference && !normalized.sourceReference) {
    normalized.sourceReference = normalized.source_reference;
  }
  if (normalized.affected_dimension && !normalized.affectedDimension) {
    normalized.affectedDimension = normalized.affected_dimension;
  }
  if (normalized.adverse_prospect && !normalized.adverseProspect) {
    normalized.adverseProspect = normalized.adverse_prospect;
  }
  if (normalized.authority_references && !normalized.authorityReferences) {
    normalized.authorityReferences = normalized.authority_references;
  }
  if (normalized.persistence_target && !normalized.persistenceTarget) {
    normalized.persistenceTarget = normalized.persistence_target;
  }
  if (normalized.response_window_open !== undefined && normalized.responseWindowOpen === undefined) {
    normalized.responseWindowOpen = normalized.response_window_open;
  }
  if (normalized.manifestation_block && !normalized.manifestationBlock) {
    normalized.manifestationBlock = normalized.manifestation_block;
  }

  if (
    !normalized.proposalId ||
    typeof normalized.proposalId !== 'string' ||
    normalized.proposalId.trim().length === 0
  ) {
    normalized.proposalId = `prop-press-${Date.now()}`;
  }

  if (typeof normalized.operator === 'string') {
    normalized.operator = normalized.operator.trim().toUpperCase();
  }
  if (typeof normalized.affectedDimension === 'string') {
    normalized.affectedDimension = normalized.affectedDimension.trim().toUpperCase();
  }
  if (typeof normalized.persistenceTarget === 'string') {
    normalized.persistenceTarget = normalized.persistenceTarget.trim().toUpperCase();
  }

  const projected = projectProviderUnionBranch(
    normalized,
    'PRESSURE',
    SITUATED_PRESSURE_PROPOSAL_ACTIVE_FIELDS
  );

  return normalizeActiveManifestationBlock(projected);
}

/**
 * Adapts the deliberately minimized Gemini transport schema to the canonical turn schema.
 * Gemini may omit the two optional transport properties that mean "no value"; only those
 * known nullable paths are completed with null. All HG1 envelopes and every non-nullable
 * canonical field still fail closed at the authoritative Zod boundary.
 */
export function normalizeGeminiTurnProviderPayload(
  payload: unknown,
  context?: CastNormalizationContext
): unknown {
  if (!isJsonRecord(payload)) {
    return payload;
  }

  const normalized: JsonRecord = { ...payload };

  if (Array.isArray(payload.narrative_blocks)) {
    normalized.narrative_blocks = payload.narrative_blocks
      .filter((b) => isJsonRecord(b))
      .map((b) => {
        const record = b as JsonRecord;
        if (
          (record.type === 'dialogue' ||
            record.type === 'internal_monologue' ||
            record.type === 'soliloquy' ||
            record.type === 'transmission') &&
          (!record.speaker ||
            typeof record.speaker !== 'string' ||
            record.speaker.trim().length === 0)
        ) {
          return {
            ...record,
            type: 'prose',
          };
        }
        return record;
      })
      .slice(0, 3);
  }

  if (isJsonRecord(payload.intent_proposal)) {
    const ip = normalizeMissingNullableField(
      payload.intent_proposal,
      'action_subtype'
    );
    normalized.intent_proposal = {
      ...ip,
      ...(typeof ip.action_kind === 'string'
        ? { action_kind: ip.action_kind.trim().toUpperCase() }
        : {}),
      ...(typeof ip.pressure_direction === 'string'
        ? { pressure_direction: ip.pressure_direction.trim().toUpperCase() }
        : {}),
      ...(typeof ip.dramatic_tactic === 'string'
        ? { dramatic_tactic: ip.dramatic_tactic.trim().toUpperCase() }
        : {}),
      ...(typeof ip.intent_synergy === 'string'
        ? { intent_synergy: ip.intent_synergy.trim().toUpperCase() }
        : {}),
    };
  }

  if (isJsonRecord(payload.reconciliation_proposal)) {
    const rp = normalizeMissingNullableField(
      payload.reconciliation_proposal,
      'memory_echo_candidate'
    );
    normalized.reconciliation_proposal = {
      ...rp,
      ...(typeof rp.mode === 'string' ? { mode: rp.mode.trim().toUpperCase() } : {}),
      ...(typeof rp.feasibility === 'string'
        ? { feasibility: rp.feasibility.trim().toUpperCase() }
        : {}),
      ...(typeof rp.reason_code === 'string'
        ? { reason_code: rp.reason_code.trim().toUpperCase() }
        : {}),
      ...(typeof rp.fictional_time_cost === 'string'
        ? { fictional_time_cost: rp.fictional_time_cost.trim().toUpperCase() }
        : {}),
      ...(typeof rp.authority_alignment === 'string'
        ? { authority_alignment: rp.authority_alignment.trim().toUpperCase() }
        : {}),
    };
  }

  if (isJsonRecord(payload.world_memory_proposal)) {
    const proposal = payload.world_memory_proposal;
    normalized.world_memory_proposal = {
      ...proposal,
      ...(Array.isArray(proposal.candidates)
        ? {
            candidates: proposal.candidates
              .filter((c) => isJsonRecord(c))
              .map((candidate) => {
                const withSentinel = normalizeSentinelField(candidate as JsonRecord, 'node_id');
                if (withSentinel.scope === 'GLOBAL') {
                  return { ...withSentinel, node_id: null };
                }
                return withSentinel;
              })
              .slice(0, 2),
          }
        : {}),
    };
  }

  if (isJsonRecord(payload.character_stance_proposal)) {
    const proposal = payload.character_stance_proposal;
    if (Array.isArray(proposal.changes)) {
      normalized.character_stance_proposal = {
        ...proposal,
        changes: proposal.changes.filter((c) => isJsonRecord(c)).slice(0, 2),
      };
    }
  }

  if (isJsonRecord(payload.character_relationship_proposal)) {
    const proposal = payload.character_relationship_proposal;
    if (Array.isArray(proposal.changes)) {
      normalized.character_relationship_proposal = {
        ...proposal,
        changes: proposal.changes
          .filter(
            (c) => isJsonRecord(c) && (c.delta === -1 || c.delta === 1)
          )
          .slice(0, 2),
      };
    }
  }

  if (isJsonRecord(payload.character_memory_proposal)) {
    const proposal = payload.character_memory_proposal;
    if (Array.isArray(proposal.candidates)) {
      normalized.character_memory_proposal = {
        ...proposal,
        candidates: proposal.candidates.filter((c) => isJsonRecord(c)).slice(0, 2),
      };
    }
  }

  if (isJsonRecord(payload.consequence_proposal)) {
    const proposal = payload.consequence_proposal;
    if (Array.isArray(proposal.mutations)) {
      const validPsych = new Set(['STABLE', 'UNEASY', 'DISTRESSED', 'PANICKED', 'DISSOCIATED']);
      normalized.consequence_proposal = {
        ...proposal,
        mutations: proposal.mutations
          .filter((m) => {
            if (!isJsonRecord(m)) return false;
            if (m.domain === 'INVENTORY' || m.domain === 'PLAYER_INJURY') {
              return m.operation === 'ADD' || m.operation === 'REMOVE';
            }
            if (m.domain === 'PSYCHOLOGICAL_STATUS') {
              return (
                typeof m.value === 'string' &&
                validPsych.has(m.value.trim().toUpperCase())
              );
            }
            return false;
          })
          .map((m) => {
            if (isJsonRecord(m) && m.domain === 'PSYCHOLOGICAL_STATUS') {
              return {
                ...m,
                operation: 'SET',
                value: typeof m.value === 'string' ? m.value.trim().toUpperCase() : m.value,
              };
            }
            return m;
          })
          .slice(0, 4),
      };
    }
  }

  if (isJsonRecord(payload.value_state_proposal)) {
    const proposal = payload.value_state_proposal;
    if (Array.isArray(proposal.changes)) {
      normalized.value_state_proposal = {
        ...proposal,
        changes: proposal.changes.filter((c) => isJsonRecord(c)).slice(0, 3),
      };
    }
  }

  if (isJsonRecord(payload.character_pursuit_proposal)) {
    const proposal = payload.character_pursuit_proposal;
    if (Array.isArray(proposal.changes)) {
      normalized.character_pursuit_proposal = {
        ...proposal,
        changes: proposal.changes.filter((c) => isJsonRecord(c)).slice(0, 2),
      };
    }
  }

  if (isJsonRecord(payload.character_development_proposal)) {
    const proposal = payload.character_development_proposal;
    if (Array.isArray(proposal.changes)) {
      normalized.character_development_proposal = {
        ...proposal,
        changes: proposal.changes.filter((c) => isJsonRecord(c)).slice(0, 2),
      };
    }
  }

  if (isJsonRecord(payload.pressure_transition_proposal)) {
    const proposal = payload.pressure_transition_proposal;
    if (Array.isArray(proposal.transitions)) {
      normalized.pressure_transition_proposal = {
        ...proposal,
        transitions: proposal.transitions.filter((t) => isJsonRecord(t)).slice(0, 2),
      };
    }
  }

  if (isJsonRecord(payload.cast_activity_proposal)) {
    normalized.cast_activity_proposal = normalizeCastActivityProposal(
      payload.cast_activity_proposal,
      context
    );
  }

  if (isJsonRecord(payload.situated_pressure_proposal)) {
    normalized.situated_pressure_proposal = normalizeSituatedPressureProposal(
      payload.situated_pressure_proposal
    );
  }

  if (isJsonRecord(payload.logic_state)) {
    normalized.logic_state = normalizeSentinelField(payload.logic_state, 'requested_transition');
  }

  if (isJsonRecord(payload.topologyDelta)) {
    normalized.topologyDelta = normalizeSentinelField(payload.topologyDelta, 'exitDirection');
  }

  return normalized;
}
