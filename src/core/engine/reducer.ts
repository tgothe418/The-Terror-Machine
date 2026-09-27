import { EngineEvent, Phase, DecayState } from './events';
import {
  Message,
  NarrativeBlock,
  TurnFailureReceipt,
  HorrorVector,
  ExposureTier,
  TurnReceipt,
  SpatialNode,
  ParticipationContext,
  LogicState,
  DurableSessionRevision,
} from '../../types';
import { formatTurnFailureMessage, normalizeTurnFailureReceipt } from '../../lib/turnResponseReader';
import {
  captureRuntimeSnapshot,
  isHorrorVector,
  isExposureTier,
} from './snapshot';
import { applyTopologyDeltaToGraph } from './topologyCommit';
import type { CohortState, CohortTraceEmission } from '../../types/cohort';
import type { NodeEvidenceItem } from '../../lib/cohortBehaviors';
import { tickCohortState } from '../../lib/cohortEngine';
import type { WoundFact, DeathRecord, DeathContract } from '../../types/death';
import { processTurnDeathPass } from '../../lib/deathEngine';
import type { FearContract, SalienceLedger } from '../../types/fear';
import { cloneSalienceLedger } from '../../lib/fearEngine';
import type {
  RestraintLedger,
  WorldObjectLedger,
  AttentionLedger,
  RoutineLedger,
  ObjectTransitionProposal,
  ObjectTransitionDecision,
  AttentionTransitionProposal,
  AttentionTransitionDecision,
  AttemptFilterContext,
} from '../../types/worldState';
import {
  evaluateObjectTransition,
  applyObjectTransition,
  applyLockTransition,
} from '../../lib/objectMechanics';
import {
  evaluateAttentionTransition,
  applyAttentionTransition,
} from '../../lib/attentionMechanics';

export interface RetakeRestorableEngineState {
  sessionId?: string;
  blueprintId?: string;
  participationContext?: ParticipationContext | null;
  phase: Phase;
  escalation_state: 'LATENT' | 'REACTIVE' | 'TRANSGRESSIVE' | 'BLACKOUT';
  currentNodeId: string | null;
  spatialGraph?: SpatialNode[];
  activeVector: HorrorVector;
  activeTier: ExposureTier;
  decay: DecayState;
  turnCount: number;
  canonicalRevision?: number;
  roomsGenerated: number;
  maxRooms?: number;
  aesthetic?: string;
  activeEntities?: unknown[];
  traumaLedger: string[];
  activeMemory: {
    systemFlags: string[];
    somaState: string[];
    geomState: string[];
  };
  motifLedger: Record<string, number>;
  pacingLedger: {
    failedEscapeAttempts: number;
    memoryAnchorsRemaining: number;
    spatialContradictions: number;
  };
  timelineRevision: number;
  lastDistilledRevision: number;
  reconciliationRevision: number;
  history: Message[];
  storyLog?: NarrativeBlock[];
  currentPhase?: string;
  tensionLevel?: number;
  nodeState?: {
    dynamic_conditions?: Record<string, unknown>;
  };
  cohortState?: CohortState;
  nodeEvidence?: Record<string, NodeEvidenceItem[]>;
  nodeTraces?: Record<string, CohortTraceEmission[]>;
  castPlacement?: Record<string, string>;
  deathContract?: DeathContract;
  deathLedger?: Record<string, WoundFact[]>;
  deathRecords?: DeathRecord[];
  salienceLedger?: SalienceLedger;
  fearContract?: FearContract;
  cast?: Array<{
    id: string;
    name?: string;
    disposition?: string;
    isUndead?: boolean;
    isUserCharacter?: boolean;
    [k: string]: unknown;
  }>;
  restraintLedger?: RestraintLedger;
  worldObjectLedger?: WorldObjectLedger;
  attentionLedger?: AttentionLedger;
  routineLedger?: RoutineLedger;
}

export interface RetakeCheckpoint {
  version: 1;
  commandText: string;
  engineStateBefore: RetakeRestorableEngineState;
  engineGameStateBefore: LogicState | null;
  durableSessionRevisionBefore?: DurableSessionRevision | null;
}

export interface EngineState extends RetakeRestorableEngineState {
  lastTurnCheckpoint: RetakeCheckpoint | null;
}

export function captureRetakeRestorableState(
  state: EngineState
): RetakeRestorableEngineState {
  return {
    sessionId: state.sessionId,
    blueprintId: state.blueprintId,
    participationContext: state.participationContext,
    phase: state.phase,
    escalation_state: state.escalation_state,
    currentNodeId: state.currentNodeId,
    spatialGraph: state.spatialGraph,
    activeVector: state.activeVector,
    activeTier: state.activeTier,
    decay: state.decay,
    turnCount: state.turnCount,
    canonicalRevision: state.canonicalRevision ?? 0,
    roomsGenerated: state.roomsGenerated,
    maxRooms: state.maxRooms,
    aesthetic: state.aesthetic,
    activeEntities: state.activeEntities,
    traumaLedger: state.traumaLedger,
    activeMemory: state.activeMemory,
    motifLedger: state.motifLedger,
    pacingLedger: state.pacingLedger,
    timelineRevision: state.timelineRevision,
    lastDistilledRevision: state.lastDistilledRevision,
    reconciliationRevision: state.reconciliationRevision,
    history: state.history,
    storyLog: state.storyLog,
    currentPhase: state.currentPhase,
    tensionLevel: state.tensionLevel,
    nodeState: state.nodeState,
    cohortState: state.cohortState,
    nodeEvidence: state.nodeEvidence,
    nodeTraces: state.nodeTraces,
    castPlacement: state.castPlacement,
    deathContract: state.deathContract,
    deathLedger: state.deathLedger,
    deathRecords: state.deathRecords,
    salienceLedger: cloneSalienceLedger(state.salienceLedger),
    fearContract: state.fearContract ? { ...state.fearContract } : undefined,
    cast: state.cast,
    restraintLedger: state.restraintLedger
      ? JSON.parse(JSON.stringify(state.restraintLedger))
      : undefined,
    worldObjectLedger: state.worldObjectLedger
      ? JSON.parse(JSON.stringify(state.worldObjectLedger))
      : undefined,
    attentionLedger: state.attentionLedger
      ? JSON.parse(JSON.stringify(state.attentionLedger))
      : undefined,
    routineLedger: state.routineLedger
      ? JSON.parse(JSON.stringify(state.routineLedger))
      : undefined,
  } satisfies RetakeRestorableEngineState;
}

