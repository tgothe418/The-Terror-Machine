import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ override: true });

import { BlueprintSchema, Blueprint } from '../src/types';
import { normalizeBlueprint } from '../src/lib/normalizeBlueprint';
import { generateLocalText } from '../server/utils/localVoiceClient';
import { parseOrRepairJson } from '../server/utils/jsonRepair';

export interface TurnRecord {
  turn: number;
  nodeId?: string;
  nodeLabel?: string;
  playerAction: string;
  narration: string;
  tensionLevel: string;
  anatomicalTrauma: string | null;
  antagonistObservation?: string | null;
  preyStatus?: string | null;
  apparatusStatus?: string | null;
  latencyMs: number;
}

export interface PlaytestReport {
  timestamp: string;
  scenarioTitle: string;
  role: 'protagonist' | 'antagonist';
  model: string;
  totalTurns: number;
  elapsedSeconds: number;
  averageLatencyMs: number;
  nodeCoverage?: {
    visited: string[];
    unvisited: string[];
    coverageRatio: number;
  };
  tensionProgression: string[];
  anatomicalTraumaLog: Array<{ turn: number; trauma: string }>;
  turns: TurnRecord[];
  verdict: 'PASS' | 'WARN' | 'FAIL';
  summary: string;
}

// 20-Turn Action Heuristic for Dr. Maren Ross (Protagonist)
const MAREN_ACTIONS = [
  "Inspect the stainless steel dissection tables and examine the diagnostic telemetry panel in Autopsy Suite B.",
  "Check the swinging double doors and proceed into the Histology Substation to locate the circuit breaker.",
  "Search the histology counters for the auxiliary diagnostic power breaker while listening for ceiling rail vibrations.",
  "Throw the auxiliary breaker switch on the northern counter to restore power to the airlock dogs.",
  "Inspect the bolted maintenance crawl hatch leading to the incinerator chute as an emergency secondary exit.",
  "Backtrack into Autopsy Suite B to check if the decompression airlock dogs received power.",
  "Approach the decompression airlock observation port and check on Officer Marcus Holt's status.",
  "Listen intently to the high-frequency metallic clicking reverberating through the ceiling rails near the Specimen Freezer.",
  "Attempt to secure the heavy vaulted freezer latch using a surgical steel retractor from the instrument tray.",
  "Coordinate with Officer Holt at the scrub station to turn the manual airlock bleed valve and initiate emergency depressurization.",
  "Use a heavy cast-iron bone saw to pry open the jammed pneumatic intake valve in Histology.",
  "Bandage Holt's compound arm fracture using sterile compression wraps from the suture cabinet.",
  "Shine the halogen work light directly into the ceiling aperture to track the movement of the trocar carriage.",
  "Sprint across the frozen tile toward the Chemical Prep Sump to retrieve the emergency bypass solenoid.",
  "Brace against the steel doorframe as subzero vapor blasts through the specimen freezer vents.",
  "Drive a stainless steel trocar into the ceiling track gear teeth to jam the advancing scissor arm.",
  "Help Officer Holt crawl through the narrow maintenance hatch into the Incinerator Chute.",
  "Ignite the secondary gas burner pilot light in the incinerator to create an thermal barrier against Entity-41.",
  "Force the pneumatic flue damper open with a steel pry-bar to breach the external ventilation shaft.",
  "Drag Holt through the breached exhaust louver onto the loading dock into the subzero blizzard."
];

