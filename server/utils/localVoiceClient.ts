import type { Attachment } from '../../src/types';
import {
  getLocalAutopilotModel,
  getLocalEngineModel,
  getLocalForgeModel,
  getLocalVoiceBaseUrl,
  getLocalVoiceModel,
  type VoiceProvider,
} from '../ai/voiceProviderPolicy';
import type { VoiceHistoryMessage } from './openaiVoiceClient';
import type { StructuredResponseContract } from './aiClient';
import { parseStructuredTurnResponse, EmptyProviderResponseError } from './aiClient';
import { parseOrRepairJson } from './jsonRepair';
import { computeEffectiveMaxTokens, getModelCapability } from '../ai/localModelCapabilities';
import {
  GEMINI_TURN_NULL_SENTINEL,
  normalizePerceptionPath,
  normalizePressureOperator,
  normalizeAffectedDimension,
  normalizePersistenceTarget,
  type CastNormalizationContext,
} from '../ai/geminiTurnTransport';
import { isRecognizedAmbientSpeaker } from '../../src/lib/vocalizationEngine';

type LocalContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
type LocalMessageContent = string | LocalContentPart[];

type LocalChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: LocalMessageContent;
};

export class LocalVoiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = 'LocalVoiceError';
    this.code = code;
    this.status = status;
  }
}

function isAllowedLocalOrTunnelHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h === '::1' ||
    h === '[::1]' ||
    h.startsWith('127.')
  ) {
    return true;
  }

  // Allow secure tunnel services
  if (
    h.endsWith('.ngrok-free.app') ||
    h.endsWith('.ngrok.io') ||
    h.endsWith('.ngrok.app') ||
    h.endsWith('.trycloudflare.com') ||
    h.endsWith('.loca.lt') ||
    h.endsWith('.tailscale.net')
  ) {
    return true;
  }

  // Cloud environments (Render) or explicit opt-in
  if (process.env.ALLOW_REMOTE_AI_URL === 'true' || process.env.RENDER === 'true') {
    return true;
  }

  return false;
}

export function normalizeLocalBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new LocalVoiceError('LOCAL_URL_INVALID', 'Enter a valid server URL.', 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new LocalVoiceError(
      'LOCAL_URL_INVALID',
      'The API server URL must use http:// or https://.',
      400
    );
  }

  if (!isAllowedLocalOrTunnelHost(parsed.hostname)) {
    throw new LocalVoiceError(
      'LOCAL_URL_INVALID',
      'The Local provider must use a local endpoint (127.0.0.1 / localhost) or a supported tunnel (ngrok, Cloudflare, localtunnel).',
      400
    );
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  if (!path || path === '') {
    return `${parsed.origin}/v1`;
  }
  if (path.endsWith('/v1')) {
    return `${parsed.origin}${path}`;
  }
  return `${parsed.origin}${path}/v1`;
}

export function localHeaders(
  baseUrlOrExtra?: string | Record<string, string>,
  maybeExtra?: Record<string, string>
): Record<string, string> {
  let baseUrl: string | undefined;
  let extra: Record<string, string> = {};

  if (typeof baseUrlOrExtra === 'string') {
    baseUrl = baseUrlOrExtra;
    extra = maybeExtra || {};
  } else if (baseUrlOrExtra && typeof baseUrlOrExtra === 'object') {
    extra = baseUrlOrExtra;
  }

  const headers: Record<string, string> = { ...extra };
  if (baseUrl && typeof baseUrl === 'string' && baseUrl.toLowerCase().includes('ngrok')) {
    headers['ngrok-skip-browser-warning'] = 'true';
  }
  return headers;
}

function localUrl(baseUrl: string, resource: 'models' | 'chat/completions'): string {
  return `${normalizeLocalBaseUrl(baseUrl)}/${resource}`;
}

function decodeTextAttachment(attachment: Attachment): string {
  const text = Buffer.from(attachment.data, 'base64').toString('utf8');
  return `\n\n--- ATTACHED FILE: ${attachment.name} ---\n${text}\n--- END ATTACHED FILE ---`;
}

function toLocalMessage(message: VoiceHistoryMessage): LocalChatMessage {
  const role =
    message.role === 'assistant' || message.role === 'voice' || message.role === 'model'
      ? 'assistant'
      : 'user';
  const text =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');

  if (role === 'assistant' || !message.attachments?.length) {
    return { role, content: text.trim() || '...' };
  }

  const content: LocalContentPart[] = [
    { type: 'text', text: text.trim() || 'Please inspect the attached material.' },
  ];

  for (const attachment of message.attachments) {
    if (attachment.mimeType.startsWith('image/')) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
      });
    } else if (
      attachment.mimeType.startsWith('text/') ||
      attachment.mimeType === 'application/json' ||
      attachment.name.endsWith('.md') ||
      attachment.name.endsWith('.json')
    ) {
      content.push({ type: 'text', text: decodeTextAttachment(attachment) });
    } else {
      content.push({
        type: 'text',
        text: `[Attached ${attachment.name} is not directly supported by the Local provider. Provide extracted text or an image instead.]`,
      });
    }
  }

  return { role, content };
}

export function buildLocalVoiceMessages(
  instructions: string,
  history: VoiceHistoryMessage[]
): LocalChatMessage[] {
  const recent = history.slice(-20);
  const firstUserIndex = recent.findIndex((message) => message.role === 'user');
  const relevant = firstUserIndex >= 0 ? recent.slice(firstUserIndex) : [];
  const messages: LocalChatMessage[] = [{ role: 'system', content: instructions }];

  for (const message of relevant) messages.push(toLocalMessage(message));
  if (messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: 'Proceed.' });
  }
  return messages;
}

export async function discoverLocalVoiceModels(
  baseUrl = getLocalVoiceBaseUrl()
): Promise<string[]> {
  let response: Response;
  try {
    const reqHeaders = localHeaders(baseUrl);
    const fetchOptions: RequestInit = { signal: AbortSignal.timeout(15_000) };
    if (Object.keys(reqHeaders).length > 0) {
      fetchOptions.headers = reqHeaders;
    }
    response = await fetch(localUrl(baseUrl, 'models'), fetchOptions);
  } catch (error: unknown) {
    if (error instanceof LocalVoiceError) throw error;
    throw new LocalVoiceError(
      'LOCAL_SERVER_UNAVAILABLE',
      'Could not reach the Local provider. Start its API server and verify the URL.',
      502
    );
  }

  if (!response.ok) {
    throw new LocalVoiceError(
      'LOCAL_SERVER_UNAVAILABLE',
      'The Local provider did not accept model discovery.',
      response.status
    );
  }

  const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const models = (payload.data || [])
    .map((entry) => (typeof entry.id === 'string' ? entry.id.trim() : ''))
    .filter(Boolean);
  if (models.length === 0) {
    throw new LocalVoiceError(
      'LOCAL_MODEL_NOT_FOUND',
      'The Local provider did not report any loaded models.',
      502
    );
  }
  return models;
}

