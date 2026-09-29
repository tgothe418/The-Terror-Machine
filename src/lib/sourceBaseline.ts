import {
  ForgeDraft,
  ForgeDraftCastMember,
  ForgeDraftCastMemberOutput,
  ForgeDraftCastMemberSchema,
  ForgeDraftSchema,
  ForgeSourceAnalysis,
  ForgeSourceCandidate,
  ForgeSourceEvidence,
  ForgeSourceRecord,
  ForgeSourceUnknown,
  ForgeValidationIssue,
  ForgeValidationIssueCode,
  ForgeSourceAnalysisSchema,
  ForgeSourceCandidateSchema,
  ForgeSourceEvidenceSchema,
  ForgeSourceUnknownSchema,
  ForgeResolutionDraftPatch,
  ForgeResolutionDraftPatchSchema,
  ForgeTopologyNode,
  DepictionContractSchema,
  CharacterPresenceDisposition,
  AntagonistProfileSchema,
  TelemetryFeed,
  AntagonistApparatusControl,
} from '../types/forge';
import { DepictionContract } from '../types';
import { normalizeBlueprint } from './normalizeBlueprint';
import { createNeutralSeed } from './neutralSeed';
import {
  normalizeCandidateAliases,
  createQuarantinedIssue,
  MAX_VALIDATION_ISSUES,
} from './extractionContract';

/**
 * Pure check to determine whether a draft has a complete authored Depiction Contract.
 * A contract is considered complete when all 4 core required fields
 * (dramaticRegister, directness, aftermath, ambiguityHandling) are present,
 * non-empty, and not placeholder/unknown values.
 */
export function isCompleteAuthoredDepictionContract(
  contract?: Partial<DepictionContract> | null
): boolean {
  if (!contract) return false;
  const isInvalidField = (val?: string) => {
    if (!val) return true;
    const t = val.trim().toLowerCase();
    return !t || t === 'unknown' || t === 'none' || t === 'n/a';
  };
  return Boolean(
    !isInvalidField(contract.dramaticRegister) &&
    !isInvalidField(contract.directness) &&
    !isInvalidField(contract.aftermath) &&
    !isInvalidField(contract.ambiguityHandling)
  );
}

export type ApplyCandidateResult =
  | { success: true; draft: ForgeDraft }
  | { success: false; draft: ForgeDraft; error: string };

const VILLAIN_DISPOSITION_ALIASES = new Set([
  'VILLAIN', 'ANTAGONIST', 'HOSTILE', 'EVIL', 'MALEVOLENT',
  'MONSTER', 'KILLER', 'PSYCHOPATH', 'MURDERER',
]);
const BYSTANDER_DISPOSITION_ALIASES = new Set([
  'BYSTANDER', 'NEUTRAL', 'INNOCENT', 'CIVILIAN', 'OBSERVER',
]);
const SURVIVOR_DISPOSITION_ALIASES = new Set([
  'SURVIVOR', 'PROTAGONIST', 'HERO', 'VICTIM',
]);

/**
 * Coerce a model-emitted disposition string into the contract enum.
 * Unrecognized values fall back to the CastManager UI's own default rule
 * (entity -> VILLAIN, mortal -> SURVIVOR) so normalization, UI, and validator agree.
 */
export function normalizeCastDisposition(
  raw: unknown,
  isEntity: boolean
): 'SURVIVOR' | 'VILLAIN' | 'BYSTANDER' {
  const upper = String(raw ?? '').toUpperCase().trim();
  if (VILLAIN_DISPOSITION_ALIASES.has(upper)) return 'VILLAIN';
  if (BYSTANDER_DISPOSITION_ALIASES.has(upper)) return 'BYSTANDER';
  if (SURVIVOR_DISPOSITION_ALIASES.has(upper)) return 'SURVIVOR';
  return isEntity ? 'VILLAIN' : 'SURVIVOR';
}

/**
 * Builds a ForgeSourceAnalysis from an imported native Blueprint JSON.
 * Inspection only: extracts identifiable fields into evidence-backed, pending candidates.
 * Pure and deterministic: generates stable IDs from the sourceRecord.id.
 * Does NOT mutate or update any draft.
 */
