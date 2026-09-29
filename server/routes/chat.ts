/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import fs from "fs";
import path from "path";
import { Type } from "@google/genai";
import { getAiClient, classifyProviderResponse } from "../utils/aiClient";
import { getGeminiPolicy, getEngineProvider } from "../ai/modelPolicy";
import { buildOrchestratorPrompt } from "../../src/core/prompts/orchestrator";
// Removed jsonParser
import { BicameralOutput, HorrorVector, ExposureTier } from "../../src/types";
import { getMatrixRules } from "../../src/core/matrix";
import { EngineTurnRequestSchema, SimulatePlayerRequestSchema, TestSceneRequestSchema } from "../schemas/index";
import { getVoiceProvider } from "../ai/voiceProviderPolicy";
import { cleanSimulatedAction, generateLocalPlayerAction, generateLocalProse } from "../utils/localVoiceClient";
import { generateZaiPlayerAction, generateZaiProse } from "../utils/zaiClient";
import { generateHemmingwayPlayerAction, generateHemmingwayProse } from "../utils/hemmingwayClient";
import { calculateFearResponseIntensity, deriveSomaticState } from "../../src/lib/fearEngine";

const router = express.Router();

router.post("/init", async (req, res) => {
  const { setup } = req.body;
  try {
    const initPrompt = `
      System Command: Initialize simulation. 
      Aesthetic: ${setup?.aesthetic || 'liminal'}
      Tone: ${setup?.tone || 'dread'}
      
      Action: Describe the initial root node architecture. Do not address the user. Do not await input. Establish immediate atmospheric dread using the provided aesthetic.
    `;
    if (getEngineProvider() === 'local') {
      const prose = await generateLocalProse(initPrompt);
      return res.json({ prose });
    }
    if (getEngineProvider() === 'zai') {
      const prose = await generateZaiProse(initPrompt);
      return res.json({ prose });
    }
    if (getEngineProvider() === 'hemmingway') {
      const prose = await generateHemmingwayProse(initPrompt);
      return res.json({ prose });
    }
    const policy = getGeminiPolicy('ENGINE_INIT');
    const response = await getAiClient().models.generateContent({
      model: policy.model,
      contents: initPrompt,
      config: {
        thinkingConfig: {
          thinkingLevel: policy.thinkingLevel,
        },
      }
    });
    return res.json({ prose: response.text });
  } catch (error: any) {
    console.error("Init Error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/chat", async (req, res) => {
  const parsedBody = EngineTurnRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid request payload", details: parsedBody.error });
  }

  let isHubMode = false;
  try {
    const { blueprint, textBuffer, currentState, execution_mode, worldStateSummary, currentVector, currentTier, currentTensionLevel, momentumIndex = 0.5, turnCount = 1, currentPhase = 'LATENT' } = parsedBody.data;

    const mode = String(execution_mode).toUpperCase();
    isHubMode = mode === 'HUB' || mode === 'VOICE';
    const isRuntimeMode = mode === 'RUNTIME' || mode === 'ENGINE';
    
    const inputHistory = textBuffer || [];
    const activeHistory = inputHistory.slice(isHubMode ? -10 : -6);
    const updatedState = currentState ? { ...currentState } : null;
    
    let currentEscalation = updatedState?.escalation_state || 'LATENT';

    let systemInstruction = "";
    let responseMimeType = "text/plain";
    if (isRuntimeMode) {
      responseMimeType = "application/json";
      // --- ESCALATION MATRIX INJECTION (The Mirror Effect) ---
      let escalationPrompt = "";
      if (currentEscalation) {
        try {
          const aestheticName = updatedState?.aesthetic || 'gothic';
          const bundlePath = path.join(process.cwd(), `src/data/references/aesthetics/${aestheticName}.json`);
          const bundleData = fs.readFileSync(bundlePath, 'utf8');
          const bundle = JSON.parse(bundleData);
          
          const baseLens = bundle.base_lens || "";
          const entities = updatedState?.activeEntities || bundle.entities || [];
          
          let entityDirectives = "";
          entities.forEach((entity: any) => {
            if (entity.escalation_matrix && entity.escalation_matrix[currentEscalation]) {
              entityDirectives += `- ${entity.designation}: ${entity.escalation_matrix[currentEscalation]}\n`;
            }
          });

          escalationPrompt = `\n\n=== ESCALATION MATRIX (TIER: ${currentEscalation}) ===\n`;
          escalationPrompt += `THEMATIC LENS: ${baseLens}\n\n`;
          escalationPrompt += `ENTITY BEHAVIORAL IMPERATIVES:\n${entityDirectives}\n`;
          escalationPrompt += `CRITICAL DIRECTIVE: You MUST adapt the prose tone and physical constraints to match this escalation tier immediately.\n`;
        } catch (err) {
          console.error("Failed to load escalation matrix:", err);
        }
      }
      // --------------------------------------------------------

      let currentPacing = "";
      if (blueprint?.narrativeRules?.phaseDirectives) {
        const tension = updatedState?.current_tension_level 
          || blueprint?.narrativeRules?.currentTensionLevel 
          || 'buildup';
        currentPacing = blueprint?.narrativeRules?.phaseDirectives[tension] 
          || Object.values(blueprint?.narrativeRules?.phaseDirectives)[0] 
          || "";
      } else if (blueprint?.narrativeRules?.pacingDirectives) {
        currentPacing = blueprint?.narrativeRules?.pacingDirectives;
      }

      const slimBlueprint = {
        ...blueprint,
        narrativeRules: {
          ...(blueprint?.narrativeRules || {}),
          pacingDirectives: currentPacing 
        }
      };
      if (slimBlueprint.narrativeRules) {
        delete slimBlueprint.narrativeRules.phaseDirectives;
      }

      const vector = (currentVector || 'COGNITIVE') as HorrorVector;
      const tier = (currentTier || 'LATENT') as ExposureTier;
      const tensionLevel = currentTensionLevel || 'buildup';
      
      const coordinateRules = getMatrixRules(vector, tier);

      const modifiedHistory = worldStateSummary 
        ? [{ role: 'system_cinematic', content: `[CUMULATIVE CHRONOLOGY]:\n${worldStateSummary}` }, ...activeHistory]
        : activeHistory;

      systemInstruction = buildOrchestratorPrompt(slimBlueprint as any, modifiedHistory as any, updatedState || {} as any, momentumIndex, turnCount, currentPhase);

      systemInstruction += escalationPrompt;

      systemInstruction += `\n\n=== CORE RUNTIME MATRIX COORDINATES ===
    ACTIVE DOMAIN VECTOR: ${vector}
    ACTIVE EXPOSURE TIER: ${tier}
    LOCAL TENSION LEVEL (Intra-Cell Wave): ${tensionLevel}
    
    CRITICAL INSTRUCTIONS FOR THIS COORDINATE:
    ${coordinateRules.instructionVitals}
    
    PROHIBITED LITERARY DEVICES & THEMES:
    ${coordinateRules.prohibitions}`;

      if (turnCount === 0 || (activeHistory.length === 1 && typeof activeHistory[0].content === 'string' && activeHistory[0].content.includes('Begin simulation'))) {
        systemInstruction += `\n\n=== INDUCTION SPARK (ZERO-TURN INITIALIZATION) ===
    The user has just entered the simulation. Bypass standard user-action semantic parsing for this turn.
    Directly describe the current location, apply the starting escalation matrix lens, and establish the initial atmosphere based on the coordinates.`;
      }
    
      systemInstruction += `\n\nOUTPUT FORMAT REQUIREMENTS:
    You must output a structured JSON payload containing your narrative blocks. 
    Additionally, you MUST include a "suggested_tension" string ("buildup", "visceral_climax", or "aftermath").
    If the narrative demands a macro-shift in the genre or severity, include a "matrix_mutation" object with "next_vector" and "next_tier".`;
    } else {
      // Voice should be handled by /voice now, but leaving this fallback just in case
      // Note: we'll define voice prompt locally if it enters here, or we'll just throw
      systemInstruction = "You are a helpful AI."; 
    }

    const rawContents = activeHistory.map((msg: any) => {
      const parts: any[] = [];
      const safeContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      if (safeContent && safeContent.trim()) parts.push({ text: safeContent });
      if (parts.length === 0) parts.push({ text: "..." });
      return {
        role: (msg.role === "assistant" || msg.role === "voice" || msg.role === "model") ? "model" : "user",
        parts: parts,
      };
    });

    const contents: any[] = [];
    for (const msg of rawContents) {
      if (contents.length === 0) {
        if (msg.role === 'user') contents.push(msg);
        continue;
      }
      const lastMsg = contents[contents.length - 1];
      if (lastMsg.role === msg.role) lastMsg.parts.push(...msg.parts);
      else contents.push(msg);
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: '[SYSTEM COMMAND]: Initialize.' }] });
    }

    const jsonSchema: any = {
      type: Type.OBJECT,
      properties: {
        engine_thoughts: { type: Type.STRING },
        narrative_blocks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              content: { type: Type.STRING },
              speaker: { type: Type.STRING }
            },
            required: ["type", "content"]
          }
        },
        logic_state: {
          type: Type.OBJECT,
          properties: {
            requested_transition: { type: Type.STRING },
            suggested_tension: { type: Type.STRING },
            terminal_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
            matrix_mutation: { 
              type: Type.OBJECT, 
              properties: { next_vector: { type: Type.STRING }, next_tier: { type: Type.STRING } }
            },
            cast_ledger: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { character_name: { type: Type.STRING }, current_location: { type: Type.STRING }, psychological_status: { type: Type.STRING } }
              }
            }
          }
        }
      },
      required: ["engine_thoughts", "narrative_blocks", "logic_state"]
    };

    const policy = getGeminiPolicy('ENGINE_TURN');
    const response = await getAiClient().models.generateContent({
      model: policy.model,
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        thinkingConfig: {
          thinkingLevel: policy.thinkingLevel,
        },
        ...(responseMimeType === "application/json" && { 
          responseMimeType,
          responseSchema: jsonSchema
        })
      },
    });

    if (isHubMode) {
      res.json({
        engine_thoughts: '',
        narrative_blocks: [{ type: 'prose', content: response.text || "Error: No response from The Historian." }],
        logic_state: {} 
      });
      return;
    }

    const rawText = response.text || "{}";
    const cleanedText = rawText.replace(/^```json/g, '').replace(/```$/g, '');

    const parsed: any = JSON.parse(cleanedText);
    
    let blocks: any[] = [];
    
    if (Array.isArray((parsed as any).narrative_blocks)) {
      blocks = (parsed as any).narrative_blocks.map((b: any) => {
        if (b.type === 'dialogue' && b.speaker) {
          const spk = b.speaker.toUpperCase().trim();
          if (spk === 'THE VOICE' || spk === 'VOICE') {
            b.speaker = 'SYSTEM ANOMALY';
          }
        }
        return b;
      });
    } else {
      if ((parsed as any).narrative_text) {
        blocks.push({ type: 'prose', content: (parsed as any).narrative_text });
      }
      
      if (Array.isArray((parsed as any).dialogue) && (parsed as any).dialogue.length > 0) {
        (parsed as any).dialogue.forEach((d: any) => {
          let spk = d.speaker || 'Unknown';
          const spkUpper = spk.toUpperCase().trim();
          if (spkUpper === 'THE VOICE' || spkUpper === 'VOICE') {
            spk = 'SYSTEM ANOMALY';
          }
          blocks.push({ type: 'dialogue', content: d.text, speaker: spk });
        });
      }
      
      if (blocks.length === 0 && typeof parsed === 'string') {
        blocks = [{ type: 'prose', content: parsed }];
      }
    }

    const logicState: any = (parsed as any).logic_state || {};

    if ((parsed as any).current_phase !== undefined) logicState.current_phase = (parsed as any).current_phase;
    if ((parsed as any).requested_transition !== undefined) logicState.requested_transition = (parsed as any).requested_transition;
    if ((parsed as any).suggested_tension !== undefined) logicState.suggested_tension = (parsed as any).suggested_tension;
    if ((parsed as any).matrix_mutation !== undefined) logicState.matrix_mutation = (parsed as any).matrix_mutation;
    if ((parsed as any).terminal_flags !== undefined) logicState.terminal_flags = (parsed as any).terminal_flags;
    if ((parsed as any).intent_classification !== undefined) logicState.intent_classification = (parsed as any).intent_classification;
    if ((parsed as any).intent_synergy !== undefined) logicState.intent_synergy = (parsed as any).intent_synergy;

    // --- DETERMINISTIC ESCALATION RATCHET ---
    const intentClass = logicState.intent_classification;
    const synergy = logicState.intent_synergy;
    const tiers = ['LATENT', 'REACTIVE', 'TRANSGRESSIVE', 'BLACKOUT'];
    let tierIdx = tiers.indexOf(currentEscalation);

    if (tierIdx < 3 && tierIdx !== -1 && intentClass) {
       const escalationVectors = ['FLIGHT', 'DENIAL', 'FIXATION', 'EXPOSURE'];
       
       if (escalationVectors.includes(intentClass) || synergy === 'FAILURE') {
           tierIdx = Math.min(3, tierIdx + 1);
       } else if (synergy === 'SUCCESS') {
           tierIdx = Math.max(0, tierIdx - 1);
       }
    }
    
    currentEscalation = tiers[tierIdx !== -1 ? tierIdx : 0];
    logicState.escalation_state = currentEscalation;

    try {
        const aestheticName = updatedState?.aesthetic || 'gothic';
        const bundlePath = path.join(process.cwd(), `src/data/references/aesthetics/${aestheticName}.json`);
        const bundleData = fs.readFileSync(bundlePath, 'utf8');
        const bundle = JSON.parse(bundleData);
        const entities = updatedState?.activeEntities || bundle.entities || [];
        
        let matrixString = "";
        entities.forEach((entity: any) => {
            if (entity.escalation_matrix && entity.escalation_matrix[currentEscalation]) {
                matrixString += entity.escalation_matrix[currentEscalation] + " ";
            }
        });

        if (matrixString) {
            logicState.matrix_mutation = logicState.matrix_mutation || {};
            logicState.matrix_mutation.note = matrixString.trim();
        }
    } catch (e) {
        console.error("Failed to append matrix string to logic state:", e);
    }
    // ----------------------------------------

    // --- AD-LIB BLIND ENTRY: JIT SPATIAL MATERIALIZATION ---
    if (logicState.requested_transition && logicState.requested_transition.startsWith('unmaterialized_')) {
      try {
        const aestheticName = updatedState?.aesthetic || 'gothic';
        const bundlePath = path.join(process.cwd(), `src/data/references/aesthetics/${aestheticName}.json`);
        const bundleData = fs.readFileSync(bundlePath, 'utf8');
        const bundle = JSON.parse(bundleData);
        
        const roomsGenerated = updatedState?.roomsGenerated || 0;
        const maxRooms = updatedState?.maxRooms || bundle.max_rooms || 12;
        
        let motifs = bundle.motifs;
        if ((roomsGenerated >= maxRooms || currentEscalation === 'BLACKOUT') && bundle.terminal_motifs) {
            motifs = bundle.terminal_motifs;
        }

        const selectedMotif = motifs[Math.floor(Math.random() * motifs.length)];
        
        const newNodeId = `node_${crypto.randomUUID()}`;
        
        const exits = selectedMotif.possible_exits.map((exit: string) => ({
            targetNodeId: `unmaterialized_${crypto.randomUUID()}`,
            description: exit,
            isOpen: true
        }));

        // RECIPROCAL EDGE
        if (updatedState?.currentNodeId) {
            exits.push({
                targetNodeId: updatedState.currentNodeId,
                description: 'The way you came',
                isOpen: true
            });
        }
        
        const newAdLibNode = {
          id: newNodeId,
          type: 'physical',
          name: selectedMotif.name,
          description: selectedMotif.sensory_signature,
          sensoryProfile: [],
          exits: exits,
          environmentalHazards: [],
          linkedCharacters: [],
          structuralAnomalies: selectedMotif.structural_anomalies
        };

        const adLibPromptInjection = `[JIT MATERIALIZATION] The player has crossed into a new sector: ${selectedMotif.name}. SENSORY SIGNATURE: ${selectedMotif.sensory_signature}. ANOMALIES: ${selectedMotif.structural_anomalies.join(', ')}. ATMOSPHERE: ${bundle.base_lens}. Frame all incoming prose with this sensory reality.`;
        console.log("=== EXACT PROMPT CONTEXT INJECTION ===");
        console.log(adLibPromptInjection);

        logicState.matrix_mutation = logicState.matrix_mutation || {};
        logicState.matrix_mutation.new_adlib_node = newAdLibNode;
        logicState.matrix_mutation.adlib_prompt_injection = adLibPromptInjection;
        logicState.matrix_mutation.original_requested_transition = logicState.requested_transition;
        logicState.requested_transition = newNodeId;
        logicState.matrix_mutation.increment_rooms = true;

      } catch (err) {
        console.error("Ad-Lib JIT Materialization Error:", err);
      }
    }
    // -------------------------------------------------------

    const output: BicameralOutput = {
      engine_thoughts: (parsed as any).engine_logic || (parsed as any).engine_thoughts || "",
      narrative_blocks: blocks,
      logic_state: logicState
    };

    if (currentEscalation) {
       output.logic_state.escalation_state = currentEscalation;
    }

    if ((parsed as any).cast_ledger) {
       output.logic_state.cast_ledger = (parsed as any).cast_ledger;
    }

    output.logic_state.current_location = output.logic_state.current_location || updatedState?.current_location || blueprint?.setting?.location;
    output.logic_state.player_injuries = output.logic_state.player_injuries || updatedState?.player_injuries || [];
    output.logic_state.inventory = output.logic_state.inventory || updatedState?.inventory || [];
    output.logic_state.psychological_status = output.logic_state.psychological_status || updatedState?.psychological_status || 'Stable';
    output.logic_state.player_role = output.logic_state.player_role || updatedState?.player_role || 'protagonist';
    output.logic_state.npc_fixations = output.logic_state.npc_fixations || updatedState?.npc_fixations || [];
    output.logic_state.current_tension_level = output.logic_state.current_tension_level 
      || updatedState?.current_tension_level 
      || blueprint?.narrativeRules?.currentTensionLevel 
      || 'buildup';
    
    if (updatedState) {
      output.logic_state.lore_and_memory = {
        established_facts: output.logic_state.lore_and_memory?.established_facts?.length 
          ? output.logic_state.lore_and_memory.established_facts 
          : updatedState.lore_and_memory?.established_facts || [],
        permanent_consequences: output.logic_state.lore_and_memory?.permanent_consequences?.length 
          ? output.logic_state.lore_and_memory.permanent_consequences 
          : updatedState.lore_and_memory?.permanent_consequences || []
      };
    } else {
      output.logic_state.lore_and_memory = (parsed as any).logic_state?.lore_and_memory || { established_facts: [], permanent_consequences: [] };
    }

    const finalOutput = {
      ...output,
      debugReceipt: {
        acceptedBlueprintId: blueprint?.id,
        acceptedBlueprintTitle: blueprint?.identity?.title,
        activeCharacterId: req.body.currentState?.player_character_id,
        currentNode: req.body.currentState?.currentNodeId
      }
    };

    res.json(finalOutput);
  } catch (error: any) {
    if (isHubMode && (error.message?.includes('SAFETY') || error.message?.includes('candidate'))) {
      res.json({
         engine_thoughts: '',
         narrative_blocks: [{ type: 'prose', content: "I'm sorry. I found myself wandering into a corridor of thought that I'm not permitted to explore. Shall we discuss something else?" }],
         logic_state: {}
      });
    } else {
      let errorMsg = error.message;
      if (errorMsg?.includes('API key not valid') || errorMsg?.includes('API_KEY_INVALID')) {
        errorMsg = 'Your Gemini API Key is invalid or has expired. Please verify your API Key in the AI Studio Settings menu.';
      } else if (errorMsg?.includes('RESOURCE_EXHAUSTED') || errorMsg?.includes('429')) {
        errorMsg = "API Quota Exceeded. You have reached your billing limit or rate limit for the Gemini API.";
      }
      res.status(500).json({ error: errorMsg });
    }
  }
});

