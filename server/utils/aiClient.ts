import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { z } from "zod";
import { getGeminiPolicy, getFallbackModelId, getEngineProvider, type GeminiModelId } from "../ai/modelPolicy";
import { TurnResultSchema, type TurnResult } from "../schemas/engine";
import {
  type GeminiJsonSchema,
  geminiTurnResponseJsonSchema,
} from "../ai/geminiTurnJsonSchema";
import {
  normalizeGeminiTurnProviderPayload,
  type CastNormalizationContext,
} from '../ai/geminiTurnTransport';
import { generateLocalStructuredResponse } from './localVoiceClient';
import { generateZaiStructuredResponse } from './zaiClient';
import { generateHemmingwayStructuredResponse } from './hemmingwayClient';
import { parseOrRepairJson } from './jsonRepair';

let aiClient: GoogleGenAI | null = null;
const STARTUP_API_KEY = process.env.GEMINI_API_KEY;

export function resetAiClient(newKey?: string): void {
  if (newKey !== undefined) {
    process.env.GEMINI_API_KEY = newKey.trim().replace(/^['"]|['"]$/g, '');
  }
  aiClient = null;
}

export function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY || STARTUP_API_KEY;
    if (!key) {
      throw new Error('Please configure your Gemini API Key in the AI Studio Secrets panel.');
    }
    const cleanKey = key.trim().replace(/^['"]|['"]$/g, '');
    aiClient = new GoogleGenAI({ 
      apiKey: cleanKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

const engineResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    engine_thoughts: { 
      type: Type.STRING, 
      description: "Step-by-step reasoning for the current simulation state.",
    },
    narrative_blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          type: {
            type: Type.STRING,
            format: "enum",
            enum: ["prose", "dialogue", "system_voice", "environmental_description"],
          },
          speaker: { type: Type.STRING, nullable: true },
          content: { type: Type.STRING },
        },
        required: ["id", "type", "content"],
      },
    },
    logic_state: {
      type: Type.OBJECT,
      properties: {
        current_phase: {
          type: Type.STRING,
          format: "enum",
          enum: ["LATENT", "MANIFEST", "RELEASE"],
        },
        requested_transition: { type: Type.STRING, nullable: true },
        suggested_tension: { type: Type.INTEGER },
        terminal_flags: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        cast_deltas: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              character_id: { type: Type.STRING },
              skepticism_delta: { type: Type.NUMBER }
            },
            required: ["character_id", "skepticism_delta"]
          }
        }
      },
      required: ["current_phase", "requested_transition", "suggested_tension", "terminal_flags"]
    }
  },
  required: ["engine_thoughts", "narrative_blocks", "logic_state"]
} satisfies Schema;

export const generateEngineTurn = async (prompt: string): Promise<string | null | undefined> => {
  const contents = [
    {
      role: "user",
      parts: [{ text: prompt }]
    }
  ];

  const policy = getGeminiPolicy('ENGINE_TURN');
  const response = await executeWithRetryAndFallback(
    async (modelToUse) => {
      return await getAiClient().models.generateContent({
        model: modelToUse,
        contents,
        config: {
          thinkingConfig: {
            thinkingLevel: policy.thinkingLevel,
          },
          responseMimeType: "application/json",
          responseSchema: engineResponseSchema,
        }
      });
    },
    policy.model
  );

  return response.text;
};

export type ProviderResponseClassification =
  | { kind: 'CONTENT'; text: string }
  | { kind: 'PROVIDER_REFUSAL'; reason?: string }
  | { kind: 'EMPTY_PROVIDER_RESPONSE' };

export const EXPLICIT_REFUSAL_FINISH_REASONS = new Set([
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'RECITATION',
  'OTHER',
]);

/**
 * Pure server-side classifier for @google/genai response metadata.
 * Inspects promptFeedback.blockReason and candidates[0].finishReason prior to accessing response.text.
 * Retains only bounded code/reason and sanitizes all raw response, prompt, stack, or credential sentinels.
 */
