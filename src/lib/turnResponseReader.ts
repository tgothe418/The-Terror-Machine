import type {
  TurnFailureReceipt,
  TurnFailureDiagnostics,
  TurnFailureDiagnosticIssue,
} from '../types';

export type { TurnFailureReceipt, TurnFailureDiagnostics, TurnFailureDiagnosticIssue };

export const SAFE_TURN_FAILURE_CODES = [
  'STRUCTURAL_RESPONSE_MISMATCH',
  'FRAME_VALIDATION_REJECTED',
  'MODEL_CONTRACT_MISMATCH',
  'PROVIDER_FAILURE',
  'PROVIDER_REFUSAL',
  'PREPAYMENT_DEPLETED',
  'RATE_LIMIT_EXCEEDED',
  'PROVIDER_HIGH_DEMAND',
  'NON_JSON_TURN_RESPONSE',
  'MALFORMED_TURN_RESPONSE',
  'TURN_NETWORK_FAILURE',
  'TURN_HTTP_FAILURE',
  'COORDINATION_FAILURE',
  'UNKNOWN_ERROR',
] as const;

export type SafeTurnFailureCode = (typeof SAFE_TURN_FAILURE_CODES)[number];

export const SAFE_ERROR_MESSAGES: Record<SafeTurnFailureCode, string> = {
  STRUCTURAL_RESPONSE_MISMATCH:
    'The turn service returned an invalid response structure. The session state was not changed.',
  FRAME_VALIDATION_REJECTED:
    'The simulation frame failed authoritative validation. The session state was not changed.',
  MODEL_CONTRACT_MISMATCH:
    'The turn service returned an invalid response structure. The session state was not changed.',
  PROVIDER_FAILURE:
    'The AI provider turn generation failed. The session state was not changed.',
  PROVIDER_REFUSAL:
    'The simulation model declined to generate a turn. The session state was not changed. You may retry or rephrase your action.',
  PREPAYMENT_DEPLETED:
    'Your Google AI Studio prepayment credits are depleted. Switch to an unpaid Free Tier project key or add credits in Google AI Studio.',
  RATE_LIMIT_EXCEEDED:
    'AI provider rate limit reached (15 RPM on Free Tier). Please wait a few seconds before retrying.',
  PROVIDER_HIGH_DEMAND:
    'The AI model is experiencing a temporary capacity spike. Please retry in a moment.',
  NON_JSON_TURN_RESPONSE:
    'The turn service returned an unexpected non-JSON response. The session state was not changed.',
  MALFORMED_TURN_RESPONSE:
    'The turn service returned a malformed response. The session state was not changed.',
  TURN_NETWORK_FAILURE:
    'A network failure occurred while contacting the turn service. The session state was not changed.',
  TURN_HTTP_FAILURE:
    'The turn service returned an HTTP error. The session state was not changed.',
  COORDINATION_FAILURE:
    'The turn transaction could not be published coherently. The session state was not changed.',
  UNKNOWN_ERROR:
    'The turn service returned an unexpected response. The session state was not changed.',
};

export const SAFE_UNEXPECTED_TURN_MESSAGE = SAFE_ERROR_MESSAGES.UNKNOWN_ERROR;
export const SAFE_NETWORK_ERROR_MESSAGE = SAFE_ERROR_MESSAGES.TURN_NETWORK_FAILURE;

export const APPROVED_DIAGNOSTIC_CODES = new Set([
  'required_field_missing',
  'invalid_type',
  'unrecognized_keys',
  'too_big',
  'too_small',
  'invalid_enum_value',
  'invalid_literal',
  'custom',
  'custom_error',
  'syntax_error',
  'unexpected_token',
  'contract_violation',
  'dialogue_contract_violation',
  'invalid_json',
  'invalid_value',
  'invalid_format',
  'invalid_key',
  'invalid_element',
  'invalid_union',
  'invalid_string',
  'invalid_date',
  'boundary_breach',
]);

const APPROVED_MEDIA_TYPES = new Set(['application/json', 'text/html', 'text/plain']);

const PATH_REGEX = /^(\$|[a-zA-Z0-9_]+)(\.[a-zA-Z0-9_]+|\[\d+\])*$/;

/**
 * Normalizes a raw failure code into the closed SafeTurnFailureCode allowlist.
 */
