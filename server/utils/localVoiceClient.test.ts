import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocalVoiceBaseUrl, setLocalVoiceModel } from '../ai/voiceProviderPolicy';
import { z } from 'zod';
import {
  LocalVoiceError,
  buildLocalVoiceMessages,
  cleanSimulatedAction,
  discoverLocalVoiceModels,
  generateLocalPlayerAction,
  generateLocalProse,
  generateLocalStructuredResponse,
  generateLocalText,
  generateLocalVoice,
  normalizeLocalTurnPayload,
  pingLocalVoice,
} from './localVoiceClient';

describe('Local Voice client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setLocalVoiceBaseUrl(null);
    setLocalVoiceModel(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setLocalVoiceBaseUrl(null);
    setLocalVoiceModel(null);
    vi.restoreAllMocks();
  });

  it('discovers models from an OpenAI-compatible local server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'small-test' }, { id: 'Qwen/Qwen3.8-27B' }] }), {
        status: 200,
      })
    );

    await expect(discoverLocalVoiceModels('http://127.0.0.1:8080')).resolves.toEqual([
      'small-test',
      'Qwen/Qwen3.8-27B',
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:8080/v1/models', {
      signal: expect.any(AbortSignal),
    });
  });

  it('chooses Qwen 3.8 automatically and sends compatible chat messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'other' }, { id: 'Qwen/Qwen3.8-27B' }] }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'The local line is open.' } }] }),
          { status: 200 }
        )
      );
    globalThis.fetch = fetchMock;
    setLocalVoiceBaseUrl('http://127.0.0.1:1234/v1');

    await expect(
      generateLocalVoice({
        instructions: 'Stay in the control room.',
        history: [
          { role: 'assistant', content: 'orphaned preface' },
          {
            role: 'user',
            content: 'Can you see this?',
            attachments: [
              {
                name: 'map.md',
                mimeType: 'text/markdown',
                data: Buffer.from('signal map').toString('base64'),
              },
              { name: 'hall.png', mimeType: 'image/png', data: 'aW1hZ2U=' },
            ],
          },
        ],
      })
    ).resolves.toEqual({
      text: 'The local line is open.',
      model: 'Qwen/Qwen3.8-27B',
      provider: 'local',
    });

    const [url, request] = fetchMock.mock.calls[1];
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({ model: 'Qwen/Qwen3.8-27B', stream: false });
    expect(body.messages).toEqual(
      expect.arrayContaining([
        { role: 'system', content: 'Stay in the control room.' },
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: expect.stringContaining('signal map') }),
            expect.objectContaining({
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
            }),
          ]),
        }),
      ])
    );
  });

  it('rejects non-local URLs and reports discovery failures without leaking details', async () => {
    await expect(discoverLocalVoiceModels('https://example.com/v1')).rejects.toMatchObject({
      name: LocalVoiceError.name,
      code: 'LOCAL_URL_INVALID',
      status: 400,
    });

    const result = await pingLocalVoice({ baseUrl: 'http://192.168.1.20:8080/v1' });
    expect(result).toMatchObject({
      ok: false,
      code: 'LOCAL_URL_INVALID',
      status: 400,
    });
  });

  it('keeps the bounded trailing history and a final user turn', () => {
    const messages = buildLocalVoiceMessages('system', [
      { role: 'assistant', content: 'old' },
      { role: 'user', content: 'latest' },
      { role: 'voice', content: 'answer' },
    ]);
    expect(messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'latest' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'Proceed.' },
    ]);
  });

  describe('cleanSimulatedAction', () => {
    it('strips markdown code blocks and raw formatting', () => {
      expect(cleanSimulatedAction('```text\nI step quietly through the doorway.\n```')).toBe(
        'I step quietly through the doorway.'
      );
      expect(cleanSimulatedAction('```\nI inspect the desk drawer.\n```')).toBe(
        'I inspect the desk drawer.'
      );
      expect(
        cleanSimulatedAction(
          '<think>Analyze situation: The player is in danger.</think>\nI crouch behind the counter.'
        )
      ).toBe('I crouch behind the counter.');
    });

    it('strips speaker prefixes and enclosing quotation marks', () => {
      expect(cleanSimulatedAction('PLAYER: "I shine the flashlight down the hall."')).toBe(
        'I shine the flashlight down the hall.'
      );
      expect(cleanSimulatedAction('ME: I check my pulse.')).toBe('I check my pulse.');
      expect(cleanSimulatedAction('The Player: "I listen closely."')).toBe('I listen closely.');
      expect(cleanSimulatedAction('Action: I back away slowly.')).toBe('I back away slowly.');
    });

    it('preserves inner quotes in spoken dialogue', () => {
      expect(cleanSimulatedAction('I whisper, "Is anyone there?"')).toBe(
        'I whisper, "Is anyone there?"'
      );
      expect(cleanSimulatedAction('"I call out, \\"Hello?\\""')).toBe('I call out, "Hello?"');
    });

    it('returns empty string for blank or empty fence text', () => {
      expect(cleanSimulatedAction('')).toBe('');
      expect(cleanSimulatedAction('   \n\t ')).toBe('');
      expect(cleanSimulatedAction('```\n\n```')).toBe('');
      expect(cleanSimulatedAction('<think>Just thinking</think>')).toBe('');
    });
  });

  describe('generateLocalPlayerAction', () => {
    it('generates, cleans, and returns player action from local endpoint', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '```text\nPLAYER: "I carefully turn the brass doorknob."\n```',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      globalThis.fetch = fetchMock;
      setLocalVoiceBaseUrl('http://127.0.0.1:1234/v1');
      setLocalVoiceModel('google/gemma-4-e4b');

      const action = await generateLocalPlayerAction('System instructions for player');
      expect(action).toBe('I carefully turn the brass doorknob.');

      const [url, req] = fetchMock.mock.calls[1];
      expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
      const body = JSON.parse(req.body);
      expect(body).toEqual({
        model: 'google/gemma-4-e4b',
        messages: [{
          role: 'user',
          content: "[REASONING CONSTRAINT: Limit internal reasoning to under 80 tokens. Output ONLY the player's immediate action or dialogue, with no reasoning, commentary, or markdown fences.]\n\nSystem instructions for player",
        }],
        temperature: 0.7,
        max_tokens: 4096,
        max_completion_tokens: 4096,
        chat_template_kwargs: { enable_thinking: false },
        stream: false,
      });
    });

    it('salvages the final action draft from reasoning_content when the model exhausts its token budget', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'length',
                  message: {
                    content: '',
                    reasoning_content:
                      '*Draft 1:* I stand and face him. (Too plain?)\n*Let\'s go with the lamp.*\n*Final Draft:*\nI reach out to steady the lamp, ensuring the flame remains a defiant point of light. "I will weep for the Son who lived," I say, meeting his obsidian gaze, "but I will never weep for your emptiness." I reach for the shad',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );

      setLocalVoiceBaseUrl('http://127.0.0.1:1234/v1');
      const action = await generateLocalPlayerAction('Prompt');
      expect(action).toBe(
        'I reach out to steady the lamp, ensuring the flame remains a defiant point of light. "I will weep for the Son who lived," I say, meeting his obsidian gaze, "but I will never weep for your emptiness."'
      );
    });

    it('still throws EMPTY_PROVIDER_RESPONSE when reasoning contains no salvageable action', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'length',
                  message: {
                    content: '',
                    reasoning_content: '...',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );

      await expect(
        generateLocalPlayerAction('Prompt', { baseUrl: 'http://127.0.0.1:1234/v1' })
      ).rejects.toMatchObject({
        name: 'LocalVoiceError',
        code: 'EMPTY_PROVIDER_RESPONSE',
        status: 502,
      });
    });

    it('throws EMPTY_PROVIDER_RESPONSE if model returns empty action or only fences', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '```\n```' } }],
            }),
            { status: 200 }
          )
        );

      await expect(
        generateLocalPlayerAction('Prompt', { baseUrl: 'http://127.0.0.1:1234/v1' })
      ).rejects.toMatchObject({
        name: 'LocalVoiceError',
        code: 'EMPTY_PROVIDER_RESPONSE',
        status: 502,
      });
    });

    it('throws LOCAL_SERVER_UNAVAILABLE when fetch rejects', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        generateLocalPlayerAction('Prompt', { baseUrl: 'http://127.0.0.1:1234/v1' })
      ).rejects.toMatchObject({
        name: 'LocalVoiceError',
        code: 'LOCAL_SERVER_UNAVAILABLE',
        status: 502,
      });
    });
  });

  describe('generateLocalStructuredResponse', () => {
    const testContract = {
      name: 'TEST_CONTRACT',
      responseJsonSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          status: { type: 'string', enum: ['OK', 'PENDING'] },
        },
        required: ['action', 'status'],
      },
      normalizeProviderPayload: (p: unknown) => p,
      zodSchema: z.object({
        action: z.string(),
        status: z.enum(['OK', 'PENDING']),
      }),
    };

    it('generates, parses, and validates structured response from local endpoint', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '{"action":"Examine item","status":"OK"}',
                    reasoning_content: 'Thinking about output format...',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      globalThis.fetch = fetchMock;
      setLocalVoiceBaseUrl('http://127.0.0.1:1234/v1');
      setLocalVoiceModel('google/gemma-4-e4b');

      const result = await generateLocalStructuredResponse('Prompt', testContract);
      expect(result).toEqual({ action: 'Examine item', status: 'OK' });

      const [url, req] = fetchMock.mock.calls[1];
      expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
      const body = JSON.parse(req.body);
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'test_contract',
          strict: true,
          schema: testContract.responseJsonSchema,
        },
      });
      expect(body.max_tokens).toBe(16384);
    });

    it('strips <think> tags from local model structured response before parsing', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '<think>Reasoning here</think>{"action":"Examine item","status":"OK"}',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );

      const result = await generateLocalStructuredResponse('Prompt', testContract, {
        baseUrl: 'http://127.0.0.1:1234/v1',
      });
      expect(result).toEqual({ action: 'Examine item', status: 'OK' });
    });

    it('throws when local endpoint is unreachable', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      await expect(
        generateLocalStructuredResponse('Prompt', testContract, {
          baseUrl: 'http://127.0.0.1:1234/v1',
        })
      ).rejects.toMatchObject({
        name: 'LocalVoiceError',
        code: 'LOCAL_SERVER_UNAVAILABLE',
        status: 502,
      });
    });
  });

  describe('generateLocalProse', () => {
    it('generates and cleans initialization prose from local endpoint', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '<think>Setting up dread tone</think>The concrete walls weep moisture.',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );

      const prose = await generateLocalProse('Init prompt', {
        baseUrl: 'http://127.0.0.1:1234/v1',
      });
      expect(prose).toBe('The concrete walls weep moisture.');
    });

    it('extracts JSON from reasoning_content if content is empty', async () => {
      const mockContract = {
        name: 'test_turn',
        responseJsonSchema: {},
        normalizeProviderPayload: (p: unknown) => p,
        zodSchema: {
          parse: (data: unknown) => data,
        } as unknown as import('zod').ZodTypeAny,
      };

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-27b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '',
                    reasoning_content:
                      'Thinking about JSON...\n```json\n{"narrative_blocks": [{"type": "prose", "content": "The dark halls"}]}\n```',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );

      const result = await generateLocalStructuredResponse('Prompt', mockContract, {
        baseUrl: 'http://127.0.0.1:1234/v1',
      });
      expect(result).toEqual({
        narrative_blocks: [{ type: 'prose', content: 'The dark halls' }],
      });
    });

    it('throws actionable error if model exhausted reasoning budget without emitting JSON', async () => {
      const mockContract = {
        name: 'test_turn',
        responseJsonSchema: {},
        normalizeProviderPayload: (p: unknown) => p,
        zodSchema: {
          parse: (data: unknown) => data,
        } as unknown as import('zod').ZodTypeAny,
      };

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-27b' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '',
                    reasoning_content: 'Still thinking about how to format the response...',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );

      await expect(
        generateLocalStructuredResponse('Prompt', mockContract, {
          baseUrl: 'http://127.0.0.1:1234/v1',
        })
      ).rejects.toThrow(/exhausted its reasoning budget/);
    });
  });

  describe('normalizeLocalTurnPayload', () => {
    it('adopts castMemberId when dialogue manifestationBlock lacks speaker in cast_activity_proposal', () => {
      const payload = {
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          castMemberId: 'char-ted',
          manifestationBlock: {
            type: 'dialogue',
            content: 'I hear footsteps!',
          },
        },
      };

      type NormalizedPayloadResult = {
        cast_activity_proposal?: { manifestationBlock?: unknown };
        situated_pressure_proposal?: { manifestationBlock?: unknown };
      };

      const result = normalizeLocalTurnPayload(payload) as NormalizedPayloadResult;
      expect(result.cast_activity_proposal?.manifestationBlock).toEqual({
        type: 'dialogue',
        speaker: 'char-ted',
        content: 'I hear footsteps!',
      });
    });

    it('falls back to prose when dialogue manifestationBlock lacks both speaker and castMemberId', () => {
      const payload = {
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          manifestationBlock: {
            type: 'dialogue',
            content: 'A distant scream.',
          },
        },
      };

      type NormalizedPayloadResult = {
        cast_activity_proposal?: { manifestationBlock?: unknown };
        situated_pressure_proposal?: { manifestationBlock?: unknown };
      };

      const result = normalizeLocalTurnPayload(payload) as NormalizedPayloadResult;
      expect(result.cast_activity_proposal?.manifestationBlock).toEqual({
        type: 'prose',
        content: 'A distant scream.',
      });
    });

    it('falls back to prose when dialogue manifestationBlock lacks speaker in situated_pressure_proposal', () => {
      const payload = {
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          manifestationBlock: {
            type: 'dialogue',
            content: 'Warning klaxons blare.',
          },
        },
      };

      type NormalizedPayloadResult = {
        cast_activity_proposal?: { manifestationBlock?: unknown };
        situated_pressure_proposal?: { manifestationBlock?: unknown };
      };

      const result = normalizeLocalTurnPayload(payload) as NormalizedPayloadResult;
      expect(result.situated_pressure_proposal?.manifestationBlock).toEqual({
        type: 'prose',
        content: 'Warning klaxons blare.',
      });
    });

    it('preserves valid dialogue manifestationBlock with speaker intact', () => {
      const payload = {
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          castMemberId: 'char-ted',
          manifestationBlock: {
            type: 'dialogue',
            speaker: 'char-ellen',
            content: 'Stay back!',
          },
        },
      };

      type NormalizedPayloadResult = {
        cast_activity_proposal?: { manifestationBlock?: unknown };
        situated_pressure_proposal?: { manifestationBlock?: unknown };
      };

      const result = normalizeLocalTurnPayload(payload) as NormalizedPayloadResult;
      expect(result.cast_activity_proposal?.manifestationBlock).toEqual({
        type: 'dialogue',
        speaker: 'char-ellen',
        content: 'Stay back!',
      });
    });
  });

  describe('generateLocalText', () => {
    it('sends pure string content when no images are provided and strips <think> tags', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-27b' }] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                { message: { content: '<think>Analyzing scenario...</think>{"status":"success"}' } },
              ],
            }),
            { status: 200 }
          )
        );
      globalThis.fetch = fetchMock;

      const result = await generateLocalText('Analyze this blueprint', {
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'qwen/qwen3.8-27b',
        jsonMode: true,
      });

      expect(result).toBe('{"status":"success"}');
      const chatCall = fetchMock.mock.calls[1];
      const body = JSON.parse(chatCall[1].body);
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'json_output',
          schema: { type: 'object' },
        },
      });
    });

    it('formats multimodal image_url parts when images are provided', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'qwen2.5-vl-7b-instruct' }] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                { message: { content: '{"visual_analysis":"A hand-drawn dungeon map."}' } },
              ],
            }),
            { status: 200 }
          )
        );
      globalThis.fetch = fetchMock;

      const result = await generateLocalText('Describe the attached map', {
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'qwen2.5-vl-7b-instruct',
        images: [
          { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSU' },
          'data:image/jpeg;base64,/9j/4AAQSkZJRgABA',
        ],
      });

      expect(result).toBe('{"visual_analysis":"A hand-drawn dungeon map."}');
      const chatCall = fetchMock.mock.calls[1];
      const body = JSON.parse(chatCall[1].body);
      expect(Array.isArray(body.messages[0].content)).toBe(true);
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'Describe the attached map' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSU' } },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABA' } },
      ]);
    });

    describe('§12 Local Model Token-Budget Fixes', () => {
      it('omits reasoning_effort when jsonMode: true is passed', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [{ id: 'google/gemma-3-27b-it' }] }), { status: 200 })
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
              }),
              { status: 200 }
            )
          );
        globalThis.fetch = fetchMock;

        await generateLocalText('Provide json', {
          baseUrl: 'http://127.0.0.1:1234/v1',
          model: 'google/gemma-3-27b-it',
          jsonMode: true,
        });

        const chatCall = fetchMock.mock.calls[1];
        const body = JSON.parse(chatCall[1].body);
        expect(body.reasoning_effort).toBeUndefined();
      });

      it('retries once with 50% cap bump when finish_reason is length', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [{ id: 'google/gemma-3-27b-it' }] }), { status: 200 })
          )
          // Attempt 1: Truncated on length
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [{ finish_reason: 'length', message: { content: '{"incomplete":' } }],
              }),
              { status: 200 }
            )
          )
          // Attempt 2: Success with bumped cap
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [{ finish_reason: 'stop', message: { content: '{"complete": true}' } }],
              }),
              { status: 200 }
            )
          );
        globalThis.fetch = fetchMock;

        const res = await generateLocalText('Extract structured facts', {
          baseUrl: 'http://127.0.0.1:1234/v1',
          model: 'google/gemma-3-27b-it',
          jsonMode: true,
          max_tokens: 4000,
        });

        expect(res).toBe('{"complete": true}');
        expect(fetchMock).toHaveBeenCalledTimes(3);

        const attempt1 = JSON.parse(fetchMock.mock.calls[1][1].body);
        const attempt2 = JSON.parse(fetchMock.mock.calls[2][1].body);

        expect(attempt1.max_tokens).toBe(4000);
        expect(attempt2.max_tokens).toBe(6000); // 4000 * 1.5
      });

      it('throws plain-language error when second attempt also truncates on length', async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [{ id: 'small-model' }] }), { status: 200 })
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [{ finish_reason: 'length', message: { content: 'part 1' } }],
              }),
              { status: 200 }
            )
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [{ finish_reason: 'length', message: { content: 'part 2' } }],
              }),
              { status: 200 }
            )
          );
        globalThis.fetch = fetchMock;

        await expect(
          generateLocalText('Too big', {
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'small-model',
          })
        ).rejects.toThrow('The local model ran out of output space twice on text generation');
      });

      it('structured response retries once on length and throws plain error on double exhaustion', async () => {
        const contract = {
          name: 'testContract',
          responseJsonSchema: { type: 'object' },
          zodSchema: z.object({ value: z.string() }),
          normalizeProviderPayload: (x: unknown) => x,
        };

        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [{ id: 'engine-model' }] }), { status: 200 })
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [{ finish_reason: 'length', message: { content: '{"val' } }],
              }),
              { status: 200 }
            )
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [{ finish_reason: 'length', message: { content: '{"val' } }],
              }),
              { status: 200 }
            )
          );
        globalThis.fetch = fetchMock;

        await expect(
          generateLocalStructuredResponse(
            'test turn',
            contract as unknown as Parameters<typeof generateLocalStructuredResponse>[1],
            {
              baseUrl: 'http://127.0.0.1:1234/v1',
              model: 'engine-model',
            }
          )
        ).rejects.toThrow('The local model ran out of output space twice on structured turn generation');
      });
    });
  });
});