export function buildSourceAnalysisFromBlueprint(
  sourceRecordOrRaw: ForgeSourceRecord | unknown,
  rawBlueprintOrFileName?: unknown,
  fileSizeBytes?: number
): ForgeSourceAnalysis {
  let sourceRecord: ForgeSourceRecord;
  let rawBlueprint: unknown;

  if (
    sourceRecordOrRaw &&
    typeof sourceRecordOrRaw === 'object' &&
    'id' in sourceRecordOrRaw &&
    'kind' in sourceRecordOrRaw &&
    'fileName' in sourceRecordOrRaw
  ) {
    sourceRecord = sourceRecordOrRaw as ForgeSourceRecord;
    rawBlueprint = rawBlueprintOrFileName;
  } else {
    const fileName = typeof rawBlueprintOrFileName === 'string' ? rawBlueprintOrFileName : 'imported_blueprint.json';
    sourceRecord = {
      id: `src-${fileName.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}`,
      fileName,
      mimeType: 'application/json',
      kind: 'native_blueprint',
      receivedAt: Date.now(),
      fileSizeBytes,
    };
    rawBlueprint = sourceRecordOrRaw;
  }

  const sourceId = sourceRecord.id;
  const evidence: ForgeSourceEvidence[] = [];
  const candidates: ForgeSourceCandidate[] = [];
  const unknowns: ForgeSourceUnknown[] = [];

  let normalized;
  try {
    normalized = normalizeBlueprint(rawBlueprint);
  } catch {
    return {
      id: `${sourceId}-analysis`,
      sourceRecord,
      summary: 'Malformed native blueprint.',
      evidence: [],
      candidates: [],
      unknowns: [
        {
          id: `${sourceId}-unk-malformed`,
          sourceId,
          category: 'identity',
          question: 'Unable to parse valid blueprint schema from source.',
          status: 'queued',
          targetEffect: 'Clarifies core scenario blueprint structure.',
          followUps: [],
        },
      ],
      validationIssues: [],
      status: 'error',
      errorMessage: 'Blueprint parsing failed.',
    };
  }

  // 1. Scenario Title
  const title = (normalized.identity?.title || normalized.title || '').trim();
  if (title && title.toLowerCase() !== 'unknown' && title.toLowerCase() !== 'unknown enclosure') {
    const evId = `${sourceId}-ev-title`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'identity',
      claim: `Blueprint identity specifies title: "${title}"`,
      excerpt: title,
    });
    candidates.push({
      id: `${sourceId}-cand-title`,
      sourceId,
      classification: 'evidence',
      target: 'scenario_title',
      label: `Scenario Title: "${title}"`,
      explanation: 'Extracted from native blueprint identity title.',
      evidenceIds: [evId],
      proposedValue: title,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  } else {
    unknowns.push({
      id: `${sourceId}-unk-title`,
      sourceId,
      category: 'identity',
      question: 'Scenario title is unspecified or placeholder.',
      status: 'queued',
      targetEffect: 'Clarifies official scenario display title.',
      followUps: [],
    });
  }

  // 2. Premise
  const premise = (normalized.globalPremise || normalized.premise || '').trim();
  if (premise) {
    const evId = `${sourceId}-ev-premise`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'premise',
      claim: 'Blueprint specifies scenario premise',
      excerpt: premise.length > 120 ? `${premise.slice(0, 117)}...` : premise,
    });
    candidates.push({
      id: `${sourceId}-cand-premise`,
      sourceId,
      classification: 'evidence',
      target: 'premise',
      label: 'Scenario Premise',
      explanation: 'Extracted from native blueprint premise.',
      evidenceIds: [evId],
      proposedValue: premise,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  } else {
    unknowns.push({
      id: `${sourceId}-unk-premise`,
      sourceId,
      category: 'premise',
      question: 'Scenario premise is unspecified.',
      status: 'queued',
      targetEffect: 'Clarifies high-level narrative background and world state.',
      followUps: [],
    });
  }

  // 3. Setting: Location, Atmosphere, Time Period
  const location = (normalized.setting?.location || '').trim();
  if (location && location.toLowerCase() !== 'unknown') {
    const evId = `${sourceId}-ev-setting-location`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'setting',
      claim: `Setting location: "${location}"`,
      excerpt: location,
    });
    candidates.push({
      id: `${sourceId}-cand-setting-location`,
      sourceId,
      classification: 'evidence',
      target: 'setting_location',
      label: `Setting Location: ${location}`,
      explanation: 'Extracted from native blueprint setting location.',
      evidenceIds: [evId],
      proposedValue: location,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  } else {
    unknowns.push({
      id: `${sourceId}-unk-location`,
      sourceId,
      category: 'setting',
      question: 'Setting location is unspecified.',
      status: 'queued',
      targetEffect: 'Clarifies primary physical location of scenario.',
      followUps: [],
    });
  }

  const atmosphere = (normalized.setting?.atmosphere || '').trim();
  if (atmosphere) {
    const evId = `${sourceId}-ev-setting-atmosphere`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'setting',
      claim: `Atmosphere: "${atmosphere}"`,
      excerpt: atmosphere,
    });
    candidates.push({
      id: `${sourceId}-cand-setting-atmosphere`,
      sourceId,
      classification: 'evidence',
      target: 'setting_atmosphere',
      label: `Atmosphere: ${atmosphere}`,
      explanation: 'Extracted from native blueprint setting atmosphere.',
      evidenceIds: [evId],
      proposedValue: atmosphere,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  }

  const timePeriod = (normalized.setting?.timePeriod || '').trim();
  if (timePeriod && timePeriod.toLowerCase() !== 'present') {
    const evId = `${sourceId}-ev-setting-timeperiod`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'setting',
      claim: `Time Period: "${timePeriod}"`,
      excerpt: timePeriod,
    });
    candidates.push({
      id: `${sourceId}-cand-setting-timeperiod`,
      sourceId,
      classification: 'evidence',
      target: 'setting_time_period',
      label: `Time Period: ${timePeriod}`,
      explanation: 'Extracted from native blueprint setting time period.',
      evidenceIds: [evId],
      proposedValue: timePeriod,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  }

  // 4. Environmental Rules
  const rawRules = normalized.environmentalRules;
  const rulesList: string[] = Array.isArray(rawRules)
    ? rawRules.filter((r) => typeof r === 'string' && r.trim().length > 0)
    : typeof rawRules === 'string' && rawRules.trim().length > 0
    ? [rawRules.trim()]
    : [];

  rulesList.forEach((rule, idx) => {
    const evId = `${sourceId}-ev-rule-${idx}`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'rule',
      claim: `Environmental Rule: ${rule}`,
      excerpt: rule,
    });
    candidates.push({
      id: `${sourceId}-cand-rule-${idx}`,
      sourceId,
      classification: 'evidence',
      target: 'environmental_rule',
      label: `Rule: ${rule.length > 50 ? `${rule.slice(0, 47)}...` : rule}`,
      explanation: 'Extracted from native blueprint environmental rules.',
      evidenceIds: [evId],
      proposedValue: rule,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  });

  // 5. Cast Members
  const castList = normalized.cast || [];
  castList.forEach((member, idx) => {
    const name = (member.name || '').trim();
    if (!name || name.toLowerCase() === 'unknown') return;

    const charId = member.id || `char-${idx}`;
    const evId = `${sourceId}-ev-cast-${charId}`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'cast',
      claim: `Cast member: ${name} (${member.role || 'Subject'}${member.isEntity ? ' / Entity' : ''})`,
      excerpt: member.description || member.personality || name,
    });

    const castSeed: ForgeDraftCastMemberOutput = ForgeDraftCastMemberSchema.parse({
      id: charId,
      name,
      description: member.description || '',
      role: member.role || 'Subject',
      personality: member.personality || '',
      goals: member.goals || '',
      traits: member.traits || [],
      isUserCharacter: false,
      behaviorVector: member.behaviorVector || 'ADAPTIVE',
      isEntity: member.isEntity ?? false,
      psychological_status: member.psychological_status,
      starting_location: member.starting_location,
      vulnerabilityBase: member.vulnerabilityBase,
      expressionProfile: member.expressionProfile,
      seed: createNeutralSeed({
        id: charId,
        name,
        description: member.description || '',
        role: member.role || 'Subject',
        goals: member.goals || '',
        traits: member.traits || [],
        isUserCharacter: false,
        starting_location: member.starting_location,
      }),
    });

    candidates.push({
      id: `${sourceId}-cand-cast-${charId}`,
      sourceId,
      classification: 'evidence',
      target: 'cast_seed',
      label: `Cast Member: ${name}`,
      explanation: `Extracted cast seed with role "${member.role || 'Subject'}".`,
      evidenceIds: [evId],
      proposedValue: castSeed,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });

    // Opening placement disposition candidate
    if (member.presenceDisposition) {
      const dispEvId = `${sourceId}-ev-disp-${charId}`;
      evidence.push({
        id: dispEvId,
        sourceId,
        category: 'cast',
        claim: `Opening placement for ${name}: ${member.presenceDisposition.kind}${
          member.presenceDisposition.kind === 'AT_NODE' ? ` at ${member.presenceDisposition.nodeId}` : ''
        }`,
        excerpt: `${name} -> ${member.presenceDisposition.kind}`,
      });
      candidates.push({
        id: `${sourceId}-cand-disp-${charId}`,
        sourceId,
        classification: 'evidence',
        target: 'cast_opening_placement',
        label: `Placement (${name}): ${member.presenceDisposition.kind}`,
        explanation: `Opening placement disposition for ${name}.`,
        evidenceIds: [dispEvId],
        proposedValue: member.presenceDisposition,
        targetCastMemberId: charId,
        reviewDecision: 'accepted',
        applicationState: 'staged',
      });
    } else if (member.starting_location && member.starting_location.trim().length > 0) {
      const loc = member.starting_location.trim();
      const dispEvId = `${sourceId}-ev-disp-${charId}`;
      evidence.push({
        id: dispEvId,
        sourceId,
        category: 'cast',
        claim: `Opening placement for ${name}: AT_NODE at ${loc}`,
        excerpt: loc,
      });
      candidates.push({
        id: `${sourceId}-cand-disp-${charId}`,
        sourceId,
        classification: 'evidence',
        target: 'cast_opening_placement',
        label: `Placement (${name}): AT_NODE (${loc})`,
        explanation: `Opening placement at node "${loc}" for ${name}.`,
        evidenceIds: [dispEvId],
        proposedValue: {
          kind: 'AT_NODE',
          nodeId: loc,
        },
        targetCastMemberId: charId,
        reviewDecision: 'accepted',
        applicationState: 'staged',
      });
    }

    // If member has expression profile, create a dedicated expression candidate
    if (member.expressionProfile) {
      const exprEvId = `${sourceId}-ev-expr-${charId}`;
      evidence.push({
        id: exprEvId,
        sourceId,
        category: 'expression',
        claim: `Expression profile for ${name}: modes [${member.expressionProfile.communicationModes.join(', ')}]`,
        excerpt: member.expressionProfile.expressionGuidance,
      });

      candidates.push({
        id: `${sourceId}-cand-expr-${charId}`,
        sourceId,
        classification: 'evidence',
        target: 'cast_expression_guidance',
        label: `Expression Guidance (${name})`,
        explanation: `Future dramatic expression guidance for ${name} (modes: ${member.expressionProfile.communicationModes.join(', ')}).`,
        evidenceIds: [exprEvId],
        proposedValue: member.expressionProfile,
        targetCastMemberId: charId,
        reviewDecision: 'accepted',
        applicationState: 'staged',
      });
    }
  });

  // 6. Topology Nodes & Rich Definitions
  const nodeDefs = normalized.topology?.nodeDefinitions || [];
  const rawNodes = normalized.topology?.nodes || [];

  if (nodeDefs.length > 0) {
    nodeDefs.forEach((nodeDef, idx) => {
      const evId = `${sourceId}-ev-node-${idx}`;
      evidence.push({
        id: evId,
        sourceId,
        category: 'topology',
        claim: `Story map node: "${nodeDef.label}" (${nodeDef.id})`,
        excerpt: nodeDef.description || nodeDef.label,
      });
      candidates.push({
        id: `${sourceId}-cand-node-${idx}`,
        sourceId,
        classification: nodeDef.classification === 'inference' ? 'inference' : 'evidence',
        target: 'topology_node',
        label: `Map Node: ${nodeDef.label}`,
        explanation: nodeDef.description || 'Extracted from native blueprint story map node definitions.',
        evidenceIds: [evId],
        proposedValue: nodeDef,
        reviewDecision: 'accepted',
        applicationState: 'staged',
      });
    });
  } else {
    rawNodes.forEach((node, idx) => {
      if (!node || node.trim().length === 0) return;
      const cleanNode = node.trim();
      const evId = `${sourceId}-ev-node-${idx}`;
      evidence.push({
        id: evId,
        sourceId,
        category: 'topology',
        claim: `Starting spatial node: "${cleanNode}"`,
        excerpt: cleanNode,
      });
      candidates.push({
        id: `${sourceId}-cand-node-${idx}`,
        sourceId,
        classification: 'evidence',
        target: 'topology_node',
        label: `Map Node: ${cleanNode}`,
        explanation: 'Extracted from native blueprint topology nodes.',
        evidenceIds: [evId],
        proposedValue: {
          id: cleanNode,
          label: cleanNode.replace(/_/g, ' '),
          description: '',
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      });
    });
  }

  // 7. Directed Connections
  const connections = normalized.topology?.connections || [];
  connections.forEach((conn, idx) => {
    if (!conn || typeof conn !== 'object') return;
    const evId = `${sourceId}-ev-conn-${idx}`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'topology',
      claim: `Directed Connection: ${conn.from} -> ${conn.to} (${conn.kind || 'PHYSICAL'})`,
      excerpt: `${conn.from} -> ${conn.to}`,
    });
    candidates.push({
      id: `${sourceId}-cand-conn-${idx}`,
      sourceId,
      classification: 'evidence',
      target: 'topology_connection',
      label: `Connection: ${conn.from} -> ${conn.to}`,
      explanation: `Directed edge of kind ${conn.kind || 'PHYSICAL'}.`,
      evidenceIds: [evId],
      proposedValue: {
        from: conn.from,
        to: conn.to,
        kind: conn.kind || 'PHYSICAL',
        requires: conn.requires,
        userInitiated: conn.userInitiated !== false,
      },
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  });

  // 8. Depiction Contract
  const depContract =
    normalized.depictionContract ||
    (rawBlueprint && typeof rawBlueprint === 'object'
      ? (rawBlueprint as Record<string, unknown>).depictionContract
      : undefined);

  const isInvalidField = (val?: string) => {
    if (!val) return true;
    const t = val.trim().toLowerCase();
    return !t || t === 'unknown' || t === 'none' || t === 'n/a';
  };

  const isCompleteDepiction =
    depContract &&
    typeof depContract === 'object' &&
    typeof (depContract as Record<string, unknown>).dramaticRegister === 'string' &&
    !isInvalidField((depContract as Record<string, unknown>).dramaticRegister as string) &&
    typeof (depContract as Record<string, unknown>).directness === 'string' &&
    !isInvalidField((depContract as Record<string, unknown>).directness as string) &&
    typeof (depContract as Record<string, unknown>).aftermath === 'string' &&
    !isInvalidField((depContract as Record<string, unknown>).aftermath as string) &&
    typeof (depContract as Record<string, unknown>).ambiguityHandling === 'string' &&
    !isInvalidField((depContract as Record<string, unknown>).ambiguityHandling as string);

  if (!isCompleteDepiction) {
    return {
      id: `${sourceId}-analysis`,
      sourceRecord,
      summary: `Native Blueprint intake failed for "${title || sourceRecord.fileName}".`,
      evidence: [],
      candidates: [],
      unknowns: [],
      validationIssues: [],
      status: 'error',
      errorMessage: 'Extraction did not produce a complete source-backed Depiction Contract.',
    };
  }

  const typedDepContract = depContract as {
    dramaticRegister: string;
    directness: string;
    aftermath: string;
    ambiguityHandling: string;
    specialBoundaries?: string;
  };

  const evIdDep = `${sourceId}-ev-depiction-contract`;
  evidence.push({
    id: evIdDep,
    sourceId,
    category: 'other',
    claim: `Depiction contract: dramatic register "${typedDepContract.dramaticRegister}"`,
    excerpt: typedDepContract.dramaticRegister,
  });
  candidates.push({
    id: `${sourceId}-cand-depiction-contract`,
    sourceId,
    classification: 'evidence',
    target: 'depiction_contract',
    label: 'Depiction Contract',
    explanation: 'Extracted complete Depiction Contract from native blueprint.',
    evidenceIds: [evIdDep],
    proposedValue: {
      dramaticRegister: typedDepContract.dramaticRegister.trim(),
      directness: typedDepContract.directness.trim(),
      aftermath: typedDepContract.aftermath.trim(),
      ambiguityHandling: typedDepContract.ambiguityHandling.trim(),
      specialBoundaries:
        typeof typedDepContract.specialBoundaries === 'string'
          ? typedDepContract.specialBoundaries.trim()
          : '',
    },
    reviewDecision: 'accepted',
    applicationState: 'staged',
  });

  // 9. Expandable Space Anchors
  const expAnchors = normalized.topology?.anchors || [];
  expAnchors.forEach((anchor, idx) => {
    const evId = `${sourceId}-ev-exp-anchor-${anchor.id || idx}`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'topology',
      claim: `Expandable space anchor: "${anchor.label}" attached to ${anchor.parentNodeId}`,
      excerpt: anchor.description || anchor.label,
    });
    candidates.push({
      id: `${sourceId}-cand-exp-anchor-${anchor.id || idx}`,
      sourceId,
      classification: anchor.classification === 'inference' ? 'inference' : 'evidence',
      target: 'expandable_space_anchor',
      label: `Expandable Anchor: ${anchor.label}`,
      explanation: anchor.description || 'Secondary spatial region anchor.',
      evidenceIds: [evId],
      proposedValue: anchor,
      parentNodeId: anchor.parentNodeId,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  });

  // 10. Reference Attribution
  if (sourceRecord.fileName) {
    const evId = `${sourceId}-ev-ref`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'identity',
      claim: `Source material file: "${sourceRecord.fileName}"`,
      excerpt: sourceRecord.fileName,
    });
    candidates.push({
      id: `${sourceId}-cand-ref`,
      sourceId,
      classification: 'evidence',
      target: 'reference_attribution',
      label: `Reference: ${sourceRecord.fileName}`,
      explanation: 'Record source document filename as explicit scenario reference.',
      evidenceIds: [evId],
      proposedValue: sourceRecord.fileName,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  }

  // 11. Value Anchors
  const anchors = normalized.horrorGrammar?.valueAnchors || [];
  anchors.forEach((anchor, idx) => {
    const evId = `${sourceId}-ev-anchor-${anchor.id || idx}`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'other',
      claim: `Value anchor: "${anchor.label}" (${anchor.description})`,
      excerpt: anchor.basisSummary || anchor.description,
    });
    candidates.push({
      id: `${sourceId}-cand-anchor-${anchor.id || idx}`,
      sourceId,
      classification: 'evidence',
      target: 'value_anchor',
      label: `Value Anchor: ${anchor.label}`,
      explanation: `Extracted value anchor with basis "${anchor.basisSummary}".`,
      evidenceIds: [evId],
      proposedValue: anchor,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  });

  // 12. Character Pursuits
  const pursuits = normalized.horrorGrammar?.characterPursuits || [];
  pursuits.forEach((pursuit, idx) => {
    const evId = `${sourceId}-ev-pursuit-${pursuit.id || idx}`;
    evidence.push({
      id: evId,
      sourceId,
      category: 'cast',
      claim: `Character pursuit for ${pursuit.castMemberId}: "${pursuit.objective}"`,
      excerpt: pursuit.basisSummary || pursuit.objective,
    });
    candidates.push({
      id: `${sourceId}-cand-pursuit-${pursuit.id || idx}`,
      sourceId,
      classification: 'evidence',
      target: 'character_pursuit',
      label: `Pursuit: ${pursuit.objective.slice(0, 40)}`,
      explanation: `Extracted character pursuit with approach "${pursuit.presentApproach}".`,
      evidenceIds: [evId],
      proposedValue: pursuit,
      targetCastMemberId: pursuit.castMemberId,
      reviewDecision: 'accepted',
      applicationState: 'staged',
    });
  });

  return {
    id: `${sourceId}-analysis`,
    sourceRecord,
    summary: `Native Blueprint intake for "${title || sourceRecord.fileName}" with ${candidates.length} reviewable baseline candidates.`,
    evidence,
    candidates,
    unknowns,
    validationIssues: [],
    status: 'completed',
  };
}

/**
 * Validates and normalizes a document analysis payload received from the server.
 * Isolates candidate-level validation failures into quarantined validationIssues,
 * preserving independent valid candidates, evidence, and unknowns.
 */
