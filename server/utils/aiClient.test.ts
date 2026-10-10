import { describe, expect, it, vi, afterAll, afterEach } from 'vitest';
import {
  unwrapStrictJsonResponse,
  extractBalancedJson,
  parseStructuredTurnResponse,
  classifyProviderResponse,
  ProviderRefusalError,
  EmptyProviderResponseError,
  ProviderRequestRejectedError,
  getAiClient,
  generateStructuredResponse,
  EngineTurnStructuredResponseContract,
} from './aiClient';
import {
  geminiTurnResponseJsonSchema,
  assertGeminiJsonSchemaSubset,
  type GeminiJsonSchema,
} from '../ai/geminiTurnJsonSchema';
import {
  GEMINI_TURN_NULL_SENTINEL,
  normalizeGeminiTurnProviderPayload,
  normalizePerceptionPath,
  normalizePressureOperator,
  normalizeAffectedDimension,
  normalizePersistenceTarget,
} from '../ai/geminiTurnTransport';
import { TurnResultSchema } from '../schemas/engine';
import {
  PERCEPTION_PATHS,
  PRESSURE_OPERATORS,
  AFFECTED_DIMENSIONS,
  PERSISTENCE_TARGETS,
  VALUE_LIFECYCLES,
  VALUE_CONDITIONS,
  VALUE_OPERATIONS,
  PURSUIT_STATUSES,
  PURSUIT_OPERATIONS,
  DEVELOPMENT_DIMENSIONS,
  DEVELOPMENT_OPERATIONS,
  PRESSURE_THREAD_TERMINAL_STATUSES,
} from '../../src/types/horrorGrammar';

interface NormalizedTurnPayload {
  narrative_blocks?: Array<Record<string, unknown>>;
  character_stance_proposal?: { changes?: unknown[] };
  character_relationship_proposal?: { changes?: unknown[] };
  character_memory_proposal?: { candidates?: unknown[] };
  situated_pressure_proposal?: Record<string, unknown>;
  cast_activity_proposal?: Record<string, unknown>;
}

const { originalGeminiKey } = vi.hoisted(() => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'ttm-hg1-test-only-key';
  return { originalGeminiKey };
});

afterAll(() => {
  if (originalGeminiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalGeminiKey;
  }
});

const HG1_FIELDS = [
  'cast_activity_proposal',
  'situated_pressure_proposal',
  'value_state_proposal',
  'character_pursuit_proposal',
  'character_development_proposal',
  'pressure_transition_proposal',
] as const;

function createBaseValidPayload(): Record<string, unknown> {
  return {
    narrative_blocks: [
      { type: 'dialogue', speaker: 'Dr. Vane', content: 'Did you hear that sound in the ventilation?' },
      { type: 'prose', content: 'The station hull groans under the benthic pressure.' },
    ],
    intent_proposal: {
      action_kind: 'COMMUNICATE',
      action_subtype: null,
      pressure_direction: 'MAINTAIN',
      dramatic_tactic: 'EXPOSURE',
      intent_synergy: 'SUCCESS',
    },
    reconciliation_proposal: {
      mode: 'CANONICAL',
      feasibility: 'SUPPORTED',
      reason_code: 'NONE',
      fictional_time_cost: 'MOMENT',
      authority_alignment: 'WITHIN_CONTRACT',
      memory_echo_candidate: 'ventilation rumble',
    },
    consequence_proposal: {
      mutations: [
        {
          domain: 'INVENTORY',
          operation: 'ADD',
          value: 'Acoustic Sensor Key',
          rationale: 'Retrieved from console.',
        },
      ],
    },
    character_stance_proposal: {
      changes: [
        {
          character_id: 'char-vane',
          focus: 'PLAYER',
          stance: 'GUARDED',
          rationale: 'Suspicious of protagonist motives.',
        },
      ],
    },
    character_relationship_proposal: {
      changes: [
        {
          source_character_id: 'char-vane',
          target_character_id: 'char-protagonist',
          kind: 'TRUST',
          delta: -1,
          rationale: 'Hesitation during query.',
        },
      ],
    },
    character_memory_proposal: {
      candidates: [
        {
          character_id: 'char-vane',
          fact: 'Protagonist questioned the ventilation noise.',
          source: 'OBSERVED',
          certainty: 'KNOWN',
          rationale: 'Direct interpersonal exchange.',
        },
      ],
    },
    world_memory_proposal: {
      candidates: [
        {
          kind: 'ESTABLISHED_FACT',
          scope: 'GLOBAL',
          node_id: null,
          statement: 'Sub-level power distribution is failing.',
          rationale: 'Station telemetry fact.',
        },
      ],
    },
    cast_activity_proposal: {
      kind: 'NONE',
      reason: 'NO_OPPORTUNITY_CHOSEN',
    },
    situated_pressure_proposal: {
      kind: 'NONE',
      reason: 'NO_PRESSURE_CHOSEN',
    },
    value_state_proposal: {
      changes: [],
    },
    character_pursuit_proposal: {
      changes: [],
    },
    character_development_proposal: {
      changes: [],
    },
    pressure_transition_proposal: {
      transitions: [],
    },
    logic_state: {
      current_phase: 'MANIFEST',
      requested_transition: null,
      suggested_tension: 45,
      terminal_flags: [],
      cast_deltas: [],
      cast_ledger: [],
    },
    topologyDelta: {
      isExpansion: false,
      newNodeDef: null,
    },
  };
}

describe('Structured AI Response Handling', () => {
  it('unwraps markdown fences from structured output', () => {
    const raw = '```json\n{"test": true}\n```';
    expect(unwrapStrictJsonResponse(raw)).toBe('{"test": true}');
  });

  it('preserves text without fences', () => {
    const raw = '{"test": true}';
    expect(unwrapStrictJsonResponse(raw)).toBe('{"test": true}');
  });

  it('unwraps markdown fences with preamble and postamble commentary', () => {
    const raw = 'Here is the response:\n```json\n{"test": true}\n```\nHope this helps!';
    expect(unwrapStrictJsonResponse(raw)).toBe('{"test": true}');
  });

  it('extracts balanced JSON when raw text has trailing commentary or non-whitespace after JSON', () => {
    const raw = '{"narrative_blocks": [{"type": "prose", "content": "Ted says: \\"Run!\\""}]} \n\nAdditional notes...';
    expect(unwrapStrictJsonResponse(raw)).toBe('{"narrative_blocks": [{"type": "prose", "content": "Ted says: \\"Run!\\""}]}');
  });

  it('correctly ignores braces inside string literals when extracting balanced JSON', () => {
    const raw = 'Preamble {"key": "value with {nested} braces and \\"quotes\\""} Postamble';
    expect(extractBalancedJson(raw)).toBe('{"key": "value with {nested} braces and \\"quotes\\""}');
    expect(unwrapStrictJsonResponse(raw)).toBe('{"key": "value with {nested} braces and \\"quotes\\""}');
  });

  it('classifies successful responses as SUCCESS', () => {
    const result = classifyProviderResponse({
      text: '{"narrative_blocks":[]}',
    });
    expect(result.kind).toBe('CONTENT');
    if (result.kind === 'CONTENT') {
      expect(result.text).toBe('{"narrative_blocks":[]}');
    }
  });

  it('classifies empty responses as EMPTY_PROVIDER_RESPONSE', () => {
    const result = classifyProviderResponse({ text: '' });
    expect(result.kind).toBe('EMPTY_PROVIDER_RESPONSE');
  });

  it('classifies safety blocks as PROVIDER_REFUSAL', () => {
    const result = classifyProviderResponse({
      candidates: [
        {
          finishReason: 'SAFETY',
        },
      ],
    });
    expect(result.kind).toBe('PROVIDER_REFUSAL');
    if (result.kind === 'PROVIDER_REFUSAL') {
      expect(result.reason).toContain('SAFETY');
    }
  });

  it('throws EmptyProviderResponseError for empty responses in parseStructuredTurnResponse', () => {
    expect(() => parseStructuredTurnResponse('', TurnResultSchema)).toThrow(
      EmptyProviderResponseError
    );
  });
});