function chooseLocalVoiceModel(models: string[], configuredModel: string): string {
  if (configuredModel) {
    if (!models.includes(configuredModel)) {
      throw new LocalVoiceError(
        'LOCAL_MODEL_NOT_FOUND',
        `The Local provider is not serving "${configuredModel}". Discover its available models and choose one.`,
        400
      );
    }
    return configuredModel;
  }

  return (
    models.find((model) => /gemma-4-26b-a4b-qat/i.test(model)) ??
    models.find((model) => /gemma-4-26b/i.test(model)) ??
    models.find((model) => /qwen3\.8-27b/i.test(model)) ??
    models[0]
  );
}

function salvageActionFromReasoning(reasoning: string): string {
  const markers = ['final draft:', 'final choice:', 'final polish:', 'final answer:', 'answer:'];
  const lowered = reasoning.toLowerCase();
  let start = -1;
  let markerLen = 0;
  for (const m of markers) {
    const idx = lowered.lastIndexOf(m);
    if (idx !== -1 && idx >= start) {
      start = idx;
      markerLen = m.length;
    }
  }
  let candidate = (start === -1 ? reasoning.slice(-1000) : reasoning.slice(start + markerLen)).trim();
  const cutAt = Math.max(candidate.lastIndexOf('.'), candidate.lastIndexOf('!'), candidate.lastIndexOf('?'));
  if (cutAt > 0) {
    let end = cutAt + 1;
    while (end < candidate.length && ['"', "'", '“', '”'].includes(candidate[end])) end++;
    candidate = candidate.slice(0, end).trim();
  } else if (start === -1) {
    return '';
  }
  candidate = candidate.replace(/^[\s*\-–—>]+/, '').trim();
  if (!/[a-zA-Z]/.test(candidate)) return '';
  return candidate;
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
        reasoning?: unknown;
      };
    }>;
  }).choices?.[0];
  const content = choice?.message?.content;
  const expectJson = options.expectJson !== false;

  if (typeof content === 'string' && content.trim()) {
    if (expectJson && choice?.finish_reason === 'length' && (content.trim() === '{' || content.trim().length < 5)) {
      const reasoning =
        (typeof choice?.message?.reasoning_content === 'string' && choice.message.reasoning_content.trim()) ||
        (typeof choice?.message?.reasoning === 'string' && choice.message.reasoning.trim());
      throw new LocalVoiceError(
        'EMPTY_PROVIDER_RESPONSE',
        reasoning
          ? "The Local model exhausted its token budget during reasoning before generating an answer. Increase max_tokens or disable reasoning in LM Studio."
          : 'The Local provider reached its token limit before completing the response.'
      );
    }
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === 'object' && part && 'text' in part ? String(part.text ?? '') : ''
      )
      .filter(Boolean)
      .join('\n');
    if (text.trim()) return text.trim();
  }

  // Fallback: Check if reasoning_content contains the answer / JSON block
  const reasoning =
    (typeof choice?.message?.reasoning_content === 'string' && choice.message.reasoning_content.trim()) ||
    (typeof choice?.message?.reasoning === 'string' && choice.message.reasoning.trim());

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
    } else {
      const withoutThink = reasoning.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (withoutThink && choice?.finish_reason !== 'length') {
        return withoutThink;
      }
      if (withoutThink && choice?.finish_reason === 'length') {
        const salvaged = salvageActionFromReasoning(withoutThink);
        if (salvaged) return salvaged;
      }
    }
  }

  throw new LocalVoiceError(
    'EMPTY_PROVIDER_RESPONSE',
    reasoning
      ? "The Local model exhausted its reasoning budget or context window before generating the structured answer. In LM Studio, reduce parallel prediction slots (--parallel 1) or increase context length to ensure sufficient generation headroom."
      : 'The Local provider returned an empty response.'
  );
}

