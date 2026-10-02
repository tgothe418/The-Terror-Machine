import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Blueprint, CastMember, SpatialNode } from '../../src/types';
import type { MacroPhase } from '../../src/types/dramaturgy';
import type {
  CohortState,
  CohortMember,
  CohortTraceEmission,
} from '../../src/types/cohort';
import type {
  CharacterSalience,
  FearContract,
  SalienceEvent,
  SomaticToken,
  ThreatType,
} from '../../src/types/fear';
import type { TopologyConnection } from '../../src/lib/cohortBehaviors';
import type {
  DeathRecord,
  DeathValence,
  DeathReceipt,
  TreatmentProposal,
  WoundFact,
  WoundFactProposal,
  WoundSeverity,
  Chronicle,
} from '../../src/types/death';
import { normalizeBlueprint } from '../../src/lib/normalizeBlueprint';
import { compileRuntimeTopology } from '../../src/lib/compileRuntimeTopology';
import {
  recordWoundFacts,
  type WoundLedger,
} from '../../src/lib/deathLedger';
import { processTurnDeathPass } from '../../src/lib/deathEngine';
import {
  calculateFearResponseIntensity,
  computeCharacterSalience,
  deriveSomaticState,
} from '../../src/lib/fearEngine';
import { tickCohortState } from '../../src/lib/cohortEngine';
import {
  evaluateSubmitResponse,
  resolveSubmitResponder,
  applySubmitOutcomeStance,
  type SubmitResponseResult,
} from '../../src/lib/submitContract';
import { isVillainCastMember } from '../../src/lib/castVillain';
import type { NodeEvidenceItem } from '../../src/lib/cohortBehaviors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type CanonicalBlueprintId =
  | 'black_iron_mortuary'
  | 'silver_rest_lodge'
  | 'the_refinement';

export const CANONICAL_BLUEPRINT_IDS: CanonicalBlueprintId[] = [
  'black_iron_mortuary',
  'silver_rest_lodge',
  'the_refinement',
];

export const BLUEPRINT_FILE_MAP: Record<CanonicalBlueprintId, string> = {
  black_iron_mortuary: 'black_iron_mortuary.json',
  silver_rest_lodge: 'silver_rest_lodge.json',
  the_refinement: 'the_refinement.json',
};

export function normalizeBlueprintId(id: string): CanonicalBlueprintId {
  const clean = id.trim().toLowerCase().replace(/^blueprint[-_]/, '');
  if (clean === 'black_iron_mortuary' || clean === 'black-iron-mortuary') {
    return 'black_iron_mortuary';
  }
  if (clean === 'silver_rest_lodge' || clean === 'silver-rest-lodge') {
    return 'silver_rest_lodge';
  }
  if (clean === 'the_refinement' || clean === 'the-refinement') {
    return 'the_refinement';
  }
  throw new Error(
    `Unknown blueprint ID "${id}". Supported blueprints: black_iron_mortuary, silver_rest_lodge, the_refinement.`
  );
}

