import type { GeminiPurpose } from '../ai/modelPolicy';
import {
  getHemmingwayModel,
  getHemmingwayThinking,
  HEMMINGWAY_BASE_URL,
  type HemmingwayModelId,
} from '../ai/hemmingwayPolicy';
import type { VoiceHistoryMessage } from './openaiVoiceClient';
import { buildLocalVoiceMessages, cleanSimulatedAction, normalizeLocalTurnPayload } from './localVoiceClient';
import type { StructuredResponseContract } from './aiClient';
import {
  EmptyProviderResponseError,
  ProviderPrepaymentDepletedError,
  ProviderRefusalError,
  parseStructuredTurnResponse,
} from './aiClient';
import { parseOrRepairJson } from './jsonRepair';

const STARTUP_HEMMINGWAY_API_KEY = process.env.HEMMINGWAY_API_KEY;

export class HemmingwayProviderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = 'HemmingwayProviderError';
    this.code = code;
    this.status = status;
  }
}

export function resetHemmingwayApiKey(newKey?: string): void {
  if (newKey !== undefined) {
    const normalized = newKey.trim().replace(/^['"]|['"]$/g, '');
    if (normalized) process.env.HEMMINGWAY_API_KEY = normalized;
    else delete process.env.HEMMINGWAY_API_KEY;
  }
}

export function hasHemmingwayApiKey(): boolean {
  return Boolean((process.env.HEMMINGWAY_API_KEY || STARTUP_HEMMINGWAY_API_KEY)?.trim());
}

function getHemmingwayApiKey(override?: string): string {
  const key = override?.trim() || process.env.HEMMINGWAY_API_KEY || STARTUP_HEMMINGWAY_API_KEY;
  if (!key?.trim()) {
    throw new HemmingwayProviderError(
      'MISSING_API_KEY',
      'Configure a Hemmingway API key before selecting Hemmingway for this subsystem.',
      400
    );
  }
  return key.trim().replace(/^['"]|['"]$/g, '');
}

function hemmingwayUrl(resource: 'chat/completions'): string {
  return `${HEMMINGWAY_BASE_URL}/${resource}`;
}

type HemmingwayErrorPayload = {
  error?: { code?: string | number; message?: string };
  message?: string;
};

function classifyHemmingwayHttpFailure(status: number, errorBody: string): HemmingwayProviderError {
  let remoteCode = '';
  let remoteMessage = '';
  try {
    const parsed = JSON.parse(errorBody) as HemmingwayErrorPayload;
    remoteCode = parsed.error?.code != null ? String(parsed.error.code) : '';
    remoteMessage = parsed.error?.message || parsed.message || '';
  } catch {
    remoteMessage = errorBody.slice(0, 200);
  }

  if (status === 402 || remoteCode === 'out_of_credit') {
    return new HemmingwayProviderError(
      'PREPAYMENT_DEPLETED',
      remoteMessage ||
        'Your Hemmingway prepaid credit is exhausted. Add credit on the platform to continue.',
      402
    );
  }
  if (status === 401 || remoteCode === 'bad_key' || remoteCode === 'signed_out') {
    return new HemmingwayProviderError(
      'INVALID_API_KEY',
      'The Hemmingway API key is invalid or has been revoked.',
      status
    );
  }
  if (status === 429 || remoteCode === 'busy') {
    return new HemmingwayProviderError(
      'RATE_LIMIT_EXCEEDED',
      remoteMessage ||
        'The Hemmingway concurrency limit (8 simultaneous requests) has been reached. Retry in a moment.',
      status
    );
  }
  if (status === 400) {
    return new HemmingwayProviderError(
      'PROVIDER_REQUEST_REJECTED',
      `Hemmingway rejected the generation request${remoteMessage ? `: ${remoteMessage}` : '.'}`,
      status
    );
  }
  return new HemmingwayProviderError(
    'PROVIDER_FAILURE',
    status >= 500
      ? remoteMessage || 'Hemmingway is temporarily unreachable. Please try again in a few moments.'
      : 'The Hemmingway request failed.',
    status
  );
}

async function hemmingwayChatCompletion(
  body: Record<string, unknown>,
  options: { apiKey?: string; timeoutMs?: number } = {}
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(hemmingwayUrl('chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getHemmingwayApiKey(options.apiKey)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
    });
  } catch (error: unknown) {
    if (error instanceof HemmingwayProviderError) throw error;
    throw new HemmingwayProviderError(
      'PROVIDER_UNAVAILABLE',
      'Could not reach the Hemmingway API. Verify network connectivity.',
      502
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw classifyHemmingwayHttpFailure(response.status, errorBody);
  }
  return await response.json();
}

function readCompletionText(
  payload: unknown,
  options: { expectJson?: boolean } = {}
): string {
  const choice = (payload as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
      };
    }>;
  }).choices?.[0];
  const content = choice?.message?.content;
  const expectJson = options.expectJson !== false;

  let text = '';
  if (typeof content === 'string') {
    text = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  } else if (Array.isArray(content)) {
    text = content
      .map((part) =>
        typeof part === 'object' && part && 'text' in part ? String(part.text ?? '') : ''
      )
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (text) {
    if (
      expectJson &&
      choice?.finish_reason === 'length' &&
      (text.trim() === '{' || text.trim().length < 5)
    ) {
      throw new HemmingwayProviderError(
        'EMPTY_PROVIDER_RESPONSE',
        'The Hemmingway model exhausted its token budget during reasoning before generating an answer.'
      );
    }
    return text;
  }

  // Hemmingway delivers thinking in reasoning_content; salvage JSON answers
  // that never made it into content.
  const reasoning =
    typeof choice?.message?.reasoning_content === 'string'
      ? choice.message.reasoning_content.trim()
      : '';
  if (reasoning) {
    if (expectJson) {
      const jsonMatch = reasoning.match(/\{[\s\S]*\}/);
      if (jsonMatch && jsonMatch[0].length > 5) {
        try {
          parseOrRepairJson(jsonMatch[0]);
          return jsonMatch[0];
        } catch {
          // Matched substring in reasoning was not valid or repairable JSON
        }
      }
    } else if (choice?.finish_reason !== 'length') {
      const withoutThink = reasoning.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (withoutThink) return withoutThink;
    }
  }

  throw new HemmingwayProviderError(
    'EMPTY_PROVIDER_RESPONSE',
    'The Hemmingway model returned an empty response.'
  );
}

function buildHemmingwayBaseBody(
  model: HemmingwayModelId,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }>,
  options: {
    purpose: GeminiPurpose;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: Record<string, unknown>;
  }
): Record<string, unknown> {
  return {
    model,
    messages,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    max_tokens: options.maxTokens ?? 8192,
    ...getHemmingwayThinking(options.purpose),
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    stream: false,
  };
}

/**
 * Engine turn generation. Hemmingway documents JSON mode via response_format;
 * the authoritative Zod contract still validates the returned object at ingress.
 */
export async function generateHemmingwayStructuredResponse<T>(
  prompt: string,
  contract: StructuredResponseContract<T>,
  options: { apiKey?: string; model?: HemmingwayModelId } = {}
): Promise<T> {
  const model = options.model ?? getHemmingwayModel();
  const structuredPrompt = `[FORMAT DIRECTIVE: Output the raw JSON object immediately starting with '{'. Do not output any markdown, explanations, or internal monologue.]
[RESPONSE SCHEMA]
${JSON.stringify(contract.responseJsonSchema, null, 2)}

${prompt}`;
  const body = buildHemmingwayBaseBody(
    model,
    [{ role: 'user', content: structuredPrompt }],
    {
      purpose: 'ENGINE_TURN',
      temperature: 0.2,
      maxTokens: 8192,
      responseFormat: { type: 'json_object' },
    }
  );

  const rawText = await (async () => {
    const payload = await hemmingwayChatCompletion(
      { ...body, model: model },
      { apiKey: options.apiKey }
    );
    return readCompletionText(payload, { expectJson: true });
  })().catch((error: unknown) => {
    // Translate empty/refusal/out-of-credit outcomes into the canonical
    // provider classes so the turn route's fail-closed classification keeps
    // working unchanged.
    if (error instanceof HemmingwayProviderError) {
      if (error.code === 'EMPTY_PROVIDER_RESPONSE') {
        throw new EmptyProviderResponseError();
      }
      if (error.code === 'PROVIDER_REFUSAL') {
        throw new ProviderRefusalError(error.message);
      }
      if (error.code === 'PREPAYMENT_DEPLETED') {
        throw new ProviderPrepaymentDepletedError(error.message);
      }
    }
    throw error;
  });

  if (!rawText || !rawText.trim()) {
    throw new EmptyProviderResponseError();
  }

  return parseStructuredTurnResponse(
    rawText,
    contract.zodSchema,
    (raw) => normalizeLocalTurnPayload(raw, contract.normalizeProviderPayload)
  );
}

/** Forge Architect / extraction text generation with finish_reason meta. */
export async function generateHemmingwayTextWithMeta(
  prompt: string,
  options: {
    model?: HemmingwayModelId;
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<{ text: string; finish_reason: string | null }> {
  let userContent: string = prompt;
  if (options.jsonMode) {
    userContent = `[FORMAT DIRECTIVE: Output the raw JSON object immediately starting with '{'. Do not output any markdown fences, explanations, or internal monologue.]\n\n${userContent}`;
  }

  const body = buildHemmingwayBaseBody(
    options.model ?? getHemmingwayModel(),
    [{ role: 'user', content: userContent }],
    {
      purpose: 'FORGE_ARCHITECTURE',
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 4096,
      ...(options.jsonMode ? { responseFormat: { type: 'json_object' } } : {}),
    }
  );

  const payload = await hemmingwayChatCompletion(body, { timeoutMs: options.timeoutMs ?? 300_000 });
  const raw = readCompletionText(payload, { expectJson: options.jsonMode ?? false });
  if (!raw) {
    throw new HemmingwayProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Hemmingway model returned an empty response.'
    );
  }
  return {
    text: raw,
    finish_reason: (payload as { choices?: Array<{ finish_reason?: string }> })?.choices?.[0]?.finish_reason ?? null,
  };
}

/** Forge Architect / extraction text generation. */
export async function generateHemmingwayText(
  prompt: string,
  options: {
    model?: HemmingwayModelId;
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  return (await generateHemmingwayTextWithMeta(prompt, options)).text;
}

/** Legacy /init prose generation. */
export async function generateHemmingwayProse(
  prompt: string,
  options: { model?: HemmingwayModelId } = {}
): Promise<string> {
  const body = buildHemmingwayBaseBody(
    options.model ?? getHemmingwayModel(),
    [{ role: 'user', content: prompt }],
    { purpose: 'ENGINE_INIT', temperature: 0.7, maxTokens: 1024 }
  );
  const payload = await hemmingwayChatCompletion(body, { timeoutMs: 120_000 });
  const raw = cleanSimulatedAction(readCompletionText(payload, { expectJson: false }));
  if (!raw) {
    throw new HemmingwayProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Hemmingway model returned an empty response.'
    );
  }
  return raw;
}

/** Autopilot player-action simulation. Thinking stays disabled for latency. */
export async function generateHemmingwayPlayerAction(
  prompt: string,
  options: { model?: HemmingwayModelId } = {}
): Promise<string> {
  const actionPrompt = `[REASONING CONSTRAINT: Output ONLY the player's immediate action or dialogue, with no reasoning, commentary, or markdown fences.]\n\n${prompt}`;
  const body = buildHemmingwayBaseBody(
    options.model ?? getHemmingwayModel(),
    [{ role: 'user', content: actionPrompt }],
    { purpose: 'AUTOPILOT_ACTION', temperature: 0.7, maxTokens: 2048 }
  );
  const payload = await hemmingwayChatCompletion(body, { timeoutMs: 120_000 });
  const rawAction = cleanSimulatedAction(readCompletionText(payload, { expectJson: false }));
  if (!rawAction) {
    throw new HemmingwayProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Hemmingway model returned an empty player action.'
    );
  }
  return rawAction;
}

/** The Historian (Voice) generation over the Hemmingway endpoint. */
export async function generateHemmingwayVoice({
  instructions,
  history,
}: {
  instructions: string;
  history: VoiceHistoryMessage[];
}): Promise<{ text: string; model: HemmingwayModelId; provider: 'hemmingway' }> {
  const model = getHemmingwayModel();
  const messages = buildLocalVoiceMessages(instructions, history).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const body = buildHemmingwayBaseBody(model, messages, {
    purpose: 'VOICE',
    temperature: 0.7,
    maxTokens: 2048,
  });
  const payload = await hemmingwayChatCompletion(body, { timeoutMs: 120_000 });
  const text = readCompletionText(payload, { expectJson: false });
  if (!text) {
    throw new HemmingwayProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Hemmingway model returned an empty Voice response.'
    );
  }
  return { text, model, provider: 'hemmingway' };
}

export async function pingHemmingway(
  options: {
    model?: HemmingwayModelId;
    apiKey?: string;
  } = {}
): Promise<{
  ok: boolean;
  provider: 'hemmingway';
  model: HemmingwayModelId;
  latencyMs: number;
  status?: number;
  code?: string;
  message?: string;
}> {
  const model = options.model ?? getHemmingwayModel();
  const start = Date.now();
  try {
    const body = buildHemmingwayBaseBody(
      model,
      [{ role: 'user', content: 'Respond with OK.' }],
      { purpose: 'ENGINE_PREVIEW', maxTokens: 8 }
    );
    await hemmingwayChatCompletion(body, { apiKey: options.apiKey, timeoutMs: 30_000 });
    return { ok: true, provider: 'hemmingway', model, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const known =
      error instanceof HemmingwayProviderError
        ? error
        : new HemmingwayProviderError(
            'PROVIDER_FAILURE',
            'The Hemmingway request could not be completed.'
          );
    return {
      ok: false,
      provider: 'hemmingway',
      model,
      latencyMs: Date.now() - start,
      status: known.status,
      code: known.code,
      message: known.message,
    };
  }
}