export async function generateLocalVoice({
  instructions,
  history,
}: {
  instructions: string;
  history: VoiceHistoryMessage[];
}): Promise<{ text: string; model: string; provider: VoiceProvider }> {
  const baseUrl = getLocalVoiceBaseUrl();
  const model = chooseLocalVoiceModel(
    await discoverLocalVoiceModels(baseUrl),
    getLocalVoiceModel()
  );

  let response: Response;
  try {
    response = await fetch(localUrl(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: localHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model,
        messages: buildLocalVoiceMessages(instructions, history),
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new LocalVoiceError(
      'LOCAL_SERVER_UNAVAILABLE',
      'The Local provider became unavailable before The Voice received a response.',
      502
    );
  }

  if (!response.ok) {
    throw new LocalVoiceError(
      'LOCAL_PROVIDER_FAILURE',
      'The Local provider rejected The Voice request.',
      response.status
    );
  }
  return { text: readCompletionText(await response.json(), { expectJson: false }), model, provider: 'local' };
}

export function cleanSimulatedAction(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();

  // Strip <think>...</think> reasoning blocks if emitted by reasoning models
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip markdown code fences if wrapped or trailing
  const codeBlockMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  } else {
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
  }

  // Iteratively strip speaker prefixes and enclosing quotation marks
  for (let i = 0; i < 3; i++) {
    const prev = text;
    text = text.replace(/^(?:the\s+)?(?:player|me|action|user)\s*:\s*/i, '').trim();
    if (
      (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
      (text.startsWith("'") && text.endsWith("'") && text.length >= 2) ||
      (text.startsWith('“') && text.endsWith('”') && text.length >= 2)
    ) {
      text = text.slice(1, -1).trim();
    }
    if (text === prev) break;
  }

  if (text.includes('\\"') || text.includes("\\'")) {
    text = text.replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  const trimmed = text.trim();

  // Detect and reject catatonic / placeholder / prompt echo outputs
  const CATATONIC_PATTERN = /^(?:none|n\/a|tbd|todo|placeholder|no\s*action|i\s+(?:wait|hesitate|freeze|pause|do\s+nothing))\.?\s*$/i;
  const ECHO_PATTERN = /^\[(?:USER_ACTION|REASONING CONSTRAINT|DIRECTIVE|ROLE DIRECTIVE)[\s\S]*\]$/i;

  if (CATATONIC_PATTERN.test(trimmed) || ECHO_PATTERN.test(trimmed)) {
    return '';
  }

  // Reject paired spectator loops like "I observe and wait"
  const SPECTATOR_LOOP = /^(?:I\s+)?(?:observe|watch|monitor|scan|wait|glide|descend|float|hover)\s+(?:and|then)\s+(?:wait|observe|watch|monitor|scan|glide|descend|float|hover)\.?$/i;
  if (SPECTATOR_LOOP.test(trimmed)) {
    return '';
  }

  // Rejects ONLY observation/inaction as the entire action without coordination.
  // Compound actions ("I scan the corridor, then advance to the airlock", "I observe X and wedge Y") are preserved.
  const isCompound = /[,;]|\b(?:then|and|before|after|while)\b/i.test(trimmed);
  if (!isCompound) {
    const SPECTATOR_START = /^(?:I\s+)?(?:continue\s+to\s+)?(?:observe|watch|monitor|scan|wait|glide|descend|float|hover)\b/i;
    if (SPECTATOR_START.test(trimmed)) {
      return '';
    }
  }

  return trimmed;
}

export async function generateLocalPlayerAction(
  prompt: string,
  options: { baseUrl?: string; model?: string } = {}
): Promise<string> {
  const baseUrl = options.baseUrl ?? getLocalVoiceBaseUrl();
  const models = await discoverLocalVoiceModels(baseUrl);
  const model = chooseLocalVoiceModel(models, options.model ?? getLocalAutopilotModel());
  const actionPrompt = `[REASONING CONSTRAINT: Limit internal reasoning to under 80 tokens. Output ONLY the player's immediate action or dialogue, with no reasoning, commentary, or markdown fences.]\n\n${prompt}`;

  let response: Response;
  try {
    response = await fetch(localUrl(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: actionPrompt }],
        temperature: 0.7,
        max_tokens: 4096,
        max_completion_tokens: 4096,
        chat_template_kwargs: { enable_thinking: false, thinking: false },
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error: unknown) {
    if (error instanceof LocalVoiceError) throw error;
    throw new LocalVoiceError(
      'LOCAL_SERVER_UNAVAILABLE',
      'The Local provider became unavailable before player action generation completed.',
      502
    );
  }

  if (!response.ok) {
    throw new LocalVoiceError(
      'LOCAL_PROVIDER_FAILURE',
      'The Local provider rejected the player action simulation request.',
      response.status
    );
  }

  const payload = await response.json();
  const rawAction = readCompletionText(payload, { expectJson: false });
  const cleaned = cleanSimulatedAction(rawAction);
  if (!cleaned) {
    throw new LocalVoiceError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Local provider returned an empty player action.',
      502
    );
  }
  return cleaned;
}

export function normalizeLocalTurnPayload(
  payload: unknown,
  baseNormalizer?: (p: unknown, ctx?: CastNormalizationContext) => unknown,
  context?: CastNormalizationContext
): unknown {
  const rawObj =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const rawAct =
    rawObj?.cast_activity_proposal &&
    typeof rawObj.cast_activity_proposal === 'object' &&
    !Array.isArray(rawObj.cast_activity_proposal)
      ? (rawObj.cast_activity_proposal as Record<string, unknown>)
      : null;
  const rawPress =
    rawObj?.situated_pressure_proposal &&
    typeof rawObj.situated_pressure_proposal === 'object' &&
    !Array.isArray(rawObj.situated_pressure_proposal)
      ? (rawObj.situated_pressure_proposal as Record<string, unknown>)
      : null;

  const normalized = baseNormalizer ? baseNormalizer(payload, context) : payload;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return normalized;
  }

  const record = { ...(normalized as Record<string, unknown>) };

  // 1. Repair cast_activity_proposal
  if (
    record.cast_activity_proposal &&
    typeof record.cast_activity_proposal === 'object' &&
    !Array.isArray(record.cast_activity_proposal)
  ) {
    const act = { ...(record.cast_activity_proposal as Record<string, unknown>) };
    if (act.kind === 'ACTIVITY') {
      if (act.manifestationBlock === undefined && act.manifestation_block !== undefined) {
        act.manifestationBlock = act.manifestation_block;
      }
      // Run manifestationBlock dialogue speaker repair FIRST before fallback castMemberId
      if (
        act.manifestationBlock &&
        typeof act.manifestationBlock === 'object' &&
        !Array.isArray(act.manifestationBlock)
      ) {
        const mb = { ...(act.manifestationBlock as Record<string, unknown>) };
        if (mb.type === 'dialogue') {
          const speaker = typeof mb.speaker === 'string' ? mb.speaker.trim() : '';
          if (!speaker) {
            const castMemberId = typeof act.castMemberId === 'string' ? act.castMemberId.trim() : '';
            if (castMemberId) {
              mb.speaker = castMemberId;
            } else {
              mb.type = 'prose';
              delete mb.speaker;
            }
          }
        }
        if (typeof mb.content === 'string') {
          const maxLen = mb.type === 'dialogue' ? 1000 : 2000;
          if (mb.content.length > maxLen) {
            mb.content = mb.content.slice(0, maxLen);
          }
        }
        act.manifestationBlock = mb;
      }

      const propId =
        (typeof act.proposalId === 'string' && act.proposalId.trim()) ||
        (typeof act.proposal_id === 'string' && act.proposal_id.trim()) ||
        (typeof rawAct?.proposal_id === 'string' && rawAct.proposal_id.trim()) ||
        '';
      act.proposalId = propId || 'prop-act-fallback';

      const castId =
        (typeof act.castMemberId === 'string' && act.castMemberId.trim()) ||
        (typeof act.cast_member_id === 'string' && act.cast_member_id.trim()) ||
        (typeof act.characterId === 'string' && act.characterId.trim()) ||
        (typeof act.character_id === 'string' && act.character_id.trim()) ||
        '';
      act.castMemberId = castId || 'UNSPECIFIED_CAST_MEMBER';

      const summary =
        (typeof act.activitySummary === 'string' && act.activitySummary.trim()) ||
        (typeof act.activity_summary === 'string' && act.activity_summary.trim()) ||
        (typeof rawAct?.activity_summary === 'string' && rawAct.activity_summary.trim()) ||
        (typeof rawAct?.summary === 'string' && rawAct.summary.trim()) ||
        '';
      act.activitySummary = (summary || 'Unspecified cast activity.').slice(0, 500);

      const rawPath =
        (typeof act.perceptionPath === 'string' && act.perceptionPath) ||
        (typeof act.perception_path === 'string' && act.perception_path) ||
        (typeof rawAct?.perception_path === 'string' && rawAct.perception_path) ||
        'DIRECT';
      act.perceptionPath = normalizePerceptionPath(rawPath);

      if (act.pursuitId === undefined && act.pursuit_id !== undefined) {
        act.pursuitId = act.pursuit_id;
      }
      if (typeof act.pursuitId === 'string' && !act.pursuitId.trim()) {
        act.pursuitId = null;
      }
      if (act.locationNodeId === undefined && act.location_node_id !== undefined) {
        act.locationNodeId = act.location_node_id;
      }
      if (typeof act.locationNodeId === 'string' && !act.locationNodeId.trim()) {
        act.locationNodeId = null;
      }

      if (act.authorityReferences === undefined && act.authority_references !== undefined) {
        act.authorityReferences = act.authority_references;
      }
      if (Array.isArray(act.authorityReferences)) {
        act.authorityReferences = act.authorityReferences.filter(
          (r): r is string => typeof r === 'string' && r.trim().length > 0
        );
      }

      delete act.reason;
      delete act.proposal_id;
      delete act.cast_member_id;
      delete act.characterId;
      delete act.character_id;
      delete act.pursuit_id;
      delete act.location_node_id;
      delete act.perception_path;
      delete act.activity_summary;
      delete act.authority_references;
      delete act.manifestation_block;

      record.cast_activity_proposal = act;
    } else if (act.kind === 'NONE') {
      if (typeof act.reason === 'string' && act.reason.length > 200) {
        act.reason = act.reason.slice(0, 200);
      }
      record.cast_activity_proposal = act;
    }
  }

  // 2. Repair situated_pressure_proposal
  if (
    record.situated_pressure_proposal &&
    typeof record.situated_pressure_proposal === 'object' &&
    !Array.isArray(record.situated_pressure_proposal)
  ) {
    const press = { ...(record.situated_pressure_proposal as Record<string, unknown>) };
    if (press.kind === 'PRESSURE') {
      const sourceRef =
        (typeof press.sourceReference === 'string' && press.sourceReference.trim()) ||
        (typeof press.source_reference === 'string' && press.source_reference.trim()) ||
        (typeof rawPress?.source_reference === 'string' && rawPress.source_reference.trim()) ||
        '';
      if (!sourceRef) {
        const act = record.cast_activity_proposal as Record<string, unknown> | undefined;
        if (act && act.kind === 'ACTIVITY') {
          press.sourceReference = 'ACTIVITY';
        } else if (
          Array.isArray(press.authorityReferences) &&
          typeof press.authorityReferences[0] === 'string' &&
          press.authorityReferences[0].trim()
        ) {
          press.sourceReference = press.authorityReferences[0].trim();
        } else if (
          Array.isArray(press.authority_references) &&
          typeof press.authority_references[0] === 'string' &&
          press.authority_references[0].trim()
        ) {
          press.sourceReference = press.authority_references[0].trim();
        } else if (
          Array.isArray(rawPress?.authority_references) &&
          typeof rawPress.authority_references[0] === 'string' &&
          rawPress.authority_references[0].trim()
        ) {
          press.sourceReference = rawPress.authority_references[0].trim();
        } else {
          press.sourceReference = 'BASELINE';
        }
      } else {
        press.sourceReference = sourceRef;
      }

      if (press.manifestationBlock === undefined && press.manifestation_block !== undefined) {
        press.manifestationBlock = press.manifestation_block;
      }
      if (
        press.manifestationBlock &&
        typeof press.manifestationBlock === 'object' &&
        !Array.isArray(press.manifestationBlock)
      ) {
        const mb = { ...(press.manifestationBlock as Record<string, unknown>) };
        if (mb.type === 'dialogue') {
          const speaker = typeof mb.speaker === 'string' ? mb.speaker.trim() : '';
          if (!speaker) {
            mb.type = 'prose';
            delete mb.speaker;
          }
        }
        if (typeof mb.content === 'string') {
          const maxLen = mb.type === 'dialogue' ? 1000 : 2000;
          if (mb.content.length > maxLen) {
            mb.content = mb.content.slice(0, maxLen);
          }
        }
        press.manifestationBlock = mb;
      }

      const propId =
        (typeof press.proposalId === 'string' && press.proposalId.trim()) ||
        (typeof press.proposal_id === 'string' && press.proposal_id.trim()) ||
        (typeof rawPress?.proposal_id === 'string' && rawPress.proposal_id.trim()) ||
        '';
      press.proposalId = propId || 'prop-press-fallback';

      let anchorId =
        (typeof press.valueAnchorId === 'string' && press.valueAnchorId.trim()) ||
        (typeof press.value_anchor_id === 'string' && press.value_anchor_id.trim()) ||
        (typeof rawPress?.value_anchor_id === 'string' && rawPress.value_anchor_id.trim()) ||
        (typeof press.anchorId === 'string' && press.anchorId.trim()) ||
        (typeof rawPress?.anchorId === 'string' && rawPress.anchorId.trim()) ||
        (typeof press.anchor_id === 'string' && press.anchor_id.trim()) ||
        (typeof rawPress?.anchor_id === 'string' && rawPress.anchor_id.trim()) ||
        '';
      if (
        !anchorId &&
        context?.relevantValueAnchorIds &&
        context.relevantValueAnchorIds.length === 1
      ) {
        anchorId = context.relevantValueAnchorIds[0];
      }
      press.valueAnchorId = anchorId || 'UNSPECIFIED_ANCHOR';

      const rawOp =
        (typeof press.operator === 'string' && press.operator) ||
        (typeof rawPress?.operator === 'string' && rawPress.operator) ||
        'OTHER';
      press.operator = normalizePressureOperator(rawOp);

      const rawDim =
        (typeof press.affectedDimension === 'string' && press.affectedDimension) ||
        (typeof press.affected_dimension === 'string' && press.affected_dimension) ||
        (typeof rawPress?.affected_dimension === 'string' && rawPress.affected_dimension) ||
        'OTHER';
      press.affectedDimension = normalizeAffectedDimension(rawDim);

      const rawPersist =
        press.persistenceTarget !== undefined
          ? press.persistenceTarget
          : press.persistence_target !== undefined
            ? press.persistence_target
            : rawPress?.persistence_target;
      if (typeof rawPersist === 'string' && rawPersist.trim().length > 0) {
        press.persistenceTarget = normalizePersistenceTarget(rawPersist);
      } else if ('persistenceTarget' in press) {
        delete press.persistenceTarget;
      }

      if (press.responseWindowOpen === undefined && press.response_window_open !== undefined) {
        press.responseWindowOpen = press.response_window_open;
      }

      const prospect =
        (typeof press.adverseProspect === 'string' && press.adverseProspect.trim()) ||
        (typeof press.adverse_prospect === 'string' && press.adverse_prospect.trim()) ||
        (typeof rawPress?.adverse_prospect === 'string' && rawPress.adverse_prospect.trim()) ||
        '';
      press.adverseProspect = (prospect || 'Immediate situational pressure escalates.').slice(
        0,
        500
      );

      if (press.authorityReferences === undefined && press.authority_references !== undefined) {
        press.authorityReferences = press.authority_references;
      }
      if (Array.isArray(press.authorityReferences)) {
        press.authorityReferences = press.authorityReferences.filter(
          (r): r is string => typeof r === 'string' && r.trim().length > 0
        );
      }

      delete press.reason;
      delete press.proposal_id;
      delete press.value_anchor_id;
      delete press.anchorId;
      delete press.anchor_id;
      delete press.source_reference;
      delete press.affected_dimension;
      delete press.adverse_prospect;
      delete press.authority_references;
      delete press.persistence_target;
      delete press.response_window_open;
      delete press.manifestation_block;

      record.situated_pressure_proposal = press;
    } else if (press.kind === 'NONE') {
      if (typeof press.reason === 'string' && press.reason.length > 200) {
        press.reason = press.reason.slice(0, 200);
      }
      record.situated_pressure_proposal = press;
    }
  }

  // 3. Local Vocalization Repair for narrative_blocks
  if (Array.isArray(record.narrative_blocks)) {
    let dialogueCount = 0;
    const playerCharIdLower = context?.playerCharacterId?.trim().toLowerCase() || '';
    const playerCharNameLower = context?.playerCharacterName?.trim().toLowerCase() || '';
    const authorizedSet = context?.authorizedSpeakerNames
      ? new Set(context.authorizedSpeakerNames.map((n) => n.trim().toLowerCase()).filter(Boolean))
      : null;

    record.narrative_blocks = record.narrative_blocks
      .filter((b): b is Record<string, unknown> =>
        Boolean(b && typeof b === 'object' && !Array.isArray(b))
      )
      .map((b) => {
        const block = { ...b };
        if (block.type === 'dialogue') {
          const speaker = typeof block.speaker === 'string' ? block.speaker.trim() : '';
          const speakerLower = speaker.toLowerCase();
          if (!speaker) {
            return { ...block, type: 'prose', speaker: null };
          }

          const isPlayerSpeaker =
            Boolean(playerCharIdLower && speakerLower === playerCharIdLower) ||
            Boolean(playerCharNameLower && speakerLower === playerCharNameLower);

          if (isPlayerSpeaker) {
            if (!context?.isSystemInit && !context?.isSolitary && block.delivery !== 'mutter') {
              return { ...block, type: 'prose', speaker: null };
            }
          } else if (authorizedSet) {
            const isAuthorized =
              authorizedSet.has(speakerLower) || isRecognizedAmbientSpeaker(speaker);
            if (!isAuthorized) {
              return { ...block, type: 'prose', speaker: null };
            }
          }

          dialogueCount += 1;
          if (dialogueCount > 1) {
            return { ...block, type: 'prose', speaker: null };
          }
        }
        return block;
      })
      .slice(0, 3);
  }

  // 4. Proposal Array & String Bounds Guards
  if (
    record.world_memory_proposal &&
    typeof record.world_memory_proposal === 'object' &&
    !Array.isArray(record.world_memory_proposal)
  ) {
    const wmp = { ...(record.world_memory_proposal as Record<string, unknown>) };
    if (Array.isArray(wmp.candidates)) {
      wmp.candidates = wmp.candidates
        .filter((c): c is Record<string, unknown> =>
          Boolean(c && typeof c === 'object' && !Array.isArray(c))
        )
        .map((c) => {
          const cand = { ...c };
          if (typeof cand.kind === 'string') {
            cand.kind = cand.kind.trim().toUpperCase();
          }
          if (typeof cand.scope === 'string') {
            cand.scope = cand.scope.trim().toUpperCase();
          }
          const rawNodeId =
            typeof cand.node_id === 'string' &&
            cand.node_id.trim().length > 0 &&
            cand.node_id.trim() !== GEMINI_TURN_NULL_SENTINEL &&
            !/^(null|none|nil|n\/a)$/i.test(cand.node_id.trim())
              ? cand.node_id.trim()
              : null;
          if (cand.scope === 'NODE') {
            if (rawNodeId) {
              cand.node_id = rawNodeId.slice(0, 120);
            } else if (context?.currentNodeId && context.currentNodeId.trim().length > 0) {
              cand.node_id = context.currentNodeId.trim().slice(0, 120);
            } else {
              cand.scope = 'GLOBAL';
              cand.node_id = null;
            }
          } else if (cand.scope === 'GLOBAL') {
            cand.node_id = null;
          }
          if (typeof cand.statement === 'string') {
            cand.statement = cand.statement.trim().slice(0, 240).trim();
          }
          if (typeof cand.rationale === 'string') {
            cand.rationale = cand.rationale.trim().slice(0, 240).trim();
          }
          return cand;
        })
        .filter(
          (cand) =>
            typeof cand.statement === 'string' &&
            cand.statement.length > 0 &&
            typeof cand.rationale === 'string' &&
            cand.rationale.length > 0
        )
        .slice(0, 2);
      record.world_memory_proposal = wmp;
    }
  }

  if (
    record.character_memory_proposal &&
    typeof record.character_memory_proposal === 'object' &&
    !Array.isArray(record.character_memory_proposal)
  ) {
    const cmp = { ...(record.character_memory_proposal as Record<string, unknown>) };
    if (Array.isArray(cmp.candidates)) {
      cmp.candidates = cmp.candidates
        .filter((c): c is Record<string, unknown> =>
          Boolean(c && typeof c === 'object' && !Array.isArray(c))
        )
        .map((c) => {
          const cand = { ...c };
          if (typeof cand.character_id === 'string') {
            cand.character_id = cand.character_id.trim().slice(0, 120).trim();
          }
          if (typeof cand.fact === 'string') {
            cand.fact = cand.fact.trim().slice(0, 200).trim();
          }
          if (typeof cand.rationale === 'string') {
            cand.rationale = cand.rationale.trim().slice(0, 240).trim();
          }
          return cand;
        })
        .filter(
          (cand) =>
            typeof cand.character_id === 'string' &&
            cand.character_id.length > 0 &&
            typeof cand.fact === 'string' &&
            cand.fact.length > 0 &&
            typeof cand.rationale === 'string' &&
            cand.rationale.length > 0
        )
        .slice(0, 2);
      record.character_memory_proposal = cmp;
    }
  }

  if (
    record.character_stance_proposal &&
    typeof record.character_stance_proposal === 'object' &&
    !Array.isArray(record.character_stance_proposal)
  ) {
    const csp = { ...(record.character_stance_proposal as Record<string, unknown>) };
    if (Array.isArray(csp.changes)) {
      csp.changes = csp.changes
        .filter((c): c is Record<string, unknown> =>
          Boolean(c && typeof c === 'object' && !Array.isArray(c))
        )
        .map((c) => {
          const chg = { ...c };
          if (typeof chg.character_id === 'string') {
            chg.character_id = chg.character_id.trim().slice(0, 120).trim();
          }
          if (typeof chg.rationale === 'string') {
            chg.rationale = chg.rationale.trim().slice(0, 240).trim();
          }
          return chg;
        })
        .filter(
          (chg) =>
            typeof chg.character_id === 'string' &&
            chg.character_id.length > 0 &&
            typeof chg.rationale === 'string' &&
            chg.rationale.length > 0
        )
        .slice(0, 2);
      record.character_stance_proposal = csp;
    }
  }

  if (
    record.character_relationship_proposal &&
    typeof record.character_relationship_proposal === 'object' &&
    !Array.isArray(record.character_relationship_proposal)
  ) {
    const crp = { ...(record.character_relationship_proposal as Record<string, unknown>) };
    if (Array.isArray(crp.changes)) {
      crp.changes = crp.changes
        .filter((c): c is Record<string, unknown> =>
          Boolean(c && typeof c === 'object' && !Array.isArray(c))
        )
        .map((c) => {
          const chg = { ...c };
          if (typeof chg.source_character_id === 'string') {
            chg.source_character_id = chg.source_character_id.trim().slice(0, 120).trim();
          }
          if (typeof chg.target_character_id === 'string') {
            chg.target_character_id = chg.target_character_id.trim().slice(0, 120).trim();
          }
          if (typeof chg.kind === 'string') {
            chg.kind = chg.kind.trim().toUpperCase();
          }
          if (typeof chg.rationale === 'string') {
            chg.rationale = chg.rationale.trim().slice(0, 240).trim();
          }
          return chg;
        })
        .filter(
          (chg) =>
            typeof chg.source_character_id === 'string' &&
            chg.source_character_id.length > 0 &&
            typeof chg.target_character_id === 'string' &&
            chg.target_character_id.length > 0 &&
            typeof chg.rationale === 'string' &&
            chg.rationale.length > 0 &&
            (chg.delta === -1 || chg.delta === 1)
        )
        .slice(0, 2);
      record.character_relationship_proposal = crp;
    }
  }

  if (
    record.consequence_proposal &&
    typeof record.consequence_proposal === 'object' &&
    !Array.isArray(record.consequence_proposal)
  ) {
    const cp = { ...(record.consequence_proposal as Record<string, unknown>) };
    if (Array.isArray(cp.mutations)) {
      cp.mutations = cp.mutations
        .filter((m): m is Record<string, unknown> =>
          Boolean(m && typeof m === 'object' && !Array.isArray(m))
        )
        .map((m) => {
          const mut = { ...m };
          if (typeof mut.value === 'string') {
            mut.value = mut.value.trim().slice(0, 120).trim();
          }
          if (typeof mut.rationale === 'string') {
            mut.rationale = mut.rationale.trim().slice(0, 240).trim();
          }
          return mut;
        })
        .filter(
          (mut) =>
            typeof mut.value === 'string' &&
            mut.value.length > 0 &&
            typeof mut.rationale === 'string' &&
            mut.rationale.length > 0
        )
        .slice(0, 4);
      record.consequence_proposal = cp;
    }
  }

  if (
    record.value_state_proposal &&
    typeof record.value_state_proposal === 'object' &&
    !Array.isArray(record.value_state_proposal)
  ) {
    const vsp = { ...(record.value_state_proposal as Record<string, unknown>) };
    if (Array.isArray(vsp.changes)) {
      vsp.changes = vsp.changes
        .filter((c): c is Record<string, unknown> =>
          Boolean(c && typeof c === 'object' && !Array.isArray(c))
        )
        .map((c) => {
          const chg = { ...c };
          if (typeof chg.anchorId === 'string') {
            chg.anchorId = chg.anchorId.trim();
          }
          if (typeof chg.proposedFormNote === 'string') {
            chg.proposedFormNote = chg.proposedFormNote.trim().slice(0, 300).trim() || null;
          }
          if (typeof chg.causeReference === 'string') {
            chg.causeReference = chg.causeReference.trim().slice(0, 300).trim();
          }
          if (typeof chg.rationale === 'string') {
            chg.rationale = chg.rationale.trim().slice(0, 300).trim();
          }
          return chg;
        })
        .filter(
          (chg) =>
            typeof chg.anchorId === 'string' &&
            chg.anchorId.length > 0 &&
            typeof chg.causeReference === 'string' &&
            chg.causeReference.length > 0 &&
            typeof chg.rationale === 'string' &&
            chg.rationale.length > 0
        )
        .slice(0, 3);
      record.value_state_proposal = vsp;
    }
  }

  if (
    record.character_pursuit_proposal &&
    typeof record.character_pursuit_proposal === 'object' &&
    !Array.isArray(record.character_pursuit_proposal)
  ) {
    const cpp = { ...(record.character_pursuit_proposal as Record<string, unknown>) };
    if (Array.isArray(cpp.changes)) {
      cpp.changes = cpp.changes
        .filter((c): c is Record<string, unknown> =>
          Boolean(c && typeof c === 'object' && !Array.isArray(c))
        )
        .map((c) => {
          const chg = { ...c };
          if (typeof chg.pursuitId === 'string') {
            chg.pursuitId = chg.pursuitId.trim();
          }
          if (typeof chg.proposedObjective === 'string') {
            const trimmedObj = chg.proposedObjective.trim().slice(0, 300).trim();
            if (trimmedObj) chg.proposedObjective = trimmedObj;
            else delete chg.proposedObjective;
          }
          if (typeof chg.proposedApproach === 'string') {
            const trimmedApp = chg.proposedApproach.trim().slice(0, 300).trim();
            if (trimmedApp) chg.proposedApproach = trimmedApp;
            else delete chg.proposedApproach;
          }
          if (typeof chg.proposedLocationNodeId === 'string') {
            chg.proposedLocationNodeId = chg.proposedLocationNodeId.trim() || null;
          }
          if (typeof chg.progressSummary === 'string') {
            chg.progressSummary = chg.progressSummary.trim().slice(0, 300).trim();
          }
          if (typeof chg.causeReference === 'string') {
            chg.causeReference = chg.causeReference.trim().slice(0, 300).trim();
          }
          if (typeof chg.rationale === 'string') {
            chg.rationale = chg.rationale.trim().slice(0, 300).trim();
          }
          return chg;
        })
        .filter(
          (chg) =>
            typeof chg.pursuitId === 'string' &&
            chg.pursuitId.length > 0 &&
            typeof chg.progressSummary === 'string' &&
            chg.progressSummary.length > 0 &&
            typeof chg.causeReference === 'string' &&
            chg.causeReference.length > 0 &&
            typeof chg.rationale === 'string' &&
            chg.rationale.length > 0
        )
        .slice(0, 2);
      record.character_pursuit_proposal = cpp;
    }
  }

  if (
    record.character_development_proposal &&
    typeof record.character_development_proposal === 'object' &&
    !Array.isArray(record.character_development_proposal)
  ) {
    const cdp = { ...(record.character_development_proposal as Record<string, unknown>) };
    if (Array.isArray(cdp.changes)) {
      cdp.changes = cdp.changes
        .filter((c): c is Record<string, unknown> =>
          Boolean(c && typeof c === 'object' && !Array.isArray(c))
        )
        .map((c) => {
          const chg = { ...c };
          if (typeof chg.castMemberId === 'string') {
            chg.castMemberId = chg.castMemberId.trim();
          }
          if (typeof chg.targetFactId === 'string') {
            chg.targetFactId = chg.targetFactId.trim() || null;
          }
          if (typeof chg.statement === 'string') {
            chg.statement = chg.statement.trim().slice(0, 300).trim();
          }
          if (typeof chg.causeReference === 'string') {
            chg.causeReference = chg.causeReference.trim().slice(0, 300).trim();
          }
          if (typeof chg.rationale === 'string') {
            chg.rationale = chg.rationale.trim().slice(0, 300).trim();
          }
          return chg;
        })
        .filter(
          (chg) =>
            typeof chg.castMemberId === 'string' &&
            chg.castMemberId.length > 0 &&
            typeof chg.statement === 'string' &&
            chg.statement.length > 0 &&
            typeof chg.causeReference === 'string' &&
            chg.causeReference.length > 0 &&
            typeof chg.rationale === 'string' &&
            chg.rationale.length > 0
        )
        .slice(0, 2);
      record.character_development_proposal = cdp;
    }
  }

  if (
    record.pressure_transition_proposal &&
    typeof record.pressure_transition_proposal === 'object' &&
    !Array.isArray(record.pressure_transition_proposal)
  ) {
    const ptp = { ...(record.pressure_transition_proposal as Record<string, unknown>) };
    if (Array.isArray(ptp.transitions)) {
      ptp.transitions = ptp.transitions
        .filter((t): t is Record<string, unknown> =>
          Boolean(t && typeof t === 'object' && !Array.isArray(t))
        )
        .map((t) => {
          const tr = { ...t };
          if (typeof tr.threadId === 'string') {
            tr.threadId = tr.threadId.trim();
          }
          if (typeof tr.replacementAdverseProspect === 'string') {
            tr.replacementAdverseProspect =
              tr.replacementAdverseProspect.trim().slice(0, 500).trim() || null;
          }
          if (typeof tr.causeReference === 'string') {
            tr.causeReference = tr.causeReference.trim().slice(0, 300).trim();
          }
          if (typeof tr.rationale === 'string') {
            tr.rationale = tr.rationale.trim().slice(0, 300).trim();
          }
          return tr;
        })
        .filter(
          (tr) =>
            typeof tr.threadId === 'string' &&
            tr.threadId.length > 0 &&
            typeof tr.causeReference === 'string' &&
            tr.causeReference.length > 0 &&
            typeof tr.rationale === 'string' &&
            tr.rationale.length > 0
        )
        .slice(0, 2);
      record.pressure_transition_proposal = ptp;
    }
  }

  if (
    record.reconciliation_proposal &&
    typeof record.reconciliation_proposal === 'object' &&
    !Array.isArray(record.reconciliation_proposal)
  ) {
    const rp = { ...(record.reconciliation_proposal as Record<string, unknown>) };
    if (typeof rp.memory_echo_candidate === 'string') {
      const trimmedEcho = rp.memory_echo_candidate.trim();
      if (!trimmedEcho) {
        rp.memory_echo_candidate = null;
      } else if (trimmedEcho.length > 240) {
        rp.memory_echo_candidate = trimmedEcho.slice(0, 240).trim() || null;
      }
    }
    record.reconciliation_proposal = rp;
  }

  return record;
}

export async function generateLocalStructuredResponse<T>(
  prompt: string,
  contract: StructuredResponseContract<T>,
  options: { baseUrl?: string; model?: string; maxTokens?: number } = {}
): Promise<T> {
  const baseUrl = options.baseUrl ?? getLocalVoiceBaseUrl();
  const models = await discoverLocalVoiceModels(baseUrl);
  const model = chooseLocalVoiceModel(models, options.model ?? getLocalEngineModel());
  const structuredPrompt = `[FORMAT DIRECTIVE: Output the raw JSON object immediately starting with '{'. Do not output any markdown, explanations, or internal monologue.]
[REASONING CONSTRAINT: Limit internal reasoning to under 150 tokens. Proceed immediately to generating the complete JSON object.]

${prompt}`;
  const requestedCap = options.maxTokens ?? 16384;
  const effectiveCap = computeEffectiveMaxTokens(model, structuredPrompt, requestedCap);

  const makeAttempt = async (cap: number): Promise<Response> => {
    return await fetch(localUrl(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: localHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: structuredPrompt }],
        temperature: 0.2,
        max_tokens: cap,
        max_completion_tokens: cap,
        // Universal rule (§12): omit reasoning_effort for json calls
        chat_template_kwargs: { enable_thinking: false, thinking: false },
        stream: false,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: contract.name.toLowerCase(),
            strict: true,
            schema: contract.responseJsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(300_000),
    });
  };

  let response: Response;
  try {
    response = await makeAttempt(effectiveCap);
  } catch (error: unknown) {
    console.error('[LOCAL STRUCT ERROR]', error);
    if (error instanceof LocalVoiceError) throw error;
    throw new LocalVoiceError(
      'LOCAL_SERVER_UNAVAILABLE',
      'The Local provider became unavailable before structured turn generation completed.',
      502
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error(`[LOCAL STRUCT REJECTED ${response.status}]`, errorBody);
    let errorMessage = 'The Local provider rejected the structured turn generation request.';
    try {
      const errJson = JSON.parse(errorBody);
      if (errJson.error?.message) {
        errorMessage += `: ${errJson.error.message}`;
      } else if (errJson.message) {
        errorMessage += `: ${errJson.message}`;
      }
    } catch {
      if (errorBody) {
        errorMessage += `: ${errorBody.slice(0, 200)}`;
      }
    }
    throw new LocalVoiceError(
      'LOCAL_PROVIDER_FAILURE',
      errorMessage,
      response.status
    );
  }

  let payload = await response.json();
  let payloadObj = payload as Record<string, unknown> | null;
  let choice = (payloadObj?.choices as Array<Record<string, unknown>> | undefined)?.[0];
  let choiceMsg = choice?.message as Record<string, unknown> | undefined;

  console.log('[LOCAL STRUCT DEBUG]', {
    finish_reason: choice?.finish_reason,
    content_len: typeof choiceMsg?.content === 'string' ? choiceMsg.content.length : null,
    content_preview: typeof choiceMsg?.content === 'string' ? choiceMsg.content.slice(0, 100) : null,
    reasoning_len: typeof choiceMsg?.reasoning_content === 'string' ? choiceMsg.reasoning_content.length : null,
    usage: payloadObj?.usage,
  });

  // Retry once on length truncation (§12)
  if (choice?.finish_reason === 'length') {
    const bumpedCap = computeEffectiveMaxTokens(
      model,
      structuredPrompt,
      Math.floor(effectiveCap * 1.5)
    );
    console.warn(`[LOCAL STRUCT RETRY] Truncated on length; retrying with cap ${bumpedCap} (previous: ${effectiveCap})`);
    try {
      response = await makeAttempt(bumpedCap);
    } catch (retryErr: unknown) {
      if (retryErr instanceof LocalVoiceError) throw retryErr;
      throw new LocalVoiceError(
        'LOCAL_SERVER_UNAVAILABLE',
        'The Local provider became unavailable during structured turn length retry.',
        502
      );
    }

    if (!response.ok) {
      throw new LocalVoiceError(
        'LOCAL_PROVIDER_FAILURE',
        'The Local provider rejected the structured turn generation length retry.',
        response.status
      );
    }

    payload = await response.json();
    payloadObj = payload as Record<string, unknown> | null;
    choice = (payloadObj?.choices as Array<Record<string, unknown>> | undefined)?.[0];
    choiceMsg = choice?.message as Record<string, unknown> | undefined;

    console.log('[LOCAL STRUCT RETRY DEBUG]', {
      finish_reason: choice?.finish_reason,
      content_len: typeof choiceMsg?.content === 'string' ? choiceMsg.content.length : null,
      usage: payloadObj?.usage,
    });

    if (choice?.finish_reason === 'length') {
      throw new LocalVoiceError(
        'LOCAL_CONTEXT_EXHAUSTED',
        'The local model ran out of output space twice on structured turn generation. Try a larger-context model or shorter inputs.',
        502
      );
    }
  }

  const rawText = readCompletionText(payload, { expectJson: true });
  if (!rawText || !rawText.trim()) {
    throw new EmptyProviderResponseError();
  }

  return parseStructuredTurnResponse(
    rawText,
    contract.zodSchema,
    (raw) =>
      normalizeLocalTurnPayload(
        raw,
        contract.normalizeProviderPayload,
        contract.normalizationContext
      )
  );
}

