import {
  Message,
  RatifiedEngineFrame,
  TransitionReceipt,
  TurnReceipt,
  TurnFailureReceipt,
  RuntimeStateSnapshot,
  LogicState,
} from '../../types';

export type Phase =
  | 'HUB'
  | 'FORGE'
  | 'LATENT'
  | 'MANIFEST'
  | 'TERMINAL'
  | 'TERMINATED'
  | 'VOICE'
  | 'ENGINE';
export type DecayStage = 'STABLE' | 'FRAYING' | 'UNSTABLE' | 'SHATTERED';

export interface DecayState {
  stage: DecayStage;
  coherence: number;
}

export interface CommittedTurnPayload {
  commandText: string;
  formattedText: string;
  frame: RatifiedEngineFrame;
  transitionReceipt?: TransitionReceipt;
  turnReceipt: TurnReceipt;
  preSnapshot: RuntimeStateSnapshot;
  timestamp?: number;
  engineGameStateBefore?: LogicState | null;
}

export interface FailedTurnPayload {
  commandText: string;
  preSnapshot: RuntimeStateSnapshot;
  failureReceipt?: TurnFailureReceipt;
  errorCategory?: string;
  errorMessage?: string;
  statusCode?: number | null;
  contentType?: string | null;
  timestamp?: number;
  engineGameStateBefore?: LogicState | null;
}

// The definitive list of all legal engine events
export type EngineEvent =
  | { type: 'TURN_COMMITTED'; payload: CommittedTurnPayload }
  | { type: 'TURN_FAILED'; payload: FailedTurnPayload }
  | { type: 'TURN_RETAKEN' }
  | { type: 'SIMULATION_STARTED'; initialNodeId: string }
  | { type: 'USER_ACTION'; payload: string }
  | { type: 'SYSTEM_MESSAGE'; payload: string }
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'TURN_SUBMITTED'; turnId: string; text: string; timestamp: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'TURN_RESOLVED'; payload: any }
  | { type: 'FRAME_RATIFIED'; turnId: string; frame: Record<string, unknown> | RatifiedEngineFrame } // We will type 'frame' to the Zod schema later
  | { type: 'PHASE_CHANGED'; from: Phase; to: Phase; timestamp: number }
  | { type: 'TOPOLOGY_COMPILED'; graph: Record<string, unknown>[] }
  | { type: 'TRANSITION_ACCEPTED'; fromNodeId: string; toNodeId: string }
  | { type: 'TRANSITION_REJECTED'; fromNodeId: string; attemptedNodeId: string; reason: string }
  | {
      type: 'ACT_DISTILLED';
      trauma: string[];
      summary: string;
      dispatchedAtRevision: number;
      sessionId: string;
    }
  | { type: 'DECAY_UPDATED'; newDecayState: DecayState }
  | { type: 'POV_DEATH_DECLARED'; deathRecord: import('../../types/death').DeathRecord; timestamp?: number }
  | {
      type: 'PROCESS_OBJECT_TRANSITIONS';
      characterId: string;
      proposals: import('../../types/worldState').ObjectTransitionProposal[];
    };