export function classifyProviderResponse(response: unknown): ProviderResponseClassification {
  if (!response || typeof response !== 'object') {
    return { kind: 'EMPTY_PROVIDER_RESPONSE' };
  }

  const res = response as {
    promptFeedback?: { blockReason?: string | null };
    candidates?: Array<{ finishReason?: string | null }>;
    text?: string | null;
  };

  // 1. Check prompt-level block reason
  const blockReason = res.promptFeedback?.blockReason;
  if (
    blockReason &&
    typeof blockReason === 'string' &&
    blockReason !== 'BLOCK_REASON_UNSPECIFIED' &&
    blockReason !== 'UNKNOWN'
  ) {
    return {
      kind: 'PROVIDER_REFUSAL',
      reason: blockReason,
    };
  }

  // 2. Check candidate-level finish reason
  const firstCandidate = res.candidates?.[0];
  const finishReason = firstCandidate?.finishReason;
  if (finishReason && typeof finishReason === 'string') {
    const normalized = finishReason.toUpperCase();
    if (EXPLICIT_REFUSAL_FINISH_REASONS.has(normalized)) {
      return {
        kind: 'PROVIDER_REFUSAL',
        reason: normalized,
      };
    }
  }

  // 3. Inspect text content
  const rawText = typeof res.text === 'string' ? res.text : '';
  const trimmed = rawText.trim();
  if (trimmed.length > 0) {
    return {
      kind: 'CONTENT',
      text: rawText,
    };
  }

  return { kind: 'EMPTY_PROVIDER_RESPONSE' };
}

export class ProviderRefusalError extends Error {
  readonly code = 'PROVIDER_REFUSAL';
  readonly reason?: string;
  constructor(reason?: string) {
    super('AI provider declined turn generation');
    this.name = 'ProviderRefusalError';
    this.reason = reason;
  }
}

export class EmptyProviderResponseError extends Error {
  readonly code = 'EMPTY_PROVIDER_RESPONSE';
  constructor() {
    super('AI provider returned an empty response');
    this.name = 'EmptyProviderResponseError';
  }
}

export class ProviderRequestRejectedError extends Error {
  readonly code = 'PROVIDER_REQUEST_REJECTED';
  readonly providerStatus: number;

  constructor(providerStatus: number) {
    super('AI provider rejected the turn generation request');
    this.name = 'ProviderRequestRejectedError';
    this.providerStatus = providerStatus;
  }
}

export class ProviderPrepaymentDepletedError extends Error {
  readonly code = 'PREPAYMENT_DEPLETED';
  constructor(message?: string) {
    super(
      message ||
        'Your Google AI Studio prepayment credits are depleted. Switch to an unpaid Free Tier project key or add credits in AI Studio.'
    );
    this.name = 'ProviderPrepaymentDepletedError';
  }
}

export class ProviderRateLimitError extends Error {
  readonly code = 'RATE_LIMIT_EXCEEDED';
  constructor(message?: string) {
    super(
      message ||
        'AI provider rate limit reached (15 RPM on Free Tier). Please wait a few seconds before retrying.'
    );
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderCapacityError extends Error {
  readonly code = 'PROVIDER_HIGH_DEMAND';
  constructor(message?: string) {
    super(
      message ||
        'AI model is currently experiencing high demand. Please try again in a few moments.'
    );
    this.name = 'ProviderCapacityError';
  }
}

export function readProviderStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const directStatus = (error as { status?: unknown }).status;
  if (typeof directStatus === 'number' && Number.isInteger(directStatus)) {
    return directStatus;
  }

  const responseStatus = (error as { response?: { status?: unknown } }).response?.status;
  return typeof responseStatus === 'number' && Number.isInteger(responseStatus)
    ? responseStatus
    : null;
}

export function readProviderErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const directMsg = (error as { message?: unknown }).message;
    if (typeof directMsg === 'string') return directMsg;
    const errObj = (error as { error?: { message?: unknown } }).error;
    if (errObj && typeof errObj === 'object' && typeof errObj.message === 'string') {
      return errObj.message;
    }
  }
  return String(error);
}

export function isPrepaymentDepletedError(error: unknown): boolean {
  const status = readProviderStatus(error);
  const msg = readProviderErrorMessage(error).toLowerCase();
  return status === 429 && (msg.includes('credits are depleted') || msg.includes('prepayment') || msg.includes('billing#prepay'));
}