export async function generateLocalProse(
  prompt: string,
  options: { baseUrl?: string; model?: string } = {}
): Promise<string> {
  const baseUrl = options.baseUrl ?? getLocalVoiceBaseUrl();
  const models = await discoverLocalVoiceModels(baseUrl);
  const model = chooseLocalVoiceModel(models, options.model ?? getLocalEngineModel());

  let response: Response;
  try {
    response = await fetch(localUrl(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: localHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1024,
        max_completion_tokens: 1024,
        chat_template_kwargs: { enable_thinking: false },
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error: unknown) {
    if (error instanceof LocalVoiceError) throw error;
    throw new LocalVoiceError(
      'LOCAL_SERVER_UNAVAILABLE',
      'The Local provider became unavailable before prose generation completed.',
      502
    );
  }

  if (!response.ok) {
    throw new LocalVoiceError(
      'LOCAL_PROVIDER_FAILURE',
      'The Local provider rejected the prose generation request.',
      response.status
    );
  }

  const payload = await response.json();
  const raw = readCompletionText(payload, { expectJson: false });
  const cleaned = cleanSimulatedAction(raw);
  if (!cleaned) {
    throw new LocalVoiceError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Local provider returned an empty response.',
      502
    );
  }
  return cleaned;
}

export async function generateLocalTextWithMeta(
  prompt: string,
  options: {
    baseUrl?: string;
    model?: string;
    max_tokens?: number;
    temperature?: number;
    jsonMode?: boolean;
    images?: Array<{ mimeType: string; data: string } | string>;
    timeoutMs?: number;
  } = {}
): Promise<{ text: string; finish_reason: string | null }> {
  const baseUrl = options.baseUrl ?? getLocalVoiceBaseUrl();
  const models = await discoverLocalVoiceModels(baseUrl);
  const model = chooseLocalVoiceModel(models, options.model ?? getLocalForgeModel());

  let userContent: LocalMessageContent;
  if (options.images && options.images.length > 0) {
    const parts: LocalContentPart[] = [{ type: 'text', text: prompt }];
    for (const img of options.images) {
      if (typeof img === 'string') {
        const url = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
        parts.push({ type: 'image_url', image_url: { url } });
      } else {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        });
      }
    }
    userContent = parts;
  } else {
    userContent = prompt;
  }

  if (options.jsonMode && typeof userContent === 'string') {
    userContent = `[FORMAT DIRECTIVE: Output the raw JSON object immediately starting with '{'. Do not output any markdown fences, explanations, or internal monologue.]\n[REASONING CONSTRAINT: Limit internal reasoning to under 150 tokens. Proceed immediately to generating the complete JSON object.]\n\n${userContent}`;
  }

  const capability = getModelCapability(model);
  const promptTextForEstimate = typeof userContent === 'string' ? userContent : prompt;
  const requestedCap = options.max_tokens ?? 16384;
  const effectiveCap = computeEffectiveMaxTokens(model, promptTextForEstimate, requestedCap);

  const makeAttempt = async (cap: number): Promise<Response> => {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: userContent }],
      temperature: options.temperature ?? 0.3,
      max_tokens: cap,
      max_completion_tokens: cap,
      chat_template_kwargs: { enable_thinking: false, thinking: false },
      stream: false,
    };

    // Universal rule (§12): for any call with jsonMode: true, always omit reasoning_effort before fetch.
    if (!options.jsonMode && capability.supportsReasoningEffort) {
      body.reasoning_effort = 'low';
    }

    if (options.jsonMode) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'json_output',
          schema: { type: 'object' },
        },
      };
    }

    return await fetch(localUrl(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: localHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
    });
  };

  let response: Response;
  try {
    response = await makeAttempt(effectiveCap);
  } catch (error: unknown) {
    if (error instanceof LocalVoiceError) throw error;
    throw new LocalVoiceError(
      'LOCAL_SERVER_UNAVAILABLE',
      'The Local provider became unavailable before text generation completed.',
      502
    );
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new LocalVoiceError(
      'LOCAL_PROVIDER_FAILURE',
      `The Local provider rejected the text generation request (${response.status}): ${errText.slice(0, 120)}`,
      response.status
    );
  }

  let payload = await response.json();
  let choice = payload?.choices?.[0];
  console.log('[FORGE LOCAL TEXT DEBUG]', {
    finish_reason: choice?.finish_reason,
    content_len: choice?.message?.content?.length,
    content_preview: choice?.message?.content?.slice(0, 100),
    reasoning_len: choice?.message?.reasoning_content?.length,
    reasoning_preview: choice?.message?.reasoning_content?.slice(0, 100),
    usage: payload?.usage,
  });

  // Retry once on length truncation (§12)
  if (choice?.finish_reason === 'length') {
    const bumpedCap = computeEffectiveMaxTokens(
      model,
      promptTextForEstimate,
      Math.floor(effectiveCap * 1.5)
    );
    console.warn(`[FORGE LOCAL TEXT RETRY] Truncated on length; retrying with cap ${bumpedCap} (previous: ${effectiveCap})`);
    try {
      response = await makeAttempt(bumpedCap);
    } catch (retryErr: unknown) {
      if (retryErr instanceof LocalVoiceError) throw retryErr;
      throw new LocalVoiceError(
        'LOCAL_SERVER_UNAVAILABLE',
        'The Local provider became unavailable during text generation length retry.',
        502
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new LocalVoiceError(
        'LOCAL_PROVIDER_FAILURE',
        `The Local provider rejected the text generation length retry (${response.status}): ${errText.slice(0, 120)}`,
        response.status
      );
    }

    payload = await response.json();
    choice = payload?.choices?.[0];
    console.log('[FORGE LOCAL TEXT RETRY DEBUG]', {
      finish_reason: choice?.finish_reason,
      content_len: choice?.message?.content?.length,
      usage: payload?.usage,
    });

    if (choice?.finish_reason === 'length') {
      throw new LocalVoiceError(
        'LOCAL_CONTEXT_EXHAUSTED',
        'The local model ran out of output space twice on text generation. Try a larger-context model or shorter inputs.',
        502
      );
    }
  }

  let raw = readCompletionText(payload, { expectJson: options.jsonMode ?? false });
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!raw) {
    throw new LocalVoiceError(
      'EMPTY_PROVIDER_RESPONSE',
      'The Local provider returned an empty response.',
      502
    );
  }
  return { text: raw, finish_reason: (choice?.finish_reason as string) ?? null };
}

