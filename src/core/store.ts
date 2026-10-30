import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import {
  Blueprint,
  BlueprintSchema,
  LogicState,
  Message,
  PlayerRole,
  ParticipationContext,
  SpatialNode,
  DurableSessionRevision,
  DurableSessionRevisionSchema,
} from '../types';
import { idbStorage } from '../lib/idbStorage';
import { distillContext } from '../services/geminiService';
import { useAppStore } from '../store/useAppStore';
import { normalizeBlueprint } from '../lib/normalizeBlueprint';
import { resolvePerspectiveBinding } from '../lib/playerCharacterBinding';
import { resolveCharacterEntryPlacement } from '../lib/resolveCharacterEntryPlacement';
import { createInitialFictionalTimeLedger } from '../lib/fictionalTime';
import { createInitialValueStateLedger } from '../lib/valueState';
import { createInitialCharacterPursuitLedger } from '../lib/characterPursuits';
import { createInitialCharacterDevelopmentLedger } from '../lib/characterDevelopment';
import { initializeDramaturgyRuntimeState } from '../lib/composureDerivation';
import {
  FictionalTimeLedgerSchema,
  PursuitScheduleLedgerSchema,
  CastActivityEventSchema,
  SituatedPressureThreadSchema,
  ValueStateLedgerSchema,
  CharacterPursuitLedgerSchema,
  CharacterDevelopmentLedgerSchema,
} from '../types/horrorGrammar';
import {
  CampaignCarryoverWhitelist,
  CampaignCarryoverWhitelistSchema,
  createCampaignCarryoverWhitelist,
} from '../types/campaignContinuity';
import {
  resolveCampaignTransition,
  identifyLivingSurvivors,
  CampaignTransitionResult,
} from '../lib/campaignContinuity';

export { resolvePerspectiveBinding } from '../lib/playerCharacterBinding';

export const EnginePersistedSchema = z.object({
  activeSessionId: z.string().nullable().optional().default(null),
  activeBlueprint: BlueprintSchema.nullable().optional().default(null),
  durableSessionRevision: DurableSessionRevisionSchema.nullable().optional().default(null),
  lastTurnCheckpoint: z
    .object({
      revision: z.number(),
      turnCount: z.number(),
      gameStateBefore: z.any().nullable().optional(),
    })
    .nullable()
    .optional()
    .default(null),
  participationContext: z
    .object({
      role: z.string().optional(),
      perspectiveMode: z.string().optional(),
      characterId: z.string().nullable().optional(),
      selectedCharacterName: z.string().optional(),
      provenance: z.any().optional(),
    })
    .passthrough()
    .nullable()
    .optional()
    .default(null),
  gameState: z
    .object({
      current_location: z.string().optional(),
      player_character_id: z.string().nullable().optional(),
      player_role: z.string().optional(),
      perspective_mode: z.string().optional(),
      current_tension_level: z.string().optional(),
      psychological_status: z.string().optional(),
      player_injuries: z.array(z.string()).optional(),
      inventory: z.array(z.string()).optional(),
      lore_and_memory: z
        .object({
          established_facts: z.array(z.string()).optional().default([]),
          permanent_consequences: z.array(z.string()).optional().default([]),
        })
        .optional(),
      npc_fixations: z.array(z.string()).optional(),
      cast_ledger: z.array(z.any()).optional(),
      fictional_time_ledger: FictionalTimeLedgerSchema.optional(),
      pursuit_schedule_ledger: PursuitScheduleLedgerSchema.optional(),
      activity_events: z.array(CastActivityEventSchema).optional(),
      pressure_threads: z.array(SituatedPressureThreadSchema).optional(),
      value_state_ledger: ValueStateLedgerSchema.optional(),
      character_pursuit_ledger: CharacterPursuitLedgerSchema.optional(),
      character_development_ledger: CharacterDevelopmentLedgerSchema.optional(),
    })
    .passthrough()
    .nullable()
    .optional()
    .default(null),
  engineMessages: z.array(z.any()).optional().default([]),
  engineTextBuffer: z.array(z.any()).optional().default([]),
  maxBufferTurns: z.number().optional().default(12),
  engineWorldStateSummary: z
    .string()
    .optional()
    .default(''),
  telemetry: z.any().nullable().optional().default(null),
});