export function isTransientProviderError(error: unknown): boolean {
  if (isPrepaymentDepletedError(error)) return false;
  const status = readProviderStatus(error);
  return status === 503 || status === 429;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeWithRetryAndFallback<R>(
  operation: (modelId: GeminiModelId) => Promise<R>,
  initialModelId: GeminiModelId,
  maxRetries = 3
): Promise<R> {
  let currentModel = initialModelId;
  let attempt = 0;
  let hasAttemptedFallback = false;
  let retryCount = 0;
  while (retryCount < maxRetries * 2) {
    retryCount++;
    attempt++;
    try {
      return await operation(currentModel);
    } catch (error: unknown) {
      if (isPrepaymentDepletedError(error)) {
        throw new ProviderPrepaymentDepletedError(readProviderErrorMessage(error));
      }

      const providerStatus = readProviderStatus(error);
      if (providerStatus === 400) {
        throw new ProviderRequestRejectedError(providerStatus);
      }

      const isTransient = isTransientProviderError(error);
      if (!isTransient || attempt >= maxRetries) {
        // Model unavailable (404) or persistent capacity spike (503/429): try fallback model if available
        if ((providerStatus === 503 || providerStatus === 429 || providerStatus === 404) && !hasAttemptedFallback) {
          const fallbackModel = getFallbackModelId(currentModel);
          if (fallbackModel !== currentModel) {
            console.warn(`[AI Client] Model ${currentModel} returned ${providerStatus}. Attempting fallback to ${fallbackModel}...`);
            currentModel = fallbackModel;
            hasAttemptedFallback = true;
            attempt = 0;
            await sleep(500);
            continue;
          }
        }

        if (providerStatus === 503) {
          throw new ProviderCapacityError(readProviderErrorMessage(error));
        }
        if (providerStatus === 429) {
          throw new ProviderRateLimitError(readProviderErrorMessage(error));
        }
        throw error;
      }

      const backoffMs = Math.min(1000 * Math.pow(1.5, attempt - 1), 4000) + Math.random() * 200;
      console.warn(`[AI Client] Transient provider error (${providerStatus}). Retrying attempt ${attempt + 1}/${maxRetries} in ${Math.round(backoffMs)}ms...`);
      await sleep(backoffMs);
    }
  }
}

export function extractBalancedJson(text: string): string | null {
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');

  let startChar: '{' | '[';
  let endChar: '}' | ']';
  let startIndex = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startChar = '{';
    endChar = '}';
    startIndex = firstBrace;
  } else if (firstBracket !== -1) {
    startChar = '[';
    endChar = ']';
    startIndex = firstBracket;
  } else {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === startChar) {
      depth++;
    } else if (char === endChar) {
      depth--;
      if (depth === 0) {
        return text.substring(startIndex, i + 1).trim();
      }
    }
  }

  return null;
}

export function unwrapStrictJsonResponse(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  // 1. Direct JSON parse test
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Fall through to code fence extraction
  }

  // 2. Code fence extraction (```json ... ``` or ``` ... ```)
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(trimmed)) !== null) {
    const candidate = match[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      const extracted = extractBalancedJson(candidate);
      if (extracted) {
        try {
          JSON.parse(extracted);
          return extracted;
        } catch {
          // Fall through to balanced JSON extraction
        }
      }
    }
  }

  // 3. Extract balanced JSON from the raw text
  const extracted = extractBalancedJson(trimmed);
  if (extracted) {
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      return extracted;
    }
  }

  // 4. Fallback: simple strip of starting/ending fences
  const simpleFence = trimmed.match(/^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i);
  return simpleFence ? simpleFence[1].trim() : trimmed;
}

/**
 * Paired contract interface linking the Gemini JSON Schema sent to generateContent()
 * with the authoritative Zod schema used to parse and validate the returned response.
 */
export interface StructuredResponseContract<T> {
  name: string;
  responseJsonSchema: GeminiJsonSchema;
  normalizeProviderPayload: (payload: unknown, context?: CastNormalizationContext) => unknown;
  normalizationContext?: CastNormalizationContext;
  zodSchema: z.ZodType<T>;
}

export const EngineTurnStructuredResponseContract: StructuredResponseContract<TurnResult> = {
  name: 'ENGINE_TURN',
  responseJsonSchema: geminiTurnResponseJsonSchema,
  normalizeProviderPayload: normalizeGeminiTurnProviderPayload,
  zodSchema: TurnResultSchema,
};

/**
 * Pure parsing and Zod validation boundary extracted for testability and deterministic validation.
 */
export function parseStructuredTurnResponse<T>(
  rawText: string,
  zodSchema: z.ZodType<T>,
  normalizeProviderPayload: (payload: unknown) => unknown = (payload) => payload
): T {
  const unwrapped = unwrapStrictJsonResponse(rawText);
  if (!unwrapped) {
    throw new EmptyProviderResponseError();
  }
  let parsed: unknown;
  try {
    parsed = parseOrRepairJson(unwrapped);
  } catch (parseErr) {
    console.error('[API /turn] Model JSON parse failure:', parseErr, '\nRaw text preview:', unwrapped.slice(0, 300));
    throw parseErr;
  }
  return zodSchema.parse(normalizeProviderPayload(parsed));
}