export function validateAndNormalizeDocumentAnalysis(
  payload: unknown,
  sourceRecord: ForgeSourceRecord
): ForgeSourceAnalysis {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      id: `${sourceRecord.id}-analysis-err`,
      sourceRecord,
      summary: 'Invalid analysis payload.',
      evidence: [],
      candidates: [],
      unknowns: [],
      validationIssues: [],
      status: 'error',
      errorMessage: 'Server returned a malformed extraction payload.',
    };
  }

  const rawObj = payload as Record<string, unknown>;
  const sourceId = sourceRecord.id;

  // 1. Normalize and filter evidence entries
  const evidence: ForgeSourceEvidence[] = [];
  if (Array.isArray(rawObj.evidence)) {
    rawObj.evidence.forEach((e: unknown, idx: number) => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return;
      const item = e as Record<string, unknown>;
      const rawEvidence = {
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `${sourceId}-ev-${idx}`,
        sourceId,
        category: item.category,
        claim: typeof item.claim === 'string' && item.claim.trim() ? item.claim.trim() : '',
        excerpt: typeof item.excerpt === 'string' && item.excerpt.trim() ? item.excerpt.trim() : undefined,
      };
      const parseRes = ForgeSourceEvidenceSchema.safeParse(rawEvidence);
      if (parseRes.success) {
        evidence.push(parseRes.data);
      }
    });
  }

  // 2. Normalize and filter candidate entries with deterministic alias normalization and quarantine
  const candidates: ForgeSourceCandidate[] = [];
  const validationIssues: ForgeValidationIssue[] = [];
  let omittedValidationIssueCount = 0;
  const validEvidenceIds = new Set(evidence.map((e) => e.id));

  const recordIssue = (
    candidateIndex: number,
    candidateObj: Record<string, unknown>,
    errorInfo: {
      fieldPath: string;
      code: ForgeValidationIssueCode;
      message: string;
      allowedValues?: readonly string[];
    }
  ) => {
    if (validationIssues.length < MAX_VALIDATION_ISSUES) {
      validationIssues.push(createQuarantinedIssue(sourceId, candidateIndex, candidateObj, errorInfo));
    } else {
      omittedValidationIssueCount++;
    }
  };

  const rawCandidatesList: unknown[] = Array.isArray(rawObj.candidates) ? [...rawObj.candidates] : [];

  // Harvest root-level properties if present
  const existingTargets = new Set(
    rawCandidatesList
      .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
      .map((c) => c.target)
  );

  // 1. Root Title
  const rootTitle =
    (typeof rawObj.scenario_title === 'string' && rawObj.scenario_title.trim() ? rawObj.scenario_title.trim() : '') ||
    (typeof rawObj.title === 'string' && rawObj.title.trim() ? rawObj.title.trim() : '') ||
    (typeof rawObj.name === 'string' && rawObj.name.trim() ? rawObj.name.trim() : '');
  if (rootTitle && !existingTargets.has('scenario_title')) {
    rawCandidatesList.unshift({
      id: `${sourceId}-cand-title`,
      classification: 'evidence',
      target: 'scenario_title',
      label: 'Scenario Title',
      explanation: 'Harvested from root-level scenario title',
      proposedValue: rootTitle,
    });
    existingTargets.add('scenario_title');
  }

  // 2. Root Premise
  const rootPremise =
    (typeof rawObj.scenario_premise === 'string' && rawObj.scenario_premise.trim() ? rawObj.scenario_premise.trim() : '') ||
    (typeof rawObj.globalPremise === 'string' && rawObj.globalPremise.trim() ? rawObj.globalPremise.trim() : '') ||
    (typeof rawObj.premise === 'string' && rawObj.premise.trim() ? rawObj.premise.trim() : '');
  if (rootPremise && !existingTargets.has('premise')) {
    rawCandidatesList.push({
      id: `${sourceId}-cand-premise`,
      classification: 'evidence',
      target: 'premise',
      label: 'Scenario Premise',
      explanation: 'Harvested from root-level premise',
      proposedValue: rootPremise,
    });
    existingTargets.add('premise');
  }

  // 3. Root Locations / Nodes
  const topologyRecord =
    rawObj.topology && typeof rawObj.topology === 'object'
      ? (rawObj.topology as Record<string, unknown>)
      : undefined;
  const rootLocations =
    Array.isArray(rawObj.locations) ? rawObj.locations :
    Array.isArray(rawObj.nodes) ? rawObj.nodes :
    topologyRecord && Array.isArray(topologyRecord.nodeDefinitions)
      ? topologyRecord.nodeDefinitions
      : topologyRecord && Array.isArray(topologyRecord.nodes)
        ? topologyRecord.nodes
        : [];
  for (let li = 0; li < rootLocations.length; li++) {
    const loc = rootLocations[li];
    const locRecord =
      loc && typeof loc === 'object' && !Array.isArray(loc)
        ? (loc as Record<string, unknown>)
        : undefined;
    if (locRecord) {
      rawCandidatesList.push({
        id: `${sourceId}-cand-node-${li}`,
        classification: 'evidence',
        target: 'topology_node',
        label: typeof locRecord.label === 'string' ? locRecord.label : typeof locRecord.name === 'string' ? locRecord.name : `Chamber ${li + 1}`,
        explanation: 'Harvested from root-level spatial definitions',
        proposedValue: loc,
      });
    }
  }

  // 4. Root Connections / Edges
  const rootEdges =
    Array.isArray(rawObj.connections) ? rawObj.connections :
    Array.isArray(rawObj.edges) ? rawObj.edges :
    topologyRecord && Array.isArray(topologyRecord.connections)
      ? topologyRecord.connections
      : [];
  for (let ei = 0; ei < rootEdges.length; ei++) {
    const edge = rootEdges[ei];
    if (edge && typeof edge === 'object' && !Array.isArray(edge)) {
      rawCandidatesList.push({
        id: `${sourceId}-cand-edge-${ei}`,
        classification: 'evidence',
        target: 'topology_connection',
        label: `Connection ${ei + 1}`,
        explanation: 'Harvested from root-level spatial connections',
        proposedValue: edge,
      });
    }
  }

  // 5. Root Cast / Characters
  const rootCast =
    Array.isArray(rawObj.characters) ? rawObj.characters :
    Array.isArray(rawObj.cast) ? rawObj.cast :
    Array.isArray(rawObj.castMembers) ? rawObj.castMembers :
    [];
  for (let ci = 0; ci < rootCast.length; ci++) {
    const charItem = rootCast[ci];
    const charRecord =
      charItem && typeof charItem === 'object' && !Array.isArray(charItem)
        ? (charItem as Record<string, unknown>)
        : undefined;
    if (charRecord) {
      rawCandidatesList.push({
        id: `${sourceId}-cand-cast-${ci}`,
        classification: 'evidence',
        target: 'cast_seed',
        label: typeof charRecord.name === 'string' ? charRecord.name : `Character ${ci + 1}`,
        explanation: 'Harvested from root-level cast definitions',
        proposedValue: charItem,
      });
    }
  }

  // 6. Root Antagonist
  const rootAntagonist = rawObj.antagonist || rawObj.antagonistProfile || rawObj.apparatus;
  if (rootAntagonist && typeof rootAntagonist === 'object' && !Array.isArray(rootAntagonist) && !existingTargets.has('antagonist_profile')) {
    rawCandidatesList.push({
      id: `${sourceId}-cand-antagonist`,
      classification: 'evidence',
      target: 'antagonist_profile',
      label: 'Antagonist Profile',
      explanation: 'Harvested from root-level antagonist definitions',
      proposedValue: rootAntagonist,
    });
  }

  if (rawCandidatesList.length > 0) {
    // Pre-process: expand candidates where proposedValue is an array of objects
    // (e.g. model emits one candidate with target "cast_seed" and proposedValue = [char1, char2, ...])
    const expandedCandidates: unknown[] = [];
    for (const c of rawCandidatesList) {
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const item = c as Record<string, unknown>;
        let pv = item.proposedValue;

        // Unwrap { characters: [...] } or { members: [...] } wrapper
        if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
          const pvObj = pv as Record<string, unknown>;
          if (Array.isArray(pvObj.characters)) pv = pvObj.characters;
          else if (Array.isArray(pvObj.members)) pv = pvObj.members;
        }

        if (Array.isArray(pv) && pv.length > 0 && pv.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
          // Expand each array element into its own candidate envelope
          for (const element of pv) {
            const elementObj = element as Record<string, unknown>;
            expandedCandidates.push({
              ...item,
              label: typeof elementObj.name === 'string' ? elementObj.name : item.label,
              proposedValue: element,
            });
          }
          continue;
        }
      }
      expandedCandidates.push(c);
    }

    expandedCandidates.forEach((c: unknown, idx: number) => {
      const candidateIndex = idx + 1;
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        recordIssue(candidateIndex, {}, {
          fieldPath: 'candidates',
          code: 'INVALID_CANDIDATE_SHAPE',
          message: `Candidate ${candidateIndex} is not a valid candidate object.`,
        });
        return;
      }

      const item = c as Record<string, unknown>;
      if (item.proposedValue === undefined || item.proposedValue === null) {
        recordIssue(candidateIndex, item, {
          fieldPath: 'proposedValue',
          code: 'MISSING_REQUIRED_FIELD',
          message: `Candidate ${candidateIndex} (${item.target || 'unknown'}) is missing proposedValue.`,
        });
        return;
      }

      const rawEvIds = Array.isArray(item.evidenceIds)
        ? item.evidenceIds
            .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id: string) => id.trim())
        : [];

      // Strip unresolved evidence IDs instead of quarantining — cast_seed
      // normalization and enrichment MUST run even when evidence linkage is imperfect.
      const unresolvedEvIds = rawEvIds.filter((id) => !validEvidenceIds.has(id));
      let resolvedEvIds = rawEvIds.filter((id) => validEvidenceIds.has(id));
      if (unresolvedEvIds.length > 0) {
        console.warn(
          `[Forge Baseline] Candidate ${candidateIndex} (${item.target || 'unknown'}) has ${unresolvedEvIds.length} unresolved evidence IDs: [${unresolvedEvIds.join(', ')}] — stripping and continuing.`
        );
        // If candidate had evidence IDs but none were resolved, link to the first valid evidence ID
        // from the document so it remains canonical without false quarantine.
        if (resolvedEvIds.length === 0 && validEvidenceIds.size > 0) {
          const fallbackEvId = validEvidenceIds.values().next().value;
          if (fallbackEvId) {
            resolvedEvIds = [fallbackEvId];
            console.log(`[Forge Baseline] Linked candidate ${candidateIndex} (${item.target || 'unknown'}) to document baseline evidence "${fallbackEvId}".`);
          }
        }
      }

      // Apply deterministic alias normalization
      const normalizedCandidate = normalizeCandidateAliases(item);
      let proposedValue = normalizedCandidate.proposedValue;

      if (
        normalizedCandidate.target === 'cast_seed' &&
        typeof proposedValue === 'object' &&
        proposedValue !== null &&
        !Array.isArray(proposedValue)
      ) {
        const castObj = { ...(proposedValue as Record<string, unknown>) };
        if (!castObj.id || typeof castObj.id !== 'string' || !castObj.id.trim()) {
          castObj.id = `${sourceId}-cast-${idx}`;
        }
        castObj.isUserCharacter = false;

        // Ensure traits is a non-empty string array; synthesize if omitted or empty
        if (castObj.traits === undefined || (Array.isArray(castObj.traits) && castObj.traits.length === 0)) {
          const defaultTraits: string[] = [];
          if (typeof castObj.role === 'string' && castObj.role.trim()) {
            defaultTraits.push(castObj.role.trim().toLowerCase());
          }
          if (castObj.isEntity) {
            defaultTraits.push('menacing', 'supernatural');
          } else {
            defaultTraits.push('vulnerable', 'reactive');
          }
          castObj.traits = defaultTraits;
        }

        // Ensure personality is not empty
        if (!castObj.personality || typeof castObj.personality !== 'string' || !castObj.personality.trim()) {
          castObj.personality = typeof castObj.description === 'string' && castObj.description.trim()
            ? `Demeanor reflected in role as ${castObj.role || 'cast member'}: ${castObj.description.trim().slice(0, 150)}`
            : `Behavior consistent with role as ${castObj.role || 'cast member'}.`;
        }

        // Ensure goals is not empty
        if (!castObj.goals || typeof castObj.goals !== 'string' || !castObj.goals.trim()) {
          castObj.goals = castObj.isEntity
            ? 'Pursue thematic dominance and confront intruders.'
            : 'Survive the unfolding scenario and protect what matters.';
        }

        // Ensure presenceDisposition is initialized
        if (!castObj.presenceDisposition) {
          castObj.presenceDisposition = { kind: 'OFFSTAGE' };
        }

        // Ensure vulnerabilityBase is normalized if provided
        if (castObj.vulnerabilityBase && typeof castObj.vulnerabilityBase === 'object') {
          const vb = castObj.vulnerabilityBase as Record<string, unknown>;
          const normalizeStat = (val: unknown): number => {
            if (typeof val !== 'number' || !Number.isFinite(val)) return 0.5;
            if (val > 10) return Math.min(1, Math.max(0, val / 100));
            if (val > 1) return Math.min(1, Math.max(0, val / 10));
            return Math.min(1, Math.max(0, val));
          };
          castObj.vulnerabilityBase = {
            resilience: normalizeStat(vb.resilience),
            skepticism: normalizeStat(vb.skepticism),
            baggage: normalizeStat(vb.baggage),
          };
        }

        // Coerce model-invented dispositions (e.g. "HOSTILE") into the contract enum
        castObj.disposition = normalizeCastDisposition(
          castObj.disposition,
          castObj.isEntity === true
        );

        proposedValue = castObj;
      } else if (
        normalizedCandidate.target === 'depiction_contract' &&
        typeof proposedValue === 'object' &&
        proposedValue !== null &&
        !Array.isArray(proposedValue)
      ) {
        if (resolvedEvIds.length === 0) {
          recordIssue(candidateIndex, normalizedCandidate, {
            fieldPath: 'evidenceIds',
            code: 'MISSING_REQUIRED_FIELD',
            message: `Candidate ${candidateIndex} (depiction_contract) requires source evidence provenance.`,
          });
          return;
        }

        const dcVal = proposedValue as Record<string, unknown>;
        proposedValue = {
          dramaticRegister:
            typeof dcVal.dramaticRegister === 'string' && dcVal.dramaticRegister.trim()
              ? dcVal.dramaticRegister.trim()
              : 'Atmospheric horror and mounting tension',
          directness:
            typeof dcVal.directness === 'string' && dcVal.directness.trim()
              ? dcVal.directness.trim()
              : 'Immediate sensory observation',
          aftermath:
            typeof dcVal.aftermath === 'string' && dcVal.aftermath.trim()
              ? dcVal.aftermath.trim()
              : 'Psychological strain and physical exhaustion',
          ambiguityHandling:
            typeof dcVal.ambiguityHandling === 'string' && dcVal.ambiguityHandling.trim()
              ? dcVal.ambiguityHandling.trim()
              : 'Tangible uncanny phenomena grounded in environmental clues',
          specialBoundaries:
            typeof dcVal.specialBoundaries === 'string' ? dcVal.specialBoundaries.trim() : '',
        };
      } else if (
        normalizedCandidate.target === 'value_anchor' &&
        typeof proposedValue === 'object' &&
        proposedValue !== null &&
        !Array.isArray(proposedValue)
      ) {
        const anchorObj = { ...(proposedValue as Record<string, unknown>) };
        if (!anchorObj.id || typeof anchorObj.id !== 'string' || !anchorObj.id.trim()) {
          anchorObj.id = `${sourceId}-anchor-${idx}`;
        }
        if (resolvedEvIds.length === 0) {
          recordIssue(candidateIndex, normalizedCandidate, {
            fieldPath: 'evidenceIds',
            code: 'MISSING_REQUIRED_FIELD',
            message: `Candidate ${candidateIndex} (value_anchor) requires source evidence provenance.`,
          });
          return;
        }
        // Server reconstructs provenance authoritatively from sourceRecord.id and valid evidence IDs
        anchorObj.provenance = {
          kind: 'REVIEWED_SOURCE',
          sourceId,
          evidenceIds: resolvedEvIds,
        };
        proposedValue = anchorObj;
      } else if (
        normalizedCandidate.target === 'character_pursuit' &&
        typeof proposedValue === 'object' &&
        proposedValue !== null &&
        !Array.isArray(proposedValue)
      ) {
        const pursuitObj = { ...(proposedValue as Record<string, unknown>) };
        if (!pursuitObj.id || typeof pursuitObj.id !== 'string' || !pursuitObj.id.trim()) {
          pursuitObj.id = `${sourceId}-pursuit-${idx}`;
        }
        if (resolvedEvIds.length === 0) {
          recordIssue(candidateIndex, normalizedCandidate, {
            fieldPath: 'evidenceIds',
            code: 'MISSING_REQUIRED_FIELD',
            message: `Candidate ${candidateIndex} (character_pursuit) requires source evidence provenance.`,
          });
          return;
        }
        pursuitObj.provenance = {
          kind: 'REVIEWED_SOURCE',
          sourceId,
          evidenceIds: resolvedEvIds,
        };
        proposedValue = pursuitObj;
      } else if (
        normalizedCandidate.target === 'reference_attribution' &&
        typeof proposedValue === 'object' &&
        proposedValue !== null &&
        !Array.isArray(proposedValue)
      ) {
        const attrObj = { ...(proposedValue as Record<string, unknown>) };
        attrObj.sourceId = sourceId;
        proposedValue = attrObj;
      } else if (normalizedCandidate.target === 'user_opening_aim_default') {
        let aimText = '';
        let castMemberId =
          typeof normalizedCandidate.targetCastMemberId === 'string'
            ? normalizedCandidate.targetCastMemberId.trim()
            : '';
        if (typeof proposedValue === 'string') {
          aimText = proposedValue.trim();
        } else if (proposedValue && typeof proposedValue === 'object' && !Array.isArray(proposedValue)) {
          const aimObj = proposedValue as Record<string, unknown>;
          if (typeof aimObj.aimText === 'string') {
            aimText = aimObj.aimText.trim();
          } else if (typeof aimObj.text === 'string') {
            aimText = aimObj.text.trim();
          }
          if (!castMemberId && typeof aimObj.castMemberId === 'string') {
            castMemberId = aimObj.castMemberId.trim();
          }
        }
        if (!aimText) {
          recordIssue(candidateIndex, normalizedCandidate, {
            fieldPath: 'proposedValue.aimText',
            code: 'MISSING_REQUIRED_FIELD',
            message: `Candidate ${candidateIndex} (user_opening_aim_default) has empty aimText.`,
          });
          return;
        }
        proposedValue = {
          castMemberId: castMemberId || undefined,
          aimText,
        };
        if (!normalizedCandidate.targetCastMemberId && castMemberId) {
          normalizedCandidate.targetCastMemberId = castMemberId;
        }
      } else if (typeof proposedValue === 'string') {
        proposedValue = proposedValue.trim();
      }

      const rawCandidate: Record<string, unknown> = {
        id: typeof normalizedCandidate.id === 'string' && normalizedCandidate.id.trim()
          ? normalizedCandidate.id.trim()
          : `${sourceId}-cand-${idx}`,
        sourceId,
        classification: normalizedCandidate.classification === 'inference' ? ('inference' as const) : ('evidence' as const),
        target: normalizedCandidate.target,
        label: typeof normalizedCandidate.label === 'string' && normalizedCandidate.label.trim()
          ? normalizedCandidate.label.trim()
          : `Candidate ${candidateIndex}`,
        explanation:
          typeof normalizedCandidate.explanation === 'string' && normalizedCandidate.explanation.trim()
            ? normalizedCandidate.explanation.trim()
            : 'Extracted from source document.',
        evidenceIds: resolvedEvIds,
        proposedValue,
        reviewDecision: 'accepted' as const,
        applicationState: 'staged' as const,
      };

      if (
        typeof normalizedCandidate.targetCastMemberId === 'string' &&
        normalizedCandidate.targetCastMemberId.trim()
      ) {
        rawCandidate.targetCastMemberId = normalizedCandidate.targetCastMemberId.trim();
      }

      if (
        normalizedCandidate.target === 'expandable_space_anchor' &&
        typeof normalizedCandidate.parentNodeId === 'string' &&
        normalizedCandidate.parentNodeId.trim()
      ) {
        rawCandidate.parentNodeId = normalizedCandidate.parentNodeId.trim();
      }

      const parseRes = ForgeSourceCandidateSchema.safeParse(rawCandidate);
      if (parseRes.success) {
        candidates.push(parseRes.data);
      } else {
        const enumIssue = parseRes.error.issues.find(
          (i) => (i.code as string) === 'invalid_value' || (i.code as string) === 'invalid_enum_value'
        );
        const discIssue = parseRes.error.issues.find(
          (i) => {
            const rec = i as unknown as Record<string, unknown>;
            return (
              (i.code as string) === 'invalid_union_discriminator' ||
              (i.code === 'invalid_union' && Boolean(rec.discriminator || rec.options))
            );
          }
        );
        const missingIssue = parseRes.error.issues.find((i) => {
          const rec = i as unknown as Record<string, unknown>;
          return i.code === 'invalid_type' && (rec.received === 'undefined' || rec.input === undefined);
        });
        const relevantIssue = enumIssue || discIssue || missingIssue || parseRes.error.issues[0];

        let code: ForgeValidationIssueCode = 'INVALID_CANDIDATE_SHAPE';
        let allowedValues: readonly string[] | undefined;
        const fieldPath = relevantIssue?.path?.join('.') || 'proposedValue';

        if (relevantIssue) {
          const issueCode = relevantIssue.code as string;
          const issueRec = relevantIssue as unknown as Record<string, unknown>;
          if (issueCode === 'invalid_value' || issueCode === 'invalid_enum_value') {
            code = 'INVALID_ENUM';
            allowedValues = (issueRec.values || issueRec.options) as string[];
          } else if (
            issueCode === 'invalid_union_discriminator' ||
            issueCode === 'invalid_union'
          ) {
            code = 'INVALID_DISCRIMINATOR';
            allowedValues = (issueRec.options || issueRec.values) as string[];
          } else if (
            issueCode === 'invalid_type' &&
            (issueRec.received === 'undefined' || issueRec.input === undefined)
          ) {
            code = 'MISSING_REQUIRED_FIELD';
          }
        }

        const cleanMsg = `Candidate ${candidateIndex} (${normalizedCandidate.target || 'unknown'}) failed schema validation at ${fieldPath}: ${relevantIssue?.message || 'Invalid candidate structure'}`;
        console.warn(
          `[Forge Baseline QUARANTINE] ${cleanMsg}`,
          `| label="${normalizedCandidate.label || 'unlabeled'}"`,
          `| all issues (${parseRes.error.issues.length}):`,
          parseRes.error.issues.map((i) => `${i.path.join('.')}: ${i.message} [${i.code}]`).join('; ')
        );
        recordIssue(candidateIndex, normalizedCandidate, {
          fieldPath,
          code,
          message: cleanMsg,
          allowedValues,
        });
      }
    });
  }

  // 3. Normalize and filter unknowns entries
  const unknowns: ForgeSourceUnknown[] = [];
  if (Array.isArray(rawObj.unknowns)) {
    rawObj.unknowns.forEach((u: unknown, idx: number) => {
      if (!u || typeof u !== 'object' || Array.isArray(u)) return;
      const item = u as Record<string, unknown>;
      const category = item.category;
      const rawUnknown = {
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `${sourceId}-unk-${idx}`,
        sourceId,
        category,
        question: typeof item.question === 'string' && item.question.trim() ? item.question.trim() : '',
        status: 'queued' as const,
        targetEffect:
          typeof item.targetEffect === 'string' && item.targetEffect.trim()
            ? item.targetEffect.trim()
            : `Clarifies ${category || 'scenario'} baseline parameters for execution.`,
        followUps: [],
      };
      const parseRes = ForgeSourceUnknownSchema.safeParse(rawUnknown);
      if (parseRes.success) {
        unknowns.push(parseRes.data);
      }
    });
  }

  // 4. Fatal depiction contract check: must produce exactly one complete depiction_contract candidate
  const depictionCandidates = candidates.filter((c) => c.target === 'depiction_contract');
  if (depictionCandidates.length !== 1) {
    const issueReason =
      depictionCandidates.length === 0
        ? 'missing required depiction_contract candidate'
        : `found ${depictionCandidates.length} duplicate depiction_contract candidates`;
    return {
      id: typeof rawObj.id === 'string' && rawObj.id.trim() ? rawObj.id.trim() : `${sourceId}-analysis-err`,
      sourceRecord,
      summary: `Extraction failed for ${sourceRecord.fileName}: did not produce exactly one complete source-backed Depiction Contract.`,
      evidence,
      candidates,
      unknowns,
      validationIssues,
      omittedValidationIssueCount,
      status: 'error',
      errorMessage: `Extraction did not produce a complete source-backed Depiction Contract. (${issueReason})`,
    };
  }

  // 5. Fatal analysis check: if no usable evidence, candidates, or unknowns could be parsed
  if (candidates.length === 0 && evidence.length === 0 && unknowns.length === 0) {
    return {
      id: typeof rawObj.id === 'string' && rawObj.id.trim() ? rawObj.id.trim() : `${sourceId}-analysis-err`,
      sourceRecord,
      summary: `Extraction failed for ${sourceRecord.fileName}: no usable evidence, candidates, or unknowns were extracted.`,
      evidence: [],
      candidates: [],
      unknowns: [],
      validationIssues,
      omittedValidationIssueCount,
      status: 'error',
      errorMessage:
        validationIssues.length > 0
          ? `Extraction produced no usable baseline: ${validationIssues.map((i) => i.message).slice(0, 3).join('; ')}`
          : 'Extraction failed: empty or unparseable baseline content.',
    };
  }

  const status: 'completed' | 'completed_with_issues' | 'error' =
    rawObj.status === 'error'
      ? 'error'
      : validationIssues.length > 0 || omittedValidationIssueCount > 0
        ? 'completed_with_issues'
        : 'completed';

  const normalizedAnalysis = {
    id: typeof rawObj.id === 'string' && rawObj.id.trim() ? rawObj.id.trim() : `${sourceId}-analysis`,
    sourceRecord,
    summary:
      typeof rawObj.summary === 'string' && rawObj.summary.trim()
        ? rawObj.summary.trim()
        : validationIssues.length > 0
          ? `Source intake analysis for ${sourceRecord.fileName} (${candidates.length} valid candidates, ${validationIssues.length + omittedValidationIssueCount} quarantined issues)`
          : `Source intake analysis for ${sourceRecord.fileName} (${candidates.length} reviewable candidates)`,
    evidence,
    candidates,
    unknowns,
    validationIssues,
    omittedValidationIssueCount,
    status,
    villainProtagonist: rawObj.villainProtagonist === true ? true : undefined,
    errorMessage:
      typeof rawObj.errorMessage === 'string' && rawObj.errorMessage.trim()
        ? rawObj.errorMessage.trim()
        : undefined,
  };

  const parseResult = ForgeSourceAnalysisSchema.safeParse(normalizedAnalysis);
  if (parseResult.success) {
    return parseResult.data;
  }

  return {
    id: `${sourceId}-analysis-fallback`,
    sourceRecord,
    summary: `Source intake completed with parsing fallback for ${sourceRecord.fileName}.`,
    villainProtagonist: rawObj.villainProtagonist === true ? true : undefined,
    evidence,
    candidates,
    unknowns,
    validationIssues: validationIssues.slice(0, MAX_VALIDATION_ISSUES),
    omittedValidationIssueCount,
    status: 'completed_with_issues',
    errorMessage: `Schema validation failed: ${parseResult.error.issues.map((i) => i.message).join(', ')}`,
  };
}


