import { describe, expect, it } from 'vitest';
import {
  collectQuestionnaireCandidates,
  validateQuestionnaireResults,
  EVASIVE_RE,
  REQUIREMENTS,
} from './questionnaireValidation';
import {
  TOPOLOGY_BATTERY,
  SEED_BATTERY,
  VILLAIN_BATTERY,
  DEPICTION_BATTERY,
  PRESSURE_BATTERY,
  RELATIONSHIPS_BATTERY,
} from './extractionBatteries';
import type { PipelineResult, Stage1Response } from './extractionPipeline';

function makeResponses(family: string, count: number, answerText = 'Valid answer content with details.'): Stage1Response[] {
  return Array.from({ length: count }, (_, idx) => ({
    family,
    questionIndex: idx,
    question: `Question ${idx + 1} for ${family}`,
    answer: answerText,
    citations: ['"citation"'],
  }));
}

describe('questionnaireValidation', () => {
  it('TOPOLOGY empty: yields 1 violation naming the bounded spaces question and compile target', () => {
    const stage1Responses: Stage1Response[] = TOPOLOGY_BATTERY.questions.map((q, idx) => ({
      family: 'TOPOLOGY',
      questionIndex: idx,
      question: q,
      answer: 'Some room description with citations.',
      citations: ['"room description"'],
    }));

    const result: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        topology: { nodes: [], connections: [] },
      },
      failedBatteries: [],
    };

    const violations = validateQuestionnaireResults(result);
    expect(violations).toHaveLength(1);
    expect(violations[0].family).toBe('TOPOLOGY');
    expect(violations[0].question).toBe(TOPOLOGY_BATTERY.questions[0]);
    expect(violations[0].reason).toContain('required at least 1 topology_node candidate(s); compiled 0');
  });

  it('SEED count ok, villain missing: yields exactly 1 violation for VILLAIN disposition (§4b)', () => {
    const stage1Responses = makeResponses('SEED', SEED_BATTERY.questions.length);
    const result: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        seed: {
          seeds: [
            { target: 'cast_seed', proposedValue: { disposition: 'SURVIVOR' } },
            { target: 'cast_seed', proposedValue: { disposition: 'BYSTANDER' } },
          ],
        },
      },
      failedBatteries: [],
    };

    const violations = validateQuestionnaireResults(result);
    expect(violations).toHaveLength(1);
    expect(violations[0].family).toBe('SEED');
    expect(violations[0].question).toBe(SEED_BATTERY.questions[7]);
    expect(violations[0].reason).toContain('required at least 1 cast_seed candidate(s) with disposition VILLAIN (§4b); compiled 0');
  });

  it('SEED zero seeds: yields 2 violations (count requirement and villain disposition requirement)', () => {
    const stage1Responses = makeResponses('SEED', SEED_BATTERY.questions.length);
    const result: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        seed: { seeds: [] },
      },
      failedBatteries: [],
    };

    const violations = validateQuestionnaireResults(result);
    expect(violations).toHaveLength(2);

    expect(violations[0].family).toBe('SEED');
    expect(violations[0].question).toBe(SEED_BATTERY.questions[7]);
    expect(violations[0].reason).toBe('required at least 1 cast_seed candidate(s); compiled 0');

    expect(violations[1].family).toBe('SEED');
    expect(violations[1].question).toBe(SEED_BATTERY.questions[7]);
    expect(violations[1].reason).toBe('required at least 1 cast_seed candidate(s) with disposition VILLAIN (§4b); compiled 0');
  });

  it('VILLAIN exact: 1 profile succeeds, 0 profiles yields 1 violation', () => {
    const stage1Responses = makeResponses('VILLAIN', VILLAIN_BATTERY.questions.length);

    const okResult: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        villain: { profiles: [{ target: 'antagonist_profile', id: 'v1' }] },
      },
      failedBatteries: [],
    };
    expect(validateQuestionnaireResults(okResult)).toHaveLength(0);

    const emptyResult: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        villain: { profiles: [] },
      },
      failedBatteries: [],
    };
    const violations = validateQuestionnaireResults(emptyResult);
    expect(violations).toHaveLength(1);
    expect(violations[0].family).toBe('VILLAIN');
    expect(violations[0].question).toBe(VILLAIN_BATTERY.questions[0]);
    expect(violations[0].reason).toContain('required exactly 1 antagonist_profile candidate(s); compiled 0');
  });

  it('DEPICTION exact: 1 contract succeeds, 0 contracts yields 1 violation', () => {
    const stage1Responses = makeResponses('DEPICTION', DEPICTION_BATTERY.questions.length);

    const okResult: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        depiction: { contract: { target: 'depiction_contract', id: 'dc1' } },
      },
      failedBatteries: [],
    };
    expect(validateQuestionnaireResults(okResult)).toHaveLength(0);

    const emptyResult: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        depiction: {},
      },
      failedBatteries: [],
    };
    const violations = validateQuestionnaireResults(emptyResult);
    expect(violations).toHaveLength(1);
    expect(violations[0].family).toBe('DEPICTION');
    expect(violations[0].question).toBe(DEPICTION_BATTERY.questions[0]);
    expect(violations[0].reason).toContain('required exactly 1 depiction_contract candidate(s); compiled 0');
  });

  it('PRESSURE premise: rules with premise succeeds, rules without premise yields 1 violation', () => {
    const stage1Responses = makeResponses('PRESSURE', PRESSURE_BATTERY.questions.length);

    const okResult: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        pressure: {
          rules: [
            { target: 'premise', id: 'prem-1' },
            { target: 'environmental_rules', id: 'env-1' },
          ],
        },
      },
      failedBatteries: [],
    };
    expect(validateQuestionnaireResults(okResult)).toHaveLength(0);

    const noPremiseResult: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        pressure: {
          rules: [{ target: 'environmental_rules', id: 'env-1' }],
        },
      },
      failedBatteries: [],
    };
    const violations = validateQuestionnaireResults(noPremiseResult);
    expect(violations).toHaveLength(1);
    expect(violations[0].family).toBe('PRESSURE');
    expect(violations[0].question).toBe(PRESSURE_BATTERY.questions[0]);
    expect(violations[0].reason).toContain('required at least 1 premise candidate(s); compiled 0');
  });

  it('Not required: result with only RELATIONSHIPS responses yields no violations', () => {
    const stage1Responses = makeResponses('RELATIONSHIPS', RELATIONSHIPS_BATTERY.questions.length);
    const result: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        relationships: { anchors: [] },
      },
      failedBatteries: [],
    };

    expect(validateQuestionnaireResults(result)).toHaveLength(0);
  });

  it('Family not run: skips requirements for unrun families', () => {
    // Only TOPOLOGY was run and succeeded
    const stage1Responses = makeResponses('TOPOLOGY', TOPOLOGY_BATTERY.questions.length);
    const result: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        topology: {
          nodes: [{ target: 'topology_node', id: 'node-1' }],
          connections: [],
        },
      },
      failedBatteries: [],
    };

    const violations = validateQuestionnaireResults(result);
    expect(violations).toHaveLength(0);
  });

  it('Evasive: all answers matching EVASIVE_RE pattern flags explicit non-answer note in reason', () => {
    expect(EVASIVE_RE.test('The source document does not contain any character names.')).toBe(true);
    expect(EVASIVE_RE.test('The text does not mention who is hurt.')).toBe(true);
    expect(EVASIVE_RE.test('The material does not describe this location.')).toBe(true);

    const stage1Responses: Stage1Response[] = SEED_BATTERY.questions.map((q, idx) => ({
      family: 'SEED',
      questionIndex: idx,
      question: q,
      answer: 'The source document does not contain any information about characters.',
      citations: [],
    }));

    const result: PipelineResult = {
      stage1Responses,
      compiledCandidates: {
        seed: { seeds: [] },
      },
      failedBatteries: [],
    };

    const violations = validateQuestionnaireResults(result);
    expect(violations).toHaveLength(2);
    for (const v of violations) {
      expect(v.reason).toContain('the source explicitly did not answer the battery questions');
    }
  });

  it('Failed family: family in failedBatteries notes compilation failure in reason', () => {
    const stage1Responses = makeResponses('TOPOLOGY', TOPOLOGY_BATTERY.questions.length);
    const result: PipelineResult = {
      stage1Responses,
      compiledCandidates: {},
      failedBatteries: ['TOPOLOGY'],
    };

    const violations = validateQuestionnaireResults(result);
    expect(violations).toHaveLength(1);
    expect(violations[0].family).toBe('TOPOLOGY');
    expect(violations[0].reason).toContain('family failed Stage 2 compilation');
    expect(violations[0].reason).not.toContain('the source explicitly did not answer the battery questions');
  });

  it('Shape sync: collectQuestionnaireCandidates flattens all C2 shapes and ignores non-candidates like elicitation', () => {
    const compiled = {
      topology: {
        nodes: [{ id: 'n1', target: 'topology_node' }],
        connections: [{ id: 'c1', target: 'topology_connection' }],
      },
      seed: {
        seeds: [{ id: 's1', target: 'cast_seed', proposedValue: { disposition: 'VILLAIN' } }],
      },
      expressionGuidance: {
        expressionGuidance: [{ id: 'eg1', target: 'cast_expression_guidance' }],
      },
      villain: {
        profiles: [{ id: 'v1', target: 'antagonist_profile' }],
      },
      relationships: {
        anchors: [{ id: 'va1', target: 'value_anchor' }],
      },
      pressure: {
        rules: [{ id: 'r1', target: 'premise' }],
        elicitation: {
          powerBudget: 'Standard mortal limits',
          powerLimits: 'Cannot teleport',
          deathMetaphysics: 'mundane',
          fearParameters: { threatVectorWeights: { life: 1, freedom: 1, identity: 1 } },
        },
      },
      depiction: {
        contract: { id: 'd1', target: 'depiction_contract' },
      },
    };

    const candidates = collectQuestionnaireCandidates(compiled);
    expect(candidates).toHaveLength(8);
    const ids = candidates.map((c) => c.id);
    expect(ids).toEqual(['n1', 'c1', 's1', 'eg1', 'v1', 'va1', 'r1', 'd1']);

    // Now validate full pipeline result when all required families were run and supplied
    const stage1Responses: Stage1Response[] = [
      ...makeResponses('TOPOLOGY', TOPOLOGY_BATTERY.questions.length),
      ...makeResponses('SEED', SEED_BATTERY.questions.length),
      ...makeResponses('VILLAIN', VILLAIN_BATTERY.questions.length),
      ...makeResponses('DEPICTION', DEPICTION_BATTERY.questions.length),
      ...makeResponses('PRESSURE', PRESSURE_BATTERY.questions.length),
      ...makeResponses('RELATIONSHIPS', RELATIONSHIPS_BATTERY.questions.length),
    ];

    const result: PipelineResult = {
      stage1Responses,
      compiledCandidates: compiled,
      failedBatteries: [],
    };

    const violations = validateQuestionnaireResults(result);
    expect(violations).toHaveLength(0);
  });

  it('REQUIREMENTS constant matches C4 specifications', () => {
    expect(REQUIREMENTS).toHaveLength(6);
    expect(REQUIREMENTS.map((r) => r.family)).toEqual([
      'TOPOLOGY',
      'SEED',
      'SEED',
      'VILLAIN',
      'DEPICTION',
      'PRESSURE',
    ]);
  });
});
