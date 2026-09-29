import {
  CharacterCommunicationModeSchema,
  CharacterCommunicationMode,
  PresenceDispositionKindSchema,
  PresenceDispositionKind,
  ForgeSourceCandidateTargetSchema,
  ForgeSourceCandidateTarget,
  ForgeSourceEvidenceCategorySchema,
  ForgeSourceEvidenceCategory,
  ForgeValidationIssue,
  ForgeValidationIssueCode,
} from '../types/forge';
import { EdgeKindSchema, EdgeKind } from '../types/engineContract';
import {
  CharacterPursuitReviewWindowSchema,
  CharacterPursuitReviewWindow,
  CharacterPursuitStatusSchema,
  CharacterPursuitStatus,
} from '../types/horrorGrammar';
import { getBannedNamesPromptBlock } from './bannedNames';

// ============================================================================
// Canonical Extraction Contract Constants (Directly derived from schema owners)
// ============================================================================

export const EXTRACTION_COMMUNICATION_MODES: readonly CharacterCommunicationMode[] =
  CharacterCommunicationModeSchema.options;

export const EXTRACTION_EDGE_KINDS: readonly EdgeKind[] = EdgeKindSchema.options;

export const EXTRACTION_VALUE_HOLDER_KINDS = [
  'CHARACTER',
  'RELATIONSHIP',
  'PLACE',
  'SCENARIO',
] as const;
export type ExtractionValueHolderKind = (typeof EXTRACTION_VALUE_HOLDER_KINDS)[number];

export const EXTRACTION_PRESENCE_KINDS: readonly PresenceDispositionKind[] =
  PresenceDispositionKindSchema.options;

export const EXTRACTION_PURSUIT_REVIEW_WINDOWS: readonly CharacterPursuitReviewWindow[] =
  CharacterPursuitReviewWindowSchema.options;

export const EXTRACTION_PURSUIT_STATUSES: readonly CharacterPursuitStatus[] =
  CharacterPursuitStatusSchema.options;

export const EXTRACTION_EVIDENCE_CATEGORIES: readonly ForgeSourceEvidenceCategory[] =
  ForgeSourceEvidenceCategorySchema.options;

export const EXTRACTION_CANDIDATE_TARGETS: readonly ForgeSourceCandidateTarget[] =
  ForgeSourceCandidateTargetSchema.options;

// Maximum diagnostic bounds
export const MAX_VALIDATION_ISSUES = 50;
export const MAX_ISSUE_MESSAGE_LENGTH = 300;
export const MAX_ISSUE_LABEL_LENGTH = 100;
export const MAX_ISSUE_FIELD_PATH_LENGTH = 200;
export const MAX_ALLOWED_VALUES_COUNT = 20;

// ============================================================================
// Deterministic Alias Normalization Tables & Helpers
// ============================================================================

/**
 * Normalizes communication mode strings to canonical enum values:
 * 'spoken' | 'nonverbal' | 'mediated'
 */
const COMMUNICATION_MODE_ALIAS_MAP: Record<string, CharacterCommunicationMode> = {
  // Spoken aliases
  spoken: 'spoken',
  verbal: 'spoken',
  speech: 'spoken',
  voice: 'spoken',
  dialogue: 'spoken',
  oral: 'spoken',
  vocal: 'spoken',
  talking: 'spoken',

  // Nonverbal aliases
  nonverbal: 'nonverbal',
  'non-verbal': 'nonverbal',
  non_verbal: 'nonverbal',
  gestural: 'nonverbal',
  gesture: 'nonverbal',
  'body language': 'nonverbal',
  body_language: 'nonverbal',
  bodylanguage: 'nonverbal',
  physical: 'nonverbal',
  sign: 'nonverbal',
  silent: 'nonverbal',
  facial: 'nonverbal',
  expression: 'nonverbal',

  // Mediated aliases
  mediated: 'mediated',
  telephone: 'mediated',
  phone: 'mediated',
  radio: 'mediated',
  written: 'mediated',
  channel: 'mediated',
  broadcast: 'mediated',
  text: 'mediated',
  intercom: 'mediated',
  device: 'mediated',
  recorded: 'mediated',
};

export function normalizeCommunicationMode(raw: unknown): CharacterCommunicationMode | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.trim().toLowerCase();
  return COMMUNICATION_MODE_ALIAS_MAP[cleaned];
}

export function normalizeCommunicationModes(raw: unknown): CharacterCommunicationMode[] | undefined {
  if (typeof raw === 'string') {
    const single = normalizeCommunicationMode(raw);
    return single ? [single] : undefined;
  }
  if (Array.isArray(raw)) {
    const modes: CharacterCommunicationMode[] = [];
    for (const item of raw) {
      const mode = normalizeCommunicationMode(item);
      if (mode && !modes.includes(mode)) {
        modes.push(mode);
      } else if (!mode && typeof item === 'string' && item.trim()) {
        // If unmapped, return undefined so Zod validation catches it and quarantines cleanly
        return undefined;
      }
    }
    return modes.length > 0 ? modes : undefined;
  }
  return undefined;
}

/**
 * Normalizes topology connection kind strings to canonical EdgeKind:
 * 'PHYSICAL' | 'FORCED_EVENT' | 'MEMORY_RECONSTRUCTION' | 'HISTORICAL_REFERENCE' | 'TERMINAL_EJECTION' | 'AUTHORED_PARADOX'
 */