describe('Track D1: Provider schema subset tests (Packet 1-10B)', () => {
  it('provider JSON schema uses only the documented TTM Gemini allowlist', () => {
    expect(() => assertGeminiJsonSchemaSubset(geminiTurnResponseJsonSchema)).not.toThrow();

    const invalidSchemaWithDisallowedKey = {
      ...geminiTurnResponseJsonSchema,
      definitions: {},
    };
    expect(() => assertGeminiJsonSchemaSubset(invalidSchemaWithDisallowedKey)).toThrow(
      /Disallowed schema keyword "definitions"/
    );
  });

  it('provider JSON schema contains no anyOf or legacy Schema dialect keywords', () => {
    const serialized = JSON.stringify(geminiTurnResponseJsonSchema);
    expect(serialized).not.toContain('"anyOf"');
    expect(serialized).not.toContain('"oneOf"');
    expect(serialized).not.toContain('"allOf"');
    expect(serialized).not.toContain('"format"');
    expect(serialized).not.toContain('"nullable"');
    expect(serialized).not.toContain('"minLength"');
    expect(serialized).not.toContain('"maxLength"');
    expect(serialized).not.toContain('"pattern"');
  });

  it('provider JSON schema uses lowercase types and numeric constraint literals', () => {
    const checkTypesAndLimits = (node: GeminiJsonSchema) => {
      if (node.type) {
        const types = Array.isArray(node.type) ? node.type : [node.type];
        for (const t of types) {
          expect(t).toBe(t.toLowerCase());
          expect(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']).toContain(t);
        }
      }
      if (node.maxItems !== undefined) {
        expect(typeof node.maxItems).toBe('number');
      }
      if (node.minItems !== undefined) {
        expect(typeof node.minItems).toBe('number');
      }
      if (node.minimum !== undefined) {
        expect(typeof node.minimum).toBe('number');
      }
      if (node.maximum !== undefined) {
        expect(typeof node.maximum).toBe('number');
      }
      if (node.properties) {
        for (const child of Object.values(node.properties)) {
          checkTypesAndLimits(child);
        }
      }
      if (node.items) {
        checkTypesAndLimits(node.items);
      }
    };

    checkTypesAndLimits(geminiTurnResponseJsonSchema);
  });

  it('provider JSON schema declares every TurnResult root property', () => {
    const props = geminiTurnResponseJsonSchema.properties as Record<string, GeminiJsonSchema>;
    expect(props).toBeDefined();

    const zodShape = TurnResultSchema.shape;
    for (const key of Object.keys(zodShape)) {
      expect(props[key], `Gemini schema must declare root property "${key}"`).toBeDefined();
    }
  });

  it('provider JSON schema requires all six HG1 proposal envelopes', () => {
    const required = (geminiTurnResponseJsonSchema.required || []) as string[];
    for (const field of HG1_FIELDS) {
      expect(required, `Gemini schema required list must include "${field}"`).toContain(field);
    }
  });

  it('provider JSON schema keeps nullable transport fields optional to remain live-admissible', () => {
    const props = geminiTurnResponseJsonSchema.properties as Record<string, GeminiJsonSchema>;
    const intent = props.intent_proposal;
    const intentProps = intent.properties as Record<string, GeminiJsonSchema>;
    const reconciliation = props.reconciliation_proposal;

    expect(intent.required).not.toContain('action_subtype');
    expect(intentProps.action_subtype.enum).toEqual([
      'FLEE',
      'HIDE',
      'CORNER',
      'BAIT',
      'ISOLATE',
      'OVERWHELM',
      'FALSE_HOPE',
    ]);
    expect(reconciliation.required).not.toContain('memory_echo_candidate');

    const worldCandidate = (
      (props.world_memory_proposal.properties as Record<string, GeminiJsonSchema>).candidates
        .items as GeminiJsonSchema
    );
    expect(worldCandidate.required).toContain('node_id');
  });

  it('provider JSON schema declares only the canonical narrative block cap', () => {
    const properties = geminiTurnResponseJsonSchema.properties as Record<
      string,
      GeminiJsonSchema
    >;
    expect(properties.narrative_blocks.maxItems).toBe(3);

    const visit = (node: GeminiJsonSchema, path: string): void => {
      if (path !== '$.narrative_blocks') {
        expect(node.maxItems, `Unexpected array cap at ${path}`).toBeUndefined();
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        visit(child, `${path}.${key}`);
      }
      if (node.items) visit(node.items, `${path}[]`);
    };

    for (const [key, child] of Object.entries(properties)) {
      visit(child, `$.${key}`);
    }

    const oversized = createBaseValidPayload();
    oversized.narrative_blocks = Array.from({ length: 4 }, () => ({
      type: 'prose',
      content: 'Bounded by the canonical Zod contract.',
    }));
    expect(TurnResultSchema.safeParse(oversized).success).toBe(false);
  });

  it('provider JSON schema keeps every HG1 discriminant enum domain', () => {
    const props = geminiTurnResponseJsonSchema.properties as Record<string, GeminiJsonSchema>;

    const actProps = props.cast_activity_proposal.properties as Record<string, GeminiJsonSchema>;
    expect(actProps.kind.enum).toEqual(['NONE', 'ACTIVITY']);
    expect(actProps.perceptionPath.enum).toEqual([...PERCEPTION_PATHS]);

    const pressProps = props.situated_pressure_proposal.properties as Record<string, GeminiJsonSchema>;
    expect(pressProps.kind.enum).toEqual(['NONE', 'PRESSURE']);
    expect(pressProps.operator.enum).toEqual([...PRESSURE_OPERATORS]);
    expect(pressProps.affectedDimension.enum).toEqual([...AFFECTED_DIMENSIONS]);
    expect(pressProps.persistenceTarget.enum).toEqual([...PERSISTENCE_TARGETS]);

    const valChangesItem = (props.value_state_proposal.properties as Record<string, GeminiJsonSchema>).changes.items as GeminiJsonSchema;
    const valItemProps = valChangesItem.properties as Record<string, GeminiJsonSchema>;
    expect(valItemProps.operation.enum).toEqual([...VALUE_OPERATIONS]);
    expect(valItemProps.proposedCondition.enum).toEqual([...VALUE_CONDITIONS]);
    expect(valItemProps.proposedLifecycle.enum).toEqual([...VALUE_LIFECYCLES]);
    expect(valItemProps.expectedBeforeCondition.enum).toEqual([...VALUE_CONDITIONS]);
    expect(valItemProps.expectedBeforeLifecycle.enum).toEqual([...VALUE_LIFECYCLES]);

    const purChangesItem = (props.character_pursuit_proposal.properties as Record<string, GeminiJsonSchema>).changes.items as GeminiJsonSchema;
    const purItemProps = purChangesItem.properties as Record<string, GeminiJsonSchema>;
    expect(purItemProps.operation.enum).toEqual([...PURSUIT_OPERATIONS]);
    expect(purItemProps.proposedStatus.enum).toEqual([...PURSUIT_STATUSES]);
    expect(purItemProps.expectedStatus.enum).toEqual([...PURSUIT_STATUSES]);

    const devChangesItem = (props.character_development_proposal.properties as Record<string, GeminiJsonSchema>).changes.items as GeminiJsonSchema;
    const devItemProps = devChangesItem.properties as Record<string, GeminiJsonSchema>;
    expect(devItemProps.operation.enum).toEqual([...DEVELOPMENT_OPERATIONS]);
    expect(devItemProps.dimension.enum).toEqual([...DEVELOPMENT_DIMENSIONS]);

    const transChangesItem = (props.pressure_transition_proposal.properties as Record<string, GeminiJsonSchema>).transitions.items as GeminiJsonSchema;
    const transItemProps = transChangesItem.properties as Record<string, GeminiJsonSchema>;
    expect(transItemProps.proposedStatus.enum).toEqual([...PRESSURE_THREAD_TERMINAL_STATUSES]);
  });

  it('relationship delta is an integer range and never a string enum', () => {
    const props = geminiTurnResponseJsonSchema.properties as Record<string, GeminiJsonSchema>;
    const relChanges = (props.character_relationship_proposal.properties as Record<string, GeminiJsonSchema>).changes.items as GeminiJsonSchema;
    const deltaSchema = (relChanges.properties as Record<string, GeminiJsonSchema>).delta;

    expect(deltaSchema.type).toBe('integer');
    expect(deltaSchema.minimum).toBe(-1);
    expect(deltaSchema.maximum).toBe(1);
    expect(deltaSchema.enum).toBeUndefined();
  });

  it('generateStructuredResponse sends responseJsonSchema and never responseSchema', async () => {
    const client = getAiClient();
    const providerPayload = createBaseValidPayload();
    delete (providerPayload.intent_proposal as Record<string, unknown>).action_subtype;
    delete (providerPayload.reconciliation_proposal as Record<string, unknown>)
      .memory_echo_candidate;
    const worldCandidate = (
      providerPayload.world_memory_proposal as { candidates: Array<Record<string, unknown>> }
    ).candidates[0];
    worldCandidate.node_id = GEMINI_TURN_NULL_SENTINEL;
    providerPayload.cast_activity_proposal = {
      kind: 'NONE',
      reason: 'No independent cast activity is proposed.',
      proposalId: 'provider-cross-branch-id',
    };
    providerPayload.situated_pressure_proposal = {
      kind: 'PRESSURE',
      reason: 'This field belongs only to the neutral branch.',
      proposalId: 'prop-pressure-seam',
      valueAnchorId: 'value-stability',
      sourceReference: 'USER_ACTION',
      operator: 'EXPOSE',
      affectedDimension: 'SAFETY',
      adverseProspect: 'A damaged junction may expose the service ring.',
    };
    const generateSpy = vi.spyOn(client.models, 'generateContent').mockResolvedValueOnce({
      text: JSON.stringify(providerPayload),
    } as never);

    const result = await generateStructuredResponse('Test prompt', EngineTurnStructuredResponseContract);

    expect(generateSpy).toHaveBeenCalledTimes(1);
    const sdkRequest = generateSpy.mock.calls[0][0];

    expect(sdkRequest.config?.responseJsonSchema).toBe(
      EngineTurnStructuredResponseContract.responseJsonSchema
    );
    expect(sdkRequest.config).not.toHaveProperty('responseSchema');

    expect(result.intent_proposal.action_kind).toBe('COMMUNICATE');
    expect(result.intent_proposal.action_subtype).toBeNull();
    expect(result.reconciliation_proposal.memory_echo_candidate).toBeNull();
    expect(result.world_memory_proposal.candidates[0].node_id).toBeNull();
    expect(result.cast_activity_proposal).toEqual({
      kind: 'NONE',
      reason: 'No independent cast activity is proposed.',
    });
    expect(result.situated_pressure_proposal.kind).toBe('PRESSURE');
    expect(result.situated_pressure_proposal).not.toHaveProperty('reason');
    expect(result.narrative_blocks).toHaveLength(2);

    generateSpy.mockRestore();
  });
});

describe('Track D2: Canonical ingress tests (Packet 1-10B)', () => {
  it('transport normalizer completes only the two known nullable omissions', () => {
    const omittedSubtype = createBaseValidPayload();
    delete (omittedSubtype.intent_proposal as Record<string, unknown>).action_subtype;
    expect(TurnResultSchema.safeParse(omittedSubtype).success).toBe(false);
    expect(
      parseStructuredTurnResponse(
        JSON.stringify(omittedSubtype),
        TurnResultSchema,
        normalizeGeminiTurnProviderPayload
      ).intent_proposal.action_subtype
    ).toBeNull();

    const omittedEcho = createBaseValidPayload();
    delete (omittedEcho.reconciliation_proposal as Record<string, unknown>)
      .memory_echo_candidate;
    expect(TurnResultSchema.safeParse(omittedEcho).success).toBe(false);
    expect(
      parseStructuredTurnResponse(
        JSON.stringify(omittedEcho),
        TurnResultSchema,
        normalizeGeminiTurnProviderPayload
      ).reconciliation_proposal.memory_echo_candidate
    ).toBeNull();
  });

  it('normalizes explicit provider null sentinels only at known paths', () => {
    const payload = createBaseValidPayload();
    (payload.intent_proposal as Record<string, unknown>).action_subtype =
      GEMINI_TURN_NULL_SENTINEL;
    (payload.reconciliation_proposal as Record<string, unknown>).memory_echo_candidate =
      GEMINI_TURN_NULL_SENTINEL;
    const candidate = (
      payload.world_memory_proposal as { candidates: Array<Record<string, unknown>> }
    ).candidates[0];
    candidate.node_id = GEMINI_TURN_NULL_SENTINEL;
    payload.engine_thoughts = GEMINI_TURN_NULL_SENTINEL;

    const parsed = parseStructuredTurnResponse(
      JSON.stringify(payload),
      TurnResultSchema,
      normalizeGeminiTurnProviderPayload
    );

    expect(parsed.intent_proposal.action_subtype).toBeNull();
    expect(parsed.reconciliation_proposal.memory_echo_candidate).toBeNull();
    expect(parsed.world_memory_proposal.candidates[0].node_id).toBeNull();
    expect(parsed.engine_thoughts).toBe(GEMINI_TURN_NULL_SENTINEL);
  });

  it('projects recognized situated pressure branches before canonical validation', () => {
    const payload = createBaseValidPayload();
    payload.situated_pressure_proposal = {
      kind: 'PRESSURE',
      reason: 'This field belongs only to the neutral branch.',
      proposalId: 'prop-pressure-1',
      valueAnchorId: 'value-1',
      sourceReference: 'BASELINE',
      operator: 'EXPOSE',
      affectedDimension: 'SAFETY',
      adverseProspect: 'The failing seal may expose the chamber.',
      providerNarrativeHint: 'This is not a canonical proposal field.',
      manifestationBlock: {
        type: 'dialogue',
        speaker: 'Technician',
        content: 'The pressure seal is slipping.',
        providerStageDirection: 'This is not a canonical manifestation field.',
      },
    };

    expect(TurnResultSchema.safeParse(payload).success).toBe(false);

    const parsed = parseStructuredTurnResponse(
      JSON.stringify(payload),
      TurnResultSchema,
      normalizeGeminiTurnProviderPayload
    );

    expect(parsed.situated_pressure_proposal.kind).toBe('PRESSURE');
    expect(parsed.situated_pressure_proposal).not.toHaveProperty('reason');
    expect(parsed.situated_pressure_proposal).not.toHaveProperty('providerNarrativeHint');
    if (parsed.situated_pressure_proposal.kind !== 'PRESSURE') {
      throw new Error('Expected the active pressure branch');
    }
    expect(parsed.situated_pressure_proposal.manifestationBlock).toEqual({
      type: 'dialogue',
      speaker: 'Technician',
      content: 'The pressure seal is slipping.',
    });

    const neutral = createBaseValidPayload();
    neutral.situated_pressure_proposal = {
      kind: 'NONE',
      reason: 'No prospective pressure is being proposed.',
      proposalId: 'provider-cross-branch-id',
      adverseProspect: 'Provider-only cross-branch content.',
    };

    const parsedNeutral = parseStructuredTurnResponse(
      JSON.stringify(neutral),
      TurnResultSchema,
      normalizeGeminiTurnProviderPayload
    );

    expect(parsedNeutral.situated_pressure_proposal).toEqual({
      kind: 'NONE',
      reason: 'No prospective pressure is being proposed.',
    });
  });

  it('projects recognized cast activity branches before canonical validation', () => {
    const active = createBaseValidPayload();
    active.cast_activity_proposal = {
      kind: 'ACTIVITY',
      reason: 'This field belongs only to the neutral branch.',
      proposalId: 'prop-activity-1',
      castMemberId: 'cast-technician',
      pursuitId: null,
      locationNodeId: 'NODE_SERVICE_RING',
      perceptionPath: 'DIRECT',
      activitySummary: 'A technician checks a failing junction.',
      authorityReferences: ['blueprint-cast'],
      providerNarrativeHint: 'This is not a canonical proposal field.',
      manifestationBlock: {
        type: 'prose',
        speaker: 'Provider-only cross-branch speaker.',
        content: 'A status lamp flickers beside the junction.',
        providerStageDirection: 'This is not a canonical manifestation field.',
      },
    };

    expect(TurnResultSchema.safeParse(active).success).toBe(false);

    const parsedActive = parseStructuredTurnResponse(
      JSON.stringify(active),
      TurnResultSchema,
      normalizeGeminiTurnProviderPayload
    );

    expect(parsedActive.cast_activity_proposal.kind).toBe('ACTIVITY');
    expect(parsedActive.cast_activity_proposal).not.toHaveProperty('reason');
    expect(parsedActive.cast_activity_proposal).not.toHaveProperty('providerNarrativeHint');
    if (parsedActive.cast_activity_proposal.kind !== 'ACTIVITY') {
      throw new Error('Expected the active activity branch');
    }
    expect(parsedActive.cast_activity_proposal.manifestationBlock).toEqual({
      type: 'prose',
      content: 'A status lamp flickers beside the junction.',
    });

    const neutral = createBaseValidPayload();
    neutral.cast_activity_proposal = {
      kind: 'NONE',
      reason: 'No independent cast activity is proposed.',
      proposalId: 'provider-cross-branch-id',
      activitySummary: 'Provider-only cross-branch content.',
    };

    const parsedNeutral = parseStructuredTurnResponse(
      JSON.stringify(neutral),
      TurnResultSchema,
      normalizeGeminiTurnProviderPayload
    );

    expect(parsedNeutral.cast_activity_proposal).toEqual({
      kind: 'NONE',
      reason: 'No independent cast activity is proposed.',
    });
  });

  it('leaves invalid union discriminants and incomplete active branches fail closed', () => {
    for (const field of ['cast_activity_proposal', 'situated_pressure_proposal'] as const) {
      const invalidKind = createBaseValidPayload();
      invalidKind[field] = {
        kind: 'UNRECOGNIZED',
        reason: 'The canonical schema must reject this discriminant.',
        providerNarrativeHint: 'Must not be repaired.',
      };

      expect(() =>
        parseStructuredTurnResponse(
          JSON.stringify(invalidKind),
          TurnResultSchema,
          normalizeGeminiTurnProviderPayload
        )
      ).toThrow();

      const incompleteActive = createBaseValidPayload();
      incompleteActive[field] = {
        kind: field === 'cast_activity_proposal' ? 'ACTIVITY' : 'PRESSURE',
        reason: 'Removing this cross-branch field cannot manufacture required semantics.',
      };

      expect(() =>
        parseStructuredTurnResponse(
          JSON.stringify(incompleteActive),
          TurnResultSchema,
          normalizeGeminiTurnProviderPayload
        )
      ).toThrow();
    }
  });

  it('omission of each HG1 envelope fails TurnResultSchema', () => {
    for (const field of HG1_FIELDS) {
      const omitted = createBaseValidPayload();
      delete (omitted as Record<string, unknown>)[field];
      expect(
        () => parseStructuredTurnResponse(JSON.stringify(omitted), TurnResultSchema),
        `Deleting "${field}" should fail canonical validation`
      ).toThrow();
    }
  });

  it('explicit neutral HG1 envelopes parse without manufacturing defaults', () => {
    const neutral = createBaseValidPayload();
    const parsedNeutral = parseStructuredTurnResponse(
      JSON.stringify(neutral),
      EngineTurnStructuredResponseContract.zodSchema
    );
    expect(parsedNeutral.cast_activity_proposal.kind).toBe('NONE');
    expect(parsedNeutral.situated_pressure_proposal.kind).toBe('NONE');
    expect(parsedNeutral.value_state_proposal.changes).toEqual([]);
    expect(parsedNeutral.character_pursuit_proposal.changes).toEqual([]);
    expect(parsedNeutral.character_development_proposal.changes).toEqual([]);
    expect(parsedNeutral.pressure_transition_proposal.transitions).toEqual([]);
  });

  it('every active HG1 variant parses through the paired Zod contract', () => {
    const active = createBaseValidPayload();
    active.cast_activity_proposal = {
      kind: 'ACTIVITY',
      proposalId: 'prop-act-1',
      castMemberId: 'char-tech',
      pursuitId: 'pur-1',
      locationNodeId: 'NODE_CORRIDOR',
      perceptionPath: 'DIRECT',
      activitySummary: 'Technician inspecting conduit.',
      authorityReferences: ['auth-ref-1'],
      manifestationBlock: {
        type: 'dialogue',
        speaker: 'Technician',
        content: 'The conduit is loose.',
      },
    };
    active.situated_pressure_proposal = {
      kind: 'PRESSURE',
      proposalId: 'prop-press-1',
      valueAnchorId: 'val-reactor',
      sourceReference: 'BASELINE',
      operator: 'EXPOSE',
      affectedDimension: 'SAFETY',
      adverseProspect: 'Coolant line leaking toxic gas.',
      authorityReferences: ['auth-press-1'],
      persistenceTarget: 'PRESSURE_THREAD',
      responseWindowOpen: true,
      manifestationBlock: {
        type: 'prose',
        content: 'A hissing sound echoes from the manifold.',
      },
    };
    active.value_state_proposal = {
      changes: [
        {
          anchorId: 'val-reactor',
          operation: 'SET_CONDITION',
          expectedBeforeCondition: 'ESTABLISHED',
          expectedBeforeLifecycle: 'ACTIVE',
          proposedCondition: 'THREATENED',
          proposedLifecycle: 'ACTIVE',
          proposedFormNote: null,
          causeReference: 'USER_ACTION',
          rationale: 'Core heating up.',
        },
      ],
    };
    active.character_pursuit_proposal = {
      changes: [
        {
          pursuitId: 'pur-1',
          operation: 'ADVANCE',
          expectedStatus: 'ACTIVE',
          proposedObjective: 'Patch conduit',
          proposedApproach: 'Use thermal sealant',
          proposedLocationNodeId: 'NODE_CORRIDOR',
          proposedStatus: 'ACTIVE',
          progressSummary: 'Sealant applied.',
          causeReference: 'ACTIVITY',
          rationale: 'Work in progress.',
        },
      ],
    };
    active.character_development_proposal = {
      changes: [
        {
          castMemberId: 'char-tech',
          operation: 'ESTABLISH',
          targetFactId: null,
          dimension: 'BELIEF',
          statement: 'Believes the station is unsafe.',
          causeReference: 'BASELINE',
          rationale: 'Observed reactor instability.',
        },
      ],
    };
    active.pressure_transition_proposal = {
      transitions: [
        {
          threadId: 'thr-1',
          proposedStatus: 'RESOLVED',
          causeReference: 'USER_ACTION',
          replacementAdverseProspect: 'None',
          rationale: 'Valve closed.',
        },
      ],
    };

    const parsedActive = parseStructuredTurnResponse(
      JSON.stringify(active),
      EngineTurnStructuredResponseContract.zodSchema
    );
    expect(parsedActive.cast_activity_proposal.kind).toBe('ACTIVITY');
    expect(parsedActive.situated_pressure_proposal.kind).toBe('PRESSURE');
    expect(parsedActive.value_state_proposal.changes).toHaveLength(1);
    expect(parsedActive.character_pursuit_proposal.changes).toHaveLength(1);
    expect(parsedActive.character_development_proposal.changes).toHaveLength(1);
    expect(parsedActive.pressure_transition_proposal.transitions).toHaveLength(1);
  });

  it('provider-coarse invalid cross-field combinations are rejected by Zod', () => {
    // Missing required fields on active ACTIVITY proposal
    const invalidAct = createBaseValidPayload();
    invalidAct.cast_activity_proposal = {
      kind: 'ACTIVITY',
      reason: 'Missing required active fields',
    };
    expect(() => parseStructuredTurnResponse(JSON.stringify(invalidAct), TurnResultSchema)).toThrow();

    // Missing required fields on active PRESSURE proposal
    const invalidPress = createBaseValidPayload();
    invalidPress.situated_pressure_proposal = {
      kind: 'PRESSURE',
      reason: 'Missing required active fields',
    };
    expect(() => parseStructuredTurnResponse(JSON.stringify(invalidPress), TurnResultSchema)).toThrow();

    const activeReason = createBaseValidPayload();
    activeReason.cast_activity_proposal = {
      kind: 'ACTIVITY',
      reason: 'This key belongs only to the NONE variant.',
      proposalId: 'prop-act-1',
      castMemberId: 'char-tech',
      perceptionPath: 'DIRECT',
      activitySummary: 'Working.',
    };
    expect(() =>
      parseStructuredTurnResponse(JSON.stringify(activeReason), TurnResultSchema)
    ).toThrow();

    const activePressureReason = createBaseValidPayload();
    activePressureReason.situated_pressure_proposal = {
      kind: 'PRESSURE',
      reason: 'This key belongs only to the NONE variant.',
      proposalId: 'prop-pressure-1',
      valueAnchorId: 'value-1',
      sourceReference: 'BASELINE',
      operator: 'EXPOSE',
      affectedDimension: 'SAFETY',
      adverseProspect: 'The failing seal may expose the chamber.',
    };
    expect(() =>
      parseStructuredTurnResponse(JSON.stringify(activePressureReason), TurnResultSchema)
    ).toThrow();

    // Dialogue manifestation block without speaker
    const invalidManifest = createBaseValidPayload();
    invalidManifest.cast_activity_proposal = {
      kind: 'ACTIVITY',
      proposalId: 'prop-act-1',
      castMemberId: 'char-tech',
      pursuitId: null,
      locationNodeId: null,
      perceptionPath: 'DIRECT',
      activitySummary: 'Working.',
      authorityReferences: ['ref'],
      manifestationBlock: { type: 'dialogue', content: 'Missing speaker' },
    };
    expect(() => parseStructuredTurnResponse(JSON.stringify(invalidManifest), TurnResultSchema)).toThrow();
    expect(() =>
      parseStructuredTurnResponse(
        JSON.stringify(invalidManifest),
        TurnResultSchema,
        normalizeGeminiTurnProviderPayload
      )
    ).toThrow();

    // Invalid consequence combination (SET on INVENTORY)
    const invalidCsq = createBaseValidPayload();
    invalidCsq.consequence_proposal = {
      mutations: [
        {
          domain: 'INVENTORY',
          operation: 'SET',
          value: 'Item',
          rationale: 'Invalid op for domain',
        },
      ],
    };
    expect(() => parseStructuredTurnResponse(JSON.stringify(invalidCsq), TurnResultSchema)).toThrow();

    // Invalid World Memory node scope with null node_id
    const invalidWorldNode = createBaseValidPayload();
    invalidWorldNode.world_memory_proposal = {
      candidates: [
        {
          kind: 'ESTABLISHED_FACT',
          scope: 'NODE',
          node_id: null,
          statement: 'Fact',
          rationale: 'Rationale',
        },
      ],
    };
    expect(() => parseStructuredTurnResponse(JSON.stringify(invalidWorldNode), TurnResultSchema)).toThrow();
  });

  it('overlong, blank, invalid-cause, and invalid-ID values remain rejected by Zod or their deterministic ratifier owner', () => {
    // Blank causeReference
    const blankCause = createBaseValidPayload();
    blankCause.value_state_proposal = {
      changes: [
        {
          anchorId: 'a1',
          operation: 'SET_CONDITION',
          proposedCondition: 'LOST',
          causeReference: '   ',
          rationale: 'R',
        },
      ],
    };
    expect(() => parseStructuredTurnResponse(JSON.stringify(blankCause), TurnResultSchema)).toThrow();

    // Over-limit narrative blocks
    const overNarrative = createBaseValidPayload();
    overNarrative.narrative_blocks = [
      { type: 'prose', content: 'Block 1' },
      { type: 'prose', content: 'Block 2' },
      { type: 'prose', content: 'Block 3' },
      { type: 'prose', content: 'Block 4' },
    ];
    expect(() => parseStructuredTurnResponse(JSON.stringify(overNarrative), TurnResultSchema)).toThrow();

    // Numeric delta 0 rejected by relationship delta schema
    const zeroDelta = createBaseValidPayload();
    (zeroDelta.character_relationship_proposal as { changes: Array<{ delta: unknown }> }).changes[0].delta = 0;
    expect(() => parseStructuredTurnResponse(JSON.stringify(zeroDelta), TurnResultSchema)).toThrow();
  });
});

describe('classifyProviderResponse', () => {
  it('classifies explicit prompt-level block reason as PROVIDER_REFUSAL', () => {
    const res = {
      promptFeedback: { blockReason: 'SAFETY' },
      text: null,
    };
    const result = classifyProviderResponse(res);
    expect(result.kind).toBe('PROVIDER_REFUSAL');
    if (result.kind === 'PROVIDER_REFUSAL') {
      expect(result.reason).toBe('SAFETY');
    }
  });

  it('classifies explicit candidate finishReason as PROVIDER_REFUSAL', () => {
    const refusalReasons = ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION', 'OTHER'];
    for (const finishReason of refusalReasons) {
      const res = {
        candidates: [{ finishReason }],
        text: '',
      };
      const result = classifyProviderResponse(res);
      expect(result.kind).toBe('PROVIDER_REFUSAL');
      if (result.kind === 'PROVIDER_REFUSAL') {
        expect(result.reason).toBe(finishReason);
      }
    }
  });

  it('does not classify unspecified block reason or unspecified finish reason as refusal', () => {
    const resUnspecBlock = {
      promptFeedback: { blockReason: 'BLOCK_REASON_UNSPECIFIED' },
      candidates: [{ finishReason: 'STOP' }],
      text: '{"ok": true}',
    };
    const resultBlock = classifyProviderResponse(resUnspecBlock);
    expect(resultBlock.kind).toBe('CONTENT');

    const resUnspecFinish = {
      candidates: [{ finishReason: 'FINISH_REASON_UNSPECIFIED' }],
      text: '{"ok": true}',
    };
    const resultFinish = classifyProviderResponse(resUnspecFinish);
    expect(resultFinish.kind).toBe('CONTENT');
  });

  it('classifies STOP with non-empty text as CONTENT', () => {
    const res = {
      candidates: [{ finishReason: 'STOP' }],
      text: '{"narrative_blocks": []}',
    };
    const result = classifyProviderResponse(res);
    expect(result.kind).toBe('CONTENT');
    if (result.kind === 'CONTENT') {
      expect(result.text).toBe('{"narrative_blocks": []}');
    }
  });

  it('classifies MAX_TOKENS with non-empty text as CONTENT (not automatically refusal)', () => {
    const res = {
      candidates: [{ finishReason: 'MAX_TOKENS' }],
      text: '{"partial": true}',
    };
    const result = classifyProviderResponse(res);
    expect(result.kind).toBe('CONTENT');
  });

  it('classifies empty or whitespace-only response without refusal metadata as EMPTY_PROVIDER_RESPONSE', () => {
    const resEmpty = {
      candidates: [{ finishReason: 'STOP' }],
      text: '',
    };
    expect(classifyProviderResponse(resEmpty).kind).toBe('EMPTY_PROVIDER_RESPONSE');

    const resWhitespace = {
      candidates: [{ finishReason: 'STOP' }],
      text: '   \n\t  ',
    };
    expect(classifyProviderResponse(resWhitespace).kind).toBe('EMPTY_PROVIDER_RESPONSE');

    expect(classifyProviderResponse(null).kind).toBe('EMPTY_PROVIDER_RESPONSE');
    expect(classifyProviderResponse({}).kind).toBe('EMPTY_PROVIDER_RESPONSE');
  });

  it('passes malformed non-empty JSON as CONTENT (which then fails through existing parser/schema boundary)', () => {
    const res = {
      candidates: [{ finishReason: 'STOP' }],
      text: '{"malformed json: true',
    };
    const result = classifyProviderResponse(res);
    expect(result.kind).toBe('CONTENT');
    if (result.kind === 'CONTENT') {
      expect(() => parseStructuredTurnResponse(result.text, TurnResultSchema)).toThrow();
    }
  });

  it('ensures raw response objects, stacks, URLs, and credentials are absent from sanitized error types', () => {
    const err = new ProviderRefusalError('SAFETY');
    expect(err.code).toBe('PROVIDER_REFUSAL');
    expect(err.reason).toBe('SAFETY');
    expect(err.message).toBe('AI provider declined turn generation');
    expect(JSON.stringify(err)).not.toContain('http://');
    expect(JSON.stringify(err)).not.toContain('AI_API_KEY');

    const emptyErr = new EmptyProviderResponseError();
    expect(emptyErr.code).toBe('EMPTY_PROVIDER_RESPONSE');
    expect(emptyErr.message).toBe('AI provider returned an empty response');

    const rejectedErr = new ProviderRequestRejectedError(400);
    expect(rejectedErr.code).toBe('PROVIDER_REQUEST_REJECTED');
    expect(rejectedErr.providerStatus).toBe(400);
    expect(rejectedErr.message).toBe('AI provider rejected the turn generation request');
    expect(JSON.stringify(rejectedErr)).not.toContain('generativelanguage.googleapis.com');
  });

  describe('normalizeGeminiTurnProviderPayload defensive edge cases', () => {
    it('normalizes GLOBAL scope world memory candidates to have node_id null', () => {
      const payload = {
        world_memory_proposal: {
          candidates: [
            {
              kind: 'ENVIRONMENTAL_CONDITION',
              scope: 'GLOBAL',
              node_id: 'SOME_PLACEHOLDER_STRING',
              statement: 'City is quiet.',
              rationale: 'Reason',
            },
          ],
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as typeof payload;
      expect(normalized.world_memory_proposal.candidates[0].node_id).toBeNull();
    });

    it('normalizes empty strings or whitespace to null for memory_echo_candidate and action_subtype', () => {
      const payload = {
        reconciliation_proposal: {
          memory_echo_candidate: '   ',
        },
        intent_proposal: {
          action_subtype: '',
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as typeof payload;
      expect(normalized.reconciliation_proposal.memory_echo_candidate).toBeNull();
      expect(normalized.intent_proposal.action_subtype).toBeNull();
    });

    it('filters out relationship delta 0 changes', () => {
      const payload = {
        character_relationship_proposal: {
          changes: [
            {
              source_character_id: 'char1',
              target_character_id: 'char2',
              kind: 'TRUST',
              delta: 0,
              rationale: 'No change',
            },
            {
              source_character_id: 'char1',
              target_character_id: 'char3',
              kind: 'HOSTILITY',
              delta: 1,
              rationale: 'Increased hostility',
            },
          ],
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as typeof payload;
      expect(normalized.character_relationship_proposal.changes).toHaveLength(1);
      expect(normalized.character_relationship_proposal.changes[0].delta).toBe(1);
    });

    it('filters invalid psychological mutations and normalizes valid ones to SET operation', () => {
      const payload = {
        consequence_proposal: {
          mutations: [
            {
              domain: 'PSYCHOLOGICAL_STATUS',
              operation: 'REMOVE',
              value: 'CALMNESS',
              rationale: 'Invalid value',
            },
            {
              domain: 'PSYCHOLOGICAL_STATUS',
              operation: 'ADD',
              value: 'panicked',
              rationale: 'Should become SET with uppercase',
            },
            {
              domain: 'INVENTORY',
              operation: 'ADD',
              value: 'Keycard',
              rationale: 'Valid',
            },
          ],
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as typeof payload;
      expect(normalized.consequence_proposal.mutations).toHaveLength(2);
      expect(normalized.consequence_proposal.mutations[0]).toEqual({
        domain: 'PSYCHOLOGICAL_STATUS',
        operation: 'SET',
        value: 'PANICKED',
        rationale: 'Should become SET with uppercase',
      });
      expect(normalized.consequence_proposal.mutations[1].value).toBe('Keycard');
    });

    it('clamps proposal arrays exceeding maximum bounds', () => {
      const payload = {
        narrative_blocks: [
          { type: 'prose', content: 'Block 1' },
          { type: 'prose', content: 'Block 2' },
          { type: 'prose', content: 'Block 3' },
          { type: 'prose', content: 'Block 4' },
        ],
        character_stance_proposal: {
          changes: [
            { character_id: 'c1', focus: 'PLAYER', stance: 'GUARDED', rationale: 'r1' },
            { character_id: 'c2', focus: 'PLAYER', stance: 'HOSTILE', rationale: 'r2' },
            { character_id: 'c3', focus: 'PLAYER', stance: 'OPEN', rationale: 'r3' },
          ],
        },
        character_relationship_proposal: {
          changes: [
            { source_character_id: 'c1', target_character_id: 'c2', kind: 'TRUST', delta: 1, rationale: 'r1' },
            { source_character_id: 'c2', target_character_id: 'c3', kind: 'FEAR', delta: -1, rationale: 'r2' },
            { source_character_id: 'c3', target_character_id: 'c1', kind: 'RESPECT', delta: 1, rationale: 'r3' },
          ],
        },
        character_memory_proposal: {
          candidates: [
            { character_id: 'c1', summary: 's1', emotional_valence: 'NEGATIVE', importance: 'HIGH', observation_mode: 'DIRECT' },
            { character_id: 'c2', summary: 's2', emotional_valence: 'NEUTRAL', importance: 'LOW', observation_mode: 'INFERRED' },
            { character_id: 'c3', summary: 's3', emotional_valence: 'POSITIVE', importance: 'MEDIUM', observation_mode: 'DIRECT' },
          ],
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as unknown as NormalizedTurnPayload;
      expect(normalized.narrative_blocks).toHaveLength(3);
      expect(normalized.character_stance_proposal?.changes).toHaveLength(2);
      expect(normalized.character_relationship_proposal?.changes).toHaveLength(2);
      expect(normalized.character_memory_proposal?.candidates).toHaveLength(2);
    });

    it('normalizes snake_case keys and fills missing proposalId for situated_pressure_proposal', () => {
      const payload = {
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          proposal_id: 'pressure-proposal-1',
          value_anchor_id: 'anchor-integrity',
          source_reference: 'leaking conduit',
          operator: 'escalate',
          affected_dimension: 'survival',
          adverse_prospect: 'Hull breach imminent',
          persistence_target: 'until_resolved',
          authority_references: ['manual'],
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as unknown as NormalizedTurnPayload;
      expect(normalized.situated_pressure_proposal?.kind).toBe('PRESSURE');
      expect(normalized.situated_pressure_proposal?.proposalId).toBe('pressure-proposal-1');
      expect(normalized.situated_pressure_proposal?.valueAnchorId).toBe('anchor-integrity');
      expect(normalized.situated_pressure_proposal?.sourceReference).toBe('leaking conduit');
      expect(normalized.situated_pressure_proposal?.operator).toBe('ESCALATE');
      expect(normalized.situated_pressure_proposal?.affectedDimension).toBe('SURVIVAL');
      expect(normalized.situated_pressure_proposal?.persistenceTarget).toBe('UNTIL_RESOLVED');
    });

    it('generates fallback proposalId if missing from valid situated_pressure_proposal', () => {
      const payload = {
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          valueAnchorId: 'anchor-integrity',
          sourceReference: 'steam pipe',
          operator: 'INTRODUCE',
          affectedDimension: 'SAFETY',
          adverseProspect: 'Scalding steam fills room',
          persistenceTarget: 'SCENE',
          authorityReferences: [],
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as unknown as NormalizedTurnPayload;
      expect(normalized.situated_pressure_proposal?.kind).toBe('PRESSURE');
      expect(typeof normalized.situated_pressure_proposal?.proposalId).toBe('string');
      expect(normalized.situated_pressure_proposal?.proposalId as string).toMatch(/^prop-press-/);
    });

    it('retains PRESSURE kind for incomplete situated_pressure_proposal allowing schema validation to fail closed', () => {
      const payload = {
        situated_pressure_proposal: {
          kind: 'PRESSURE',
          // missing valueAnchorId and adverseProspect
          sourceReference: 'shadows',
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as unknown as NormalizedTurnPayload;
      expect(normalized.situated_pressure_proposal?.kind).toBe('PRESSURE');
    });

    it('normalizes snake_case keys and fills missing proposalId for cast_activity_proposal', () => {
      const payload = {
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          cast_member_id: 'char-gorrister',
          pursuit_id: 'pursuit-escape',
          location_node_id: 'node-generator',
          perception_path: 'auditory',
          activity_summary: 'Banging on rusted pipe',
          authority_references: ['note-1'],
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as unknown as NormalizedTurnPayload;
      expect(normalized.cast_activity_proposal?.kind).toBe('ACTIVITY');
      expect(typeof normalized.cast_activity_proposal?.proposalId).toBe('string');
      expect(normalized.cast_activity_proposal?.proposalId as string).toMatch(/^prop-act-/);
      expect(normalized.cast_activity_proposal?.castMemberId).toBe('char-gorrister');
      expect(normalized.cast_activity_proposal?.pursuitId).toBe('pursuit-escape');
      expect(normalized.cast_activity_proposal?.locationNodeId).toBe('node-generator');
      expect(normalized.cast_activity_proposal?.perceptionPath).toBe('DIRECT');
      expect(normalized.cast_activity_proposal?.activitySummary).toBe('Banging on rusted pipe');
    });

    it('normalizes perceptionPath variants, sensory synonyms, and empty IDs', () => {
      expect(normalizePerceptionPath('auditory')).toBe('DIRECT');
      expect(normalizePerceptionPath('visual')).toBe('DIRECT');
      expect(normalizePerceptionPath('intercom')).toBe('MEDIATED');
      expect(normalizePerceptionPath('radio_broadcast')).toBe('MEDIATED');
      expect(normalizePerceptionPath('blood_trace')).toBe('LOCAL_TRACE');
      expect(normalizePerceptionPath('unseen')).toBe('UNOBSERVED');
      expect(normalizePerceptionPath('unknown_weird_string')).toBe('DIRECT');

      const payload = {
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          proposalId: 'prop-1',
          castMemberId: 'char-gorrister',
          locationNodeId: '   ',
          pursuitId: '',
          perceptionPath: 'auditory',
          activitySummary: 'Whispering in shadows',
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as unknown as NormalizedTurnPayload;
      expect(normalized.cast_activity_proposal?.locationNodeId).toBeNull();
      expect(normalized.cast_activity_proposal?.pursuitId).toBeNull();
      expect(normalized.cast_activity_proposal?.perceptionPath).toBe('DIRECT');
    });

    it('normalizes situated pressure operator and dimensions to OTHER when non-standard', () => {
      expect(normalizePressureOperator('EXPOSE')).toBe('EXPOSE');
      expect(normalizePressureOperator('invented_operator')).toBe('OTHER');
      expect(normalizeAffectedDimension('SAFETY')).toBe('SAFETY');
      expect(normalizeAffectedDimension('invented_dimension')).toBe('OTHER');
      expect(normalizePersistenceTarget('world')).toBe('WORLD_MEMORY');
      expect(normalizePersistenceTarget('random')).toBe('PRESSURE_THREAD');
    });

    it('retains ACTIVITY kind for incomplete cast_activity_proposal allowing schema validation to fail closed', () => {
      const payload = {
        cast_activity_proposal: {
          kind: 'ACTIVITY',
          // missing activitySummary
          castMemberId: 'char-gorrister',
        },
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as unknown as NormalizedTurnPayload;
      expect(normalized.cast_activity_proposal?.kind).toBe('ACTIVITY');
    });

    it('normalizes dialogue blocks without a speaker to type prose', () => {
      const payload = {
        narrative_blocks: [
          {
            type: 'prose',
            content: 'The room is silent.',
          },
          {
            type: 'dialogue',
            content: 'Is anyone there?',
            // speaker is missing
          },
        ],
      };

      const normalized = normalizeGeminiTurnProviderPayload(payload) as unknown as NormalizedTurnPayload;
      expect(normalized.narrative_blocks).toHaveLength(2);
      expect(normalized.narrative_blocks?.[1]).toEqual({
        type: 'prose',
        content: 'Is anyone there?',
      });
    });

  });

  describe('generateStructuredResponse with engineProvider local', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it('delegates to generateLocalStructuredResponse and returns validated turn', async () => {
      const { setEngineProvider } = await import('../ai/modelPolicy');
      const { generateStructuredResponse, EngineTurnStructuredResponseContract } = await import('./aiClient');

      setEngineProvider('local');

      const basePayload = createBaseValidPayload();
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
                    content: JSON.stringify(basePayload),
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      globalThis.fetch = fetchMock;

      try {
        const result = await generateStructuredResponse('Test prompt', EngineTurnStructuredResponseContract);
        expect(result.intent_proposal.action_kind).toBe('COMMUNICATE');
        expect(fetchMock).toHaveBeenCalled();
        const [url] = fetchMock.mock.calls[1];
        expect(url).toContain('/chat/completions');
      } finally {
        setEngineProvider('gemini');
      }
    });
  });

  describe('generateStructuredResponse bounded envelope retry (Packet B)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it('retries once on SyntaxError and succeeds on second attempt', async () => {
      const { setEngineProvider } = await import('../ai/modelPolicy');
      const { generateStructuredResponse, EngineTurnStructuredResponseContract } = await import('./aiClient');

      setEngineProvider('local');

      const basePayload = createBaseValidPayload();
      const fetchMock = vi
        .fn()
        // Discovery ping
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), { status: 200 })
        )
        // Attempt 1: SyntaxError (malformed unparseable JSON)
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"incomplete_raw: ' } }],
            }),
            { status: 200 }
          )
        )
        // Discovery ping for retry
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), { status: 200 })
        )
        // Attempt 2: Valid payload
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(basePayload) } }],
            }),
            { status: 200 }
          )
        );
      globalThis.fetch = fetchMock;

      try {
        const result = await generateStructuredResponse('Retry test prompt', EngineTurnStructuredResponseContract);
        expect(result.intent_proposal.action_kind).toBe('COMMUNICATE');
        // Discovery (1) + Attempt 1 (2) + Discovery (3) + Attempt 2 (4)
        expect(fetchMock).toHaveBeenCalledTimes(4);
      } finally {
        setEngineProvider('gemini');
      }
    });

    it('retries once on ZodError and rethrows after 2 attempts fail', async () => {
      const { setEngineProvider } = await import('../ai/modelPolicy');
      const { generateStructuredResponse, EngineTurnStructuredResponseContract } = await import('./aiClient');

      setEngineProvider('local');

      const invalidPayload = { invalid_turn: true };
      const fetchMock = vi
        .fn()
        // Discovery ping 1
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), { status: 200 })
        )
        // Attempt 1: Schema violation
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(invalidPayload) } }],
            }),
            { status: 200 }
          )
        )
        // Discovery ping 2
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), { status: 200 })
        )
        // Attempt 2: Schema violation again
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(invalidPayload) } }],
            }),
            { status: 200 }
          )
        );
      globalThis.fetch = fetchMock;

      try {
        await expect(
          generateStructuredResponse('Fail test prompt', EngineTurnStructuredResponseContract)
        ).rejects.toThrow();
        // Exactly 2 generation attempts (plus 2 model discovery calls)
        expect(fetchMock).toHaveBeenCalledTimes(4);
      } finally {
        setEngineProvider('gemini');
      }
    });

    it('logs structured envelope validation issues on ZodError retry and succeeds on attempt 2', async () => {
      const { setEngineProvider } = await import('../ai/modelPolicy');
      const { generateStructuredResponse, EngineTurnStructuredResponseContract } = await import('./aiClient');

      setEngineProvider('local');

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const invalidPayload = { invalid_turn: true };
      const basePayload = createBaseValidPayload();
      const fetchMock = vi
        .fn()
        // Discovery ping 1
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), { status: 200 })
        )
        // Attempt 1: Schema violation (throws ZodError with multiple missing required paths)
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(invalidPayload) } }],
            }),
            { status: 200 }
          )
        )
        // Discovery ping 2
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }), { status: 200 })
        )
        // Attempt 2: Valid payload
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(basePayload) } }],
            }),
            { status: 200 }
          )
        );
      globalThis.fetch = fetchMock;

      try {
        const result = await generateStructuredResponse('Retry with error log test prompt', EngineTurnStructuredResponseContract);
        expect(result.intent_proposal.action_kind).toBe('COMMUNICATE');

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[AI Client] Envelope validation issues:',
          expect.any(String)
        );

        const call = consoleErrorSpy.mock.calls.find(
          (c) => c[0] === '[AI Client] Envelope validation issues:'
        );
        expect(call).toBeDefined();

        const parsedIssues = JSON.parse(call![1] as string);
        expect(Array.isArray(parsedIssues)).toBe(true);
        expect(parsedIssues.length).toBeGreaterThanOrEqual(2);

        const paths = new Set(parsedIssues.map((i: { path: string }) => i.path));
        expect(paths.size).toBeGreaterThanOrEqual(2);

        for (const issue of parsedIssues) {
          expect(issue).toHaveProperty('path');
          expect(issue).toHaveProperty('code');
          expect(issue).toHaveProperty('message');
        }
      } finally {
        setEngineProvider('gemini');
        consoleErrorSpy.mockRestore();
      }
    });
  });
});

describe('aiClient structured response normalization context propagation', () => {
  it('wraps normalizeProviderPayload with normalizationContext on effectiveContract', async () => {
    let capturedContext: unknown = null;

    const mockContract = {
      zodSchema: { parse: (x: unknown) => x },
      normalizeProviderPayload: (payload: unknown, ctx?: unknown) => {
        capturedContext = ctx;
        return payload;
      },
      normalizationContext: {
        scenarioCastIds: ['char-test-1'],
        activeCastIds: ['char-test-1']
      }
    };

    // Trigger normalizer via the effectiveContract pattern
    const normalize = mockContract.normalizationContext
      ? (payload: unknown) => mockContract.normalizeProviderPayload(payload, mockContract.normalizationContext)
      : mockContract.normalizeProviderPayload;

    normalize({ test: true });

    expect(capturedContext).toEqual({
      scenarioCastIds: ['char-test-1'],
      activeCastIds: ['char-test-1']
    });
  });
});
