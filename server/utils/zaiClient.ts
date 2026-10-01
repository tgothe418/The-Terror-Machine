import type { GeminiPurpose } from '../ai/modelPolicy';
import {
  getZaiBaseUrl,
  getZaiFallbackModelId,
  getZaiModel,
  getZaiThinking,
  type ZaiModelId,
} from '../ai/zaiPolicy';
import type { VoiceHistoryMessage } from './openaiVoiceClient';
import { buildLocalVoiceMessages, cleanSimulatedAction, normalizeLocalTurnPayload } from './localVoiceClient';
import type { StructuredResponseContract } from './aiClient';
import {
  EmptyProviderResponseError,
  ProviderRefusalError,
  parseStructuredTurnResponse,
} from './aiClient';
import { parseOrRepairJson } from './jsonRepair';

const STARTUP_ZAI_API_KEY = process.env.ZAI_API_KEY;

export class ZaiProviderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = 'ZaiProviderError';
    this.code = code;
    this.status = status;
  }
}

export function resetZaiApiKey(newKey?: string): void {
  if (newKey !== undefined) {
    const normalized = newKey.trim().replace(/^['"]|['"]$/g, '');
    if (normalized) process.env.ZAI_API_KEY = normalized;
    else delete process.env.ZAI_API_KEY;
  }
}

export function hasZaiApiKey(): boolean {
  return Boolean((process.env.ZAI_API_KEY || STARTUP_ZAI_API_KEY)?.trim());
}

function getZaiApiKey(override?: string): string {
  const key = override?.trim() || process.env.ZAI_API_KEY || STARTUP_ZAI_API_KEY;
  if (!key?.trim()) {
    throw new ZaiProviderError(
      'MISSING_API_KEY',
      'Configure a Z.ai API key before selecting Z.ai for this subsystem.',
      400
    );
  }
  return key.trim().replace(/^['"]|['"]$/g, '');
}

function zaiUrl(resource: 'chat/completions'): string {
  return `${getZaiBaseUrl()}/${resource}`;
}

type ZaiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
type ZaiMessageContent = string | ZaiContentPart[];

type ZaiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: ZaiMessageContent;
};

type ZaiErrorPayload = {
  error?: { code?: string | number; message?: string };
  message?: string;
};

function classifyZaiHttpFailure(status: number, errorBody: string): ZaiProviderError {
  let remoteCode = '';
  let remoteMessage = '';
  try {
    const parsed = JSON.parse(errorBody) as ZaiErrorPayload;
    remoteCode = parsed.error?.code != null ? String(parsed.error.code) : '';
    remoteMessage = parsed.error?.message || parsed.message || '';
  } catch {
    remoteMessage = errorBody.slice(0, 200);
  }

  if (remoteCode === '1301' || remoteCode === '1302') {
    return new ZaiProviderError(
      'PROVIDER_REFUSAL',
      remoteMessage || 'The Z.ai model declined this request on content-policy grounds.',
      502
    );
  }
  if (status === 401) {
    return new ZaiProviderError(
      'INVALID_API_KEY',
      'The Z.ai API key is invalid or unavailable to this project.',
      status
    );
  }
  if (status === 403) {
    return new ZaiProviderError(
      'MODEL_ACCESS_DENIED',
      'This Z.ai account does not have access to the selected model.',
      status
    );
  }
  if (status === 429) {
    return new ZaiProviderError(
      'RATE_LIMIT_EXCEEDED',
      'The Z.ai API rate or spending limit has been reached.',
      status
    );
  }
  if (status === 400) {
    return new ZaiProviderError(
      'PROVIDER_REQUEST_REJECTED',
      `Z.ai rejected the generation request${remoteMessage ? `: ${remoteMessage}` : '.'}`,
      status
    );
  }
  return new ZaiProviderError(
    'PROVIDER_FAILURE',
    status >= 500
      ? 'Z.ai is temporarily unavailable. Please try again in a few moments.'
      : 'The Z.ai request failed.',
    status
  );
}

async function zaiChatCompletion(
  body: Record<string, unknown>,
  options: { apiKey?: string; timeoutMs?: number } = {}
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(zaiUrl('chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getZaiApiKey(options.apiKey)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
    });
  } catch (error: unknown) {
    if (error instanceof ZaiProviderError) throw error;
    throw new ZaiProviderError(
      'PROVIDER_UNAVAILABLE',
      'Could not reach the Z.ai API. Verify network connectivity and the configured endpoint.',
      502
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw classifyZaiHttpFailure(response.status, errorBody);
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
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();
  }

  if (text) {
    if (
      expectJson &&
      choice?.finish_reason === 'length' &&
      (text.trim() === '{' || text.trim().length < 5)
    ) {
      throw new ZaiProviderError(
        'EMPTY_PROVIDER_RESPONSE',
        'The Z.ai model exhausted its token budget during reasoning before generating an answer. Choose a smaller model or reduce the request scope.'
      );
    }
    return text;
  }

  // Fallback: reasoning models occasionally place the JSON answer in reasoning_content.
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

  throw new ZaiProviderError(
    'EMPTY_PROVIDER_RESPONSE',
    'The Z.ai model returned an empty response.'
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bounded retry wrapper: transient 429/5xx failures back off and retry once,
 * and model-level failures fall back down the approved chain one step.
 */
async function withZaiRetry<R>(
  operation: (modelId: ZaiModelId) => Promise<R>,
  initialModel: ZaiModelId
): Promise<R> {
  let currentModel = initialModel;
  let hasAttemptedFallback = false;
  let transientRetries = 0;

  for (;;) {
    try {
      return await operation(currentModel);
    } catch (error: unknown) {
      const isZaiError = error instanceof ZaiProviderError;
      const status = isZaiError ? error.status : null;
      // Empty responses and content-policy refusals fail closed; they are never retried.
      const isFailClosed =
        isZaiError &&
        (error.code === 'EMPTY_PROVIDER_RESPONSE' || error.code === 'PROVIDER_REFUSAL');
      const isTransient =
        isZaiError &&
        !isFailClosed &&
        (error.code === 'RATE_LIMIT_EXCEEDED' || (status !== null && status >= 500));

      if (isTransient && transientRetries < 1) {
        transientRetries++;
        await sleep(800 + Math.random() * 400);
        continue;
      }

      if (
        isZaiError &&
        !hasAttemptedFallback &&
        (status === 404 || status === 403 || (isTransient && transientRetries >= 1))
      ) {
        const fallbackModel = getZaiFallbackModelId(currentModel);
        if (fallbackModel !== currentModel) {
          console.warn(
            `[Zai Client] Model ${currentModel} returned ${error.code}. Attempting fallback to ${fallbackModel}...`
          );
          currentModel = fallbackModel;
          hasAttemptedFallback = true;
          transientRetries = 0;
          continue;
        }
      }

      throw error;
    }
  }
}

function buildZaiBaseBody(
  model: ZaiModelId,
  messages: ZaiChatMessage[],
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
    thinking: { type: getZaiThinking(options.purpose) },
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    stream: false,
  };
}

/**
 * Engine turn generation. Z.ai documents JSON mode (`response_format:
 * json_object`) with the expected structure described in the prompt; the
 * authoritative Zod contract still validates the returned object at ingress.
 */
export async function generateZaiStructuredResponse<T>(
  prompt: string,
  contract: StructuredResponseContract<T>,
  options: { apiKey?: string; model?: ZaiModelId } = {}
): Promise<T> {
  const model = options.model ?? getZaiModel();
  const structuredPrompt = `[FORMAT DIRECTIVE: Output the raw JSON object immediately starting with '{'. Do not output any markdown, explanations, or internal monologue.]
[RESPONSE SCHEMA]
${JSON.stringify(contract.responseJsonSchema, null, 2)}

${prompt}`;
  const body = buildZaiBaseBody(model, [{ role: 'user', content: structuredPrompt }], {
    purpose: 'ENGINE_TURN',
    temperature: 0.2,
    maxTokens: 8192,
    responseFormat: { type: 'json_object' },
  });

  const rawText = await (async () => {
    const payload = await withZaiRetry(
      (modelToUse) =>
        zaiChatCompletion({ ...body, model: modelToUse }, { apiKey: options.apiKey }),
      model
    );
    return readCompletionText(payload, { expectJson: true });
  })().catch((error: unknown) => {
    // Translate Z.ai empty/refusal outcomes into the canonical provider classes
    // so the turn route's fail-closed classification keeps working unchanged.
    if (error instanceof ZaiProviderError) {
      if (error.code === 'EMPTY_PROVIDER_RESPONSE') {
        throw new EmptyProviderResponseError();
      }
      if (error.code === 'PROVIDER_REFUSAL') {
        throw new ProviderRefusalError(error.message);
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
export async function generateZaiTextWithMeta(
  prompt: string,
  options: {
    model?: ZaiModelId;
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
    images?: Array<{ mimeType: string; data: string } | string>;
    timeoutMs?: number;
  } = {}
): Promise<{ text: string; finish_reason: string | null }> {
  let userContent: ZaiMessageContent;
  if (options.images && options.images.length > 0) {
    const parts: ZaiContentPart[] = [{ type: 'text', text: prompt }];
    for (const img of options.images) {
      const url = typeof img === 'string' ? (img.startsWith('data:') ? img : `data:image/png;base64,${img}`) : `data:${img.mimeType};base64,${img.data}`;
      parts.push({ type: 'image_url', image_url: { url } });
    }
    userContent = parts;
  } else {
    userContent = prompt;
  }

  if (options.jsonMode && typeof userContent === 'string') {
    userContent = `[FORMAT DIRECTIVE: Output the raw JSON object immediately starting with '{'. Do not output any markdown fences, explanations, or internal monologue.]\n\n${userContent}`;
  }

  const body = buildZaiBaseBody(
    options.model ?? getZaiModel(),
    [{ role: 'user', content: userContent }],
    {
      purpose: 'FORGE_ARCHITECTURE',
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 4096,
      ...(options.jsonMode ? { responseFormat: { type: 'json_object' } } : {}),
    }
  );

  const payload = await zaiChatCompletion(body, { timeoutMs: options.timeoutMs ?? 300_000 });
  const raw = readCompletionText(payload, { expectJson: options.jsonMode ?? false });
  if (!raw) {
    throw new ZaiProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Z.ai model returned an empty response.'
    );
  }
  return {
    text: raw,
    finish_reason: (payload as { choices?: Array<{ finish_reason?: string }> })?.choices?.[0]?.finish_reason ?? null,
  };
}

/** Forge Architect / extraction text generation. */
export async function generateZaiText(
  prompt: string,
  options: {
    model?: ZaiModelId;
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
    images?: Array<{ mimeType: string; data: string } | string>;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  return (await generateZaiTextWithMeta(prompt, options)).text;
}

/** Legacy /init prose generation. */
export async function generateZaiProse(
  prompt: string,
  options: { model?: ZaiModelId } = {}
): Promise<string> {
  const body = buildZaiBaseBody(options.model ?? getZaiModel(), [{ role: 'user', content: prompt }], {
    purpose: 'ENGINE_INIT',
    temperature: 0.7,
    maxTokens: 1024,
  });
  const payload = await zaiChatCompletion(body, { timeoutMs: 120_000 });
  const raw = cleanSimulatedAction(readCompletionText(payload, { expectJson: false }));
  if (!raw) {
    throw new ZaiProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Z.ai model returned an empty response.'
    );
  }
  return raw;
}

/** Autopilot player-action simulation. Thinking stays disabled for latency. */
export async function generateZaiPlayerAction(
  prompt: string,
  options: { model?: ZaiModelId } = {}
): Promise<string> {
  const actionPrompt = `[REASONING CONSTRAINT: Output ONLY the player's immediate action or dialogue, with no reasoning, commentary, or markdown fences.]\n\n${prompt}`;
  const body = buildZaiBaseBody(
    options.model ?? getZaiModel(),
    [{ role: 'user', content: actionPrompt }],
    {
      purpose: 'AUTOPILOT_ACTION',
      temperature: 0.7,
      maxTokens: 2048,
    }
  );
  const payload = await zaiChatCompletion(body, { timeoutMs: 120_000 });
  const rawAction = cleanSimulatedAction(readCompletionText(payload, { expectJson: false }));
  if (!rawAction) {
    throw new ZaiProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Z.ai model returned an empty player action.'
    );
  }
  return rawAction;
}

/** The Historian (Voice) generation over the Z.ai OpenAI-compatible endpoint. */
export async function generateZaiVoice({
  instructions,
  history,
}: {
  instructions: string;
  history: VoiceHistoryMessage[];
}): Promise<{ text: string; model: ZaiModelId; provider: 'zai' }> {
  const model = getZaiModel();
  const messages = buildZaiVoiceMessages(instructions, history);
  const body = buildZaiBaseBody(model, messages, {
    purpose: 'VOICE',
    temperature: 0.7,
    maxTokens: 2048,
  });
  const payload = await zaiChatCompletion(body, { timeoutMs: 120_000 });
  const text = readCompletionText(payload, { expectJson: false });
  if (!text) {
    throw new ZaiProviderError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Z.ai model returned an empty Voice response.'
    );
  }
  return { text, model, provider: 'zai' };
}

function buildZaiVoiceMessages(
  instructions: string,
  history: VoiceHistoryMessage[]
): ZaiChatMessage[] {
  return buildLocalVoiceMessages(instructions, history).map((message) => ({
    role: message.role,
    content: message.content as ZaiMessageContent,
  }));
}

export async function pingZai(
  options: {
    model?: ZaiModelId;
    apiKey?: string;
  } = {}
): Promise<{
  ok: boolean;
  provider: 'zai';
  model: ZaiModelId;
  latencyMs: number;
  status?: number;
  code?: string;
  message?: string;
}> {
  const model = options.model ?? getZaiModel();
  const start = Date.now();
  try {
    const body = buildZaiBaseBody(
      model,
      [{ role: 'user', content: 'Respond with OK.' }],
      { purpose: 'ENGINE_PREVIEW', maxTokens: 8 }
    );
    await zaiChatCompletion(body, { apiKey: options.apiKey, timeoutMs: 30_000 });
    return { ok: true, provider: 'zai', model, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const known =
      error instanceof ZaiProviderError
        ? error
        : new ZaiProviderError('PROVIDER_FAILURE', 'The Z.ai request could not be completed.');
    return {
      ok: false,
      provider: 'zai',
      model,
      latencyMs: Date.now() - start,
      status: known.status,
      code: known.code,
      message: known.message,
    };
  }
}