export function normalizeTurnFailureCode(rawCode: unknown, status?: number | null): SafeTurnFailureCode {
  if (typeof rawCode === 'string') {
    const trimmed = rawCode.trim();
    if (trimmed === 'INVALID_REQUEST') return 'MODEL_CONTRACT_MISMATCH';
    if (trimmed === 'RATIFICATION_FAILURE') return 'FRAME_VALIDATION_REJECTED';
    if (trimmed === 'API_ROUTE_NOT_FOUND' || trimmed === 'NOT_FOUND') return 'TURN_HTTP_FAILURE';
    if (Object.hasOwn(SAFE_ERROR_MESSAGES, trimmed)) {
      return trimmed as SafeTurnFailureCode;
    }
  }
  if (status && status >= 400 && status < 600) {
    return 'TURN_HTTP_FAILURE';
  }
  return 'UNKNOWN_ERROR';
}

/**
 * Resolves a stable, safe user-facing error message from the local table.
 */
export function resolveSafeFailureMessage(code: string): string {
  const normalized = normalizeTurnFailureCode(code);
  return SAFE_ERROR_MESSAGES[normalized];
}

/**
 * Normalizes HTTP status code to an integer from 100 through 599, otherwise null.
 */
export function normalizeHttpStatus(rawStatus: unknown): number | null {
  if (
    typeof rawStatus === 'number' &&
    Number.isInteger(rawStatus) &&
    rawStatus >= 100 &&
    rawStatus <= 599
  ) {
    return rawStatus;
  }
  return null;
}

const JSON_MIME_REGEX = /^application\/([a-zA-Z0-9_.-]+\+)?json$/i;

/**
 * Normalizes media type case-insensitively before parameters.
 * E.g., 'application/json; charset=utf-8' -> 'application/json'
 * Approved +json responses (e.g. application/problem+json) map to application/json.
 */
export function normalizeContentType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.split(';')[0].trim().toLowerCase();
  if (APPROVED_MEDIA_TYPES.has(base)) return base;
  if (JSON_MIME_REGEX.test(base)) {
    return 'application/json';
  }
  return null;
}

/**
 * Defensively validates and sanitizes a raw diagnostics object from the server.
 * Bounded to 12 deduplicated issues, strict kinds, allowlisted codes, and safe path shapes.
 */
