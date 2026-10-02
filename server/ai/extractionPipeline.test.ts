/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runStage1,
  runStage2,
  extractCitations,
  buildStage1Prompt,
  type Stage1Response,
} from './extractionPipeline';
import {
  TOPOLOGY_BATTERY,
  SEED_BATTERY,
  VILLAIN_BATTERY,
  RELATIONSHIPS_BATTERY,
  OBJECTS_BATTERY,
  PRESSURE_BATTERY,
  DEPICTION_BATTERY,
  EXTRACTION_BATTERIES,
} from './extractionBatteries';
import {
  compileBattery,
  compileSeedBattery,
  compileVillainBattery,
  compileRelationshipsBattery,
  compilePressureBattery,
  compileDepictionBattery,
  PressureElicitationSchema,
  buildStage2Prompt,
  buildStage2SeedPrompt,
  buildStage2ExpressionPrompt,
  buildStage2VillainPrompt,
  buildStage2RelationshipsPrompt,
  buildStage2PressureRulesPrompt,
  buildStage2PressureElicitationPrompt,
  buildStage2DepictionPrompt,
} from './extractionCompiler';
import {
  executeForgePrompt,
  executeForgePromptWithMeta,
} from './forgeProvider';

vi.mock('./forgeProvider', async () => {
  const mockMeta = vi.fn();
  return {
    executeForgePromptWithMeta: mockMeta,
    executeForgePrompt: async (prompt: string, options?: any) => {
      return (await mockMeta(prompt, options)).text;
    },
  };
});