export function buildSimulatePlayerPrompt(opts: {
  history: any[];
  logicState: any;
  role?: string;
  characterName?: string;
  mode?: 'standard' | 'aggressive' | 'adversarial';
}): string {
  const { history, logicState, role, characterName } = opts;
  
  const recentHistory = (history || []).slice(-4).map((msg: any) => 
    `${msg.role === 'user' ? 'ME:' : 'THE ENGINE:'}\n${msg.content}`
  ).join('\n\n');

  const normalizedRole = role ? String(role).toLowerCase().trim() : '';
  const isVillain = normalizedRole === 'villain' || normalizedRole === 'antagonist';
  const isBystander = normalizedRole === 'bystander' || normalizedRole === 'witness';
  const isDirector = normalizedRole === 'director';

  let roleDirective = `You are playing ${characterName ? `"${characterName}"` : 'a SURVIVOR'}. You are a mortal in danger. React to what just happened with a concrete physical action: move somewhere, examine an object, speak to someone, use a tool, barricade an entrance, run, hide, or defend yourself. You may feel dread, but fear produces action, not paralysis. Do NOT freeze or simply observe.`;
  if (isVillain) {
    roleDirective = `You are playing ${characterName ? `"${characterName}"` : 'the PREDATORY ANTAGONIST'}. You are the dominant force in this scenario. You ACT with purpose and initiative. Every turn you must perform at least one concrete committed action: move toward a destination, manipulate or sabotage a mechanism, stalk or corner a target, prepare a trap, or issue a command. You may observe or assess, but pair any observation with a committed physical act that follows from it. Do NOT emit turns that consist solely of watching, waiting, scanning, or monitoring.`;
  } else if (isBystander) {
    roleDirective = `You are playing ${characterName ? `"${characterName}"` : 'a civilian BYSTANDER'}. You are an ordinary person caught in extraordinary circumstances. React with grounded civilian agency: try an exit, call out for help, check on a coworker, back away from danger, or look for shelter. Stay grounded, realistic, and ACTIVE.`;
  } else if (isDirector) {
    roleDirective = `You are the unseen DIRECTOR adjusting scenario pressure. Introduce a physical atmospheric or environmental shift: dim lights, fluctuate temperature, produce a structural sound, lock an access point, or stage an offstage disturbance. Be precise, physical, and evocative.`;
  }

  // Format somatic state and felt wound knowledge for simulated player
  let somaticStateSnippet = '';
  if (typeof logicState?.somaticState === 'string' && logicState.somaticState.trim()) {
    somaticStateSnippet = logicState.somaticState.trim();
  } else if (logicState?.somaticState && typeof logicState.somaticState === 'object') {
    const band = logicState.somaticState.band || logicState.somaticState.activeBand;
    const tokens = Array.isArray(logicState.somaticState.tokens) ? logicState.somaticState.tokens : [];
    const targetName = characterName || logicState.somaticState.characterName || 'Player';
    if (band && tokens.length > 0) {
      somaticStateSnippet = `[SOMATIC STATE: ${targetName} (Band ${band}: ${tokens.join(', ')})]`;
    }
  } else if (logicState?.fearState?.salienceLedger || logicState?.salienceLedger) {
    const ledger = (logicState.fearState?.salienceLedger || logicState.salienceLedger) as Record<string, any>;
    const fearContract = logicState.fearState?.fearContract || logicState.fearContract || {};
    const cast = Array.isArray(logicState.cast) ? logicState.cast : [];

    let targetCharId: string | null = null;
    let targetDisplayName = characterName || 'Player';

    if (characterName) {
      const foundMember = cast.find(
        (c: any) => c && (c.name === characterName || c.id === characterName)
      );
      if (foundMember) {
        targetCharId = foundMember.id;
        targetDisplayName = foundMember.name || foundMember.id;
      } else if (ledger[characterName]) {
        targetCharId = characterName;
      }
    }

    for (const [charId, salience] of Object.entries(ledger)) {
      const isMatch = !targetCharId
        ? (!characterName || charId === characterName || (salience?.name && salience.name === characterName))
        : (charId === targetCharId || (salience?.name && salience.name === targetDisplayName));

      if (isMatch && salience) {
        const charName = salience.name || targetDisplayName || charId;
        if (salience.somaticState && salience.somaticState.band && Array.isArray(salience.somaticState.tokens) && salience.somaticState.tokens.length > 0) {
          somaticStateSnippet = `[SOMATIC STATE: ${charName} (Band ${salience.somaticState.band}: ${salience.somaticState.tokens.join(', ')})]`;
          break;
        } else if (typeof salience.spike === 'number' || typeof salience.dread === 'number') {
          const fearlessness =
            fearContract.fearlessness?.[charId] ??
            fearContract.fearlessness?.[targetCharId || ''] ??
            fearContract.fearlessness?.['default'] ??
            0;
          const intensity = calculateFearResponseIntensity(salience, fearlessness);
          const { band, tokens } = deriveSomaticState(intensity, fearContract);
          if (band > 0 && tokens.length > 0) {
            somaticStateSnippet = `[SOMATIC STATE: ${charName} (Band ${band}: ${tokens.join(', ')})]`;
            break;
          }
        }
      }
    }
  }

  let feltWoundsSnippet = '';
  const collectedWounds: any[] = [];
  if (Array.isArray(logicState?.deathLedger?.wounds)) {
    collectedWounds.push(...logicState.deathLedger.wounds);
  } else if (Array.isArray(logicState?.wounds)) {
    collectedWounds.push(...logicState.wounds);
  } else if (Array.isArray(logicState?.deathLedger)) {
    collectedWounds.push(...logicState.deathLedger);
  } else if (logicState?.deathLedger && typeof logicState.deathLedger === 'object') {
    for (const [charKey, charWounds] of Object.entries(logicState.deathLedger as Record<string, any>)) {
      if (Array.isArray(charWounds)) {
        if (!characterName || charKey === characterName) {
          collectedWounds.push(...charWounds);
        } else {
          const matches = charWounds.filter(
            (w: any) => w && (w.characterId === characterName || w.characterName === characterName)
          );
          collectedWounds.push(...matches);
        }
      }
    }
  }

  if (collectedWounds.length > 0) {
    const relevantWounds = collectedWounds.filter((w: any) => {
      if (!w || typeof w !== 'object') return false;
      if (!characterName) return true;
      return !w.characterId || w.characterId === characterName || w.characterName === characterName;
    });
    if (relevantWounds.length > 0) {
      const woundDescs = relevantWounds.map((w: any) => {
        const sev = w.severity || 'wound';
        const mech = w.mechanism || 'injury';
        const loc = w.location ? ` to ${w.location}` : '';
        const status = w.treated ? ' [treated]' : ' [active/untreated]';
        return `${sev} ${mech}${loc}${status}`;
      });
      feltWoundsSnippet = `[FELT WOUNDS: ${woundDescs.join('; ')}]`;
    }
  }

  const systemPrompt = `
      You are the PLAYER in a clinical, atmospheric text-based horror simulation.
      ROLE DIRECTIVE:
      ${roleDirective}
      
      CURRENT STATE:
      ${JSON.stringify(logicState, null, 2)}
      ${somaticStateSnippet ? `\n      ACTIVE SOMATIC STATE:\n      ${somaticStateSnippet}\n` : ''}${feltWoundsSnippet ? `\n      FELT WOUND KNOWLEDGE:\n      ${feltWoundsSnippet}\n` : ''}
      RECENT HISTORY:
      ${recentHistory}

      DIRECTIVE:
      Write your next immediate action or dialogue. 
      Keep it between 1 and 3 sentences. React directly to the Engine's last output.
      ${somaticStateSnippet || feltWoundsSnippet ? 'Reflect your active somatic stress tokens and physical wound limitations in your reaction and physical actions.\n      ' : ''}Output a COMMITTED PHYSICAL ACTION or SPOKEN WORDS.
      Do NOT include your name, labels, markdown, or bracketed tokens. Output ONLY the raw text of your action.
    `;

  return systemPrompt;
}

