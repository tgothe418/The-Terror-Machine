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
  EXTRACTION_BATTERIES,
} from './extractionBatteries';
import {
  compileBattery,
  compileSeedBattery,
  buildStage2Prompt,
  buildStage2SeedPrompt,
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

  describe('TASK 3 — Battery definitions', () => {
    it('defines TOPOLOGY_BATTERY with 4 questions and target topology', () => {
      expect(TOPOLOGY_BATTERY.family).toBe('TOPOLOGY');
      expect(TOPOLOGY_BATTERY.questions).toHaveLength(4);
      expect(TOPOLOGY_BATTERY.compileTarget).toBe('topology');
    });

    it('defines SEED_BATTERY with 7 questions and target seed', () => {
      expect(SEED_BATTERY.family).toBe('SEED');
      expect(SEED_BATTERY.questions).toHaveLength(7);
      expect(SEED_BATTERY.compileTarget).toBe('seed');
    });

    it('registers both batteries in EXTRACTION_BATTERIES', () => {
      expect(EXTRACTION_BATTERIES).toEqual([TOPOLOGY_BATTERY, SEED_BATTERY]);
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
      expect(responses).toHaveLength(11); // 4 topology + 7 seed
      expect(mockMeta).toHaveBeenCalledTimes(11);

      // Verify no responseMimeType was passed
      for (const call of mockMeta.mock.calls) {
        expect(call[1]?.responseMimeType).toBeUndefined();
      }

      // Verify battery ordering: first 4 TOPOLOGY, then 7 SEED
      expect(responses.slice(0, 4).every((r) => r.family === 'TOPOLOGY')).toBe(true);
      expect(responses.slice(4).every((r) => r.family === 'SEED')).toBe(true);
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

    it('scopes dispatch when families filter is provided (SEED 7 questions)', async () => {
      mockMeta.mockResolvedValue({
        text: 'Character state.\nCITE: "character was waiting"',
        finish_reason: 'stop',
      });

      const responses = await runStage1('Source text', { families: ['SEED'] });
      expect(responses).toHaveLength(7);
      expect(mockMeta).toHaveBeenCalledTimes(7);
      expect(responses.every((r) => r.family === 'SEED')).toBe(true);
      for (let i = 0; i < 7; i++) {
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
    const validSeedJson = JSON.stringify({
      seeds: [
        {
          id: 'SEED-seed-1',
          sourceId: 'src-doc',
          classification: 'evidence',
          label: 'Alice opening state',
          explanation: 'Alice is trapped in the cellar',
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
                routineStep: 'Freezing in place',
              },
              condition: {
                restraint: {
                  level: 'TIED_TO_FIXTURE',
                  boundByCharacterId: 'The Warden',
                  tiedToNodeId: 'Pillar',
                },
              },
              charge: {
                band: 'Acute Fear',
                threatType: 'life',
              },
              knows: [
                {
                  id: 'SEED-knows-1',
                  text: 'The monster stalked down the hallway.',
                },
              ],
              wants: {
                kind: 'pursuit',
                text: 'Cut the ropes before it enters',
                groundedIn: ['SEED-knows-1'],
              },
              bonds: [
                {
                  characterId: 'Bob',
                  stance: 'trust',
                  note: 'Childhood friend',
                },
              ],
            },
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

    it('compiles valid seed Q&A into candidate structures with application/json mimeType', async () => {
      mockMeta.mockResolvedValueOnce({
        text: validSeedJson,
        finish_reason: 'stop',
      });

      const result = await compileBattery('SEED', mockSeedResponses, 'seed');
      expect(result).toHaveProperty('seeds');
      expect((result as any).seeds).toHaveLength(1);
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
      mockMeta.mockResolvedValueOnce({
        text: validSeedJson,
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

      mockMeta.mockResolvedValueOnce({
        text: giantJson,
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
    });
  });
});