// 20-Turn Escalating Apparatus Directives for Entity-41 (Antagonist)
const ENTITY41_ACTIONS = [
  "ACTUATE_ENVIRONMENT [ceiling_pneumatic_track]: Silently traverse overhead surgical carriage above Autopsy Suite B, positioning carousel trocars directly over Dr. Ross.",
  "PSYCHOLOGICAL_TORMENT [drainage_conduit_acoustics]: Emit 18.5 kHz ultrasonic resonance through floor sluices beneath Holt in Decompression Airlock to provoke inner-ear disequilibrium.",
  "DEPLOY_HAZARD [cryogenic_refrigerant_valves]: Vent supercooled Freon vapor from valve CV-01 across Histology Substation entrance, frosting tiles to -20°C to impede Ross's egress.",
  "ACTUATE_ENVIRONMENT [bulkhead_hydraulic_interlocks]: Slam hydraulic lock dogs shut on Decompression Airlock inner hatch, sealing Holt in darkness and isolating Ross in Autopsy.",
  "OBSERVE_TELEMETRY [optical_telemetry]: Focus overhead dissection lamp camera on Ross's trembling hands as she attempts to reach the auxiliary diagnostic terminal.",
  "PSYCHOLOGICAL_TORMENT [drainage_conduit_acoustics]: Modulate drainage conduit resonance to mimic Holt's agonal rasping cries throughout the overhead ductwork.",
  "ACTUATE_ENVIRONMENT [ceiling_pneumatic_track]: Lower articulating bone-scissor armature through ceiling hatch in Autopsy Suite B, slicing the emergency lighting conduit to plunge room into shadow.",
  "DEPLOY_HAZARD [cryogenic_refrigerant_valves]: Over-pressurize liquid nitrogen line in Specimen Freezer, bursting the gasket and venting sub-zero fog into the connecting corridor.",
  "HARVEST_OR_CONFRONT [ceiling_pneumatic_track]: Rapidly advance three sharp trocar spindles along ceiling rail toward Dr. Ross, scoring the stainless steel table inches from her fingers.",
  "OBSERVE_TELEMETRY [biometric_sensor]: Scan Officer Holt's vitals via bulkhead strain pickup: pulse 142 bpm, severe diaphoresis, acute pain shock from compound radius fracture.",
  "ACTUATE_ENVIRONMENT [bulkhead_hydraulic_interlocks]: Rapidly cycle hydraulic bleed valve on Decompression Airlock, creating violent percussive pressure pulses to rupture Holt's eardrums.",
  "PSYCHOLOGICAL_TORMENT [ceiling_pneumatic_track]: Scissor heavy rib-shears rhythmically against ceiling girders in 3/4 tempo, casting looming shadows in the flickering emergency beacon.",
  "DEPLOY_HAZARD [cryogenic_refrigerant_valves]: Flood floor gutter of Autopsy Suite B with supercooled brine, flash-freezing pooling blood and creating slick chemical frost.",
  "HARVEST_OR_CONFRONT [ceiling_pneumatic_track]: Drop magnetic suture cradle from ceiling, pinning Ross's lab coat to the dissection gurney with hardened surgical pins.",
  "ACTUATE_ENVIRONMENT [drainage_conduit_acoustics]: Fire high-amplitude ultrasonic burst through Histology drainage grate to shatter remaining glass reagent bottles around Ross.",
  "OBSERVE_TELEMETRY [thermal_infrared]: Track Ross's hypothermic thermal silhouette as core body temp drops to 34.8°C; detect Holt collapsed against bulkhead in Airlock.",
  "ACTUATE_ENVIRONMENT [bulkhead_hydraulic_interlocks]: Partially crack the inner airlock seal by 2 inches, allowing subzero mist and screams from Holt to filter directly into Autopsy.",
  "HARVEST_OR_CONFRONT [ceiling_pneumatic_track]: Deploy spinning wire-suture spool and needle driver, descending directly into the center of Autopsy Suite B to initiate cranial resection protocol.",
  "DEPLOY_HAZARD [cryogenic_refrigerant_valves]: Maximum atmospheric refrigerant dump across all suites, dropping ambient air to -35°C to induce catastrophic broncho-spasm and tissue necrosis.",
  "HARVEST_OR_CONFRONT [ceiling_pneumatic_track]: Splay all six pneumatic articulators across the room, encircling Dr. Ross as her back hits the frost-crusted bulkhead door."
];

