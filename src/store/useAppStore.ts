/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import {
  AppPhase,
  SpatialNode,
  TelemetryState,
  CampaignManifest,
  CarryoverPacket,
  TemporalShiftReceipt,
  NarrativeVelocity,
  UITranscriptMessage,
  TurnSnapshot,
  PerspectiveShiftReceipt,
  Message,
  PlayerRole,
  NarrativeBlock,
  TopologyEdge,
  HorrorVector,
  ExposureTier,
  ParticipationContext,
  DurableSessionRevision,
  DurableSessionRevisionSchema,
} from '../types';
import { EngineEvent, CommittedTurnPayload, FailedTurnPayload } from '../core/engine/events';
import { engineReducer, initialEngineState, EngineState } from '../core/engine/reducer';
import { compileRuntimeTopology } from '../lib/compileRuntimeTopology';
import { normalizeBlueprint } from '../lib/normalizeBlueprint';
import { isHorrorVector, isExposureTier } from '../core/engine/snapshot';
import { idbStorage } from '../lib/idbStorage';
import { useEngineStore } from '../core/store';
import { normalizeTurnFailureReceipt } from '../lib/turnResponseReader';
import { applySeedToState } from '../lib/seedApplication';

export const AppPersistedSchema = z.object({
  sessionId: z.string().optional().default(''),
  blueprintId: z.string().optional().default(''),
  durableSessionRevision: DurableSessionRevisionSchema.nullable().optional().default(null),
  knowledgeByCharacter: z.record(z.string(), z.array(z.any())).optional().default({}),
  bondEdges: z.array(z.any()).optional().default([]),
  userCircumstance: z.string().optional(),
  userInclination: z.string().optional(),
  characterWants: z.record(z.string(), z.any()).optional().default({}),
  seedReceipts: z.array(z.any()).optional().default([]),
  participationContext: z.any().nullable().optional().default(null),
  phase: z.string().optional().default('HUB'),
  currentPhase: z.string().optional().default('INIT'),
  escalation_state: z.string().optional().default('LATENT'),
  currentNodeId: z.string().nullable().optional().default(null),
  spatialGraph: z.array(z.any()).optional().default([]),
  activeVector: z
    .enum(['SOMATIC', 'COGNITIVE', 'COSMIC', 'SOCIO_MORAL'])
    .optional()
    .default('COGNITIVE'),
  activeTier: z
    .enum(['GATEWAY', 'LATENT', 'MANIFEST', 'TERMINAL'])
    .optional()
    .default('LATENT'),
  decay: z
    .object({
      stage: z.string().optional().default('STABLE'),
      coherence: z.number().optional().default(1.0),
    })
    .passthrough()
    .optional()
    .default({ stage: 'STABLE', coherence: 1.0 }),
  decayMetrics: z
    .object({
      currentStage: z.string().optional().default('STABLE'),
      coherenceRating: z.number().optional().default(1.0),
      divergenceMode: z.string().optional().default('NONE'),
    })
    .passthrough()
    .optional()
    .default({ currentStage: 'STABLE', coherenceRating: 1.0, divergenceMode: 'NONE' }),
  isShattered: z.boolean().optional().default(false),
  tensionLevel: z.number().optional().default(0),
  turnCount: z.number().optional().default(0),
  canonicalRevision: z.number().optional().default(0),
  roomsGenerated: z.number().optional().default(0),
  maxRooms: z.number().optional(),
  aesthetic: z.string().optional(),
  activeEntities: z.array(z.any()).optional(),
  traumaLedger: z.array(z.string()).optional().default([]),
  activeMemory: z
    .object({
      systemFlags: z.array(z.string()).optional().default([]),
      somaState: z.array(z.string()).optional().default([]),
      geomState: z.array(z.string()).optional().default([]),
    })
    .passthrough()
    .optional()
    .default({ systemFlags: [], somaState: [], geomState: [] }),
  motifLedger: z.record(z.string(), z.number()).optional().default({}),
  pacingLedger: z
    .object({
      failedEscapeAttempts: z.number().optional().default(0),
      memoryAnchorsRemaining: z.number().optional().default(3),
      spatialContradictions: z.number().optional().default(0),
    })
    .passthrough()
    .optional()
    .default({ failedEscapeAttempts: 0, memoryAnchorsRemaining: 3, spatialContradictions: 0 }),
  timelineRevision: z.number().optional().default(0),
  lastDistilledRevision: z.number().optional().default(-1),
  reconciliationRevision: z.number().optional().default(0),
  history: z.array(z.any()).optional().default([]),
  storyLog: z.array(z.any()).optional().default([]),
  uiTranscript: z.array(z.any()).optional().default([]),
  enginePayload: z.array(z.any()).optional().default([]),
  turnSnapshot: z.any().nullable().optional().default(null),
  lastTurnCheckpoint: z
    .object({
      version: z.literal(1),
      commandText: z.string(),
      engineStateBefore: z.any(),
      engineGameStateBefore: z.any().nullable().optional(),
      durableSessionRevisionBefore: DurableSessionRevisionSchema.nullable().optional(),
    })
    .nullable()
    .optional()
    .default(null),
  telemetry: z.any().nullable().optional().default(null),
  activeCampaign: z.any().nullable().optional().default(null),
  currentActId: z.string().nullable().optional().default(null),
  suspendedActs: z.record(z.string(), z.any()).optional().default({}),
  narrativeVelocity: z.string().optional().default('slow_burn'),
  nodeState: z.record(z.string(), z.any()).optional(),
});