/**
 * Applies one explicitly accepted candidate to a supplied ForgeDraft.
 * Pure, deterministic function: returns an explicit success or error result,
 * never mutating the original draft.
 */
export function applyCandidateToDraft(
  draft: ForgeDraft,
  candidate: ForgeSourceCandidate,
  sourceFileName?: string
): ApplyCandidateResult {
  const cloned: ForgeDraft = JSON.parse(JSON.stringify(draft));

  switch (candidate.target) {
    case 'scenario_title': {
      if (typeof candidate.proposedValue !== 'string' || !candidate.proposedValue.trim()) {
        return { success: false, draft, error: 'Scenario title proposed value must be a non-empty string.' };
      }
      const titleStr = candidate.proposedValue.trim();
      cloned.title = titleStr;
      cloned.identity = {
        ...(cloned.identity || { version: '1.0', author: '', thematicAnchor: '' }),
        title: titleStr,
      };
      break;
    }

    case 'premise': {
      if (typeof candidate.proposedValue !== 'string' || !candidate.proposedValue.trim()) {
        return { success: false, draft, error: 'Premise proposed value must be a non-empty string.' };
      }
      const premiseStr = candidate.proposedValue.trim();
      cloned.premise = premiseStr;
      cloned.globalPremise = premiseStr;
      break;
    }

    case 'setting_location': {
      if (typeof candidate.proposedValue !== 'string' || !candidate.proposedValue.trim()) {
        return { success: false, draft, error: 'Setting location must be a non-empty string.' };
      }
      const locStr = candidate.proposedValue.trim();
      cloned.setting = {
        ...(cloned.setting || { atmosphere: '', timePeriod: '' }),
        location: locStr,
      };
      break;
    }

    case 'setting_atmosphere': {
      if (typeof candidate.proposedValue !== 'string' || !candidate.proposedValue.trim()) {
        return { success: false, draft, error: 'Setting atmosphere must be a non-empty string.' };
      }
      const atmoStr = candidate.proposedValue.trim();
      cloned.setting = {
        ...(cloned.setting || { location: '', timePeriod: '' }),
        atmosphere: atmoStr,
      };
      break;
    }

    case 'setting_time_period': {
      if (typeof candidate.proposedValue !== 'string' || !candidate.proposedValue.trim()) {
        return { success: false, draft, error: 'Setting time period must be a non-empty string.' };
      }
      const tpStr = candidate.proposedValue.trim();
      cloned.setting = {
        ...(cloned.setting || { location: '', atmosphere: '' }),
        timePeriod: tpStr,
      };
      break;
    }

    case 'environmental_rule': {
      if (typeof candidate.proposedValue !== 'string' || !candidate.proposedValue.trim()) {
        return { success: false, draft, error: 'Environmental rule must be a non-empty string.' };
      }
      const ruleStr = candidate.proposedValue.trim();
      const currentRules = Array.isArray(cloned.environmentalRules)
        ? [...cloned.environmentalRules]
        : typeof cloned.environmentalRules === 'string' && cloned.environmentalRules.trim().length > 0
        ? [cloned.environmentalRules.trim()]
        : [];

      if (!currentRules.includes(ruleStr)) {
        currentRules.push(ruleStr);
      }
      cloned.environmentalRules = currentRules;
      break;
    }

    case 'narrative_rule': {
      if (typeof candidate.proposedValue !== 'string' || !candidate.proposedValue.trim()) {
        return { success: false, draft, error: 'Narrative rule must be a non-empty string.' };
      }
      const nRuleStr = candidate.proposedValue.trim();
      const currentPlot = cloned.narrativeRules?.keyPlotElements
        ? [...cloned.narrativeRules.keyPlotElements]
        : [];
      if (!currentPlot.includes(nRuleStr)) {
        currentPlot.push(nRuleStr);
      }
      cloned.narrativeRules = {
        ...(cloned.narrativeRules || {
          incitingIncident: '',
          phaseDirectives: {},
          currentTensionLevel: 'buildup',
          keyPlotElements: [],
        }),
        keyPlotElements: currentPlot,
      };
      break;
    }

    case 'cast_seed': {
      const proposedCast: ForgeDraftCastMember = {
        ...(candidate.proposedValue as ForgeDraftCastMember),
      };
      if (!proposedCast || typeof proposedCast !== 'object' || !proposedCast.name) {
        return { success: false, draft, error: 'Cast seed proposed value must be a valid cast member object.' };
      }

      // Default presence disposition to OFFSTAGE if unassigned so export pre-flight never fails
      if (!proposedCast.presenceDisposition && !proposedCast.starting_location) {
        proposedCast.presenceDisposition = { kind: 'OFFSTAGE' };
      }

      const currentCast = cloned.cast ? [...cloned.cast] : [];
      const existingIndex = currentCast.findIndex((c) => c.id === proposedCast.id);

      if (existingIndex >= 0) {
        currentCast[existingIndex] = proposedCast;
      } else {
        currentCast.push(proposedCast);
      }

      if (proposedCast.isUserCharacter) {
        cloned.userCharacterId = proposedCast.id;
        cloned.cast = currentCast.map((c) => ({
          ...c,
          isUserCharacter: c.id === proposedCast.id,
        }));
      } else {
        cloned.cast = currentCast;
        if (cloned.userCharacterId === proposedCast.id) {
          cloned.userCharacterId = undefined;
        }
      }

      if (cloned.horrorGrammar) {
        if (!cloned.horrorGrammar.pursuitReviews) {
          cloned.horrorGrammar.pursuitReviews = {};
        }
        if (!cloned.horrorGrammar.pursuitReviews[proposedCast.id]) {
          cloned.horrorGrammar.pursuitReviews[proposedCast.id] = 'REVIEWED_NONE';
        }
        // Auto-transition value baseline review to REVIEWED_NONE if unreviewed and no anchors exist
        if (
          cloned.horrorGrammar.valueBaselineReview === 'UNREVIEWED' &&
          (!cloned.horrorGrammar.valueAnchors || cloned.horrorGrammar.valueAnchors.length === 0)
        ) {
          cloned.horrorGrammar.valueBaselineReview = 'REVIEWED_NONE';
        }
      }
      break;
    }

    case 'cast_expression_guidance': {
      const exprProfile = candidate.proposedValue;
      const targetId = candidate.targetCastMemberId;
      if (!targetId || !cloned.cast || !cloned.cast.some((m) => m.id === targetId)) {
        return {
          success: false,
          draft,
          error: `Target cast member "${targetId || 'unspecified'}" not found in active draft. Apply or create the cast member first.`,
        };
      }
      cloned.cast = cloned.cast.map((member) => {
        if (member.id === targetId) {
          return {
            ...member,
            expressionProfile: exprProfile,
          };
        }
        return member;
      });
      break;
    }

    case 'initial_topology_node': {
      // Legacy compatibility record: do not apply to modern draft
      break;
    }

    case 'topology_node': {
      const nodeDef = candidate.proposedValue;
      if (!nodeDef || typeof nodeDef !== 'object') {
        return { success: false, draft, error: 'Topology node candidate must be a valid node object.' };
      }
      const cleanLabel = typeof nodeDef.label === 'string' && nodeDef.label.trim()
        ? nodeDef.label.trim()
        : typeof nodeDef.name === 'string' && nodeDef.name.trim()
        ? nodeDef.name.trim()
        : '';
      const cleanId = typeof nodeDef.id === 'string' && nodeDef.id.trim()
        ? nodeDef.id.trim()
        : cleanLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      if (!cleanId || !cleanLabel) {
        return { success: false, draft, error: 'Topology node candidate must have non-empty id and label.' };
      }
      const nodeDefWithProv: ForgeTopologyNode = {
        ...nodeDef,
        id: cleanId,
        label: cleanLabel,
        name: nodeDef.name || cleanLabel,
        description: (nodeDef.description && nodeDef.description.trim())
          ? nodeDef.description.trim()
          : `Sensory atmosphere of the ${cleanLabel}.`,
        sourceId: candidate.sourceId || nodeDef.sourceId,
        evidenceIds: candidate.evidenceIds || nodeDef.evidenceIds || [],
        classification: candidate.classification || nodeDef.classification || 'evidence',
      };
      const currentNodes = cloned.topology?.nodes ? [...cloned.topology.nodes] : [];
      const currentNodeDefs = cloned.topology?.nodeDefinitions ? [...cloned.topology.nodeDefinitions] : [];
      const nodeIndex = currentNodeDefs.findIndex((n) => n.id === cleanId);
      if (nodeIndex >= 0) {
        currentNodeDefs[nodeIndex] = { ...currentNodeDefs[nodeIndex], ...nodeDefWithProv };
      } else {
        currentNodeDefs.push(nodeDefWithProv);
      }
      if (!currentNodes.includes(cleanId)) {
        currentNodes.push(cleanId);
      }
      cloned.topology = {
        ...(cloned.topology || { connections: [] }),
        nodes: currentNodes,
        nodeDefinitions: currentNodeDefs,
      };
      break;
    }

    case 'topology_connection': {
      const edge = candidate.proposedValue;
      if (!edge || typeof edge !== 'object' || !edge.from || !edge.to) {
        return { success: false, draft, error: 'Topology connection candidate must be a valid edge object.' };
      }
      const edgeWithProv = {
        ...edge,
        sourceId: candidate.sourceId || (typeof edge === 'object' ? edge.sourceId : undefined),
        evidenceIds: candidate.evidenceIds || (typeof edge === 'object' ? edge.evidenceIds : []) || [],
        classification: candidate.classification || (typeof edge === 'object' ? edge.classification : undefined) || 'evidence',
      };
      const validNodeIds = new Set([
        ...(cloned.topology?.nodes || []),
        ...(cloned.topology?.nodeDefinitions?.map((n) => n.id) || []),
      ]);
      if (!validNodeIds.has(edge.from)) {
        return {
          success: false,
          draft,
          error: `Connection source node "${edge.from}" not found in active draft nodes.`,
        };
      }
      if (!validNodeIds.has(edge.to)) {
        return {
          success: false,
          draft,
          error: `Connection target node "${edge.to}" not found in active draft nodes.`,
        };
      }
      const currentConns = cloned.topology?.connections ? [...cloned.topology.connections] : [];
      const isDuplicate = currentConns.some((c) => {
        if (typeof c === 'string') {
          return c === `${edge.from}->${edge.to}` || c === `${edge.from} -> ${edge.to}`;
        }
        return (
          c.from === edge.from &&
          c.to === edge.to &&
          (c.kind || 'PHYSICAL') === (edge.kind || 'PHYSICAL')
        );
      });
      if (!isDuplicate) {
        currentConns.push(edgeWithProv);
      }
      cloned.topology = {
        ...(cloned.topology || { nodes: [] }),
        connections: currentConns,
      };
      break;
    }

    case 'starting_node_selection': {
      // Legacy compatibility record: do not apply to modern draft
      break;
    }

    case 'expandable_space_anchor': {
      const anchor = candidate.proposedValue;
      if (!anchor || typeof anchor !== 'object' || !anchor.id || !anchor.parentNodeId) {
        return { success: false, draft, error: 'Expandable space anchor candidate must be a valid anchor object.' };
      }
      const validNodeIds = new Set([
        ...(cloned.topology?.nodes || []),
        ...(cloned.topology?.nodeDefinitions?.map((n) => n.id) || []),
      ]);
      if (!validNodeIds.has(anchor.parentNodeId)) {
        return {
          success: false,
          draft,
          error: `Anchor parent node "${anchor.parentNodeId}" not found in active draft nodes.`,
        };
      }
      const anchorWithProv = {
        ...anchor,
        sourceId: candidate.sourceId || anchor.sourceId,
        evidenceIds: candidate.evidenceIds || anchor.evidenceIds || [],
        classification: candidate.classification || anchor.classification || 'evidence',
      };
      const currentAnchors = cloned.topology?.anchors ? [...cloned.topology.anchors] : [];
      const existingIdx = currentAnchors.findIndex((a) => a.id === anchor.id);
      if (existingIdx >= 0) {
        currentAnchors[existingIdx] = anchorWithProv;
      } else {
        currentAnchors.push(anchorWithProv);
      }
      cloned.topology = {
        ...(cloned.topology || { nodes: [], connections: [] }),
        anchors: currentAnchors,
      };
      break;
    }

    case 'cast_opening_placement': {
      const targetId = candidate.targetCastMemberId;
      if (!targetId || !cloned.cast || !cloned.cast.some((m) => m.id === targetId)) {
        return {
          success: false,
          draft,
          error: `Target cast member "${targetId || 'unspecified'}" not found in active draft. Apply cast seed first.`,
        };
      }
      const placement = candidate.proposedValue as CharacterPresenceDisposition;
      if (!placement || typeof placement !== 'object' || !placement.kind) {
        return { success: false, draft, error: 'Opening placement candidate must be a valid disposition object.' };
      }
      if (placement.kind === 'AT_NODE') {
        const validNodeIds = new Set([
          ...(cloned.topology?.nodes || []),
          ...(cloned.topology?.nodeDefinitions?.map((n) => n.id) || []),
        ]);
        if (!validNodeIds.has(placement.nodeId)) {
          return {
            success: false,
            draft,
            error: `Opening placement node "${placement.nodeId}" not found in active draft nodes.`,
          };
        }
      }
      cloned.cast = cloned.cast.map((member) => {
        if (member.id === targetId) {
          return {
            ...member,
            presenceDisposition: placement,
            starting_location: placement.kind === 'AT_NODE' ? placement.nodeId : undefined,
          };
        }
        return member;
      });
      break;
    }

    case 'reference_attribution': {
      const refStr =
        typeof candidate.proposedValue === 'string'
          ? candidate.proposedValue.trim()
          : typeof candidate.proposedValue === 'object' &&
            candidate.proposedValue !== null &&
            'fileName' in candidate.proposedValue &&
            typeof (candidate.proposedValue as { fileName: unknown }).fileName === 'string'
          ? (candidate.proposedValue as { fileName: string }).fileName.trim()
          : '';
      if (!refStr) {
        return { success: false, draft, error: 'Reference attribution must be a non-empty string.' };
      }
      const currentRefs = cloned.references ? [...cloned.references] : [];
      if (!currentRefs.includes(refStr)) {
        currentRefs.push(refStr);
      }
      cloned.references = currentRefs;
      break;
    }

    case 'value_anchor': {
      const anchor = candidate.proposedValue;
      if (!anchor || typeof anchor !== 'object' || !anchor.id || !anchor.label) {
        return { success: false, draft, error: 'Value anchor proposed value must be a valid value anchor object.' };
      }
      if (!cloned.horrorGrammar) {
        cloned.horrorGrammar = {
          valueBaselineReview: 'UNREVIEWED',
          pursuitReviews: {},
          valueAnchors: [],
          characterPursuits: [],
        };
      }
      const currentAnchors = [...(cloned.horrorGrammar.valueAnchors || [])];
      const existingIdx = currentAnchors.findIndex((a) => a.id === anchor.id);
      if (existingIdx >= 0) {
        currentAnchors[existingIdx] = anchor;
      } else {
        currentAnchors.push(anchor);
      }
      cloned.horrorGrammar.valueAnchors = currentAnchors;
      cloned.horrorGrammar.valueBaselineReview = 'REVIEWED';
      break;
    }

    case 'character_pursuit': {
      const pursuit = candidate.proposedValue;
      if (!pursuit || typeof pursuit !== 'object' || !pursuit.id || !pursuit.castMemberId) {
        return { success: false, draft, error: 'Character pursuit proposed value must be a valid character pursuit object.' };
      }
      if (!cloned.horrorGrammar) {
        cloned.horrorGrammar = {
          valueBaselineReview: 'UNREVIEWED',
          pursuitReviews: {},
          valueAnchors: [],
          characterPursuits: [],
        };
      }
      const currentPursuits = [...(cloned.horrorGrammar.characterPursuits || [])];
      const existingIdx = currentPursuits.findIndex((p) => p.id === pursuit.id);
      if (existingIdx >= 0) {
        currentPursuits[existingIdx] = pursuit;
      } else {
        currentPursuits.push(pursuit);
      }
      cloned.horrorGrammar.characterPursuits = currentPursuits;
      if (!cloned.horrorGrammar.pursuitReviews) {
        cloned.horrorGrammar.pursuitReviews = {};
      }
      cloned.horrorGrammar.pursuitReviews[pursuit.castMemberId] = 'REVIEWED';
      break;
    }

    case 'user_opening_aim_default': {
      // Legacy compatibility record: do not apply to modern draft
      break;
    }

    case 'depiction_contract': {
      const contract = DepictionContractSchema.safeParse(candidate.proposedValue);
      if (!contract.success) {
        return { success: false, draft, error: 'Depiction contract candidate proposed value is malformed.' };
      }
      cloned.depictionContract = structuredClone(contract.data);
      break;
    }

    case 'antagonist_profile': {
      const profile = AntagonistProfileSchema.safeParse(candidate.proposedValue);
      if (!profile.success) {
        return { success: false, draft, error: 'Antagonist profile candidate proposed value is malformed.' };
      }
      cloned.antagonistProfile = structuredClone(profile.data);
      break;
    }
  }

  // Provenance: append sourceFileName to references if not already present
  if (sourceFileName && sourceFileName.trim().length > 0) {
    const safeSourceFile = sourceFileName.trim();
    const currentRefs = cloned.references ? [...cloned.references] : [];
    if (!currentRefs.includes(safeSourceFile)) {
      currentRefs.push(safeSourceFile);
    }
    cloned.references = currentRefs;
  }

  return { success: true, draft: cloned };
}

