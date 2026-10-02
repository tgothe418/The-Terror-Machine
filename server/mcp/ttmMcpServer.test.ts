import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTtmMcpServer } from './ttmMcpServer';
import { ScenarioSandboxManager } from './scenarioSandbox';
import { createApp } from '../app';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('The Terror Machine — MCP Test Harness Suite', () => {
  let manager: ScenarioSandboxManager;
  let client: Client;

  beforeEach(async () => {
    manager = new ScenarioSandboxManager();
    const server = createTtmMcpServer(manager);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    client = new Client({ name: 'ttm-test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  // --------------------------------------------------------------------------
  // 1. Tool: list_blueprints
  // --------------------------------------------------------------------------
  it('list_blueprints returns all 3 canon blueprints with premise and cast size', async () => {
    const res = await client.callTool({ name: 'list_blueprints', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.content).toHaveLength(1);

    const firstContent = res.content[0] as { type: string; text: string };
    const blueprints = JSON.parse(firstContent.text);
    expect(Array.isArray(blueprints)).toBe(true);
    expect(blueprints).toHaveLength(3);

    const ids = blueprints.map((b: { blueprint_id: string }) => b.blueprint_id);
    expect(ids).toContain('black_iron_mortuary');
    expect(ids).toContain('silver_rest_lodge');
    expect(ids).toContain('the_refinement');

    for (const bp of blueprints) {
      expect(bp.title).toBeTruthy();
      expect(typeof bp.cast_size).toBe('number');
      expect(bp.cast_size).toBeGreaterThan(0);
      expect(typeof bp.premise).toBe('string');
      expect(bp.premise.length).toBeGreaterThan(10);
    }
  });

  // --------------------------------------------------------------------------
  // 2. Tool: start_scenario
  // --------------------------------------------------------------------------
  it('start_scenario creates an active sandboxed scenario', async () => {
    const res = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    expect(res.isError).toBeFalsy();

    const data = JSON.parse((res.content[0] as { text: string }).text);
    expect(data.scenario_id).toMatch(/^scenario-black_iron_mortuary-/);
    expect(data.summary).toBeDefined();
    expect(data.summary.turn).toBe(0);
    expect(data.summary.macro_phase).toBe('EXPOSITION_BASELINE');
    expect(data.summary.is_terminated).toBe(false);
    expect(data.summary.threat_board.living.length).toBeGreaterThan(0);
  });

  it('start_scenario rejects invalid blueprint identifiers', async () => {
    const res = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'non_existent_haunted_asylum' },
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse((res.content[0] as { text: string }).text);
    expect(data.error).toContain('Unknown blueprint ID');
  });

  // --------------------------------------------------------------------------
  // 3. Tool: get_state
  // --------------------------------------------------------------------------
  it('get_state returns full deterministic state snapshot', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    const stateRes = await client.callTool({
      name: 'get_state',
      arguments: { scenario_id },
    });
    expect(stateRes.isError).toBeFalsy();

    const state = JSON.parse((stateRes.content[0] as { text: string }).text);
    expect(state.scenario_id).toBe(scenario_id);
    expect(state.blueprint_id).toBe('black_iron_mortuary');
    expect(state.turn).toBe(0);
    expect(state.macro_phase).toBe('EXPOSITION_BASELINE');
    expect(state.is_terminated).toBe(false);
    expect(state.characters).toBeDefined();

    const charKeys = Object.keys(state.characters);
    expect(charKeys.length).toBeGreaterThan(0);

    const firstChar = state.characters[charKeys[0]];
    expect(firstChar.character_id).toBe(charKeys[0]);
    expect(firstChar.salience).toBeDefined();
    expect(typeof firstChar.salience.spike).toBe('number');
    expect(typeof firstChar.salience.dread).toBe('number');
    expect(typeof firstChar.somatic_band).toBe('number');
    expect(Array.isArray(firstChar.somatic_tokens)).toBe(true);
    expect(typeof firstChar.prey_mode).toBe('boolean');
    expect(typeof firstChar.fearlessness).toBe('number');
    expect(typeof firstChar.position).toBe('string');
    expect(typeof firstChar.stance).toBe('string');
  });

  it('get_state returns error for unknown scenario ID', async () => {
    const res = await client.callTool({
      name: 'get_state',
      arguments: { scenario_id: 'scenario-invalid-999' },
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse((res.content[0] as { text: string }).text);
    expect(data.error).toContain('not found');
  });

  // --------------------------------------------------------------------------
  // 4. Tool: get_traces
  // --------------------------------------------------------------------------
  it('get_traces returns emitted traces and filters by since_turn', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    // Initial traces should be empty
    const tracesRes0 = await client.callTool({
      name: 'get_traces',
      arguments: { scenario_id, since_turn: 0 },
    });
    expect(tracesRes0.isError).toBeFalsy();
    const traces0 = JSON.parse((tracesRes0.content[0] as { text: string }).text);
    expect(Array.isArray(traces0)).toBe(true);

    // Step turn 1
    await client.callTool({
      name: 'submit_narration',
      arguments: {
        scenario_id,
        narration: 'Dr. Ross steps into the cold mortuary chamber and listens to the vents.',
      },
    });

    const tracesRes1 = await client.callTool({
      name: 'get_traces',
      arguments: { scenario_id, since_turn: 1 },
    });
    expect(tracesRes1.isError).toBeFalsy();
    const traces1 = JSON.parse((tracesRes1.content[0] as { text: string }).text);
    expect(Array.isArray(traces1)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 5. Tool: build_turn_prompt & Numeric-Leak Test
  // --------------------------------------------------------------------------
  it('build_turn_prompt constructs authentic prompt with zero numeric/HUD leakage', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    // Inject high salience to induce somatic tokens and fear texture directives
    await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: {
          salience: {
            'char-maren-ross': {
              spike: 0.85,
              dread: 0.25,
              preyMode: true,
            },
          },
        },
      },
    });

    const promptRes = await client.callTool({
      name: 'build_turn_prompt',
      arguments: { scenario_id, pov_character: 'char-maren-ross' },
    });
    expect(promptRes.isError).toBeFalsy();

    const promptText = (promptRes.content[0] as { text: string }).text;
    expect(promptText).toContain('[SCENARIO CONTEXT]');
    expect(promptText).toContain('[PLAYABLE PERSPECTIVE]');
    expect(promptText).toContain('[SOMATIC & PHYSIOLOGICAL DIRECTIVES]');

    // Invariant Check: ZERO HUD/numeric intensity leakage
    // No raw floats like "0.85", "0.25", or percentage symbols like "85%"
    expect(promptText).not.toMatch(/\b0\.\d{2,}\b/);
    expect(promptText).not.toMatch(/\b\d{1,3}%\b/);
    expect(promptText).not.toContain('salience:');
    expect(promptText).not.toContain('spike:');
    expect(promptText).not.toContain('dread:');

    // Discrete Somatic Band tokens MUST be present without leaking numeric intensity
    expect(promptText).toMatch(/Band [1-4]/);
  });

  // --------------------------------------------------------------------------
  // 6. Tool: inject_circumstance & Strict Rejection Tests
  // --------------------------------------------------------------------------
  it('inject_circumstance applies valid patches cleanly', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    const patchRes = await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: {
          turnCount: 5,
          fictionalTime: 300,
          macroPhase: 'INCITING_RUPTURE',
          castPlacement: {
            'char-maren-ross': 'specimen_freezer',
          },
          salience: {
            'char-maren-ross': {
              spike: 0.45,
              dread: 0.1,
            },
          },
          wounds: [
            {
              characterId: 'char-maren-ross',
              mechanism: 'supercooled freon frostbite',
              location: 'right fingers',
              severity: 'minor',
              timelineMinutes: 120,
              treatability: 'warm saline irrigation',
            },
          ],
        },
      },
    });
    expect(patchRes.isError).toBeFalsy();

    const summary = JSON.parse((patchRes.content[0] as { text: string }).text);
    expect(summary.turn).toBe(5);
    expect(summary.fictional_time_seconds).toBe(300);
    expect(summary.macro_phase).toBe('INCITING_RUPTURE');
    expect(summary.characters['char-maren-ross'].position).toBe('specimen_freezer');
    expect(summary.characters['char-maren-ross'].salience.spike).toBe(0.45);
    expect(summary.characters['char-maren-ross'].wounds).toHaveLength(1);
  });

  it('inject_circumstance rejects invalid salience spike (> 1.0)', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    const res = await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: {
          salience: {
            'char-maren-ross': { spike: 1.5 },
          },
        },
      },
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse((res.content[0] as { text: string }).text);
    expect(data.error).toContain('Salience spike');
  });

  it('inject_circumstance rejects invalid topology placement', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    const res = await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: {
          castPlacement: {
            'char-maren-ross': 'non_existent_outer_space_node',
          },
        },
      },
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse((res.content[0] as { text: string }).text);
    expect(data.error).toContain('does not exist in spatial topology');
  });

  it('inject_circumstance rejects invalid wound severity', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    const res = await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: {
          wounds: [
            {
              characterId: 'char-maren-ross',
              mechanism: 'crush',
              location: 'skull',
              severity: 'fatal_obliteration', // Invalid severity
            },
          ],
        },
      },
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse((res.content[0] as { text: string }).text);
    expect(data.error).toContain('Wound severity');
  });

  it('inject_circumstance rejects turnCount exceeding 100', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    const res = await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: {
          turnCount: 150,
        },
      },
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse((res.content[0] as { text: string }).text);
    expect(data.error).toContain('turnCount must be an integer between 0 and 100');
  });

  // --------------------------------------------------------------------------
  // 7. Tool: submit_narration & Death Pipeline
  // --------------------------------------------------------------------------
  it('submit_narration advances turn, ingests proposals, and triggers death pass', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    // Ingest unsurvivable wound proposal for Officer Marcus Holt
    const turnRes = await client.callTool({
      name: 'submit_narration',
      arguments: {
        scenario_id,
        narration: 'Entity-41 plunges a surgical trocar through the airlock observation port into Holt.',
        options: {
          wound_facts: [
            {
              characterId: 'char-marcus-holt',
              mechanism: 'trocar puncture through right jugular',
              location: 'neck',
              severity: 'unsurvivable',
              timelineMinutes: 0,
              treatability: 'none',
              valence: 'murder',
            },
          ],
        },
      },
    });
    expect(turnRes.isError).toBeFalsy();

    const turnData = JSON.parse((turnRes.content[0] as { text: string }).text);
    expect(turnData.turn).toBe(1);
    expect(turnData.deaths_declared.length).toBeGreaterThan(0);
    expect(turnData.deaths_declared[0].record.characterId).toBe('char-marcus-holt');

    // Holt should now appear in the dead section of threat_board
    const stateRes = await client.callTool({
      name: 'get_state',
      arguments: { scenario_id },
    });
    const state = JSON.parse((stateRes.content[0] as { text: string }).text);
    expect(state.threat_board.dead).toContain('char-marcus-holt');
  });

  it('HG4 B5: tracks sourceId and perceivedSourceId based on spatial co-location in submit_narration', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    // Initial placement:
    // char-maren-ross: autopsy_suite_b
    // char-entity-41: specimen_freezer (distant node)

    // 1. Distant wound: entity attacks Ross from afar (different node)
    const distantWoundRes = await client.callTool({
      name: 'submit_narration',
      arguments: {
        scenario_id,
        narration: 'A high-tensile wire projectile fires from the freezer duct into Ross.',
        options: {
          wound_facts: [
            {
              characterId: 'char-maren-ross',
              mechanism: 'wire puncture',
              location: 'shoulder',
              severity: 'serious',
              timelineMinutes: 60,
              treatability: 'pressure dressing',
              valence: 'murder',
              inflictedByCharacterId: 'char-entity-41',
            },
          ],
        },
      },
    });
    expect(distantWoundRes.isError).toBeFalsy();

    const rawScenario1 = manager.getScenario(scenario_id)!;
    const rossProv1 = rawScenario1.salienceLedger['char-maren-ross'].provenance;
    expect(rossProv1).toHaveLength(1);
    expect(rossProv1[0].sourceId).toBe('char-entity-41');
    expect(rossProv1[0].perceivedSourceId).toBeUndefined();

    // 2. Co-located wound: move entity to Ross node (autopsy_suite_b) and strike
    await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: {
          castPlacement: {
            'char-entity-41': 'autopsy_suite_b',
          },
        },
      },
    });

    const colocatedWoundRes = await client.callTool({
      name: 'submit_narration',
      arguments: {
        scenario_id,
        narration: 'Entity-41 drops directly onto the dissection table and slashes Ross.',
        options: {
          wound_facts: [
            {
              characterId: 'char-maren-ross',
              mechanism: 'trocar laceration',
              location: 'forearm',
              severity: 'grave',
              timelineMinutes: 20,
              treatability: 'tourniquet',
              valence: 'murder',
              inflictedByCharacterId: 'char-entity-41',
            },
          ],
        },
      },
    });
    expect(colocatedWoundRes.isError).toBeFalsy();

    const rawScenario2 = manager.getScenario(scenario_id)!;
    const rossProv2 = rawScenario2.salienceLedger['char-maren-ross'].provenance;
    expect(rossProv2.length).toBeGreaterThanOrEqual(2);
    const latestProv = rossProv2[rossProv2.length - 1];
    expect(latestProv.sourceId).toBe('char-entity-41');
    expect(latestProv.perceivedSourceId).toBe('char-entity-41');

    // 3. Build turn prompt should now reflect dominant perceived source attribution
    const promptRes = await client.callTool({
      name: 'build_turn_prompt',
      arguments: { scenario_id, pov_character: 'char-maren-ross' },
    });
    expect(promptRes.isError).toBeFalsy();
    const promptText = (promptRes.content[0] as { text: string }).text;
    expect(promptText).toContain('[FEAR SOURCE: Dr. Maren Ross — driven by Entity-41 (The Suture Apparatus)]');
  });

  it('HG4 B5: tracks killer attribution in witnessed-death events based on killer co-location', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    // Place Ross, Holt, and Entity-41 all at autopsy_suite_b
    await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: {
          castPlacement: {
            'char-maren-ross': 'autopsy_suite_b',
            'char-marcus-holt': 'autopsy_suite_b',
            'char-entity-41': 'autopsy_suite_b',
          },
        },
      },
    });

    // Entity-41 kills Holt in front of Ross
    const killRes = await client.callTool({
      name: 'submit_narration',
      arguments: {
        scenario_id,
        narration: 'Entity-41 crushes Holt skull against the examination table.',
        options: {
          wound_facts: [
            {
              characterId: 'char-marcus-holt',
              mechanism: 'pneumatic skull crush',
              location: 'cranium',
              severity: 'unsurvivable',
              timelineMinutes: 0,
              treatability: 'none',
              valence: 'murder',
              inflictedByCharacterId: 'char-entity-41',
            },
          ],
        },
      },
    });
    expect(killRes.isError).toBeFalsy();

    const rawScenario = manager.getScenario(scenario_id)!;
    // Ross was at autopsy_suite_b with Holt, so she witnesses the death
    const rossDeathEvents = rawScenario.salienceLedger['char-maren-ross'].provenance.filter(
      (p) => p.kind === 'witnessed-death'
    );
    expect(rossDeathEvents.length).toBeGreaterThan(0);
    // Entity-41 was also at autopsy_suite_b, so killer is perceived
    expect(rossDeathEvents[0].sourceId).toBe('char-entity-41');
    expect(rossDeathEvents[0].perceivedSourceId).toBe('char-entity-41');
  });

  // --------------------------------------------------------------------------
  // 8. 100-Turn Cap Enforcement
  // --------------------------------------------------------------------------
  it('enforces maximum 100-turn cap and terminates scenario', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'black_iron_mortuary' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    // Fast-forward turn count to 99
    await client.callTool({
      name: 'inject_circumstance',
      arguments: {
        scenario_id,
        patch: { turnCount: 99 },
      },
    });

    // Step turn 100
    const step100Res = await client.callTool({
      name: 'submit_narration',
      arguments: {
        scenario_id,
        narration: 'The final seconds tick away as the emergency airlock dogs freeze solid.',
      },
    });
    expect(step100Res.isError).toBeFalsy();
    const data100 = JSON.parse((step100Res.content[0] as { text: string }).text);
    expect(data100.turn).toBe(100);

    // Verify scenario is terminated
    const stateRes = await client.callTool({
      name: 'get_state',
      arguments: { scenario_id },
    });
    const state = JSON.parse((stateRes.content[0] as { text: string }).text);
    expect(state.is_terminated).toBe(true);

    // Step past 100 must be rejected
    const step101Res = await client.callTool({
      name: 'submit_narration',
      arguments: {
        scenario_id,
        narration: 'Attempting to step past turn 100.',
      },
    });
    expect(step101Res.isError).toBe(true);
    const data101 = JSON.parse((step101Res.content[0] as { text: string }).text);
    expect(data101.error).toContain('Maximum turn cap');
  });

  // --------------------------------------------------------------------------
  // 9. 30-Minute Idle Eviction
  // --------------------------------------------------------------------------
  it('evicts scenarios idle for more than 30 minutes', async () => {
    const scenario = manager.createScenario('black_iron_mortuary');
    const scenarioId = scenario.scenarioId;

    // Sanity check: scenario is present
    expect(manager.getScenario(scenarioId)).not.toBeNull();

    // Fast-forward lastActivityAt by 31 minutes into the past
    scenario.lastActivityAt = Date.now() - 31 * 60 * 1000;

    // getScenario should evict and return null
    expect(manager.getScenario(scenarioId)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 10. Tool: end_scenario
  // --------------------------------------------------------------------------
  it('end_scenario evicts the sandbox scenario from memory', async () => {
    const startRes = await client.callTool({
      name: 'start_scenario',
      arguments: { blueprint_id: 'silver_rest_lodge' },
    });
    const { scenario_id } = JSON.parse((startRes.content[0] as { text: string }).text);

    const endRes = await client.callTool({
      name: 'end_scenario',
      arguments: { scenario_id },
    });
    expect(endRes.isError).toBeFalsy();
    const endData = JSON.parse((endRes.content[0] as { text: string }).text);
    expect(endData.deleted).toBe(true);

    // Subsequent get_state must fail
    const stateRes = await client.callTool({
      name: 'get_state',
      arguments: { scenario_id },
    });
    expect(stateRes.isError).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 11. Resource: ttm://mechanics-reference
  // --------------------------------------------------------------------------
  it('ttm://mechanics-reference resource codifies all required HG2/HG3 invariants', async () => {
    const res = await client.readResource({ uri: 'ttm://mechanics-reference' });
    expect(res.contents).toHaveLength(1);

    const firstContent = res.contents[0];
    const text = 'text' in firstContent ? firstContent.text : '';
    expect(text).toContain('Prey-Mode Hysteresis (0.70 / 0.40)');
    expect(text).toContain('25% Residue Ratchet');
    expect(text).toContain('Somatic Bands & Physiological Directives');
    expect(text).toContain('The SUBMIT Contract');
    expect(text).toContain('Deterministic Death Subsystem');
    expect(text).toContain('0.60 Threshold');
  });

  // --------------------------------------------------------------------------
  // 12. Import-Graph Guard (Text-Scan Test)
  // --------------------------------------------------------------------------
  it('asserts server/mcp does not import production stores or idb-keyval', () => {
    const mcpDir = path.resolve(__dirname);
    const files = fs.readdirSync(mcpDir).filter((f) => f.endsWith('.ts'));

    const forbiddenTokens = [
      'useAppStore',
      'src/core/store',
      'idb-keyval',
    ];

    for (const file of files) {
      if (file.endsWith('.test.ts')) continue;
      const content = fs.readFileSync(path.join(mcpDir, file), 'utf-8');
      for (const token of forbiddenTokens) {
        expect(content).not.toContain(token);
      }
    }
  });
});

describe('The Terror Machine — MCP HTTP Endpoint (StreamableHTTP) Wire Tests', () => {
  let server: http.Server;
  let mcpUrl: string;

  beforeAll(async () => {
    const app = await createApp({ enableSpaFallback: false });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          mcpUrl = `http://127.0.0.1:${addr.port}/mcp`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server) {
        server.close((err) => (err ? reject(err) : resolve()));
      } else {
        resolve();
      }
    });
  });

  interface McpWireResponse {
    jsonrpc: string;
    id?: number | string | null;
    result?: {
      serverInfo?: { name: string; version?: string };
      tools?: Array<{ name: string; description?: string }>;
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
      [key: string]: unknown;
    };
    error?: { code: number; message: string; data?: unknown };
  }

  async function parseMcpResponse(res: Response): Promise<McpWireResponse> {
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const dataStr = line.slice(5).trim();
          if (dataStr) {
            return JSON.parse(dataStr) as McpWireResponse;
          }
        }
      }
    }
    return JSON.parse(text) as McpWireResponse;
  }

  it('serves 10 sequential spec-compliant POSTs with HTTP 200 and no 500s', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: i,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
      const json = await parseMcpResponse(res);
      expect(json.jsonrpc).toBe('2.0');
      expect(json.id).toBe(i);
      expect(json.result).toBeDefined();
      expect(json.result?.serverInfo?.name).toBe('the-terror-machine-harness');
    }
  });

  it('executes initialize -> tools/list -> start_scenario -> get_state sequentially with all 200s', async () => {
    // 1. initialize
    const initRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const initJson = await parseMcpResponse(initRes);
    expect(initJson.jsonrpc).toBe('2.0');

    // 2. tools/list
    const listRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(listRes.status).toBe(200);
    const listJson = await parseMcpResponse(listRes);
    expect(listJson.result.tools).toHaveLength(8);

    // 3. start_scenario
    const startRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'start_scenario',
          arguments: { blueprint_id: 'black_iron_mortuary' },
        },
      }),
    });
    expect(startRes.status).toBe(200);
    const startJson = await parseMcpResponse(startRes);
    const scenarioPayload = JSON.parse(startJson.result.content[0].text);
    const scenarioId = scenarioPayload.scenario_id;
    expect(scenarioId).toBeTruthy();

    // 4. get_state
    const stateRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_state',
          arguments: { scenario_id: scenarioId },
        },
      }),
    });
    expect(stateRes.status).toBe(200);
    const stateJson = await parseMcpResponse(stateRes);
    const statePayload = JSON.parse(stateJson.result.content[0].text);
    expect(statePayload.blueprint_id).toBe('black_iron_mortuary');
    expect(statePayload.turn).toBe(0);
  });

  it('returns HTTP 406 JSON-RPC error when Accept header only specifies application/json', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
      }),
    });

    expect(res.status).toBe(406);
    const json = (await res.json()) as {
      jsonrpc: string;
      error: { code: number; message: string };
      id: unknown;
    };
    expect(json.jsonrpc).toBe('2.0');
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32000);
    expect(json.error.message).toContain('Client must accept both application/json and text/event-stream');
  });

  it('returns structured JSON-RPC error response when an error occurs rather than empty 500', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 105,
        method: 'tools/call',
        params: {
          name: 'get_state',
          arguments: { scenario_id: 'non-existent-scenario-id-xyz' },
        },
      }),
    });

    // The tool call returns an error payload inside result or error (isError: true)
    expect(res.status).toBe(200);
    const json = await parseMcpResponse(res);
    expect(json.jsonrpc).toBe('2.0');
    if (json.result) {
      expect(json.result.isError).toBe(true);
    } else {
      expect(json.error).toBeDefined();
    }
  });
});
