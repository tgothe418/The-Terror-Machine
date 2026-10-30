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
import { TurnResultSchema, EngineTurnContextSchema } from '../../src/types/engineContract';
import {
  normalizeGeminiTurnProviderPayload,
  type CastNormalizationContext,
} from '../ai/geminiTurnTransport';
import {
  buildAuditoryContext,
  validateAndNormalizeVocalization,
} from '../../src/lib/vocalizationEngine';
import { resolveSituatedPressure } from '../../src/lib/situatedPressure';
import { resolveCastActivity } from '../../src/lib/castActivity';
import { getEngineProvider, setEngineProvider } from '../ai/modelPolicy';
import { handleStreamTurnRequest } from '../routes/turn';
import type { Request, Response as ExpressResponse } from 'express';

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
        chat_template_kwargs: { enable_thinking: false, thinking: false },
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

    it('defaults sourceReference to ACTIVITY when cast_activity_proposal is present', () => {
      const payload = {
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          castMemberId: 'char-ted',
        },
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          valueAnchorId: 'anchor-safety',
          operator: 'THREATEN',
          affectedDimension: 'PHYSICAL_SURVIVAL',
          adverseProspect: 'Imminent collapse',
        },
      };

      type NormalizedPayloadResult = {
        situated_pressure_proposal?: { sourceReference?: string };
      };

      const result = normalizeLocalTurnPayload(payload) as NormalizedPayloadResult;
      expect(result.situated_pressure_proposal?.sourceReference).toBe('ACTIVITY');
    });

    it('defaults sourceReference to first authority reference when authorityReferences exist without activity', () => {
      const payload = {
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          valueAnchorId: 'anchor-safety',
          operator: 'THREATEN',
          affectedDimension: 'PHYSICAL_SURVIVAL',
          adverseProspect: 'Imminent collapse',
          authorityReferences: ['RULE_STRUCTURAL_INTEGRITY'],
        },
      };

      type NormalizedPayloadResult = {
        situated_pressure_proposal?: { sourceReference?: string };
      };

      const result = normalizeLocalTurnPayload(payload) as NormalizedPayloadResult;
      expect(result.situated_pressure_proposal?.sourceReference).toBe('RULE_STRUCTURAL_INTEGRITY');
    });

    it('defaults sourceReference to BASELINE when no activity or authority references exist', () => {
      const payload = {
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          valueAnchorId: 'anchor-safety',
          operator: 'THREATEN',
          affectedDimension: 'PHYSICAL_SURVIVAL',
          adverseProspect: 'Imminent collapse',
        },
      };

      type NormalizedPayloadResult = {
        situated_pressure_proposal?: { sourceReference?: string };
      };

      const result = normalizeLocalTurnPayload(payload) as NormalizedPayloadResult;
      expect(result.situated_pressure_proposal?.sourceReference).toBe('BASELINE');
    });

    it('preserves authored sourceReference when already present', () => {
      const payload = {
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          valueAnchorId: 'anchor-safety',
          operator: 'THREATEN',
          affectedDimension: 'PHYSICAL_SURVIVAL',
          adverseProspect: 'Imminent collapse',
          sourceReference: 'CUSTOM_THREAT_SOURCE',
        },
      };

      type NormalizedPayloadResult = {
        situated_pressure_proposal?: { sourceReference?: string };
      };

      const result = normalizeLocalTurnPayload(payload) as NormalizedPayloadResult;
      expect(result.situated_pressure_proposal?.sourceReference).toBe('CUSTOM_THREAT_SOURCE');
    });

    it('repairs 2026-10-22.1.log Prediction #12/#13 scenario (PRESSURE missing valueAnchorId + player-speaker dialogue in non-solitary scene) through TurnResultSchema, vocalization, and situatedPressure', () => {
      const turnContext = EngineTurnContextSchema.parse({
        scenario: {
          title: 'Sub-Level 9',
          premise: 'A deep facility under lockdown.',
          setting: {},
        },
        player: {
          role: 'protagonist',
          characterId: 'char-elena',
          name: 'Dr. Elena Rostova',
        },
        cast: [
          {
            id: 'char-elena',
            name: 'Dr. Elena Rostova',
            isUserCharacter: true,
            isPresent: true,
          },
          {
            id: 'char-holt',
            name: 'Marcus Holt',
            isUserCharacter: false,
            isPresent: true,
          },
        ],
        topology: {
          currentNodeId: 'node-control-room',
          readableNodeLabel: 'Control Room',
        },
        runtime: {},
      });

      const normContext: CastNormalizationContext = {
        scenarioCastIds: ['char-elena', 'char-holt'],
        activeCastIds: ['char-holt'],
        playerCharacterId: 'char-elena',
        playerCharacterName: 'Dr. Elena Rostova',
        currentNodeId: 'node-control-room',
        isSystemInit: false,
        isSolitary: false,
        authorizedSpeakerNames: ['Marcus Holt', 'char-holt'],
        relevantValueAnchorIds: [],
      };

      const rawPayload = {
        narrative_blocks: [
          {
            type: 'prose',
            content: 'The emergency bulkhead shudders as the pressure gauge spikes.',
          },
          {
            type: 'dialogue',
            speaker: 'Dr. Elena Rostova',
            content: 'Holt, help me brace the manual override!',
          },
          {
            type: 'dialogue',
            speaker: 'Marcus Holt',
            content: 'The hydraulic line is sheared—step back!',
          },
        ],
        intent_proposal: {
          action_kind: 'MANIPULATE',
          action_subtype: null,
          pressure_direction: 'ESCALATE',
          dramatic_tactic: 'EXPOSURE',
          intent_synergy: 'SUCCESS',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'WITHIN_CONTRACT',
          memory_echo_candidate: null,
        },
        consequence_proposal: { mutations: [] },
        character_stance_proposal: { changes: [] },
        character_relationship_proposal: { changes: [] },
        character_memory_proposal: { candidates: [] },
        world_memory_proposal: { candidates: [] },
        cast_activity_proposal: {
          kind: 'NONE',
          reason: 'No independent cast activity.',
        },
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          proposalId: 'prop-press-log-12',
          // valueAnchorId intentionally omitted (Prediction #12/#13 failure mode)
          sourceReference: 'BASELINE',
          operator: 'CLOSE_DISTANCE',
          affectedDimension: 'SAFETY',
          adverseProspect: 'Bulkhead seal may rupture under pressure.',
          responseWindowOpen: true,
        },
        value_state_proposal: { changes: [] },
        character_pursuit_proposal: { changes: [] },
        character_development_proposal: { changes: [] },
        pressure_transition_proposal: { transitions: [] },
        logic_state: {
          current_phase: 'MANIFEST',
          requested_transition: null,
          suggested_tension: 65,
          terminal_flags: [],
          cast_deltas: [],
        },
      };

      const normalized = normalizeLocalTurnPayload(
        rawPayload,
        normalizeGeminiTurnProviderPayload,
        normContext
      );

      const parsed = TurnResultSchema.parse(normalized);
      expect(parsed.situated_pressure_proposal.kind).toBe('PRESSURE');
      if (parsed.situated_pressure_proposal.kind === 'PRESSURE') {
        expect(parsed.situated_pressure_proposal.valueAnchorId).toBe('UNSPECIFIED_ANCHOR');
      }

      // Player dialogue block was downgraded to prose; Marcus Holt's dialogue block remains the sole dialogue block
      expect(parsed.narrative_blocks[1].type).toBe('prose');
      expect(parsed.narrative_blocks[2].type).toBe('dialogue');
      expect(parsed.narrative_blocks[2].speaker).toBe('Marcus Holt');

      const auditoryContext = buildAuditoryContext(turnContext, 'Brace the override');
      const vocalizationResult = validateAndNormalizeVocalization(
        parsed.narrative_blocks,
        auditoryContext
      );
      expect(vocalizationResult.error).toBeNull();
      expect(vocalizationResult.normalizedBlocks).toHaveLength(3);

      const pressureReceipt = resolveSituatedPressure({
        proposal: parsed.situated_pressure_proposal,
        currentContext: turnContext,
        preThreads: [],
        currentTurn: 1,
      });
      expect(pressureReceipt.outcome).toBe('REJECTED');
      expect(pressureReceipt.reasonCode).toBe('VALUE_ANCHOR_NOT_FOUND');
    });

    it('completes incomplete cast_activity_proposal (kind: ACTIVITY missing castMemberId and activitySummary) so TurnResultSchema.parse succeeds', () => {
      const rawPayload = {
        narrative_blocks: [{ type: 'prose', content: 'A shadow shifts in the corridor.' }],
        intent_proposal: {
          action_kind: 'OBSERVE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'NOT_REQUIRED',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'WITHIN_CONTRACT',
          memory_echo_candidate: null,
        },
        consequence_proposal: { mutations: [] },
        character_stance_proposal: { changes: [] },
        character_relationship_proposal: { changes: [] },
        character_memory_proposal: { candidates: [] },
        world_memory_proposal: { candidates: [] },
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          reason: 'Stray neutral reason field',
          // castMemberId and activitySummary omitted
        },
        situated_pressure_proposal: { kind: 'NONE' },
        value_state_proposal: { changes: [] },
        character_pursuit_proposal: { changes: [] },
        character_development_proposal: { changes: [] },
        pressure_transition_proposal: { transitions: [] },
        logic_state: {
          current_phase: 'LATENT',
          requested_transition: null,
          suggested_tension: 20,
          terminal_flags: [],
          cast_deltas: [],
        },
      };

      const normalized = normalizeLocalTurnPayload(
        rawPayload,
        normalizeGeminiTurnProviderPayload
      );
      const parsed = TurnResultSchema.parse(normalized);
      expect(parsed.cast_activity_proposal.kind).toBe('ACTIVITY');
      if (parsed.cast_activity_proposal.kind === 'ACTIVITY') {
        expect(parsed.cast_activity_proposal.castMemberId).toBe('UNSPECIFIED_CAST_MEMBER');
        expect(parsed.cast_activity_proposal.activitySummary).toBe('Unspecified cast activity.');
        expect(parsed.cast_activity_proposal.perceptionPath).toBe('DIRECT');
      }
    });

    it('normalizes multiple dialogue blocks so only the first remains dialogue and subsequent ones become prose (including player mutter after NPC dialogue)', () => {
      const payload = {
        narrative_blocks: [
          { type: 'dialogue', speaker: 'Marcus Holt', content: 'Check the left corridor.' },
          { type: 'dialogue', speaker: 'Maren Ross', content: 'I already locked it.' },
          { type: 'dialogue', speaker: 'Marcus Holt', content: 'Check it again!' },
        ],
      };

      const result = normalizeLocalTurnPayload(payload) as {
        narrative_blocks: Array<{ type: string; speaker: string | null; content: string }>;
      };

      expect(result.narrative_blocks).toHaveLength(3);
      expect(result.narrative_blocks[0].type).toBe('dialogue');
      expect(result.narrative_blocks[0].speaker).toBe('Marcus Holt');
      expect(result.narrative_blocks[1].type).toBe('prose');
      expect(result.narrative_blocks[1].speaker).toBeNull();
      expect(result.narrative_blocks[2].type).toBe('prose');
      expect(result.narrative_blocks[2].speaker).toBeNull();

      // Also verify NPC dialogue followed by player mutter dialogue block is capped at 1 dialogue block
      const turnContext = EngineTurnContextSchema.parse({
        scenario: { title: 'Sub-Level 9', premise: 'Lockdown.', setting: {} },
        player: { role: 'protagonist', characterId: 'char-elena', name: 'Dr. Elena Rostova' },
        cast: [
          { id: 'char-elena', name: 'Dr. Elena Rostova', isUserCharacter: true, isPresent: true },
          { id: 'char-holt', name: 'Marcus Holt', isUserCharacter: false, isPresent: true },
        ],
        topology: { currentNodeId: 'node-1', readableNodeLabel: 'Corridor' },
        runtime: {},
      });
      const normContext: CastNormalizationContext = {
        scenarioCastIds: ['char-elena', 'char-holt'],
        activeCastIds: ['char-holt'],
        playerCharacterId: 'char-elena',
        playerCharacterName: 'Dr. Elena Rostova',
        currentNodeId: 'node-1',
        isSystemInit: false,
        isSolitary: false,
        authorizedSpeakerNames: ['Marcus Holt', 'char-holt'],
      };
      const npcThenPlayerMutter = normalizeLocalTurnPayload(
        {
          narrative_blocks: [
            { type: 'dialogue', speaker: 'Marcus Holt', content: 'Stay behind me.' },
            {
              type: 'dialogue',
              speaker: 'Dr. Elena Rostova',
              delivery: 'mutter',
              content: 'This cannot be happening...',
            },
          ],
        },
        normalizeGeminiTurnProviderPayload,
        normContext
      ) as { narrative_blocks: Array<{ type: string; speaker: string | null; content: string }> };

      expect(npcThenPlayerMutter.narrative_blocks[0].type).toBe('dialogue');
      expect(npcThenPlayerMutter.narrative_blocks[1].type).toBe('prose');

      const auditoryContext = buildAuditoryContext(turnContext, 'Follow Holt');
      const vocalizationResult = validateAndNormalizeVocalization(
        npcThenPlayerMutter.narrative_blocks,
        auditoryContext
      );
      expect(vocalizationResult.error).toBeNull();
    });

    it('repairs world_memory_proposal with scope NODE and null node_id via currentNodeId or downgrades to GLOBAL', () => {
      const payloadWithNullNode = {
        world_memory_proposal: {
          candidates: [
            {
              kind: 'ENVIRONMENTAL_CONDITION',
              scope: 'NODE',
              node_id: null,
              statement: 'Coolant mist coats the floor grates.',
              rationale: 'Pipe ruptured during turn.',
            },
          ],
        },
      };

      const repairedWithNode = normalizeLocalTurnPayload(
        payloadWithNullNode,
        normalizeGeminiTurnProviderPayload,
        {
          scenarioCastIds: [],
          activeCastIds: [],
          currentNodeId: 'node-reactor-bay',
        }
      ) as {
        world_memory_proposal: {
          candidates: Array<{ scope: string; node_id: string | null }>;
        };
      };

      expect(repairedWithNode.world_memory_proposal.candidates[0].scope).toBe('NODE');
      expect(repairedWithNode.world_memory_proposal.candidates[0].node_id).toBe('node-reactor-bay');

      const downgradedToGlobal = normalizeLocalTurnPayload(
        payloadWithNullNode,
        normalizeGeminiTurnProviderPayload
      ) as {
        world_memory_proposal: {
          candidates: Array<{ scope: string; node_id: string | null }>;
        };
      };

      expect(downgradedToGlobal.world_memory_proposal.candidates[0].scope).toBe('GLOBAL');
      expect(downgradedToGlobal.world_memory_proposal.candidates[0].node_id).toBeNull();
    });

    it('recovers sole relevantValueAnchorId, downgrades unauthorized speakers while preserving ambient speakers, truncates overlong strings, and deterministically rejects fallback cast activity', () => {
      const turnContext = EngineTurnContextSchema.parse({
        scenario: { title: 'Test', premise: 'Test', setting: {} },
        player: { role: 'protagonist', characterId: 'char-player', name: 'Alex' },
        cast: [
          {
            id: 'char-player',
            name: 'Alex',
            isUserCharacter: true,
            isPresent: true,
          },
          {
            id: 'char-hound',
            name: 'Subject Hound',
            isUserCharacter: false,
            isPresent: true,
            expressionProfile: {
              communicationModes: ['nonverbal'],
              expressionGuidance: 'Growls and clicks.',
            },
          },
        ],
        topology: { currentNodeId: 'node-1', readableNodeLabel: 'Hallway' },
        runtime: {},
      });

      const normContext: CastNormalizationContext = {
        scenarioCastIds: ['char-player', 'char-hound'],
        activeCastIds: ['char-hound'],
        playerCharacterId: 'char-player',
        playerCharacterName: 'Alex',
        currentNodeId: 'node-1',
        isSystemInit: false,
        isSolitary: true,
        authorizedSpeakerNames: [], // Subject Hound is nonverbal only
        relevantValueAnchorIds: ['anchor-sole-survival'],
      };

      const rawPayload = {
        narrative_blocks: [
          { type: 'dialogue', speaker: 'Subject Hound', content: 'I should not speak.' },
          { type: 'dialogue', speaker: 'Security Guard', content: 'Halt right there!' },
        ],
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          castMemberId: 'char-hallucinated',
          activitySummary: 'A'.repeat(600),
        },
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          operator: 'non_standard_operator',
          affectedDimension: 'non_standard_dimension',
          adverseProspect: 'B'.repeat(600),
        },
        reconciliation_proposal: {
          memory_echo_candidate: 'E'.repeat(300),
        },
      };

      const normalized = normalizeLocalTurnPayload(
        rawPayload,
        normalizeGeminiTurnProviderPayload,
        normContext
      ) as {
        narrative_blocks: Array<{ type: string; speaker: string | null; content: string }>;
        situated_pressure_proposal: {
          valueAnchorId: string;
          operator: string;
          affectedDimension: string;
          adverseProspect: string;
        };
        reconciliation_proposal: {
          memory_echo_candidate: string;
        };
        cast_activity_proposal: Parameters<typeof resolveCastActivity>[0]['proposal'] & {
          castMemberId: string;
          activitySummary: string;
        };
      };

      // Nonverbal Subject Hound downgraded to prose; ambient Security Guard preserved as sole dialogue
      expect(normalized.narrative_blocks[0].type).toBe('prose');
      expect(normalized.narrative_blocks[1].type).toBe('dialogue');
      expect(normalized.narrative_blocks[1].speaker).toBe('Security Guard');

      // Sole valueAnchorId recovered; non-standard enums normalized to OTHER; adverseProspect truncated to 500
      expect(normalized.situated_pressure_proposal.valueAnchorId).toBe('anchor-sole-survival');
      expect(normalized.situated_pressure_proposal.operator).toBe('OTHER');
      expect(normalized.situated_pressure_proposal.affectedDimension).toBe('OTHER');
      expect(normalized.situated_pressure_proposal.adverseProspect.length).toBe(500);

      // Overlong memory_echo_candidate truncated to 240
      expect(normalized.reconciliation_proposal.memory_echo_candidate.length).toBe(240);

      // Hallucinated castMemberId stripped by roster check, then filled with UNSPECIFIED_CAST_MEMBER and rejected by resolveCastActivity
      expect(normalized.cast_activity_proposal.castMemberId).toBe('UNSPECIFIED_CAST_MEMBER');
      expect(normalized.cast_activity_proposal.activitySummary.length).toBe(500);
      const actReceipt = resolveCastActivity({
        proposal: normalized.cast_activity_proposal,
        currentContext: turnContext,
        preEvents: [],
        currentTurn: 1,
      });
      expect(actReceipt.outcome).toBe('REJECTED');
      expect(actReceipt.reasonCode).toBe('ACTOR_NOT_IN_AUTHORIZED_CAST');
    });

    it('executes handleStreamTurnRequest end-to-end with ENGINE_PROVIDER=local, proving turn.ts normalizationContext repairs 2026-10-22.1.log payload', async () => {
      const prevProvider = getEngineProvider();
      setEngineProvider('local');
      setLocalVoiceBaseUrl('http://127.0.0.1:1234/v1');
      setLocalVoiceModel('google/gemma-4-26b-a4b');

      try {
        const rawLocalModelOutput = {
          narrative_blocks: [
            {
              type: 'prose',
              content: 'The emergency bulkhead shudders as the pressure gauge spikes.',
            },
            {
              type: 'dialogue',
              speaker: 'Dr. Elena Rostova',
              content: 'Holt, help me brace the manual override!',
            },
            {
              type: 'dialogue',
              speaker: 'Marcus Holt',
              content: 'The hydraulic line is sheared—step back!',
            },
          ],
          intent_proposal: {
            action_kind: 'MANIPULATE',
            action_subtype: null,
            pressure_direction: 'ESCALATE',
            dramatic_tactic: 'EXPOSURE',
            intent_synergy: 'SUCCESS',
          },
          reconciliation_proposal: {
            mode: 'CANONICAL',
            feasibility: 'SUPPORTED',
            reason_code: 'NONE',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'WITHIN_CONTRACT',
            memory_echo_candidate: null,
          },
          consequence_proposal: { mutations: [] },
          character_stance_proposal: { changes: [] },
          character_relationship_proposal: { changes: [] },
          character_memory_proposal: { candidates: [] },
          world_memory_proposal: {
            candidates: [
              {
                kind: 'ENVIRONMENTAL_CONDITION',
                scope: 'NODE',
                node_id: null,
                statement: 'Hydraulic fluid pools across the control room deck.',
                rationale: 'Sheared line during turn.',
              },
            ],
          },
          cast_activity_proposal: {
            kind: 'ACTIVITY',
            // castMemberId and activitySummary omitted
          },
          situated_pressure_proposal: {
            kind: 'PRESSURE',
            // valueAnchorId omitted
            sourceReference: 'BASELINE',
            operator: 'CLOSE_DISTANCE',
            affectedDimension: 'SAFETY',
            adverseProspect: 'Bulkhead seal may rupture under pressure.',
            responseWindowOpen: true,
          },
          value_state_proposal: { changes: [] },
          character_pursuit_proposal: { changes: [] },
          character_development_proposal: { changes: [] },
          pressure_transition_proposal: { transitions: [] },
          logic_state: {
            current_phase: 'MANIFEST',
            requested_transition: null,
            suggested_tension: 65,
            terminal_flags: [],
            cast_deltas: [],
          },
        };

        globalThis.fetch = vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({ data: [{ id: 'google/gemma-4-26b-a4b' }] }),
              { status: 200 }
            )
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: 'stop',
                    message: { content: JSON.stringify(rawLocalModelOutput) },
                  },
                ],
              }),
              { status: 200 }
            )
          );

        const sseChunks: string[] = [];
        const mockReq = {
          body: {
            userAction: 'I brace the manual override lever.',
            recentHistory: 'The alarm klaxon echoes.',
            systemDirective: 'Maintain tension.',
            isExpansionExpected: false,
            stateContext: {
              currentNodeId: 'node-control-room',
              currentPhase: 'MANIFEST',
              tensionLevel: 6,
              reconciliationRevision: 0,
            },
            context: {
              version: 1,
              scenario: {
                title: 'Sub-Level 9',
                premise: 'A deep facility under lockdown.',
                worldRules: [],
                setting: { location: 'Sub-Level 9', atmosphere: 'Tense', timePeriod: '2026' },
                startingVector: 'COGNITIVE',
                startingTier: 'LATENT',
                incitingIncident: 'Lockdown',
                pacingDirective: 'Steady',
                keyPlotElements: [],
              },
              player: {
                role: 'protagonist',
                characterId: 'char-elena',
                name: 'Dr. Elena Rostova',
                description: 'Chief Engineer',
                isEntity: false,
              },
              cast: [
                {
                  id: 'char-elena',
                  name: 'Dr. Elena Rostova',
                  isUserCharacter: true,
                  isPresent: true,
                },
                {
                  id: 'char-holt',
                  name: 'Marcus Holt',
                  isUserCharacter: false,
                  isPresent: true,
                },
              ],
              topology: {
                currentNodeId: 'node-control-room',
                readableNodeLabel: 'Control Room',
                allowedOutgoingExits: [],
              },
              runtime: {
                phase: 'MANIFEST',
                tension: 6,
                coherence: 1.0,
                reconciliationRevision: 0,
                activeVector: 'COGNITIVE',
                activeTier: 'LATENT',
                activeFlags: [],
                turnNumber: 1,
              },
              horrorGrammar: {
                fictionalTime: {
                  moment_revision: 0,
                  scene_beat_revision: 0,
                  extended_revision: 0,
                  last_cost: null,
                },
                activityEligibility: {
                  version: 1,
                  presentOpportunities: [],
                  offscreenOpportunities: [],
                  boundedOutPursuitIds: [],
                  dormantCount: 0,
                  notDueCount: 0,
                  ledgerSnapshot: {
                    moment_revision: 0,
                    scene_beat_revision: 0,
                    extended_revision: 0,
                    last_cost: null,
                  },
                  scheduleSnapshotRevision: 0,
                },
                presentActorOpportunities: [],
                offscreenPursuitOpportunities: [],
                relevantValueAnchors: [],
                authorityInstruction: 'Standard authority',
                runtimeState: {
                  fictionalTime: {
                    moment_revision: 0,
                    scene_beat_revision: 0,
                    extended_revision: 0,
                    last_cost: null,
                  },
                  pursuitSchedule: {},
                  recentActivityEvents: [],
                  activePressureThreads: [],
                  valueState: {},
                  characterPursuits: {},
                  characterDevelopment: {},
                },
                authoringBaseline: {
                  valueBaselineReview: 'REVIEWED',
                  pursuitReviews: {},
                  valueAnchors: [],
                  characterPursuits: [],
                },
              },
            },
          },
          on: vi.fn(),
        } as unknown as Request;

        const mockRes = {
          writeHead: vi.fn(),
          write: vi.fn((chunk: string) => {
            sseChunks.push(chunk);
            return true;
          }),
          end: vi.fn(),
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as unknown as ExpressResponse;

        await handleStreamTurnRequest(mockReq, mockRes);

        const joinedSse = sseChunks.join('');
        expect(joinedSse).toContain('event: complete');
        expect(joinedSse).not.toContain('event: error');

        const completeMatch = joinedSse.match(/event: complete\ndata: (.*)\n\n/);
        expect(completeMatch).not.toBeNull();
        const finalResponse = JSON.parse(completeMatch![1]);

        // Player dialogue downgraded to prose; Marcus Holt's dialogue preserved
        expect(finalResponse.narrative_blocks[1].type).toBe('prose');
        expect(finalResponse.narrative_blocks[2].type).toBe('dialogue');
        expect(finalResponse.narrative_blocks[2].speaker).toBe('Marcus Holt');

        // Situated pressure missing valueAnchorId rejected cleanly with VALUE_ANCHOR_NOT_FOUND
        expect(finalResponse.situatedPressureReceipt.outcome).toBe('REJECTED');
        expect(finalResponse.situatedPressureReceipt.reasonCode).toBe('VALUE_ANCHOR_NOT_FOUND');

        // World memory NODE candidate missing node_id repaired with currentNodeId ('node-control-room')
        expect(finalResponse.worldMemoryReceipt.decisions[0].outcome).toBe('APPLIED');
        expect(finalResponse.worldMemoryReceipt.post_state[0].node_id).toBe('node-control-room');
      } finally {
        setEngineProvider(prevProvider);
      }
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