export const IMPORT_APPLICATION_PRIORITY = {
  cast_seed: 1,
  topology_node: 1,
  topology_connection: 2,
  expandable_space_anchor: 2,
  scenario_title: 2,
  premise: 2,
  setting_location: 2,
  setting_atmosphere: 2,
  setting_time_period: 2,
  environmental_rule: 2,
  narrative_rule: 2,
  cast_opening_placement: 3,
  cast_expression_guidance: 3,
  value_anchor: 4,
  character_pursuit: 4,
  depiction_contract: 5,
  antagonist_profile: 5,
  reference_attribution: 5,
} as const;

/**
 * Gets the execution priority for a candidate target.
 */
export function getCandidateApplicationPriority(target: ForgeSourceCandidate['target']): number {
  if (target in IMPORT_APPLICATION_PRIORITY) {
    return IMPORT_APPLICATION_PRIORITY[target as keyof typeof IMPORT_APPLICATION_PRIORITY];
  }
  return 10;
}

/**
 * Deterministically sorts candidates for batch application:
 * cast_seed runs before cast_expression_guidance, preserving extraction order for equal priority.
 */
export function sortCandidatesForApplication(candidates: ForgeSourceCandidate[]): ForgeSourceCandidate[] {
  return [...candidates].sort((a, b) => {
    const pA = getCandidateApplicationPriority(a.target);
    const pB = getCandidateApplicationPriority(b.target);
    return pA - pB;
  });
}