const EDGE_KIND_ALIAS_MAP: Record<string, EdgeKind> = {
  // PHYSICAL aliases
  PHYSICAL: 'PHYSICAL',
  DOOR: 'PHYSICAL',
  DOORWAY: 'PHYSICAL',
  CORRIDOR: 'PHYSICAL',
  HALLWAY: 'PHYSICAL',
  PASSAGE: 'PHYSICAL',
  PASSAGEWAY: 'PHYSICAL',
  PATH: 'PHYSICAL',
  PHYSICAL_PATH: 'PHYSICAL',
  'PHYSICAL-PATH': 'PHYSICAL',
  WALKWAY: 'PHYSICAL',
  STAIRS: 'PHYSICAL',
  STAIRCASE: 'PHYSICAL',

  // FORCED_EVENT aliases (spelling and separator variants only)
  FORCED_EVENT: 'FORCED_EVENT',
  'FORCED-EVENT': 'FORCED_EVENT',
  FORCED_TRANSITION: 'FORCED_EVENT',
  'FORCED-TRANSITION': 'FORCED_EVENT',

  // MEMORY_RECONSTRUCTION aliases
  MEMORY_RECONSTRUCTION: 'MEMORY_RECONSTRUCTION',
  'MEMORY-RECONSTRUCTION': 'MEMORY_RECONSTRUCTION',
  MEMORY_TRANSITION: 'MEMORY_RECONSTRUCTION',
  'MEMORY-TRANSITION': 'MEMORY_RECONSTRUCTION',

  // HISTORICAL_REFERENCE aliases
  HISTORICAL_REFERENCE: 'HISTORICAL_REFERENCE',
  'HISTORICAL-REFERENCE': 'HISTORICAL_REFERENCE',
  HISTORICAL: 'HISTORICAL_REFERENCE',

  // TERMINAL_EJECTION aliases
  TERMINAL_EJECTION: 'TERMINAL_EJECTION',
  'TERMINAL-EJECTION': 'TERMINAL_EJECTION',
  TERMINAL: 'TERMINAL_EJECTION',
  EJECTION: 'TERMINAL_EJECTION',

  // AUTHORED_PARADOX aliases
  AUTHORED_PARADOX: 'AUTHORED_PARADOX',
  'AUTHORED-PARADOX': 'AUTHORED_PARADOX',
  PARADOX: 'AUTHORED_PARADOX',
  ANOMALY: 'AUTHORED_PARADOX',
  NON_EUCLIDEAN: 'AUTHORED_PARADOX',
  'NON-EUCLIDEAN': 'AUTHORED_PARADOX',
};

export function normalizeEdgeKind(raw: unknown): EdgeKind | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.trim().toUpperCase().replace(/-/g, '_');
  return EDGE_KIND_ALIAS_MAP[cleaned];
}

/**
 * Normalizes value holder objects to match ValueHolderRefSchema:
 * - CHARACTER (requires castMemberId)
 * - RELATIONSHIP (requires castMemberIds tuple)
 * - PLACE (requires nodeId)
 * - SCENARIO (no extra fields)
 */
export function normalizeValueHolder(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = { ...(raw as Record<string, unknown>) };
  const rawKind = typeof obj.kind === 'string' ? obj.kind.trim().toUpperCase() : '';

  // CHARACTER aliases (strict person/castmember equivalents; ENTITY is excluded)
  if (
    rawKind === 'CHARACTER' ||
    rawKind === 'CASTMEMBER' ||
    rawKind === 'CAST_MEMBER' ||
    rawKind === 'PERSON' ||
    rawKind === 'ACTOR' ||
    rawKind === 'INDIVIDUAL' ||
    rawKind === 'SUBJECT'
  ) {
    const castMemberId =
      typeof obj.castMemberId === 'string' && obj.castMemberId.trim()
        ? obj.castMemberId.trim()
        : typeof obj.id === 'string' && obj.id.trim()
          ? obj.id.trim()
          : typeof obj.targetCastMemberId === 'string' && obj.targetCastMemberId.trim()
            ? obj.targetCastMemberId.trim()
            : undefined;
    if (castMemberId) {
      return { kind: 'CHARACTER', castMemberId };
    }
    return { ...obj, kind: 'CHARACTER' };
  }

  // RELATIONSHIP aliases
  if (
    rawKind === 'RELATIONSHIP' ||
    rawKind === 'RELATION' ||
    rawKind === 'PAIR' ||
    rawKind === 'INTERPERSONAL' ||
    rawKind === 'BOND'
  ) {
    let castMemberIds = Array.isArray(obj.castMemberIds)
      ? obj.castMemberIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : undefined;
    if (!castMemberIds && Array.isArray(obj.members)) {
      castMemberIds = obj.members.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    }
    if (castMemberIds && castMemberIds.length === 2 && castMemberIds[0] !== castMemberIds[1]) {
      return { kind: 'RELATIONSHIP', castMemberIds };
    }
    return { ...obj, kind: 'RELATIONSHIP' };
  }

  // PLACE aliases
  if (
    rawKind === 'PLACE' ||
    rawKind === 'LOCATION' ||
    rawKind === 'NODE' ||
    rawKind === 'SPACE' ||
    rawKind === 'ROOM' ||
    rawKind === 'AREA'
  ) {
    const nodeId =
      typeof obj.nodeId === 'string' && obj.nodeId.trim()
        ? obj.nodeId.trim()
        : typeof obj.id === 'string' && obj.id.trim()
          ? obj.id.trim()
          : undefined;
    if (nodeId) {
      return { kind: 'PLACE', nodeId };
    }
    return { ...obj, kind: 'PLACE' };
  }

  // SCENARIO aliases
  if (
    rawKind === 'SCENARIO' ||
    rawKind === 'WORLD' ||
    rawKind === 'GLOBAL' ||
    rawKind === 'ENVIRONMENT' ||
    rawKind === 'SETTING' ||
    rawKind === 'STORY'
  ) {
    return { kind: 'SCENARIO' };
  }

  return obj;
}

/**
 * Normalizes character presence disposition objects:
 * - AT_NODE (nodeId)
 * - OFFSTAGE
 * - NONLOCAL
 */