router.post("/simulate-player", async (req, res) => {
  const parsedBody = SimulatePlayerRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request" });
  try {
    const { history, logicState, role, characterName } = parsedBody.data;
    const systemPrompt = buildSimulatePlayerPrompt({ history, logicState, role, characterName });

    if (getEngineProvider() === 'local' || getVoiceProvider() === 'local') {
      const action = await generateLocalPlayerAction(systemPrompt);
      return res.json({ action });
    }

    if (getEngineProvider() === 'zai' || getVoiceProvider() === 'zai') {
      const action = await generateZaiPlayerAction(systemPrompt);
      return res.json({ action });
    }

    if (getEngineProvider() === 'hemmingway' || getVoiceProvider() === 'hemmingway') {
      const action = await generateHemmingwayPlayerAction(systemPrompt);
      return res.json({ action });
    }

    const policy = getGeminiPolicy('AUTOPILOT_ACTION');
    const response = await getAiClient().models.generateContent({
      model: policy.model, 
      contents: systemPrompt,
      config: {
        thinkingConfig: {
          thinkingLevel: policy.thinkingLevel,
        },
      },
    });

    const classification = classifyProviderResponse(response);
    if (classification.kind === 'PROVIDER_REFUSAL') {
      return res.status(502).json({
        error: 'Simulation model declined player action generation.',
        code: 'PROVIDER_REFUSAL',
      });
    }
    if (classification.kind === 'EMPTY_PROVIDER_RESPONSE') {
      return res.status(502).json({
        error: 'Simulation model returned an empty player action.',
        code: 'AUTOPILOT_ACTION_FAILURE',
      });
    }

    const trimmedAction = cleanSimulatedAction(classification.text);
    if (!trimmedAction) {
      return res.status(502).json({
        error: 'Simulation model returned an empty player action.',
        code: 'AUTOPILOT_ACTION_FAILURE',
      });
    }

    return res.json({ action: trimmedAction });
  } catch (error: unknown) {
    console.error("Ghost Player Simulation Error:", error);
    return res.status(502).json({
      error: "Failed to simulate player turn.",
      code: "AUTOPILOT_ACTION_FAILURE",
    });
  }
});