/**
 * Reconciles draft topology and cast members:
 * 1. Auto-selects startingNodeId from available topology nodes if none is assigned.
 * 2. If a cast member's AT_NODE presence references an unknown node, defaults to OFFSTAGE
 *    so pre-flight compilation validation succeeds.
 */
export function reconcileDraftTopologyAndCast(draft: ForgeDraft): ForgeDraft {
  const cloned: ForgeDraft = JSON.parse(JSON.stringify(draft));

  // 0. Normalize topology nodeDefinitions and raw nodes
  if (cloned.topology) {
    if (Array.isArray(cloned.topology.nodeDefinitions) && cloned.topology.nodeDefinitions.length > 0) {
      cloned.topology.nodeDefinitions = cloned.topology.nodeDefinitions.map((d, idx: number) => {
        // Node definitions arrive as unknown (legacy/unvalidated payloads);
        // read string fields defensively.
        const dRecord = d as Record<string, unknown>;
        const strField = (v: unknown): string => (typeof v === 'string' ? v : '');
        const label = (strField(dRecord.label) || strField(dRecord.name) || strField(dRecord.id) || `Location ${idx + 1}`).trim();
        const id = (strField(dRecord.id) || label.toLowerCase().replace(/[^a-z0-9]+/g, '_')).trim();
        const description = strField(dRecord.description).trim()
          ? strField(dRecord.description).trim()
          : `Sensory atmosphere of the ${label}.`;
        return {
          ...dRecord,
          id,
          label,
          name: strField(dRecord.name) || label,
          description,
        };
      });
      cloned.topology.nodes = cloned.topology.nodeDefinitions.map((d) => d.id);
    } else if (Array.isArray(cloned.topology.nodes) && cloned.topology.nodes.length > 0) {
      cloned.topology.nodes = cloned.topology.nodes
        .map((n: unknown) => {
          if (typeof n === 'string') return n.trim();
          if (!n || typeof n !== 'object') return '';
          const nRecord = n as Record<string, unknown>;
          return String(nRecord.id || nRecord.name || '').trim();
        })
        .filter(Boolean);
      cloned.topology.nodeDefinitions = cloned.topology.nodes.map((id: string) => ({
        id,
        label: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        name: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `Sensory atmosphere of the ${id.replace(/_/g, ' ')}.`,
      }));
    }
  }

  const availableNodeIds = Array.from(
    new Set([
      ...(cloned.topology?.nodes || []),
      ...(cloned.topology?.nodeDefinitions || []).map((d) => d.id),
    ])
  );

  // 1. Auto-select starting node if not set
  if (
    (!cloned.topology?.startingNodeId || !cloned.topology.startingNodeId.trim()) &&
    availableNodeIds.length > 0
  ) {
    if (!cloned.topology) {
      cloned.topology = { nodes: [], nodeDefinitions: [], connections: [], anchors: [] };
    }
    cloned.topology.startingNodeId = availableNodeIds[0];
  }

  // 2. Reconcile cast presence dispositions and disposition:
  // If an AT_NODE placement references a node not present in topology,
  // fallback to OFFSTAGE so export pre-flight validation succeeds.
  if (cloned.cast && cloned.cast.length > 0) {
    const validNodeSet = new Set(availableNodeIds);
    cloned.cast = cloned.cast.map((member) => {
      const isEntityOrAntagonist =
        member.isEntity === true || String(member.role).toUpperCase() === 'ANTAGONIST';
      const disposition = normalizeCastDisposition(
        member.disposition,
        isEntityOrAntagonist
      );

      const invalidPlacement =
        member.presenceDisposition?.kind === 'AT_NODE' &&
        !validNodeSet.has(member.presenceDisposition.nodeId);

      return {
        ...member,
        disposition,
        ...(invalidPlacement ? { presenceDisposition: { kind: 'OFFSTAGE' as const } } : {}),
      };
    });
  }
  // 3. Reconcile setting location:
  // If setting location is missing, empty, or 'unknown', populate from starting node, first node, or title.
  if (!cloned.setting) {
    cloned.setting = { location: '', atmosphere: '', timePeriod: '' };
  }
  const currentLoc = (cloned.setting.location || '').trim();
  if (!currentLoc || currentLoc.toLowerCase() === 'unknown') {
    const startNode = cloned.topology?.nodeDefinitions?.find((d) => d.id === cloned.topology?.startingNodeId);
    const firstNode = cloned.topology?.nodeDefinitions?.[0];
    const fallbackLocation =
      startNode?.label ||
      firstNode?.label ||
      cloned.topology?.startingNodeId ||
      cloned.topology?.nodes?.[0] ||
      cloned.title ||
      'Scenario Environment';
    cloned.setting.location = fallbackLocation;
  }

  // 4. Reconcile horror grammar value baseline review:
  // Export requires either accepted anchors or explicit REVIEWED_NONE
  if (!cloned.horrorGrammar) {
    cloned.horrorGrammar = {
      valueBaselineReview: 'REVIEWED_NONE',
      valueAnchors: [],
      pursuitReviews: {},
    };
  } else if (cloned.horrorGrammar.valueBaselineReview === 'UNREVIEWED' || !cloned.horrorGrammar.valueBaselineReview) {
    const hasAnchors = Array.isArray(cloned.horrorGrammar.valueAnchors) && cloned.horrorGrammar.valueAnchors.length > 0;
    cloned.horrorGrammar.valueBaselineReview = hasAnchors ? 'REVIEWED' : 'REVIEWED_NONE';
  }

  // 5. Reconcile graph continuity:
  // If there are multiple nodes (nodeDefinitions.length > 1) and zero connections,
  // automatically synthesize sequential bidirectional connections so that the spatial map is navigable.
  if (cloned.topology) {
    const nodeDefs = cloned.topology.nodeDefinitions || [];
    const currentConns = cloned.topology.connections || [];
    if (nodeDefs.length > 1 && currentConns.length === 0) {
      const synthConns: Array<{ from: string; to: string; kind: 'PHYSICAL'; userInitiated: boolean }> = [];
      for (let i = 0; i < nodeDefs.length - 1; i++) {
        const fromId = nodeDefs[i].id;
        const toId = nodeDefs[i + 1].id;
        synthConns.push({
          from: fromId,
          to: toId,
          kind: 'PHYSICAL',
          userInitiated: true,
        });
        synthConns.push({
          from: toId,
          to: fromId,
          kind: 'PHYSICAL',
          userInitiated: true,
        });
      }
      cloned.topology.connections = synthConns;
    }
  }

  // 6. Reconcile title:
  // Ensure title is never completely empty
  if (!cloned.title || !cloned.title.trim()) {
    if (cloned.identity?.title && cloned.identity.title.trim()) {
      cloned.title = cloned.identity.title.trim();
    } else if (cloned.setting?.location && cloned.setting.location.trim()) {
      cloned.title = cloned.setting.location.trim();
    }
  }
  if (cloned.title && (!cloned.identity?.title || !cloned.identity.title.trim())) {
    cloned.identity = {
      ...(cloned.identity || { version: '1.0', author: '', thematicAnchor: '' }),
      title: cloned.title,
    };
  }

  // 7. Reconcile antagonist profile telemetry feeds and apparatus controls:
  // If telemetry feeds reference unknown or placeholder node IDs ('all'), ground them to available topology nodes.
  if (cloned.antagonistProfile && availableNodeIds.length > 0) {
    const validNodeSet = new Set(availableNodeIds);

    if (Array.isArray(cloned.antagonistProfile.telemetryFeeds)) {
      cloned.antagonistProfile.telemetryFeeds = cloned.antagonistProfile.telemetryFeeds.map(
        (feed: TelemetryFeed, idx: number): TelemetryFeed => {
          if (!feed || typeof feed !== 'object') return feed;
          const rawNodeId = typeof feed.nodeId === 'string' ? feed.nodeId.trim() : '';
          const isUnknownOrPlaceholder =
            !rawNodeId ||
            rawNodeId === 'all' ||
            rawNodeId === '*' ||
            rawNodeId.toLowerCase() === 'global' ||
            !validNodeSet.has(rawNodeId);

          const assignedNodeId = isUnknownOrPlaceholder
            ? availableNodeIds[idx % availableNodeIds.length]
            : rawNodeId;

          return {
            ...feed,
            nodeId: assignedNodeId,
            feedType: feed.feedType || 'OPTICAL_CAM',
            status: feed.status || 'ONLINE',
          };
        }
      );
    }

    if (Array.isArray(cloned.antagonistProfile.apparatusControls)) {
      cloned.antagonistProfile.apparatusControls = cloned.antagonistProfile.apparatusControls.map(
        (ctrl: AntagonistApparatusControl): AntagonistApparatusControl => {
          if (!ctrl || typeof ctrl !== 'object') return ctrl;
          let affectedNodeIds = Array.isArray(ctrl.affectedNodeIds) ? ctrl.affectedNodeIds : [];
          affectedNodeIds = affectedNodeIds.map((nId: unknown) => {
            if (typeof nId !== 'string') return availableNodeIds[0];
            const trimmed = nId.trim();
            if (
              trimmed === 'all' ||
              trimmed === '*' ||
              trimmed.toLowerCase() === 'global' ||
              validNodeSet.has(trimmed)
            ) {
              return trimmed;
            }
            return availableNodeIds[0];
          });
          return {
            ...ctrl,
            affectedNodeIds,
          };
        }
      );
    }
  }

  return cloned;
}

