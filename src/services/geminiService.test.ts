import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fetchSimulatedPlayerAction, streamEngineTurn } from './geminiService';
import type { Message, LogicState } from '../types';

describe('fetchSimulatedPlayerAction client service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleHistory: Message[] = [{ role: 'assistant', content: 'The corridor is quiet.', timestamp: Date.now() }];
  const sampleLogicState: LogicState = { current_phase: 'MANIFEST', suggested_tension: 30 };

  it('returns { success: true, action } when server returns a valid action', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ action: 'Inspect the iron locker' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await fetchSimulatedPlayerAction(sampleHistory, sampleLogicState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.action).toBe('Inspect the iron locker');
    }
  });

  it('returns { success: false, code } without action string when server returns refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Declined', code: 'PROVIDER_REFUSAL' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = (await fetchSimulatedPlayerAction(sampleHistory, sampleLogicState)) as { success: false; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('PROVIDER_REFUSAL');
    expect((result as Record<string, unknown>).action).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('SYSTEM OVERRIDE');
    expect(JSON.stringify(result)).not.toContain('I look around carefully');
  });

  it('returns { success: false, code } when server returns empty action or action failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Failed', code: 'AUTOPILOT_ACTION_FAILURE' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = (await fetchSimulatedPlayerAction(sampleHistory, sampleLogicState)) as { success: false; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('AUTOPILOT_ACTION_FAILURE');
    expect((result as Record<string, unknown>).action).toBeUndefined();
  });

  it('returns { success: false, code: "TURN_NETWORK_FAILURE" } on fetch network error without synthetic action string', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network connection lost'));

    const result = (await fetchSimulatedPlayerAction(sampleHistory, sampleLogicState)) as { success: false; code: string };
    expect(result.success).toBe(false);
    expect(result.code).toBe('TURN_NETWORK_FAILURE');
    expect((result as Record<string, unknown>).action).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('SYSTEM OVERRIDE');
  });

  it('sends characterName, role, and mode in request payload when options provided', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ action: 'Take the flashlight' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await fetchSimulatedPlayerAction(sampleHistory, sampleLogicState, {
      characterName: 'Test Player',
      role: 'survivor',
      mode: 'aggressive',
    });

    expect(result.success).toBe(true);
    expect(capturedBody).toMatchObject({
      characterName: 'Test Player',
      role: 'survivor',
      mode: 'aggressive',
    });
  });

  it('includes villainIdentity verbatim in request payload when provided', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ action: 'Corner the prey' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const villainIdentity = {
      name: 'The Warden',
      description: 'Ancient mechanical construct',
      personality: 'Cold, relentless',
      goals: 'Seal all bulkhead doors',
      traits: ['mechanical', 'inexorable'],
      directives: ['Trap in cryo bay'],
      coVillains: ['The Sentry'],
    };

    const result = await fetchSimulatedPlayerAction(sampleHistory, sampleLogicState, {
      characterName: 'The Warden',
      role: 'villain',
      mode: 'standard',
      villainIdentity,
    });

    expect(result.success).toBe(true);
    expect(capturedBody).toMatchObject({
      characterName: 'The Warden',
      role: 'villain',
      mode: 'standard',
      villainIdentity,
    });
  });
});

describe('streamEngineTurn client service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams tokens and resolves on complete event', async () => {
    const sseChunks = [
      'id: 1\nevent: token\ndata: {"token":"You "}\n\n',
      'id: 2\nevent: token\ndata: {"token":"reach "}\n\n',
      'id: 3\nevent: token\ndata: {"token":"out."}\n\n',
      'id: 4\nevent: complete\ndata: {"narrative_blocks":[{"type":"prose","content":"You reach out."}]}\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const tokens: string[] = [];
    let completedData: unknown = null;

    const result = await streamEngineTurn(
      { userAction: 'Reach out' },
      {
        onToken: (t) => tokens.push(t),
        onComplete: (d) => {
          completedData = d;
        },
      }
    );

    expect(tokens).toEqual(['You ', 'reach ', 'out.']);
    expect(completedData).toEqual({
      narrative_blocks: [{ type: 'prose', content: 'You reach out.' }],
    });
    expect(result).toEqual(completedData);
  });

  it('throws and dispatches onError when error event is received', async () => {
    const sseChunks = [
      'id: 1\nevent: error\ndata: {"error":"Model refusal","diagnostics":[]}\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    let caughtError: (Error | { error: string; diagnostics?: unknown[] }) | null = null;
    await expect(
      streamEngineTurn(
        { userAction: 'Bad action' },
        {
          onError: (e) => {
            caughtError = e;
          },
        }
      )
    ).rejects.toThrow('Model refusal');

    expect(caughtError).toBeDefined();
    expect((caughtError as Error)?.message).toBe('Model refusal');
  });

  it('throws and dispatches onError on non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid payload', code: 'INVALID_REQUEST' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    let caughtError: (Error | { error: string; diagnostics?: unknown[] }) | null = null;
    await expect(
      streamEngineTurn(
        { userAction: '' },
        {
          onError: (e) => {
            caughtError = e;
          },
        }
      )
    ).rejects.toThrow('Invalid payload');

    expect(caughtError).toBeDefined();
    expect((caughtError as Error & { code?: string })?.code).toBe('INVALID_REQUEST');
  });
});

