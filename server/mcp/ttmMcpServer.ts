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

export const MECHANICS_REFERENCE_MARKDOWN = `# The Terror Machine — Horror Grammar (HG2/HG3) Invariants Reference

This document codifies the deterministic mechanics, psychological invariants, and causal containment contracts governing The Terror Machine.

---

## 1. Core Philosophy: Machine Decides Shape, Model Decides Texture
- **Shape (Authoritative Mechanics):** Discrete wounds, survivability verdicts, spatial topology, somatic bands, cognitive dissonance, and causal consequences are strictly computed by the deterministic Machine. The LLM cannot mutate state or dictate outcomes directly.
- **Texture (Diegetic Narration):** The LLM receives structural constraints and somatic tokens, rendering sensory prose and atmospheric fidelity without leaking internal ledger counters, HUD numbers, or probabilities.
- **Strict Determinism:** Zero PRNG, zero seeded dice rolls, zero random timestamps. Identical state transitions yield identical mechanical results.

---

## 2. Fear Engine & Somatic Invariants
### 2.1 Two-Layer Salience: Fast Phasic Spike & Slow Ratcheting Dread
- **Fast Spike Layer:** Captures acute shock, sudden jumpscares, or localized trauma. Bounded in [0.0, 1.0].
- **25% Residue Ratchet:** When the phasic spike decays, exactly **25%** of the decayed magnitude converts permanently into the tonic dread layer.
- **Tonic Dread Layer:** Monotonically ratchets throughout the ordeal, representing irreversible psychological attrition and lingering dread. Bounded in [0.0, 1.0].

### 2.2 Reversible Prey-Mode Hysteresis (0.70 / 0.40)
- **Engagement Threshold:** When a character's combined fear-response intensity reaches or exceeds **0.70**, the character enters \`PREY_MODE\`. Under prey mode, the behavioral verb consideration set collapses to reflexive survival options (\`FLEE\`, \`HIDE\`, \`FORTIFY\`, \`SUBMIT\`).
- **Disengagement Floor:** Prey mode exhibits strict hysteresis. It does **not** disengage when intensity falls below 0.70. It requires intensity to drop below **0.40** before proactive, deliberative verbs can re-enter the executable consideration set.

### 2.3 Somatic Bands & Physiological Directives
Fear-response intensity maps deterministically to 5 closed Somatic Bands:
- **Band 0 (Baseline, < 0.25):** Equilibrium. No somatic tokens injected.
- **Band 1 (Heightened Arousal, 0.25 - 0.50):** Mild autonomic arousal: \`TACHYCARDIA\`, \`PUPIL_DILATION\`, \`RAPID_BREATHING\`.
- **Band 2 (Acute Stress, 0.50 - 0.75):** Sympathetic surge: \`HAND_TREMOR\`, \`COLD_SWEAT\`, \`PERIPHERAL_VASOCONSTRICTION\`.
- **Band 3 (Terror / Tunnel Vision, 0.75 - 0.90):** Extreme shock: \`TUNNEL_VISION\`, \`AUDITORY_EXCLUSION\`, \`PILOMOTOR_ERECTION\`, \`DISSOCIATION\`. External world cues are degraded; acoustic scream traces are emitted.
- **Band 4 (Catatonic / Agonal Shock, >= 0.90):** Systemic shutdown: \`CATATONIA\`, \`HYPERVENTILATION\`, \`LOSS_OF_MOTOR_CONTROL\`, \`VOCAL_PARALYSIS\`.

### 2.4 Prose Fear Texture Directives (0.60 Threshold)
- **SPIKE Dominance (Spike Share >= 0.60):** Prose emphasizes sharp, visceral, localized trauma; sudden sensory interrupts; involuntary micro-movements.
- **DREAD Dominance (Spike Share <= 0.40):** Prose emphasizes heavy, atmospheric weight; time slows; fixation on mundane, threatening details.
- **BLENDED (0.40 < Spike Share < 0.60):** Dual textural directives combined without leaking numerical ratios.

---

## 3. The SUBMIT Contract (§5.4)
- **Two-Step Temporal Cadence:**
  - **Turn N (Initiation):** An overwhelmed character initiates \`SUBMIT\`. Stance immediately locks to \`SUBMITTED\`, and acoustic/social pleas are emitted.
  - **Turn N+1 (Evaluation):** The antagonist evaluates the plea against the authored submission response contract:
    - **Spatial Perception Check:** The antagonist must share the same node or an unobstructed adjacent node with open acoustic linkage. If unperceived, the stance persists without crash (\`UNPERCEIVED\`).
    - **Sovereignty Rule:** If the antagonist is a human player, an explicit choice prompt payload is presented (\`AWAITING_HUMAN_CHOICE\`).
    - **Autonomous Policy:** Autonomous NPC villains resolve deterministically to authored outcomes: \`ACCEPT\`, \`REJECT\`, \`PUNISH\`, or \`IGNORE\` (default: \`REJECT\`).

---

## 4. Deterministic Death Subsystem (§5, §15)
- **Single Choke Point:** Every death in The Terror Machine must pass through \`declareDeath()\`. Zero spontaneous or LLM-invented deaths.
- **Wound Severities:** Bounded to 4 closed ordinals: \`minor\`, \`serious\`, \`grave\`, \`unsurvivable\`.
- **Wound Fact Ledger:** Deterministic identifiers \`characterId:wSeq\`, recording mechanism, location, severity, deadline timeline, and treatability.
- **Survivability Evaluation:** Evaluated against fictional time elapsed, co-located first aid interventions, and available signal/witness circumstance facts.
- **Post-Mortem Transitions:**
  - Emits Corpse Evidence Node into spatial graph.
  - Triggers succession vulnerability window if the decedent held the cohort seat.
  - Injects cohort disruption shock (+0.3 skepticism, +0.5 cognitive dissonance).
  - Triggers witness trauma in living co-present cast members.
`;

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