router.post('/test-scene', async (req, res) => {
  const parsedBody = TestSceneRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request payload" });
  try {
    const { blueprint } = parsedBody.data;

    if (!blueprint) {
      return res.status(400).json({ error: 'Blueprint is required' });
    }

    const prompt = `
    You are the core engine of "The Terror Machine", an advanced narrative simulation.
    Your task is to write the opening scene (2-3 paragraphs) of a new session based strictly on the provided blueprint.
    
    CRITICAL INSTRUCTIONS:
    1. Use the PROTAGONIST's framing directive and sensory biases.
    2. Address the player directly as 'You'.
    3. Start the user in the first node of the Euclidean Topology Grid.
    4. Establish the atmosphere immediately without summarizing the background or lore.
    5. Do NOT include choices, menus, or meta-text. Output only the raw narrative text.
    
    BLUEPRINT:
    ${JSON.stringify(blueprint, null, 2)}
    `;

    const policy = getGeminiPolicy('ENGINE_PREVIEW');
    const response = await getAiClient().models.generateContent({
      model: policy.model, 
      contents: prompt,
      config: {
        thinkingConfig: {
          thinkingLevel: policy.thinkingLevel,
        },
      },
    });
    res.json({ text: response.text });
  } catch (error) {
    console.error('Error generating test scene:', error);
    res.status(500).json({ error: 'Failed to generate test scene' });
  }
});

router.post('/reconcile', async (req, res) => {
  try {
    const { editedText, previousLogic, currentState } = req.body;
    const { RECONCILER_SYSTEM_PROMPT } = await import("../../src/core/prompts/reconciler");
    
    const policy = getGeminiPolicy("LEGACY_RECONCILIATION");
    const response = await getAiClient().models.generateContent({
      model: policy.model,
      contents: `EDITED TEXT:\n${editedText}\n\nPREVIOUS SYSTEM LOGIC MUTATIONS:\n${JSON.stringify(previousLogic)}\n\nCURRENT STATE:\n${JSON.stringify(currentState)}`,
      config: {
        systemInstruction: RECONCILER_SYSTEM_PROMPT,
        thinkingConfig: {
          thinkingLevel: policy.thinkingLevel,
        },
        responseMimeType: "application/json",
      }
    });

    const parsedText = response.text || "{}";
    const cleaned = parsedText.replace(/^```json/g, '').replace(/```$/g, '');
    res.json(JSON.parse(cleaned));
  } catch (error) {
    console.error("Reconciliation error:", error);
    res.status(500).json({ error: "Failed to reconcile state", details: String(error) });
  }
});




// Removed /generate route in favor of /turn

export default router;