export type AppPersistedState = z.infer<typeof AppPersistedSchema>;

export interface InitializeSessionParams {
  blueprint: unknown;
  sessionId?: string;
  participationContext?: ParticipationContext | null;
  spatialGraph?: SpatialNode[];
  /** Canonical entry resolved for the selected Engine character. */
  entryNodeId?: string;
}

export interface AppStore extends EngineState {
  durableSessionRevision: DurableSessionRevision | null;
  isTransitioning: boolean;
  activeCampaign: CampaignManifest | null;
  currentActId: string | null;
  suspendedActs: Record<string, any>;
  narrativeVelocity: NarrativeVelocity;

  // --- PHASE V: MEMORY SCHISM ---
  reconciliationRevision: number;
  uiTranscript: UITranscriptMessage[];
  enginePayload: (Message | PerspectiveShiftReceipt)[];
  turnSnapshot: TurnSnapshot | null;
  shiftPerspective: (newRole: PlayerRole) => void;
  setTurnSnapshot: (snapshot: TurnSnapshot | null) => void;

  editTranscriptMessage: (id: string, newContent: string) => void;
  forceAcceptCosmetic: (id: string) => void;
  requestActTransition: (targetActId: string) => void;
  commitActTransition: (newBlueprintId: string, packet: CarryoverPacket) => void;
  executeTemporalShift: (receipt: TemporalShiftReceipt) => void;
  loadCampaignManifest: (manifest: CampaignManifest) => void;

  initializeSession: (params: InitializeSessionParams) => void;

  setPhase: (phase: AppPhase | string) => void;
  telemetry: TelemetryState | null;
  setTelemetry: (telemetry: TelemetryState) => void;
  spatialGraph: SpatialNode[];
  isShattered: boolean;
  decayMetrics: {
    currentStage: string;
    coherenceRating: number;
    divergenceMode: string;
  };
  updateDecayMetrics: (skepticism: number) => void;
  compileTopology: (forgeTopology: any, startNodeId: string) => void;
  triggerShatter: () => void;
  setCurrentNodeId: (nodeId: string) => void;
  dispatch: (event: EngineEvent) => void;
  commitTurnResult: (payload: CommittedTurnPayload) => void;
  failTurnResult: (payload: FailedTurnPayload) => void;
  retakeLastTurn: () => boolean;
  resetSession: () => void;

  isGenerating: boolean;
  currentPhase: string;
  tensionLevel: number;
  storyLog: NarrativeBlock[];
  setGenerating: (status: boolean) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...initialEngineState,
      durableSessionRevision: null,
      isTransitioning: false,
      activeCampaign: null,
      currentActId: null,
      suspendedActs: {},
      narrativeVelocity: 'slow_burn' as NarrativeVelocity,

      reconciliationRevision: 0,
      uiTranscript: [],
      enginePayload: [],
      turnSnapshot: null,
      shiftPerspective: () => {},
      setTurnSnapshot: (snapshot: TurnSnapshot | null) => set({ turnSnapshot: snapshot }),

      editTranscriptMessage: () => {},
      forceAcceptCosmetic: () => {},
      requestActTransition: () => {},
      commitActTransition: () => {},
      executeTemporalShift: () => {},
      loadCampaignManifest: (manifest: CampaignManifest) => set({ activeCampaign: manifest }),