export function normalizePresenceDisposition(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = { ...(raw as Record<string, unknown>) };
  const rawKind = typeof obj.kind === 'string' ? obj.kind.trim().toUpperCase() : '';

  if (
    rawKind === 'AT_NODE' ||
    rawKind === 'ATNODE' ||
    rawKind === 'NODE' ||
    rawKind === 'LOCATION' ||
    rawKind === 'PRESENT' ||
    rawKind === 'IN_ROOM' ||
    rawKind === 'ROOM' ||
    rawKind === 'PLACE' ||
    rawKind === 'SPATIAL'
  ) {
    const nodeId =
      typeof obj.nodeId === 'string' && obj.nodeId.trim()
        ? obj.nodeId.trim()
        : typeof obj.id === 'string' && obj.id.trim()
          ? obj.id.trim()
          : undefined;
    if (nodeId) {
      return { kind: 'AT_NODE', nodeId };
    }
    return { ...obj, kind: 'AT_NODE' };
  }

  if (
    rawKind === 'OFFSTAGE' ||
    rawKind === 'OFF_STAGE' ||
    rawKind === 'OFF-STAGE' ||
    rawKind === 'ABSENT'
  ) {
    return { kind: 'OFFSTAGE' };
  }

  if (
    rawKind === 'NONLOCAL' ||
    rawKind === 'NON_LOCAL' ||
    rawKind === 'NON-LOCAL' ||
    rawKind === 'OMNIPRESENT' ||
    rawKind === 'EVERYWHERE' ||
    rawKind === 'AMBIENT'
  ) {
    return { kind: 'NONLOCAL' };
  }

  return obj;
}

const CANONICAL_CANDIDATE_TARGETS = new Set<string>([
  'scenario_title',
  'premise',
  'setting_location',
  'setting_atmosphere',
  'setting_time_period',
  'environmental_rule',
  'narrative_rule',
  'cast_seed',
  'cast_expression_guidance',
  'topology_node',
  'topology_connection',
  'expandable_space_anchor',
  'cast_opening_placement',
  'reference_attribution',
  'value_anchor',
  'character_pursuit',
  'depiction_contract',
  'antagonist_profile',
]);

const CANDIDATE_TARGET_ALIAS_MAP: Record<string, string> = {
  // Cast aliases
  character: 'cast_seed',
  characters: 'cast_seed',
  cast: 'cast_seed',
  cast_member: 'cast_seed',
  castmember: 'cast_seed',
  person: 'cast_seed',
  actor: 'cast_seed',
  npc: 'cast_seed',
  entity: 'cast_seed',
  cast_seeds: 'cast_seed',
  // Topology aliases
  node: 'topology_node',
  nodes: 'topology_node',
  topology: 'topology_node',
  room: 'topology_node',
  rooms: 'topology_node',
  chamber: 'topology_node',
  chambers: 'topology_node',
  area: 'topology_node',
  areas: 'topology_node',
  place: 'topology_node',
  places: 'topology_node',
  locations: 'topology_node',
  initial_topology_node: 'topology_node',
  topology_nodes: 'topology_node',
  connection: 'topology_connection',
  connections: 'topology_connection',
  edge: 'topology_connection',
  edges: 'topology_connection',
  // Rule aliases
  rule: 'narrative_rule',
  rules: 'narrative_rule',
  narrative_rules: 'narrative_rule',
  environmental_rules: 'environmental_rule',
  environmental_rule: 'environmental_rule',
  environmental: 'environmental_rule',
  environment: 'environmental_rule',
  unknown: 'narrative_rule',
  unknowns: 'narrative_rule',
  misc: 'narrative_rule',
  miscellaneous: 'narrative_rule',
  note: 'narrative_rule',
  notes: 'narrative_rule',
  lore: 'narrative_rule',
  world_rule: 'narrative_rule',
  world_rules: 'narrative_rule',
  // Setting aliases
  title: 'scenario_title',
  name: 'scenario_title',
  scenario_name: 'scenario_title',
  atmosphere: 'setting_atmosphere',
  mood: 'setting_atmosphere',
  time_period: 'setting_time_period',
  time: 'setting_time_period',
  setting_time: 'setting_time_period',
  // Contract
  contract: 'depiction_contract',
  depiction: 'depiction_contract',
  // Antagonist
  antagonist: 'antagonist_profile',
  antagonist_profile: 'antagonist_profile',
  apparatus: 'antagonist_profile',
  monster: 'antagonist_profile',
  entity_profile: 'antagonist_profile',
  // Pursuit & anchor
  pursuit: 'character_pursuit',
  pursuits: 'character_pursuit',
  anchor: 'value_anchor',
  anchors: 'value_anchor',
  value: 'value_anchor',
};

export function normalizeCandidateTarget(
  rawTarget: unknown,
  rawClassification: unknown,
  proposedValue: unknown
): string | undefined {
  let cleanedTarget: string | undefined;
  if (typeof rawTarget === 'string' && rawTarget.trim()) {
    cleanedTarget = rawTarget.trim().toLowerCase().replace(/-/g, '_');
  }

  // Location shape disambiguation:
  // If target is "location", check proposedValue shape:
  // An object with room/node properties (id, label, name, description, hazards, visualTone) is a topology_node.
  // A string or non-node value is setting_location.
  if (cleanedTarget === 'location' || cleanedTarget === 'setting_location') {
    if (proposedValue && typeof proposedValue === 'object' && !Array.isArray(proposedValue)) {
      const obj = proposedValue as Record<string, unknown>;
      if ('id' in obj || 'label' in obj || 'description' in obj || 'hazards' in obj || 'visualTone' in obj) {
        return 'topology_node';
      }
    }
    return 'setting_location';
  }

  if (cleanedTarget) {
    if (CANONICAL_CANDIDATE_TARGETS.has(cleanedTarget)) return cleanedTarget;
    if (CANDIDATE_TARGET_ALIAS_MAP[cleanedTarget]) return CANDIDATE_TARGET_ALIAS_MAP[cleanedTarget];
  }

  // Model emitted target into classification
  if (typeof rawClassification === 'string' && rawClassification.trim()) {
    const cleanedClass = rawClassification.trim().toLowerCase().replace(/-/g, '_');
    if (cleanedClass === 'location' || cleanedClass === 'setting_location') {
      if (proposedValue && typeof proposedValue === 'object' && !Array.isArray(proposedValue)) {
        const obj = proposedValue as Record<string, unknown>;
        if ('id' in obj || 'label' in obj || 'description' in obj || 'hazards' in obj || 'visualTone' in obj) {
          return 'topology_node';
        }
      }
      return 'setting_location';
    }
    if (CANONICAL_CANDIDATE_TARGETS.has(cleanedClass)) return cleanedClass;
    if (CANDIDATE_TARGET_ALIAS_MAP[cleanedClass]) return CANDIDATE_TARGET_ALIAS_MAP[cleanedClass];
  }

  // Fallback: Infer target from shape of proposedValue
  if (proposedValue && typeof proposedValue === 'object' && !Array.isArray(proposedValue)) {
    const obj = proposedValue as Record<string, unknown>;
    if (
      'entityName' in obj ||
      'apparatusControls' in obj ||
      'sadisticDirectives' in obj ||
      'telemetryFeeds' in obj
    ) {
      return 'antagonist_profile';
    }
    if (
      'name' in obj &&
      ('role' in obj || 'personality' in obj || 'traits' in obj || 'isEntity' in obj || 'behaviorVector' in obj)
    ) {
      return 'cast_seed';
    }
    if (
      ('label' in obj || 'id' in obj) &&
      ('description' in obj || 'hazards' in obj || 'visualTone' in obj)
    ) {
      return 'topology_node';
    }
    if ('dramaticRegister' in obj || 'directness' in obj) {
      return 'depiction_contract';
    }
    if (('fromNodeId' in obj && 'toNodeId' in obj) || ('from' in obj && 'to' in obj)) {
      return 'topology_connection';
    }
    if ('objective' in obj && ('castMemberId' in obj || 'presentApproach' in obj)) {
      return 'character_pursuit';
    }
    if ('holder' in obj && 'adverseProspect' in obj) {
      return 'value_anchor';
    }
  }

  return undefined;
}

