import { describe, it, expect } from 'vitest';
import {
  readTurnResponse,
  createNetworkTurnError,
  toTurnFailureReceipt,
  formatTurnFailureMessage,
  TurnResponseError,
  SAFE_UNEXPECTED_TURN_MESSAGE,
  SAFE_NETWORK_ERROR_MESSAGE,
  SAFE_ERROR_MESSAGES,
  resolveSafeFailureMessage,
  normalizeTurnFailureReceipt,
} from './turnResponseReader';

describe('turnResponseReader', () => {
  it('1. parses a successful JSON turn response normally', async () => {
    const validTurnData = {
      narrative_blocks: [{ type: 'sensory', content: 'Dust swirls in the cold light.' }],
      engine_thoughts: 'Player enters quiet room.',
      logic_state: {
        current_phase: 'MANIFEST',
        suggested_tension: 30,
        requested_transition: null,
      },
      topologyDelta: { isExpansion: false, newNodeDef: null },
    };

    const response = new Response(JSON.stringify(validTurnData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await readTurnResponse<typeof validTurnData>(response);
    expect(result).toEqual(validTurnData);
  });

  it('2. classifies HTTP 200 with text/html as NON_JSON_TURN_RESPONSE and never leaks HTML in message', async () => {
    const rawHtml = '<!doctype html><html><body><h1>Proxy Gateway 200</h1><p>Fallback landing</p></body></html>';
    const response = new Response(rawHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

    let caughtError: TurnResponseError | null = null;
    try {
      await readTurnResponse(response);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        caughtError = err;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('NON_JSON_TURN_RESPONSE');
    expect(caughtError?.status).toBe(200);
    expect(caughtError?.contentType).toContain('text/html');
    expect(caughtError?.message).toBe(resolveSafeFailureMessage('NON_JSON_TURN_RESPONSE'));
    expect(caughtError?.message).not.toContain('<!doctype');
    expect(caughtError?.message).not.toContain('<html');
  });

  it('3. classifies a non-2xx HTML response as NON_JSON_TURN_RESPONSE without leaking body', async () => {
    const rawHtml502 = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1>Cloud Run proxy error</body></html>';
    const response = new Response(rawHtml502, {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });

    let caughtError: TurnResponseError | null = null;
    try {
      await readTurnResponse(response);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        caughtError = err;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('NON_JSON_TURN_RESPONSE');
    expect(caughtError?.status).toBe(502);
    expect(caughtError?.contentType).toBe('text/html');
    expect(caughtError?.message).toBe(resolveSafeFailureMessage('NON_JSON_TURN_RESPONSE'));
    expect(caughtError?.message).not.toContain('502 Bad Gateway');
    expect(caughtError?.message).not.toContain('Cloud Run');
  });

  it('4. classifies invalid JSON with application/json as MALFORMED_TURN_RESPONSE without leaking parser error', async () => {
    const malformedBody = '{"incomplete": true, "truncated';
    const response = new Response(malformedBody, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    let caughtError: TurnResponseError | null = null;
    try {
      await readTurnResponse(response);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        caughtError = err;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('MALFORMED_TURN_RESPONSE');
    expect(caughtError?.status).toBe(200);
    expect(caughtError?.contentType).toBe('application/json');
    expect(caughtError?.message).toBe(resolveSafeFailureMessage('MALFORMED_TURN_RESPONSE'));
    expect(caughtError?.message).not.toContain('Unexpected end of JSON');
    expect(caughtError?.message).not.toContain('is not valid JSON');
  });

  it('5. preserves server error code and maps to safe allowlisted message from structured JSON errors', async () => {
    const errorPayload = {
      error: 'Raw un-sanitized internal server error',
      message: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5:generateContent failed',
      code: 'MODEL_CONTRACT_MISMATCH',
      details: { issues: [] },
    };

    const response = new Response(JSON.stringify(errorPayload), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });

    let caughtError: TurnResponseError | null = null;
    try {
      await readTurnResponse(response);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        caughtError = err;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('MODEL_CONTRACT_MISMATCH');
    expect(caughtError?.status).toBe(502);
    expect(caughtError?.message).toBe(
      'The turn service returned an invalid response structure. The session state was not changed.'
    );
    expect(caughtError?.message).not.toContain('generativelanguage.googleapis.com');
  });

  it('5b. rejects unsafe provider sentinels, endpoint URLs, stack traces, and credentials', async () => {
    const unsafeSentinels = [
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaSyD123FakeSecretKey',
      'GoogleGenerativeAIError: [503 Service Unavailable] at Client.send (/app/node_modules/@google/genai/dist/index.js:142:12)',
      'RESOURCE_EXHAUSTED: Quota exceeded for project 9876543210. Rate limit: 15 RPM',
      'Error: Database connection refused at pg_connect (server/db/connection.ts:88:9)',
      'AIzaSyD-SecretApiKey1234567890abcdef',
    ];

    for (const unsafeText of unsafeSentinels) {
      const response = new Response(
        JSON.stringify({
          error: unsafeText,
          message: unsafeText,
          code: 'PROVIDER_FAILURE',
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      let caught: TurnResponseError | null = null;
      try {
        await readTurnResponse(response);
      } catch (err) {
        if (err instanceof TurnResponseError) {
          caught = err;
        }
      }

      expect(caught).not.toBeNull();
      expect(caught?.code).toBe('PROVIDER_FAILURE');
      expect(caught?.message).toBe(
        'The AI provider turn generation failed. The session state was not changed.'
      );
      expect(caught?.message).not.toContain(unsafeText);

      const receipt = toTurnFailureReceipt({
        code: 'PROVIDER_FAILURE',
        status: 502,
        message: unsafeText,
        error: unsafeText,
      });

      expect(receipt.message).toBe(
        'The AI provider turn generation failed. The session state was not changed.'
      );
      expect(receipt.message).not.toContain(unsafeText);
    }
  });

  it('6. classifies non-2xx JSON response without code as TURN_HTTP_FAILURE', async () => {
    const nonStructuredJson = {
      somethingElse: 'unknown',
    };

    const response = new Response(JSON.stringify(nonStructuredJson), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

    let caughtError: TurnResponseError | null = null;
    try {
      await readTurnResponse(response);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        caughtError = err;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('TURN_HTTP_FAILURE');
    expect(caughtError?.status).toBe(500);
    expect(caughtError?.message).toBe(resolveSafeFailureMessage('TURN_HTTP_FAILURE'));
  });

  it('7. classifies network-level errors as TURN_NETWORK_FAILURE', () => {
    const turnError = createNetworkTurnError();

    expect(turnError.code).toBe('TURN_NETWORK_FAILURE');
    expect(turnError.status).toBeNull();
    expect(turnError.contentType).toBeNull();
    expect(turnError.message).toBe(SAFE_NETWORK_ERROR_MESSAGE);

    const receipt = toTurnFailureReceipt(turnError);
    expect(receipt.code).toBe('TURN_NETWORK_FAILURE');
    expect(receipt.status).toBeNull();
    expect(receipt.message).toBe(SAFE_NETWORK_ERROR_MESSAGE);
  });

  it('8. formats atmospheric failure messages cleanly with code and status', () => {
    const receipt = {
      code: 'NON_JSON_TURN_RESPONSE',
      status: 502,
      contentType: 'text/html',
      message: SAFE_UNEXPECTED_TURN_MESSAGE,
    };

    const formatted = formatTurnFailureMessage(receipt);
    expect(formatted).toBe(
      `[ENGINE FAILURE // NON_JSON_TURN_RESPONSE // HTTP 502]\n${SAFE_UNEXPECTED_TURN_MESSAGE}`
    );

    const networkReceipt = {
      code: 'TURN_NETWORK_FAILURE',
      status: null,
      contentType: null,
      message: SAFE_NETWORK_ERROR_MESSAGE,
    };

    const formattedNetwork = formatTurnFailureMessage(networkReceipt);
    expect(formattedNetwork).toBe(
      `[ENGINE FAILURE // TURN_NETWORK_FAILURE]\n${SAFE_NETWORK_ERROR_MESSAGE}`
    );
  });

  it('preserves only safe bounded model-contract diagnostics', async () => {
    // 1. Valid diagnostics survive readTurnResponse, TurnResponseError, and toTurnFailureReceipt
    const validDiagnostics = {
      kind: 'SCHEMA_VALIDATION' as const,
      issues: [
        { path: 'character_relationship_proposal.changes.0.delta', code: 'invalid_type' },
        { path: 'consequence_proposal.mutations.0.operation', code: 'invalid_enum_value' },
      ],
    };

    const responseWithDiagnostics = new Response(
      JSON.stringify({
        error: 'Model output violated schema contract',
        code: 'MODEL_CONTRACT_MISMATCH',
        diagnostics: validDiagnostics,
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    let caughtError: TurnResponseError | null = null;
    try {
      await readTurnResponse(responseWithDiagnostics);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        caughtError = err;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.diagnostics).toEqual(validDiagnostics);

    const receiptFromError = caughtError!.toReceipt();
    expect(receiptFromError.diagnostics).toEqual(validDiagnostics);

    const receiptFromHelper = toTurnFailureReceipt({
      code: 'MODEL_CONTRACT_MISMATCH',
      status: 502,
      message: 'Model output violated schema contract',
      diagnostics: validDiagnostics,
    });
    expect(receiptFromHelper.diagnostics).toEqual(validDiagnostics);

    // 2. Failures without diagnostics retain existing behavior
    const simpleResponse = new Response(
      JSON.stringify({
        error: 'Generic server failure',
        code: 'SERVER_ERROR',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    let simpleError: TurnResponseError | null = null;
    try {
      await readTurnResponse(simpleResponse);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        simpleError = err;
      }
    }
    expect(simpleError).not.toBeNull();
    expect(simpleError?.diagnostics).toBeUndefined();
    expect(simpleError?.toReceipt().diagnostics).toBeUndefined();

    // 3. Malformed kinds, blank paths, oversized arrays, arbitrary nested objects, and non-string codes are discarded
    const malformedDiagnostics = {
      kind: 'INVALID_UNKNOWN_KIND',
      issues: [{ path: 'valid.path', code: 'valid_code' }],
    };
    const responseWithMalformedKind = new Response(
      JSON.stringify({
        error: 'Contract error',
        code: 'MODEL_CONTRACT_MISMATCH',
        diagnostics: malformedDiagnostics,
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    let malformedKindError: TurnResponseError | null = null;
    try {
      await readTurnResponse(responseWithMalformedKind);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        malformedKindError = err;
      }
    }
    expect(malformedKindError?.diagnostics).toBeUndefined();

    const junkIssuesDiagnostics = {
      kind: 'SCHEMA_VALIDATION',
      issues: [
        { path: '', code: 'code1' }, // blank path -> discarded
        { path: 'path2', code: '' }, // blank code -> discarded
        { path: 123, code: 'code3' }, // non-string path -> discarded
        { path: 'path4', code: null }, // non-string code -> discarded
        { nested: { raw: 'body' } }, // invalid shape -> discarded
      ],
    };
    const responseWithJunk = new Response(
      JSON.stringify({
        error: 'Contract error',
        code: 'MODEL_CONTRACT_MISMATCH',
        diagnostics: junkIssuesDiagnostics,
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    let junkError: TurnResponseError | null = null;
    try {
      await readTurnResponse(responseWithJunk);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        junkError = err;
      }
    }
    expect(junkError?.diagnostics).toBeUndefined();

    // Oversized issues array is capped to 12
    const manyIssues = Array.from({ length: 20 }, (_, i) => ({
      path: `field.path.${i}`,
      code: 'invalid_type',
    }));
    const responseWithMany = new Response(
      JSON.stringify({
        error: 'Contract error',
        code: 'MODEL_CONTRACT_MISMATCH',
        diagnostics: { kind: 'SCHEMA_VALIDATION', issues: manyIssues },
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    let manyError: TurnResponseError | null = null;
    try {
      await readTurnResponse(responseWithMany);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        manyError = err;
      }
    }
    expect(manyError?.diagnostics?.issues).toHaveLength(12);

    // 4. The generic user-facing message is the safe allowlisted string
    expect(caughtError?.message).toBe(
      'The turn service returned an invalid response structure. The session state was not changed.'
    );

    // 5. HTML and raw model bodies cannot enter diagnostics
    const htmlInDiagnostics = {
      kind: 'SCHEMA_VALIDATION',
      issues: [
        { path: '<script>alert(1)</script>', code: 'safe_code' },
        { path: 'safe.path', code: '<div>raw html</div>' },
      ],
    };
    const responseWithHtml = new Response(
      JSON.stringify({
        error: 'Contract error',
        code: 'MODEL_CONTRACT_MISMATCH',
        diagnostics: htmlInDiagnostics,
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    let htmlError: TurnResponseError | null = null;
    try {
      await readTurnResponse(responseWithHtml);
    } catch (err) {
      if (err instanceof TurnResponseError) {
        htmlError = err;
      }
    }
    expect(htmlError?.diagnostics).toBeUndefined();
  });

  it('proves distinct unsafe sentinels in code, message, contentType, diagnostic path, diagnostic code, and nested fields never survive', () => {
    const CODE_SENTINEL = 'https://malicious.internal.api/key?secret=123';
    const MESSAGE_SENTINEL = 'DATABASE_PASSWORD=secret_password_here';
    const CONTENT_TYPE_SENTINEL = 'text/html; charset=utf-8; <script>evil()</script>';
    const PATH_SENTINEL = 'https://api.internal/v1/auth/tokens?user=root';
    const DIAG_CODE_SENTINEL = 'UNKNOWN_LEAKED_INTERNAL_ERROR_STACK_TRACE_HERE';
    const NESTED_SENTINEL = 'INTERNAL_AUTH_BEARER_TOKEN_99999';

    const rawUnsafeError = {
      code: CODE_SENTINEL,
      message: MESSAGE_SENTINEL,
      error: MESSAGE_SENTINEL,
      status: 999999, // invalid status
      contentType: CONTENT_TYPE_SENTINEL,
      unknown_nested_secret: NESTED_SENTINEL,
      diagnostics: {
        kind: 'SCHEMA_VALIDATION',
        issues: [
          { path: PATH_SENTINEL, code: 'invalid_type' },
          { path: 'valid.path.field', code: DIAG_CODE_SENTINEL },
          { path: 'valid.path[0]', code: 'invalid_type' }, // valid
        ],
        extra_secret: NESTED_SENTINEL,
      },
    };

    const receipt = normalizeTurnFailureReceipt(rawUnsafeError);

    // 1. Code is mapped to UNKNOWN_ERROR
    expect(receipt.code).toBe('UNKNOWN_ERROR');

    // 2. Message is strictly safe string from local table
    expect(receipt.message).toBe(SAFE_ERROR_MESSAGES.UNKNOWN_ERROR);
    expect(receipt.message).not.toContain(MESSAGE_SENTINEL);

    // 3. Status is normalized to null (since 999999 is outside 100-599)
    expect(receipt.status).toBeNull();

    // 4. ContentType is normalized to text/html
    expect(receipt.contentType).toBe('text/html');
    expect(receipt.contentType).not.toContain('script');

    // 5. Unsafe diagnostic path and unsafe diagnostic code are filtered out
    expect(receipt.diagnostics).toBeDefined();
    expect(receipt.diagnostics?.issues).toHaveLength(1);
    expect(receipt.diagnostics?.issues[0]).toEqual({
      path: 'valid.path[0]',
      code: 'invalid_type',
    });

    // 6. Formatted failure message has zero sentinels
    const formatted = formatTurnFailureMessage(receipt);
    expect(formatted).not.toContain(CODE_SENTINEL);
    expect(formatted).not.toContain(MESSAGE_SENTINEL);
    expect(formatted).not.toContain(CONTENT_TYPE_SENTINEL);
    expect(formatted).not.toContain(PATH_SENTINEL);
    expect(formatted).not.toContain(DIAG_CODE_SENTINEL);
    expect(formatted).not.toContain(NESTED_SENTINEL);
  });

  it('restricts JSON media matching strictly to application/json and application/*+json', async () => {
    const validTurnData = {
      narrative_blocks: [{ type: 'prose', content: 'The lights flicker.' }],
    };

    // Valid JSON media types
    const validTypes = [
      'application/json',
      'application/json; charset=utf-8',
      'application/problem+json',
      'application/vnd.api+json',
      'application/schema+json',
    ];

    for (const validMime of validTypes) {
      const response = new Response(JSON.stringify(validTurnData), {
        status: 200,
        headers: { 'Content-Type': validMime },
      });
      const result = await readTurnResponse<typeof validTurnData>(response);
      expect(result).toEqual(validTurnData);
    }

    // Invalid JSON media types (must be rejected as NON_JSON_TURN_RESPONSE)
    const invalidTypes = [
      'text/json',
      'application/x-json-attack',
      'application/json-seq',
      'text/html',
      'application/xml',
      'application/javascript',
    ];

    for (const invalidMime of invalidTypes) {
      const response = new Response(JSON.stringify(validTurnData), {
        status: 200,
        headers: { 'Content-Type': invalidMime },
      });

      let caught: TurnResponseError | null = null;
      try {
        await readTurnResponse(response);
      } catch (err) {
        if (err instanceof TurnResponseError) {
          caught = err;
        }
      }
      expect(caught).not.toBeNull();
      expect(caught?.code).toBe('NON_JSON_TURN_RESPONSE');
    }
  });

  it('normalizes PROVIDER_REFUSAL receipts with fixed safe message and discards server prose', () => {
    const rawReceipt = {
      code: 'PROVIDER_REFUSAL',
      status: 502,
      contentType: 'application/json',
      message: 'Server internal refusal reason: SAFETY violation at line 42',
    };

    const normalized = normalizeTurnFailureReceipt(rawReceipt);
    expect(normalized.code).toBe('PROVIDER_REFUSAL');
    expect(normalized.status).toBe(502);
    expect(normalized.message).toBe(SAFE_ERROR_MESSAGES.PROVIDER_REFUSAL);
    expect(normalized.message).not.toContain('SAFETY violation');
    expect(normalized.message).not.toContain('line 42');
  });

  it('normalizes PREPAYMENT_DEPLETED with actionable message and HTTP 429 status', () => {
    const rawReceipt = {
      code: 'PREPAYMENT_DEPLETED',
      status: 429,
      contentType: 'application/json',
      message: 'Google Cloud billing error: your prepayment credits are depleted',
    };

    const normalized = normalizeTurnFailureReceipt(rawReceipt);
    expect(normalized.code).toBe('PREPAYMENT_DEPLETED');
    expect(normalized.status).toBe(429);
    expect(normalized.message).toBe(SAFE_ERROR_MESSAGES.PREPAYMENT_DEPLETED);
    expect(normalized.message).toContain('prepayment credits are depleted');
  });

  it('normalizes RATE_LIMIT_EXCEEDED and PROVIDER_HIGH_DEMAND cleanly', () => {
    const rateLimit = normalizeTurnFailureReceipt({ code: 'RATE_LIMIT_EXCEEDED', status: 429 });
    expect(rateLimit.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(rateLimit.status).toBe(429);
    expect(rateLimit.message).toBe(SAFE_ERROR_MESSAGES.RATE_LIMIT_EXCEEDED);

    const highDemand = normalizeTurnFailureReceipt({ code: 'PROVIDER_HIGH_DEMAND', status: 503 });
    expect(highDemand.code).toBe('PROVIDER_HIGH_DEMAND');
    expect(highDemand.status).toBe(503);
    expect(highDemand.message).toBe(SAFE_ERROR_MESSAGES.PROVIDER_HIGH_DEMAND);
  });

  it('preserves dialogue_contract_violation, invalid_json, and invalid_value in sanitizeTurnFailureDiagnostics', () => {
    const dialogueReceipt = normalizeTurnFailureReceipt({
      code: 'MODEL_CONTRACT_MISMATCH',
      status: 502,
      diagnostics: {
        kind: 'DIALOGUE_CONTRACT',
        issues: [{ path: 'narrative_blocks', code: 'dialogue_contract_violation' }],
      },
    });
    expect(dialogueReceipt.diagnostics).toEqual({
      kind: 'DIALOGUE_CONTRACT',
      issues: [{ path: 'narrative_blocks', code: 'dialogue_contract_violation' }],
    });

    const jsonReceipt = normalizeTurnFailureReceipt({
      code: 'MODEL_CONTRACT_MISMATCH',
      status: 502,
      diagnostics: {
        kind: 'JSON_PARSE',
        issues: [{ path: '$', code: 'invalid_json' }],
      },
    });
    expect(jsonReceipt.diagnostics).toEqual({
      kind: 'JSON_PARSE',
      issues: [{ path: '$', code: 'invalid_json' }],
    });

    const zodV4Receipt = normalizeTurnFailureReceipt({
      code: 'MODEL_CONTRACT_MISMATCH',
      status: 502,
      diagnostics: {
        kind: 'SCHEMA_VALIDATION',
        issues: [
          { path: 'situated_pressure_proposal.operator', code: 'invalid_value' },
          { path: 'narrative_blocks[0].medium', code: 'invalid_format' },
        ],
      },
    });
    expect(zodV4Receipt.diagnostics).toEqual({
      kind: 'SCHEMA_VALIDATION',
      issues: [
        { path: 'situated_pressure_proposal.operator', code: 'invalid_value' },
        { path: 'narrative_blocks[0].medium', code: 'invalid_format' },
      ],
    });
  });
});