      initializeSession: ({ blueprint, sessionId, participationContext, spatialGraph, entryNodeId }) => {
        const normalized = normalizeBlueprint(blueprint);
        const compiled = compileRuntimeTopology({
          topology: normalized.topology,
          fallbackSetting: normalized.setting,
        });

        const initialVector: HorrorVector = isHorrorVector(normalized.startingVector)
          ? normalized.startingVector
          : 'COGNITIVE';
        const initialTier: ExposureTier = isExposureTier(normalized.startingTier)
          ? normalized.startingTier
          : 'LATENT';
        const effectiveGraph =
          spatialGraph && spatialGraph.length > 0 ? spatialGraph : compiled.spatialGraph;
        const requestedEntryNodeId = entryNodeId?.trim();
        if (
          requestedEntryNodeId &&
          !effectiveGraph.some((node) => node.id === requestedEntryNodeId)
        ) {
          throw new Error(
            `Engine entry node "${requestedEntryNodeId}" is not present in the compiled runtime topology.`
          );
        }
        const startNodeId =
          requestedEntryNodeId ||
          (spatialGraph && spatialGraph[0]?.id ? spatialGraph[0].id : compiled.startNodeId || 'ORIGIN');
        const newSessionId = sessionId || crypto.randomUUID();
        const initialRevision = 1;

        const initialDurableRevision: DurableSessionRevision = {
          sessionId: newSessionId,
          blueprintId: normalized.id || 'unknown',
          revision: initialRevision,
          turnCount: 0,
          committedAt: Date.now(),
        };

        const baseSessionState: EngineState = {
          ...initialEngineState,
          sessionId: newSessionId,
          blueprintId: normalized.id || 'unknown',
          canonicalRevision: initialRevision,
          participationContext: participationContext || null,
          phase: 'LATENT',
          currentPhase: 'LATENT',
          escalation_state: 'LATENT',
          currentNodeId: startNodeId,
          activeVector: initialVector,
          activeTier: initialTier,
          decay: { stage: 'STABLE', coherence: 1.0 },
          turnCount: 0,
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
          storyLog: [],
          spatialGraph: effectiveGraph,
          cast: (normalized.cast || []) as any,
          fearContract: normalized.fearContract,
          deathContract: normalized.deathContract,
          lastTurnCheckpoint: null,
        };

        const seededState = applySeedToState(baseSessionState, normalized);
        if (requestedEntryNodeId) {
          seededState.currentNodeId = requestedEntryNodeId;
        }

        set({
          ...seededState,
          durableSessionRevision: initialDurableRevision,
          decayMetrics: {
            currentStage: 'STABLE',
            coherenceRating: 1.0,
            divergenceMode: 'NONE',
          },
          tensionLevel: 0,
          isTransitioning: false,
          isShattered: false,
          uiTranscript: [],
          enginePayload: [],
          turnSnapshot: null,
          isGenerating: false,
        });
      },