function resolveBlueprintPath(blueprintId: CanonicalBlueprintId): string {
  const filename = BLUEPRINT_FILE_MAP[blueprintId];
  const candidates = [
    path.resolve(process.cwd(), 'src/data/blueprints', filename),
    path.resolve(process.cwd(), 'server/data/scenarios', filename),
    path.resolve(__dirname, '../../src/data/blueprints', filename),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Canon blueprint file for "${blueprintId}" not found at any candidate path: ${candidates.join(', ')}`
  );
}

export interface SandboxedScenario {
  scenarioId: string;
  blueprintId: CanonicalBlueprintId;
  blueprint: Blueprint;
  spatialGraph: SpatialNode[];
  cast: CastMember[];
  castPlacement: Record<string, string>;
  deathLedger: WoundLedger;
  deathRecords: DeathRecord[];
  salienceLedger: Record<string, CharacterSalience>;
  cohortState: CohortState;
  nodeEvidence: Record<string, NodeEvidenceItem[]>;
  nodeTraces: Record<string, CohortTraceEmission[]>;
  historyTraces: Array<{ turn: number; trace: CohortTraceEmission }>;
  turnCount: number;
  fictionalTime: number;
  macroPhase: MacroPhase;
  isTerminated: boolean;
  lastActivityAt: number;
}

export interface CharacterStateSummary {
  character_id: string;
  name: string;
  wounds: WoundFact[];
  salience: {
    spike: number;
    dread: number;
  };
  somatic_band: 0 | 1 | 2 | 3 | 4;
  somatic_tokens: SomaticToken[];
  prey_mode: boolean;
  fearlessness: number;
  position: string;
  stance: string;
}

export interface ScenarioStateSummary {
  scenario_id: string;
  blueprint_id: CanonicalBlueprintId;
  turn: number;
  fictional_time_seconds: number;
  macro_phase: MacroPhase;
  is_terminated: boolean;
  characters: Record<string, CharacterStateSummary>;
  threat_board: {
    living: string[];
    dead: string[];
    villains: string[];
  };
  pending_submits: string[];
}

export interface CircumstancePatch {
  turnCount?: number;
  fictionalTime?: number;
  macroPhase?: MacroPhase;
  castPlacement?: Record<string, string>;
  salience?: Record<
    string,
    {
      spike?: number;
      dread?: number;
      preyMode?: boolean;
      fearlessness?: number;
      threatType?: ThreatType;
    }
  >;
  wounds?: Array<{
    characterId: string;
    mechanism: string;
    location: string;
    severity: string;
    timelineMinutes?: number;
    treatability?: string;
    valence?: string;
    inflictedByCharacterId?: string;
  }>;
  isTerminated?: boolean;
}

export interface SubmitNarrationOptions {
  wound_facts?: Partial<WoundFactProposal>[];
  treatment_proposals?: TreatmentProposal[];
  pov_character?: string;
}

export interface TurnExecutionResult {
  turn: number;
  deaths_declared: DeathReceipt[];
  chronicles: Chronicle[];
  phase: MacroPhase;
  traces_emitted: CohortTraceEmission[];
  submit_outcomes: SubmitResponseResult[];
  warnings: string[];
}

export class ScenarioSandboxManager {
  private scenarios = new Map<string, SandboxedScenario>();
  private readonly idleTimeoutMs: number;

  constructor(idleTimeoutMs = 30 * 60 * 1000) {
    this.idleTimeoutMs = idleTimeoutMs;
  }

  public getRawBlueprint(blueprintId: string): Blueprint {
    const canonicalId = normalizeBlueprintId(blueprintId);
    const filePath = resolveBlueprintPath(canonicalId);
    const rawContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return normalizeBlueprint(rawContent);
  }

  public createScenario(blueprintId: string): SandboxedScenario {
    this.cleanupExpiredScenarios();

    const canonicalId = normalizeBlueprintId(blueprintId);
    const blueprint = this.getRawBlueprint(canonicalId);

    const { spatialGraph, startNodeId } = compileRuntimeTopology({
      topology: blueprint.topology,
      fallbackSetting: blueprint.setting,
    });

    const cast: CastMember[] = Array.isArray(blueprint.cast) ? [...blueprint.cast] : [];
    const castPlacement: Record<string, string> = {};

    for (const c of cast) {
      let node = startNodeId;
      const disp = c.presenceDisposition;
      if (c.starting_location && spatialGraph.some((n) => n.id === c.starting_location)) {
        node = c.starting_location;
      } else if (
        disp &&
        disp.kind === 'AT_NODE' &&
        spatialGraph.some((n) => n.id === disp.nodeId)
      ) {
        node = disp.nodeId;
      }
      castPlacement[c.id] = node;
    }

    const salienceLedger: Record<string, CharacterSalience> = {};
    for (const c of cast) {
      salienceLedger[c.id] = {
        spike: 0,
        dread: 0,
        preyMode: false,
        threatType: 'life',
        provenance: [],
      };
    }

    const cohortMembers: Record<string, CohortMember> = {};
    const nonVillains = cast.filter((c) => !isVillainCastMember(c));
    let seatHolderId: string | undefined;

    for (const c of nonVillains) {
      const isFirst = !seatHolderId;
      if (isFirst) {
        seatHolderId = c.id;
      }

      cohortMembers[c.id] = {
        characterId: c.id,
        isSeatHolder: isFirst,
        tenureTurns: 0,
        affinities: {},
        cognition: {
          characterId: c.id,
          hypotheses: {
            'hyp-threat-exists': {
              id: 'hyp-threat-exists',
              weight: 0.1,
              provenance: { lastUpdatedTurn: 0 },
            },
          },
          skepticism: c.vulnerabilityBase?.skepticism ?? 0.8,
          cognitiveDissonance: 0,
          ingestedEvidenceIds: [],
        },
        salience: {
          spike: 0,
          dread: 0,
          preyMode: false,
          threatType: 'life',
          provenance: [],
        },
        stance: 'STABLE',
      };
    }

    const cohortState: CohortState = {
      status: Object.keys(cohortMembers).length > 0 ? 'ACTIVE' : 'DORMANT',
      collectivePhase: 'ONSET',
      peakPhase: 'ONSET',
      ratifiedRatchetPhase: 'ONSET',
      seatHolderId,
      successionVulnerabilityWindowRemaining: 0,
      members: cohortMembers,
      dormantCastCognition: {},
      institutionalMemory: {},
      recentReceipts: [],
      nodeTraps: {},
      fortifiedNodes: {},
      fractures: [],
    };

    const scenarioId = `scenario-${canonicalId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const scenario: SandboxedScenario = {
      scenarioId,
      blueprintId: canonicalId,
      blueprint,
      spatialGraph,
      cast,
      castPlacement,
      deathLedger: {},
      deathRecords: [],
      salienceLedger,
      cohortState,
      nodeEvidence: {},
      nodeTraces: {},
      historyTraces: [],
      turnCount: 0,
      fictionalTime: 0,
      macroPhase: 'EXPOSITION_BASELINE',
      isTerminated: false,
      lastActivityAt: Date.now(),
    };

    this.scenarios.set(scenarioId, scenario);
    return scenario;
  }

  public getScenario(scenarioId: string): SandboxedScenario | null {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) return null;

    if (Date.now() - scenario.lastActivityAt > this.idleTimeoutMs) {
      this.scenarios.delete(scenarioId);
      return null;
    }

    scenario.lastActivityAt = Date.now();
    return scenario;
  }

  public deleteScenario(scenarioId: string): boolean {
    return this.scenarios.delete(scenarioId);
  }

  public cleanupExpiredScenarios(): void {
    const now = Date.now();
    for (const [id, s] of this.scenarios.entries()) {
      if (now - s.lastActivityAt > this.idleTimeoutMs) {
        this.scenarios.delete(id);
      }
    }
  }

  public getStateSummary(scenario: SandboxedScenario): ScenarioStateSummary {
    const deadCharIds = new Set(scenario.deathRecords.map((d) => d.characterId));
    const fearContract: Partial<FearContract> = (scenario.blueprint.fearContract as Partial<FearContract>) || {};

    const charactersSummary: Record<string, CharacterStateSummary> = {};
    const living: string[] = [];
    const dead: string[] = [];
    const villains: string[] = [];
    const pendingSubmits: string[] = [];

    for (const c of scenario.cast) {
      const isDead = deadCharIds.has(c.id);
      const isVillain = isVillainCastMember(c);

      if (isDead) {
        dead.push(c.id);
      } else {
        living.push(c.id);
      }

      if (isVillain) {
        villains.push(c.id);
      }

      const salience = scenario.salienceLedger[c.id] || {
        spike: 0,
        dread: 0,
        preyMode: false,
        threatType: 'life',
        provenance: [],
      };

      const fearlessness =
        fearContract.fearlessness && typeof fearContract.fearlessness[c.id] === 'number'
          ? fearContract.fearlessness[c.id]
          : typeof fearContract.fearlessness?.['default'] === 'number'
          ? fearContract.fearlessness['default']
          : 0;

      const intensity = calculateFearResponseIntensity(salience, fearlessness);
      const { band, tokens } = deriveSomaticState(intensity, fearContract);

      const member = scenario.cohortState.members[c.id];
      const stanceStr =
        typeof member?.stance === 'string'
          ? member.stance
          : member?.stance?.stance || 'STABLE';

      if (stanceStr.toUpperCase() === 'SUBMITTED' && !isDead) {
        pendingSubmits.push(c.id);
      }

      charactersSummary[c.id] = {
        character_id: c.id,
        name: c.name,
        wounds: scenario.deathLedger[c.id] || [],
        salience: {
          spike: salience.spike,
          dread: salience.dread,
        },
        somatic_band: band,
        somatic_tokens: tokens,
        prey_mode: Boolean(salience.preyMode),
        fearlessness,
        position: scenario.castPlacement[c.id] || 'UNKNOWN',
        stance: stanceStr,
      };
    }

    return {
      scenario_id: scenario.scenarioId,
      blueprint_id: scenario.blueprintId,
      turn: scenario.turnCount,
      fictional_time_seconds: scenario.fictionalTime,
      macro_phase: scenario.macroPhase,
      is_terminated: scenario.isTerminated,
      characters: charactersSummary,
      threat_board: {
        living,
        dead,
        villains,
      },
      pending_submits: pendingSubmits,
    };
  }

  public injectCircumstance(
    scenarioId: string,
    patch: CircumstancePatch
  ): { success: boolean; stateSummary?: ScenarioStateSummary; error?: string } {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) {
      return { success: false, error: `Scenario with ID "${scenarioId}" not found.` };
    }

    if (patch.turnCount !== undefined) {
      if (
        typeof patch.turnCount !== 'number' ||
        !Number.isInteger(patch.turnCount) ||
        patch.turnCount < 0 ||
        patch.turnCount > 100
      ) {
        return {
          success: false,
          error: `turnCount must be an integer between 0 and 100. Received: ${patch.turnCount}`,
        };
      }
    }

    if (patch.fictionalTime !== undefined) {
      if (typeof patch.fictionalTime !== 'number' || patch.fictionalTime < 0) {
        return {
          success: false,
          error: `fictionalTime must be a non-negative number. Received: ${patch.fictionalTime}`,
        };
      }
    }

    const validMacroPhases: MacroPhase[] = [
      'EXPOSITION_BASELINE',
      'INCITING_RUPTURE',
      'COMPLICATION_ENCLOSURE',
      'MIDPOINT_CRISIS',
      'ESCALATING_VISE',
      'CLIMACTIC_CONFRONTATION',
      'AFTERMATH_DENOUEMENT',
    ];
    if (patch.macroPhase !== undefined && !validMacroPhases.includes(patch.macroPhase)) {
      return {
        success: false,
        error: `macroPhase "${patch.macroPhase}" is invalid. Must be one of: ${validMacroPhases.join(', ')}`,
      };
    }

    if (patch.castPlacement !== undefined) {
      if (typeof patch.castPlacement !== 'object' || patch.castPlacement === null) {
        return {
          success: false,
          error: 'castPlacement must be an object mapping characterId to nodeId.',
        };
      }
      const validNodeIds = new Set(scenario.spatialGraph.map((n) => n.id));
      const validCharIds = new Set(scenario.cast.map((c) => c.id));
      for (const [charId, nodeId] of Object.entries(patch.castPlacement)) {
        if (!validCharIds.has(charId)) {
          return {
            success: false,
            error: `Character "${charId}" in castPlacement does not exist in scenario cast.`,
          };
        }
        if (!validNodeIds.has(nodeId)) {
          return {
            success: false,
            error: `Node "${nodeId}" in castPlacement does not exist in spatial topology.`,
          };
        }
      }
    }

    if (patch.salience !== undefined) {
      if (typeof patch.salience !== 'object' || patch.salience === null) {
        return {
          success: false,
          error: 'salience must be an object mapping characterId to salience attributes.',
        };
      }
      const validCharIds = new Set(scenario.cast.map((c) => c.id));
      for (const [charId, s] of Object.entries(patch.salience)) {
        if (!validCharIds.has(charId)) {
          return {
            success: false,
            error: `Character "${charId}" in salience patch does not exist in scenario cast.`,
          };
        }
        if (
          s.spike !== undefined &&
          (typeof s.spike !== 'number' || s.spike < 0 || s.spike > 1)
        ) {
          return {
            success: false,
            error: `Salience spike for "${charId}" must be a number between 0 and 1. Received: ${s.spike}`,
          };
        }
        if (
          s.dread !== undefined &&
          (typeof s.dread !== 'number' || s.dread < 0 || s.dread > 1)
        ) {
          return {
            success: false,
            error: `Salience dread for "${charId}" must be a number between 0 and 1. Received: ${s.dread}`,
          };
        }
      }
    }

    if (patch.wounds !== undefined) {
      if (!Array.isArray(patch.wounds)) {
        return { success: false, error: 'wounds must be an array of wound proposals.' };
      }
      const validCharIds = new Set(scenario.cast.map((c) => c.id));
      const validSeverities: WoundSeverity[] = ['minor', 'serious', 'grave', 'unsurvivable'];
      for (const w of patch.wounds) {
        if (!w.characterId || !validCharIds.has(w.characterId)) {
          return {
            success: false,
            error: `Wound characterId "${w.characterId}" is invalid or does not exist in scenario cast.`,
          };
        }
        if (!w.severity || !validSeverities.includes(w.severity as WoundSeverity)) {
          return {
            success: false,
            error: `Wound severity "${w.severity}" is invalid. Must be one of: minor, serious, grave, unsurvivable.`,
          };
        }
        if (
          w.timelineMinutes !== undefined &&
          (typeof w.timelineMinutes !== 'number' || w.timelineMinutes < 0)
        ) {
          return {
            success: false,
            error: `Wound timelineMinutes must be a non-negative number. Received: ${w.timelineMinutes}`,
          };
        }
        if (!w.mechanism || typeof w.mechanism !== 'string' || w.mechanism.trim().length === 0) {
          return {
            success: false,
            error: `Wound mechanism must be a non-empty string.`,
          };
        }
        if (!w.location || typeof w.location !== 'string' || w.location.trim().length === 0) {
          return {
            success: false,
            error: `Wound location must be a non-empty string.`,
          };
        }
      }
    }

    // Apply ratified patch
    if (patch.turnCount !== undefined) {
      scenario.turnCount = patch.turnCount;
    }
    if (patch.fictionalTime !== undefined) {
      scenario.fictionalTime = patch.fictionalTime;
    }
    if (patch.macroPhase !== undefined) {
      scenario.macroPhase = patch.macroPhase;
    }
    if (patch.castPlacement !== undefined) {
      Object.assign(scenario.castPlacement, patch.castPlacement);
    }
    if (patch.isTerminated !== undefined) {
      scenario.isTerminated = patch.isTerminated;
    }

    if (patch.salience !== undefined) {
      for (const [charId, s] of Object.entries(patch.salience)) {
        const current = scenario.salienceLedger[charId] || {
          spike: 0,
          dread: 0,
          preyMode: false,
          threatType: 'life',
          provenance: [],
        };
        const updated: CharacterSalience = {
          ...current,
          ...(s.spike !== undefined ? { spike: s.spike } : {}),
          ...(s.dread !== undefined ? { dread: s.dread } : {}),
          ...(s.preyMode !== undefined ? { preyMode: s.preyMode } : {}),
          ...(s.threatType !== undefined ? { threatType: s.threatType } : {}),
        };
        scenario.salienceLedger[charId] = updated;
        if (scenario.cohortState.members[charId]) {
          scenario.cohortState.members[charId] = {
            ...scenario.cohortState.members[charId],
            salience: updated,
          };
        }
      }
    }

    if (patch.wounds !== undefined) {
      for (const w of patch.wounds) {
        const proposal: Partial<WoundFactProposal> = {
          characterId: w.characterId,
          mechanism: w.mechanism,
          location: w.location,
          severity: w.severity as WoundSeverity,
          timelineMinutes: w.timelineMinutes ?? 60,
          treatability: w.treatability ?? 'Standard first aid',
          valence: (w.valence as DeathValence) ?? 'accident',
          inflictedByCharacterId: w.inflictedByCharacterId,
        };
        const rec = recordWoundFacts(
          w.characterId,
          [proposal],
          scenario.turnCount,
          scenario.fictionalTime,
          scenario.deathLedger
        );
        scenario.deathLedger = rec.updatedLedger;
      }
    }

    scenario.lastActivityAt = Date.now();
    return {
      success: true,
      stateSummary: this.getStateSummary(scenario),
    };
  }

  public submitNarration(
    scenarioId: string,
    narration: string,
    options?: SubmitNarrationOptions
  ): { success: boolean; turnResult?: TurnExecutionResult; error?: string } {
    const scenario = this.getScenario(scenarioId);
    if (!scenario) {
      return { success: false, error: `Scenario with ID "${scenarioId}" not found.` };
    }

    if (scenario.turnCount >= 100) {
      return {
        success: false,
        error: `Maximum turn cap (100) reached. Scenario is terminated.`,
      };
    }

    if (scenario.isTerminated) {
      return {
        success: false,
        error: `Scenario has already terminated.`,
      };
    }

    // Step clock: +1 turn, +60s fictional time
    scenario.turnCount += 1;
    scenario.fictionalTime += 60;
    if (scenario.turnCount >= 100) {
      scenario.isTerminated = true;
    }

    // 1. Process Turn Death Pass
    const povCharacterId =
      options?.pov_character ||
      scenario.blueprint.userCharacterId ||
      scenario.cast.find((c) => c.isUserCharacter)?.id ||
      scenario.cast[0]?.id;

    const deathPassResult = processTurnDeathPass({
      commandText: narration || 'Tick step',
      turnCount: scenario.turnCount,
      fictionalTime: scenario.fictionalTime,
      povCharacterId,
      deathRecords: scenario.deathRecords,
      deathLedger: scenario.deathLedger,
      cohortState: scenario.cohortState,
      nodeEvidence: scenario.nodeEvidence,
      castPlacement: scenario.castPlacement,
      deathContract: scenario.blueprint.deathContract,
      cast: scenario.cast,
      treatmentProposals: options?.treatment_proposals,
      woundFactsProposals: options?.wound_facts,
    });

    scenario.deathLedger = deathPassResult.deathLedger;
    scenario.deathRecords = deathPassResult.deathRecords;
    if (deathPassResult.cohortState) {
      scenario.cohortState = deathPassResult.cohortState;
    }
    scenario.nodeEvidence = deathPassResult.nodeEvidence;

    if (deathPassResult.povDeathDeclared) {
      scenario.isTerminated = true;
    }

    // Build topology connections from spatial graph
    const topologyConnections: TopologyConnection[] = [];
    for (const node of scenario.spatialGraph) {
      if (node.exits) {
        for (const exit of node.exits) {
          topologyConnections.push({
            fromNodeId: node.id,
            toNodeId: exit.targetNodeId,
            status: exit.isOpen ? 'OPEN' : 'LOCKED',
            kind: exit.kind || 'DOOR',
          });
        }
      } else if (node.connectedNodes) {
        for (const targetId of node.connectedNodes) {
          topologyConnections.push({
            fromNodeId: node.id,
            toNodeId: targetId,
            status: 'OPEN',
            kind: 'HALLWAY',
          });
        }
      }
    }

    // 2. Tick Cohort State Simulation
    const tickResult = tickCohortState(
      scenario.cohortState,
      60,
      {
        turnNumber: scenario.turnCount,
        fictionalTime: scenario.fictionalTime,
        salienceLedger: scenario.salienceLedger,
        fearContract: scenario.blueprint.fearContract,
        topologyNodes: scenario.spatialGraph.map((node) => ({ id: node.id, name: node.name })),
        topologyConnections,
      },
      scenario.castPlacement,
      scenario.nodeEvidence
    );
    scenario.cohortState = tickResult.nextState;

    const tracesEmitted: CohortTraceEmission[] = [];
    for (const receipt of tickResult.receipts) {
      for (const trace of receipt.tracesEmitted) {
        tracesEmitted.push(trace);
        scenario.historyTraces.push({ turn: scenario.turnCount, trace });
        if (!scenario.nodeTraces[trace.nodeId]) {
          scenario.nodeTraces[trace.nodeId] = [];
        }
        scenario.nodeTraces[trace.nodeId].push(trace);
      }
    }

    // 3. Evaluate SUBMIT response
    const submitOutcomes: SubmitResponseResult[] = [];
    const villainIds = scenario.cast.filter(isVillainCastMember).map((c) => c.id);
    const fallbackVillainId =
      villainIds.length > 0
        ? null
        : scenario.cast.find((c) => c.isEntity)?.id || 'entity';

    for (const receipt of tickResult.receipts) {
      if (receipt.selectedBehavior === 'SUBMIT' || receipt.submissionAttempted) {
        let villainId: string | null = null;
        if (fallbackVillainId) {
          villainId = fallbackVillainId;
        } else {
          const responder = resolveSubmitResponder(
            villainIds,
            receipt.characterId,
            scenario.castPlacement,
            topologyConnections,
            scenario.spatialGraph
          );
          if (!responder) {
            // No villain can perceive: UNPERCEIVED semantics, stance persists.
            submitOutcomes.push({
              canPerceive: false,
              outcome: 'UNPERCEIVED',
              description: `No villain is in position to perceive ${receipt.characterId}'s submission. The plea goes unheard; submission stance persists.`,
              targetStancePostState: 'SUBMITTED',
            });
            continue;
          }
          villainId = responder.villainId;
        }
        const outcome = evaluateSubmitResponse({
          villainId,
          submittedCharId: receipt.characterId,
          spatialGraph: scenario.spatialGraph,
          castPlacement: scenario.castPlacement,
          topologyConnections,
          fearContract: scenario.blueprint.fearContract,
          isVillainHuman: false,
        });
        submitOutcomes.push(outcome);
        scenario.cohortState = applySubmitOutcomeStance(
          scenario.cohortState,
          receipt.characterId,
          outcome.targetStancePostState
        );
      }
    }

    // 4. Update fear salience
    for (const char of scenario.cast) {
      const currentSalience = scenario.salienceLedger[char.id] || {
        spike: 0,
        dread: 0,
        preyMode: false,
        threatType: 'life',
        provenance: [],
      };

      const events: SalienceEvent[] = [];
      const charWounds = scenario.deathLedger[char.id] || [];
      const turnWounds = charWounds.filter((w) => w.inflictedAtTurn === scenario.turnCount);
      for (const tw of turnWounds) {
        const attackerId = tw.inflictedByCharacterId || undefined;
        const attackerNode = attackerId ? scenario.castPlacement[attackerId] : undefined;
        const victimNode = scenario.castPlacement[char.id];
        events.push({
          eventId: tw.id,
          kind: 'wound',
          spikeDelta:
            tw.severity === 'unsurvivable'
              ? 0.8
              : tw.severity === 'grave'
              ? 0.6
              : tw.severity === 'serious'
              ? 0.4
              : 0.2,
          dreadDelta: 0.1,
          turn: scenario.turnCount,
          threatType: 'life',
          ...(attackerId ? { sourceId: attackerId } : {}),
          ...(attackerId && attackerNode && victimNode && attackerNode === victimNode
            ? { perceivedSourceId: attackerId }
            : {}),
        });
      }

      const charNode = scenario.castPlacement[char.id];
      for (const d of deathPassResult.deathsDeclared) {
        const deadCharId = d.record.characterId;
        if (deadCharId !== char.id) {
          const deadNode = scenario.castPlacement[deadCharId];
          if (deadNode && deadNode === charNode) {
            const killerId = d.record.causedByCharacterId || undefined;
            const killerNode = killerId ? scenario.castPlacement[killerId] : undefined;
            events.push({
              eventId: `witnessed-death-${d.record.id}`,
              kind: 'witnessed-death',
              spikeDelta: 0.4,
              dreadDelta: 0.2,
              turn: scenario.turnCount,
              threatType: 'life',
              ...(killerId ? { sourceId: killerId } : {}),
              ...(killerId && killerNode && deadNode === killerNode ? { perceivedSourceId: killerId } : {}),
            });
          }
        }
      }

      const updated = computeCharacterSalience(
        currentSalience,
        events,
        scenario.blueprint.fearContract || {},
        [],
        scenario.turnCount,
        char.id
      );
      scenario.salienceLedger[char.id] = updated;
      if (scenario.cohortState.members[char.id]) {
        scenario.cohortState.members[char.id] = {
          ...scenario.cohortState.members[char.id],
          salience: updated,
        };
      }
    }

    // 5. Update macroPhase progression
    if (scenario.isTerminated) {
      scenario.macroPhase = 'AFTERMATH_DENOUEMENT';
    } else if (scenario.turnCount >= 80) {
      scenario.macroPhase = 'CLIMACTIC_CONFRONTATION';
    } else if (scenario.turnCount >= 60) {
      scenario.macroPhase = 'ESCALATING_VISE';
    } else if (scenario.turnCount >= 40) {
      scenario.macroPhase = 'MIDPOINT_CRISIS';
    } else if (scenario.turnCount >= 20) {
      scenario.macroPhase = 'COMPLICATION_ENCLOSURE';
    } else if (scenario.deathRecords.length > 0 || scenario.turnCount >= 5) {
      scenario.macroPhase = 'INCITING_RUPTURE';
    } else {
      scenario.macroPhase = 'EXPOSITION_BASELINE';
    }

    const chronicles: Chronicle[] = scenario.isTerminated
      ? [this.buildChronicle(scenario)]
      : [];

    scenario.lastActivityAt = Date.now();
    return {
      success: true,
      turnResult: {
        turn: scenario.turnCount,
        deaths_declared: deathPassResult.deathsDeclared,
        chronicles,
        phase: scenario.macroPhase,
        traces_emitted: tracesEmitted,
        submit_outcomes: submitOutcomes,
        warnings: [],
      },
    };
  }

  public buildChronicle(scenario: SandboxedScenario): Chronicle {
    const deadCharIds = new Set(scenario.deathRecords.map((d) => d.characterId));
    const castFates = scenario.cast.map((c) => ({
      name: c.name,
      fate: deadCharIds.has(c.id) ? 'Deceased' : 'Survived or Contained',
    }));

    return {
      scenarioTitle: scenario.blueprint.identity?.title || scenario.blueprint.title || 'Unknown Enclosure',
      turnCount: scenario.turnCount,
      fictionalDurationText: `${scenario.fictionalTime} fictional seconds elapsed`,
      castFates,
      cohortPhaseHistory: [scenario.cohortState.collectivePhase],
      deaths: scenario.deathRecords,
      keyEvidence: Object.values(scenario.nodeEvidence)
        .flat()
        .map((e) => e.text || ''),
      closingLine: 'The containment cycle concludes; the trace remains in the silence.',
    };
  }
}

export const scenarioSandboxManager = new ScenarioSandboxManager();