async function generateSingleStructuredAttempt<T>(
  prompt: string,
  contract: StructuredResponseContract<T>
): Promise<T> {
  // Wrap normalizer with normalizationContext if present
  const normalizeProviderPayload = contract.normalizationContext
    ? (payload: unknown) =>
        contract.normalizeProviderPayload(payload, contract.normalizationContext)
    : contract.normalizeProviderPayload;

  const effectiveContract: StructuredResponseContract<T> = contract.normalizationContext
    ? { ...contract, normalizeProviderPayload }
    : contract;

  if (getEngineProvider() === 'local') {
    return await generateLocalStructuredResponse(prompt, effectiveContract, { maxTokens: 16384 });
  }
  if (getEngineProvider() === 'zai') {
    return await generateZaiStructuredResponse(prompt, effectiveContract);
  }
  if (getEngineProvider() === 'hemmingway') {
    return await generateHemmingwayStructuredResponse(prompt, effectiveContract);
  }

  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const policy = getGeminiPolicy('ENGINE_TURN');

  const response = await executeWithRetryAndFallback(
    async (modelToUse) => {
      return await getAiClient().models.generateContent({
        model: modelToUse,
        contents,
        config: {
          thinkingConfig: {
            thinkingLevel: policy.thinkingLevel,
          },
          responseMimeType: 'application/json',
          responseJsonSchema: effectiveContract.responseJsonSchema,
        },
      });
    },
    policy.model
  );

  const classification = classifyProviderResponse(response);
  if (classification.kind === 'PROVIDER_REFUSAL') {
    throw new ProviderRefusalError(classification.reason);
  }
  if (classification.kind === 'EMPTY_PROVIDER_RESPONSE') {
    throw new EmptyProviderResponseError();
  }

  return parseStructuredTurnResponse(
    classification.text,
    effectiveContract.zodSchema,
    effectiveContract.normalizeProviderPayload
  );
}

export const generateStructuredResponse = async <T>(
  prompt: string,
  contract: StructuredResponseContract<T>
): Promise<T> => {
  const maxAttempts = 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await generateSingleStructuredAttempt(prompt, contract);
    } catch (err: unknown) {
      lastError = err;
      const isEnvelopeFailure =
        err instanceof z.ZodError ||
        (err as { name?: string })?.name === 'ZodError' ||
        err instanceof SyntaxError;

      // Only retry envelope or syntax failures on attempt 1.
      // Provider refusals, rate limits, prepayment depletion, and network errors fail immediately.
      if (isEnvelopeFailure && attempt < maxAttempts) {
        if (
          err instanceof z.ZodError ||
          (err as { name?: string })?.name === 'ZodError'
        ) {
          console.error(
            '[AI Client] Envelope validation issues:',
            JSON.stringify(
              (err as z.ZodError).issues
                .slice(0, 25)
                .map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
            )
          );
        }
        console.warn(
          `[AI Client] Envelope validation failed (${(err as Error).name || 'SyntaxError'}). Retrying fresh generation (attempt ${attempt + 1}/${maxAttempts})...`
        );
        continue;
      }
      throw err;
    }
  }
  throw lastError;
};

export interface AiPingResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  status?: number;
  code?: string;
  message?: string;
}

export async function pingAiProvider(): Promise<AiPingResult> {
  const policy = getGeminiPolicy('ENGINE_TURN');
  const start = Date.now();
  try {
    const client = getAiClient();
    await client.models.generateContent({
      model: policy.model,
      contents: [{ role: 'user', parts: [{ text: 'Respond with OK.' }] }],
    });
    return {
      ok: true,
      model: policy.model,
      latencyMs: Date.now() - start,
    };
  } catch (error: unknown) {
    const status = readProviderStatus(error);
    const message = readProviderErrorMessage(error);
    let code = 'PROVIDER_FAILURE';
    if (isPrepaymentDepletedError(error)) {
      code = 'PREPAYMENT_DEPLETED';
    } else if (status === 429) {
      code = 'RATE_LIMIT_EXCEEDED';
    } else if (status === 503) {
      code = 'PROVIDER_HIGH_DEMAND';
    } else if (status === 400) {
      code = 'INVALID_API_KEY';
    }
    return {
      ok: false,
      model: policy.model,
      latencyMs: Date.now() - start,
      status: status || 502,
      code,
      message,
    };
  }
}