      setPhase: (phase: AppPhase | string) => set({ phase: phase as any }),
      telemetry: null,
      setTelemetry: (telemetry: TelemetryState) => set({ telemetry }),
      spatialGraph: [],
      isShattered: false,
      decayMetrics: {
        currentStage: 'STABLE',
        coherenceRating: 1.0,
        divergenceMode: 'NONE',
      },
      updateDecayMetrics: () => {},
      compileTopology: (
        forgeTopology?: { nodes?: string[]; connections?: TopologyEdge[] },
        startNodeId?: string
      ) =>
        set((state) => {
          const compiled = compileRuntimeTopology({ topology: forgeTopology });
          return {
            spatialGraph: compiled.spatialGraph,
            currentNodeId: startNodeId || compiled.startNodeId || state.currentNodeId,
          };
        }),
      triggerShatter: () => set({ isShattered: true }),
      setCurrentNodeId: (nodeId: string) => set({ currentNodeId: nodeId }),
      dispatch: (event: EngineEvent) => set((state) => engineReducer(state, event)),
      commitTurnResult: (payload: CommittedTurnPayload) => {
        const currentApp = get();
        const nextTurnCount = (currentApp.turnCount || 0) + 1;
        const currentRev = currentApp.durableSessionRevision?.revision ?? (currentApp.canonicalRevision || 0);
        const nextRev = currentRev + 1;
        const currentSessionId = currentApp.sessionId || '';
        const currentBlueprintId = currentApp.blueprintId || '';

        const nextDurableRevision: DurableSessionRevision = {
          sessionId: currentSessionId,
          blueprintId: currentBlueprintId,
          turnCount: nextTurnCount,
          revision: nextRev,
          committedAt: Date.now(),
        };

        const engine = useEngineStore.getState();
        if (engine.activeSessionId && engine.activeSessionId === currentSessionId) {
          useEngineStore.setState({
            durableSessionRevision: nextDurableRevision,
            lastTurnCheckpoint: {
              revision: currentRev,
              turnCount: currentApp.turnCount || 0,
              gameStateBefore: engine.gameState,
            },
          });
        }

        set((state) => {
          const reduced = engineReducer(state, { type: 'TURN_COMMITTED', payload });
          return {
            ...reduced,
            canonicalRevision: nextRev,
            durableSessionRevision: nextDurableRevision,
            lastTurnCheckpoint: reduced.lastTurnCheckpoint
              ? {
                  ...reduced.lastTurnCheckpoint,
                  durableSessionRevisionBefore: currentApp.durableSessionRevision,
                }
              : null,
          };
        });
      },
      failTurnResult: (payload: FailedTurnPayload) =>
        set((state) => {
          const normalizedReceipt = normalizeTurnFailureReceipt(
            payload.failureReceipt || {
              code: payload.errorCategory,
              message: payload.errorMessage,
              status: payload.statusCode,
              contentType: payload.contentType,
            }
          );
          return engineReducer(state, {
            type: 'TURN_FAILED',
            payload: {
              ...payload,
              failureReceipt: normalizedReceipt,
              errorCategory: normalizedReceipt.code,
              errorMessage: normalizedReceipt.message,
              statusCode: normalizedReceipt.status,
              contentType: normalizedReceipt.contentType,
            },
          });
        }),
      retakeLastTurn: () => {
        const currentEngineState = get();
        const checkpoint = currentEngineState.lastTurnCheckpoint;
        if (!checkpoint) return false;

        const cpBefore = checkpoint.engineStateBefore;
        const cpSessionId =
          typeof cpBefore?.sessionId === 'string' ? cpBefore.sessionId.trim() : '';
        const cpBlueprintId =
          typeof cpBefore?.blueprintId === 'string' ? cpBefore.blueprintId.trim() : '';
        const currentSessionId =
          typeof currentEngineState.sessionId === 'string'
            ? currentEngineState.sessionId.trim()
            : '';
        const currentBlueprintId =
          typeof currentEngineState.blueprintId === 'string'
            ? currentEngineState.blueprintId.trim()
            : '';

        // Validate checkpoint matches current session and blueprint before restoring
        const isCompatible =
          checkpoint.version === 1 &&
          cpBefore &&
          typeof cpBefore === 'object' &&
          cpSessionId.length > 0 &&
          cpSessionId === currentSessionId &&
          cpBlueprintId.length > 0 &&
          cpBlueprintId === currentBlueprintId;

        if (!isCompatible) {
          // Clear invalid cross-session checkpoint deterministically
          set({ lastTurnCheckpoint: null });
          return false;
        }

        const restoredRev = (get().canonicalRevision || 0) + 1;
        const restoredTurn = (checkpoint.engineStateBefore?.turnCount as number) ?? 0;
        const restoredDurableRevision: DurableSessionRevision = {
          sessionId: currentSessionId,
          blueprintId: currentBlueprintId,
          revision: restoredRev,
          turnCount: restoredTurn,
          committedAt: Date.now(),
        };

        const previousGameState = checkpoint.engineGameStateBefore;
        if (previousGameState !== undefined) {
          useEngineStore.setState({
            gameState: previousGameState,
            durableSessionRevision: restoredDurableRevision,
            lastTurnCheckpoint: null,
          });
        }

        get().dispatch({ type: 'TURN_RETAKEN' });
        set({ durableSessionRevision: restoredDurableRevision });
        return true;
      },
      resetSession: () => {
        useEngineStore.getState().resetEngine();
        set({
          ...initialEngineState,
          sessionId: '',
          blueprintId: '',
          canonicalRevision: (get().canonicalRevision || 0) + 1,
          durableSessionRevision: null,
          participationContext: null,
          phase: 'HUB',
          escalation_state: 'LATENT',
          currentNodeId: 'ORIGIN',
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT',
          decay: { stage: 'STABLE', coherence: 1.0 },
          turnCount: 0,
          roomsGenerated: 0,
          traumaLedger: [],
          activeMemory: { systemFlags: [], somaState: [], geomState: [] },
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
          storyLog: [],
          isTransitioning: false,
          activeCampaign: null,
          currentActId: null,
          suspendedActs: {},
          narrativeVelocity: 'slow_burn' as NarrativeVelocity,
          uiTranscript: [],
          enginePayload: [],
          turnSnapshot: null,
          telemetry: null,
          spatialGraph: [],
          isShattered: false,
          decayMetrics: {
            currentStage: 'STABLE',
            coherenceRating: 1.0,
            divergenceMode: 'NONE',
          },
          isGenerating: false,
          currentPhase: 'INIT',
          tensionLevel: 0,
          lastTurnCheckpoint: null,
        });
      },