export type EnginePersistedState = z.infer<typeof EnginePersistedSchema>;

// Add these model definitions to your store fields in src/core/store.ts
export interface TelemetryMetrics {
  tension: string;
  pacing: string;
  castLedger: Array<{
    character_name: string;
    current_location: string;
    psychological_status: string;
  }>;
  engineLogic: string;
}

export interface SetBlueprintOptions {
  sessionId?: string;
  spatialGraph?: SpatialNode[];
  entryNodeId?: string;
}

export interface EngineCheckpoint {
  revision: number;
  turnCount: number;
  gameStateBefore: LogicState | null;
}

export interface EngineState {
  activeSessionId: string | null;
  activeBlueprint: Blueprint | null;
  durableSessionRevision: DurableSessionRevision | null;
  lastTurnCheckpoint: EngineCheckpoint | null;
  participationContext: ParticipationContext | null;
  gameState: LogicState | null;
  engineMessages: Message[]; // Used for UI display
  engineTextBuffer: Message[]; // The sliding window specifically for the Engine
  maxBufferTurns: number;
  engineWorldStateSummary: string;
  telemetry: TelemetryMetrics | null;
  updateTelemetry: (metrics: TelemetryMetrics) => void;
  setBlueprint: (
    blueprint: unknown,
    role: PlayerRole,
    participationContext?: ParticipationContext | null,
    selectedCharacterId?: string,
    options?: SetBlueprintOptions
  ) => void;
  transitionCampaignScenario: (
    targetBlueprint: unknown,
    whitelist?: CampaignCarryoverWhitelist | string[],
    options?: { sessionId?: string; entryNodeId?: string }
  ) => CampaignTransitionResult;

  clearBlueprint: () => void;
  updateGameState: (newState: LogicState) => void;
  setGameState: (newState: LogicState | null) => void;
  patchGameState: (patch: Partial<LogicState>) => void;
  addEngineMessage: (message: Message) => void;
  setEngineMessages: (messages: Message[]) => void;
  ingestTurn: (turn: Message) => void;
  pruneContext: () => void;
  updateWorldStateSummary: (newSummary: string) => void;
  addEngineTurn: (turn: Message) => void;
  resetEngine: () => void;
}