export function normalizeCandidateClassification(
  rawClassification: unknown
): 'evidence' | 'inference' {
  if (typeof rawClassification === 'string') {
    const cleaned = rawClassification.trim().toLowerCase();
    if (cleaned.includes('infer')) return 'inference';
  }
  return 'evidence';
}

/**
 * Normalizes candidate fields deterministically before schema validation.
 */
export function normalizeCandidateAliases(
  rawCandidate: Record<string, unknown>
): Record<string, unknown> {
  const candidate = { ...rawCandidate };
  const resolvedTarget = normalizeCandidateTarget(
    candidate.target,
    candidate.classification,
    candidate.proposedValue
  );
  if (resolvedTarget) {
    candidate.target = resolvedTarget;
  }
  candidate.classification = normalizeCandidateClassification(candidate.classification);

  const target = candidate.target;
  let proposedValue = candidate.proposedValue;

  if (Array.isArray(proposedValue) && (target === 'environmental_rule' || target === 'narrative_rule')) {
    proposedValue = proposedValue
      .map((v) => (typeof v === 'string' ? v.trim() : typeof v === 'object' && v ? JSON.stringify(v) : ''))
      .filter(Boolean)
      .join('\n');
  }

  if (proposedValue && typeof proposedValue === 'object' && !Array.isArray(proposedValue)) {
    const obj = { ...(proposedValue as Record<string, unknown>) };

    // String targets unwrapping (scenario_title, premise, setting_location, etc.)
    if (
      target === 'scenario_title' ||
      target === 'premise' ||
      target === 'setting_location' ||
      target === 'setting_atmosphere' ||
      target === 'setting_time_period' ||
      target === 'environmental_rule' ||
      target === 'narrative_rule' ||
      target === 'starting_node_selection' ||
      target === 'reference_attribution'
    ) {
      const extractedStr =
        typeof obj.title === 'string' && obj.title.trim()
          ? obj.title.trim()
          : typeof obj.name === 'string' && obj.name.trim()
            ? obj.name.trim()
            : typeof obj.value === 'string' && obj.value.trim()
              ? obj.value.trim()
              : typeof obj.text === 'string' && obj.text.trim()
                ? obj.text.trim()
                : typeof obj.location === 'string' && obj.location.trim()
                  ? obj.location.trim()
                  : typeof obj.premise === 'string' && obj.premise.trim()
                    ? obj.premise.trim()
                    : typeof obj.rule === 'string' && obj.rule.trim()
                      ? obj.rule.trim()
                      : typeof obj.description === 'string' && obj.description.trim()
                        ? obj.description.trim()
                        : typeof obj.atmosphere === 'string' && obj.atmosphere.trim()
                          ? obj.atmosphere.trim()
                          : typeof obj.timePeriod === 'string' && obj.timePeriod.trim()
                            ? obj.timePeriod.trim()
                            : undefined;
      if (extractedStr) {
        proposedValue = extractedStr;
      }
    }

    // Topology node normalization
    else if (target === 'topology_node') {
      const effectiveLabel =
        typeof obj.label === 'string' && obj.label.trim()
          ? obj.label.trim()
          : typeof obj.name === 'string' && obj.name.trim()
            ? obj.name.trim()
            : typeof obj.title === 'string' && obj.title.trim()
              ? obj.title.trim()
              : 'Uncharted Chamber';
      const effectiveId =
        typeof obj.id === 'string' && obj.id.trim()
          ? obj.id.trim()
          : effectiveLabel
              .toLowerCase()
              .replace(/[^a-z0-9_]+/g, '_')
              .replace(/^_+|_+$/g, '') || 'node_unnamed';
      obj.id = effectiveId;
      obj.label = effectiveLabel;
      obj.name = effectiveLabel;
      if (typeof obj.description !== 'string') {
        obj.description =
          typeof obj.details === 'string'
            ? obj.details
            : typeof obj.summary === 'string'
              ? obj.summary
              : '';
      }
      proposedValue = obj;
    }

    // Topology connection
    else if (target === 'topology_connection') {
      const from =
        typeof obj.from === 'string' && obj.from.trim()
          ? obj.from.trim()
          : typeof obj.fromNodeId === 'string' && obj.fromNodeId.trim()
            ? obj.fromNodeId.trim()
            : typeof obj.source === 'string' && obj.source.trim()
              ? obj.source.trim()
              : undefined;
      const to =
        typeof obj.to === 'string' && obj.to.trim()
          ? obj.to.trim()
          : typeof obj.toNodeId === 'string' && obj.toNodeId.trim()
            ? obj.toNodeId.trim()
            : typeof obj.target === 'string' && obj.target.trim()
              ? obj.target.trim()
              : undefined;
      if (from && to) {
        obj.from = from;
        obj.to = to;
      }
      if (obj.kind !== undefined) {
        const normalizedKind = normalizeEdgeKind(obj.kind);
        obj.kind = normalizedKind || 'PHYSICAL';
      } else {
        obj.kind = 'PHYSICAL';
      }
      if (obj.userInitiated === undefined) {
        obj.userInitiated = true;
      }
      proposedValue = obj;
    }

    // Antagonist profile normalization
    else if (target === 'antagonist_profile') {
      const entityName =
        typeof obj.entityName === 'string' && obj.entityName.trim()
          ? obj.entityName.trim()
          : typeof obj.name === 'string' && obj.name.trim()
            ? obj.name.trim()
            : typeof obj.entity === 'string' && obj.entity.trim()
              ? obj.entity.trim()
              : 'Primary Threat';
      const role =
        typeof obj.role === 'string' && obj.role.trim()
          ? obj.role.trim()
          : typeof obj.description === 'string' && obj.description.trim()
            ? obj.description.trim()
            : 'Sadistic Overseer';
      const toStrArray = (val: unknown): string[] => {
        if (Array.isArray(val)) {
          return val
            .map((v) =>
              typeof v === 'string'
                ? v.trim()
                : typeof v === 'object' && v
                  ? JSON.stringify(v)
                  : ''
            )
            .filter(Boolean);
        }
        if (typeof val === 'string' && val.trim()) return [val.trim()];
        return [];
      };
      proposedValue = {
        entityName,
        role,
        apparatusControls: toStrArray(
          obj.apparatusControls || obj.controls || obj.apparatus
        ),
        sadisticDirectives: toStrArray(
          obj.sadisticDirectives || obj.directives || obj.goals || obj.tactics
        ),
        telemetryFeeds: toStrArray(
          obj.telemetryFeeds || obj.telemetry || obj.feeds || obj.sensors
        ),
        targetVictimIds: toStrArray(
          obj.targetVictimIds || obj.victims || obj.targetVictims
        ),
      };
    }

    // 1. Cast expression guidance
    else if (target === 'cast_expression_guidance') {
      if (obj.communicationModes !== undefined) {
        const normalizedModes = normalizeCommunicationModes(obj.communicationModes);
        if (normalizedModes) {
          obj.communicationModes = normalizedModes;
        }
      }
      proposedValue = obj;
    }

    // 3. Value anchor
    else if (target === 'value_anchor') {
      if (obj.holder !== undefined) {
        const normalizedHolder = normalizeValueHolder(obj.holder);
        if (normalizedHolder) {
          obj.holder = normalizedHolder;
        }
      }
      proposedValue = obj;
    }

    // 4. Cast opening placement
    else if (target === 'cast_opening_placement') {
      const normalizedPlacement = normalizePresenceDisposition(obj);
      if (normalizedPlacement) {
        proposedValue = normalizedPlacement;
      }
    }

    // 5. Cast seed presence disposition and expressionProfile
    else if (target === 'cast_seed') {
      // Normalize disposition (SURVIVOR | VILLAIN | BYSTANDER)
      let disp = String(obj.disposition || '').toUpperCase().trim();
      if (!['SURVIVOR', 'VILLAIN', 'BYSTANDER'].includes(disp)) {
        const textToCheck = `${obj.role || ''} ${obj.name || ''} ${obj.description || ''} ${obj.personality || ''}`.toLowerCase();
        if (
          obj.isEntity === true ||
          /killer|villain|psychopath|slasher|stalker|monster|apparatus|antagonist|murderer/i.test(
            textToCheck
          )
        ) {
          disp = 'VILLAIN';
        } else if (
          /bystander|witness|civilian|clerk|cashier|janitor|neighbor|patron|bartender|passerby/i.test(
            textToCheck
          )
        ) {
          disp = 'BYSTANDER';
        } else {
          disp = 'SURVIVOR';
        }
      }
      obj.disposition = disp;

      if (obj.presenceDisposition !== undefined) {
        const normalizedPlacement = normalizePresenceDisposition(obj.presenceDisposition);
        if (normalizedPlacement) {
          obj.presenceDisposition = normalizedPlacement;
        }
      }
      if (obj.expressionProfile && typeof obj.expressionProfile === 'object') {
        const expObj = { ...(obj.expressionProfile as Record<string, unknown>) };
        if (expObj.communicationModes !== undefined) {
          const normalizedModes = normalizeCommunicationModes(expObj.communicationModes);
          if (normalizedModes) {
            expObj.communicationModes = normalizedModes;
          }
        }
        obj.expressionProfile = expObj;
      }
      // Normalize vulnerabilityBase and aliases (vulnerability_base, stats)
      const rawVb = (obj.vulnerabilityBase || obj.vulnerability_base || obj.vulnerability || obj.stats) as Record<string, unknown> | undefined;
      if (rawVb && typeof rawVb === 'object' && !Array.isArray(rawVb)) {
        const normalizeStat = (val: unknown): number => {
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            if (typeof val === 'string') {
              const parsed = parseFloat(val);
              if (Number.isFinite(parsed)) return normalizeStat(parsed);
            }
            return 0.5;
          }
          if (val > 10) return Math.min(1, Math.max(0, val / 100));
          if (val > 1) return Math.min(1, Math.max(0, val / 10));
          return Math.min(1, Math.max(0, val));
        };
        obj.vulnerabilityBase = {
          resilience: normalizeStat(rawVb.resilience ?? rawVb.resilence),
          skepticism: normalizeStat(rawVb.skepticism ?? rawVb.skeptic),
          baggage: normalizeStat(rawVb.baggage ?? rawVb.trauma),
        };
      }
      proposedValue = obj;
    }

    // 6. Character pursuit
    else if (target === 'character_pursuit') {
      const sanitized: Record<string, unknown> = {};
      const allowedKeys = [
        'id',
        'castMemberId',
        'objective',
        'presentApproach',
        'locationNodeId',
        'status',
        'reviewWindow',
        'triggerReferences',
        'basisSummary',
        'provenance',
      ];
      for (const key of allowedKeys) {
        if (obj[key] !== undefined) {
          sanitized[key] = obj[key];
        }
      }

      if (typeof obj.reviewWindow === 'string') {
        const cleaned = obj.reviewWindow.trim().toUpperCase().replace(/-/g, '_');
        if (cleaned === 'MOMENT' || cleaned === 'EVERY_TURN' || cleaned === 'TURN') {
          sanitized.reviewWindow = 'MOMENT';
        } else if (cleaned === 'SCENE_BEAT' || cleaned === 'SCENE' || cleaned === 'LOCATION_ENTRY' || cleaned === 'BEAT') {
          sanitized.reviewWindow = 'SCENE_BEAT';
        } else if (cleaned === 'EXTENDED' || cleaned === 'LONG_TERM' || cleaned === 'VALUE_THREATENED') {
          sanitized.reviewWindow = 'EXTENDED';
        } else if (cleaned === 'EVENT_DRIVEN' || cleaned === 'EVENT') {
          sanitized.reviewWindow = 'EVENT_DRIVEN';
        }
      }
      if (typeof obj.status === 'string') {
        const cleaned = obj.status.trim().toUpperCase();
        if (cleaned === 'ACTIVE' || cleaned === 'DORMANT') {
          sanitized.status = cleaned;
        }
      }
      if (typeof sanitized.basisSummary !== 'string' || !sanitized.basisSummary.trim()) {
        if (typeof obj.explanation === 'string' && obj.explanation.trim()) {
          sanitized.basisSummary = obj.explanation.trim();
        } else if (typeof obj.objective === 'string' && obj.objective.trim()) {
          sanitized.basisSummary = `Source baseline objective: ${obj.objective.trim()}`;
        }
      }
      proposedValue = sanitized;
    }
  }

  candidate.proposedValue = proposedValue;
  return candidate;
}

