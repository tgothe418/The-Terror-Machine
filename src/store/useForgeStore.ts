import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  Message,
  CharacterProfile,
  ForgePhase,
  ReferenceMaterial,
  ProseStyleVector,
  Blueprint,
  ScenarioBlueprint,
  CharacterPursuit,
} from '../types';
import {
  ForgeDraft,
  ForgeDraftPatch,
  ForgeDraftCastMember,
  ForgeDraftPerspective,
  ForgeDraftTopology,
  ForgeDraftIdentity,
  ForgeDraftSetting,
  ForgeDraftNarrativeRules,
  ForgeSourceAnalysis,
  ForgeSourceAnalysisSchema,
  ForgeSourceUnknown,
  BlueprintAmbiguityDecision,
  DepictionContract,
  DepictionContractProposal,
  DepictionContractProposalSchema,
  ForgeUnknownResolutionProposal,
  ForgeResolutionDraftPatch,
  UserOpeningAim,
  CharacterPresenceDisposition,
  ForgeTopologyNode,
  ForgeSourceCandidate,
  ForgeSourceEvidence,
  ForgeCandidateReviewDecision,
} from '../types/forge';
import { idbStorage } from '../lib/idbStorage';
import {
  applyCandidateToDraft,
  validateCandidateEdit,
  rejectCandidate as rejectCandidatePure,
  setCandidateReviewDecisionPure,
  sortCandidatesForApplication,
  applyResolutionDraftPatch,
  resolveSourceEvidenceProvenance,
  isCompleteAuthoredDepictionContract,
  reconcileDraftTopologyAndCast,
} from '../lib/sourceBaseline';
import { ensureVillainCastMember } from '../lib/castVillain';
import { createNeutralSeed } from '../lib/neutralSeed';

export const defaultStyleVector: ProseStyleVector = {
  sentenceStructure: 'clinical-flat',
  vocabularyTier: 'clinical',
  sensoryFocus: ['metallic friction', 'micro-expressions', 'spatial geometry'],
  thematicCore: 'objective observation of deteriorating systems',
  forbiddenDevices: [
    'cinematic camera angles',
    'metaphors and similes',
    'forced colloquialisms',
    'suddenly or unexpectedly',
    'internal emotional assumptions',
  ],
};

// Ephemeral, non-canonical, non-persisted runtime map: analysisId -> serverIssuedBinding
export const runtimeSourceBindings = new Map<string, string>();

export function setRuntimeSourceBinding(analysisId: string, binding: string): void {
  runtimeSourceBindings.set(analysisId, binding);
}

export function getRuntimeSourceBinding(analysisId: string): string | undefined {
  return runtimeSourceBindings.get(analysisId);
}

export function removeRuntimeSourceBinding(analysisId: string): string | undefined {
  const binding = runtimeSourceBindings.get(analysisId);
  runtimeSourceBindings.delete(analysisId);
  return binding;
}

export function clearRuntimeSourceBindings(): void {
  runtimeSourceBindings.clear();
}

export interface ServerBindingOperationResult {
  success: boolean;
  code?: string;
  error?: string;
}

export async function notifyServerRevokeBinding(binding: string): Promise<ServerBindingOperationResult> {
  if (!binding || binding.trim().length === 0) {
    return { success: true };
  }
  try {
    const res = await fetch('/api/revoke-source-binding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceBinding: binding }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        success: false,
        code: data.code || `HTTP_${res.status}`,
        error: data.error || 'Revocation failed',
      };
    }
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      code: 'NETWORK_ERROR',
      error: err instanceof Error ? err.message : 'Network error during revocation',
    };
  }
}

export async function notifyServerCloseUnknown(binding: string, unknownId: string): Promise<ServerBindingOperationResult> {
  if (!binding || binding.trim().length === 0 || !unknownId || unknownId.trim().length === 0) {
    return { success: true };
  }
  try {
    const res = await fetch('/api/close-unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceBinding: binding, unknownId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        success: false,
        code: data.code || `HTTP_${res.status}`,
        error: data.error || 'Closure failed',
      };
    }
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      code: 'NETWORK_ERROR',
      error: err instanceof Error ? err.message : 'Network error during closure',
    };
  }
}

// Re-export type aliases for backward compatibility across Forge components
export type DraftIdentity = ForgeDraftIdentity;
export type DraftCastMember = ForgeDraftCastMember;
export type DraftPerspective = ForgeDraftPerspective;
export type DraftTopology = ForgeDraftTopology;
export type DraftSetting = ForgeDraftSetting;
export type DraftNarrativeRules = ForgeDraftNarrativeRules;
export type DraftBlueprint = ForgeDraft;
export type DraftBlueprintPatch = ForgeDraftPatch;

/**
 * Sanitizes and normalizes persisted or incoming sourceAnalyses state.
 * Migrates legacy candidate reviewState to reviewDecision & applicationState.
 * Ensures unknowns conform to strict authoring lifecycle schema.
 * Deduplicates entries saved under alias keys by indexing strictly by analysis.id,
 * and discards any malformed records that fail schema validation.
 */
export function sanitizeSourceAnalyses(value: unknown): Record<string, ForgeSourceAnalysis> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, ForgeSourceAnalysis> = {};
  const entries = Object.values(value as Record<string, unknown>);
  for (const rawItem of entries) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = { ...(rawItem as Record<string, unknown>) };

    // Migrate candidates
    if (Array.isArray(item.candidates)) {
      item.candidates = item.candidates.map((c: unknown) => {
        if (!c || typeof c !== 'object') return c;
        const cand = { ...(c as Record<string, unknown>) };
        if (cand.reviewState && !cand.reviewDecision) {
          if (cand.reviewState === 'accepted') {
            cand.reviewDecision = 'accepted';
            cand.applicationState = cand.applicationState || 'applied';
          } else if (cand.reviewState === 'rejected') {
            cand.reviewDecision = 'rejected';
            cand.applicationState = cand.applicationState || 'staged';
          } else {
            cand.reviewDecision = 'accepted';
            cand.applicationState = 'staged';
          }
          delete cand.reviewState;
        }
        if (!cand.reviewDecision) cand.reviewDecision = 'accepted';
        if (!cand.applicationState) cand.applicationState = 'staged';
        return cand;
      });
    }

    // Migrate unknowns
    if (Array.isArray(item.unknowns)) {
      item.unknowns = item.unknowns.map((u: unknown) => {
        if (!u || typeof u !== 'object') return u;
        const unk = { ...(u as Record<string, unknown>) };
        if (!unk.status) unk.status = 'queued';
        if (!unk.targetEffect || typeof unk.targetEffect !== 'string' || !unk.targetEffect.trim()) {
          unk.targetEffect = `Clarifies ${unk.category || 'scenario'} baseline parameters for execution.`;
        }
        if (!Array.isArray(unk.followUps)) {
          unk.followUps = [];
        }
        return unk;
      });
    }

    const parse = ForgeSourceAnalysisSchema.safeParse(item);
    if (parse.success) {
      const analysis = parse.data;
      result[analysis.id] = analysis;
    }
  }
  return result;
}

export interface ActiveUnknownContext {
  sourceId: string;
  sourceFileName?: string;
  unknown: ForgeSourceUnknown;
  queueIndex: number;
  totalCount: number;
  resolvedCount: number;
}

/**
 * Deterministically selects the current active unknown in the Forge authoring queue.
 * Orders source analyses by receivedAt ascending, then sourceId.
 * Selects the first unresolved item (not 'resolved' and not 'contextual_discretion').
 */