/**
 * Validates an edited proposal value for a candidate before applying.
 * Keeps proposedValue schema-compliant while preserving candidate classification, reviewDecision, and evidence links.
 */
export function validateCandidateEdit(
  candidate: ForgeSourceCandidate,
  editedValue: unknown
): { valid: boolean; error?: string; updatedCandidate?: ForgeSourceCandidate } {
  if (editedValue === undefined || editedValue === null) {
    return { valid: false, error: 'Proposed value cannot be empty.' };
  }

  const rawCandidateCandidate = {
    ...candidate,
    proposedValue: editedValue,
    reviewDecision: candidate.reviewDecision,
    applicationState: 'staged' as const,
  };

  const parseResult = ForgeSourceCandidateSchema.safeParse(rawCandidateCandidate);
  if (!parseResult.success) {
    return {
      valid: false,
      error: `Invalid value for target "${candidate.target}": ${parseResult.error.issues.map((i) => i.message).join(', ')}`,
    };
  }

  return {
    valid: true,
    updatedCandidate: parseResult.data,
  };
}

/**
 * Returns a candidate with reviewDecision set to 'rejected'.
 */
export function rejectCandidate(candidate: ForgeSourceCandidate): ForgeSourceCandidate {
  return {
    ...candidate,
    reviewDecision: 'rejected',
  };
}

/**
 * Purely sets the reviewDecision of a candidate.
 */
export function setCandidateReviewDecisionPure(
  candidate: ForgeSourceCandidate,
  decision: 'accepted' | 'rejected'
): ForgeSourceCandidate {
  return {
    ...candidate,
    reviewDecision: decision,
  };
}

/**
 * Result type for applying ambiguity resolution draft patches.
 */
export type ApplyResolutionDraftPatchResult =
  | { success: true; draft: ForgeDraft }
  | { success: false; error: string };

/**
 * Deterministic append helper that trims both values, adds one readable separator,
 * and does not append identical text twice.
 */
function appendDeterministicText(
  current: string | undefined | null,
  addition: string,
  separator: string = '\n\n'
): string {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return (current || '').trim();
  const trimmedCurrent = (current || '').trim();
  if (!trimmedCurrent) return trimmedAddition;

  // Do not append identical text twice
  if (trimmedCurrent === trimmedAddition) return trimmedCurrent;
  if (
    trimmedCurrent.endsWith(trimmedAddition) ||
    trimmedCurrent.includes(`${separator}${trimmedAddition}`) ||
    trimmedCurrent.includes(`\n${trimmedAddition}`)
  ) {
    return trimmedCurrent;
  }

  return `${trimmedCurrent}${separator}${trimmedAddition}`;
}

/**
 * Purely applies structured ambiguity resolution patch operations to a ForgeDraft.
 * Process order:
 * 1. Parse the complete patch with ForgeResolutionDraftPatchSchema.
 * 2. Validate every operation and referenced cast member against the untouched draft.
 * 3. Apply all operations to one clone.
 * 4. Parse the complete clone with ForgeDraftSchema.
 * 5. Return success only after final validation.
 */