describe('HG4 Packet 5b — Two-Stage Questionnaire Extraction Pipeline', () => {
  const mockMeta = vi.mocked(executeForgePromptWithMeta);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validSeedJson = JSON.stringify({
    seeds: [
      {
        id: 'SEED-seed-1',
        sourceId: 's1',
        classification: 'evidence',
        label: 'Alice',
        explanation: 'Cellar',
        evidenceIds: [],
        target: 'cast_seed',
        targetCastMemberId: 'Alice',
        proposedValue: {
          name: 'Alice',
          isUserCharacter: false,
          seed: {
            where: 'Cellar',
            doing: {
              mode: 'SUSPENDED',
            },
            condition: {
              restraint: {
                level: 'TIED_TO_FIXTURE',
              },
            },
            charge: {
              band: 'Acute Fear',
            },
            knows: [
              {
                id: 'SEED-knows-1',
                text: 'Danger',
              },
            ],
            wants: {
              kind: 'pursuit',
              text: 'Escape',
              groundedIn: ['SEED-knows-1'],
            },
            bonds: [],
          },
        },
      },
    ],
  });

  const validExpressionJson = JSON.stringify({
    expressionGuidance: [
      {
        id: 'SEED-expr-1',
        sourceId: 's1',
        classification: 'evidence',
        label: 'Alice expr',
        explanation: 'Voice',
        evidenceIds: [],
        target: 'cast_expression_guidance',
        targetCastMemberId: 'Alice',
        proposedValue: {
          communicationModes: ['spoken'],
          expressionGuidance: 'Whisper',
        },
      },
    ],
  });

  const mockSeedResponses: Stage1Response[] = SEED_BATTERY.questions.map((q, idx) => ({
    family: 'SEED',
    questionIndex: idx,
    question: q,
    answer: `Answer to seed Q${idx}`,
    citations: [`Citation for seed Q${idx}`],
  }));

  describe('TASK 3 — Battery definitions', () => {
    it('defines TOPOLOGY_BATTERY with 4 questions and target topology', () => {
      expect(TOPOLOGY_BATTERY.family).toBe('TOPOLOGY');
      expect(TOPOLOGY_BATTERY.questions).toHaveLength(4);
      expect(TOPOLOGY_BATTERY.compileTarget).toBe('topology');
    });

    it('defines SEED_BATTERY with 14 questions and target seed', () => {
      expect(SEED_BATTERY.family).toBe('SEED');
      expect(SEED_BATTERY.questions).toHaveLength(14);
      expect(SEED_BATTERY.compileTarget).toBe('seed');
    });

    it('registers all 7 batteries in EXTRACTION_BATTERIES in exact order', () => {
      expect(EXTRACTION_BATTERIES).toEqual([
        SEED_BATTERY,
        TOPOLOGY_BATTERY,
        VILLAIN_BATTERY,
        RELATIONSHIPS_BATTERY,
        OBJECTS_BATTERY,
        PRESSURE_BATTERY,
        DEPICTION_BATTERY,
      ]);
      expect(OBJECTS_BATTERY.stage1Only).toBe(true);
    });
  });

  describe('Citation extraction', () => {
    it('extracts CITE: lines and removes them from the answer', () => {
      const input = `The north door was barred from the inside.
CITE: "the north door was barred from the inside"
There is a second door leading to the cellar.
CITE: "a trapdoor led directly to the damp cellar"`;

      const result = extractCitations(input);
      expect(result.citations).toEqual([
        'the north door was barred from the inside',
        'a trapdoor led directly to the damp cellar',
      ]);
      expect(result.answer).toBe(
        'The north door was barred from the inside.\n\nThere is a second door leading to the cellar.'
      );
    });

    it('handles answers with no citations', () => {
      const input = 'No information was found in the text.';
      const result = extractCitations(input);
      expect(result.citations).toEqual([]);
      expect(result.answer).toBe('No information was found in the text.');
    });

    it('handles escaped quotes inside citation spans', () => {
      const input = `He said something.
CITE: "He yelled \\"Stop!\\" before running"`;
      const result = extractCitations(input);
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]).toBe('He yelled \\"Stop!\\" before running');
    });

    it('ignores empty and whitespace-only citations and trims whitespace', () => {
      const input = `Sentence one.
CITE: ""
Sentence two.
CITE: "   "
Sentence three.
CITE: "valid citation" `;
      const result = extractCitations(input);
      expect(result.citations).toEqual(['valid citation']);
      expect(result.answer).toBe('Sentence one.\n\nSentence two.\n\nSentence three.');
    });
  });

  describe('Stage 1 — Sequential dispatch & length truncation', () => {
    it('dispatches all batteries sequentially in order with prose default', async () => {
      mockMeta.mockImplementation(async () => ({
        text: 'Found evidence.\nCITE: "evidence excerpt"',
        finish_reason: 'stop',
      }));

      const responses = await runStage1('Source text content');
      expect(responses).toHaveLength(42);
      expect(mockMeta).toHaveBeenCalledTimes(42);

      // Verify no responseMimeType was passed
      for (const call of mockMeta.mock.calls) {
        expect(call[1]?.responseMimeType).toBeUndefined();
      }

      // Verify battery ordering: SEED, TOPOLOGY, VILLAIN, RELATIONSHIPS, OBJECTS, PRESSURE, DEPICTION
      expect(responses.slice(0, 14).every((r) => r.family === 'SEED')).toBe(true);
      expect(responses.slice(14, 18).every((r) => r.family === 'TOPOLOGY')).toBe(true);
      expect(responses.slice(18, 23).every((r) => r.family === 'VILLAIN')).toBe(true);
      expect(responses.slice(23, 28).every((r) => r.family === 'RELATIONSHIPS')).toBe(true);
      expect(responses.slice(28, 32).every((r) => r.family === 'OBJECTS')).toBe(true);
      expect(responses.slice(32, 38).every((r) => r.family === 'PRESSURE')).toBe(true);
      expect(responses.slice(38, 42).every((r) => r.family === 'DEPICTION')).toBe(true);
    });

    it('scopes dispatch when families filter is provided (TOPOLOGY)', async () => {
      mockMeta.mockResolvedValue({
        text: 'Space found.\nCITE: "bounded chamber"',
        finish_reason: 'stop',
      });

      const responses = await runStage1('Source text', { families: ['TOPOLOGY'] });
      expect(responses).toHaveLength(4);
      expect(mockMeta).toHaveBeenCalledTimes(4);
      expect(responses.every((r) => r.family === 'TOPOLOGY')).toBe(true);
    });

    it('scopes dispatch when families filter is provided (SEED 14 questions)', async () => {
      mockMeta.mockResolvedValue({
        text: 'Character state.\nCITE: "character was waiting"',
        finish_reason: 'stop',
      });

      const responses = await runStage1('Source text', { families: ['SEED'] });
      expect(responses).toHaveLength(14);
      expect(mockMeta).toHaveBeenCalledTimes(14);
      expect(responses.every((r) => r.family === 'SEED')).toBe(true);
      for (let i = 0; i < 14; i++) {
        expect(responses[i].questionIndex).toBe(i);
        expect(responses[i].question).toBe(SEED_BATTERY.questions[i]);
      }
    });

    it('retries once when finish_reason is length and succeeds on retry', async () => {
      mockMeta
        .mockResolvedValueOnce({ text: 'partial truncated answer', finish_reason: 'length' })
        .mockResolvedValueOnce({ text: 'full answer\nCITE: "full quote"', finish_reason: 'stop' });

      const responses = await runStage1('Source text', { families: ['TOPOLOGY'] });
      expect(mockMeta).toHaveBeenCalledTimes(5); // 1 retry + 3 remaining
      expect(responses[0].answer).toBe('full answer');
      expect(responses[0].citations).toEqual(['full quote']);
    });

    it('throws plain error when truncated on length twice in Stage 1', async () => {
      mockMeta
        .mockResolvedValueOnce({ text: 'partial 1', finish_reason: 'length' })
        .mockResolvedValueOnce({ text: 'partial 2', finish_reason: 'length' });

      await expect(runStage1('Source text', { families: ['TOPOLOGY'] })).rejects.toThrow(
        'Forge extraction Stage 1 truncated on length after one retry; shorten the source text or raise the output budget.'
      );
    });
  });

  describe('TASK 1 — Delegate contract', () => {
    it('delegates executeForgePrompt to executeForgePromptWithMeta returning .text', async () => {
      mockMeta.mockResolvedValueOnce({ text: 'result string', finish_reason: null });
      const result = await executeForgePrompt('Test prompt');
      expect(result).toBe('result string');
      expect(mockMeta).toHaveBeenCalledWith('Test prompt', undefined);
    });
  });

  describe('Stage 2 — Topology compilation', () => {
    const validTopologyJson = JSON.stringify({
      nodes: [
        {
          id: 'TOPOLOGY-node-1',
          sourceId: 'src-1',
          classification: 'evidence',
          label: 'Cellar',
          explanation: 'Underground room',
          evidenceIds: [],
          target: 'topology_node',
          proposedValue: {
            id: 'node-cellar',
            label: 'Cellar',
            name: 'Cellar',
            description: 'Dark cold room',
          },
        },
      ],
      connections: [
        {
          id: 'TOPOLOGY-edge-1',
          sourceId: 'src-1',
          classification: 'evidence',
          label: 'Stairs',
          explanation: 'Stairs connect cellar to kitchen',
          evidenceIds: [],
          target: 'topology_connection',
          proposedValue: {
            from: 'node-cellar',
            to: 'node-kitchen',
            kind: 'PHYSICAL',
            requires: ['cellar-key'],
            userInitiated: true,
          },
        },
      ],
    });

    const mockTopologyResponses: Stage1Response[] = TOPOLOGY_BATTERY.questions.map((q, idx) => ({
      family: 'TOPOLOGY',
      questionIndex: idx,
      question: q,
      answer: `Answer to ${q}`,
      citations: [`Citation for ${q}`],
    }));

    it('compiles valid topology Q&A into candidate structures with application/json mimeType', async () => {
      mockMeta.mockResolvedValueOnce({
        text: validTopologyJson,
        finish_reason: 'stop',
      });

      const result = await compileBattery('TOPOLOGY', mockTopologyResponses, 'topology');
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('connections');
      expect((result as any).nodes).toHaveLength(1);
      expect((result as any).connections).toHaveLength(1);

      expect(mockMeta).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ responseMimeType: 'application/json' })
      );
    });

    it('enforces citation gate: throws [CITATION REQUIRED] when a question has no citations', async () => {
      const invalidResponses = [...mockTopologyResponses];
      invalidResponses[1] = {
        ...invalidResponses[1],
        citations: [],
      };

      await expect(compileBattery('TOPOLOGY', invalidResponses, 'topology')).rejects.toThrow(
        `[CITATION REQUIRED] Question "${invalidResponses[1].question}" has no excerpt citations.`
      );
    });

    it('enforces citation gate: rejects whitespace-only citations', async () => {
      const invalidResponses = [...mockTopologyResponses];
      invalidResponses[1] = {
        ...invalidResponses[1],
        citations: ['   ', ''],
      };

      await expect(compileBattery('TOPOLOGY', invalidResponses, 'topology')).rejects.toThrow(
        `[CITATION REQUIRED] Question "${invalidResponses[1].question}" has no excerpt citations.`
      );
    });

    it('records TOPOLOGY in failedBatteries during runStage2 when citation is missing', async () => {
      const invalidResponses = [...mockTopologyResponses];
      invalidResponses[0] = {
        ...invalidResponses[0],
        citations: [],
      };

      const result = await runStage2(invalidResponses);
      expect(result.failedBatteries).toContain('TOPOLOGY');
      expect(result.compiledCandidates).not.toHaveProperty('topology');
    });

    it('isolates failures per-family during runStage2', async () => {
      // TOPOLOGY succeeds, fabricated CAST fails
      mockMeta.mockResolvedValueOnce({
        text: validTopologyJson,
        finish_reason: 'stop',
      });

      const mixedResponses: Stage1Response[] = [
        ...mockTopologyResponses,
        {
          family: 'CAST',
          questionIndex: 0,
          question: 'Who is there?',
          answer: 'Unknown',
          citations: ['someone was there'],
        },
      ];

      const result = await runStage2(mixedResponses);
      expect(result.compiledCandidates).toHaveProperty('topology');
      expect(result.failedBatteries).toContain('CAST');
      expect(result.failedBatteries).not.toContain('TOPOLOGY');
    });

    it('handles length retry in Stage 2 calls', async () => {
      mockMeta
        .mockResolvedValueOnce({ text: 'truncated json', finish_reason: 'length' })
        .mockResolvedValueOnce({ text: validTopologyJson, finish_reason: 'stop' });

      const result = await compileBattery('TOPOLOGY', mockTopologyResponses, 'topology');
      expect(result).toHaveProperty('nodes');
      expect(mockMeta).toHaveBeenCalledTimes(2);
    });

    it('throws error when Stage 2 truncates on length twice', async () => {
      mockMeta
        .mockResolvedValueOnce({ text: 'truncated 1', finish_reason: 'length' })
        .mockResolvedValueOnce({ text: 'truncated 2', finish_reason: 'length' });

      await expect(compileBattery('TOPOLOGY', mockTopologyResponses, 'topology')).rejects.toThrow(
        'Forge extraction Stage 2 truncated on length after one retry; shorten the source text or raise the output budget.'
      );
    });

    it('throws [COMPILE PARSE] when Stage 2 does not return valid JSON', async () => {
      mockMeta.mockResolvedValueOnce({
        text: 'This is not json at all',
        finish_reason: 'stop',
      });

      await expect(compileBattery('TOPOLOGY', mockTopologyResponses, 'topology')).rejects.toThrow(
        '[COMPILE PARSE] Stage 2 did not return valid JSON.'
      );
    });

    it('throws [UNSUPPORTED BATTERY] for unknown family in compileBattery', async () => {
      await expect(compileBattery('UNKNOWN', mockTopologyResponses, 'unknown')).rejects.toThrow(
        '[UNSUPPORTED BATTERY] Compilation for UNKNOWN not yet implemented.'
      );
    });
  });

  describe('Stage 2 — SEED compilation & gates', () => {
    it('compiles valid seed Q&A into candidate structures with application/json mimeType', async () => {
      mockMeta
        .mockResolvedValueOnce({
          text: validSeedJson,
          finish_reason: 'stop',
        })
        .mockResolvedValueOnce({
          text: validExpressionJson,
          finish_reason: 'stop',
        });

      const result = await compileBattery('SEED', mockSeedResponses, 'seed');
      expect(result).toHaveProperty('seeds');
      expect(result).toHaveProperty('expressionGuidance');
      expect((result as any).seeds).toHaveLength(1);
      expect((result as any).expressionGuidance).toHaveLength(1);
      const seedCandidate = (result as any).seeds[0];
      expect(seedCandidate.target).toBe('cast_seed');
      expect(seedCandidate.targetCastMemberId).toBe('Alice');
      expect(seedCandidate.proposedValue.seed.where).toBe('Cellar');
      expect(seedCandidate.proposedValue.seed.doing.mode).toBe('SUSPENDED');
      expect(seedCandidate.proposedValue.seed.condition.restraint.level).toBe('TIED_TO_FIXTURE');

      expect(mockMeta).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ responseMimeType: 'application/json' })
      );
    });

    it('enforces SEED citation gate: records SEED in failedBatteries when citation is missing', async () => {
      const invalidSeedResponses = [...mockSeedResponses];
      invalidSeedResponses[2] = {
        ...invalidSeedResponses[2],
        citations: [],
      };

      const result = await runStage2(invalidSeedResponses);
      expect(result.failedBatteries).toContain('SEED');
    });

    it('enforces grounding gate: rejects pursuit want with empty groundedIn', async () => {
      const ungroundedJson = JSON.stringify({
        seeds: [
          {
            id: 'SEED-seed-1',
            sourceId: 'src-doc',
            classification: 'evidence',
            label: 'Alice opening state',
            explanation: 'Alice wants to escape',
            evidenceIds: [],
            target: 'cast_seed',
            targetCastMemberId: 'Alice',
            proposedValue: {
              name: 'Alice',
              isUserCharacter: false,
              seed: {
                where: 'Cellar',
                doing: { mode: 'ACTIVE' },
                condition: {},
                charge: { band: 'calm' },
                knows: [{ id: 'SEED-knows-1', text: 'Something' }],
                wants: {
                  kind: 'pursuit',
                  text: 'Escape',
                  groundedIn: [],
                },
                bonds: [],
              },
            },
          },
        ],
      });

      mockMeta.mockResolvedValueOnce({
        text: ungroundedJson,
        finish_reason: 'stop',
      });

      await expect(compileSeedBattery('SEED', mockSeedResponses)).rejects.toThrow(
        '[GROUNDING REQUIRED] Character "Alice" pursuit want cites no resolvable knows id.'
      );
    });

    it('enforces grounding gate: rejects pursuit want with unresolvable knows id', async () => {
      const unresolvableJson = JSON.stringify({
        seeds: [
          {
            id: 'SEED-seed-1',
            sourceId: 'src-doc',
            classification: 'evidence',
            label: 'Alice opening state',
            explanation: 'Alice wants to escape',
            evidenceIds: [],
            target: 'cast_seed',
            targetCastMemberId: 'Alice',
            proposedValue: {
              name: 'Alice',
              isUserCharacter: false,
              seed: {
                where: 'Cellar',
                doing: { mode: 'ACTIVE' },
                condition: {},
                charge: { band: 'calm' },
                knows: [{ id: 'SEED-knows-1', text: 'Something' }],
                wants: {
                  kind: 'pursuit',
                  text: 'Escape',
                  groundedIn: ['SEED-knows-NONEXISTENT'],
                },
                bonds: [],
              },
            },
          },
        ],
      });

      mockMeta.mockResolvedValueOnce({
        text: unresolvableJson,
        finish_reason: 'stop',
      });

      await expect(compileSeedBattery('SEED', mockSeedResponses)).rejects.toThrow(
        '[GROUNDING REQUIRED] Character "Alice" pursuit want cites no resolvable knows id.'
      );
    });

    it('enforces duplicate character gate: rejects case-insensitive duplicate targetCastMemberId', async () => {
      const duplicateJson = JSON.stringify({
        seeds: [
          {
            id: 'SEED-seed-1',
            sourceId: 'src-doc',
            classification: 'evidence',
            label: 'Alice 1',
            explanation: 'First',
            evidenceIds: [],
            target: 'cast_seed',
            targetCastMemberId: 'Alice',
            proposedValue: {
              name: 'Alice',
              isUserCharacter: false,
              seed: {
                where: 'Room 1',
                doing: { mode: 'ACTIVE' },
                condition: {},
                charge: { band: 'calm' },
                knows: [],
                bonds: [],
              },
            },
          },
          {
            id: 'SEED-seed-2',
            sourceId: 'src-doc',
            classification: 'evidence',
            label: 'Alice 2',
            explanation: 'Second',
            evidenceIds: [],
            target: 'cast_seed',
            targetCastMemberId: 'alice',
            proposedValue: {
              name: 'Alice',
              isUserCharacter: false,
              seed: {
                where: 'Room 2',
                doing: { mode: 'ACTIVE' },
                condition: {},
                charge: { band: 'calm' },
                knows: [],
                bonds: [],
              },
            },
          },
        ],
      });

      mockMeta.mockResolvedValueOnce({
        text: duplicateJson,
        finish_reason: 'stop',
      });

      await expect(compileSeedBattery('SEED', mockSeedResponses)).rejects.toThrow(
        '[DUPLICATE SEED] Multiple seed candidates for character "alice".'
      );
    });

    it('enforces duplicate character gate: does not falsely collide distinct characters when targetCastMemberId is omitted', async () => {
      const distinctCharsJson = JSON.stringify({
        seeds: [
          {
            id: 'S-1',
            sourceId: 's',
            classification: 'evidence',
            label: 'A',
            explanation: 'A',
            evidenceIds: [],
            target: 'cast_seed',
            proposedValue: {
              name: 'Alice',
              isUserCharacter: false,
              seed: { where: 'R1', doing: { mode: 'ACTIVE' }, condition: {}, charge: { band: 'calm' }, knows: [], bonds: [] },
            },
          },
          {
            id: 'S-2',
            sourceId: 's',
            classification: 'evidence',
            label: 'B',
            explanation: 'B',
            evidenceIds: [],
            target: 'cast_seed',
            proposedValue: {
              name: 'Bob',
              isUserCharacter: false,
              seed: { where: 'R2', doing: { mode: 'ACTIVE' }, condition: {}, charge: { band: 'calm' }, knows: [], bonds: [] },
            },
          },
        ],
      });

      const conciseExprJson = JSON.stringify({
        expressionGuidance: [],
      });

      mockMeta
        .mockResolvedValueOnce({
          text: distinctCharsJson,
          finish_reason: 'stop',
        })
        .mockResolvedValueOnce({
          text: conciseExprJson,
          finish_reason: 'stop',
        });

      const res = await compileSeedBattery('SEED', mockSeedResponses);
      expect(res).toBeDefined();
    });

    it('enforces duplicate character gate: detects duplicate between targetCastMemberId and proposedValue.name', async () => {
      const crossDuplicateJson = JSON.stringify({
        seeds: [
          {
            id: 'SEED-seed-1',
            sourceId: 'src-doc',
            classification: 'evidence',
            label: 'Alice 1',
            explanation: 'First',
            evidenceIds: [],
            target: 'cast_seed',
            targetCastMemberId: 'Alice',
            proposedValue: {
              name: 'Alice',
              isUserCharacter: false,
              seed: { where: 'Room 1', doing: { mode: 'ACTIVE' }, condition: {}, charge: { band: 'calm' }, knows: [], bonds: [] },
            },
          },
          {
            id: 'SEED-seed-2',
            sourceId: 'src-doc',
            classification: 'evidence',
            label: 'Alice 2',
            explanation: 'Second',
            evidenceIds: [],
            target: 'cast_seed',
            proposedValue: {
              name: 'alice',
              isUserCharacter: false,
              seed: { where: 'Room 2', doing: { mode: 'ACTIVE' }, condition: {}, charge: { band: 'calm' }, knows: [], bonds: [] },
            },
          },
        ],
      });

      mockMeta.mockResolvedValueOnce({
        text: crossDuplicateJson,
        finish_reason: 'stop',
      });

      await expect(compileSeedBattery('SEED', mockSeedResponses)).rejects.toThrow(
        '[DUPLICATE SEED] Multiple seed candidates for character "alice".'
      );
    });

    it('enforces invalid restraint gate: rejects restraint level outside vocabulary', async () => {
      const invalidRestraintJson = JSON.stringify({
        seeds: [
          {
            id: 'SEED-seed-1',
            sourceId: 'src-doc',
            classification: 'evidence',
            label: 'Bob opening state',
            explanation: 'Bob is tied in a bizarre way',
            evidenceIds: [],
            target: 'cast_seed',
            targetCastMemberId: 'Bob',
            proposedValue: {
              name: 'Bob',
              isUserCharacter: false,
              seed: {
                where: 'Dungeon',
                doing: { mode: 'SUSPENDED' },
                condition: {
                  restraint: {
                    level: 'CHAINED_BY_ANKLES_FROM_RAFTERS',
                  },
                },
                charge: { band: 'Severe Panic' },
                knows: [],
                bonds: [],
              },
            },
          },
        ],
      });

      mockMeta.mockResolvedValueOnce({
        text: invalidRestraintJson,
        finish_reason: 'stop',
      });

      await expect(compileSeedBattery('SEED', mockSeedResponses)).rejects.toThrow(
        '[INVALID RESTRAINT] Character "Bob" has unknown restraint level "CHAINED_BY_ANKLES_FROM_RAFTERS".'
      );
    });

    it('passes CC2 budget ratchet with normal Stage 2 output', async () => {
      mockMeta
        .mockResolvedValueOnce({
          text: validSeedJson,
          finish_reason: 'stop',
        })
        .mockResolvedValueOnce({
          text: validExpressionJson,
          finish_reason: 'stop',
        });

      const result = await compileSeedBattery('SEED', mockSeedResponses);
      expect(result).toBeDefined();
    });

    it('records SEED in failedBatteries during runStage2 when grounding fails', async () => {
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          seeds: [
            {
              id: 'SEED-seed-1',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'Alice',
              explanation: 'Alice wants to escape',
              evidenceIds: [],
              target: 'cast_seed',
              targetCastMemberId: 'Alice',
              proposedValue: {
                name: 'Alice',
                isUserCharacter: false,
                seed: {
                  where: 'Cellar',
                  doing: { mode: 'ACTIVE' },
                  condition: {},
                  charge: { band: 'calm' },
                  knows: [],
                  wants: { kind: 'pursuit', text: 'Escape', groundedIn: [] },
                  bonds: [],
                },
              },
            },
          ],
        }),
        finish_reason: 'stop',
      });

      const result = await runStage2(mockSeedResponses);
      expect(result.failedBatteries).toContain('SEED');
      expect(result.compiledCandidates).not.toHaveProperty('seed');
    });

    it('records SEED in failedBatteries during runStage2 when duplicate characters exist', async () => {
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          seeds: [
            {
              id: 'SEED-seed-1',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'Alice 1',
              explanation: 'First',
              evidenceIds: [],
              target: 'cast_seed',
              targetCastMemberId: 'Alice',
              proposedValue: {
                name: 'Alice',
                isUserCharacter: false,
                seed: { where: 'Room 1', doing: { mode: 'ACTIVE' }, condition: {}, charge: { band: 'calm' }, knows: [], bonds: [] },
              },
            },
            {
              id: 'SEED-seed-2',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'Alice 2',
              explanation: 'Second',
              evidenceIds: [],
              target: 'cast_seed',
              targetCastMemberId: 'ALICE',
              proposedValue: {
                name: 'Alice',
                isUserCharacter: false,
                seed: { where: 'Room 2', doing: { mode: 'ACTIVE' }, condition: {}, charge: { band: 'calm' }, knows: [], bonds: [] },
              },
            },
          ],
        }),
        finish_reason: 'stop',
      });

      const result = await runStage2(mockSeedResponses);
      expect(result.failedBatteries).toContain('SEED');
    });

    it('records SEED in failedBatteries during runStage2 when restraint level is invalid', async () => {
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          seeds: [
            {
              id: 'SEED-seed-1',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'Bob',
              explanation: 'Tied up',
              evidenceIds: [],
              target: 'cast_seed',
              targetCastMemberId: 'Bob',
              proposedValue: {
                name: 'Bob',
                isUserCharacter: false,
                seed: {
                  where: 'Room',
                  doing: { mode: 'SUSPENDED' },
                  condition: { restraint: { level: 'INVALID_RESTRAINT_LEVEL' } },
                  charge: { band: 'calm' },
                  knows: [],
                  bonds: [],
                },
              },
            },
          ],
        }),
        finish_reason: 'stop',
      });

      const result = await runStage2(mockSeedResponses);
      expect(result.failedBatteries).toContain('SEED');
    });

    it('enforces CC2 prompt budget ratchet: throws [CC2 BUDGET VIOLATION] when compiled output exceeds budget', async () => {
      // Create a valid candidate structure with a very long explanation exceeding 1200 chars
      const giantExplanation = 'A'.repeat(1300);
      const giantJson = JSON.stringify({
        seeds: [
          {
            id: 'SEED-seed-1',
            sourceId: 'src-doc',
            classification: 'evidence',
            label: 'Giant Candidate',
            explanation: giantExplanation,
            evidenceIds: [],
            target: 'cast_seed',
            targetCastMemberId: 'Giant',
            proposedValue: {
              name: 'Giant',
              isUserCharacter: false,
              seed: {
                where: 'Chamber',
                doing: { mode: 'SUSPENDED' },
                condition: {},
                charge: { band: 'calm' },
                knows: [],
                bonds: [],
              },
            },
          },
        ],
      });

      mockMeta
        .mockResolvedValueOnce({
          text: giantJson,
          finish_reason: 'stop',
        })
        .mockResolvedValueOnce({
          text: validExpressionJson,
          finish_reason: 'stop',
        });

      await expect(compileSeedBattery('SEED', mockSeedResponses)).rejects.toThrow(
        /\[CC2 BUDGET VIOLATION\] World state prompt section exceeded 1200 chars/
      );
    });
  });

  describe('Prompt builder utilities', () => {
    it('buildStage1Prompt embeds source text, family and question with citation instructions', () => {
      const prompt = buildStage1Prompt('My story text', 'TOPOLOGY', 'What rooms exist?');
      expect(prompt).toContain('Family: TOPOLOGY');
      expect(prompt).toContain('My story text');
      expect(prompt).toContain('Question: What rooms exist?');
      expect(prompt).toContain('CITE:');
    });

    it('buildStage2Prompt formats Q&A with citations and JSON instructions', () => {
      const responses: Stage1Response[] = [
        {
          family: 'TOPOLOGY',
          questionIndex: 0,
          question: 'Rooms?',
          answer: 'The hall.',
          citations: ['the great hall'],
        },
      ];
      const prompt = buildStage2Prompt('TOPOLOGY', responses);
      expect(prompt).toContain('Q: Rooms?');
      expect(prompt).toContain('A: The hall.');
      expect(prompt).toContain('Citations: "the great hall"');
      expect(prompt).toContain('"nodes"');
      expect(prompt).toContain('"connections"');
    });

    it('buildStage2SeedPrompt formats Q&A with citations and seed candidate instructions', () => {
      const responses: Stage1Response[] = [
        {
          family: 'SEED',
          questionIndex: 0,
          question: 'Where is everyone?',
          answer: 'Alice is in the attic.',
          citations: ['Alice sat alone in the attic'],
        },
      ];
      const prompt = buildStage2SeedPrompt('SEED', responses);
      expect(prompt).toContain('Q: Where is everyone?');
      expect(prompt).toContain('A: Alice is in the attic.');
      expect(prompt).toContain('Citations: "Alice sat alone in the attic"');
      expect(prompt).toContain('"seeds"');
      expect(prompt).toContain('cast_seed');
      expect(prompt).toContain('description');
      expect(prompt).toContain('personality');
      expect(prompt).toContain('goals');
      expect(prompt).toContain('traits');
      expect(prompt).toContain('disposition');
    });

    it('buildStage2ExpressionPrompt formats Q&A and specifies cast_expression_guidance shape', () => {
      const responses: Stage1Response[] = [
        {
          family: 'SEED',
          questionIndex: 0,
          question: 'How do they sound?',
          answer: 'Whispered voice.',
          citations: ['she whispered'],
        },
      ];
      const prompt = buildStage2ExpressionPrompt('SEED', responses);
      expect(prompt).toContain('"expressionGuidance"');
      expect(prompt).toContain('cast_expression_guidance');
    });

    it('buildStage2VillainPrompt formats Q&A and specifies antagonist profile and villainProtagonist', () => {
      const responses: Stage1Response[] = [
        {
          family: 'VILLAIN',
          questionIndex: 0,
          question: 'What is the harm?',
          answer: 'An entity.',
          citations: ['the dark entity'],
        },
      ];
      const prompt = buildStage2VillainPrompt('VILLAIN', responses);
      expect(prompt).toContain('"profiles"');
      expect(prompt).toContain('antagonist_profile');
      expect(prompt).toContain('villainProtagonist');
    });

    it('buildStage2RelationshipsPrompt formats Q&A and specifies value_anchor shape', () => {
      const responses: Stage1Response[] = [
        {
          family: 'RELATIONSHIPS',
          questionIndex: 0,
          question: 'Who trusts whom?',
          answer: 'Alice trusts Bob.',
          citations: ['trusted Bob'],
        },
      ];
      const prompt = buildStage2RelationshipsPrompt('RELATIONSHIPS', responses);
      expect(prompt).toContain('"anchors"');
      expect(prompt).toContain('value_anchor');
    });

    it('buildStage2PressureRulesPrompt and buildStage2PressureElicitationPrompt format Q&A', () => {
      const responses: Stage1Response[] = [
        {
          family: 'PRESSURE',
          questionIndex: 0,
          question: 'What breaks them?',
          answer: 'Isolation.',
          citations: ['could not bear isolation'],
        },
      ];
      const rulesPrompt = buildStage2PressureRulesPrompt('PRESSURE', responses);
      expect(rulesPrompt).toContain('"rules"');
      expect(rulesPrompt).toContain('environmental_rule');

      const elicitationPrompt = buildStage2PressureElicitationPrompt('PRESSURE', responses);
      expect(elicitationPrompt).toContain('deathMetaphysics');
      expect(elicitationPrompt).toContain('unknowns');
    });

    it('buildStage2DepictionPrompt formats Q&A and specifies depiction_contract shape', () => {
      const responses: Stage1Response[] = [
        {
          family: 'DEPICTION',
          questionIndex: 0,
          question: 'Tone?',
          answer: 'Bleak.',
          citations: ['a bleak darkness'],
        },
      ];
      const prompt = buildStage2DepictionPrompt('DEPICTION', responses);
      expect(prompt).toContain('"contract"');
      expect(prompt).toContain('depiction_contract');
    });
  });

  describe('Stage 2 — Packet C2 Batteries Compilation & Gates', () => {
    const validVillainJson = JSON.stringify({
      profiles: [
        {
          id: 'VILLAIN-profile-1',
          sourceId: 'src-doc',
          classification: 'evidence',
          label: 'The Overseer profile',
          explanation: 'Antagonist apparatus controlling the sector',
          evidenceIds: [],
          target: 'antagonist_profile',
          proposedValue: {
            name: 'The Overseer',
            kind: 'APPARATUS',
          },
        },
      ],
      villainProtagonist: true,
    });

    const mockVillainResponses: Stage1Response[] = VILLAIN_BATTERY.questions.map((q, idx) => ({
      family: 'VILLAIN',
      questionIndex: idx,
      question: q,
      answer: `Villain answer ${idx}`,
      citations: [`Villain cite ${idx}`],
    }));

    const validRelationshipsJson = JSON.stringify({
      anchors: [
        {
          id: 'RELATIONSHIPS-anchor-1',
          sourceId: 'src-doc',
          classification: 'evidence',
          label: 'Alice and Bob trust',
          explanation: 'Mutual reliance between survivors',
          evidenceIds: [],
          target: 'value_anchor',
          proposedValue: {
            id: 'anchor-alice-bob',
            holder: {
              kind: 'RELATIONSHIP',
              castMemberIds: ['Alice', 'Bob'],
            },
            label: 'Lifeline Pact',
            description: 'Alice and Bob agreed never to leave each other behind.',
            basisSummary: 'Childhood pact renewed under pressure.',
            provenance: {
              kind: 'CREATOR_DEFINED',
            },
          },
        },
      ],
    });

    const mockRelationshipsResponses: Stage1Response[] = RELATIONSHIPS_BATTERY.questions.map((q, idx) => ({
      family: 'RELATIONSHIPS',
      questionIndex: idx,
      question: q,
      answer: `Relationships answer ${idx}`,
      citations: [`Relationships cite ${idx}`],
    }));

    const mockObjectsResponses: Stage1Response[] = OBJECTS_BATTERY.questions.map((q, idx) => ({
      family: 'OBJECTS',
      questionIndex: idx,
      question: q,
      answer: `Objects answer ${idx}`,
      citations: [`Objects cite ${idx}`],
    }));

    const validPressureRulesJson = JSON.stringify({
      rules: [
        {
          id: 'PRESSURE-rule-1',
          sourceId: 'src-doc',
          classification: 'evidence',
          label: 'Facility quarantine',
          explanation: 'Premise rule',
          evidenceIds: [],
          target: 'premise',
          proposedValue: 'The facility is sealed under biological quarantine.',
        },
        {
          id: 'PRESSURE-rule-2',
          sourceId: 'src-doc',
          classification: 'evidence',
          label: 'Failing air scrubbers',
          explanation: 'Environmental degradation rule',
          evidenceIds: [],
          target: 'environmental_rule',
          proposedValue: 'Oxygen levels drop continuously.',
        },
      ],
    });

    const validPressureElicitationJson = JSON.stringify({
      powerBudget: 'Local facility control only',
      powerLimits: 'Stopped by heavy blast doors',
      deathMetaphysics: 'unknown',
      fearParameters: {
        fearlessnessThresholds: 'Panics when lights flicker',
        threatVectorWeights: {
          life: 1.0,
          freedom: 1.0,
          identity: 1.0,
        },
        releaseValves: ['Prayer'],
      },
      unknowns: ['Antagonist origin', 'True duration of quarantine'],
    });

    const mockPressureResponses: Stage1Response[] = PRESSURE_BATTERY.questions.map((q, idx) => ({
      family: 'PRESSURE',
      questionIndex: idx,
      question: q,
      answer: `Pressure answer ${idx}`,
      citations: [`Pressure cite ${idx}`],
    }));

    const validDepictionJson = JSON.stringify({
      contract: {
        id: 'DEPICTION-contract-1',
        sourceId: 'src-doc',
        classification: 'evidence',
        label: 'Depiction Contract',
        explanation: 'Tone and directness boundaries',
        evidenceIds: ['ev-1'],
        target: 'depiction_contract',
        proposedValue: {
          dramaticRegister: 'Bleak psychological dread',
          directness: 'Violence is sudden and cut short',
          aftermath: 'Lingering bodily tension',
          ambiguityHandling: 'Unknown sounds remain unexplained',
          specialBoundaries: 'No violence against children',
        },
      },
    });

    const mockDepictionResponses: Stage1Response[] = DEPICTION_BATTERY.questions.map((q, idx) => ({
      family: 'DEPICTION',
      questionIndex: idx,
      question: q,
      answer: `Depiction answer ${idx}`,
      citations: [`Depiction cite ${idx}`],
    }));

    it('SEED: second Stage 2 call compiles cast_expression_guidance candidate returned under compiledCandidates.seed.expressionGuidance', async () => {
      mockMeta
        .mockResolvedValueOnce({
          text: validSeedJson,
          finish_reason: 'stop',
        })
        .mockResolvedValueOnce({
          text: validExpressionJson,
          finish_reason: 'stop',
        });

      const result = await runStage2(mockSeedResponses);
      expect(result.failedBatteries).not.toContain('SEED');
      const seedOutput = result.compiledCandidates.seed as any;
      expect(seedOutput).toBeDefined();
      expect(seedOutput.expressionGuidance).toHaveLength(1);
      expect(seedOutput.expressionGuidance[0].target).toBe('cast_expression_guidance');
      expect(seedOutput.expressionGuidance[0].targetCastMemberId).toBe('Alice');
      expect(seedOutput.expressionGuidance[0].proposedValue.communicationModes).toEqual(['spoken']);
    });

    it('VILLAIN: dispatches 5 questions and folds villainProtagonist into profile proposedValue', async () => {
      mockMeta.mockResolvedValueOnce({
        text: validVillainJson,
        finish_reason: 'stop',
      });

      const result = await runStage2(mockVillainResponses);
      expect(result.failedBatteries).not.toContain('VILLAIN');
      const villainOutput = result.compiledCandidates.villain as any;
      expect(villainOutput).toBeDefined();
      expect(villainOutput.profiles).toHaveLength(1);
      expect(villainOutput.profiles[0].target).toBe('antagonist_profile');
      expect(villainOutput.profiles[0].proposedValue.name).toBe('The Overseer');
      expect(villainOutput.profiles[0].proposedValue.villainProtagonist).toBe(true);
    });

    it('VILLAIN count gate: allows 1-3 profiles and rejects 0 or 4 profiles', async () => {
      // 0 profiles
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({ profiles: [], villainProtagonist: false }),
        finish_reason: 'stop',
      });
      const result0 = await runStage2(mockVillainResponses);
      expect(result0.failedBatteries).toContain('VILLAIN');

      // 4 profiles
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          profiles: [
            {
              id: 'VILLAIN-profile-1',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P1',
              explanation: 'E1',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V1', kind: 'APPARATUS' },
            },
            {
              id: 'VILLAIN-profile-2',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P2',
              explanation: 'E2',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V2', kind: 'FORCE' },
            },
            {
              id: 'VILLAIN-profile-3',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P3',
              explanation: 'E3',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V3', kind: 'ENTITY' },
            },
            {
              id: 'VILLAIN-profile-4',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P4',
              explanation: 'E4',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V4', kind: 'SYSTEM' },
            },
          ],
          villainProtagonist: false,
        }),
        finish_reason: 'stop',
      });
      const result4 = await runStage2(mockVillainResponses);
      expect(result4.failedBatteries).toContain('VILLAIN');

      // 3 profiles succeeds
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          profiles: [
            {
              id: 'VILLAIN-profile-1',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P1',
              explanation: 'E1',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V1', kind: 'APPARATUS' },
            },
            {
              id: 'VILLAIN-profile-2',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P2',
              explanation: 'E2',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V2', kind: 'FORCE' },
            },
            {
              id: 'VILLAIN-profile-3',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P3',
              explanation: 'E3',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V3', kind: 'ENTITY' },
            },
          ],
          villainProtagonist: false,
        }),
        finish_reason: 'stop',
      });
      const result3 = await runStage2(mockVillainResponses);
      expect(result3.failedBatteries).not.toContain('VILLAIN');
      expect((result3.compiledCandidates.villain as any).profiles).toHaveLength(3);

      // Direct call throws [VILLAIN COUNT] on 0
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({ profiles: [], villainProtagonist: false }),
        finish_reason: 'stop',
      });
      await expect(compileVillainBattery('VILLAIN', mockVillainResponses)).rejects.toThrow(
        '[VILLAIN COUNT] VILLAIN battery must produce 1-3 antagonist profiles (R10).'
      );

      // Direct call throws [VILLAIN COUNT] on 4
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          profiles: [
            { id: '1', sourceId: 'src-doc', classification: 'evidence', label: 'P1', explanation: 'E1', evidenceIds: [], target: 'antagonist_profile', proposedValue: { name: 'V1' } },
            { id: '2', sourceId: 'src-doc', classification: 'evidence', label: 'P2', explanation: 'E2', evidenceIds: [], target: 'antagonist_profile', proposedValue: { name: 'V2' } },
            { id: '3', sourceId: 'src-doc', classification: 'evidence', label: 'P3', explanation: 'E3', evidenceIds: [], target: 'antagonist_profile', proposedValue: { name: 'V3' } },
            { id: '4', sourceId: 'src-doc', classification: 'evidence', label: 'P4', explanation: 'E4', evidenceIds: [], target: 'antagonist_profile', proposedValue: { name: 'V4' } },
          ],
          villainProtagonist: false,
        }),
        finish_reason: 'stop',
      });
      await expect(compileVillainBattery('VILLAIN', mockVillainResponses)).rejects.toThrow(
        '[VILLAIN COUNT] VILLAIN battery must produce 1-3 antagonist profiles (R10).'
      );
    });

    it('VILLAIN flag gate: records VILLAIN in failedBatteries when villainProtagonist is not a boolean', async () => {
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          profiles: [
            {
              id: 'VILLAIN-profile-1',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P1',
              explanation: 'E1',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V1', kind: 'APPARATUS' },
            },
          ],
          villainProtagonist: 'yes',
        }),
        finish_reason: 'stop',
      });

      const result = await runStage2(mockVillainResponses);
      expect(result.failedBatteries).toContain('VILLAIN');

      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          profiles: [
            {
              id: 'VILLAIN-profile-1',
              sourceId: 'src-doc',
              classification: 'evidence',
              label: 'P1',
              explanation: 'E1',
              evidenceIds: [],
              target: 'antagonist_profile',
              proposedValue: { name: 'V1', kind: 'APPARATUS' },
            },
          ],
          villainProtagonist: 123,
        }),
        finish_reason: 'stop',
      });
      await expect(compileVillainBattery('VILLAIN', mockVillainResponses)).rejects.toThrow(
        '[VILLAIN FLAG] villainProtagonist must be a boolean.'
      );
    });

    it('RELATIONSHIPS: compiles value_anchor candidates into compiledCandidates.relationships.anchors', async () => {
      mockMeta.mockResolvedValueOnce({
        text: validRelationshipsJson,
        finish_reason: 'stop',
      });

      const result = await runStage2(mockRelationshipsResponses);
      expect(result.failedBatteries).not.toContain('RELATIONSHIPS');
      const relOutput = result.compiledCandidates.relationships as any;
      expect(relOutput).toBeDefined();
      expect(relOutput.anchors).toHaveLength(1);
      expect(relOutput.anchors[0].target).toBe('value_anchor');
      expect(relOutput.anchors[0].proposedValue.holder.kind).toBe('RELATIONSHIP');
    });

    it('OBJECTS stage1Only: dispatches 4 questions in Stage 1 and skips in Stage 2 without failing', async () => {
      mockMeta.mockResolvedValue({
        text: 'Physical weapon used.\nCITE: "found a heavy crowbar"',
        finish_reason: 'stop',
      });

      const stage1 = await runStage1('Source text', { families: ['OBJECTS'] });
      expect(stage1).toHaveLength(4);
      expect(mockMeta).toHaveBeenCalledTimes(4);

      // runStage2 skips OBJECTS
      const stage2 = await runStage2(stage1);
      expect(stage2.compiledCandidates).not.toHaveProperty('objects');
      expect(stage2.failedBatteries).not.toContain('OBJECTS');
    });

    it('OBJECTS direct compileBattery throws [UNSUPPORTED BATTERY]', async () => {
      await expect(compileBattery('OBJECTS', mockObjectsResponses, 'objects')).rejects.toThrow(
        '[UNSUPPORTED BATTERY] Compilation for OBJECTS not yet implemented.'
      );
    });

    it('PRESSURE: compiles rules array and elicitation object with elicit-don’t-invent unknowns', async () => {
      mockMeta
        .mockResolvedValueOnce({
          text: validPressureRulesJson,
          finish_reason: 'stop',
        })
        .mockResolvedValueOnce({
          text: validPressureElicitationJson,
          finish_reason: 'stop',
        });

      const result = await runStage2(mockPressureResponses);
      expect(result.failedBatteries).not.toContain('PRESSURE');
      const pressureOutput = result.compiledCandidates.pressure as any;
      expect(pressureOutput).toBeDefined();
      expect(pressureOutput.rules).toHaveLength(2);
      expect(pressureOutput.rules[0].target).toBe('premise');
      expect(pressureOutput.rules[1].target).toBe('environmental_rule');
      expect(pressureOutput.elicitation).toBeDefined();
      expect(pressureOutput.elicitation.deathMetaphysics).toBe('unknown');
      expect(Array.isArray(pressureOutput.elicitation.unknowns)).toBe(true);
      expect(pressureOutput.elicitation.unknowns).toHaveLength(2);
    });

    it('PRESSURE elicitation silence: validates successfully with unknown metaphysics and unknowns list', () => {
      const parsed = PressureElicitationSchema.parse({
        powerBudget: 'Local only',
        powerLimits: 'Cannot cross thresholds uninvited',
        deathMetaphysics: 'unknown',
        fearParameters: {
          releaseValves: ['Laughter'],
        },
        unknowns: ['True nature of the entity', 'Whether death is permanent'],
      });
      expect(parsed.deathMetaphysics).toBe('unknown');
      expect(parsed.unknowns).toHaveLength(2);
    });

    it('DEPICTION: compiles exactly one depiction_contract candidate', async () => {
      mockMeta.mockResolvedValueOnce({
        text: validDepictionJson,
        finish_reason: 'stop',
      });

      const result = await runStage2(mockDepictionResponses);
      expect(result.failedBatteries).not.toContain('DEPICTION');
      const depictionOutput = result.compiledCandidates.depiction as any;
      expect(depictionOutput).toBeDefined();
      expect(depictionOutput.contract.target).toBe('depiction_contract');
      expect(depictionOutput.contract.proposedValue.dramaticRegister).toBe('Bleak psychological dread');
    });

    it('DEPICTION gate: records DEPICTION in failedBatteries when contract is missing or multiple', async () => {
      // Missing contract key
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({ contracts: [] }),
        finish_reason: 'stop',
      });
      const resultMissing = await runStage2(mockDepictionResponses);
      expect(resultMissing.failedBatteries).toContain('DEPICTION');

      // Extra unknown keys (strict mode violation)
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({
          contract: JSON.parse(validDepictionJson).contract,
          extraKey: 'not allowed',
        }),
        finish_reason: 'stop',
      });
      const resultExtra = await runStage2(mockDepictionResponses);
      expect(resultExtra.failedBatteries).toContain('DEPICTION');
    });

    it('Citation gates: all new C2 batteries enforce citation requirement', async () => {
      const invalidVillain = [...mockVillainResponses];
      invalidVillain[0] = { ...invalidVillain[0], citations: [] };
      await expect(compileVillainBattery('VILLAIN', invalidVillain)).rejects.toThrow('[CITATION REQUIRED]');

      const invalidRel = [...mockRelationshipsResponses];
      invalidRel[0] = { ...invalidRel[0], citations: [] };
      await expect(compileRelationshipsBattery('RELATIONSHIPS', invalidRel)).rejects.toThrow('[CITATION REQUIRED]');

      const invalidPressure = [...mockPressureResponses];
      invalidPressure[0] = { ...invalidPressure[0], citations: [] };
      await expect(compilePressureBattery('PRESSURE', invalidPressure)).rejects.toThrow('[CITATION REQUIRED]');

      const invalidDepiction = [...mockDepictionResponses];
      invalidDepiction[0] = { ...invalidDepiction[0], citations: [] };
      await expect(compileDepictionBattery('DEPICTION', invalidDepiction)).rejects.toThrow('[CITATION REQUIRED]');
    });

    it('compileBattery accepts 2 arguments with optional _compileTarget', async () => {
      mockMeta.mockResolvedValueOnce({
        text: validDepictionJson,
        finish_reason: 'stop',
      });
      const res = await compileBattery('DEPICTION', mockDepictionResponses);
      expect(res).toHaveProperty('contract');
    });

    it('DEPICTION: direct compileDepictionBattery call rejects invalid or missing contract', async () => {
      mockMeta.mockResolvedValueOnce({
        text: JSON.stringify({ notAContract: 123 }),
        finish_reason: 'stop',
      });
      await expect(compileDepictionBattery('DEPICTION', mockDepictionResponses)).rejects.toThrow();
    });
  });
});