export const useEngineStore = create<EngineState>()(
  persist(
    (set, get) => ({
      activeSessionId: null,
      activeBlueprint: null,
      durableSessionRevision: null,
      lastTurnCheckpoint: null,
      participationContext: null,
      gameState: null,
      engineMessages: [],
      engineTextBuffer: [],
      maxBufferTurns: 12,
      engineWorldStateSummary: '',
      telemetry: null,
      updateTelemetry: (metrics) => set({ telemetry: metrics }),
      setBlueprint: (blueprint, role, participationContext = null, selectedCharacterId, options) => {
        // Preserve identity only for a fully canonical payload. BlueprintSchema has defaults,
        // so safeParse success alone is insufficient: a partial legacy object can parse while
        // still requiring normalization.
        const parsed = BlueprintSchema.safeParse(blueprint);
        const isAlreadyCanonical =
          parsed.success && JSON.stringify(blueprint) === JSON.stringify(parsed.data);
        const normalizedBlueprint = isAlreadyCanonical
          ? (blueprint as Blueprint)
          : normalizeBlueprint(blueprint);

        // Validate and resolve perspective binding BEFORE initializing session or writing state
        const binding = resolvePerspectiveBinding(
          normalizedBlueprint,
          role,
          selectedCharacterId
        );
        const resolvedEntryNodeId = resolveCharacterEntryPlacement({
          blueprint: normalizedBlueprint,
          characterId: binding.characterId,
        });
        const authoredNodeIds = new Set([
          ...(normalizedBlueprint.topology?.nodes || []),
          ...(normalizedBlueprint.topology?.nodeDefinitions || []).map((node) => node.id),
        ]);
        // Preserve legacy setting-derived fallback behavior when no authored
        // topology exists. Character-relative entries are passed only when the
        // Engine can prove they belong to the compiled authored graph.
        const defaultEntryNodeId = authoredNodeIds.has(resolvedEntryNodeId)
          ? resolvedEntryNodeId
          : undefined;
        const finalEntryNodeId = options?.entryNodeId ?? defaultEntryNodeId;

        // Trim and resolve shared session ID exactly once before either store is written
        const rawSessionId = options?.sessionId;
        const trimmedSessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
        const sessionId = trimmedSessionId.length > 0 ? trimmedSessionId : crypto.randomUUID();

        // Invoke the canonical AppStore session initialization action with the shared sessionId exactly once
        useAppStore.getState().initializeSession({
          blueprint: normalizedBlueprint,
          participationContext,
          sessionId,
          entryNodeId: finalEntryNodeId,
          ...(options?.spatialGraph ? { spatialGraph: options.spatialGraph } : {}),
        });

        const initialDurableRevision: DurableSessionRevision = {
          sessionId,
          blueprintId: normalizedBlueprint.id || 'unknown',
          revision: 1,
          turnCount: 0,
          committedAt: Date.now(),
        };

        set({
          activeSessionId: sessionId,
          activeBlueprint: normalizedBlueprint,
          durableSessionRevision: initialDurableRevision,
          lastTurnCheckpoint: null,
          participationContext: participationContext || null,
          engineMessages: [],
          engineTextBuffer: [],
          engineWorldStateSummary: '',
          gameState: {
            current_location: normalizedBlueprint.setting?.location || 'Unknown',
            player_injuries: [],
            inventory: [],
            psychological_status: 'Stable',
            player_role: binding.playerRole,
            player_character_id: binding.characterId,
            perspective_mode: binding.perspectiveMode,
            current_tension_level: 'buildup',
            lore_and_memory: {
              established_facts: [],
              permanent_consequences: [],
            },
            npc_fixations: [],
            fictional_time_ledger: createInitialFictionalTimeLedger(),
            pursuit_schedule_ledger: {},
            activity_events: [],
            pressure_threads: [],
            value_state_ledger: createInitialValueStateLedger(normalizedBlueprint),
            character_pursuit_ledger: createInitialCharacterPursuitLedger(normalizedBlueprint),
            character_development_ledger: createInitialCharacterDevelopmentLedger(),
            dramaturgy_state: initializeDramaturgyRuntimeState(normalizedBlueprint),
          },
        });
      },
      transitionCampaignScenario: (targetBlueprint, whitelist, options) => {
        const engineState = get();
        const appStore = useAppStore.getState();

        const rawSessionId = options?.sessionId;
        const trimmedSessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
        const sessionId =
          trimmedSessionId.length > 0
            ? trimmedSessionId
            : engineState.activeSessionId || appStore.sessionId || crypto.randomUUID();

        const parsed = BlueprintSchema.safeParse(targetBlueprint);
        const isAlreadyCanonical =
          parsed.success && JSON.stringify(targetBlueprint) === JSON.stringify(parsed.data);
        const normalizedBlueprint = isAlreadyCanonical
          ? (targetBlueprint as Blueprint)
          : normalizeBlueprint(targetBlueprint);

        const restEngineState = { ...engineState, lastTurnCheckpoint: null };
        const appStoreRecord = appStore as unknown as Record<string, unknown>;
        const combinedSourceState = {
          ...appStore,
          ...restEngineState,
          lastTurnCheckpoint: null,
          blueprintId:
            engineState.activeBlueprint?.id || appStore.blueprintId || 'source-scenario',
          blueprintTitle:
            engineState.activeBlueprint?.title ||
            engineState.activeBlueprint?.identity?.title ||
            appStoreRecord.blueprintTitle,
          sessionId,
          gameState: engineState.gameState || appStoreRecord.gameState,
          player_character_id:
            engineState.gameState?.player_character_id ||
            appStoreRecord.player_character_id,
          player_role:
            engineState.gameState?.player_role ||
            appStoreRecord.player_role,
          perspective_mode:
            engineState.gameState?.perspective_mode ||
            appStoreRecord.perspective_mode,
          value_state_ledger:
            engineState.gameState?.value_state_ledger ||
            (appStoreRecord.value_state_ledger as Record<string, unknown>),
          valueStateLedger:
            engineState.gameState?.value_state_ledger ||
            (appStoreRecord.valueStateLedger as Record<string, unknown>),
        };

        let effectiveWhitelist: CampaignCarryoverWhitelist;
        if (!whitelist) {
          const livingIds = identifyLivingSurvivors(combinedSourceState);
          effectiveWhitelist = createCampaignCarryoverWhitelist(livingIds);
        } else if (Array.isArray(whitelist)) {
          effectiveWhitelist = createCampaignCarryoverWhitelist(whitelist);
        } else {
          effectiveWhitelist = CampaignCarryoverWhitelistSchema.parse(whitelist);
        }

        const transitionResult = resolveCampaignTransition(
          combinedSourceState,
          normalizedBlueprint,
          effectiveWhitelist
        );

        if (options?.entryNodeId) {
          transitionResult.nextState.currentNodeId = options.entryNodeId;
          if (transitionResult.nextState.castPlacement) {
            for (const survivor of transitionResult.receipt.carriedCharacters) {
              transitionResult.nextState.castPlacement[survivor.characterId] = options.entryNodeId;
            }
          }
        }

        const nextRevision = (transitionResult.nextState.canonicalRevision as number) || 1;
        const nextDurableRevision: DurableSessionRevision = {
          sessionId,
          blueprintId: normalizedBlueprint.id || 'unknown',
          revision: nextRevision,
          turnCount: 0,
          committedAt: Date.now(),
        };

        useAppStore.setState({
          ...transitionResult.nextState,
          sessionId,
          blueprintId: normalizedBlueprint.id || 'unknown',
          durableSessionRevision: nextDurableRevision,
          lastTurnCheckpoint: null,
          isTransitioning: false,
          isShattered: false,
          uiTranscript: [],
          enginePayload: [],
          turnSnapshot: null,
          isGenerating: false,
        });

        set({
          activeSessionId: sessionId,
          activeBlueprint: normalizedBlueprint,
          durableSessionRevision: nextDurableRevision,
          lastTurnCheckpoint: null,
          gameState: transitionResult.nextState.gameState ?? null,
          engineMessages: [],
          engineTextBuffer: [],
          engineWorldStateSummary: '',
        });

        return transitionResult;
      },
      clearBlueprint: () =>
        set({
          activeSessionId: null,
          activeBlueprint: null,
          durableSessionRevision: null,
          lastTurnCheckpoint: null,
          participationContext: null,
          gameState: null,
          engineMessages: [],
          engineTextBuffer: [],
          engineWorldStateSummary: '',
        }),
      updateGameState: (newState) => set({ gameState: newState }),
      setGameState: (newState) => set({ gameState: newState }),
      patchGameState: (patch) =>
        set((state) => {
          if (!state.gameState) return state;
          return {
            gameState: {
              ...state.gameState,
              ...patch,
              player_role: state.gameState.player_role,
              player_character_id: state.gameState.player_character_id,
              perspective_mode: state.gameState.perspective_mode,
              inventory: patch.inventory ?? state.gameState.inventory ?? [],
              player_injuries: patch.player_injuries ?? state.gameState.player_injuries ?? [],
              lore_and_memory: patch.lore_and_memory ?? state.gameState.lore_and_memory,
              npc_fixations: patch.npc_fixations ?? state.gameState.npc_fixations ?? [],
            },
          };
        }),
      addEngineMessage: (message) => {
        set((state) => {
          const currentStatus = state.gameState?.psychological_status || 'Stable';
          const msg = {
            ...message,
            frozen_psychological_status: message.frozen_psychological_status || currentStatus,
          };
          return {
            engineMessages: [...state.engineMessages, msg],
          };
        });
        get().addEngineTurn(message);
      },
      setEngineMessages: (messages) =>
        set({ engineMessages: messages, engineTextBuffer: messages.slice(-get().maxBufferTurns) }),
      ingestTurn: (turn) => get().addEngineTurn(turn),
      addEngineTurn: (turn) => {
        set((state) => {
          const currentStatus = state.gameState?.psychological_status || 'Stable';
          const newBuffer = [
            ...state.engineTextBuffer,
            {
              ...turn,
              frozen_psychological_status: turn.frozen_psychological_status || currentStatus,
            },
          ];
          return { engineTextBuffer: newBuffer };
        });

        if (get().engineTextBuffer.length > get().maxBufferTurns) {
          get().pruneContext();
        }
      },
      pruneContext: async () => {
        const currentBuffer = get().engineTextBuffer;
        const currentSummary = get().engineWorldStateSummary;

        // 1. Isolate the oldest message cluster
        const turnsToPrune = currentBuffer.slice(0, 2);
        const remainingBuffer = currentBuffer.slice(2);

        // 2. Clear from active text memory immediately for UI responsiveness
        set({ engineTextBuffer: remainingBuffer });

        // 3. Flatten the complex JSON payload into structured plain text
        const flattenedTranscript = turnsToPrune
          .map((t) => (typeof t.content === 'string' ? t.content : JSON.stringify(t.content)))
          .join('\n');

        // 4. Dispatch the streamlined text string to the background processing tier
        try {
          const updatedSummary = await distillContext(currentSummary, flattenedTranscript);
          set({ engineWorldStateSummary: updatedSummary });
          console.log('// BACKGROUND SEMANTIC DISTILLATION lossless pass complete //');
        } catch (error) {
          console.error('// DISTILLATION BACKGROUND FAILURE // Fallback state maintained.', error);
        }
      },
      updateWorldStateSummary: (newSummary) => {
        set({ engineWorldStateSummary: newSummary });
      },
      resetEngine: () =>
        set({
          activeSessionId: null,
          activeBlueprint: null,
          durableSessionRevision: null,
          lastTurnCheckpoint: null,
          participationContext: null,
          gameState: null,
          engineTextBuffer: [],
          engineMessages: [],
          engineWorldStateSummary: '',
          telemetry: null,
          maxBufferTurns: 12,
        }),
    }),
    {
      name: 'the-engine-memory',
      storage: createJSONStorage(() => idbStorage),
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        if (version !== 1 || !persistedState || typeof persistedState !== 'object') {
          return {};
        }
        return persistedState;
      },
      merge: (persistedState: unknown, currentState: EngineState): EngineState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return currentState;
        }
        const result = EnginePersistedSchema.safeParse(persistedState);
        if (!result.success) {
          console.warn(
            '[EngineStore] Persisted state validation failed, resetting to initial state:',
            result.error
          );
          return currentState;
        }
        return {
          ...currentState,
          ...(result.data as unknown as Partial<EngineState>),
        };
      },
      partialize: (state) => ({
        activeSessionId: state.activeSessionId,
        activeBlueprint: state.activeBlueprint,
        durableSessionRevision: state.durableSessionRevision,
        lastTurnCheckpoint: state.lastTurnCheckpoint,
        participationContext: state.participationContext,
        gameState: state.gameState,
        engineMessages: state.engineMessages,
        engineTextBuffer: state.engineTextBuffer,
        maxBufferTurns: state.maxBufferTurns,
        engineWorldStateSummary: state.engineWorldStateSummary,
        telemetry: state.telemetry,
      }),
    }
  )
);
