import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CANONICAL_BLUEPRINT_IDS,
  ScenarioSandboxManager,
  scenarioSandboxManager,
} from './scenarioSandbox';
import { formatSomaticStatePrompt } from '../../src/lib/fearEngine';
import {
  formatVocalizationPromptDirective,
  type AuditoryContext,
} from '../../src/lib/vocalizationEngine';

import { MECHANICS_REFERENCE_MARKDOWN } from './mechanicsReference';
export { MECHANICS_REFERENCE_MARKDOWN };


export function createTtmMcpServer(
  sandboxManager: ScenarioSandboxManager = scenarioSandboxManager
): McpServer {
  const server = new McpServer(
    {
      name: 'the-terror-machine-harness',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // --------------------------------------------------------------------------
  // RESOURCE: Mechanics Reference Guide
  // --------------------------------------------------------------------------
  server.resource(
    'mechanics-reference',
    'ttm://mechanics-reference',
    {
      description: 'Comprehensive Horror Grammar (HG2/HG3) mechanics and invariants reference guide.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      return {
        contents: [
          {
            uri: uri.href,
            text: MECHANICS_REFERENCE_MARKDOWN,
            mimeType: 'text/markdown',
          },
        ],
      };
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 1 (Read-Only): list_blueprints
  // --------------------------------------------------------------------------
  server.tool(
    'list_blueprints',
    'List all available canon blueprints with metadata, cast size, and scenario premise.',
    {},
    async () => {
      const blueprints = CANONICAL_BLUEPRINT_IDS.map((id) => {
        const bp = sandboxManager.getRawBlueprint(id);
        return {
          blueprint_id: id,
          title: bp.identity?.title || bp.title || id,
          cast_size: bp.cast?.length || 0,
          premise: bp.globalPremise || bp.premise || '',
        };
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(blueprints, null, 2),
          },
        ],
      };
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 2 (Read-Only): get_state
  // --------------------------------------------------------------------------
  server.tool(
    'get_state',
    'Retrieve the full deterministic state snapshot for an active sandboxed scenario.',
    {
      scenario_id: z.string().describe('Unique ID of the active sandboxed scenario'),
    },
    async ({ scenario_id }) => {
      const scenario = sandboxManager.getScenario(scenario_id);
      if (!scenario) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Scenario "${scenario_id}" not found.` }),
            },
          ],
        };
      }

      const summary = sandboxManager.getStateSummary(scenario);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 3 (Read-Only): get_traces
  // --------------------------------------------------------------------------
  server.tool(
    'get_traces',
    'Retrieve diegetic acoustic and physical traces emitted since a given turn number.',
    {
      scenario_id: z.string().describe('Unique ID of the active sandboxed scenario'),
      since_turn: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Minimum turn number to filter traces (inclusive, defaults to 0)'),
    },
    async ({ scenario_id, since_turn = 0 }) => {
      const scenario = sandboxManager.getScenario(scenario_id);
      if (!scenario) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Scenario "${scenario_id}" not found.` }),
            },
          ],
        };
      }

      const filtered = scenario.historyTraces
        .filter((item) => item.turn >= since_turn)
        .map((item) => ({
          turn: item.turn,
          ...item.trace,
        }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(filtered, null, 2),
          },
        ],
      };
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 4 (Read-Only): build_turn_prompt
  // --------------------------------------------------------------------------
  server.tool(
    'build_turn_prompt',
    'Construct an authentic LLM turn prompt with somatic tokens, vocalization directives, and diegetic traces, guaranteeing zero HUD/numeric leakage.',
    {
      scenario_id: z.string().describe('Unique ID of the active sandboxed scenario'),
      pov_character: z
        .string()
        .optional()
        .describe('Character ID of the acting POV character (defaults to scenario protagonist)'),
    },
    async ({ scenario_id, pov_character }) => {
      const scenario = sandboxManager.getScenario(scenario_id);
      if (!scenario) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Scenario "${scenario_id}" not found.` }),
            },
          ],
        };
      }

      const povCharacterId =
        pov_character ||
        scenario.blueprint.userCharacterId ||
        scenario.cast.find((c) => c.isUserCharacter)?.id ||
        scenario.cast[0]?.id ||
        'unknown_pov';

      const povMember = scenario.cast.find((c) => c.id === povCharacterId);
      const currentNodeId = scenario.castPlacement[povCharacterId] || scenario.spatialGraph[0]?.id;
      const currentNode = scenario.spatialGraph.find((n) => n.id === currentNodeId);

      const deadCharIds = new Set(scenario.deathRecords.map((d) => d.characterId));
      const coPresent = scenario.cast.filter(
        (c) =>
          !deadCharIds.has(c.id) &&
          scenario.castPlacement[c.id] === currentNodeId &&
          c.id !== povCharacterId
      );

      const auditoryContext = {
        coPresentCharacters: coPresent.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          isPresent: true,
          isUserCharacter: Boolean(c.isUserCharacter),
          communicationModes: c.expressionProfile?.communicationModes ?? ['spoken'],
        })),
        context: {
          player: {
            characterId: povCharacterId,
            name: povMember?.name || povCharacterId,
            role: povMember?.role || 'Survivor',
            description: povMember?.description || '',
          },
          cast: scenario.cast,
          topology: {
            currentNodeId,
            readableNodeLabel: currentNode?.name || currentNode?.id || 'Unknown Enclosure',
          },
          consequenceState: {
            player_injuries: (scenario.deathLedger[povCharacterId] || []).map(
              (w) => w.mechanism
            ),
            psychological_status: 'STABLE',
          },
          runtime: {
            tension: 2,
            phase: scenario.macroPhase,
          },
        },
        userAction: 'OBSERVE',
        isSolitary: coPresent.length === 0,
        presentSpeakerNames: coPresent.map((c) => c.name),
        hasActiveRemoteChannel: false,
        remoteChannelMedium: null,
      } as unknown as AuditoryContext;

      const vocalizationDirective = formatVocalizationPromptDirective(auditoryContext);

      const somaticPrompt = formatSomaticStatePrompt(
        scenario.salienceLedger,
        scenario.cast,
        scenario.blueprint.fearContract || {}
      );

      const localTraces = scenario.historyTraces
        .filter((h) => h.trace.nodeId === currentNodeId || h.trace.channel === 'ACOUSTIC')
        .slice(-6);

      const promptSections = [
        `[SCENARIO CONTEXT]`,
        `Title: ${scenario.blueprint.identity?.title || scenario.blueprint.title || 'Unknown Enclosure'}`,
        `Premise: ${scenario.blueprint.globalPremise || scenario.blueprint.premise || ''}`,
        `Setting: ${scenario.blueprint.setting?.location || 'Unknown'} | ${scenario.blueprint.setting?.atmosphere || ''}`,
        ``,
        `[PLAYABLE PERSPECTIVE]`,
        `Character: ${povMember?.name || povCharacterId} (${povMember?.role || 'Survivor'})`,
        `Description: ${povMember?.description || 'Standard subject'}`,
        `Current Chamber: ${currentNode?.name || currentNode?.id || 'Unknown Chamber'}`,
        currentNode?.description ? `Sensory Details: ${currentNode.description}` : '',
        ``,
        `[DIEGETIC OBSERVED TRACES]`,
        localTraces.length > 0
          ? localTraces.map((t) => `- [${t.trace.channel}] ${t.trace.cueText}`).join('\n')
          : 'The immediate perimeter is still.',
      ];

      if (somaticPrompt && somaticPrompt.trim().length > 0) {
        promptSections.push(``, `[SOMATIC & PHYSIOLOGICAL DIRECTIVES]`, somaticPrompt);
      }

      if (vocalizationDirective && vocalizationDirective.trim().length > 0) {
        promptSections.push(vocalizationDirective);
      }

      return {
        content: [
          {
            type: 'text',
            text: promptSections.filter(Boolean).join('\n'),
          },
        ],
      };
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 5 (Mutating): start_scenario
  // --------------------------------------------------------------------------
  server.tool(
    'start_scenario',
    '[MUTATING] Instantiate a fresh in-memory scenario sandbox from a canon blueprint.',
    {
      blueprint_id: z
        .string()
        .describe("Canon blueprint identifier ('black_iron_mortuary', 'silver_rest_lodge', 'the_refinement')"),
    },
    async ({ blueprint_id }) => {
      try {
        const scenario = sandboxManager.createScenario(blueprint_id);
        const summary = sandboxManager.getStateSummary(scenario);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  scenario_id: scenario.scenarioId,
                  summary,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 6 (Mutating): inject_circumstance
  // --------------------------------------------------------------------------
  server.tool(
    'inject_circumstance',
    '[MUTATING] Inject and validate a circumstance patch (wounds, salience, positions, turn count) into a sandboxed scenario.',
    {
      scenario_id: z.string().describe('Unique ID of the active sandboxed scenario'),
      patch: z
        .object({
          turnCount: z.number().optional(),
          fictionalTime: z.number().optional(),
          macroPhase: z
            .enum([
              'EXPOSITION_BASELINE',
              'INCITING_RUPTURE',
              'COMPLICATION_ENCLOSURE',
              'MIDPOINT_CRISIS',
              'ESCALATING_VISE',
              'CLIMACTIC_CONFRONTATION',
              'AFTERMATH_DENOUEMENT',
            ])
            .optional(),
          castPlacement: z.record(z.string(), z.string()).optional(),
          salience: z
            .record(
              z.string(),
              z.object({
                spike: z.number().optional(),
                dread: z.number().optional(),
                preyMode: z.boolean().optional(),
                fearlessness: z.number().optional(),
                threatType: z.enum(['life', 'freedom', 'identity']).optional(),
              })
            )
            .optional(),
          wounds: z
            .array(
              z.object({
                characterId: z.string().min(1),
                mechanism: z.string().min(1),
                location: z.string().min(1),
                severity: z.string().min(1),
                timelineMinutes: z.number().nonnegative().optional(),
                treatability: z.string().optional(),
                valence: z.string().optional(),
                inflictedByCharacterId: z.string().optional(),
              })
            )
            .optional(),
          isTerminated: z.boolean().optional(),
        })
        .describe('Validated circumstance patch object'),
    },
    async ({ scenario_id, patch }) => {
      const result = sandboxManager.injectCircumstance(scenario_id, patch);
      if (!result.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: result.error }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.stateSummary, null, 2),
          },
        ],
      };
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 7 (Mutating): submit_narration
  // --------------------------------------------------------------------------
  server.tool(
    'submit_narration',
    '[MUTATING] Step the deterministic simulation clock by 1 turn and +60s fictional time, ingesting narration, wound proposals, and treatment proposals.',
    {
      scenario_id: z.string().describe('Unique ID of the active sandboxed scenario'),
      narration: z.string().describe('Diegetic narrative prose to step the turn'),
      options: z
        .object({
          wound_facts: z
            .array(
              z.object({
                characterId: z.string().min(1),
                mechanism: z.string().min(1),
                location: z.string().min(1),
                severity: z.enum(['minor', 'serious', 'grave', 'unsurvivable']),
                timelineMinutes: z.number().nonnegative().optional(),
                treatability: z.string().optional(),
                valence: z.enum(['murder', 'accident', 'sacrifice', 'execution']).optional(),
                inflictedByCharacterId: z.string().optional(),
              })
            )
            .optional(),
          treatment_proposals: z
            .array(
              z.object({
                characterId: z.string().min(1),
                woundId: z.string().min(1),
                mechanism: z.string().min(1),
              })
            )
            .optional(),
          pov_character: z.string().optional(),
        })
        .optional(),
    },
    async ({ scenario_id, narration, options }) => {
      const result = sandboxManager.submitNarration(scenario_id, narration, options);
      if (!result.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: result.error }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.turnResult, null, 2),
          },
        ],
      };
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 8 (Mutating): end_scenario
  // --------------------------------------------------------------------------
  server.tool(
    'end_scenario',
    '[MUTATING] Conclude and evict an active sandboxed scenario from memory.',
    {
      scenario_id: z.string().describe('Unique ID of the active sandboxed scenario to evict'),
    },
    async ({ scenario_id }) => {
      const deleted = sandboxManager.deleteScenario(scenario_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              scenario_id,
              deleted,
              message: deleted
                ? `Scenario "${scenario_id}" successfully terminated and cleared.`
                : `Scenario "${scenario_id}" was not found.`,
            }),
          },
        ],
      };
    }
  );

  return server;
}