export function sanitizeTurnFailureDiagnostics(
  raw: unknown
): TurnFailureDiagnostics | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const validKinds: TurnFailureDiagnostics['kind'][] = [
    'SCHEMA_VALIDATION',
    'JSON_PARSE',
    'DIALOGUE_CONTRACT',
  ];
  if (!validKinds.includes(obj.kind as TurnFailureDiagnostics['kind'])) {
    return undefined;
  }
  const kind = obj.kind as TurnFailureDiagnostics['kind'];

  if (!Array.isArray(obj.issues)) {
    return undefined;
  }

  const issues: TurnFailureDiagnosticIssue[] = [];
  const seen = new Set<string>();

  for (const item of obj.issues) {
    if (issues.length >= 12) break;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const issueObj = item as Record<string, unknown>;

    if (
      typeof issueObj.path !== 'string' ||
      issueObj.path.trim().length === 0 ||
      issueObj.path.length > 200
    ) {
      continue;
    }
    if (
      typeof issueObj.code !== 'string' ||
      issueObj.code.trim().length === 0 ||
      issueObj.code.length > 60
    ) {
      continue;
    }

    const path = issueObj.path.trim();
    const code = issueObj.code.trim();

    // Reject URLs, query strings, whitespace, colons, angle brackets, or prose in path
    if (!PATH_REGEX.test(path)) continue;

    // Validate diagnostic code against approved server emissions
    if (!APPROVED_DIAGNOSTIC_CODES.has(code.toLowerCase())) continue;

    const key = `${path}::${code}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({ path, code });
    }
  }

  if (issues.length === 0) {
    return undefined;
  }

  return {
    kind,
    issues,
  };
}

/**
 * Normalizes any error object into an authoritative, safe TurnFailureReceipt.
 */
export function normalizeTurnFailureReceipt(raw: unknown): TurnFailureReceipt {
  if (raw instanceof TurnResponseError) {
    return raw.toReceipt();
  }

  if (typeof raw === 'object' && raw !== null) {
    const errorObj = raw as Record<string, unknown>;
    const code = normalizeTurnFailureCode(errorObj.code || errorObj.errorCategory);
    const status = normalizeHttpStatus(
      errorObj.status !== undefined ? errorObj.status : errorObj.statusCode
    );
    const contentType = normalizeContentType(errorObj.contentType);
    const diagnostics = sanitizeTurnFailureDiagnostics(errorObj.diagnostics);
    const message = resolveSafeFailureMessage(code);

    return {
      code,
      status,
      contentType,
      message,
      ...(diagnostics ? { diagnostics } : {}),
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    status: null,
    contentType: null,
    message: resolveSafeFailureMessage('UNKNOWN_ERROR'),
  };
}

export class TurnResponseError extends Error {
  readonly code: SafeTurnFailureCode;
  readonly status: number | null;
  readonly contentType: string | null;
  readonly diagnostics?: TurnFailureDiagnostics;

  constructor(receipt: TurnFailureReceipt | { code: unknown; status?: unknown; contentType?: unknown; diagnostics?: unknown; message?: string }) {
    const normalized = normalizeTurnFailureReceipt(receipt);
    super(normalized.message);
    this.name = 'TurnResponseError';
    this.code = normalized.code as SafeTurnFailureCode;
    this.status = normalized.status;
    this.contentType = normalized.contentType;
    this.diagnostics = normalized.diagnostics;
  }

  toReceipt(): TurnFailureReceipt {
    return {
      code: this.code,
      status: this.status,
      contentType: this.contentType,
      message: this.message,
      ...(this.diagnostics ? { diagnostics: this.diagnostics } : {}),
    };
  }
}

function extractContentType(response: Response): string | null {
  const header = response.headers?.get?.('content-type');
  return normalizeContentType(header);
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType === 'application/json';
}

/**
 * Safely inspects and reads a Response from `/api/turn`.
 * Ensures non-JSON and malformed JSON responses are classified with safe codes
 * and never leak raw HTML, stack traces, or parser errors.
 */
export async function readTurnResponse<T = unknown>(response: Response): Promise<T> {
  const contentType = extractContentType(response);

  // 1. Non-JSON check (including text/html or fallback pages)
  if (!isJsonContentType(contentType)) {
    throw new TurnResponseError({
      code: 'NON_JSON_TURN_RESPONSE',
      status: response.status,
      contentType,
    });
  }

  // 2. Read raw body and attempt JSON parse
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    throw new TurnResponseError({
      code: 'MALFORMED_TURN_RESPONSE',
      status: response.status,
      contentType,
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new TurnResponseError({
      code: 'MALFORMED_TURN_RESPONSE',
      status: response.status,
      contentType,
    });
  }

  // 3. Handle non-2xx responses with parsed JSON
  if (!response.ok) {
    const errorObj =
      typeof parsedJson === 'object' && parsedJson !== null
        ? (parsedJson as Record<string, unknown>)
        : null;

    const rawCode =
      errorObj && typeof errorObj.code === 'string' && errorObj.code.trim().length > 0
        ? errorObj.code
        : 'TURN_HTTP_FAILURE';

    const diagnostics = sanitizeTurnFailureDiagnostics(errorObj?.diagnostics);

    throw new TurnResponseError({
      code: rawCode,
      status: response.status,
      contentType,
      diagnostics,
    });
  }

  return parsedJson as T;
}

/**
 * Creates a stable network failure error when fetch rejects.
 */
export function createNetworkTurnError(): TurnResponseError {
  return new TurnResponseError({
    code: 'TURN_NETWORK_FAILURE',
    status: null,
    contentType: null,
  });
}

/**
 * Resolves any caught error into a safe TurnFailureReceipt.
 */
export function toTurnFailureReceipt(err: unknown): TurnFailureReceipt {
  return normalizeTurnFailureReceipt(err);
}

/**
 * Formats a safe user-facing failure message with atmosphere styling.
 */
export function formatTurnFailureMessage(receipt: TurnFailureReceipt): string {
  const statusPart = receipt.status != null ? ` // HTTP ${receipt.status}` : '';
  return `[ENGINE FAILURE // ${receipt.code}${statusPart}]\n${receipt.message}`;
}