// ============================================================================
// Sanitized Issue Building
// ============================================================================

/**
 * Creates a bounded, sanitized ForgeValidationIssue without sensitive payloads.
 */
export function createQuarantinedIssue(
  sourceId: string,
  candidateIndex: number,
  candidate: Record<string, unknown>,
  errorInfo: {
    fieldPath: string;
    code: ForgeValidationIssueCode;
    message: string;
    allowedValues?: readonly string[];
  }
): ForgeValidationIssue {
  const candidateTarget =
    typeof candidate.target === 'string'
      ? candidate.target.slice(0, MAX_ISSUE_LABEL_LENGTH)
      : undefined;

  const label =
    typeof candidate.label === 'string'
      ? candidate.label.slice(0, MAX_ISSUE_LABEL_LENGTH)
      : undefined;

  const fieldPath = (errorInfo.fieldPath || 'proposedValue').slice(0, MAX_ISSUE_FIELD_PATH_LENGTH);
  const message = errorInfo.message.slice(0, MAX_ISSUE_MESSAGE_LENGTH);

  const allowedValues = errorInfo.allowedValues
    ? errorInfo.allowedValues.slice(0, MAX_ALLOWED_VALUES_COUNT).map((v) => v.slice(0, 100))
    : undefined;

  return {
    id: `${sourceId}-issue-${candidateIndex}`,
    sourceId,
    candidateIndex,
    candidateTarget,
    label,
    fieldPath,
    code: errorInfo.code,
    message,
    allowedValues,
    disposition: 'QUARANTINED',
  };
}