export async function generateLocalText(
  prompt: string,
  options: {
    baseUrl?: string;
    model?: string;
    max_tokens?: number;
    temperature?: number;
    jsonMode?: boolean;
    images?: Array<{ mimeType: string; data: string } | string>;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  return (await generateLocalTextWithMeta(prompt, options)).text;
}

export async function pingLocalVoice(
  options: {
    baseUrl?: string;
    model?: string;
  } = {}
): Promise<{
  ok: boolean;
  provider: 'local';
  model: string;
  models?: string[];
  baseUrl: string;
  latencyMs: number;
  status?: number;
  code?: string;
  message?: string;
}> {
  const start = Date.now();
  const baseUrl = options.baseUrl ?? getLocalVoiceBaseUrl();
  try {
    const normalizedBaseUrl = normalizeLocalBaseUrl(baseUrl);
    const models = await discoverLocalVoiceModels(normalizedBaseUrl);
    const model = chooseLocalVoiceModel(models, options.model ?? getLocalVoiceModel());
    return {
      ok: true,
      provider: 'local',
      model,
      models,
      baseUrl: normalizedBaseUrl,
      latencyMs: Date.now() - start,
    };
  } catch (error: unknown) {
    const known =
      error instanceof LocalVoiceError
        ? error
        : new LocalVoiceError(
            'LOCAL_PROVIDER_FAILURE',
            'The Local provider could not be inspected.'
          );
    return {
      ok: false,
      provider: 'local',
      model: options.model ?? getLocalVoiceModel(),
      baseUrl,
      latencyMs: Date.now() - start,
      status: known.status,
      code: known.code,
      message: known.message,
    };
  }
}
