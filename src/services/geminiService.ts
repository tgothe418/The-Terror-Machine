import {
  Message,
  ScenarioBlueprint,
  BicameralOutput,
  LogicState,
  ProseStyleVector,
  ForgePhase,
  ReferenceMaterial,
  ExtractedLore,
  AppPhase,
  SystemLogicIntervention,
} from '../types';
import { getForgeState } from '../store/useForgeStore';
import { DISTILLATION_SYSTEM_PROMPT, DISTILLATION_PROMPT } from '../core/prompts/distillation';

let currentMemoryForgeController: AbortController | null = null;

export const generateCinematicSummary = async (excisedMessages: Message[]): Promise<string> => {
  const conversationText = excisedMessages
    .map((m) => `${m.role === 'user' ? 'SUBJECT' : 'ENGINE'}: ${m.content}`)
    .join('\n\n');

  try {
    const response = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `${DISTILLATION_PROMPT}\n${conversationText}`,
      }),
    });

    if (!response.ok) throw new Error('Distillation failed');
    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error('[DISTILLATION ERROR] Falling back to static marker.', error);
    return 'The timeline fractures, memories compressing into a dense, inescapable dread. Time dilates, stripping away the immediate past to leave only the heavy, somatic weight of what has already transpired.';
  }
};

export const distillContext = async (
  currentSummary: string,
  flattenedTranscript: string
): Promise<string> => {
  try {
    const response = await fetch('/api/distill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: DISTILLATION_SYSTEM_PROMPT,
        currentSummary,
        flattenedTranscript,
      }),
    });

    if (!response.ok) throw new Error('Distillation sequence failed.');

    const data = await response.json();
    return data.summary;
  } catch (error) {
    console.error('// DISTILLATION CORE ERROR //', error);
    return currentSummary;
  }
};

export const triggerMemoryForge = async (chatHistory: string, dispatchedAtRevision: number) => {
  try {
    if (currentMemoryForgeController) {
      currentMemoryForgeController.abort();
    }
    currentMemoryForgeController = new AbortController();

    console.log('[MEMORY FORGE] Initiating Context Distillation...');

    // We can use the existing /api/distill or create a new one. Wait, we might need a dedicated endpoint or we can use a generic chat endpoint.
    // Let's create an endpoint or just use /api/chat with a simple payload?
    // Let's put a fetch to /api/memory-forge
    const response = await fetch('/api/memory-forge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: DISTILLATION_SYSTEM_PROMPT,
        chatHistory,
      }),
      signal: currentMemoryForgeController.signal,
    });

    if (!response.ok) throw new Error('Memory Forge failed.');

    const parsed = await response.json();

    const appStoreMod = await import('../store/useAppStore');
    const appStore = appStoreMod.useAppStore.getState();
    appStore.dispatch({
      type: 'ACT_DISTILLED',
      trauma: parsed.enduring_trauma || [],
      summary: parsed.act_summary || 'The void shifts, remembering nothing.',
      dispatchedAtRevision,
      sessionId: appStore.sessionId || 'unknown',
    });

    console.log('[MEMORY FORGE] Distillation Complete. Context cleared.');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('[MEMORY FORGE] Distillation aborted by newer user turn.');
    } else {
      console.error('[MEMORY FORGE] Distillation failed:', error);
    }
  } finally {
    currentMemoryForgeController = null;
  }
};