export function selectActiveUnknown(state: ForgeState): ActiveUnknownContext | null {
  if (!state.sourceAnalyses || typeof state.sourceAnalyses !== 'object') {
    return null;
  }

  const sortedAnalyses = Object.values(state.sourceAnalyses).sort((a, b) => {
    const diff = (a.sourceRecord.receivedAt || 0) - (b.sourceRecord.receivedAt || 0);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  const allUnknowns: Array<{ sourceId: string; sourceFileName?: string; unknown: ForgeSourceUnknown }> = [];
  for (const analysis of sortedAnalyses) {
    if (analysis.unknowns && Array.isArray(analysis.unknowns)) {
      for (const unk of analysis.unknowns) {
        allUnknowns.push({
          sourceId: analysis.id,
          sourceFileName: analysis.sourceRecord.fileName,
          unknown: unk,
        });
      }
    }
  }

  const totalCount = allUnknowns.length;
  if (totalCount === 0) return null;

  const resolvedCount = allUnknowns.filter(
    (item) => item.unknown.status === 'resolved' || item.unknown.status === 'contextual_discretion'
  ).length;

  const activeIdx = allUnknowns.findIndex(
    (item) => item.unknown.status !== 'resolved' && item.unknown.status !== 'contextual_discretion'
  );

  if (activeIdx === -1) {
    return null;
  }

  const activeItem = allUnknowns[activeIdx];
  return {
    sourceId: activeItem.sourceId,
    sourceFileName: activeItem.sourceFileName,
    unknown: activeItem.unknown,
    queueIndex: activeIdx + 1,
    totalCount,
    resolvedCount,
  };
}

export function sanitizeCastPresenceDispositions(
  cast: ForgeDraftCastMember[] | undefined
): ForgeDraftCastMember[] | undefined {
  if (!cast || !Array.isArray(cast)) return cast;
  return cast.map((member) => {
    if (!member.presenceDisposition || typeof member.presenceDisposition !== 'object') {
      return member;
    }
    const disp = member.presenceDisposition as Record<string, unknown>;
    const kind = disp.kind;
    if (kind === 'AT_NODE' && typeof disp.nodeId === 'string' && disp.nodeId.trim().length > 0) {
      return {
        ...member,
        presenceDisposition: {
          kind: 'AT_NODE',
          nodeId: disp.nodeId.trim(),
        },
      };
    } else if (kind === 'OFFSTAGE') {
      return {
        ...member,
        presenceDisposition: {
          kind: 'OFFSTAGE',
        },
      };
    } else if (kind === 'NONLOCAL') {
      return {
        ...member,
        presenceDisposition: {
          kind: 'NONLOCAL',
        },
      };
    } else {
      // Invalid disposition shape -> clear rather than inventing a fake location
      const rest = { ...member };
      delete rest.presenceDisposition;
      return rest;
    }
  });
}

// ============================================================================
// DERIVED COMPATIBILITY ADAPTERS (Phase 3D-1 Single Source of Truth)
// forgeDraft is the sole mutable authoring authority. The helpers below
// derive legacy-shaped views directly from forgeDraft without duplicate state.
// ============================================================================
export function deriveCastLedger(draft: ForgeDraft | null): CastMember[] {
  if (!draft || !draft.cast) return [];
  return draft.cast.map((c) => ({
    id: c.id || '',
    name: c.name || '',
    role: (c.role as CastRole) || 'PROTAGONIST',
    psychological_status: c.psychological_status || '',
    starting_location: c.starting_location || 'NODE_INIT',
    isEntity: c.isEntity ?? false,
  }));
}

export function deriveTopology(draft: ForgeDraft | null): Record<string, string[]> {
  if (!draft || !draft.topology || !draft.topology.nodes || draft.topology.nodes.length === 0) {
    return { NODE_INIT: [] };
  }
  const result: Record<string, string[]> = {};
  for (const node of draft.topology.nodes) {
    result[node] = [];
  }
  for (const conn of draft.topology.connections || []) {
    if (typeof conn === 'string') {
      const parts = conn.split('->').map((s) => s.trim());
      if (parts.length === 2) {
        const [from, to] = parts;
        if (!result[from]) result[from] = [];
        if (!result[from].includes(to)) result[from].push(to);
        if (!result[to]) result[to] = [];
        if (!result[to].includes(from)) result[to].push(from);
      }
    } else if (conn && typeof conn === 'object' && conn.from && conn.to) {
      if (!result[conn.from]) result[conn.from] = [];
      if (!result[conn.from].includes(conn.to)) result[conn.from].push(conn.to);
      if (!result[conn.to]) result[conn.to] = [];
      if (!result[conn.to].includes(conn.from)) result[conn.to].push(conn.from);
    }
  }
  return result;
}

export type CastRole = 'PROTAGONIST' | 'ANTAGONIST' | 'SENTINEL' | 'ENTITY' | 'OBSERVER';

export interface CastMember {
  id: string;
  name: string;
  role: CastRole;
  psychological_status: string;
  starting_location: string;
  isEntity?: boolean;
}

export interface EntityMemoryState {
  tacticalImperative: string;
  somaticState: string[];
  relationalWeb: string[];
  systemFlags?: string[];
}

export interface ArchitectMessage {
  role: 'architect' | 'user';
  content: string;
}

export interface SimulationPerspective {
  role?: string;
  startingSemanticState?:
    | string
    | {
        soma?: string[];
        geom?: string[];
        imp?: string;
      };
}

export interface SimulationBlueprintInput {
  perspectives?: SimulationPerspective[] | DraftPerspective[];
}

export interface ForgeActions {
  // --- CANONICAL FORGE DRAFT ACTIONS (Phase 3D-1 Single Source of Truth) ---
  initializeDraft: (initial?: ForgeDraftPatch) => void;
  replaceDraft: (draft: ForgeDraft) => void;
  updateDraft: (updates: ForgeDraftPatch) => void;
  removeReference: (fileName: string) => void;
  resetStore: () => void;
  clearHistory: () => void;

  // --- SOURCE INTAKE & CANDIDATE STAGING ACTIONS ---
  registerSourceAnalysis: (analysis: ForgeSourceAnalysis, sourceBinding?: string) => void;
  setCandidateReviewDecision: (
    sourceId: string,
    candidateId: string,
    decision: 'accepted' | 'rejected'
  ) => void;
  editStagedCandidate: (sourceId: string, candidateId: string, editedValue: unknown) => void;
  applyAcceptedCandidates: (
    sourceId: string
  ) => { success: true; appliedCandidateIds: string[] } | { success: false; errors: Record<string, string> };
  applyImportedSourceBaseline: (
    sourceAnalysisId: string
  ) => { success: true } | { success: false; error: string };
  runDetailPass: (
    sourceId: string
  ) => Promise<{ success: boolean; newCandidateCount?: number; error?: string }>;
  runQuestionnaireExtraction: (
    sourceId: string,
    families?: string[]
  ) => Promise<{ success: boolean; newCandidateCount?: number; error?: string }>;
  mergeSweepCandidates: (
    newCandidates: ForgeSourceCandidate[],
    newEvidence: ForgeSourceEvidence[],
    sourceId?: string
  ) => void;
  removeSourceAnalysis: (sourceId: string) => void;

  // Deprecated compatibility aliases for candidates
  editPendingCandidate: (sourceId: string, candidateId: string, editedValue: unknown) => void;
  rejectCandidate: (sourceId: string, candidateId: string) => void;

  // --- USER CHARACTER, PLACEMENT & OPENING AIM ACTIONS (Packet 1C-5, 1C-6, 1C-9) ---
  addCastMember: (member?: Partial<ForgeDraftCastMember>) => { success: boolean; characterId?: string; error?: string };
  updateCastMember: (id: string, updates: Partial<ForgeDraftCastMember>) => { success: boolean; error?: string };
  removeCastMember: (id: string) => { success: boolean; error?: string };
  setCastOpeningPlacement: (
    characterId: string,
    disposition: CharacterPresenceDisposition
  ) => { success: boolean; error?: string };
  setUserCharacter: (characterId: string) => { success: boolean; error?: string };
  acceptReferenceOpeningAim: (sourceId?: string) => { success: boolean; error?: string };
  setCreatorOverrideOpeningAim: (aimText: string) => { success: boolean; error?: string };
  setNoneDeclaredOpeningAim: () => { success: boolean; error?: string };
  setPursuitReview: (
    characterId: string,
    state: 'REVIEWED' | 'REVIEWED_NONE' | 'UNREVIEWED',
    pursuitData?: Partial<CharacterPursuit>
  ) => { success: boolean; error?: string };

  // --- TOPOLOGY & STORY MAP ACTIONS (Packet 1C-11) ---
  setStartingNode: (nodeId: string) => { success: boolean; error?: string };
  addTopologyNode: (node: ForgeTopologyNode) => { success: boolean; error?: string };
  removeTopologyNode: (nodeId: string) => { success: boolean; error?: string };

  // --- AMBIGUITY RESOLUTION ACTIONS ---
  submitUnknownAnswer: (sourceId: string, unknownId: string, answer: string) => void;
  receiveUnknownFollowUp: (sourceId: string, unknownId: string, followUpQuestion: string) => void;
  receiveUnknownProposal: (
    sourceId: string,
    unknownId: string,
    proposal: ForgeUnknownResolutionProposal
  ) => void;
  acceptUnknownResolution: (
    sourceId: string,
    unknownId: string,
    resolutionOverride?: string,
    applyDraftPatch?: boolean
  ) => { success: true } | { success: false; error: string };
  leaveUnknownUncertain: (sourceId: string, unknownId: string, guidance?: string) => void;
  leaveAllUnknownsUncertain: (sourceId?: string) => void;
  setUnknownError: (sourceId: string, unknownId: string, error: string) => void;
  retryUnknown: (sourceId: string, unknownId: string) => void;
  editUnknownProposal: (
    sourceId: string,
    unknownId: string,
    resolution: string,
    targetEffect?: string,
    replacementPatch?: ForgeResolutionDraftPatch
  ) => void;

  // --- DEPICTION CONTRACT ACTIONS (Packet 1B Isolated Proposal / Packet 04A Revision-Bound Complete Proposal) ---
  setPendingDepictionContractProposal: (
    proposal: DepictionContractProposal | null
  ) => void;
  applyPendingDepictionContractProposal: () =>
    | { success: true }
    | { success: false; error: string; stale?: boolean };
  dismissPendingDepictionContractProposal: () => void;
  updateDepictionContractField: (field: keyof DepictionContract, value: string) => void;

  // --- ARCHITECT CHAT (PROPOSAL-ONLY IN PHASE 3D-1) ---
  addArchitectMessage: (message: ArchitectMessage) => void;
  clearArchitectChat: () => void;

  // --- QUARANTINED LEGACY FORGE ACTIONS (Retained for temporary UI bridging) ---
  addSpatialNode: (nodeId: string) => void;
  removeSpatialNode: (nodeId: string) => void;
  toggleSpatialEdge: (nodeA: string, nodeB: string) => void;
  updateActiveMemory: (updates: Partial<EntityMemoryState>) => void;
  commitSemanticTags: (parsedTags: Record<string, string[]>) => void;
  setWho: (val: string) => void;
  setWhat: (val: string) => void;
  setWhere: (val: string) => void;
  setWhen: (val: string) => void;
  setWhyHow: (val: string) => void;
  clearForgeInputs: () => void;
  addMessage: (message: Message) => void;
  setAvailableReferenceCharacters: (characters: CharacterProfile[]) => void;
  addCharacterToCast: (character: CharacterProfile) => void;
  removeCharacterFromCast: (id: string) => void;
  updateCharacterDetails: (id: string, updates: Partial<CharacterProfile>) => void;
  setHasReferenceMaterial: (has: boolean) => void;
  setForgePhase: (phase: ForgePhase) => void;
  setSummaryContext: (context: string) => void;
  setExtractedSetting: (setting: string) => void;
  setExtractedThreat: (threat: string) => void;
  setExtractedStyle: (style: string) => void;
  addReferenceMaterials: (materials: ReferenceMaterial[]) => void;
  removeReferenceMaterial: (id: string) => void;
  setActiveNeuralLink: (role: 'PROTAGONIST' | 'ANTAGONIST' | 'DIRECTOR') => void;
  setActiveCharacterId: (id: string | null) => void;
  startSimulation: (
    blueprint?: SimulationBlueprintInput | DraftBlueprint | Blueprint | ScenarioBlueprint | null
  ) => void;
}

export interface ForgeState {
  // --- CANONICAL FORGE AUTHORING STATE ---
  forgeDraft: ForgeDraft | null;
  /**
   * @deprecated Read/write forgeDraft instead. Synchronized alias to forgeDraft for legacy callers.
   */
  draftBlueprint: ForgeDraft | null;
  draftRevision: number;
  sourceBaselineRevision: number;

  // --- DEPICTION CONTRACT PROPOSAL STATE (Packet 04A Revision-Bound Complete Proposal) ---
  pendingDepictionContractProposal: DepictionContractProposal | null;

  // --- SOURCE INTAKE STATE (Phase 3D-2) ---
  sourceAnalyses: Record<string, ForgeSourceAnalysis>;
  candidates: ForgeSourceCandidate[];
  evidence: ForgeSourceEvidence[];
  questionnaireFailedBatteries: string[];
  questionnaireElicitations: Record<string, unknown>;
  mergeSweepCandidates?: (
    newCandidates: ForgeSourceCandidate[],
    newEvidence: ForgeSourceEvidence[],
    sourceId?: string
  ) => void;

  // --- ARCHITECT CHAT STATE ---
  architectMessages: ArchitectMessage[];

  // --- QUARANTINED LEGACY STATE ---
  castLedger: CastMember[];
  topology: Record<string, string[]>;
  activeMemory: EntityMemoryState;
  messages: Message[];
  availableReferenceCharacters: CharacterProfile[];
  selectedCharacters: CharacterProfile[];
  hasReferenceMaterial: boolean;
  forgePhase: ForgePhase;
  summaryContext: string;
  referenceMaterials: ReferenceMaterial[];
  extractedSetting: string;
  extractedThreat: string;
  extractedStyle: string;
  who: string;
  what: string;
  where: string;
  when: string;
  whyHow: string;
  activeNeuralLink: 'PROTAGONIST' | 'ANTAGONIST' | 'DIRECTOR';
  activeCharacterId: string | null;
}

const createInitialDraft = (initial?: ForgeDraftPatch): ForgeDraft => ({
  id: initial?.id || crypto.randomUUID(),
  title: initial?.title || initial?.identity?.title || '',
  premise: initial?.premise || initial?.globalPremise || '',
  globalPremise: initial?.globalPremise || initial?.premise || '',
  startingVector: initial?.startingVector || 'COGNITIVE',
  startingTier: initial?.startingTier || 'LATENT',
  environmentalRules: initial?.environmentalRules !== undefined ? initial.environmentalRules : '',
  constraints: initial?.constraints || [],
  contentScale: initial?.contentScale ?? 3,
  contentLevelDescription: initial?.contentLevelDescription || 'Standard',
  identity: {
    title: initial?.identity?.title || initial?.title || '',
    version: initial?.identity?.version || '1.0',
    author: initial?.identity?.author || '',
    thematicAnchor: initial?.identity?.thematicAnchor || '',
  },
  setting: {
    location: initial?.setting?.location || '',
    atmosphere: initial?.setting?.atmosphere || '',
    timePeriod: initial?.setting?.timePeriod || '',
  },
  userCharacterId: initial?.userCharacterId || undefined,
  userOpeningAim: initial?.userOpeningAim ? { ...initial.userOpeningAim } : undefined,
  cast: initial?.cast
    ? initial.cast.map(c => (c.seed ? { ...c } : { ...c, seed: createNeutralSeed(c, initial) }))
    : [],
  perspectives: initial?.perspectives ? [...initial.perspectives] : [],
  topology: {
    startingNodeId: initial?.topology?.startingNodeId || undefined,
    startingNodeProvenance: initial?.topology?.startingNodeProvenance
      ? { ...initial.topology.startingNodeProvenance }
      : undefined,
    nodes: initial?.topology?.nodes ? [...initial.topology.nodes] : [],
    nodeDefinitions: initial?.topology?.nodeDefinitions ? [...initial.topology.nodeDefinitions] : [],
    connections: initial?.topology?.connections ? [...initial.topology.connections] : [],
    anchors: initial?.topology?.anchors ? [...initial.topology.anchors] : [],
  },
  narrativeRules: {
    incitingIncident: initial?.narrativeRules?.incitingIncident || '',
    phaseDirectives: initial?.narrativeRules?.phaseDirectives ? { ...initial.narrativeRules.phaseDirectives } : {},
    currentTensionLevel: initial?.narrativeRules?.currentTensionLevel || 'buildup',
    keyPlotElements: initial?.narrativeRules?.keyPlotElements ? [...initial.narrativeRules.keyPlotElements] : [],
    pacingDirectives: initial?.narrativeRules?.pacingDirectives,
  },
  references: initial?.references ? [...initial.references] : [],
  ambiguities: initial?.ambiguities ? [...initial.ambiguities] : [],
  depictionContract: initial?.depictionContract
    ? {
        dramaticRegister: initial.depictionContract.dramaticRegister || '',
        directness: initial.depictionContract.directness || '',
        aftermath: initial.depictionContract.aftermath || '',
        ambiguityHandling: initial.depictionContract.ambiguityHandling || '',
        specialBoundaries: initial.depictionContract.specialBoundaries || '',
      }
    : {
        dramaticRegister: '',
        directness: '',
        aftermath: '',
        ambiguityHandling: '',
        specialBoundaries: '',
      },
  terminalConditions: initial?.terminalConditions,
  characters: initial?.characters ? [...initial.characters] : [],
  hauntedHouse: initial?.hauntedHouse,
  horrorGrammar: initial?.horrorGrammar
    ? {
        valueBaselineReview: initial.horrorGrammar.valueBaselineReview || 'UNREVIEWED',
        pursuitReviews: initial.horrorGrammar.pursuitReviews ? { ...initial.horrorGrammar.pursuitReviews } : {},
        valueAnchors: initial.horrorGrammar.valueAnchors ? [...initial.horrorGrammar.valueAnchors] : [],
        characterPursuits: initial.horrorGrammar.characterPursuits ? [...initial.horrorGrammar.characterPursuits] : [],
      }
    : {
        valueBaselineReview: 'UNREVIEWED',
        pursuitReviews: {},
        valueAnchors: [],
        characterPursuits: [],
      },
  deathContract: initial?.deathContract
    ? {
        metaphysics: initial.deathContract.deathMetaphysics || initial.deathContract.metaphysics || 'mundane',
        deathMetaphysics: initial.deathContract.deathMetaphysics || initial.deathContract.metaphysics || 'mundane',
        powerBudget: initial.deathContract.powerBudget || 'Standard mortal and physical constraints.',
        seatSuccession: initial.deathContract.seatSuccession ? { ...initial.deathContract.seatSuccession } : {},
      }
    : {
        metaphysics: 'mundane',
        deathMetaphysics: 'mundane',
        powerBudget: 'Standard mortal and physical constraints.',
        seatSuccession: {},
      },
  fearContract: initial?.fearContract
    ? {
        fearlessness: { ...initial.fearContract.fearlessness },
        mortalityBelief: { ...initial.fearContract.mortalityBelief },
        threatWeights: { life: 1.0, freedom: 1.0, identity: 1.0, ...(initial.fearContract.threatWeights || {}) },
        lambdaDecay: initial.fearContract.lambdaDecay ?? 0.35,
        residueRatio: initial.fearContract.residueRatio ?? 0.25,
        preyEnterThreshold: initial.fearContract.preyEnterThreshold ?? 0.70,
        preyExitThreshold: initial.fearContract.preyExitThreshold ?? 0.40,
        somaticBands: initial.fearContract.somaticBands || { band1: 0.25, band2: 0.5, band3: 0.75, band4: 0.9 },
        releaseValves: initial.fearContract.releaseValves ? [...initial.fearContract.releaseValves] : [],
        villainGazeAuthorized: initial.fearContract.villainGazeAuthorized ?? false,
        submitResponse: initial.fearContract.submitResponse ? { ...initial.fearContract.submitResponse } : {},
      }
    : {
        fearlessness: {},
        mortalityBelief: {},
        threatWeights: { life: 1.0, freedom: 1.0, identity: 1.0 },
        lambdaDecay: 0.35,
        residueRatio: 0.25,
        preyEnterThreshold: 0.70,
        preyExitThreshold: 0.40,
        somaticBands: { band1: 0.25, band2: 0.5, band3: 0.75, band4: 0.9 },
        releaseValves: [],
        villainGazeAuthorized: false,
        submitResponse: {},
      },
});

/**
 * Structural view for legacy/dynamic candidate fields (targetType,
 * normalizedKey) that predate the ForgeSourceCandidate discriminated union.
 * Prefer this over `any` when probing for their presence.
 */
type CandidateLegacyFields = {
  targetType?: unknown;
  normalizedKey?: unknown;
};

const candidateLegacyFields = (c: ForgeSourceCandidate): CandidateLegacyFields =>
  c as unknown as CandidateLegacyFields;

/**
 * Legacy sweeps persisted review statuses outside the current
 * ('accepted' | 'rejected') enum ('STAGED', 'APPROVED', 'REJECTED', ...).
 * Normalize them to the modern enum instead of casting: anything
 * rejection-like becomes 'rejected', everything else (including a missing
 * value) becomes 'accepted', matching sanitizeSourceAnalyses' default.
 * Without this, legacy values match neither downstream filter and the
 * candidate silently disappears from review queues.
 */
function normalizeLegacyReviewDecision(value: unknown): ForgeCandidateReviewDecision {
  const upper = String(value ?? '').toUpperCase().trim();
  return upper === 'REJECTED' ? 'rejected' : 'accepted';
}

const initialState: ForgeState = {
  forgeDraft: null,
  draftBlueprint: null,
  draftRevision: 1,
  sourceBaselineRevision: 1,
  pendingDepictionContractProposal: null,
  sourceAnalyses: {},
  candidates: [],
  evidence: [],
  questionnaireFailedBatteries: [],
  questionnaireElicitations: {},
  architectMessages: [
    {
      role: 'architect',
      content: 'I am the Architect. Tell me what kind of nightmare we are building today.',
    },
  ],
  castLedger: [],
  topology: {
    NODE_INIT: [],
  },
  activeMemory: {
    tacticalImperative: 'Survive and assess the immediate surroundings.',
    somaticState: ['Baseline health'],
    relationalWeb: ['Subject is isolated.'],
  },
  messages: [
    {
      role: 'assistant',
      content: 'Forge Initialized. Architect online. Describe the foundation of your nightmare.',
      timestamp: Date.now(),
    },
  ],
  availableReferenceCharacters: [],
  selectedCharacters: [],
  hasReferenceMaterial: false,
  forgePhase: 'CAST_EXTRACTION',
  summaryContext: '',
  referenceMaterials: [],
  extractedSetting: '',
  extractedThreat: '',
  extractedStyle: '',
  who: '',
  what: '',
  where: '',
  when: '',
  whyHow: '',
  activeNeuralLink: 'PROTAGONIST',
  activeCharacterId: null,
};

export type ForgeStore = ForgeState & { actions: ForgeActions };

export const useForgeStoreInternal = create<ForgeStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      mergeSweepCandidates: (
        newCandidates: ForgeSourceCandidate[],
        newEvidence: ForgeSourceEvidence[],
        sourceId?: string
      ) => {
        get().actions.mergeSweepCandidates(newCandidates, newEvidence, sourceId);
      },
      actions: {
        // --- CANONICAL DRAFT ACTIONS ---
        initializeDraft: (initial?: ForgeDraftPatch) => {
          const draft = createInitialDraft(initial);
          set({
            forgeDraft: draft,
            draftBlueprint: draft,
            draftRevision: 1,
            sourceBaselineRevision: 1,
            pendingDepictionContractProposal: null,
            castLedger: deriveCastLedger(draft),
            topology: deriveTopology(draft),
          });
        },

        replaceDraft: (draft: ForgeDraft) => {
          const clonedDraft = JSON.parse(JSON.stringify(draft));
          set((state: ForgeState) => ({
            forgeDraft: clonedDraft,
            draftBlueprint: clonedDraft,
            draftRevision: (state.draftRevision || 0) + 1,
            castLedger: deriveCastLedger(clonedDraft),
            topology: deriveTopology(clonedDraft),
          }));
        },

        updateDraft: (updates: ForgeDraftPatch) => {
          set((state: ForgeState) => {
            const current = state.forgeDraft || createInitialDraft();
            const merged: ForgeDraft = {
              ...current,
              ...updates,
              // Deep-merge identity if provided in patch
              identity: {
                ...current.identity,
                ...(updates.identity || {}),
                title: updates.title !== undefined ? updates.title : (updates.identity?.title !== undefined ? updates.identity.title : current.identity?.title || current.title || ''),
              },
              title: updates.title !== undefined ? updates.title : (updates.identity?.title !== undefined ? updates.identity.title : current.title || current.identity?.title || ''),
              premise: updates.premise !== undefined ? updates.premise : (updates.globalPremise !== undefined ? updates.globalPremise : current.premise || current.globalPremise || ''),
              globalPremise: updates.globalPremise !== undefined ? updates.globalPremise : (updates.premise !== undefined ? updates.premise : current.globalPremise || current.premise || ''),
              // Deep-merge setting if provided
              setting: updates.setting !== undefined ? { ...current.setting, ...updates.setting } : current.setting,
              // Preserve nested objects/arrays unless explicitly updated
              cast: updates.cast !== undefined ? updates.cast : current.cast,
              perspectives: updates.perspectives !== undefined ? updates.perspectives : current.perspectives,
              topology: updates.topology !== undefined ? updates.topology : current.topology,
              narrativeRules: updates.narrativeRules !== undefined ? updates.narrativeRules : current.narrativeRules,
              references: updates.references !== undefined ? updates.references : current.references,
              ambiguities: updates.ambiguities !== undefined ? updates.ambiguities : current.ambiguities,
              depictionContract: updates.depictionContract !== undefined
                ? (typeof updates.depictionContract === 'object' && updates.depictionContract !== null
                    ? { ...current.depictionContract, ...updates.depictionContract }
                    : updates.depictionContract)
                : current.depictionContract,
              userOpeningAim: updates.userOpeningAim !== undefined ? updates.userOpeningAim : current.userOpeningAim,
              horrorGrammar: updates.horrorGrammar !== undefined
                ? (typeof updates.horrorGrammar === 'object' && updates.horrorGrammar !== null
                    ? { ...current.horrorGrammar, ...updates.horrorGrammar }
                    : updates.horrorGrammar)
                : current.horrorGrammar,
            };
            const safeMerged = reconcileDraftTopologyAndCast(merged);

            return {
              forgeDraft: safeMerged,
              draftBlueprint: safeMerged,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(safeMerged),
              topology: deriveTopology(safeMerged),
            };
          });
        },

        removeReference: (fileName: string) => {
          const state = get();
          for (const [id, analysis] of Object.entries(state.sourceAnalyses || {}) as [string, ForgeSourceAnalysis][]) {
            if (analysis?.sourceRecord?.fileName === fileName) {
              const binding = removeRuntimeSourceBinding(id);
              if (binding) {
                notifyServerRevokeBinding(binding);
              }
            }
          }

          set((state: ForgeState) => {
            if (!state.forgeDraft) return state;
            const updatedRefs = (state.forgeDraft.references || []).filter((ref) => ref !== fileName);
            const updatedDraft: ForgeDraft = {
              ...state.forgeDraft,
              references: updatedRefs,
            };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          });
        },

        resetStore: () => {
          for (const binding of runtimeSourceBindings.values()) {
            notifyServerRevokeBinding(binding);
          }
          clearRuntimeSourceBindings();
          set(initialState);
        },
        clearHistory: () => {
          for (const binding of runtimeSourceBindings.values()) {
            notifyServerRevokeBinding(binding);
          }
          clearRuntimeSourceBindings();
          set(initialState);
        },

        // --- DEPICTION CONTRACT ACTIONS (Packet 1B Isolated Proposal / Packet 04A Revision-Bound Complete Proposal) ---
        setPendingDepictionContractProposal: (
          proposal: DepictionContractProposal | null
        ) => {
          if (proposal === null) {
            set({ pendingDepictionContractProposal: null });
            return;
          }
          const parseResult = DepictionContractProposalSchema.safeParse(proposal);
          if (!parseResult.success) {
            console.warn('[FORGE DEPICTION CONTRACT] Rejected invalid proposal:', parseResult.error);
            return;
          }
          set({
            pendingDepictionContractProposal: parseResult.data,
          });
        },

        applyPendingDepictionContractProposal: () => {
          let outcome:
            | { success: true }
            | { success: false; error: string; stale?: boolean } = {
            success: true,
          };

          set((state: ForgeState) => {
            const proposal = state.pendingDepictionContractProposal;
            if (!proposal) {
              outcome = { success: false, error: 'No pending depiction contract proposal' };
              return state;
            }

            // Recheck both proposal revisions against current state inside the action
            const currentDraftRevision = state.draftRevision || 1;
            const currentBaselineRevision = state.sourceBaselineRevision || 1;

            if (
              proposal.sourceDraftRevision !== currentDraftRevision ||
              proposal.sourceBaselineRevision !== currentBaselineRevision
            ) {
              outcome = {
                success: false,
                error: `Proposal is stale (source draft r${proposal.sourceDraftRevision}/base r${proposal.sourceBaselineRevision} vs current draft r${currentDraftRevision}/base r${currentBaselineRevision})`,
                stale: true,
              };
              // A stale proposal remains stored and produces a failure result; it does not change the draft or either revision.
              return state;
            }

            const currentDraft = state.forgeDraft || createInitialDraft();
            const updatedContract: DepictionContract = {
              dramaticRegister: proposal.contract.dramaticRegister,
              directness: proposal.contract.directness,
              aftermath: proposal.contract.aftermath,
              ambiguityHandling: proposal.contract.ambiguityHandling,
              specialBoundaries: proposal.contract.specialBoundaries || '',
            };

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              depictionContract: updatedContract,
            };

            outcome = { success: true };

            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              pendingDepictionContractProposal: null,
              draftRevision: (state.draftRevision || 0) + 1,
            };
          });

          return outcome;
        },

        dismissPendingDepictionContractProposal: () => {
          set({ pendingDepictionContractProposal: null });
        },

        updateDepictionContractField: (field: keyof DepictionContract, value: string) => {
          set((state: ForgeState) => {
            const currentDraft = state.forgeDraft || createInitialDraft();
            const currentContract: DepictionContract = {
              dramaticRegister: currentDraft.depictionContract?.dramaticRegister || '',
              directness: currentDraft.depictionContract?.directness || '',
              aftermath: currentDraft.depictionContract?.aftermath || '',
              ambiguityHandling: currentDraft.depictionContract?.ambiguityHandling || '',
              specialBoundaries: currentDraft.depictionContract?.specialBoundaries || '',
            };

            const updatedContract: DepictionContract = {
              ...currentContract,
              [field]: value,
            };

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              depictionContract: updatedContract,
            };

            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
            };
          });
        },

        // --- SOURCE INTAKE & SCENARIO BASELINE ACTIONS ---
        registerSourceAnalysis: (analysis: ForgeSourceAnalysis, sourceBinding?: string) =>
          set((state: ForgeState) => {
            const parse = ForgeSourceAnalysisSchema.safeParse(analysis);
            if (!parse.success) {
              console.warn('[FORGE BASELINE] Rejected malformed source analysis:', parse.error);
              return state;
            }
            const validAnalysis = parse.data;
            if (sourceBinding && sourceBinding.trim().length > 0) {
              setRuntimeSourceBinding(validAnalysis.id, sourceBinding.trim());
            }
            const activeBinding = getRuntimeSourceBinding(validAnalysis.id);
            if (!activeBinding || activeBinding.trim().length === 0) {
              console.warn(
                `[FORGE BASELINE] Rejected source analysis "${validAnalysis.id}": missing valid server-issued sourceBinding.`
              );
              return state;
            }
            const existing = state.sourceAnalyses[validAnalysis.id];
            if (existing && JSON.stringify(existing) === JSON.stringify(validAnalysis)) {
              return state;
            }
            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [validAnalysis.id]: validAnalysis,
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        setCandidateReviewDecision: (
          sourceId: string,
          candidateId: string,
          decision: 'accepted' | 'rejected'
        ) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const cand = analysis.candidates.find((c) => c.id === candidateId);
            if (!cand) return state;

            // Semantic no-op check
            if (cand.reviewDecision === decision) {
              return state;
            }

            const updatedCand = setCandidateReviewDecisionPure(cand, decision);
            const updatedCandidates = analysis.candidates.map((c) =>
              c.id === candidateId ? updatedCand : c
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  candidates: updatedCandidates,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        editStagedCandidate: (sourceId: string, candidateId: string, editedValue: unknown) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const cand = analysis.candidates.find((c) => c.id === candidateId);
            if (!cand) return state;

            const editResult = validateCandidateEdit(cand, editedValue);
            if (!editResult.valid || !editResult.updatedCandidate) return state;

            // Semantic no-op check: same proposed value
            if (
              JSON.stringify(cand.proposedValue) ===
              JSON.stringify(editResult.updatedCandidate.proposedValue)
            ) {
              return state;
            }

            const updatedCandidates = analysis.candidates.map((c) =>
              c.id === candidateId ? editResult.updatedCandidate! : c
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  candidates: updatedCandidates,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        applyAcceptedCandidates: (sourceId: string) => {
          let outcome:
            | { success: true; appliedCandidateIds: string[] }
            | { success: false; errors: Record<string, string> } = {
            success: true,
            appliedCandidateIds: [],
          };

          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) {
              outcome = { success: false, errors: { [sourceId]: 'Source analysis not found' } };
              return state;
            }

            const stagedAccepted = analysis.candidates.filter(
              (c) => c.reviewDecision === 'accepted' && c.applicationState === 'staged'
            );

            if (stagedAccepted.length === 0) {
              outcome = { success: true, appliedCandidateIds: [] };
              return state;
            }

            // Sort deterministically: cast_seed before cast_expression_guidance, preserving extraction order
            const ordered = sortCandidatesForApplication(stagedAccepted);

            let workingDraft: ForgeDraft = state.forgeDraft
              ? JSON.parse(JSON.stringify(state.forgeDraft))
              : createInitialDraft();

            const errors: Record<string, string> = {};
            const appliedIds: string[] = [];

            for (const cand of ordered) {
              const applyRes = applyCandidateToDraft(
                workingDraft,
                cand,
                analysis.sourceRecord.fileName
              );
              if (!applyRes.success) {
                errors[cand.id] = (applyRes as { success: false; draft: ForgeDraft; error: string }).error;
              } else {
                workingDraft = applyRes.draft;
                appliedIds.push(cand.id);
              }
            }

            // If ANY candidate application failed, perform NO partial mutations
            if (Object.keys(errors).length > 0) {
              outcome = { success: false, errors };
              return state;
            }

            workingDraft = ensureVillainCastMember(workingDraft);

            if (analysis.villainProtagonist === true) {
              workingDraft.villainProtagonist = true;
            }

            // If draft title is empty, auto-populate from source record filename or setting location
            if (!workingDraft.title?.trim()) {
              const cleanFileName = (analysis.sourceRecord?.fileName || '')
                .replace(/\.[^/.]+$/, '')
                .replace(/[_-]+/g, ' ')
                .replace(/\b\w/g, (char) => char.toUpperCase())
                .trim();
              const autoTitle = cleanFileName || workingDraft.setting?.location || 'Untitled Scenario';
              workingDraft.title = autoTitle;
              workingDraft.identity = {
                ...(workingDraft.identity || { version: '1.0', author: '', thematicAnchor: '' }),
                title: autoTitle,
              };
            }

            // If draft premise is empty, auto-populate from source summary
            if (!workingDraft.premise?.trim() && analysis.summary?.trim()) {
              workingDraft.premise = analysis.summary.trim();
              workingDraft.globalPremise = analysis.summary.trim();
            }

            // Reconcile topology start node and cast presence with available topology nodes
            workingDraft = reconcileDraftTopologyAndCast(workingDraft);

            // Commit atomic draft state and mark applied candidates
            const updatedCandidates = analysis.candidates.map((c) => {
              if (appliedIds.includes(c.id)) {
                return {
                  ...c,
                  reviewDecision: 'accepted' as const,
                  applicationState: 'applied' as const,
                };
              }
              return c;
            });

            const updatedAnalysis: ForgeSourceAnalysis = {
              ...analysis,
              candidates: updatedCandidates,
            };

            outcome = { success: true, appliedCandidateIds: appliedIds };

            return {
              forgeDraft: workingDraft,
              draftBlueprint: workingDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
              castLedger: deriveCastLedger(workingDraft),
              topology: deriveTopology(workingDraft),
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: updatedAnalysis,
              },
            };
          });

          return outcome;
        },

        applyImportedSourceBaseline: (sourceAnalysisId: string): { success: true } | { success: false; error: string } => {
          let outcome: { success: true } | { success: false; error: string } = {
            success: false,
            error: 'Unknown error',
          };

          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceAnalysisId];
            if (!analysis) {
              outcome = { success: false, error: `Source analysis not found: ${sourceAnalysisId}` };
              return state;
            }

            const stagedAccepted = analysis.candidates.filter(
              (c) => c.reviewDecision === 'accepted' && c.applicationState === 'staged'
            );

            if (stagedAccepted.length === 0) {
              outcome = { success: true };
              return state;
            }

            const existingContract =
              state.forgeDraft?.depictionContract || state.draftBlueprint?.depictionContract;
            const hasCompleteAuthoredDepiction = isCompleteAuthoredDepictionContract(existingContract);

            const ordered = sortCandidatesForApplication(stagedAccepted);

            let workingDraft: ForgeDraft = state.forgeDraft
              ? JSON.parse(JSON.stringify(state.forgeDraft))
              : createInitialDraft();

            const errors: Record<string, string> = {};
            const appliedIds: string[] = [];
            const supersededIds: string[] = [];

            for (const cand of ordered) {
              if (cand.target === 'depiction_contract' && hasCompleteAuthoredDepiction) {
                // Preserved existing authored Depiction Contract; mark candidate superseded
                supersededIds.push(cand.id);
                continue;
              }

              const applyRes = applyCandidateToDraft(
                workingDraft,
                cand,
                analysis.sourceRecord.fileName
              );
              if (!applyRes.success) {
                errors[cand.id] = (applyRes as { success: false; draft: ForgeDraft; error: string }).error;
              } else {
                workingDraft = applyRes.draft;
                appliedIds.push(cand.id);
              }
            }

            if (Object.keys(errors).length > 0) {
              const firstErr = Object.values(errors)[0] || 'Failed to apply one or more baseline candidates.';
              outcome = { success: false, error: firstErr };
              return state;
            }

            workingDraft = ensureVillainCastMember(workingDraft);

            if (analysis.villainProtagonist === true) {
              workingDraft.villainProtagonist = true;
            }

            // If draft title is empty, auto-populate from source record filename or setting location
            if (!workingDraft.title?.trim()) {
              const cleanFileName = (analysis.sourceRecord?.fileName || '')
                .replace(/\.[^/.]+$/, '')
                .replace(/[_-]+/g, ' ')
                .replace(/\b\w/g, (char) => char.toUpperCase())
                .trim();
              const autoTitle = cleanFileName || workingDraft.setting?.location || 'Untitled Scenario';
              workingDraft.title = autoTitle;
              workingDraft.identity = {
                ...(workingDraft.identity || { version: '1.0', author: '', thematicAnchor: '' }),
                title: autoTitle,
              };
            }

            // If draft premise is empty, auto-populate from source summary
            if (!workingDraft.premise?.trim() && analysis.summary?.trim()) {
              workingDraft.premise = analysis.summary.trim();
              workingDraft.globalPremise = analysis.summary.trim();
            }
            if (!workingDraft.coverImageUrl && analysis.sourceRecord?.coverImageUrl) {
              workingDraft.coverImageUrl = analysis.sourceRecord.coverImageUrl;
            }
            if (!workingDraft.backCoverBlurb && analysis.summary?.trim()) {
              workingDraft.backCoverBlurb = analysis.summary.trim();
            }

            // Reconcile topology start node and cast presence with available topology nodes
            workingDraft = reconcileDraftTopologyAndCast(workingDraft);


            const updatedCandidates = analysis.candidates.map((c) => {
              if (appliedIds.includes(c.id)) {
                return {
                  ...c,
                  reviewDecision: 'accepted' as const,
                  applicationState: 'applied' as const,
                };
              }
              if (supersededIds.includes(c.id)) {
                return {
                  ...c,
                  reviewDecision: 'accepted' as const,
                  applicationState: 'superseded' as const,
                };
              }
              return c;
            });

            const updatedAnalysis: ForgeSourceAnalysis = {
              ...analysis,
              candidates: updatedCandidates,
            };

            outcome = { success: true };

            return {
              forgeDraft: workingDraft,
              draftBlueprint: workingDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
              castLedger: deriveCastLedger(workingDraft),
              topology: deriveTopology(workingDraft),
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: updatedAnalysis,
              },
            };
          });

          return outcome;
        },

        editPendingCandidate: (sourceId: string, candidateId: string, editedValue: unknown) => {
          const { editStagedCandidate } = useForgeStoreInternal.getState().actions;
          editStagedCandidate(sourceId, candidateId, editedValue);
        },

        rejectCandidate: (sourceId: string, candidateId: string) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const cand = analysis.candidates.find((c) => c.id === candidateId);
            if (!cand) return state;

            if (cand.reviewDecision === 'rejected' && cand.applicationState === 'staged') {
              return state;
            }

            const updatedCand = rejectCandidatePure(cand);
            const updatedCandidates = analysis.candidates.map((c) =>
              c.id === candidateId ? updatedCand : c
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  candidates: updatedCandidates,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        runDetailPass: async (
          sourceId: string
        ): Promise<{ success: boolean; newCandidateCount?: number; error?: string }> => {
          const state = useForgeStoreInternal.getState();
          const analysis = state.sourceAnalyses[sourceId];
          if (!analysis) {
            return { success: false, error: `Source analysis "${sourceId}" not found.` };
          }

          const sourceTextParts: string[] = [];
          if (analysis.summary) {
            sourceTextParts.push(`Summary: ${analysis.summary}`);
          }
          for (const ev of analysis.evidence || []) {
            if (ev.claim) sourceTextParts.push(`Claim (${ev.category}): ${ev.claim}`);
            if (ev.excerpt) sourceTextParts.push(`Excerpt: "${ev.excerpt}"`);
          }
          const sourceText = sourceTextParts.join('\n\n') || analysis.summary || analysis.sourceRecord.fileName;

          try {
            const res = await fetch('/api/extract-detail-pass', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sourceId,
                sourceText,
                existingBlueprint: state.forgeDraft || state.draftBlueprint,
                fileName: analysis.sourceRecord.fileName,
              }),
            });

            if (!res.ok) {
              const errJson = await res.json().catch(() => ({}));
              return {
                success: false,
                error: errJson?.error || `Server returned ${res.status}`,
              };
            }

            const data = await res.json();
            if (!data.success) {
              return { success: false, error: data.error || 'Forensic detail pass failed.' };
            }

            const rawNewCandidates: ForgeSourceCandidate[] = Array.isArray(data.candidates) ? data.candidates : [];
            const rawNewEvidence: ForgeSourceEvidence[] = Array.isArray(data.evidence) ? data.evidence : [];
            const rawNewUnknowns: ForgeSourceUnknown[] = Array.isArray(data.unknowns) ? data.unknowns : [];

            set((currState: ForgeState) => {
              const currentAnalysis = currState.sourceAnalyses[sourceId];
              if (!currentAnalysis) return currState;

              const existingCandidateIds = new Set(currentAnalysis.candidates.map((c) => c.id));
              const existingEvidenceIds = new Set(currentAnalysis.evidence.map((e) => e.id));
              const existingUnknownIds = new Set((currentAnalysis.unknowns || []).map((u) => u.id));

              const mergedCandidates = [
                ...currentAnalysis.candidates,
                ...rawNewCandidates.filter((c) => !existingCandidateIds.has(c.id)),
              ];

              const mergedEvidence = [
                ...currentAnalysis.evidence,
                ...rawNewEvidence
                  .map((e) => ({
                    ...e,
                    sourceId: e.sourceId || sourceId,
                  }))
                  .filter((e) => !existingEvidenceIds.has(e.id)),
              ];

              const mergedUnknowns = [
                ...(currentAnalysis.unknowns || []),
                ...rawNewUnknowns.filter((u) => !existingUnknownIds.has(u.id)),
              ];

              const updatedAnalysis: ForgeSourceAnalysis = {
                ...currentAnalysis,
                candidates: mergedCandidates,
                evidence: mergedEvidence,
                unknowns: mergedUnknowns,
              };

              return {
                sourceAnalyses: {
                  ...currState.sourceAnalyses,
                  [sourceId]: updatedAnalysis,
                },
                sourceBaselineRevision: (currState.sourceBaselineRevision || 0) + 1,
              };
            });

            return { success: true, newCandidateCount: rawNewCandidates.length };
          } catch (err) {
            console.error('[FORGE DETAIL PASS] Request error:', err);
            return {
              success: false,
              error: err instanceof Error ? err.message : 'Network error during forensic detail pass',
            };
          }
        },

        runQuestionnaireExtraction: async (
          sourceId: string,
          families?: string[]
        ): Promise<{ success: boolean; newCandidateCount?: number; error?: string }> => {
          const state = useForgeStoreInternal.getState();
          const analysis = state.sourceAnalyses[sourceId];
          if (!analysis) {
            return { success: false, error: `Source analysis "${sourceId}" not found.` };
          }

          const sourceTextParts: string[] = [];
          if (analysis.summary) {
            sourceTextParts.push(`Summary: ${analysis.summary}`);
          }
          for (const ev of analysis.evidence || []) {
            if (ev.claim) sourceTextParts.push(`Claim (${ev.category}): ${ev.claim}`);
            if (ev.excerpt) sourceTextParts.push(`Excerpt: "${ev.excerpt}"`);
          }
          const sourceText = sourceTextParts.join('\n\n') || analysis.summary || analysis.sourceRecord.fileName;

          try {
            const reqBody: { sourceText: string; families?: string[] } = { sourceText };
            if (families && families.length > 0) {
              reqBody.families = families;
            }
            const res = await fetch('/api/extract-questionnaire', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(reqBody),
            });

            if (!res.ok) {
              const errJson = await res.json().catch(() => ({}));
              return {
                success: false,
                error: errJson?.error || `Server returned ${res.status}`,
              };
            }

            const data = await res.json();
            if (!data.success) {
              return { success: false, error: data.error || 'Questionnaire extraction failed.' };
            }

            const compiled = data.compiledCandidates || {};
            const extractedCandidates: ForgeSourceCandidate[] = [];
            let extractedElicitation: unknown = undefined;

            for (const val of Object.values(compiled)) {
              if (!val || typeof val !== 'object') continue;
              const obj = val as Record<string, unknown>;
              if (Array.isArray(obj.nodes)) {
                extractedCandidates.push(...(obj.nodes as ForgeSourceCandidate[]));
              }
              if (Array.isArray(obj.connections)) {
                extractedCandidates.push(...(obj.connections as ForgeSourceCandidate[]));
              }
              if (Array.isArray(obj.seeds)) {
                extractedCandidates.push(...(obj.seeds as ForgeSourceCandidate[]));
              }
              if (Array.isArray(obj.expressionGuidance)) {
                extractedCandidates.push(...(obj.expressionGuidance as ForgeSourceCandidate[]));
              }
              if (Array.isArray(obj.profiles)) {
                extractedCandidates.push(...(obj.profiles as ForgeSourceCandidate[]));
              }
              if (Array.isArray(obj.anchors)) {
                extractedCandidates.push(...(obj.anchors as ForgeSourceCandidate[]));
              }
              if (Array.isArray(obj.rules)) {
                extractedCandidates.push(...(obj.rules as ForgeSourceCandidate[]));
              }
              if (obj.contract && typeof obj.contract === 'object') {
                extractedCandidates.push(obj.contract as ForgeSourceCandidate);
              }
              if (obj.elicitation !== undefined) {
                extractedElicitation = obj.elicitation;
              }
            }

            let newCandidateCount = 0;
            set((currState: ForgeState) => {
              const currentAnalysis = currState.sourceAnalyses[sourceId];
              if (!currentAnalysis) return currState;

              const existingCandidateIds = new Set(currentAnalysis.candidates.map((c) => c.id));
              const deduplicatedNewCandidates: ForgeSourceCandidate[] = [];
              for (const cand of extractedCandidates) {
                if (cand && typeof cand.id === 'string' && !existingCandidateIds.has(cand.id)) {
                  existingCandidateIds.add(cand.id);
                  deduplicatedNewCandidates.push(cand);
                }
              }
              newCandidateCount = deduplicatedNewCandidates.length;

              const mergedCandidates = [
                ...currentAnalysis.candidates,
                ...deduplicatedNewCandidates,
              ];

              const updatedAnalysis: ForgeSourceAnalysis = {
                ...currentAnalysis,
                candidates: mergedCandidates,
              };

              return {
                sourceAnalyses: {
                  ...currState.sourceAnalyses,
                  [sourceId]: updatedAnalysis,
                },
                questionnaireFailedBatteries: Array.isArray(data.failedBatteries) ? data.failedBatteries : [],
                questionnaireElicitations: extractedElicitation !== undefined
                  ? { ...currState.questionnaireElicitations, [sourceId]: extractedElicitation }
                  : currState.questionnaireElicitations,
                sourceBaselineRevision: (currState.sourceBaselineRevision || 0) + 1,
              };
            });

            return { success: true, newCandidateCount };
          } catch (err) {
            console.error('[FORGE QUESTIONNAIRE EXTRACTION] Request error:', err);
            return {
              success: false,
              error: err instanceof Error ? err.message : 'Network error during questionnaire extraction',
            };
          }
        },

        mergeSweepCandidates: (
          newCandidates: ForgeSourceCandidate[],
          newEvidence: ForgeSourceEvidence[],
          sourceId?: string
        ) => {
          set((state: ForgeState) => {
            const existingCandidates = [...(state.candidates || [])];
            const existingEvidence = [...(state.evidence || [])];

            // 1. Merge Evidence without duplication
            for (const ev of newEvidence) {
              if (!existingEvidence.some((e) => e.id === ev.id)) {
                existingEvidence.push(ev);
              }
            }

            // 2. Merge Candidates respecting user review decisions
            for (const incoming of newCandidates) {
              const incomingLegacy = candidateLegacyFields(incoming);
              const matchIndex = existingCandidates.findIndex((c) => {
                const cLegacy = candidateLegacyFields(c);
                if (
                  cLegacy.targetType &&
                  incomingLegacy.targetType &&
                  cLegacy.normalizedKey &&
                  incomingLegacy.normalizedKey
                ) {
                  return (
                    cLegacy.targetType === incomingLegacy.targetType &&
                    cLegacy.normalizedKey === incomingLegacy.normalizedKey
                  );
                }
                if (
                  cLegacy.normalizedKey &&
                  incomingLegacy.normalizedKey &&
                  cLegacy.normalizedKey === incomingLegacy.normalizedKey
                ) {
                  return true;
                }
                if (c.target && incoming.target && c.target === incoming.target) {
                  if (c.label && incoming.label && c.label.toLowerCase() === incoming.label.toLowerCase()) return true;
                  if (c.id === incoming.id) return true;
                }
                return c.id === incoming.id;
              });

              if (matchIndex >= 0) {
                const existing = existingCandidates[matchIndex];
                // Append new evidence IDs without altering reviewDecision
                const incomingEvIds = Array.isArray(incoming.evidenceIds) ? incoming.evidenceIds : [];
                const existingEvIds = Array.isArray(existing.evidenceIds) ? existing.evidenceIds : [];
                const mergedEvidence = Array.from(
                  new Set([...existingEvIds, ...incomingEvIds])
                );

                existingCandidates[matchIndex] = {
                  ...existing,
                  evidenceIds: mergedEvidence,
                  occurrences: (existing.occurrences || 1) + 1,
                  // Preserve STAGED, APPROVED, or REJECTED status
                  reviewDecision: existing.reviewDecision,
                };
              } else {
                existingCandidates.push({
                  ...incoming,
                  // Legacy sweeps may carry review statuses outside the current
                  // enum ('STAGED', 'APPROVED', ...); normalize them so the
                  // stored value always satisfies ForgeCandidateReviewDecision.
                  reviewDecision: normalizeLegacyReviewDecision(incoming.reviewDecision),
                  extractionPass: 2,
                });
              }
            }

            // 3. Keep active sourceAnalysis synchronized if present
            let updatedSourceAnalyses = state.sourceAnalyses;
            const targetSourceId = sourceId || (newCandidates[0]?.sourceId) || Object.keys(state.sourceAnalyses || {})[0];
            if (targetSourceId && state.sourceAnalyses?.[targetSourceId]) {
              const targetAnalysis = state.sourceAnalyses[targetSourceId];
              const mergedAnalysisEvidence = [...(targetAnalysis.evidence || [])];
              for (const ev of newEvidence) {
                if (!mergedAnalysisEvidence.some((e) => e.id === ev.id)) {
                  mergedAnalysisEvidence.push({ ...ev, sourceId: targetSourceId });
                }
              }
              const mergedAnalysisCandidates = [...(targetAnalysis.candidates || [])];
              for (const incoming of newCandidates) {
                const idx = mergedAnalysisCandidates.findIndex((c) =>
                  c.id === incoming.id || (c.target === incoming.target && c.label.toLowerCase() === incoming.label.toLowerCase())
                );
                if (idx >= 0) {
                  const existing = mergedAnalysisCandidates[idx];
                  const mergedEvIds = Array.from(new Set([...(existing.evidenceIds || []), ...(incoming.evidenceIds || [])]));
                  mergedAnalysisCandidates[idx] = {
                    ...existing,
                    evidenceIds: mergedEvIds,
                  };
                } else {
                  mergedAnalysisCandidates.push({
                    ...incoming,
                    sourceId: targetSourceId,
                    reviewDecision: 'accepted',
                    applicationState: 'staged',
                    extractionPass: 2,
                  });
                }
              }
              updatedSourceAnalyses = {
                ...state.sourceAnalyses,
                [targetSourceId]: {
                  ...targetAnalysis,
                  evidence: mergedAnalysisEvidence,
                  candidates: mergedAnalysisCandidates,
                },
              };
            }

            return {
              candidates: existingCandidates,
              evidence: existingEvidence,
              sourceAnalyses: updatedSourceAnalyses,
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          });
        },

        removeSourceAnalysis: (sourceId: string) => {
          const binding = removeRuntimeSourceBinding(sourceId);
          if (binding) {
            notifyServerRevokeBinding(binding);
          }
          set((state: ForgeState) => {
            if (!state.sourceAnalyses[sourceId]) return state;
            const remaining = { ...state.sourceAnalyses };
            delete remaining[sourceId];

            let nextDraft = state.forgeDraft;
            if (
              nextDraft?.userOpeningAim?.provenance?.kind === 'REVIEWED_SOURCE' &&
              nextDraft.userOpeningAim.provenance.sourceId === sourceId
            ) {
              const invalidatedAim = {
                castMemberId: nextDraft.userOpeningAim.castMemberId,
                disposition: 'UNREVIEWED' as const,
                aimText: '',
                reviewedAt: undefined,
              };
              nextDraft = {
                ...nextDraft,
                userOpeningAim: invalidatedAim,
                horrorGrammar: {
                  ...(nextDraft.horrorGrammar || {
                    valueBaselineReview: 'UNREVIEWED' as const,
                    pursuitReviews: {},
                    valueAnchors: [],
                    characterPursuits: [],
                  }),
                  userOpeningAim: invalidatedAim,
                },
              };
            }

            return {
              sourceAnalyses: remaining,
              forgeDraft: nextDraft,
              draftBlueprint: nextDraft,
              draftRevision: nextDraft !== state.forgeDraft ? (state.draftRevision || 0) + 1 : state.draftRevision,
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          });
        },

        // --- USER CHARACTER & OPENING AIM ACTIONS (Packet 1C-5 & 1C-6) ---
        setUserCharacter: (characterId: string) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const currentDraft = state.forgeDraft || createInitialDraft();
            const cast = currentDraft.cast || [];
            const targetMember = cast.find((c) => c.id === characterId);

            if (!targetMember) {
              outcome = {
                success: false,
                error: `Cast member ID "${characterId}" not found in draft.`,
              };
              return state;
            }

            if (targetMember.isEntity) {
              outcome = {
                success: false,
                error: `Entity cast member "${targetMember.name || characterId}" cannot be selected as the user-controlled protagonist.`,
              };
              return state;
            }

            const formerUserCharId =
              currentDraft.userCharacterId || cast.find((c) => c.isUserCharacter)?.id;

            // Reconcile cast members with explicit startingNodeId (no ORIGIN or nodes[0] fallback)
            const explicitStartNode = currentDraft.topology?.startingNodeId;
            const updatedCast = cast.map((member) => {
              if (member.id === characterId) {
                return {
                  ...member,
                  isUserCharacter: true,
                  presenceDisposition: explicitStartNode
                    ? { kind: 'AT_NODE' as const, nodeId: explicitStartNode }
                    : member.presenceDisposition || { kind: 'OFFSTAGE' as const },
                  starting_location: explicitStartNode || member.starting_location || '',
                };
              }
              return {
                ...member,
                isUserCharacter: false,
              };
            });

            // Reconcile userOpeningAim
            let nextOpeningAim = currentDraft.userOpeningAim;
            if (!nextOpeningAim || nextOpeningAim.castMemberId !== characterId) {
              nextOpeningAim = {
                castMemberId: characterId,
                disposition: 'UNREVIEWED' as const,
                aimText: '',
                reviewedAt: undefined,
              };
            }

            // Reconcile horrorGrammar
            const currentHg = currentDraft.horrorGrammar || {
              valueBaselineReview: 'UNREVIEWED' as const,
              pursuitReviews: {},
              valueAnchors: [],
              characterPursuits: [],
            };

            const updatedPursuits = (currentHg.characterPursuits || []).filter(
              (p) => p.castMemberId !== characterId
            );

            const updatedPursuitReviews = { ...currentHg.pursuitReviews };
            delete updatedPursuitReviews[characterId];
            if (formerUserCharId && formerUserCharId !== characterId) {
              updatedPursuitReviews[formerUserCharId] = 'UNREVIEWED';
            }

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              userCharacterId: characterId,
              cast: updatedCast,
              userOpeningAim: nextOpeningAim,
              horrorGrammar: {
                ...currentHg,
                characterPursuits: updatedPursuits,
                pursuitReviews: updatedPursuitReviews,
                userOpeningAim: nextOpeningAim,
              },
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
            };
          });
          return outcome;
        },

        acceptReferenceOpeningAim: (sourceId?: string) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const currentDraft = state.forgeDraft || createInitialDraft();
            const userChar = currentDraft.cast?.find((c) => c.isUserCharacter);
            if (!userChar) {
              outcome = { success: false, error: 'No user-controlled character found in draft.' };
              return state;
            }

            const provSourceId =
              currentDraft.userOpeningAim?.provenance?.kind === 'REVIEWED_SOURCE'
                ? currentDraft.userOpeningAim.provenance.sourceId
                : undefined;
            const resolvedSourceId = provSourceId || sourceId || '';
            const analysis =
              (resolvedSourceId ? state.sourceAnalyses[resolvedSourceId] : undefined) ||
              Object.values(state.sourceAnalyses).find(
                (a) =>
                  !resolvedSourceId ||
                  a.id === resolvedSourceId ||
                  a.sourceRecord?.id === resolvedSourceId
              );

            if (!analysis) {
              outcome = {
                success: false,
                error: `No registered source analysis found for source ID "${resolvedSourceId}".`,
              };
              return state;
            }

            const candidate = (analysis.candidates || []).find(
              (c) =>
                c.target === 'user_opening_aim_default' &&
                (c.targetCastMemberId === userChar.id || !c.targetCastMemberId)
            );

            if (!candidate) {
              outcome = {
                success: false,
                error: `No opening aim candidate found in source "${resolvedSourceId}" for player character "${userChar.name || userChar.id}".`,
              };
              return state;
            }

            if (candidate.reviewDecision === 'rejected') {
              outcome = {
                success: false,
                error: 'Cannot accept rejected opening aim candidate.',
              };
              return state;
            }

            if (candidate.applicationState !== 'applied') {
              outcome = {
                success: false,
                error: 'Cannot accept staged opening aim candidate before it has been applied to baseline.',
              };
              return state;
            }

            const candText =
              typeof candidate.proposedValue === 'string'
                ? candidate.proposedValue.trim()
                : typeof candidate.proposedValue === 'object' &&
                  candidate.proposedValue !== null &&
                  'aimText' in candidate.proposedValue &&
                  typeof candidate.proposedValue.aimText === 'string'
                ? candidate.proposedValue.aimText.trim()
                : '';

            if (!candText) {
              outcome = {
                success: false,
                error: 'Opening aim candidate proposed value is empty.',
              };
              return state;
            }

            // Check if draft's unreviewed proposal text matches candidate text
            if (currentDraft.userOpeningAim?.aimText) {
              const draftAimText = currentDraft.userOpeningAim.aimText.trim();
              if (draftAimText && draftAimText !== candText) {
                outcome = {
                  success: false,
                  error: `Displayed draft aim text "${draftAimText}" does not match applied candidate proposal text "${candText}".`,
                };
                return state;
              }
            }

            const actualSourceId = analysis.sourceRecord?.id || analysis.id;

            const provCheck = resolveSourceEvidenceProvenance({
              provenance: {
                kind: 'REVIEWED_SOURCE',
                sourceId: actualSourceId,
                evidenceIds: candidate.evidenceIds || [],
              },
              sourceAnalyses: state.sourceAnalyses,
              expectedText: candText,
              expectedCastMemberId: userChar.id,
            });

            if (!provCheck.valid) {
              outcome = {
                success: false,
                error: `Cannot accept reference opening aim: ${provCheck.errors.join('; ')}`,
              };
              return state;
            }

            const aimRecord: UserOpeningAim = {
              castMemberId: userChar.id,
              disposition: 'ACCEPTED_REFERENCE',
              aimText: candText,
              provenance: {
                kind: 'REVIEWED_SOURCE',
                sourceId: actualSourceId,
                evidenceIds: candidate.evidenceIds || [],
              },
              reviewedAt: Date.now(),
            };

            const hg = currentDraft.horrorGrammar || {
              valueBaselineReview: 'UNREVIEWED',
              pursuitReviews: {},
              valueAnchors: [],
              characterPursuits: [],
            };

            const existingPursuitIdx = (hg.characterPursuits || []).findIndex(
              (p) => p.castMemberId === userChar.id
            );

            const userPursuit: CharacterPursuit = {
              id: `pursuit-${userChar.id}`,
              castMemberId: userChar.id,
              objective: candText,
              presentApproach: 'Direct focus on opening objective.',
              locationNodeId: null,
              status: 'ACTIVE',
              reviewWindow: 'MOMENT',
              triggerReferences: [],
              basisSummary: 'Accepted reference opening objective',
              provenance: {
                kind: 'REVIEWED_SOURCE',
                sourceId: actualSourceId,
                evidenceIds: candidate.evidenceIds || [],
              },
            };

            const nextPursuits = [...(hg.characterPursuits || [])];
            if (existingPursuitIdx >= 0) {
              nextPursuits[existingPursuitIdx] = userPursuit;
            } else {
              nextPursuits.push(userPursuit);
            }

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              userOpeningAim: aimRecord,
              horrorGrammar: {
                ...hg,
                userOpeningAim: aimRecord,
                pursuitReviews: {
                  ...(hg.pursuitReviews || {}),
                  [userChar.id]: 'REVIEWED',
                },
                characterPursuits: nextPursuits,
              },
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
            };
          });
          return outcome;
        },

        setCreatorOverrideOpeningAim: (aimText: string) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const currentDraft = state.forgeDraft || createInitialDraft();
            const userChar = currentDraft.cast?.find((c) => c.isUserCharacter);
            if (!userChar) {
              outcome = { success: false, error: 'No user-controlled character found in draft.' };
              return state;
            }

            const cleanText = aimText.trim();
            if (!cleanText) {
              outcome = { success: false, error: 'Opening aim text cannot be empty for creator override.' };
              return state;
            }

            const aimRecord: UserOpeningAim = {
              castMemberId: userChar.id,
              disposition: 'CREATOR_OVERRIDE',
              aimText: cleanText,
              provenance: { kind: 'CREATOR_DEFINED' },
              reviewedAt: Date.now(),
            };

            const hg = currentDraft.horrorGrammar || {
              valueBaselineReview: 'UNREVIEWED',
              pursuitReviews: {},
              valueAnchors: [],
              characterPursuits: [],
            };

            const existingPursuitIdx = (hg.characterPursuits || []).findIndex(
              (p) => p.castMemberId === userChar.id
            );

            const userPursuit: CharacterPursuit = {
              id: `pursuit-${userChar.id}`,
              castMemberId: userChar.id,
              objective: cleanText,
              presentApproach: 'Direct focus on opening objective.',
              locationNodeId: null,
              status: 'ACTIVE',
              reviewWindow: 'MOMENT',
              triggerReferences: [],
              basisSummary: 'Creator authored opening objective',
              provenance: { kind: 'CREATOR_DEFINED' },
            };

            const nextPursuits = [...(hg.characterPursuits || [])];
            if (existingPursuitIdx >= 0) {
              nextPursuits[existingPursuitIdx] = userPursuit;
            } else {
              nextPursuits.push(userPursuit);
            }

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              userOpeningAim: aimRecord,
              horrorGrammar: {
                ...hg,
                userOpeningAim: aimRecord,
                pursuitReviews: {
                  ...(hg.pursuitReviews || {}),
                  [userChar.id]: 'REVIEWED',
                },
                characterPursuits: nextPursuits,
              },
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
            };
          });
          return outcome;
        },

        setNoneDeclaredOpeningAim: () => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const currentDraft = state.forgeDraft || createInitialDraft();
            const userChar = currentDraft.cast?.find((c) => c.isUserCharacter);

            const aimRecord: UserOpeningAim = {
              castMemberId: userChar?.id || '',
              disposition: 'NONE_DECLARED',
              aimText: '',
              provenance: undefined,
              reviewedAt: Date.now(),
            };

            const hg = currentDraft.horrorGrammar || {
              valueBaselineReview: 'UNREVIEWED',
              pursuitReviews: {},
              valueAnchors: [],
              characterPursuits: [],
            };

            const filteredPursuits = (hg.characterPursuits || []).filter(
              (p) => p.castMemberId !== (userChar?.id || '')
            );

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              userOpeningAim: aimRecord,
              horrorGrammar: {
                ...hg,
                userOpeningAim: aimRecord,
                pursuitReviews: {
                  ...(hg.pursuitReviews || {}),
                  ...(userChar?.id ? { [userChar.id]: 'REVIEWED_NONE' } : {}),
                },
                characterPursuits: filteredPursuits,
              },
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
            };
          });
          return outcome;
        },

        addCastMember: (member?: Partial<ForgeDraftCastMember>) => {
          let createdId = '';
          set((state: ForgeState) => {
            const draft = state.forgeDraft || createInitialDraft();
            const newId = member?.id || `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            createdId = newId;
            const isEntity = member?.isEntity ?? false;
            const isUserCharacter = isEntity
              ? false
              : member?.isUserCharacter !== undefined
              ? member.isUserCharacter
              : member?.role === 'PROTAGONIST';

            const newCastMember: ForgeDraftCastMember = {
              id: newId,
              name: member?.name || '',
              role: member?.role || (isUserCharacter ? 'PROTAGONIST' : 'Subject'),
              description: member?.description || '',
              psychological_status: member?.psychological_status || '',
              starting_location: member?.starting_location || '',
              isEntity,
              isUserCharacter,
              behaviorVector: member?.behaviorVector || 'ADAPTIVE',
              presenceDisposition: member?.presenceDisposition || { kind: 'OFFSTAGE' },
              expressionProfile: member?.expressionProfile,
              traits: member?.traits || [],
              goals: member?.goals || '',
              personality: member?.personality || '',
              seed: member?.seed || createNeutralSeed({
                id: newId,
                name: member?.name || '',
                role: member?.role || (isUserCharacter ? 'PROTAGONIST' : 'Subject'),
                description: member?.description || '',
                isEntity,
                isUserCharacter,
                starting_location: member?.starting_location || '',
                traits: member?.traits || [],
                goals: member?.goals || '',
              }, draft),
            };
            const updatedCast = [...(draft.cast || []), newCastMember];
            let nextUserCharId = draft.userCharacterId;
            if (isUserCharacter && !nextUserCharId) {
              nextUserCharId = newId;
            }
            const updatedDraft: ForgeDraft = {
              ...draft,
              userCharacterId: nextUserCharId,
              cast: updatedCast,
            };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          });
          return { success: true, characterId: createdId };
        },

        updateCastMember: (id: string, updates: Partial<ForgeDraftCastMember>) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const draft = state.forgeDraft || createInitialDraft();
            const exists = (draft.cast || []).some((m) => m.id === id);
            if (!exists) {
              outcome = { success: false, error: `Cast member ID "${id}" not found in draft.` };
              return state;
            }

            const updatedCast = (draft.cast || []).map((m) => {
              if (m.id !== id) return m;
              const nextEntity = updates.isEntity !== undefined ? updates.isEntity : m.isEntity;
              const nextIsUser = nextEntity
                ? false
                : updates.isUserCharacter !== undefined
                ? updates.isUserCharacter
                : updates.role !== undefined
                ? updates.role === 'PROTAGONIST'
                : m.isUserCharacter;

              return {
                ...m,
                ...updates,
                isEntity: nextEntity,
                isUserCharacter: nextIsUser,
              };
            });

            // If entity toggle cleared user character or role/isUserCharacter changed
            let nextUserCharId = draft.userCharacterId;
            const updatedTarget = updatedCast.find((m) => m.id === id);
            if (updatedTarget?.isUserCharacter) {
              nextUserCharId = id;
            } else if (nextUserCharId === id && !updatedTarget?.isUserCharacter) {
              nextUserCharId = undefined;
            }

            const updatedDraft: ForgeDraft = {
              ...draft,
              userCharacterId: nextUserCharId,
              cast: updatedCast,
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          });
          return outcome;
        },

        removeCastMember: (id: string) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const draft = state.forgeDraft || createInitialDraft();
            const updatedCast = (draft.cast || []).filter((m) => m.id !== id);

            let nextUserCharId = draft.userCharacterId;
            let nextUserOpeningAim = draft.userOpeningAim;
            if (nextUserCharId === id) {
              nextUserCharId = undefined;
              nextUserOpeningAim = undefined;
            }

            const currentHg = draft.horrorGrammar;
            let nextHg = currentHg;
            if (currentHg) {
              const updatedPursuits = (currentHg.characterPursuits || []).filter((p) => p.castMemberId !== id);
              const updatedReviews = { ...(currentHg.pursuitReviews || {}) };
              delete updatedReviews[id];
              nextHg = {
                ...currentHg,
                characterPursuits: updatedPursuits,
                pursuitReviews: updatedReviews,
                userOpeningAim: nextUserOpeningAim,
              };
            }

            const updatedDraft: ForgeDraft = {
              ...draft,
              userCharacterId: nextUserCharId,
              userOpeningAim: nextUserOpeningAim,
              cast: updatedCast,
              horrorGrammar: nextHg,
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          });
          return outcome;
        },

        setCastOpeningPlacement: (
          characterId: string,
          disposition: CharacterPresenceDisposition
        ) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const currentDraft = state.forgeDraft || createInitialDraft();
            const cast = currentDraft.cast || [];
            const target = cast.find((c) => c.id === characterId);
            if (!target) {
              outcome = { success: false, error: `Cast member ID "${characterId}" not found in draft.` };
              return state;
            }

            if (disposition.kind === 'NONLOCAL' && !target.isEntity) {
              outcome = {
                success: false,
                error: `NONLOCAL opening placement is only permitted for Entity cast members ("${target.name || characterId}" is not an entity).`,
              };
              return state;
            }

            if (disposition.kind === 'AT_NODE') {
              const validNodeIds = new Set([
                ...(currentDraft.topology?.nodes || []),
                ...(currentDraft.topology?.nodeDefinitions?.map((n) => n.id) || []),
              ]);
              if (validNodeIds.size > 0 && !validNodeIds.has(disposition.nodeId)) {
                outcome = {
                  success: false,
                  error: `Opening placement node "${disposition.nodeId}" not found in active draft topology.`,
                };
                return state;
              }
            }

            const cleanDisposition: CharacterPresenceDisposition =
              disposition.kind === 'AT_NODE'
                ? { kind: 'AT_NODE', nodeId: disposition.nodeId }
                : disposition.kind === 'OFFSTAGE'
                ? { kind: 'OFFSTAGE' }
                : { kind: 'NONLOCAL' };

            const updatedCast = cast.map((m) => {
              if (m.id === characterId) {
                return {
                  ...m,
                  presenceDisposition: cleanDisposition,
                  starting_location: cleanDisposition.kind === 'AT_NODE' ? cleanDisposition.nodeId : '',
                };
              }
              return m;
            });

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              cast: updatedCast,
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
            };
          });
          return outcome;
        },

        setPursuitReview: (
          characterId: string,
          state: 'REVIEWED' | 'REVIEWED_NONE' | 'UNREVIEWED',
          pursuitData?: Partial<CharacterPursuit>
        ) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((fState: ForgeState) => {
            const currentDraft = fState.forgeDraft || createInitialDraft();
            const currentHg = currentDraft.horrorGrammar || {
              valueBaselineReview: 'UNREVIEWED' as const,
              pursuitReviews: {},
              valueAnchors: [],
              characterPursuits: [],
            };

            const updatedReviews = {
              ...currentHg.pursuitReviews,
              [characterId]: state,
            };

            let updatedPursuits = (currentHg.characterPursuits || []).filter(
              (p) => p.castMemberId !== characterId
            );

            if (state === 'REVIEWED' && pursuitData) {
              const targetMember = currentDraft.cast?.find((c) => c.id === characterId);
              const defaultLoc =
                targetMember?.presenceDisposition?.kind === 'AT_NODE'
                  ? targetMember.presenceDisposition.nodeId
                  : targetMember?.starting_location || currentDraft.topology?.startingNodeId || '';

              const newPursuit: CharacterPursuit = {
                id: pursuitData.id || `pursuit-${characterId}-${Date.now()}`,
                castMemberId: characterId,
                objective: pursuitData.objective || 'Maintain operational perimeter',
                presentApproach: pursuitData.presentApproach || 'Surveying local sector',
                locationNodeId: pursuitData.locationNodeId || defaultLoc,
                status: pursuitData.status || 'ACTIVE',
                reviewWindow: pursuitData.reviewWindow || 'SCENE_BEAT',
                triggerReferences: pursuitData.triggerReferences || [],
                basisSummary: pursuitData.basisSummary || 'Creator-defined character initiative.',
                provenance: pursuitData.provenance || { kind: 'CREATOR_DEFINED' },
              };
              updatedPursuits = [...updatedPursuits, newPursuit];
            }

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              horrorGrammar: {
                ...currentHg,
                pursuitReviews: updatedReviews,
                characterPursuits: updatedPursuits,
              },
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (fState.draftRevision || 0) + 1,
            };
          });
          return outcome;
        },

        // --- AMBIGUITY RESOLUTION ACTIONS ---
        submitUnknownAnswer: (sourceId: string, unknownId: string, answer: string) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const unk = analysis.unknowns.find((u) => u.id === unknownId);
            if (!unk || !answer.trim()) return state;

            const safeAnswer = answer.trim();

            // Semantic no-op check: if answer is already recorded and status is awaiting_response
            if (
              unk.submittedAnswer === safeAnswer &&
              unk.status === 'awaiting_response' &&
              unk.lastError === undefined &&
              (!unk.followUps.length || unk.followUps.every((f) => f.answer))
            ) {
              return state;
            }

            const updatedFollowUps = [...unk.followUps];
            const unansweredIdx = updatedFollowUps.findIndex((f) => !f.answer);

            if (unansweredIdx !== -1) {
              if (updatedFollowUps[unansweredIdx].answer === safeAnswer) {
                return state;
              }
              updatedFollowUps[unansweredIdx] = {
                ...updatedFollowUps[unansweredIdx],
                answer: safeAnswer,
              };
            }

            const updatedUnknown: ForgeSourceUnknown = {
              ...unk,
              submittedAnswer: safeAnswer,
              followUps: updatedFollowUps,
              status: 'awaiting_response',
              lastError: undefined,
            };

            const updatedUnknowns = analysis.unknowns.map((u) =>
              u.id === unknownId ? updatedUnknown : u
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  unknowns: updatedUnknowns,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        receiveUnknownFollowUp: (sourceId: string, unknownId: string, followUpQuestion: string) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const unk = analysis.unknowns.find((u) => u.id === unknownId);
            if (!unk || !followUpQuestion.trim()) return state;

            // Maximum 2 follow-ups allowed
            if (unk.followUps.length >= 2) return state;

            const q = followUpQuestion.trim();
            const lastFollowUp = unk.followUps[unk.followUps.length - 1];
            if (lastFollowUp && lastFollowUp.question === q && !lastFollowUp.answer) {
              return state;
            }

            const newFollowUp = {
              id: `fu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              question: q,
            };

            const updatedUnknown: ForgeSourceUnknown = {
              ...unk,
              followUps: [...unk.followUps, newFollowUp],
              status: 'queued',
              lastError: undefined,
            };

            const updatedUnknowns = analysis.unknowns.map((u) =>
              u.id === unknownId ? updatedUnknown : u
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  unknowns: updatedUnknowns,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        receiveUnknownProposal: (
          sourceId: string,
          unknownId: string,
          proposal: ForgeUnknownResolutionProposal
        ) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const unk = analysis.unknowns.find((u) => u.id === unknownId);
            if (!unk || !proposal.resolution.trim()) return state;

            const res = proposal.resolution.trim();
            const eff = proposal.targetEffect.trim() || unk.targetEffect;

            // Semantic no-op check
            if (
              unk.status === 'awaiting_confirmation' &&
              unk.resolutionProposal &&
              unk.resolutionProposal.resolution === res &&
              unk.resolutionProposal.targetEffect === eff &&
              JSON.stringify(unk.resolutionProposal.draftPatch) === JSON.stringify(proposal.draftPatch) &&
              unk.lastError === undefined
            ) {
              return state;
            }

            const updatedUnknown: ForgeSourceUnknown = {
              ...unk,
              resolutionProposal: {
                resolution: res,
                targetEffect: eff,
                draftPatch: proposal.draftPatch,
              },
              status: 'awaiting_confirmation',
              lastError: undefined,
            };

            const updatedUnknowns = analysis.unknowns.map((u) =>
              u.id === unknownId ? updatedUnknown : u
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  unknowns: updatedUnknowns,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        acceptUnknownResolution: (
          sourceId: string,
          unknownId: string,
          resolutionOverride?: string,
          applyDraftPatch: boolean = true
        ) => {
          let outcome: { success: true } | { success: false; error: string } = {
            success: true,
          };

          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) {
              outcome = { success: false, error: 'Source analysis not found.' };
              return state;
            }
            const unk = analysis.unknowns.find((u) => u.id === unknownId);
            if (!unk) {
              outcome = { success: false, error: 'Unknown not found in source analysis.' };
              return state;
            }

            const resText =
              typeof resolutionOverride === 'string'
                ? resolutionOverride
                : typeof resolutionOverride === 'object' &&
                  resolutionOverride !== null &&
                  'resolution' in resolutionOverride &&
                  typeof (resolutionOverride as { resolution: unknown }).resolution === 'string'
                ? (resolutionOverride as { resolution: string }).resolution
                : unk.resolutionProposal?.resolution ||
                  unk.submittedAnswer ||
                  '';
            const finalResolution = (resText || '').trim();

            if (!finalResolution) {
              outcome = { success: false, error: 'Resolution text cannot be empty.' };
              return state;
            }

            const currentDraft = state.forgeDraft || createInitialDraft();
            const existingAmbiguity = currentDraft.ambiguities?.find((a) => a.id === unk.id);

            // Semantic no-op check: if unknown is already resolved with the same resolution and recorded in ambiguities
            if (
              unk.status === 'resolved' &&
              unk.lastError === undefined &&
              existingAmbiguity &&
              existingAmbiguity.resolutionMode === 'USER_DEFINED' &&
              existingAmbiguity.resolution === finalResolution
            ) {
              outcome = { success: true };
              return state;
            }

            let workingDraft: ForgeDraft = JSON.parse(JSON.stringify(currentDraft));

            // If proposal included a draft patch and applyDraftPatch is true, validate & apply it first
            if (applyDraftPatch && unk.resolutionProposal?.draftPatch) {
              const patchResult = applyResolutionDraftPatch(
                workingDraft,
                unk.resolutionProposal.draftPatch
              );
              if (!patchResult.success) {
                // On failure:
                // - retain awaiting_confirmation
                // - retain resolution text and draftPatch
                // - record lastError
                // - leave draft aliases, ambiguities, and draftRevision unchanged
                const failedUnknown: ForgeSourceUnknown = {
                  ...unk,
                  status: 'awaiting_confirmation',
                  lastError: (patchResult as { success: false; error: string }).error,
                };
                const updatedUnknowns = analysis.unknowns.map((u) =>
                  u.id === unknownId ? failedUnknown : u
                );
                outcome = { success: false, error: (patchResult as { success: false; error: string }).error };
                return {
                  sourceAnalyses: {
                    ...state.sourceAnalyses,
                    [analysis.id]: {
                      ...analysis,
                      unknowns: updatedUnknowns,
                    },
                  },
                };
              }
              workingDraft = patchResult.draft;
            }

            // Create canonical ambiguity decision
            const decision: BlueprintAmbiguityDecision = {
              id: unk.id,
              category: unk.category,
              question: unk.question,
              resolutionMode: 'USER_DEFINED',
              resolution: finalResolution,
            };

            // Upsert into workingDraft.ambiguities
            const existingAmbiguities = workingDraft.ambiguities
              ? [...workingDraft.ambiguities]
              : [];
            const existingIdx = existingAmbiguities.findIndex((a) => a.id === unk.id);
            if (existingIdx !== -1) {
              existingAmbiguities[existingIdx] = decision;
            } else {
              existingAmbiguities.push(decision);
            }
            workingDraft.ambiguities = existingAmbiguities;

            // Mark unknown as resolved and clear lastError
            const updatedUnknown: ForgeSourceUnknown = {
              ...unk,
              status: 'resolved',
              resolutionProposal: {
                resolution: finalResolution,
                targetEffect: unk.resolutionProposal?.targetEffect || unk.targetEffect,
                draftPatch: unk.resolutionProposal?.draftPatch,
              },
              lastError: undefined,
            };

            const updatedUnknowns = analysis.unknowns.map((u) =>
              u.id === unknownId ? updatedUnknown : u
            );

            const updatedAnalysis = {
              ...analysis,
              unknowns: updatedUnknowns,
            };

            outcome = { success: true };

            return {
              forgeDraft: workingDraft,
              draftBlueprint: workingDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
              castLedger: deriveCastLedger(workingDraft),
              topology: deriveTopology(workingDraft),
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: updatedAnalysis,
              },
            };
          });

          if (outcome.success) {
            const binding = getRuntimeSourceBinding(sourceId);
            if (binding) {
              notifyServerCloseUnknown(binding, unknownId);
            }
          }

          return outcome;
        },

        leaveUnknownUncertain: (sourceId: string, unknownId: string, guidance?: string) => {
          const binding = getRuntimeSourceBinding(sourceId);
          if (binding) {
            notifyServerCloseUnknown(binding, unknownId);
          }
          return set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const unk = analysis.unknowns.find((u) => u.id === unknownId);
            if (!unk) return state;

            const cleanGuidance = guidance && guidance.trim() ? guidance.trim() : undefined;

            // Semantic no-op check: if already contextual_discretion with same guidance
            const currentDraft = state.forgeDraft || createInitialDraft();
            const existingAmbiguity = currentDraft.ambiguities?.find((a) => a.id === unk.id);
            if (
              unk.status === 'contextual_discretion' &&
              unk.lastError === undefined &&
              existingAmbiguity &&
              existingAmbiguity.resolutionMode === 'CONTEXTUAL_DISCRETION' &&
              existingAmbiguity.guidance === cleanGuidance
            ) {
              return state;
            }

            const decision: BlueprintAmbiguityDecision = {
              id: unk.id,
              category: unk.category,
              question: unk.question,
              resolutionMode: 'CONTEXTUAL_DISCRETION',
              ...(cleanGuidance ? { guidance: cleanGuidance } : {}),
            };

            const existingAmbiguities = currentDraft.ambiguities ? [...currentDraft.ambiguities] : [];
            const existingIdx = existingAmbiguities.findIndex((a) => a.id === unk.id);
            if (existingIdx !== -1) {
              existingAmbiguities[existingIdx] = decision;
            } else {
              existingAmbiguities.push(decision);
            }

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              ambiguities: existingAmbiguities,
            };

            const updatedUnknown: ForgeSourceUnknown = {
              ...unk,
              status: 'contextual_discretion',
              lastError: undefined,
            };

            const updatedUnknowns = analysis.unknowns.map((u) =>
              u.id === unknownId ? updatedUnknown : u
            );

            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  unknowns: updatedUnknowns,
                },
              },
            };
          });
        },

        leaveAllUnknownsUncertain: (sourceId?: string) => {
          return set((state: ForgeState) => {
            const analysesToUpdate = sourceId
              ? [state.sourceAnalyses[sourceId]].filter(Boolean)
              : Object.values(state.sourceAnalyses);

            if (analysesToUpdate.length === 0) return state;

            const currentDraft = state.forgeDraft || createInitialDraft();
            const existingAmbiguities = currentDraft.ambiguities ? [...currentDraft.ambiguities] : [];
            const updatedAnalyses = { ...state.sourceAnalyses };

            for (const analysis of analysesToUpdate) {
              const binding = getRuntimeSourceBinding(analysis.id);
              const openUnknowns = analysis.unknowns.filter(
                (u) => u.status !== 'resolved' && u.status !== 'contextual_discretion'
              );

              if (openUnknowns.length === 0) continue;

              for (const unk of openUnknowns) {
                if (binding) {
                  notifyServerCloseUnknown(binding, unk.id);
                }
                const decision: BlueprintAmbiguityDecision = {
                  id: unk.id,
                  category: unk.category,
                  question: unk.question,
                  resolutionMode: 'CONTEXTUAL_DISCRETION',
                };
                const existingIdx = existingAmbiguities.findIndex((a) => a.id === unk.id);
                if (existingIdx !== -1) {
                  existingAmbiguities[existingIdx] = decision;
                } else {
                  existingAmbiguities.push(decision);
                }
              }

              const updatedUnknowns = analysis.unknowns.map((u) =>
                u.status !== 'resolved' && u.status !== 'contextual_discretion'
                  ? { ...u, status: 'contextual_discretion' as const, lastError: undefined }
                  : u
              );

              updatedAnalyses[analysis.id] = {
                ...analysis,
                unknowns: updatedUnknowns,
              };
            }

            const updatedDraft: ForgeDraft = {
              ...currentDraft,
              ambiguities: existingAmbiguities,
            };

            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
              sourceAnalyses: updatedAnalyses,
            };
          });
        },

        setUnknownError: (sourceId: string, unknownId: string, error: string) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const unk = analysis.unknowns.find((u) => u.id === unknownId);
            if (!unk) return state;

            // Semantic no-op check: if already queued with identical error
            if (unk.status === 'queued' && unk.lastError === error) {
              return state;
            }

            const updatedUnknown: ForgeSourceUnknown = {
              ...unk,
              status: 'queued',
              lastError: error,
            };

            const updatedUnknowns = analysis.unknowns.map((u) =>
              u.id === unknownId ? updatedUnknown : u
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  unknowns: updatedUnknowns,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        retryUnknown: (sourceId: string, unknownId: string) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const unk = analysis.unknowns.find((u) => u.id === unknownId);
            if (!unk) return state;

            // Semantic no-op check: if already queued with no error, retry is a no-op
            if (unk.status === 'queued' && unk.lastError === undefined) {
              return state;
            }

            const updatedUnknown: ForgeSourceUnknown = {
              ...unk,
              status: 'queued',
              lastError: undefined,
            };

            const updatedUnknowns = analysis.unknowns.map((u) =>
              u.id === unknownId ? updatedUnknown : u
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  unknowns: updatedUnknowns,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        editUnknownProposal: (
          sourceId: string,
          unknownId: string,
          resolution: string,
          targetEffect?: string,
          replacementPatch?: ForgeResolutionDraftPatch
        ) =>
          set((state: ForgeState) => {
            const analysis = state.sourceAnalyses[sourceId];
            if (!analysis) return state;
            const unk = analysis.unknowns.find((u) => u.id === unknownId);
            if (!unk || !resolution.trim()) return state;

            let finalDraftPatch = unk.resolutionProposal?.draftPatch;

            // If an explicit replacement patch is supplied, validate it before adopting
            if (replacementPatch !== undefined) {
              const currentDraft = state.forgeDraft || createInitialDraft();
              const validationRes = applyResolutionDraftPatch(currentDraft, replacementPatch);
              if (validationRes.success) {
                finalDraftPatch = replacementPatch;
              }
            }

            const res = resolution.trim();
            const eff =
              targetEffect?.trim() ||
              unk.resolutionProposal?.targetEffect ||
              unk.targetEffect;

            // Semantic no-op check
            if (
              unk.resolutionProposal &&
              unk.resolutionProposal.resolution === res &&
              unk.resolutionProposal.targetEffect === eff &&
              JSON.stringify(unk.resolutionProposal.draftPatch) === JSON.stringify(finalDraftPatch) &&
              unk.lastError === undefined
            ) {
              return state;
            }

            const updatedUnknown: ForgeSourceUnknown = {
              ...unk,
              resolutionProposal: {
                resolution: res,
                targetEffect: eff,
                draftPatch: finalDraftPatch,
              },
              lastError: undefined,
            };

            const updatedUnknowns = analysis.unknowns.map((u) =>
              u.id === unknownId ? updatedUnknown : u
            );

            return {
              sourceAnalyses: {
                ...state.sourceAnalyses,
                [analysis.id]: {
                  ...analysis,
                  unknowns: updatedUnknowns,
                },
              },
              sourceBaselineRevision: (state.sourceBaselineRevision || 0) + 1,
            };
          }),

        // --- ARCHITECT CHAT ACTIONS ---
        addArchitectMessage: (message: ArchitectMessage) =>
          set((state: ForgeState) => ({
            architectMessages: [...state.architectMessages, message],
          })),

        clearArchitectChat: () =>
          set({
            architectMessages: [
              {
                role: 'architect',
                content:
                  'I am the Architect. Tell me what kind of nightmare we are building today.',
              },
            ],
          }),

        // --- LEGACY-COMPATIBLE ADAPTER ACTIONS (Read/Write through forgeDraft) ---
        setStartingNode: (nodeId: string) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const draft = state.forgeDraft || state.draftBlueprint || createInitialDraft();
            const topo = draft.topology || { nodes: [], connections: [] };
            const nodeDefs = topo.nodeDefinitions || [];
            const rawNodes = topo.nodes || [];
            const isRich = nodeDefs.length > 0;
            const validIds = isRich ? nodeDefs.map((d) => d.id) : rawNodes;

            if (!validIds.includes(nodeId)) {
              outcome = { success: false, error: `Node ID "${nodeId}" not found in topology.` };
              return state;
            }

            if (topo.anchors?.some((a) => a.id === nodeId)) {
              outcome = { success: false, error: `Node ID "${nodeId}" is an expandable space anchor, not a main node.` };
              return state;
            }

            // Sync user character's placement
            const userChar = draft.cast?.find((c) => c.isUserCharacter) || (draft.userCharacterId ? draft.cast?.find((c) => c.id === draft.userCharacterId) : undefined);
            const updatedCast = (draft.cast || []).map((m) => {
              if (userChar && m.id === userChar.id) {
                return {
                  ...m,
                  presenceDisposition: { kind: 'AT_NODE' as const, nodeId },
                  starting_location: nodeId,
                };
              }
              return m;
            });

            const updatedDraft: ForgeDraft = {
              ...draft,
              cast: updatedCast,
              topology: {
                ...topo,
                startingNodeId: nodeId,
                startingNodeProvenance: undefined, // Clear old source provenance upon manual change
              },
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          });
          return outcome;
        },

        addTopologyNode: (node: ForgeTopologyNode) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const draft = state.forgeDraft || state.draftBlueprint || createInitialDraft();
            const topo = draft.topology || { nodes: [], connections: [] };
            const nodeDefs = topo.nodeDefinitions || [];
            const rawNodes = topo.nodes || [];

            if (!node.id || !node.id.trim()) {
              outcome = { success: false, error: 'Node ID cannot be empty.' };
              return state;
            }
            const cleanId = node.id.trim().toUpperCase().replace(/\s+/g, '_');
            if (nodeDefs.some((d) => d.id === cleanId) || rawNodes.includes(cleanId)) {
              outcome = { success: false, error: `Node ID "${cleanId}" already exists.` };
              return state;
            }

            const newDef: ForgeTopologyNode = {
              id: cleanId,
              label: node.label?.trim() || cleanId.replace(/_/g, ' '),
              description: node.description?.trim() || '',
              sensoryGuidance: node.sensoryGuidance,
            };

            const nextDefs = [...nodeDefs, newDef];
            const nextNodes = Array.from(new Set([...rawNodes, cleanId]));

            const updatedDraft: ForgeDraft = {
              ...draft,
              topology: {
                ...topo,
                nodes: nextNodes,
                nodeDefinitions: nextDefs,
                // Do NOT automatically set startingNodeId on adding first node!
                startingNodeId: topo.startingNodeId,
              },
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          });
          return outcome;
        },

        removeTopologyNode: (nodeId: string) => {
          let outcome: { success: boolean; error?: string } = { success: true };
          set((state: ForgeState) => {
            const draft = state.forgeDraft || state.draftBlueprint;
            if (!draft) return state;
            const topo = draft.topology || { nodes: [], connections: [] };
            const nextDefs = (topo.nodeDefinitions || []).filter((d) => d.id !== nodeId);
            const nextNodes = (topo.nodes || []).filter((n) => n !== nodeId);
            const nextConns = (topo.connections || []).filter((conn) => {
              if (typeof conn === 'string') {
                const parts = conn.split('->').map((s) => s.trim());
                return parts[0] !== nodeId && parts[1] !== nodeId;
              } else if (conn && typeof conn === 'object') {
                return conn.from !== nodeId && conn.to !== nodeId;
              }
              return true;
            });
            const nextAnchors = (topo.anchors || []).filter((a) => a.parentNodeId !== nodeId);

            let nextStart = topo.startingNodeId;
            let nextProv = topo.startingNodeProvenance;
            if (nextStart === nodeId) {
              nextStart = undefined;
              nextProv = undefined;
            }

            const updatedDraft: ForgeDraft = {
              ...draft,
              topology: {
                ...topo,
                nodes: nextNodes,
                nodeDefinitions: nextDefs,
                connections: nextConns,
                anchors: nextAnchors,
                startingNodeId: nextStart,
                startingNodeProvenance: nextProv,
              },
            };

            outcome = { success: true };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              draftRevision: (state.draftRevision || 0) + 1,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          });
          return outcome;
        },

        // --- LEGACY-COMPATIBLE ADAPTER ACTIONS (Read/Write through forgeDraft) ---
        addSpatialNode: (nodeId: string) =>
          set((state: ForgeState) => {
            const draft = state.forgeDraft || createInitialDraft();
            const currentNodes = draft.topology?.nodes || [];
            if (currentNodes.includes(nodeId)) return state;
            const updatedNodes = [...currentNodes, nodeId];
            const updatedDraft: ForgeDraft = {
              ...draft,
              topology: {
                ...(draft.topology || { connections: [] }),
                nodes: updatedNodes,
              },
            };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          }),

        removeSpatialNode: (nodeId: string) =>
          set((state: ForgeState) => {
            if (!state.forgeDraft) return state;
            const currentTopology = state.forgeDraft.topology || { nodes: [], connections: [] };
            const updatedNodes = (currentTopology.nodes || []).filter((id) => id !== nodeId);
            const updatedConnections = (currentTopology.connections || []).filter((conn) => {
              if (typeof conn === 'string') {
                const parts = conn.split('->').map((s) => s.trim());
                return parts[0] !== nodeId && parts[1] !== nodeId;
              } else if (conn && typeof conn === 'object') {
                return conn.from !== nodeId && conn.to !== nodeId;
              }
              return true;
            });
            const updatedDraft: ForgeDraft = {
              ...state.forgeDraft,
              topology: {
                ...currentTopology,
                nodes: updatedNodes,
                connections: updatedConnections,
              },
            };
            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          }),

        toggleSpatialEdge: (nodeA: string, nodeB: string) =>
          set((state: ForgeState) => {
            const draft = state.forgeDraft || createInitialDraft();
            const currentTopology = draft.topology || { nodes: [], connections: [] };
            const nodes = [...(currentTopology.nodes || [])];
            if (!nodes.includes(nodeA)) nodes.push(nodeA);
            if (!nodes.includes(nodeB)) nodes.push(nodeB);

            const connections = [...(currentTopology.connections || [])];
            const existingIndex = connections.findIndex((conn) => {
              if (typeof conn === 'string') {
                const parts = conn.split('->').map((s) => s.trim());
                return (
                  (parts[0] === nodeA && parts[1] === nodeB) ||
                  (parts[0] === nodeB && parts[1] === nodeA)
                );
              } else if (conn && typeof conn === 'object') {
                return (
                  (conn.from === nodeA && conn.to === nodeB) ||
                  (conn.from === nodeB && conn.to === nodeA)
                );
              }
              return false;
            });

            let updatedConnections;
            if (existingIndex >= 0) {
              updatedConnections = connections.filter((_, idx) => idx !== existingIndex);
            } else {
              updatedConnections = [
                ...connections,
                {
                  from: nodeA,
                  to: nodeB,
                  kind: 'PHYSICAL' as const,
                  userInitiated: true,
                },
              ];
            }

            const updatedDraft: ForgeDraft = {
              ...draft,
              topology: {
                ...currentTopology,
                nodes,
                connections: updatedConnections,
              },
            };

            return {
              forgeDraft: updatedDraft,
              draftBlueprint: updatedDraft,
              castLedger: deriveCastLedger(updatedDraft),
              topology: deriveTopology(updatedDraft),
            };
          }),

        updateActiveMemory: (updates: Partial<EntityMemoryState>) =>
          set((state: ForgeState) => ({
            activeMemory: { ...state.activeMemory, ...updates },
          })),

        commitSemanticTags: (parsedTags: Record<string, string[]>) =>
          set((state: ForgeState) => {
            const nextMemory = { ...state.activeMemory };

            if (parsedTags['SOMA']) nextMemory.somaticState = parsedTags['SOMA'];
            if (parsedTags['GEOM']) nextMemory.relationalWeb = parsedTags['GEOM'];
            if (parsedTags['IMP']) nextMemory.tacticalImperative = parsedTags['IMP'].join(' ');
            if (parsedTags['SYS']) nextMemory.systemFlags = parsedTags['SYS'];

            return { activeMemory: nextMemory };
          }),

        setWho: (val: string) => set({ who: val }),
        setWhat: (val: string) => set({ what: val }),
        setWhere: (val: string) => set({ where: val }),
        setWhen: (val: string) => set({ when: val }),
        setWhyHow: (val: string) => set({ whyHow: val }),
        clearForgeInputs: () => set({ who: '', what: '', where: '', when: '', whyHow: '' }),
        addMessage: (message: Message) =>
          set((state: ForgeState) => ({
            messages: [...state.messages, message],
          })),

        setAvailableReferenceCharacters: (characters: CharacterProfile[]) =>
          set({ availableReferenceCharacters: characters }),

        addCharacterToCast: (character: CharacterProfile) =>
          set((state: ForgeState) => {
            const npcCount = state.selectedCharacters.filter((c) => !c.isUserCharacter).length;
            if (!character.isUserCharacter && npcCount >= 5) return state;
            if (state.selectedCharacters.find((c) => c.id === character.id)) return state;
            return { selectedCharacters: [...state.selectedCharacters, character] };
          }),

        removeCharacterFromCast: (id: string) =>
          set((state: ForgeState) => ({
            selectedCharacters: state.selectedCharacters.filter((c) => c.id !== id),
          })),

        updateCharacterDetails: (id: string, updates: Partial<CharacterProfile>) =>
          set((state: ForgeState) => ({
            selectedCharacters: state.selectedCharacters.map((c) =>
              c.id === id ? { ...c, ...updates } : c
            ),
          })),

        setHasReferenceMaterial: (has: boolean) => set({ hasReferenceMaterial: has }),
        setForgePhase: (phase: ForgePhase) => set({ forgePhase: phase }),
        setSummaryContext: (context: string) => set({ summaryContext: context }),
        setExtractedSetting: (setting: string) => set({ extractedSetting: setting }),
        setExtractedThreat: (threat: string) => set({ extractedThreat: threat }),
        setExtractedStyle: (style: string) => set({ extractedStyle: style }),
        addReferenceMaterials: (materials: ReferenceMaterial[]) =>
          set((state: ForgeState) => ({
            referenceMaterials: [...state.referenceMaterials, ...materials],
          })),

        removeReferenceMaterial: (id: string) =>
          set((state: ForgeState) => ({
            referenceMaterials: state.referenceMaterials.filter((m) => m.id !== id),
          })),

        setActiveNeuralLink: (role: 'PROTAGONIST' | 'ANTAGONIST' | 'DIRECTOR') =>
          set({ activeNeuralLink: role }),

        setActiveCharacterId: (id: string | null) => set({ activeCharacterId: id }),

        startSimulation: (
          blueprint?:
            | SimulationBlueprintInput
            | DraftBlueprint
            | Blueprint
            | ScenarioBlueprint
            | null
        ) =>
          set((state: ForgeState) => {
            const activePerspective = blueprint?.perspectives?.find(
              (p) => p && typeof p === 'object' && 'role' in p && p.role === state.activeNeuralLink
            );

            let initialSomatic: string[] = [];
            let initialGeOM: string[] = [];
            let initialImp = '';

            if (
              activePerspective &&
              typeof activePerspective === 'object' &&
              'startingSemanticState' in activePerspective
            ) {
              const semanticState = activePerspective.startingSemanticState;
              if (semanticState && typeof semanticState === 'object') {
                initialSomatic =
                  'soma' in semanticState && Array.isArray(semanticState.soma)
                    ? semanticState.soma
                    : [];
                initialGeOM =
                  'geom' in semanticState && Array.isArray(semanticState.geom)
                    ? semanticState.geom
                    : [];
                initialImp =
                  'imp' in semanticState && typeof semanticState.imp === 'string'
                    ? semanticState.imp
                    : '';
              } else if (typeof semanticState === 'string') {
                initialImp = semanticState;
              }
            }

            return {
              activeMemory: {
                somaticState: initialSomatic,
                relationalWeb: initialGeOM,
                tacticalImperative: initialImp,
                systemFlags: [],
              },
            };
          }),
      },
    }),
    {
      name: 'the-forge-memory',
      storage: createJSONStorage(() => idbStorage),
      version: 5,
      migrate: (persistedState: unknown) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const stateRecord = persistedState as Record<string, unknown>;
        // Promote legacy draftBlueprint if forgeDraft is absent in persisted storage
        if (!stateRecord.forgeDraft && stateRecord.draftBlueprint) {
          stateRecord.forgeDraft = stateRecord.draftBlueprint;
        }
        if (stateRecord.forgeDraft && typeof stateRecord.forgeDraft === 'object') {
          const draft = stateRecord.forgeDraft as Record<string, unknown>;
          if (!draft.ambiguities || !Array.isArray(draft.ambiguities)) {
            draft.ambiguities = [];
          }
        }
        if (stateRecord.sourceAnalyses !== undefined) {
          stateRecord.sourceAnalyses = sanitizeSourceAnalyses(stateRecord.sourceAnalyses);
        }
        if (typeof stateRecord.sourceBaselineRevision !== 'number') {
          stateRecord.sourceBaselineRevision = 1;
        }
        if (stateRecord.pendingDepictionContractProposal) {
          const parseRes = DepictionContractProposalSchema.safeParse(
            stateRecord.pendingDepictionContractProposal
          );
          if (parseRes.success) {
            stateRecord.pendingDepictionContractProposal = parseRes.data;
          } else {
            stateRecord.pendingDepictionContractProposal = null;
          }
        } else {
          stateRecord.pendingDepictionContractProposal = null;
        }
        return stateRecord;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          const stateRecord = state as unknown as Record<string, unknown>;
          // Reconcile and promote legacy draftBlueprint if forgeDraft is missing
          if (!state.forgeDraft && stateRecord.draftBlueprint) {
            state.forgeDraft = stateRecord.draftBlueprint as ForgeDraft;
          }
          if (state.forgeDraft) {
            if (state.forgeDraft.cast) {
              state.forgeDraft.cast = sanitizeCastPresenceDispositions(state.forgeDraft.cast) || [];
            }
            if (!state.forgeDraft.ambiguities || !Array.isArray(state.forgeDraft.ambiguities)) {
              state.forgeDraft.ambiguities = [];
            }
          }
          if (!state.draftRevision || typeof state.draftRevision !== 'number') {
            state.draftRevision = 1;
          }
          if (!state.sourceBaselineRevision || typeof state.sourceBaselineRevision !== 'number') {
            state.sourceBaselineRevision = 1;
          }
          if (state.pendingDepictionContractProposal) {
            const parseRes = DepictionContractProposalSchema.safeParse(
              state.pendingDepictionContractProposal
            );
            if (parseRes.success) {
              state.pendingDepictionContractProposal = parseRes.data;
            } else {
              state.pendingDepictionContractProposal = null;
            }
          }
          state.sourceAnalyses = sanitizeSourceAnalyses(state.sourceAnalyses);
          // Sync any accepted cast_seed candidates into draft cast
          if (state.forgeDraft) {
            if (!Array.isArray(state.forgeDraft.cast)) {
              state.forgeDraft.cast = [];
            }
            for (const analysis of Object.values(state.sourceAnalyses || {})) {
              for (const cand of (analysis.candidates || [])) {
                if (cand.target === 'cast_seed' && cand.reviewDecision === 'accepted' && cand.proposedValue) {
                  const castMember = cand.proposedValue as ForgeDraftCastMember;
                  if (castMember && castMember.name) {
                    const alreadyExists = state.forgeDraft.cast.some(
                      (m) => m.id === castMember.id || m.name.toLowerCase() === castMember.name.toLowerCase()
                    );
                    if (!alreadyExists) {
                      state.forgeDraft.cast.push(castMember);
                    }
                  }
                }
              }
            }
            state.forgeDraft = reconcileDraftTopologyAndCast(state.forgeDraft);
          }
          // Ensure draftBlueprint is aligned with forgeDraft
          state.draftBlueprint = state.forgeDraft;
          state.castLedger = deriveCastLedger(state.forgeDraft);
          state.topology = deriveTopology(state.forgeDraft);
        }
      },
      partialize: (state) => {
        // Persist only canonical Forge draft, source baseline metadata, and intentionally retained UI state
        return {
          forgeDraft: state.forgeDraft,
          draftRevision: state.draftRevision || 1,
          sourceBaselineRevision: state.sourceBaselineRevision || 1,
          pendingDepictionContractProposal: state.pendingDepictionContractProposal,
          sourceAnalyses: state.sourceAnalyses,
          architectMessages: state.architectMessages,
          who: state.who,
          what: state.what,
          where: state.where,
          when: state.when,
          whyHow: state.whyHow,
          forgePhase: state.forgePhase,
        } as unknown as ForgeState;
      },
    }
  )
);

export interface UseForgeStateHook {
  <T>(selector: (state: ForgeState) => T): T;
  (): Readonly<ForgeState>;
  persist: typeof useForgeStoreInternal.persist;
}

export const useForgeState = ((selector?: (state: ForgeState) => unknown) => {
  return useForgeStoreInternal((state) => {
    if (selector) {
      return selector(state as ForgeState);
    }
    return state as Readonly<ForgeState>;
  });
}) as UseForgeStateHook;

useForgeState.persist = useForgeStoreInternal.persist;

export const useForgeStore = useForgeStoreInternal;
export const forgeActions: ForgeActions = useForgeStoreInternal.getState().actions;
export const getForgeState = (): Readonly<ForgeState> => {
  return useForgeStoreInternal.getState() as Readonly<ForgeState>;
};