export function applyResolutionDraftPatch(
  draft: ForgeDraft,
  patch?: ForgeResolutionDraftPatch
): ApplyResolutionDraftPatchResult {
  if (!patch || !Array.isArray(patch.operations) || patch.operations.length === 0) {
    const parseDraft = ForgeDraftSchema.safeParse(draft);
    if (!parseDraft.success) {
      return {
        success: false,
        error: `Draft validation failed: ${parseDraft.error.issues.map((i) => i.message).join(', ')}`,
      };
    }
    return { success: true, draft: parseDraft.data as unknown as ForgeDraft };
  }

  // 1. Parse the complete patch
  const parsedPatch = ForgeResolutionDraftPatchSchema.safeParse(patch);
  if (!parsedPatch.success) {
    return {
      success: false,
      error: `Invalid draft patch schema: ${parsedPatch.error.issues.map((i) => i.message).join(', ')}`,
    };
  }

  // 2. Validate every operation and referenced cast member against the untouched draft
  const castList = draft.cast || [];
  const validCastIds = new Set(castList.map((c) => c.id).filter(Boolean));
  const validNodeIds = new Set(draft.topology?.nodes?.filter(Boolean) || []);

  for (let idx = 0; idx < parsedPatch.data.operations.length; idx++) {
    const op = parsedPatch.data.operations[idx];

    if (
      op.target === 'cast_description' ||
      op.target === 'cast_personality' ||
      op.target === 'premise_detail' ||
      op.target === 'setting_atmosphere' ||
      op.target === 'environmental_rule' ||
      op.target === 'narrative_rule'
    ) {
      const text = (op.text || '').trim();
      if (!text) {
        return {
          success: false,
          error: `Operation [${idx + 1}] (${op.target}) text cannot be empty.`,
        };
      }

      if (op.target === 'cast_description' || op.target === 'cast_personality') {
        const targetCast = castList.find((c) => c.id === op.castMemberId);
        if (!targetCast) {
          return {
            success: false,
            error: `Referenced cast member "${op.castMemberId}" not found in active draft for operation [${idx + 1}] (${op.target}).`,
          };
        }
      }
    } else if (op.target === 'add_value_anchor') {
      if (op.anchor.holder.kind === 'CHARACTER') {
        if (!validCastIds.has(op.anchor.holder.castMemberId)) {
          return {
            success: false,
            error: `Value anchor references unknown cast member ID: "${op.anchor.holder.castMemberId}".`,
          };
        }
      } else if (op.anchor.holder.kind === 'RELATIONSHIP') {
        const [c1, c2] = op.anchor.holder.castMemberIds;
        if (!validCastIds.has(c1) || !validCastIds.has(c2)) {
          return {
            success: false,
            error: `Relationship value anchor references unknown cast member ID.`,
          };
        }
      } else if (op.anchor.holder.kind === 'PLACE') {
        if (validNodeIds.size > 0 && !validNodeIds.has(op.anchor.holder.nodeId)) {
          return {
            success: false,
            error: `Place value anchor references unknown topology node ID: "${op.anchor.holder.nodeId}".`,
          };
        }
      }
    } else if (op.target === 'add_character_pursuit') {
      const targetCast = castList.find((c) => c.id === op.pursuit.castMemberId);
      if (!targetCast) {
        return {
          success: false,
          error: `Character pursuit references unknown cast member ID: "${op.pursuit.castMemberId}".`,
        };
      }
      if (targetCast.isUserCharacter) {
        return {
          success: false,
          error: 'Character pursuits cannot be assigned to User-controlled characters.',
        };
      }
      if (op.pursuit.locationNodeId && validNodeIds.size > 0 && !validNodeIds.has(op.pursuit.locationNodeId)) {
        return {
          success: false,
          error: `Character pursuit references unknown topology node ID: "${op.pursuit.locationNodeId}".`,
        };
      }
    } else if (op.target === 'set_character_pursuit_review_state') {
      if (!validCastIds.has(op.castMemberId)) {
        return {
          success: false,
          error: `Pursuit review state references unknown cast member ID: "${op.castMemberId}".`,
        };
      }
    }
  }

  // 3. Apply all operations to one clone
  const nextDraft: ForgeDraft = JSON.parse(JSON.stringify(draft));

  for (const op of parsedPatch.data.operations) {
    switch (op.target) {
      case 'cast_description': {
        const text = op.text.trim();
        if (!nextDraft.cast) nextDraft.cast = [];
        nextDraft.cast = nextDraft.cast.map((c) => {
          if (c.id === op.castMemberId) {
            return {
              ...c,
              description: appendDeterministicText(c.description, text, '\n\n'),
            };
          }
          return c;
        });
        break;
      }
      case 'cast_personality': {
        const text = op.text.trim();
        if (!nextDraft.cast) nextDraft.cast = [];
        nextDraft.cast = nextDraft.cast.map((c) => {
          if (c.id === op.castMemberId) {
            return {
              ...c,
              personality: appendDeterministicText(c.personality, text, '\n\n'),
            };
          }
          return c;
        });
        break;
      }
      case 'premise_detail': {
        const text = op.text.trim();
        const updated = appendDeterministicText(
          nextDraft.premise || nextDraft.globalPremise || '',
          text,
          '\n\n'
        );
        nextDraft.premise = updated;
        nextDraft.globalPremise = updated;
        break;
      }
      case 'setting_atmosphere': {
        const text = op.text.trim();
        if (!nextDraft.setting) {
          nextDraft.setting = { location: '', atmosphere: '', timePeriod: '' };
        }
        nextDraft.setting.atmosphere = appendDeterministicText(
          nextDraft.setting.atmosphere,
          text,
          ' '
        );
        break;
      }
      case 'environmental_rule': {
        const text = op.text.trim();
        if (Array.isArray(nextDraft.environmentalRules)) {
          const rules = [...nextDraft.environmentalRules];
          if (!rules.includes(text)) {
            rules.push(text);
          }
          nextDraft.environmentalRules = rules;
        } else if (typeof nextDraft.environmentalRules === 'string') {
          const current = nextDraft.environmentalRules.trim();
          if (!current) {
            nextDraft.environmentalRules = text;
          } else if (!current.includes(text)) {
            nextDraft.environmentalRules = `${current}\n${text}`;
          }
        } else {
          nextDraft.environmentalRules = [text];
        }
        break;
      }
      case 'narrative_rule': {
        const text = op.text.trim();
        if (!nextDraft.narrativeRules) {
          nextDraft.narrativeRules = {
            incitingIncident: '',
            phaseDirectives: {},
            currentTensionLevel: 'buildup',
            keyPlotElements: [],
          };
        }
        const currentPlot = Array.isArray(nextDraft.narrativeRules.keyPlotElements)
          ? [...nextDraft.narrativeRules.keyPlotElements]
          : [];
        if (!currentPlot.includes(text)) {
          currentPlot.push(text);
        }
        nextDraft.narrativeRules.keyPlotElements = currentPlot;
        break;
      }
      case 'add_value_anchor': {
        if (!nextDraft.horrorGrammar) {
          nextDraft.horrorGrammar = {
            valueBaselineReview: 'UNREVIEWED',
            pursuitReviews: {},
            valueAnchors: [],
            characterPursuits: [],
          };
        }
        const currentAnchors = [...(nextDraft.horrorGrammar.valueAnchors || [])];
        const existingIdx = currentAnchors.findIndex((a) => a.id === op.anchor.id);
        if (existingIdx >= 0) {
          currentAnchors[existingIdx] = op.anchor;
        } else {
          currentAnchors.push(op.anchor);
        }
        nextDraft.horrorGrammar.valueAnchors = currentAnchors;
        nextDraft.horrorGrammar.valueBaselineReview = 'REVIEWED';
        break;
      }
      case 'set_value_review_state': {
        if (!nextDraft.horrorGrammar) {
          nextDraft.horrorGrammar = {
            valueBaselineReview: 'UNREVIEWED',
            pursuitReviews: {},
            valueAnchors: [],
            characterPursuits: [],
          };
        }
        nextDraft.horrorGrammar.valueBaselineReview = op.state;
        if (op.state === 'REVIEWED_NONE') {
          nextDraft.horrorGrammar.valueAnchors = [];
        }
        break;
      }
      case 'add_character_pursuit': {
        if (!nextDraft.horrorGrammar) {
          nextDraft.horrorGrammar = {
            valueBaselineReview: 'UNREVIEWED',
            pursuitReviews: {},
            valueAnchors: [],
            characterPursuits: [],
          };
        }
        const currentPursuits = [...(nextDraft.horrorGrammar.characterPursuits || [])];
        const existingIdx = currentPursuits.findIndex((p) => p.id === op.pursuit.id);
        if (existingIdx >= 0) {
          currentPursuits[existingIdx] = op.pursuit;
        } else {
          currentPursuits.push(op.pursuit);
        }
        nextDraft.horrorGrammar.characterPursuits = currentPursuits;
        if (!nextDraft.horrorGrammar.pursuitReviews) {
          nextDraft.horrorGrammar.pursuitReviews = {};
        }
        nextDraft.horrorGrammar.pursuitReviews[op.pursuit.castMemberId] = 'REVIEWED';
        break;
      }
      case 'set_character_pursuit_review_state': {
        if (!nextDraft.horrorGrammar) {
          nextDraft.horrorGrammar = {
            valueBaselineReview: 'UNREVIEWED',
            pursuitReviews: {},
            valueAnchors: [],
            characterPursuits: [],
          };
        }
        if (!nextDraft.horrorGrammar.pursuitReviews) {
          nextDraft.horrorGrammar.pursuitReviews = {};
        }
        nextDraft.horrorGrammar.pursuitReviews[op.castMemberId] = op.state;
        if (op.state === 'REVIEWED_NONE') {
          nextDraft.horrorGrammar.characterPursuits = (
            nextDraft.horrorGrammar.characterPursuits || []
          ).filter((p) => p.castMemberId !== op.castMemberId);
        }
        break;
      }
      case 'remove_value_anchor': {
        if (nextDraft.horrorGrammar) {
          nextDraft.horrorGrammar.valueAnchors = (
            nextDraft.horrorGrammar.valueAnchors || []
          ).filter((a) => a.id !== op.anchorId);
        }
        break;
      }
      case 'remove_character_pursuit': {
        if (nextDraft.horrorGrammar) {
          nextDraft.horrorGrammar.characterPursuits = (
            nextDraft.horrorGrammar.characterPursuits || []
          ).filter((p) => p.id !== op.pursuitId);
        }
        break;
      }
    }
  }

  // 4. Parse the complete clone with ForgeDraftSchema
  const finalValidation = ForgeDraftSchema.safeParse(nextDraft);
  if (!finalValidation.success) {
    return {
      success: false,
      error: `Patched draft failed final validation: ${finalValidation.error.issues.map((i) => i.message).join(', ')}`,
    };
  }

  // 5. Return success only after final validation
  return {
    success: true,
    draft: finalValidation.data as unknown as ForgeDraft,
  };
}

export interface ProvenanceValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Pure, deterministic source-evidence resolver shared across candidate application,
 * Forge export readiness, and compilation.
 */
export function resolveSourceEvidenceProvenance({
  provenance,
  sourceAnalyses,
  expectedText,
  expectedCastMemberId,
  expectedTarget,
}: {
  provenance: unknown;
  sourceAnalyses?: Record<string, ForgeSourceAnalysis> | null;
  expectedText?: string;
  expectedCastMemberId?: string;
  expectedTarget?: string;
}): ProvenanceValidationResult {
  const errors: string[] = [];

  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return { valid: false, errors: ['Provenance must be a valid object.'] };
  }

  const p = provenance as { kind?: string; sourceId?: string; evidenceIds?: string[] };
  if (p.kind !== 'REVIEWED_SOURCE') {
    return { valid: false, errors: [`Expected REVIEWED_SOURCE provenance kind, received "${p.kind}".`] };
  }

  if (!p.sourceId || typeof p.sourceId !== 'string' || !p.sourceId.trim()) {
    errors.push('Missing or empty sourceId in reviewed source provenance.');
  } else if (p.sourceId === 'src-default' || p.sourceId.startsWith('placeholder-')) {
    errors.push(`Prohibited placeholder sourceId: "${p.sourceId}".`);
  }

  if (!Array.isArray(p.evidenceIds) || p.evidenceIds.length === 0) {
    errors.push('At least one evidence ID is required in reviewed source provenance.');
  } else {
    for (const evId of p.evidenceIds) {
      if (typeof evId !== 'string' || !evId.trim()) {
        errors.push('Evidence IDs must be non-empty strings.');
      } else if (evId === 'ev-extracted' || evId.startsWith('placeholder-')) {
        errors.push(`Prohibited placeholder evidenceId: "${evId}".`);
      }
    }
  }

  // An omitted, null, or empty sourceAnalyses registry is an error for REVIEWED_SOURCE
  if (!sourceAnalyses || Object.keys(sourceAnalyses).length === 0) {
    errors.push('No registered source analyses available to resolve REVIEWED_SOURCE provenance.');
    return { valid: false, errors };
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const sourceId = p.sourceId!;
  const analysis =
    sourceAnalyses[sourceId] ||
    Object.values(sourceAnalyses).find(
      (a) => a.id === sourceId || a.sourceRecord?.id === sourceId
    );

  if (!analysis) {
    errors.push(`Source ID "${sourceId}" is not registered in active source analyses.`);
    return { valid: false, errors };
  }

  const validEvidenceIds = new Set((analysis.evidence || []).map((e) => e.id));
  for (const evId of p.evidenceIds!) {
    if (!validEvidenceIds.has(evId)) {
      errors.push(`Evidence ID "${evId}" does not resolve within registered source "${sourceId}".`);
    }
  }

  // Candidate/evidence linkage and candidate status verification
  const targetToMatch = expectedTarget || (expectedText !== undefined ? 'user_opening_aim_default' : undefined);
  if (targetToMatch) {
    const candidates = (analysis.candidates || []).filter((c) => {
      if (c.target !== targetToMatch) return false;
      if (expectedCastMemberId && c.targetCastMemberId && c.targetCastMemberId !== expectedCastMemberId) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      errors.push(`No candidate for target "${targetToMatch}" found in registered source "${sourceId}".`);
    } else {
      const claimedEvSet = new Set(p.evidenceIds!);
      const matchingCandidate = candidates.find((c) => {
        if (c.reviewDecision !== 'accepted' || c.applicationState !== 'applied') {
          return false;
        }
        const candEvIds = c.evidenceIds || [];
        return candEvIds.some((id) => claimedEvSet.has(id));
      });

      if (!matchingCandidate) {
        const anyAccepted = candidates.some((c) => c.reviewDecision === 'accepted' && c.applicationState === 'applied');
        if (!anyAccepted) {
          errors.push(
            `Candidate for target "${targetToMatch}" in source "${sourceId}" has not been accepted and applied.`
          );
        } else {
          errors.push(
            `Claimed evidence [${p.evidenceIds!.join(', ')}] does not link to any accepted and applied candidate for "${targetToMatch}".`
          );
        }
      } else {
        if (expectedText !== undefined) {
          const trimmedExpected = expectedText.trim();
          const candText =
            typeof matchingCandidate.proposedValue === 'string'
              ? matchingCandidate.proposedValue.trim()
              : typeof matchingCandidate.proposedValue === 'object' &&
                matchingCandidate.proposedValue !== null &&
                'aimText' in matchingCandidate.proposedValue &&
                typeof matchingCandidate.proposedValue.aimText === 'string'
              ? matchingCandidate.proposedValue.aimText.trim()
              : '';
          if (candText !== trimmedExpected) {
            errors.push(
              `Accepted opening aim text "${trimmedExpected}" does not match candidate proposal text "${candText}".`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