export function applyReconciliationPatch(
  currentState: EngineState & Record<string, unknown>,
  patch: Record<string, unknown>
): EngineState & Record<string, unknown> {
  if (!patch) return currentState;

  const newState = { ...currentState };
  const validKeys = [
    'activeMemory',
    'pacingLedger',
    'traumaLedger',
    'motifLedger',
    'phase',
    'escalation_state',
    'turnCount',
    'currentNodeId',
    'activeVector',
    'activeTier',
    'reconciliationRevision',
    'decay',
    'castLedger',
    'systemFlags',
    'narrativeVelocity',
    'nodeState',
    'roomsGenerated',
    'maxRooms',
    'aesthetic',
    'activeEntities',
    'cohortState',
    'nodeEvidence',
    'nodeTraces',
    'castPlacement',
    'deathContract',
    'deathLedger',
    'deathRecords',
    'salienceLedger',
    'fearContract',
    'cast',
    'restraintLedger',
    'worldObjectLedger',
    'attentionLedger',
    'routineLedger',
  ];

  const dynamicConditions: Record<string, unknown> = {
    ...currentState.nodeState?.dynamic_conditions,
  };

  for (const key in patch) {
    if (key === 'castLedger' && currentState.gameState) {
      if (!newState.gameState)
        newState.gameState = { ...(currentState.gameState as Record<string, unknown>) };
      (newState.gameState as Record<string, unknown>).cast_ledger = patch.castLedger;
    } else if (key === 'restraintLedger' && typeof patch[key] === 'object' && patch[key] !== null) {
      const cur = (currentState.restraintLedger || { bindings: {}, locks: {} }) as RestraintLedger;
      const p = patch[key] as Partial<RestraintLedger>;
      newState.restraintLedger = {
        bindings: { ...(cur.bindings || {}), ...(p.bindings || {}) },
        locks: { ...(cur.locks || {}), ...(p.locks || {}) },
      };
    } else if (validKeys.includes(key)) {
      if (typeof patch[key] === 'object' && patch[key] !== null && !Array.isArray(patch[key])) {
        newState[key] = {
          ...(currentState[key] as Record<string, unknown>),
          ...(patch[key] as Record<string, unknown>),
        };
      } else {
        newState[key] = patch[key];
      }
    } else {
      // Unrecognized hallucinated flags go here
      dynamicConditions[key] = patch[key];
    }
  }

  if (Object.keys(dynamicConditions).length > 0) {
    newState.nodeState = {
      ...newState.nodeState,
      dynamic_conditions: dynamicConditions,
    };
  }

  return newState;
}

export const initialEngineState: EngineState = {
  sessionId: '',
  blueprintId: '',
  participationContext: null,
  phase: 'HUB',
  escalation_state: 'LATENT',
  currentNodeId: null,
  spatialGraph: [],
  activeVector: 'COGNITIVE',
  activeTier: 'LATENT',
  decay: { stage: 'STABLE', coherence: 1.0 },
  turnCount: 0,
  canonicalRevision: 0,
  roomsGenerated: 0,
  traumaLedger: [],
  activeMemory: {
    systemFlags: [],
    somaState: [],
    geomState: [],
  },
  motifLedger: {},
  pacingLedger: {
    failedEscapeAttempts: 0,
    memoryAnchorsRemaining: 3,
    spatialContradictions: 0,
  },
  timelineRevision: 0,
  lastDistilledRevision: -1,
  reconciliationRevision: 0,
  history: [],
  lastTurnCheckpoint: null,
  cohortState: undefined,
  nodeEvidence: {},
  nodeTraces: {},
  castPlacement: {},
  deathContract: undefined,
  deathLedger: {},
  deathRecords: [],
  salienceLedger: {},
  fearContract: undefined,
  cast: [],
  restraintLedger: undefined,
  worldObjectLedger: undefined,
  attentionLedger: undefined,
  routineLedger: undefined,
};