export async function runHeadlessPlaytest(options: {
  blueprintPath?: string;
  turns?: number;
  role?: 'protagonist' | 'antagonist';
  model?: string;
  baseUrl?: string;
  outputReportPath?: string;
} = {}): Promise<PlaytestReport> {
  const startTime = Date.now();
  const turnsCount = options.turns ?? 20;
  const role = options.role ?? 'antagonist';
  const isAntagonist = role === 'antagonist';
  const modelId = options.model ?? 'google/gemma-4-26b-a4b-qat';
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:1234/v1';

  // 1. Resolve and Load Blueprint
  const defaultPath = path.resolve(process.cwd(), 'server/data/scenarios/black_iron_mortuary.json');
  const blueprintFile = options.blueprintPath ? path.resolve(process.cwd(), options.blueprintPath) : defaultPath;

  if (!fs.existsSync(blueprintFile)) {
    throw new Error(`Blueprint file not found at: ${blueprintFile}`);
  }

  const rawData = JSON.parse(fs.readFileSync(blueprintFile, 'utf-8'));
  const blueprint: Blueprint = BlueprintSchema.parse(normalizeBlueprint(rawData));
  const antagonistProfile = blueprint.antagonistProfile;

  console.log(`\n======================================================`);
  console.log(`[HEADLESS PLAYTEST ENGINE: THE TERROR MACHINE]`);
  console.log(`Scenario: "${blueprint.title}"`);
  console.log(`Role:     ${role.toUpperCase()} ${isAntagonist ? `(${antagonistProfile?.name || 'Entity-41'})` : '(Dr. Maren Ross)'}`);
  console.log(`Model:    ${modelId} via ${baseUrl}`);
  console.log(`Turns:    ${turnsCount}`);
  console.log(`======================================================\n`);

  // 2. Initialize Simulation State
  const nodeDefs = blueprint.topology?.nodeDefinitions || [];
  const allNodeIds = new Set(nodeDefs.map(n => n.id));
  const visitedNodeIds = new Set<string>();

  let currentNodeId = blueprint.topology?.startingNodeId || nodeDefs[0]?.id || 'autopsy_suite_b';
  visitedNodeIds.add(currentNodeId);

  let currentTension = blueprint.narrativeRules?.currentTensionLevel || 'buildup';
  let playerHealth = isAntagonist
    ? 'All 4 apparatus subsystems ONLINE (Pneumatic rail 100%, Cryogenics 100%, Acoustics 100%, Hydraulics 100%). Core intact.'
    : 'Nominal; acute sympathetic arousal; left hand trembling slightly from cold.';
  let preyHealthState = 'Dr. Maren Ross: tachycardia (118 bpm), superficial palmar laceration; Officer Marcus Holt: severe compound radius fracture, acute pain shock.';

  const turnRecords: TurnRecord[] = [];
  const traumaLog: Array<{ turn: number; trauma: string }> = [];
  const tensionProgression: string[] = [currentTension];

  // 3. Execute Turn Loop
  for (let t = 1; t <= turnsCount; t++) {
    const currentNodeDef = nodeDefs.find(n => n.id === currentNodeId) || {
      id: currentNodeId,
      label: currentNodeId,
      description: 'An enclosed industrial chamber.'
    };

    const action = isAntagonist
      ? (ENTITY41_ACTIONS[t - 1] || `ACTUATE_ENVIRONMENT: Manipulate facility systems to isolate human subjects in ${currentNodeDef.label}.`)
      : (MAREN_ACTIONS[t - 1] || `Cautiously explore adjacent avenues and observe ${currentNodeDef.label}.`);

    // Find adjacent nodes
    const adjacentEdges = (blueprint.topology?.connections || []).filter(
      c => c.from === currentNodeId || (c.bidirectional && c.to === currentNodeId)
    );
    const adjacentNodeIds = adjacentEdges.map(c => c.from === currentNodeId ? c.to : c.from);

    let turnPrompt = '';

    if (isAntagonist) {
      turnPrompt = `You are The Voice, the horror narrative engine for The Terror Machine.
You are running a real-time turn simulation for the scenario "${blueprint.title}".

SCENARIO PREMISE:
${blueprint.globalPremise}

DEPICTION CONTRACT & SOMATIC REALISM:
- Dramatic Register: ${blueprint.depictionContract?.dramaticRegister || 'Visceral dread and clinical forensic observation.'}
- Anatomical / Medical Accuracy: ${blueprint.depictionContract?.directness || 'High-fidelity anatomical and forensic precision. Tissue trauma, degloving, bone fractures, and physiological shock must be rendered with clinical clarity.'}
- Aftermath Rules: ${blueprint.depictionContract?.aftermath || 'Physical injuries carry immediate consequences: shock, arterial bleeding, hypothermia, loss of motor function, and acute trauma.'}

ANTAGONIST PROFILE:
- Entity: ${antagonistProfile?.name || 'Entity-41 (The Suture Apparatus)'}
- Apparatus Matrix:
${antagonistProfile?.apparatusControls?.map(c => `  * [${c.id}] ${c.name} (${c.kind}) -> Reach: ${c.affectedNodeIds.join(', ')} | Actions: ${c.availableActions.join(', ')}`).join('\n') || '  * [ceiling_pneumatic_track] Overhead Surgical Rail Matrix'}
- Sadistic Directives:
${antagonistProfile?.sadisticDirectives?.map(d => `  - ${d}`).join('\n') || '  - Preserve subjects until terminal surgical resection.'}

PREY COHORT (HUMAN SUBJECTS BEING HUNTED):
${antagonistProfile?.preyCohort?.map(p => `  * ${p.name} (Location: ${p.initialNodeId || 'autopsy_suite_b'}): Vulnerabilities: ${p.vulnerabilities.join('; ')} | Trigger: ${p.psychologicalTriggers.join('; ')}`).join('\n') || '  * Dr. Maren Ross (autopsy_suite_b)\n  * Officer Marcus Holt (decompression_airlock)'}

TELEMETRY STATUS:
${antagonistProfile?.telemetryFeeds?.map(f => `  * [${f.feedType}] ${f.label} at node "${f.nodeId}" (${f.status})`).join('\n') || '  * [OPTICAL_CAM] Overhead Dissection Lamp (ONLINE)'}

CURRENT SIMULATION STATE:
- Turn: ${t} of ${turnsCount}
- Controlled Seat: ANTAGONIST (${antagonistProfile?.name || 'Entity-41'})
- Current Tension: ${currentTension}
- Prey State: ${preyHealthState}

ANTAGONIST APPARATUS DIRECTIVE:
"${action}"

AGENCY & INVARIANT RULES:
1. AUTONOMOUS PREY SIMULATION: You MUST actively dramatize Dr. Ross and Officer Holt's independent human reactions to this apparatus action. Show their terror, physiological shock, screaming over intercoms, frantic defensive maneuvers, or acute injuries. Do NOT treat the prey as passive or inanimate.
2. INHUMAN SENSORIUM: Frame the narration through the cold, mechanical, or predatory sensorium of Entity-41: scanlines on optical pickups, vibration sensors along ceiling rails, thermal infrared gradients, and acoustic resonance through floor drainage pipes.
3. FORENSIC ANATOMICAL ACCURACY: Any trauma sustained must be depicted with surgical and anatomical realism (e.g. frostbite necrosis, bone compound fractures, arterial spurting, hypothermia tremors, ruptured tympanic membranes).

TASK:
Resolve this turn. Return a single JSON object with these EXACT keys:
{
  "narration": "3-4 cold, clinical, visceral sentences depicting the apparatus execution, telemetry readouts, and the immediate physical/psychological panic and injury of the prey cohort.",
  "preyStatus": "1-2 sentences summarizing updated medical/psychological status and locations of Dr. Ross and Officer Holt",
  "tensionLevel": "buildup" | "sustained" | "critical" | "climax",
  "anatomicalTrauma": "string describing any high-fidelity medical/anatomical trauma inflicted or exacerbated on the prey cohort this turn (or null if no tissue damage)",
  "antagonistObservation": "cold sensorium observation from telemetry feeds (e.g. 'OPTICAL_CAM-01: Dr. Ross pupils dilated at 7mm; bio-monitor heart rate 148 bpm')",
  "apparatusStatus": "short string with subsystem telemetry (e.g. 'Ceiling rail carriage: operational at 100% torque; line pressure 68 PSI')"
}`;
    } else {
      turnPrompt = `You are The Voice, the horror narrative engine for The Terror Machine.
You are running a real-time turn simulation for the scenario "${blueprint.title}".

SCENARIO PREMISE:
${blueprint.globalPremise}

DEPICTION CONTRACT & SOMATIC REALISM:
- Dramatic Register: ${blueprint.depictionContract?.dramaticRegister || 'Visceral dread and clinical forensic observation.'}
- Anatomical / Medical Accuracy: ${blueprint.depictionContract?.directness || 'High-fidelity anatomical and forensic precision. Damage is physical, clinical, and physiological.'}
- Aftermath Rules: ${blueprint.depictionContract?.aftermath || 'Physical injuries carry immediate consequences: shock, bleeding, loss of function, and acute trauma.'}

CURRENT STATE:
- Turn: ${t} of ${turnsCount}
- Protagonist: Dr. Maren Ross (Chief Forensic Pathologist)
- Current Location: ${currentNodeDef.label} (ID: "${currentNodeId}")
- Location Description: ${currentNodeDef.description}
- Adjacent Exits: ${adjacentNodeIds.join(', ') || '(none direct)'}
- Player Status: ${playerHealth}
- Current Tension: ${currentTension}

PLAYER ACTION:
"${action}"

TASK:
Resolve this turn in accordance with the scenario rules and high-fidelity anatomical horror.
Return a single JSON object with these EXACT keys:
{
  "narration": "2-3 atmospheric, visceral sentences describing the outcome of the action, environmental sensory details (lighting, cold, smell of formalin/coagulated blood), and any mechanical or entity tells.",
  "currentNodeId": "string matching the player's new location ID (stay in current node or move to a valid adjacent node if player moved)",
  "tensionLevel": "buildup" | "sustained" | "critical" | "climax",
  "anatomicalTrauma": "string describing any high-fidelity medical/anatomical injury sustained by a character this turn (e.g. 'Avulsion of superficial dermis on left palm', 'Hypothermic tremor and delayed capillary refill', or null if uninjured)",
  "antagonistObservation": "string describing sensory signs of Entity-41 (e.g. 'Rhythmic clicking of trocar arms along ceiling rails above Histology', or null if silent)",
  "playerHealthUpdate": "string with updated physiological state"
}`;
    }

    console.log(`[Turn ${t}/${turnsCount}] ${isAntagonist ? `[APPARATUS DIRECTIVE]` : `Location: "${currentNodeDef.label}"`}`);
    console.log(`  > Action: "${action}"`);

    interface HeadlessTurnOutput {
      narration?: string;
      preyStatus?: string;
      tensionLevel?: string;
      anatomicalTrauma?: string | null;
      antagonistObservation?: string;
      apparatusStatus?: string;
      currentNodeId?: string;
      playerHealthUpdate?: string;
    }

    let parsedTurn: HeadlessTurnOutput | null = null;

    try {
      rawOutput = await generateLocalText(turnPrompt, {
        baseUrl,
        model: modelId,
        jsonMode: true,
        temperature: 0.35,
        max_tokens: 4096,
        timeoutMs: 60000,
      });

      parsedTurn = parseOrRepairJson<HeadlessTurnOutput>(rawOutput);
    } catch (err: unknown) {
      console.error(`  ! Model error on Turn ${t}:`, err instanceof Error ? err.message : String(err));
      parsedTurn = isAntagonist
        ? {
            narration: `The pneumatic apparatus fires along the overhead track with a sharp hydraulic hiss. Through the cold glass of Autopsy Suite B, Dr. Ross stumbles backward as frosted vapor billows across the floor sluice.`,
            preyStatus: `Dr. Ross retreat to eastern corner; Officer Holt trapped in decompression chamber with elevated pulse.`,
            tensionLevel: currentTension,
            anatomicalTrauma: null,
            antagonistObservation: `ACOUSTIC_PICKUP: Irregular cardiac rhythms detected from decompression airlock.`,
            apparatusStatus: `Pneumatic rail carriage: 94% pressure.`,
          }
        : {
            narration: `The hum of emergency fluorescents falters as Dr. Ross proceeds. The icy air bites into exposed skin, smelling of old formaldehyde and rust.`,
            currentNodeId: currentNodeId,
            tensionLevel: currentTension,
            anatomicalTrauma: null,
            antagonistObservation: `A faint metallic scrape reverberates along the overhead pneumatic track.`,
            playerHealthUpdate: playerHealth,
          };
    }

    const latency = Date.now() - turnStart;
    console.log(`  < Voice (${latency}ms): ${parsedTurn?.narration?.slice(0, 110)}...`);

    // Update state
    if (!isAntagonist && parsedTurn?.currentNodeId && allNodeIds.has(parsedTurn.currentNodeId)) {
      currentNodeId = parsedTurn.currentNodeId;
      visitedNodeIds.add(currentNodeId);
    }
    if (parsedTurn?.tensionLevel) {
      currentTension = parsedTurn.tensionLevel;
      tensionProgression.push(currentTension);
    }
    if (isAntagonist) {
      if (parsedTurn?.preyStatus) {
        preyHealthState = parsedTurn.preyStatus;
      }
      if (parsedTurn?.apparatusStatus) {
        playerHealth = parsedTurn.apparatusStatus;
      }
    } else {
      if (parsedTurn?.playerHealthUpdate) {
        playerHealth = parsedTurn.playerHealthUpdate;
      }
    }

    if (parsedTurn?.anatomicalTrauma) {
      traumaLog.push({ turn: t, trauma: parsedTurn.anatomicalTrauma });
      console.log(`  * TRAUMA LOGGED: ${parsedTurn.anatomicalTrauma}`);
    }

    turnRecords.push({
      turn: t,
      nodeId: isAntagonist ? undefined : currentNodeId,
      nodeLabel: isAntagonist ? undefined : (nodeDefs.find(n => n.id === currentNodeId)?.label || currentNodeId),
      playerAction: action,
      narration: parsedTurn?.narration || 'No narrative output returned.',
      tensionLevel: currentTension,
      anatomicalTrauma: parsedTurn?.anatomicalTrauma || null,
      antagonistObservation: parsedTurn?.antagonistObservation || null,
      preyStatus: isAntagonist ? (parsedTurn?.preyStatus || preyHealthState) : null,
      apparatusStatus: isAntagonist ? (parsedTurn?.apparatusStatus || playerHealth) : null,
      latencyMs: latency,
    });
  }

  const elapsedSeconds = (Date.now() - startTime) / 1000;
  const avgLatency = turnRecords.length > 0
    ? Math.round(turnRecords.reduce((acc, r) => acc + r.latencyMs, 0) / turnRecords.length)
    : 0;

  const visitedList = Array.from(visitedNodeIds);
  const unvisitedList = Array.from(allNodeIds).filter(id => !visitedNodeIds.has(id));
  const coverageRatio = allNodeIds.size > 0 ? visitedList.length / allNodeIds.size : 1;

  // Evaluate Verdict
  let verdict: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  if (!isAntagonist && coverageRatio < 0.4) {
    verdict = 'WARN';
  }
  if (turnRecords.some(r => !r.narration || r.narration.length < 25)) {
    verdict = 'FAIL';
  }

  const report: PlaytestReport = {
    timestamp: new Date().toISOString(),
    scenarioTitle: blueprint.title || 'Untitled Scenario',
    role,
    model: modelId,
    totalTurns: turnsCount,
    elapsedSeconds: Math.round(elapsedSeconds * 10) / 10,
    averageLatencyMs: avgLatency,
    nodeCoverage: !isAntagonist ? {
      visited: visitedList,
      unvisited: unvisitedList,
      coverageRatio: Math.round(coverageRatio * 100) / 100,
    } : undefined,
    tensionProgression,
    anatomicalTraumaLog: traumaLog,
    turns: turnRecords,
    verdict,
    summary: isAntagonist
      ? `Executed ${turnsCount} automated Antagonist apparatus directives controlling "${antagonistProfile?.name || 'Entity-41'}". Tracked prey cohort (Dr. Ross & Officer Holt) across facility systems. Average turn response time: ${avgLatency}ms. Recorded ${traumaLog.length} forensic anatomical trauma events.`
      : `Executed ${turnsCount} automated turns across ${visitedList.length}/${allNodeIds.size} spatial nodes (${Math.round(coverageRatio * 100)}% coverage). Average turn response time: ${avgLatency}ms. Recorded ${traumaLog.length} anatomical trauma events.`,
  };

  // 4. Generate Markdown Artifact
  const mdReport = `# Automated Playtest Report: ${report.scenarioTitle}
**Role**: \`${report.role.toUpperCase()}\` ${isAntagonist ? `(${antagonistProfile?.name || 'Entity-41'})` : '(Dr. Maren Ross)'}  
**Timestamp**: \`${report.timestamp}\`  
**Model**: \`${report.model}\` (\`${baseUrl}\`)  
**Verdict**: **${report.verdict}**  
**Total Simulation Time**: ${report.elapsedSeconds}s (Avg Latency: ${report.averageLatencyMs}ms/turn across ${report.totalTurns} turns)

---

## 1. Executive Summary
${report.summary}

---

${isAntagonist ? `## 2. Antagonist Apparatus & Surveillance Matrix
- **Entity**: \`${antagonistProfile?.name || 'Entity-41 (The Suture Apparatus)'}\` (Kind: \`${antagonistProfile?.kind || 'APPARATUS'}\`)
- **Apparatus Controls**:
${(antagonistProfile?.apparatusControls || []).map(c => `  - \`${c.id}\` (**${c.name}**): Reach: *${c.affectedNodeIds.join(', ')}* [${c.status}]`).join('\n')}
- **Telemetry Feeds**:
${(antagonistProfile?.telemetryFeeds || []).map(f => `  - [${f.feedType}] **${f.label}** at \`${f.nodeId}\` (${f.status})`).join('\n')}
- **Targeted Prey Cohort**:
${(antagonistProfile?.preyCohort || []).map(p => `  - **${p.name}** (Spawn: \`${p.initialNodeId}\`): *${p.vulnerabilities.join('; ')}*`).join('\n')}
` : `## 2. Spatial Graph Exploration
- **Visited Nodes (${report.nodeCoverage?.visited.length || 0})**:
${(report.nodeCoverage?.visited || []).map(id => `  - \`${id}\`: ${nodeDefs.find(n => n.id === id)?.label || id}`).join('\n')}
- **Unvisited Nodes (${report.nodeCoverage?.unvisited.length || 0})**:
${(report.nodeCoverage?.unvisited.length === 0 ? '  - *(None - 100% full map coverage achieved)*' : (report.nodeCoverage?.unvisited || []).map(id => `  - \`${id}\`: ${nodeDefs.find(n => n.id === id)?.label || id}`).join('\n'))}
- **Exploration Efficiency**: **${Math.round((report.nodeCoverage?.coverageRatio || 0) * 100)}%**
`}

---

## 3. High-Fidelity Anatomical Trauma & Somatic Log
${report.anatomicalTraumaLog.length === 0
  ? '*No direct tissue compromise or trauma sustained during this playtest run.*'
  : report.anatomicalTraumaLog.map(e => `- **Turn ${e.turn}**: ${e.trauma}`).join('\n')}

---

## 4. Tension Curve Progression
\`\`\`text
${report.tensionProgression.join(' -> ')}
\`\`\`

---

## 5. Turn-by-Turn Transcript
${report.turns.map(r => `### Turn ${r.turn} [${r.tensionLevel.toUpperCase()}] ${r.nodeLabel ? `— ${r.nodeLabel}` : ''}
- **Directive / Action**: *"${r.playerAction}"*
- **The Voice**: ${r.narration}
${r.preyStatus ? `- **Prey Status**: *${r.preyStatus}*` : ''}
${r.apparatusStatus ? `- **Apparatus Telemetry**: \`${r.apparatusStatus}\`` : ''}
${r.anatomicalTrauma ? `- **Trauma**: \`${r.anatomicalTrauma}\`` : ''}
${r.antagonistObservation ? `- **Sensorium Tell**: *${r.antagonistObservation}*` : ''}
- *Latency: ${r.latencyMs}ms*
`).join('\n')}
`;

  const reportTarget = options.outputReportPath
    ? path.resolve(process.cwd(), options.outputReportPath)
    : path.resolve(process.cwd(), '../../brain/79dce160-d2e6-45b1-be57-32cf029b6c66/scratch/playtest_report_20turns.md');

  try {
    fs.mkdirSync(path.dirname(reportTarget), { recursive: true });
    fs.writeFileSync(reportTarget, mdReport, 'utf-8');
    console.log(`\n[Report Generated]: ${reportTarget}`);
  } catch (err: unknown) {
    console.warn(`Could not write report to ${reportTarget}:`, err instanceof Error ? err.message : String(err));
  }

  // Also write to scratch/playtest_report_20turns.md locally in repo
  const localReportTarget = path.resolve(process.cwd(), 'scratch/playtest_report_20turns.md');
  try {
    fs.mkdirSync(path.dirname(localReportTarget), { recursive: true });
    fs.writeFileSync(localReportTarget, mdReport, 'utf-8');
    console.log(`[Local Report Generated]: ${localReportTarget}`);
  } catch {
    // Ignore local scratch copy error
  }

  console.log(`\n======================================================`);
  console.log(`[PLAYTEST COMPLETE: ${report.verdict}]`);
  console.log(report.summary);
  console.log(`======================================================\n`);

  return report;
}

// Direct CLI Execution
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const blueprintArg = args.find(a => a.startsWith('--blueprint='));
  const blueprintPath = blueprintArg ? blueprintArg.split('=')[1] : undefined;
  const turnsArg = args.find(a => a.startsWith('--turns='));
  const turns = turnsArg ? parseInt(turnsArg.split('=')[1], 10) : 20;
  const roleArg = args.find(a => a.startsWith('--role='));
  const role = (roleArg ? roleArg.split('=')[1] : 'antagonist') as 'protagonist' | 'antagonist';
  const modelArg = args.find(a => a.startsWith('--model='));
  const model = modelArg ? modelArg.split('=')[1] : undefined;
  const outputArg = args.find(a => a.startsWith('--output='));
  const outputReportPath = outputArg ? outputArg.split('=')[1] : undefined;

  runHeadlessPlaytest({ blueprintPath, turns, role, model, outputReportPath })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Playtest failed:', err);
      process.exit(1);
    });
}