export async function sendMessageToArchitect(
  messageHistory: Message[],
  currentPhase: ForgePhase,
  voiceContext?: Message[]
) {
  const storeState = getForgeState();
  const response = await fetch('/api/architect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageHistory, currentPhase, voiceContext, storeState }),
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data.text;
}

export const analyzeReferenceMaterial = async (
  materials: ReferenceMaterial[]
): Promise<ExtractedLore> => {
  const response = await fetch('/api/analyze-reference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materials }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

export async function summarizeForgeInterview(history: Message[]): Promise<string> {
  const response = await fetch('/api/summarize-interview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history }),
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data.text;
}

export async function extractStyleProfile(userText: string): Promise<ProseStyleVector> {
  const response = await fetch('/api/extract-style', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userText }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export const sendVoiceTurn = async (
  textBuffer: Message[],
  forgeContext?: Message[]
): Promise<BicameralOutput> => {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      execution_mode: 'VOICE',
      textBuffer,
      forgeContext,
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

export async function sendChatMessage(payload: {
  textBuffer: Message[];
  blueprint?: ScenarioBlueprint;
  currentState?: LogicState | null;
  forgeContext?: Message[];
  execution_mode: AppPhase;
  worldStateSummary?: string;
}): Promise<BicameralOutput> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export type SimulatedPlayerActionResult =
  | { success: true; action: string }
  | { success: false; code: string };

export type AutopilotMode = 'standard' | 'aggressive' | 'adversarial';

export interface VillainIdentityForAutopilot {
  name: string;
  description?: string;
  personality?: string;
  goals?: string;
  traits?: string[];
  directives?: string[];
  coVillains?: string[];
}

export interface FetchSimulatedPlayerActionOptions {
  characterName?: string;
  role?: string;
  mode?: AutopilotMode;
  villainIdentity?: VillainIdentityForAutopilot;
}

export const fetchSimulatedPlayerAction = async (
  history: Message[],
  logicState: LogicState | null,
  optionsOrRole?: string | FetchSimulatedPlayerActionOptions,
  legacyCharacterName?: string
): Promise<SimulatedPlayerActionResult> => {
  let role: string | undefined;
  let characterName: string | undefined;
  let mode: AutopilotMode = 'standard';
  let villainIdentity: VillainIdentityForAutopilot | undefined;

  if (typeof optionsOrRole === 'object' && optionsOrRole !== null) {
    role = optionsOrRole.role;
    characterName = optionsOrRole.characterName;
    mode = optionsOrRole.mode || 'standard';
    villainIdentity = optionsOrRole.villainIdentity;
  } else if (typeof optionsOrRole === 'string') {
    role = optionsOrRole;
    characterName = legacyCharacterName;
  }

  try {
    const response = await fetch('/api/simulate-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, logicState, role, characterName, mode, villainIdentity }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const code = typeof data?.code === 'string' ? data.code : 'AUTOPILOT_ACTION_FAILURE';
      return { success: false, code };
    }

    const data = await response.json();
    if (typeof data?.action === 'string' && data.action.trim().length > 0) {
      return { success: true, action: data.action.trim() };
    }

    return { success: false, code: 'AUTOPILOT_ACTION_FAILURE' };
  } catch (error) {
    console.error('// AUTOPILOT FAILURE //', error);
    return { success: false, code: 'TURN_NETWORK_FAILURE' };
  }
};

export const reconcileStateFromEdit = async (
  editedText: string,
  previousLogic: SystemLogicIntervention[],
  currentState: LogicState | unknown
) => {
  try {
    const response = await fetch('/api/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedText, previousLogic, currentState }),
    });

    if (!response.ok) throw new Error('Failed to reconcile state from edit.');

    return await response.json();
  } catch (error) {
    console.error('// RECONCILIATION FAILURE //', error);
    return {};
  }
};

export interface TurnStreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (response: unknown) => void;
  onError?: (error: Error | { error: string; diagnostics?: unknown[] }) => void;
}

export async function streamEngineTurn(
  payload: unknown,
  callbacks?: TurnStreamCallbacks,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch('/api/turn-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const err = new Error((errorBody.error as string) || `HTTP ${response.status}`);
    Object.assign(err, { status: response.status, code: errorBody.code });
    callbacks?.onError?.(err);
    throw err;
  }

  if (!response.body) {
    const err = new Error('Response body is null');
    callbacks?.onError?.(err);
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: unknown = null;

  try {
    let isReading = true;
    while (isReading) {
      const { done, value } = await reader.read();
      if (done) {
        isReading = false;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = 'message';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          currentEvent = 'message';
          continue;
        }

        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          try {
            const parsedData = JSON.parse(dataStr);
            if (currentEvent === 'token') {
              callbacks?.onToken?.(parsedData.token);
            } else if (currentEvent === 'complete') {
              finalResult = parsedData;
              callbacks?.onComplete?.(parsedData);
            } else if (currentEvent === 'error') {
              const err = new Error(parsedData.error || 'Turn generation error');
              Object.assign(err, { diagnostics: parsedData.diagnostics });
              callbacks?.onError?.(err);
              throw err;
            }
          } catch (parseErr) {
            if (currentEvent === 'error') throw parseErr;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finalResult) {
    const err = new Error('Stream ended without complete event');
    callbacks?.onError?.(err);
    throw err;
  }

  return finalResult;
}