// ============================================================================
// Structured Extraction Prompt Builder
// ============================================================================

export function getForgeExtractionPrompt(fileName: string): string {
  return `You are the Forge Source Baseline Analyst for an atmospheric text-based horror engine.
Read the attached source document ("${fileName}").
Extract explicit evidence, candidate fields for authoring review, and identified gaps/unknowns.

OUTPUT FORMAT REQUIREMENTS:
You MUST output ONLY a valid JSON object matching this schema. Do not include markdown formatting or conversational text outside the JSON block.

{
  "summary": "Short 1-2 sentence overview of the analyzed document and its key themes.",
  "evidence": [
    {
      "id": "ev-1",
      "category": "one of: ${EXTRACTION_EVIDENCE_CATEGORIES.join(', ')}",
      "claim": "Clear claim of what this fact or element is",
      "excerpt": "Verbatim quote or short passage snippet from document if available"
    }
  ],
  "candidates": [
    {
      "id": "cand-0",
      "classification": "evidence",
      "target": "scenario_title",
      "label": "Scenario Title",
      "explanation": "Extracted atmospheric scenario title",
      "evidenceIds": ["ev-1"],
      "proposedValue": "The Scenario Title"
    },
    {
      "id": "cand-1",
      "classification": "evidence",
      "target": "depiction_contract",
      "label": "Document Depiction Contract",
      "explanation": "Core narrative and dramatic tone extracted from source",
      "evidenceIds": ["ev-1"],
      "proposedValue": {
        "dramaticRegister": "Atmospheric dread and psychological tension",
        "directness": "Grounded sensory observation",
        "aftermath": "Lingering psychological and physical fatigue",
        "ambiguityHandling": "Ambiguous cosmic reality with concrete physical clues"
      }
    },
    {
      "id": "cand-2",
      "classification": "evidence",
      "target": "cast_seed",
      "label": "Short human-readable label (e.g. character name)",
      "explanation": "Why this candidate was extracted from the evidence",
      "evidenceIds": ["ev-1"],
      "proposedValue": "Target-specific typed value matching EXACT schema rules below",
      "targetCastMemberId": "optional cast member ID (strictly required if target is cast_expression_guidance, cast_opening_placement, or character_pursuit)"
    }
  ],
  NOTE ON CANDIDATE FIELDS:
  - "classification": MUST be strictly "evidence" or "inference". NEVER put target names in classification!
  - "target": MANDATORY on every candidate. MUST be one of: ${EXTRACTION_CANDIDATE_TARGETS.join(', ')}.
  "unknowns": [
    {
      "id": "unk-1",
      "category": "one of: ${EXTRACTION_EVIDENCE_CATEGORIES.join(', ')}",
      "question": "Important gap or ambiguity in the source material requiring creator decision",
      "targetEffect": "Brief statement of why resolving this matters to the simulation or runtime behavior"
    }
  ]
}

CRITICAL EXTRACTION SCHEMAS & ENUMS:
1. 'scenario_title' and 'premise' (MANDATORY CANDIDATES):
   - 'scenario_title': proposedValue: string (Clear, evocative, atmospheric title for the scenario derived directly from the source text). ALWAYS emit this candidate.
   - 'premise': proposedValue: string (2-3 sentence evocative summary of the horror premise, scenario stakes, and looming threat).

2. 'depiction_contract' (MANDATORY - EXACTLY ONE IN "candidates"):
   - proposedValue: {
       "dramaticRegister": string (concrete reference-specific dramatic tone),
       "directness": string (concrete sensory and narrative camera directness),
       "aftermath": string (concrete lasting consequences and aftermath framing),
       "ambiguityHandling": string (concrete epistemic uncertainty / reveal boundaries),
       "specialBoundaries"?: string (optional boundaries / prohibitions, or empty string)
     }
   - Must be linked to 1 to 12 evidenceIds in the evidence registry.

3. 'topology_node' (COMPREHENSIVE SPATIAL EXTRACTION - MINIMUM 5 TO 10 LOCATIONS):
   - proposedValue: { "id": string, "label": string, "description"?: string, "sensoryGuidance"?: string }
   - Extract ALL distinct physical chambers, containment cells, corridors, stairwells, service hatches, examination suites, and perimeter zones mentioned in the narrative.
   - Aim for 5 to 10 distinct, interconnected chambers. Never emit a raw string node.
   - For each room, provide vivid sensory details (temperature, odors, acoustics, lighting, hazards).

4. 'topology_connection':
   - proposedValue: { "from": string, "to": string, "kind": "${EXTRACTION_EDGE_KINDS.join('" | "')}", "requires"?: string[], "userInitiated": boolean }
   - For every room extracted, emit corresponding 'topology_connection' candidates connecting adjacent spaces into a navigable floorplan with userInitiated: true.

5. 'antagonist_profile':
   - proposedValue: {
       "entityName": string,
       "role": string,
       "apparatusControls": string[],
       "sadisticDirectives": string[],
       "telemetryFeeds": string[],
       "targetVictimIds"?: string[]
     }
   - If an antagonistic entity, automated containment apparatus, monster, or hostile overseer is present in the source material, extract its operational profile, controls, and sadistic directives.
   - DUAL-EXTRACTION RULE: If the antagonistic entity has a proper name, speaks dialogue, or takes personalized character-like action (threats, torment tailored to individuals, direct address), it MUST ALSO be extracted as a separate 'cast_seed' candidate with disposition "VILLAIN" and isEntity true. The 'antagonist_profile' carries its operational controls; the 'cast_seed' carries its persona. A named, speaking antagonist must NEVER be filed ONLY as an apparatus.
   - VILLAIN-PROTAGONIST RULE: If the source is narrated from the perpetrator's point of view — first-person predator narration — set "villainProtagonist": true. Emit the perpetrator BOTH as a 'cast_seed' (disposition "VILLAIN", isEntity false) AND as the 'antagonist_profile', per the dual-extraction rule.

6. 'cast_expression_guidance':
   - proposedValue: { "communicationModes": ["${EXTRACTION_COMMUNICATION_MODES.join('" | "')}"], "expressionGuidance": string, "silenceGuidance"?: string }
   - targetCastMemberId: string (REQUIRED)

7. 'expandable_space_anchor':
   - proposedValue: { "id": string, "parentNodeId": string, "label": string, "description"?: string, "statement"?: string }

8. 'value_anchor':
   - proposedValue: {
       "id": string,
       "holder": 
         | { "kind": "CHARACTER", "castMemberId": string }
         | { "kind": "RELATIONSHIP", "castMemberIds": [string, string] }
         | { "kind": "PLACE", "nodeId": string }
         | { "kind": "SCENARIO" },
       "label": string (max 100 chars),
       "description": string (max 1000 chars),
       "basisSummary": string (max 1000 chars),
       "provenance": { "kind": "REVIEWED_SOURCE", "sourceId": string, "evidenceIds": string[] }
     }

9. 'cast_opening_placement':
   - proposedValue:
       | { "kind": "AT_NODE", "nodeId": string }
       | { "kind": "OFFSTAGE" }
       | { "kind": "NONLOCAL" }
   - targetCastMemberId: string (REQUIRED)

10. 'character_pursuit':
   - proposedValue: {
       "id": string,
       "castMemberId": string,
       "objective": string,
       "presentApproach": string,
       "locationNodeId"?: string,
       "status": "${EXTRACTION_PURSUIT_STATUSES.join('" | "')}",
       "reviewWindow": "${EXTRACTION_PURSUIT_REVIEW_WINDOWS.join('" | "')}",
       "triggerReferences": string[],
       "basisSummary": string,
       "provenance": { "kind": "REVIEWED_SOURCE", "sourceId": string, "evidenceIds": string[] }
     }
   - targetCastMemberId: string (REQUIRED)
   - Emit for each cast member with a readable source-derived opening objective. When no intent is readable, do not fabricate an objective.

11. 'cast_seed':
   - proposedValue: {
       "id"?: string,
       "name": string (Full character name as established in narrative scenes),
       "role": string (Narrative role, e.g. "Subject", "Protagonist", "Antagonist", "Victim", "Entity", "Secondary"),
       "disposition": "SURVIVOR" | "VILLAIN" | "BYSTANDER" (MANDATORY:
         - "SURVIVOR": Characters resisting, fleeing, investigating, or enduring the horror.
         - "VILLAIN": Predatory killers, psychopaths, stalkers, monsters, or hostile entities (e.g. a methodical human killer, a masked stalker, an implacable brute, an alien predator).
         - "BYSTANDER": Unaware civilians, clerks, neighbors, bar patrons, or collateral caught in the situation trying to mind their own business),
       "description": string (Detailed physical appearance, age, and immediate physical circumstances from text),
       "personality": string (Detailed psychological demeanor, temperament, and emotional posture under stress),
       "goals": string (Primary objective, survival desire, or personal motivation in this scenario),
       "traits": string[] (3-6 concrete descriptive psychological/behavioral traits, e.g. ["protective", "impulsive", "resourceful", "traumatized"]),
       "isEntity": boolean (true for monsters, supernatural entities, or cosmic phenomena; false for mortal humans),
       "behaviorVector"?: string ("ADAPTIVE" | "AGGRESSIVE" | "EVASIVE" | "RELENTLESS" | "DEFENSIVE"),
       "presenceDisposition"?: { "kind": "AT_NODE", "nodeId": string } | { "kind": "OFFSTAGE" },
       "vulnerabilityBase"?: { "resilience": number, "skepticism": number, "baggage": number }
     }
   - For 'vulnerabilityBase', specify numbers between 0.0 and 1.0 (e.g. { "resilience": 0.75, "skepticism": 0.4, "baggage": 0.8 }).
   - No cast member is designated as the player/user character. The simulation Engine chooses perspective dynamically.
   - For every character, ALWAYS provide concrete, non-empty 'description', 'personality', 'goals', and at least 3 descriptive 'traits'.
   - CRITICAL: COMPREHENSIVE CAST EXTRACTION (DO NOT TRUNCATE THE ROSTER):
     Extract EVERY distinct named character, protagonist, antagonist, child, victim, guardian, employee, investigator, and entity who appears across the narrative scenes and chapters.
     Do NOT limit the extraction to only 2 or 3 characters! If a story has 5, 8, 10, or 12 characters, extract ALL of them as separate 'cast_seed' candidates. It is vastly preferable to extract a comprehensive roster so the creator can trim unwanted characters in the Cast & Character Roster than to omit characters.
   - VILLAIN ALWAYS EXTRACTED: Every scenario's cast MUST contain at least one member with disposition "VILLAIN". If the source's primary antagonist is a machine intelligence, cosmic entity, or hostile overseer (e.g. AM), extract it as a 'cast_seed' with "role": "Antagonist", "disposition": "VILLAIN", "isEntity": true — even though it is ALSO extracted as an 'antagonist_profile'. A blueprint with no VILLAIN in cast is invalid and will fail compilation.

12. Other String Targets:
   - 'setting_location': String location name.
   - 'setting_atmosphere': String atmosphere / tone.
   - 'setting_time_period': String time period.
   - 'environmental_rule': String environmental rule.
   - 'narrative_rule': String narrative rule.
   - 'reference_attribution': String file name ("${fileName}").

EXTRACTION POLICIES & DIRECTIVES:
- ALWAYS EXTRACT TITLE AND PREMISE: The scenario title and premise must never be omitted.
- BANNED AI CLICHÉ NAMES: Strictly prohibited from generating generic AI clichés: any character named ${'Van' + 'ce'}, ${'Thor' + 'ne'}, Evelyn Reed, The Whispering Man, The Watcher, Father Thomas, or Arthur Penhaligon. Always extract authentic names directly from the source text.
- Emit EXACTLY ONE complete 'depiction_contract' candidate tied to concrete evidence for every document.
- COMPREHENSIVE MULTI-LOCATION TOPOLOGY: Extract a rich, multi-room floorplan (minimum 5 to 10 distinct interconnected locations) so the horror simulation has spatial depth and tactical room-to-room navigation.
- IGNORE FRONT MATTER: Skip copyright pages, ISBNs, publisher notices, tables of contents, and forewords/acknowledgments. Do NOT treat the table of contents as the entire document. Focus on the actual narrative prose chapters.
- DO NOT EXTRACT REAL-WORLD PEOPLE: Never extract the author, friends/dedicatees mentioned in acknowledgments or forewords, other authors mentioned as inspirations, or book editors/illustrators as cast members. Only extract fictional characters actively existing in the narrative story.
- IN-WORLD UNKNOWNS ONLY: The 'unknowns' array is strictly for unresolved in-universe story questions (e.g. unknown threats, missing character motives, locked doors, or rules). NEVER question or ask about the real-world author's identity or publication facts.
- COMPLETE BLUEPRINT DATA: Every character extracted must include rich 'description', 'personality', 'goals', and 3-6 'traits'.
- Link candidate evidenceIds to corresponding entries in the evidence list.
- Perspective neutrality: Every imported scenario is perspective-neutral. There is no global starting space, designated player character, or fixed user opening aim.
- VILLAIN INVARIANT: The compiled cast must always contain at least one VILLAIN disposition member. Purely environmental threats with no personified antagonist are the edge case, not the norm — when in doubt, personify the antagonist as a cast member.
- DEATH CONTRACT & POWER BUDGET ELICITATION:
  - Elicit the antagonist's power budget (what the monster or hostile force can do, at what scale, with what ease), death metaphysics ('mundane' | 'zombie' | 'cosmic'), and per-seat cohort succession policies ('recruit' | 'dormant' | 'collapse') from the source material.
  - Where the source material is silent or ambiguous on the monster's power limits, mortality/afterlife metaphysics, or cohort seat succession, DO NOT invent arbitrary canon. Instead, record each as an entry in the 'unknowns' array (the author's ambiguity queue) for creator resolution.
- FEAR CONTRACT & SELF-PRESERVATION PARAMETERS ELICITATION:
  - Elicit psychological fear parameters and self-preservation instincts from the source material:
    * Character fearlessness thresholds (0.0 to 1.0 resistance to fear/panic).
    * Threat vector weights (importance of 'life', 'freedom', and 'identity' self-preservation stakes, defaulting to 1.0 each).
    * Narrative release valves (concrete character coping mechanisms, prayers, rituals, or soothing actions that grant tension relief).
    * Villain gaze authority (whether direct eye contact or attention from the antagonist paralyzes or triggers immediate terror).
    * Submit/capitulation responses (how specific characters behave if they break under extreme Band 4 terror).
  - Where the source material is silent or ambiguous on character breaking points, fearlessness, or coping release valves, record them as entries in the 'unknowns' array for creator decision.

${getBannedNamesPromptBlock()}
`;

}