export function engineReducer(state: EngineState, event: EngineEvent): EngineState {
  switch (event.type) {
    case 'TURN_COMMITTED': {
      const lastTurnCheckpoint = {
        version: 1 as const,
        commandText: event.payload.commandText,
        engineStateBefore: captureRetakeRestorableState(state),
        engineGameStateBefore: event.payload.engineGameStateBefore ?? null,
      };

      // 1. Consume required pre-turn snapshot directly from the payload
      const preSnapshot = event.payload.preSnapshot;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: event.payload.commandText,
        timestamp: event.payload.timestamp || Date.now(),
      };

      // 2. Pure topology delta application
      const topologyResult = applyTopologyDeltaToGraph({
        spatialGraph: state.spatialGraph,
        currentNodeId: state.currentNodeId,
        topologyDelta: event.payload.frame.topologyDelta,
        transitionReceipt: event.payload.transitionReceipt,
      });

      const nextNodeId = topologyResult.nextNodeId;
      const nextGraph = topologyResult.nextGraph;

      const newFlags = event.payload.frame.logic_state?.terminal_flags || [];
      const currentFlags = state.activeMemory?.systemFlags || [];
      const combinedFlags = Array.from(new Set([...currentFlags, ...newFlags]));

      // 3. Matrix coordinate mutation
      // A successful turn with a valid, complete matrix mutation may change both coordinates atomically.
      // A missing, partial, malformed, or unsupported mutation must preserve existing coordinates.
      let nextVector: HorrorVector = state.activeVector || 'COGNITIVE';
      let nextTier: ExposureTier = state.activeTier || 'LATENT';
      const mutation = event.payload.frame.logic_state?.matrix_mutation;
      if (mutation && typeof mutation === 'object') {
        const candidateVector = mutation.next_vector as HorrorVector;
        const candidateTier = mutation.next_tier as ExposureTier;
        if (
          candidateVector &&
          candidateTier &&
          isHorrorVector(candidateVector) &&
          isExposureTier(candidateTier)
        ) {
          nextVector = candidateVector;
          nextTier = candidateTier;
        }
      }

      // 4. Narrative reconciliation revision ownership
      let revisionIncrement = 0;
      if (
        typeof event.payload.turnReceipt?.narrativeReconciliationReceipt?.revision_increment ===
        'number'
      ) {
        revisionIncrement =
          event.payload.turnReceipt.narrativeReconciliationReceipt.revision_increment;
      } else if (
        typeof event.payload.frame?.narrativeReconciliationReceipt?.revision_increment === 'number'
      ) {
        revisionIncrement = event.payload.frame.narrativeReconciliationReceipt.revision_increment;
      } else if (typeof event.payload.frame?.reconciliation?.revisionIncrement === 'number') {
        revisionIncrement = event.payload.frame.reconciliation.revisionIncrement;
      } else if (
        event.payload.frame?.logic_state?.intent_classification === 'HALLUCINATION_COLLISION'
      ) {
        revisionIncrement = 1;
      } else {
        revisionIncrement = 0;
      }
      const nextReconciliationRevision = (state.reconciliationRevision || 0) + revisionIncrement;

      const nextPhase =
        event.payload.frame.logic_state?.current_phase || state.currentPhase || 'LATENT';
      const nextTension =
        typeof event.payload.frame.logic_state?.suggested_tension === 'number'
          ? event.payload.frame.logic_state.suggested_tension
          : state.tensionLevel ?? 0;

      const updatedTurnCount = state.turnCount + 1;
      const updatedStoryLog = [
        ...(state.storyLog || []),
        ...(event.payload.frame.narrative_blocks || []),
      ];

      // 5. Capture post-turn snapshot from the resulting committed state
      const postSnapshot = captureRuntimeSnapshot({
        ...state,
        turnCount: updatedTurnCount,
        currentNodeId: nextNodeId,
        activeVector: nextVector,
        activeTier: nextTier,
        phase: nextPhase,
        currentPhase: nextPhase,
        tensionLevel: nextTension,
        reconciliationRevision: nextReconciliationRevision,
        activeFlags: combinedFlags,
      });

      const topologyConnections: Array<{
        fromNodeId: string;
        toNodeId: string;
        status: 'OPEN' | 'LOCKED' | 'BLOCKED';
        kind: string;
      }> = [];
      for (const node of nextGraph || []) {
        if (node.exits && node.exits.length > 0) {
          for (const edge of node.exits) {
            topologyConnections.push({
              fromNodeId: node.id,
              toNodeId: edge.targetNodeId,
              status: edge.isOpen ? 'OPEN' : 'LOCKED',
              kind: edge.kind || 'PHYSICAL',
            });
          }
        } else if (node.connectedNodes) {
          for (const targetId of node.connectedNodes) {
            topologyConnections.push({
              fromNodeId: node.id,
              toNodeId: targetId,
              status: 'OPEN',
              kind: 'PHYSICAL',
            });
          }
        }
      }

      const povCharId =
        (state as unknown as { selectedCharacterId?: string }).selectedCharacterId ||
        (state as unknown as { gameState?: { player_character_id?: string | null } }).gameState?.player_character_id ||
        (state.cast || []).find((c: { isUserCharacter?: boolean; id?: string }) => c.isUserCharacter)?.id ||
        (state.castPlacement && Object.keys(state.castPlacement).length > 0 ? Object.keys(state.castPlacement)[0] : null) ||
        null;

      // Object transitions processing (Packet 2)
      const payloadObj = event.payload as unknown as Record<string, unknown>;
      const frameObj = event.payload.frame as unknown as Record<string, unknown> | undefined;
      const receiptObj = event.payload.turnReceipt as unknown as Record<string, unknown> | undefined;
      const rawObjectProposals = (frameObj?.objectTransitions ||
        payloadObj?.objectTransitions ||
        receiptObj?.objectTransitions) as ObjectTransitionProposal[] | undefined;
      const hasObjectProposals = Array.isArray(rawObjectProposals) && rawObjectProposals.length > 0;

      let nextWorldObjectLedger: WorldObjectLedger | undefined = state.worldObjectLedger
        ? JSON.parse(JSON.stringify(state.worldObjectLedger))
        : undefined;
      let nextRestraintLedger: RestraintLedger | undefined = state.restraintLedger
        ? JSON.parse(JSON.stringify(state.restraintLedger))
        : undefined;
      let objectDecisions: ObjectTransitionDecision[] | undefined = undefined;

      if (hasObjectProposals) {
        let currentObjects: WorldObjectLedger = nextWorldObjectLedger || {};
        let currentRestraint: RestraintLedger = nextRestraintLedger || { bindings: {}, locks: {} };
        const actingCharId = povCharId || 'player';
        const decisions: ObjectTransitionDecision[] = [];

        for (const proposal of rawObjectProposals) {
          const objectCtx: AttemptFilterContext = {
            restraint: currentRestraint,
            objects: currentObjects,
            attention: state.attentionLedger || {},
            routines: state.routineLedger || {},
            capabilities: {},
            seats: {
              captorCharacterIds: (state.cast || [])
                .filter((c: { disposition?: string; isEntity?: boolean }) => c.disposition === 'HOSTILE' || Boolean(c.isEntity))
                .map((c: { id: string }) => c.id),
              preyCharacterIds: actingCharId ? [actingCharId] : [],
            },
            fictionalTime: updatedTurnCount * 60,
            characterNodes: {
              ...(state.castPlacement || {}),
              ...(actingCharId ? { [actingCharId]: nextNodeId || state.currentNodeId || state.castPlacement?.[actingCharId] || 'node-1' } : {}),
            },
            topologyConnections: topologyConnections.map((c) => ({
              fromNodeId: c.fromNodeId,
              toNodeId: c.toNodeId,
              status: c.status,
            })),
          };

          const decision = evaluateObjectTransition(actingCharId, proposal, objectCtx);
          decisions.push(decision);

          if (decision.accepted) {
            currentObjects = applyObjectTransition(
              currentObjects,
              actingCharId,
              proposal,
              objectCtx
            );
            if (proposal.transition === 'UNLOCK') {
              currentRestraint = applyLockTransition(currentRestraint, decision);
            }
          }
        }

        nextWorldObjectLedger = currentObjects;
        nextRestraintLedger = currentRestraint;
        objectDecisions = decisions;
      }

      // Attention transitions processing (Packet 3)
      const rawAttentionProposals = (frameObj?.attentionTransitions ||
        payloadObj?.attentionTransitions ||
        receiptObj?.attentionTransitions) as AttentionTransitionProposal[] | undefined;
      const hasAttentionProposals = Array.isArray(rawAttentionProposals) && rawAttentionProposals.length > 0;

      let nextAttentionLedger: AttentionLedger | undefined = state.attentionLedger
        ? JSON.parse(JSON.stringify(state.attentionLedger))
        : undefined;
      let attentionDecisions: AttentionTransitionDecision[] | undefined = undefined;

      if (hasAttentionProposals) {
        let currentAttention: AttentionLedger = nextAttentionLedger || {};
        const decisions: AttentionTransitionDecision[] = [];

        for (const proposal of rawAttentionProposals) {
          const attentionCtx: AttemptFilterContext = {
            restraint: nextRestraintLedger || state.restraintLedger || { bindings: {}, locks: {} },
            objects: nextWorldObjectLedger || state.worldObjectLedger || {},
            attention: currentAttention,
            routines: state.routineLedger || {},
            capabilities: {},
            seats: {
              captorCharacterIds: (state.cast || [])
                .filter((c: { disposition?: string; isEntity?: boolean }) => c.disposition === 'HOSTILE' || Boolean(c.isEntity))
                .map((c: { id: string }) => c.id),
              preyCharacterIds: povCharId ? [povCharId] : [],
            },
            fictionalTime: updatedTurnCount * 60,
            characterNodes: {
              ...(state.castPlacement || {}),
              ...(povCharId ? { [povCharId]: nextNodeId || state.currentNodeId || state.castPlacement?.[povCharId] || 'node-1' } : {}),
            },
            topologyConnections: topologyConnections.map((c) => ({
              fromNodeId: c.fromNodeId,
              toNodeId: c.toNodeId,
              status: c.status,
            })),
          };

          const decision = evaluateAttentionTransition(proposal, attentionCtx);
          decisions.push(decision);

          if (decision.accepted) {
            currentAttention = applyAttentionTransition(
              currentAttention,
              proposal,
              attentionCtx
            );
          }
        }

        nextAttentionLedger = currentAttention;
        attentionDecisions = decisions;
      }

      const committedTurnReceipt: TurnReceipt = {
        ...event.payload.turnReceipt,
        ...(objectDecisions && objectDecisions.length > 0 ? { objectTransitionReceipt: objectDecisions } : {}),
        ...(attentionDecisions && attentionDecisions.length > 0 ? { attentionTransitionReceipt: attentionDecisions } : {}),
        nodeAfter: nextNodeId,
        activeVector: nextVector,
        activeTier: nextTier,
        tension: nextTension,
        preSnapshot,
        postSnapshot,
      };

      if (!hasObjectProposals) {
        delete (committedTurnReceipt as unknown as Record<string, unknown>).objectTransitionReceipt;
      }
      if (!hasAttentionProposals) {
        delete (committedTurnReceipt as unknown as Record<string, unknown>).attentionTransitionReceipt;
      }

      const engineMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: event.payload.formattedText,
        timestamp: (event.payload.timestamp || Date.now()) + 1,
        blocks: event.payload.frame.narrative_blocks,
        engine_thoughts: event.payload.frame.engine_thoughts,
        logic_state: event.payload.frame.logic_state,
        topologyDelta: event.payload.frame.topologyDelta,
        validation: event.payload.frame.validation,
        contextReceipt: event.payload.frame.contextReceipt,
        transitionReceipt: event.payload.transitionReceipt,
        turnReceipt: committedTurnReceipt,
      };

      let nextCohortState = state.cohortState;
      const nextNodeEvidence = state.nodeEvidence ? { ...state.nodeEvidence } : {};
      const nextNodeTraces = state.nodeTraces ? { ...state.nodeTraces } : {};
      const nextCastPlacement = state.castPlacement ? { ...state.castPlacement } : {};

      if (nextCohortState && nextCohortState.status !== 'DORMANT') {
        const cost =
          event.payload.turnReceipt?.narrativeReconciliationReceipt?.fictional_time_cost ||
          ((event.payload.frame as unknown as Record<string, Record<string, unknown>>)?.reconciliation?.fictionalTimeCost as string | undefined) ||
          'SCENE_BEAT';
        let deltaSeconds = 60;
        if (cost === 'MOMENT') deltaSeconds = 15;
        else if (cost === 'SCENE_BEAT') deltaSeconds = 180;
        else if (cost === 'EXTENDED') deltaSeconds = 900;

        const topologyNodes = (nextGraph || []).map((n) => ({
          id: n.id,
          name: n.name || n.id,
        }));

        const { nextState: tickedCohort, receipts } = tickCohortState(
          nextCohortState,
          deltaSeconds,
          {
            turnNumber: updatedTurnCount,
            fictionalTime: (state.turnCount || 0) * 60,
            topologyNodes,
            topologyConnections,
          },
          nextCastPlacement,
          nextNodeEvidence
        );
        nextCohortState = tickedCohort;

        for (const r of receipts) {
          for (const t of r.tracesEmitted) {
            nextNodeTraces[t.nodeId] = [...(nextNodeTraces[t.nodeId] || []), t];
          }
        }
      }

      // 6. Death subsystem pass (§5, §15)
      const deathPassRes = processTurnDeathPass({
        commandText: event.payload.commandText,
        turnCount: updatedTurnCount,
        fictionalTime: (state.turnCount || 0) * 60,
        povCharacterId: povCharId,
        woundFactsProposals: event.payload.frame.wound_facts,
        treatmentProposals: event.payload.frame.treatment_proposals,
        deathLedger: state.deathLedger,
        deathRecords: state.deathRecords,
        cohortState: nextCohortState,
        nodeEvidence: nextNodeEvidence,
        castPlacement: nextCastPlacement,
        spatialGraph: nextGraph,
        deathContract: state.deathContract,
        cast: state.cast,
      });

      if (deathPassRes.cohortState) {
        nextCohortState = deathPassRes.cohortState;
      }
      const updatedNodeEvidence = deathPassRes.nodeEvidence || nextNodeEvidence;
      const updatedCast = deathPassRes.cast || state.cast;

      const isPovTerminated = deathPassRes.povDeathDeclared;
      const validEnginePhases: Phase[] = ['LATENT', 'MANIFEST', 'TERMINAL', 'TERMINATED', 'ENGINE'];
      const normalizedEnginePhase: Phase = validEnginePhases.includes(nextPhase as Phase)
        ? (nextPhase as Phase)
        : (validEnginePhases.includes(state.phase) ? state.phase : 'MANIFEST');
      const resolvedPhase: Phase = isPovTerminated
        ? 'TERMINATED'
        : state.phase === 'TERMINATED'
        ? 'TERMINATED'
        : normalizedEnginePhase;
      const resolvedCurrentPhase = isPovTerminated ? 'TERMINATED' : nextPhase;

      return {
        ...state,
        phase: resolvedPhase,
        currentPhase: resolvedCurrentPhase,
        lastTurnCheckpoint,
        history: [...(state.history || []), userMsg, engineMsg],
        turnCount: updatedTurnCount,
        canonicalRevision: (state.canonicalRevision || 0) + 1,
        currentNodeId: nextNodeId,
        spatialGraph: nextGraph,
        activeVector: nextVector,
        activeTier: nextTier,
        reconciliationRevision: nextReconciliationRevision,
        storyLog: updatedStoryLog,
        tensionLevel: nextTension,
        activeMemory: {
          ...state.activeMemory,
          systemFlags: combinedFlags,
        },
        cohortState: nextCohortState,
        nodeEvidence: updatedNodeEvidence,
        nodeTraces: nextNodeTraces,
        castPlacement: nextCastPlacement,
        deathLedger: deathPassRes.deathLedger,
        deathRecords: deathPassRes.deathRecords,
        salienceLedger: event.payload.frame.logic_state?.salience_ledger ||
          event.payload.frame.logic_state?.salienceLedger ||
          event.payload.frame.salienceLedger
            ? cloneSalienceLedger({
                ...(state.salienceLedger || {}),
                ...(event.payload.frame.logic_state?.salience_ledger ||
                  event.payload.frame.logic_state?.salienceLedger ||
                  event.payload.frame.salienceLedger),
              })
            : cloneSalienceLedger(state.salienceLedger || {}),
        fearContract: state.fearContract,
        cast: updatedCast,
        ...(nextWorldObjectLedger !== undefined ? { worldObjectLedger: nextWorldObjectLedger } : {}),
        ...(nextRestraintLedger !== undefined ? { restraintLedger: nextRestraintLedger } : {}),
        ...(nextAttentionLedger !== undefined ? { attentionLedger: nextAttentionLedger } : {}),
      };
    }

    case 'TURN_FAILED': {
      if (event.payload.preSnapshot) {
        const attemptSession = event.payload.preSnapshot.sessionId;
        const currentSession = state.sessionId;
        if (
          attemptSession !== undefined &&
          currentSession !== undefined &&
          currentSession !== null &&
          attemptSession !== currentSession
        ) {
          return state;
        }

        const attemptBp = event.payload.preSnapshot.blueprintId;
        const currentBp = state.blueprintId;
        if (
          attemptBp !== undefined &&
          currentBp !== undefined &&
          currentBp !== null &&
          attemptBp !== currentBp
        ) {
          return state;
        }

        if (
          typeof event.payload.preSnapshot.canonicalRevision === 'number' &&
          typeof state.canonicalRevision === 'number' &&
          event.payload.preSnapshot.canonicalRevision !== state.canonicalRevision
        ) {
          return state;
        }
      }

      const rawReceipt = event.payload.failureReceipt || {
        code: event.payload.errorCategory || 'UNKNOWN_ERROR',
        status: event.payload.statusCode ?? null,
        contentType: event.payload.contentType ?? null,
        message: event.payload.errorMessage,
      };
      const receipt: TurnFailureReceipt = normalizeTurnFailureReceipt(rawReceipt);

      const effectiveVector: HorrorVector = state.activeVector || 'COGNITIVE';
      const effectiveTier: ExposureTier = state.activeTier || 'LATENT';

      // Canonical pre- and post-turn snapshots are identical for failed turn
      const preSnapshot = event.payload.preSnapshot;
      const postSnapshot = preSnapshot;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: event.payload.commandText,
        timestamp: event.payload.timestamp || Date.now(),
      };

      const statusSuffix = receipt.status != null ? ` (HTTP ${receipt.status})` : '';
      const isUpstreamHtmlResponse =
        receipt.status === 200 && receipt.contentType?.toLowerCase().includes('text/html');
      const userFacingFailureMessage = isUpstreamHtmlResponse
        ? '[RUNTIME NOTICE // DEVELOPMENT HOST RESTART]\nThe development runtime is restarting. Your state was not changed. Please retry shortly.'
        : formatTurnFailureMessage(receipt);

      const failMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: userFacingFailureMessage,
        timestamp: (event.payload.timestamp || Date.now()) + 1,
        failureReceipt: receipt,
        turnReceipt: {
          turnNumber: state.turnCount + 1,
          nodeBefore: state.currentNodeId,
          requestedTarget: null,
          accepted: false,
          reason: `FAILED: ${receipt.code}${statusSuffix} - ${receipt.message}`,
          nodeAfter: state.currentNodeId,
          activeVector: effectiveVector,
          activeTier: effectiveTier,
          tension: state.tensionLevel ?? 0,
          preSnapshot,
          postSnapshot,
        },
      };

      return {
        ...state,
        // Preserve prior successful turn checkpoint unchanged
        lastTurnCheckpoint: state.lastTurnCheckpoint,
        history: [...(state.history || []), userMsg, failMsg],
      };
    }

    case 'TURN_RETAKEN': {
      if (!state.lastTurnCheckpoint) return state;

      const restored = state.lastTurnCheckpoint.engineStateBefore;
      return {
        ...state,
        ...restored,
        restraintLedger: restored.restraintLedger
          ? JSON.parse(JSON.stringify(restored.restraintLedger))
          : undefined,
        worldObjectLedger: restored.worldObjectLedger
          ? JSON.parse(JSON.stringify(restored.worldObjectLedger))
          : undefined,
        attentionLedger: restored.attentionLedger
          ? JSON.parse(JSON.stringify(restored.attentionLedger))
          : undefined,
        routineLedger: restored.routineLedger
          ? JSON.parse(JSON.stringify(restored.routineLedger))
          : undefined,
        canonicalRevision: (state.canonicalRevision || 0) + 1,
        lastTurnCheckpoint: null,
      };
    }

    case 'USER_ACTION':
      return {
        ...state,
        history: [
          ...(state.history || []),
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: event.payload as string,
            timestamp: Date.now(),
          },
        ],
      };

    case 'SYSTEM_MESSAGE':
      return {
        ...state,
        history: [
          ...(state.history || []),
          {
            id: crypto.randomUUID(),
            role: 'system',
            content: event.payload,
            timestamp: Date.now(),
          },
        ],
      };

    case 'ADD_MESSAGE': {
      const message = {
        ...event.message,
        id: event.message.id || crypto.randomUUID(),
        timestamp: event.message.timestamp || Date.now(),
      };

      // Guard against exact message ID duplication
      if (event.message.id && (state.history || []).some((m) => m.id === event.message.id)) {
        return state;
      }

      // Check if message represents failed or diagnostic content that must be excluded from playable prompt context
      const isFailedOrSystem =
        message.role === 'system' ||
        message.role === 'user' ||
        message.validation?.accepted === false ||
        message.turnReceipt?.accepted === false ||
        (typeof message.content === 'string' &&
          (message.content.startsWith('[CRITICAL ENGINE FAILURE]') ||
            message.content.startsWith('[TURN_FAILED]') ||
            message.content.startsWith('[ SYSTEM:') ||
            message.content.startsWith('[SYSTEM:')));

      // Guard against duplicate opening narrative message with identical content
      if (
        (message.role === 'assistant' || message.role === 'narrative') &&
        !isFailedOrSystem &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0 &&
        (state.history || []).some(
          (m) =>
            (m.role === 'assistant' || m.role === 'narrative') &&
            m.content === message.content
        )
      ) {
        return state;
      }

      let updatedStoryLog = state.storyLog || [];
      if (!isFailedOrSystem) {
        let newBlocks: NarrativeBlock[] = [];
        if (Array.isArray(message.blocks) && message.blocks.length > 0) {
          newBlocks = message.blocks;
        } else if (
          (message.role === 'assistant' || message.role === 'narrative') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0
        ) {
          newBlocks = [{ type: 'prose', content: message.content.trim() }];
        }

        if (newBlocks.length > 0) {
          const existingSerialized = new Set(
            updatedStoryLog.map(
              (b) =>
                `${(b.type || 'prose').toLowerCase()}:${(b.speaker || '').trim()}:${(b.content || b.text || '').trim()}`
            )
          );
          const blocksToAdd = newBlocks.filter(
            (b) =>
              !existingSerialized.has(
                `${(b.type || 'prose').toLowerCase()}:${(b.speaker || '').trim()}:${(b.content || b.text || '').trim()}`
              )
          );
          if (blocksToAdd.length > 0) {
            updatedStoryLog = [...updatedStoryLog, ...blocksToAdd];
          }
        }
      }

      return {
        ...state,
        history: [...(state.history || []), message],
        storyLog: updatedStoryLog,
      };
    }

    case 'TURN_RESOLVED': {
      const newTags = event.payload.semanticTags;

      const isTerminal =
        newTags?.SYS?.includes('SOMATIC_TERMINAL') || newTags?.SYS?.includes('COGNITIVE_COLLAPSE');

      const newMotifLedger = { ...state.motifLedger };
      const allTags = [...(newTags?.SYS || []), ...(newTags?.SOMA || []), ...(newTags?.GEOM || [])];
      allTags.forEach((tag: string) => {
        newMotifLedger[tag] = (newMotifLedger[tag] || 0) + 1;
      });
      const suggestedTension = event.payload?.logic_state?.suggested_tension;
      if (suggestedTension) {
        const tensionTag = `TENSION_${String(suggestedTension).toUpperCase()}`;
        newMotifLedger[tensionTag] = (newMotifLedger[tensionTag] || 0) + 1;
      }

      let memoryAnchors = state.pacingLedger?.memoryAnchorsRemaining ?? 3;
      let escapeAttempts = state.pacingLedger?.failedEscapeAttempts ?? 0;
      let contradictions = state.pacingLedger?.spatialContradictions ?? 0;

      if (newTags?.SYS?.includes('MEMORY_DECAY') || newTags?.SOMA?.includes('AMNESIA')) {
        memoryAnchors = Math.max(0, memoryAnchors - 1);
      }
      if (newTags?.SYS?.includes('ESCAPE_FAILED')) {
        escapeAttempts += 1;
      }
      if (newTags?.GEOM?.includes('CONTRADICTION')) {
        contradictions += 1;
      }

      let calculatedPhase = state.phase;

      // Pure mathematical deterministic phase shift
      if (state.turnCount >= 18 || state.traumaLedger.length >= 5) {
        calculatedPhase = 'TERMINAL';
      } else if (state.turnCount >= 8 || state.traumaLedger.length >= 2) {
        calculatedPhase = 'MANIFEST';
      } else if (state.phase === 'HUB' || state.phase === 'FORGE' || state.phase === 'VOICE') {
        // preserve non-runtime phases
      } else {
        calculatedPhase = 'LATENT';
      }

      if (isTerminal) calculatedPhase = 'TERMINATED';

      const newEscalationState =
        event.payload.logic_state?.escalation_state || state.escalation_state || 'LATENT';

      const narrativeBlocks = event.payload.narrative_blocks;
      const formatBlocks = (blocks?: Record<string, unknown>[]): string => {
        if (!blocks || !Array.isArray(blocks)) return '';
        return blocks
          .map((block) => {
            const speaker = typeof block.speaker === 'string' && block.speaker ? block.speaker : undefined;
            const content = block.content !== undefined && block.content !== null ? String(block.content) : '';
            if (block.type === 'internal_monologue') {
              return `[THOUGHT // ${speaker || 'POV'}]: ${content}`;
            }
            if (block.type === 'soliloquy') {
              return `[MUTTERED // ${speaker || 'SELF'}]: ${content}`;
            }
            if (block.type === 'transmission') {
              return `[TRANSMISSION // ${speaker || 'INTERCOM'}]: ${content}`;
            }
            if (block.type === 'dialogue') {
              return `${speaker?.toUpperCase()}: ${content}`;
            }
            return content;
          })
          .join('\n\n');
      };

      const hasHiddenBlocks =
        Array.isArray(narrativeBlocks) &&
        narrativeBlocks.some((b: Record<string, unknown>) => b.visibleToModel === false);

      let newRoomsGenerated = state.roomsGenerated;
      if (event.payload.logic_state?.matrix_mutation?.increment_rooms) {
        newRoomsGenerated = (newRoomsGenerated || 0) + 1;
      }

      return {
        ...state,
        history: [
          ...(state.history || []),
          {
            id: crypto.randomUUID(),
            role: 'engine',
            content: formatBlocks(narrativeBlocks),
            blocks: narrativeBlocks,
            engine_thoughts: event.payload.engine_thoughts,
            timestamp: Date.now(),
            visibleToModel: hasHiddenBlocks ? false : true,
          },
        ],
        activeMemory: {
          ...state.activeMemory,
          systemFlags: newTags?.SYS || [],
          somaState: newTags?.SOMA || [],
          geomState: newTags?.GEOM || [],
        },
        motifLedger: newMotifLedger,
        pacingLedger: {
          failedEscapeAttempts: escapeAttempts,
          memoryAnchorsRemaining: memoryAnchors,
          spatialContradictions: contradictions,
        },
        timelineRevision: state.timelineRevision + 1,
        phase: calculatedPhase,
        escalation_state: newEscalationState,
        roomsGenerated: newRoomsGenerated,
      };
    }

    case 'SIMULATION_STARTED':
      return {
        ...state,
        phase: 'LATENT',
        currentNodeId: event.initialNodeId,
        turnCount: 0,
      };

    case 'TURN_SUBMITTED':
      // Compatibility-only: no-op, does not mutate turn state
      return state;

    case 'PHASE_CHANGED':
      return {
        ...state,
        phase: event.to,
      };

    case 'TRANSITION_ACCEPTED':
      return {
        ...state,
        currentNodeId: event.toNodeId,
      };

    case 'DECAY_UPDATED':
      return {
        ...state,
        decay: event.newDecayState,
      };

    case 'ACT_DISTILLED': {
      if (event.sessionId !== state.sessionId) {
        // Silently discard memory leak from previous session
        return state;
      }

      if (event.dispatchedAtRevision < state.lastDistilledRevision) {
        // Reject stale memory summary to prevent timeline corruption
        return state;
      }

      const messages = state.history || [];
      const preservedStart = messages.length > 0 ? [messages[0]] : [];
      const preservedEnd = messages.length > 2 ? messages.slice(-2) : messages;

      const actBreakMessage: Message = {
        id: crypto.randomUUID(),
        role: 'system_cinematic',
        content: event.summary,
        timestamp: Date.now(),
      };

      return {
        ...state,
        lastDistilledRevision: event.dispatchedAtRevision,
        traumaLedger: [...state.traumaLedger, ...event.trauma],
        history: [...preservedStart, actBreakMessage, ...preservedEnd],
      };
    }

    case 'POV_DEATH_DECLARED': {
      const records = state.deathRecords || [];
      const updatedRecords = records.some((r) => r.id === event.deathRecord.id)
        ? records
        : [...records, event.deathRecord];
      return {
        ...state,
        phase: 'TERMINATED',
        deathRecords: updatedRecords,
      };
    }

    case 'PROCESS_OBJECT_TRANSITIONS': {
      if (!state.worldObjectLedger || !event.proposals || event.proposals.length === 0) {
        return state;
      }
      let currentObjects: WorldObjectLedger = JSON.parse(JSON.stringify(state.worldObjectLedger));
      let currentRestraint: RestraintLedger = state.restraintLedger
        ? JSON.parse(JSON.stringify(state.restraintLedger))
        : { bindings: {}, locks: {} };

      const povCharId =
        (state as unknown as { selectedCharacterId?: string }).selectedCharacterId ||
        (state as unknown as { gameState?: { player_character_id?: string | null } }).gameState?.player_character_id ||
        (state.cast || []).find((c: { isUserCharacter?: boolean; id?: string }) => c.isUserCharacter)?.id ||
        null;

      const charNode =
        state.castPlacement?.[event.characterId] ||
        (povCharId === event.characterId ? state.currentNodeId : null) ||
        state.currentNodeId ||
        'node-1';

      const topologyConnections: Array<{
        fromNodeId: string;
        toNodeId: string;
        status: 'OPEN' | 'LOCKED' | 'BLOCKED';
      }> = [];
      for (const node of state.spatialGraph || []) {
        if (node.exits && node.exits.length > 0) {
          for (const edge of node.exits) {
            topologyConnections.push({
              fromNodeId: node.id,
              toNodeId: edge.targetNodeId,
              status: edge.isOpen ? 'OPEN' : 'LOCKED',
            });
          }
        } else if (node.connectedNodes) {
          for (const targetId of node.connectedNodes) {
            topologyConnections.push({
              fromNodeId: node.id,
              toNodeId: targetId,
              status: 'OPEN',
            });
          }
        }
      }

      for (const proposal of event.proposals) {
        const ctx: AttemptFilterContext = {
          restraint: currentRestraint,
          objects: currentObjects,
          attention: state.attentionLedger || {},
          routines: state.routineLedger || {},
          capabilities: {},
          seats: {
            captorCharacterIds: (state.cast || [])
              .filter((c: { disposition?: string; isEntity?: boolean }) => c.disposition === 'HOSTILE' || Boolean(c.isEntity))
              .map((c: { id: string }) => c.id),
            preyCharacterIds: [event.characterId],
          },
          fictionalTime: (state.turnCount || 0) * 60,
          characterNodes: {
            ...(state.castPlacement || {}),
            [event.characterId]: charNode,
          },
          topologyConnections,
        };

        const decision = evaluateObjectTransition(event.characterId, proposal, ctx);
        if (decision.accepted) {
          currentObjects = applyObjectTransition(currentObjects, event.characterId, proposal, ctx);
          if (proposal.transition === 'UNLOCK') {
            currentRestraint = applyLockTransition(currentRestraint, decision);
          }
        }
      }

      return {
        ...state,
        worldObjectLedger: currentObjects,
        restraintLedger: currentRestraint,
      };
    }

    case 'PROCESS_ATTENTION_TRANSITIONS': {
      if (!state.attentionLedger || !event.proposals || event.proposals.length === 0) {
        return state;
      }
      let currentAttention: AttentionLedger = JSON.parse(JSON.stringify(state.attentionLedger));

      const povCharId =
        (state as unknown as { selectedCharacterId?: string }).selectedCharacterId ||
        (state as unknown as { gameState?: { player_character_id?: string | null } }).gameState?.player_character_id ||
        (state.cast || []).find((c: { isUserCharacter?: boolean; id?: string }) => c.isUserCharacter)?.id ||
        null;

      const topologyConnections: Array<{
        fromNodeId: string;
        toNodeId: string;
        status: 'OPEN' | 'LOCKED' | 'BLOCKED';
      }> = [];
      for (const node of state.spatialGraph || []) {
        if (node.exits && node.exits.length > 0) {
          for (const edge of node.exits) {
            topologyConnections.push({
              fromNodeId: node.id,
              toNodeId: edge.targetNodeId,
              status: edge.isOpen ? 'OPEN' : 'LOCKED',
            });
          }
        } else if (node.connectedNodes) {
          for (const targetId of node.connectedNodes) {
            topologyConnections.push({
              fromNodeId: node.id,
              toNodeId: targetId,
              status: 'OPEN',
            });
          }
        }
      }

      for (const proposal of event.proposals) {
        const ctx: AttemptFilterContext = {
          restraint: state.restraintLedger || { bindings: {}, locks: {} },
          objects: state.worldObjectLedger || {},
          attention: currentAttention,
          routines: state.routineLedger || {},
          capabilities: {},
          seats: {
            captorCharacterIds: (state.cast || [])
              .filter((c: { disposition?: string; isEntity?: boolean }) => c.disposition === 'HOSTILE' || Boolean(c.isEntity))
              .map((c: { id: string }) => c.id),
            preyCharacterIds: povCharId ? [povCharId] : [],
          },
          fictionalTime: (state.turnCount || 0) * 60,
          characterNodes: {
            ...(state.castPlacement || {}),
            ...(povCharId ? { [povCharId]: state.currentNodeId || 'node-1' } : {}),
          },
          topologyConnections,
        };

        const decision = evaluateAttentionTransition(proposal, ctx);
        if (decision.accepted) {
          currentAttention = applyAttentionTransition(currentAttention, proposal, ctx);
        }
      }

      return {
        ...state,
        attentionLedger: currentAttention,
      };
    }

    // Default catch for unhandled events
    default:
      return state;
  }
}