      isGenerating: false,
      currentPhase: 'INIT',
      tensionLevel: 0,
      storyLog: [],

      setGenerating: (status: boolean) => set({ isGenerating: status }),
    }),
    {
      name: 'the-runtime-session-memory',
      storage: createJSONStorage(() => idbStorage),
      version: 1,
      migrate: (persistedState: any) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return {} as AppStore;
        }
        return persistedState as AppStore;
      },
      merge: (persistedState: unknown, currentState: AppStore): AppStore => {
        if (!persistedState || typeof persistedState !== 'object') {
          return currentState;
        }
        const result = AppPersistedSchema.safeParse(persistedState);
        if (!result.success) {
          console.warn(
            '[AppStore] Persisted state validation failed, resetting to initial state:',
            result.error
          );
          return currentState;
        }
        const data = result.data;
        let validCheckpoint = data.lastTurnCheckpoint ?? null;
        if (validCheckpoint) {
          const cpBefore = validCheckpoint.engineStateBefore;
          const isCpValid =
            validCheckpoint.version === 1 &&
            typeof validCheckpoint.commandText === 'string' &&
            cpBefore &&
            typeof cpBefore === 'object' &&
            Boolean(cpBefore.sessionId) &&
            cpBefore.sessionId === data.sessionId &&
            Boolean(cpBefore.blueprintId) &&
            cpBefore.blueprintId === data.blueprintId;
          if (!isCpValid) {
            validCheckpoint = null;
          }
        }
        return {
          ...currentState,
          ...data,
          lastTurnCheckpoint: validCheckpoint,
        } as AppStore;
      },
      partialize: (state) => ({
        sessionId: state.sessionId,
        blueprintId: state.blueprintId,
        durableSessionRevision: state.durableSessionRevision,
        participationContext: state.participationContext,
        phase: state.phase,
        currentPhase: state.currentPhase,
        escalation_state: state.escalation_state,
        currentNodeId: state.currentNodeId,
        spatialGraph: state.spatialGraph,
        activeVector: state.activeVector,
        activeTier: state.activeTier,
        decay: state.decay,
        decayMetrics: state.decayMetrics,
        isShattered: state.isShattered,
        tensionLevel: state.tensionLevel,
        turnCount: state.turnCount,
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
        uiTranscript: state.uiTranscript,
        enginePayload: state.enginePayload,
        turnSnapshot: state.turnSnapshot,
        lastTurnCheckpoint: state.lastTurnCheckpoint,
        telemetry: state.telemetry,
        activeCampaign: state.activeCampaign,
        currentActId: state.currentActId,
        suspendedActs: state.suspendedActs,
        narrativeVelocity: state.narrativeVelocity,
        nodeState: state.nodeState,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) {
          return;
        }
        // Validate checkpoint on rehydration: clear unsafe or mismatched checkpoint
        if (state.lastTurnCheckpoint) {
          const cp = state.lastTurnCheckpoint;
          const isValidCheckpoint =
            cp.version === 1 &&
            typeof cp.commandText === 'string' &&
            cp.engineStateBefore &&
            typeof cp.engineStateBefore === 'object' &&
            Boolean(cp.engineStateBefore.sessionId) &&
            cp.engineStateBefore.sessionId === state.sessionId &&
            Boolean(cp.engineStateBefore.blueprintId) &&
            cp.engineStateBefore.blueprintId === state.blueprintId;

          if (!isValidCheckpoint) {
            state.lastTurnCheckpoint = null;
          }
        }
      },
    }
  )
);
