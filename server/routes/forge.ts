/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import { executeForgePrompt, executeForgePromptWithMeta } from "../ai/forgeProvider";
import { runStage1, runStage2 } from "../ai/extractionPipeline";
import { validateQuestionnaireResults } from "../ai/questionnaireValidation";
import { getAiClient } from "../utils/aiClient";
import { getGeminiPolicy, getEngineProvider } from "../ai/modelPolicy";
import { getLocalForgeModel } from "../ai/voiceProviderPolicy";
import { generateLocalText } from "../utils/localVoiceClient";
import { generateZaiText } from "../utils/zaiClient";
import { generateHemmingwayText } from "../utils/hemmingwayClient";
import { parseOrRepairJson } from "../utils/jsonRepair";
import { 
  LORE_EXTRACTION_PROMPT, 
  ARCHITECT_AMBIGUITY_SYSTEM_PROMPT,
  ARCHITECT_DEPICTION_CONTRACT_PROMPT,
  ARCHITECT_GENERAL_SYSTEM_PROMPT,
} from "../../src/core/prompts/architect";
import { getMatrixRules } from "../../src/core/matrix";
import { 
  ArchitectRequestSchema,
  ArchitectFollowUpResponseSchema,
  ArchitectResolutionProposalResponseSchema,
  ArchitectDepictionContractProposalResponseSchema,
  RawDepictionModelOutputSchema,
  TestBlueprintRequestSchema,
  AnalyzeReferenceRequestSchema,
  SummarizeInterviewRequestSchema,
  ExtractStyleRequestSchema,
  DistillRequestSchema,
  MemoryForgeRequestSchema,
  ExtractBlueprintRequestSchema,
  SweepJobRequestSchema,
  SweepLens,
  SweepProvenance
} from "../schemas/index";
import { z } from "zod";
import {
  REFERENCE_IMPORT_MAX_FILE_BYTES,
  getDecodedBase64ByteLength,
  createPayloadTooLargeError
} from "../../src/lib/referenceImportPolicy";
import { ForgeSourceRecord, ForgeSourceAnalysis } from "../../src/types/forge";
import {
  validateAndNormalizeDocumentAnalysis,
  buildSourceAnalysisFromBlueprint
} from "../../src/lib/sourceBaseline";
import { getForgeExtractionPrompt } from "../../src/lib/extractionContract";
import { planSweepWindows } from "../ai/windowPlanner";
import {
  createSweepJob,
  getSweepJob,
  cancelSweepJob,
  resolveEvidenceSourceRange,
  buildSweepPrompt,
  SweepJobLedger,
  PinnedModelConfig,
} from "../ai/sweepOrchestrator";
import { SseStream } from "../utils/sse";
import crypto from "crypto";

export interface RegisteredServerSourceEntry {
  sourceBinding: string;
  sourceId: string;
  fileName: string;
  sourceSummary: string;
  normalizedText: string;
  contentDigest: string;
  charLength: number;
  pinnedJobId?: string;
  evidence: Array<{ id: string; category: string; claim: string; excerpt?: string }>;
  unknowns: Map<string, { id: string; category: string; question: string; targetEffect: string }>;
  closedUnknowns: Set<string>;
  registeredAt: number;
  createdAt: number;
}

export const serverSourceRegistry = new Map<string, RegisteredServerSourceEntry>();
const BINDING_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function sweepExpiredServerSourceBindings(): void {
  const now = Date.now();
  for (const [bindingId, entry] of serverSourceRegistry.entries()) {
    if (entry.pinnedJobId) {
      const job = getSweepJob(entry.pinnedJobId);
      if (job && (job.status === 'queued' || job.status === 'running')) {
        continue;
      }
    }
    if (now - entry.registeredAt > BINDING_TTL_MS) {
      serverSourceRegistry.delete(bindingId);
    }
  }
}

export function registerServerSource(analysis: ForgeSourceAnalysis, rawText?: string): string {
  sweepExpiredServerSourceBindings();
  const sourceBinding = crypto.randomUUID();

  let normalizedText = '';
  if (rawText && typeof rawText === 'string' && rawText.trim().length > 0) {
    normalizedText = rawText.trim();
  } else {
    const textParts: string[] = [];
    if (analysis.summary) textParts.push(`Summary: ${analysis.summary}`);
    for (const ev of analysis.evidence || []) {
      if (ev.claim) textParts.push(`Claim (${ev.category}): ${ev.claim}`);
      if (ev.excerpt) textParts.push(`Excerpt: "${ev.excerpt}"`);
    }
    for (const cand of analysis.candidates || []) {
      if (cand.label) textParts.push(`Candidate: ${cand.label} - ${cand.explanation}`);
    }
    normalizedText = textParts.join('\n\n') || analysis.summary || analysis.sourceRecord?.fileName || 'Source Document';
  }

  const contentDigest = crypto.createHash('sha256').update(normalizedText).digest('hex');
  const now = Date.now();

  const entry: RegisteredServerSourceEntry = {
    sourceBinding,
    sourceId: analysis.id,
    fileName: analysis.sourceRecord?.fileName || 'Source Document',
    sourceSummary: analysis.summary || '',
    normalizedText,
    contentDigest,
    charLength: normalizedText.length,
    evidence: (analysis.evidence || []).map((e) => ({
      id: e.id,
      category: e.category,
      claim: e.claim,
      excerpt: e.excerpt,
    })),
    unknowns: new Map(
      (analysis.unknowns || []).map((u) => [
        u.id,
        { id: u.id, category: u.category, question: u.question, targetEffect: u.targetEffect },
      ])
    ),
    closedUnknowns: new Set(),
    registeredAt: now,
    createdAt: now,
  };
  serverSourceRegistry.set(sourceBinding, entry);
  return sourceBinding;
}

export function clearServerSourceRegistry(): void {
  serverSourceRegistry.clear();
}

export { executeForgePrompt, executeForgePromptWithMeta };

const router = express.Router();

router.post("/register-source", (req, res) => {
  const RegisterSchema = z.object({
    rawBlueprint: z.unknown(),
    fileName: z.string().min(1).default('imported_blueprint.json'),
    mimeType: z.string().default('application/json'),
  });

  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid registration payload", details: parsed.error.format() });
  }

  try {
    const rawBlueprint = parsed.data.rawBlueprint;
    const fileName = parsed.data.fileName;
    // Recompute payload size server-side
    const rawString = typeof rawBlueprint === 'string' ? rawBlueprint : JSON.stringify(rawBlueprint);
    const fileSizeBytes = Buffer.byteLength(rawString, 'utf-8');

    if (fileSizeBytes > REFERENCE_IMPORT_MAX_FILE_BYTES) {
      return res.status(413).json(createPayloadTooLargeError());
    }

    const sourceRecord: ForgeSourceRecord = {
      id: `src-${fileName.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}`,
      fileName,
      mimeType: parsed.data.mimeType || 'application/json',
      kind: 'native_blueprint',
      receivedAt: Date.now(),
      fileSizeBytes,
    };

    const analysis = buildSourceAnalysisFromBlueprint(sourceRecord, rawBlueprint, fileSizeBytes);
    const sourceBinding = registerServerSource(analysis);

    return res.json({
      success: true,
      analysis,
      sourceBinding,
    });
  } catch (err: any) {
    console.error("Failed to register and analyze native source:", err);
    return res.status(500).json({ error: "Failed to normalize and register source: " + (err.message || String(err)) });
  }
});

router.post("/close-unknown", (req, res) => {
  const CloseSchema = z.object({
    sourceBinding: z.string().min(1),
    unknownId: z.string().min(1),
  });

  const parsed = CloseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid close-unknown payload" });
  }

  sweepExpiredServerSourceBindings();
  const entry = serverSourceRegistry.get(parsed.data.sourceBinding);
  if (!entry) {
    return res.status(400).json({ error: "Source binding expired or missing.", code: "SOURCE_BINDING_EXPIRED" });
  }

  if (!entry.unknowns.has(parsed.data.unknownId)) {
    return res.status(400).json({ error: "Unknown identity not found on registered source.", code: "UNREGISTERED_UNKNOWN_IDENTITY" });
  }

  entry.closedUnknowns.add(parsed.data.unknownId);
  return res.json({ success: true, closed: true, unknownId: parsed.data.unknownId });
});

router.post("/revoke-source-binding", (req, res) => {
  const RevokeSchema = z.object({
    sourceBinding: z.string().min(1),
  });

  const parsed = RevokeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid revocation payload" });
  }

  serverSourceRegistry.delete(parsed.data.sourceBinding);
  return res.json({ success: true, revoked: true });
});

router.post("/test-blueprint", async (req, res) => {
  const parsedBody = TestBlueprintRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request payload" });

  try {
    const { blueprint } = parsedBody.data;
    if (!blueprint) return res.status(400).json({ error: "No blueprint provided." });

    const coordinateRules = getMatrixRules(blueprint.startingVector, blueprint.startingTier);

    const systemPrompt = `
      You are the ENGINE of a text-based atmospheric horror simulation. 
      You are performing a DRY-RUN INITIALIZATION for a new scenario.

      === SCENARIO BLUEPRINT ===
      TITLE: ${blueprint.title}
      PREMISE: ${blueprint.premise}
      ENVIRONMENTAL RULES: ${blueprint.environmentalRules}
      
      === MATRIX COORDINATES ===
      VECTOR: ${blueprint.startingVector}
      TIER: ${blueprint.startingTier}
      
      CRITICAL INSTRUCTIONS:
      ${coordinateRules.instructionVitals}
      
      PROHIBITED THEMES:
      ${coordinateRules.prohibitions}

      DIRECTIVE:
      Generate the OPENING SCENE of this nightmare. Establish the atmosphere, the sensory baseline, and the immediate physical reality the user is waking up to. Do not provide user choices; just drop them into the world.
      
      OUTPUT FORMAT:
      You MUST output a structured JSON object containing an array of "narrative_blocks" (using types like "prose", "environmental_intrusion", or "system_voice"). 
      \`\`\`json
      {
        "narrative_blocks": [ ... ]
      }
      \`\`\`
    `;

    const outputText = await executeForgePrompt(systemPrompt, {
      policyKey: "FORGE_PREVIEW",
    });
    let narrativeBlocks = [];

    const jsonMatch = outputText.match(/```json\n([\s\S]*?)\n```/) || outputText.match(/({[\s\S]*})/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        narrativeBlocks = parsed.narrative_blocks || [];
      } catch (e) {
        console.error("JSON parse error on test run", e);
      }
    }

    res.json({ blocks: narrativeBlocks });

  } catch (error) {
    console.error("Test Blueprint error:", error);
    res.status(500).json({ error: "Failed to generate opening scene." });
  }
});

router.post("/architect", async (req, res) => {
  const parsedBody = ArchitectRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid request payload", details: parsedBody.error.format() });
  }

  try {
    if (parsedBody.data.kind === 'AMBIGUITY_RESOLUTION') {
      const { userMessage, activeUnknown, draftContext, sourceContext, history } = parsedBody.data;

      sweepExpiredServerSourceBindings();
      // Independent Server Identity Verification via server-issued sourceBinding
      const bindingKey = activeUnknown.sourceBinding;
      if (!bindingKey) {
        return res.status(400).json({
          error: "Source binding is required for ambiguity resolution.",
          code: "SOURCE_BINDING_REQUIRED",
        });
      }

      const registeredSource = serverSourceRegistry.get(bindingKey);
      if (!registeredSource) {
        return res.status(400).json({
          error: `Source binding "${bindingKey}" is missing, expired, or invalid. Source analysis must be registered before resolution.`,
          code: 'SOURCE_BINDING_EXPIRED',
        });
      }

      if (activeUnknown.sourceId && activeUnknown.sourceId !== registeredSource.sourceId) {
        return res.status(400).json({
          error: `Client sourceId "${activeUnknown.sourceId}" does not match registered source binding "${registeredSource.sourceId}".`,
          code: 'SOURCE_ID_MISMATCH',
        });
      }

      if (registeredSource.closedUnknowns.has(activeUnknown.unknownId)) {
        return res.status(400).json({
          error: `Unknown "${activeUnknown.unknownId}" has already been resolved and closed. Replay rejected.`,
          code: 'BINDING_UNKNOWN_CLOSED',
        });
      }

      if (!registeredSource.unknowns.has(activeUnknown.unknownId)) {
        return res.status(400).json({
          error: `Unregistered unknown identity "${activeUnknown.unknownId}" for source "${registeredSource.fileName}".`,
          code: 'UNREGISTERED_UNKNOWN_IDENTITY',
        });
      }

      // Authoritative field resolution directly from server registry
      const registeredUnknown = registeredSource.unknowns.get(activeUnknown.unknownId)!;
      const resolvedSourceId = registeredSource.sourceId;
      const resolvedFileName = registeredSource.fileName;
      const resolvedSummary = registeredSource.sourceSummary;
      const resolvedEvidence = (registeredSource.evidence || []).slice(0, 12);
      const resolvedCategory = registeredUnknown.category;
      const resolvedQuestion = registeredUnknown.question;
      const resolvedTargetEffect = registeredUnknown.targetEffect;

      const formattedHistory = history
        .map((msg) => `${msg.role === 'user' ? 'USER:' : 'ARCHITECT:'}\n${msg.content}`)
        .join('\n\n');

      const maxFollowUpsReached = activeUnknown.followUps.length >= 2;
      const canonicalAmbiguities = sourceContext?.canonicalAmbiguities || draftContext.ambiguities || [];

      const fullPrompt = `${ARCHITECT_AMBIGUITY_SYSTEM_PROMPT}

=== ACTIVE UNKNOWN TO RESOLVE ===
Source ID: ${resolvedSourceId}
Unknown ID: ${activeUnknown.unknownId}
Category: ${resolvedCategory}
Core Question: ${resolvedQuestion}
Target Effect / Stake: ${resolvedTargetEffect}
Creator's Submitted Clarification: "${activeUnknown.submittedAnswer || userMessage}"
Previous Follow-Ups (${activeUnknown.followUps.length}/2):
${activeUnknown.followUps.map((f, i) => `  [${i + 1}] Q: "${f.question}" -> A: "${f.answer || ''}"`).join('\n') || '  (None)'}
${maxFollowUpsReached ? 'CRITICAL LIMIT NOTICE: 2 follow-ups have already been conducted. You MUST NOT ask another follow-up question. You MUST return a RESOLUTION_PROPOSAL.' : ''}

=== BOUNDED SOURCE CONTEXT ===
Source File: ${resolvedFileName}
Source Summary: ${resolvedSummary || 'None'}
Relevant Evidence Records (${resolvedEvidence.length}/12 max):
${resolvedEvidence.map((e, idx) => `  [${idx + 1}] (${e.category}) Claim: "${e.claim}"${e.excerpt ? ` | Excerpt: "${e.excerpt}"` : ''}`).join('\n') || '  (None)'}

=== EXISTING CANONICAL AMBIGUITY DECISIONS ===
${canonicalAmbiguities.length > 0 ? JSON.stringify(canonicalAmbiguities, null, 2) : '  (None)'}

=== ACTIVE SCENARIO DRAFT CONTEXT ===
Title: ${draftContext.title || 'Untitled'}
Premise: ${draftContext.premise || 'None'}
Setting: ${JSON.stringify(draftContext.setting || {})}
Cast: ${JSON.stringify(draftContext.cast || [])}
Environmental Rules: ${JSON.stringify(draftContext.environmentalRules || [])}

=== CONVERSATION HISTORY ===
${formattedHistory || '(No previous messages)'}

CREATOR'S LATEST MESSAGE:
"${userMessage}"

Generate your response in raw JSON adhering to the required schema:`;

      let outputText: string;
      try {
        outputText = await executeForgePrompt(fullPrompt, {
          policyKey: "FORGE_ARCHITECTURE",
          responseMimeType: "application/json",
        });
      } catch (err: any) {
        console.error("Architect ambiguity AI invocation error:", err);
        return res.status(502).json({ error: "Architect model invocation failed." });
      }
      let parsedJson: any;
      try {
        const cleanJson = outputText.replace(/```json\n?|```/g, '').trim();
        parsedJson = JSON.parse(cleanJson);
      } catch {
        return res.status(502).json({
          error: "Architect returned malformed non-JSON output.",
        });
      }

      if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
        return res.status(502).json({
          error: "Architect returned non-object JSON payload.",
        });
      }

      if (parsedJson.type !== 'FOLLOW_UP' && parsedJson.type !== 'RESOLUTION_PROPOSAL') {
        return res.status(502).json({
          error: `Architect returned invalid response type: "${String(parsedJson.type)}"`,
        });
      }

      if (
        typeof parsedJson.sourceId !== 'string' ||
        parsedJson.sourceId !== resolvedSourceId ||
        typeof parsedJson.unknownId !== 'string' ||
        parsedJson.unknownId !== activeUnknown.unknownId
      ) {
        return res.status(502).json({
          error: `Architect returned identity mismatch: expected sourceId="${resolvedSourceId}", unknownId="${activeUnknown.unknownId}"`,
        });
      }

      if (maxFollowUpsReached && parsedJson.type === 'FOLLOW_UP') {
        return res.status(502).json({
          error: "Architect attempted impermissible third follow-up question.",
        });
      }

      const validator =
        parsedJson.type === 'FOLLOW_UP'
          ? ArchitectFollowUpResponseSchema
          : ArchitectResolutionProposalResponseSchema;

      const validated = validator.safeParse(parsedJson);
      if (!validated.success) {
        return res.status(502).json({
          error: "Architect response schema validation failed.",
          details: validated.error.format(),
        });
      }

      return res.json(validated.data);
    }

    if (parsedBody.data.kind === 'DEPICTION_CONTRACT_PROPOSAL') {
      const { draftContext, baselineContext, history } = parsedBody.data;

      const formattedHistory = history
        .map((msg) => `${msg.role === 'user' ? 'USER:' : 'ARCHITECT:'}\n${msg.content}`)
        .join('\n\n');

      const summariesList =
        (baselineContext.sourceSummaries || [])
          .map((s, idx) => `  [${idx + 1}] ${s}`)
          .join('\n') || '  (None)';

      const creatorDecisions = (baselineContext.appliedCandidateFacts || [])
        .map(
          (f, idx) =>
            `  [${idx + 1}] (${f.classification}) Target: ${f.target} -> "${f.value}" (Source: ${f.sourceFileName})`
        )
        .join('\n') || '  (None)';

      const evidenceList = (baselineContext.evidenceClaims || [])
        .map(
          (e, idx) =>
            `  [${idx + 1}] (${e.category}) Claim: "${e.claim}"${e.excerpt ? ` | Excerpt: "${e.excerpt}"` : ''}`
        )
        .join('\n') || '  (None)';

      const ambiguityList = (baselineContext.canonicalAmbiguities || draftContext.ambiguities || [])
        .map(
          (a, idx) =>
            `  [${idx + 1}] (${a.resolutionMode}) Question: "${a.question}" -> ${a.resolutionMode === 'CONTEXTUAL_DISCRETION' ? `[CONTEXTUAL DISCRETION / DELIBERATE UNCERTAINTY: ${a.guidance || 'Preserve unknown boundary'}]` : `Resolution: "${a.resolution || 'Defined'}"`}`
        )
        .join('\n') || '  (None)';

      const fullPrompt = `${ARCHITECT_DEPICTION_CONTRACT_PROMPT}

=== SCENARIO DRAFT CONTEXT ===
Title: ${draftContext.title}
Premise: ${draftContext.premise}
Setting: ${JSON.stringify(draftContext.setting)}
Cast: ${JSON.stringify(draftContext.cast)}
Environmental Rules: ${JSON.stringify(draftContext.environmentalRules)}
References: ${JSON.stringify(draftContext.references)}
Draft Revision: ${draftContext.draftRevision}

=== SCENARIO BASELINE CONTEXT ===
Source Count: ${baselineContext.sourceCount}
Source Baseline Revision: ${baselineContext.sourceBaselineRevision}

--- SOURCE SUMMARIES ---
${summariesList}

--- CREATOR-AUTHORED OR ACCEPTED DECISIONS ---
${creatorDecisions}

--- SOURCE EVIDENCE ---
${evidenceList}

--- CANONICAL AMBIGUITY DECISIONS (INCLUDING CONTEXTUAL DISCRETION) ---
${ambiguityList}

=== CONVERSATION LOG ===
${formattedHistory || '(No previous messages)'}

Synthesize a complete, non-placeholder Depiction Contract tailored for this scenario in raw JSON:`;

      let outputText: string;
      try {
        outputText = await executeForgePrompt(fullPrompt, {
          policyKey: "FORGE_ARCHITECTURE",
          responseMimeType: "application/json",
        });
      } catch (err: any) {
        console.error("Architect depiction contract AI invocation error:", err);
        return res.status(502).json({ error: "Architect model invocation failed." });
      }
      let parsedJson: any;
      try {
        parsedJson = JSON.parse(outputText);
      } catch {
        return res.status(502).json({
          error: "Architect returned malformed non-JSON output.",
        });
      }

      if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
        return res.status(502).json({
          error: "Architect returned non-object JSON payload.",
        });
      }

      const rawValidation = RawDepictionModelOutputSchema.safeParse(parsedJson);
      if (!rawValidation.success) {
        return res.status(502).json({
          error: "Architect returned invalid raw model output structure.",
          details: rawValidation.error.format(),
        });
      }

      const rawData = rawValidation.data;
      const { dramaticRegister, directness, aftermath, ambiguityHandling, specialBoundaries } =
        rawData.contract;

      const isPlaceholder = (val: string): boolean => {
        const trimmed = val.trim();
        if (!trimmed) return true;
        return /^(unknown|none|n\/a|na|tbd|todo|placeholder|to be determined|null|undefined|not applicable|\[.*?\]|<.*?>)$/i.test(
          trimmed
        );
      };

      if (
        isPlaceholder(dramaticRegister) ||
        isPlaceholder(directness) ||
        isPlaceholder(aftermath) ||
        isPlaceholder(ambiguityHandling) ||
        (specialBoundaries.trim().length > 0 && isPlaceholder(specialBoundaries))
      ) {
        return res.status(502).json({
          error: "Architect contract contains placeholder fields.",
        });
      }

      if (isPlaceholder(rawData.rationale)) {
        return res.status(502).json({
          error: "Architect proposal contains placeholder rationale.",
        });
      }

      const structuredProposal = {
        type: 'DEPICTION_CONTRACT_PROPOSAL' as const,
        ...(rawData.message ? { message: rawData.message } : {}),
        proposal: {
          contract: {
            dramaticRegister: dramaticRegister.trim(),
            directness: directness.trim(),
            aftermath: aftermath.trim(),
            ambiguityHandling: ambiguityHandling.trim(),
            specialBoundaries: specialBoundaries.trim(),
          },
          rationale: rawData.rationale.trim(),
          sourceDraftRevision: draftContext.draftRevision,
          sourceBaselineRevision: baselineContext.sourceBaselineRevision,
          createdAt: Date.now(),
        },
      };

      const validated = ArchitectDepictionContractProposalResponseSchema.safeParse(structuredProposal);
      if (!validated.success) {
        return res.status(502).json({
          error: "Architect depiction proposal failed response schema validation.",
          details: validated.error.format(),
        });
      }

      return res.json(validated.data);
    }

    // GENERAL_MESSAGE mode
    const { userMessage, draftContext, history } = parsedBody.data;
    const formattedHistory = history
      .map((msg) => `${msg.role === 'user' ? 'USER:' : 'ARCHITECT:'}\n${msg.content}`)
      .join('\n\n');

    const fullPrompt = `${ARCHITECT_GENERAL_SYSTEM_PROMPT}

=== SCENARIO DRAFT CONTEXT ===
Title: ${draftContext?.title || 'Untitled'}
Premise: ${draftContext?.premise || 'None'}
Setting: ${JSON.stringify(draftContext?.setting || {})}
Cast: ${JSON.stringify(draftContext?.cast || [])}

=== CONVERSATION LOG ===
${formattedHistory}

USER:
${userMessage}

ARCHITECT:`;

    let outputText = "{}";
    try {
      outputText = await executeForgePrompt(fullPrompt, {
        policyKey: "FORGE_ARCHITECTURE",
        responseMimeType: "application/json",
      });
    } catch (err: any) {
      console.error("Architect general AI invocation error:", err);
      return res.status(502).json({ error: "Architect model invocation failed." });
    }
    let messageText = outputText;
    try {
      const parsed = JSON.parse(outputText);
      if (parsed.message) {
        messageText = parsed.message;
      }
    } catch {
      // Use raw text if not JSON
    }

    const resObj = {
      type: 'MESSAGE' as const,
      message: messageText,
    };

    return res.json(resObj);
  } catch (error) {
    console.error("Architect route error:", error);
    res.status(500).json({ error: "Architect failed to respond." });
  }
});

router.post("/analyze-reference", async (req, res) => {
  const parsedBody = AnalyzeReferenceRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request payload" });

  try {
    const { materials } = parsedBody.data;
    if (!materials || materials.length === 0) throw new Error("No reference materials provided.");

    const multimodalParts = materials.map((mat: any) => {
      if (mat.type === 'image') {
        return {
          inlineData: { mimeType: mat.mimeType, data: mat.content },
        };
      } else {
        return {
          text: `--- SOURCE FILE: ${mat.fileName} ---\n${mat.content}\n--- END SOURCE FILE ---`,
        };
      }
    });

    let responseText = "{}";
    if (getEngineProvider() === 'local') {
      const textParts = materials
        .filter((mat: any) => mat.type !== 'image')
        .map((mat: any) => `--- SOURCE FILE: ${mat.fileName} ---\n${mat.content}\n--- END SOURCE FILE ---`)
        .join('\n\n');
      const prompt = `Extract the lore from the following materials.\n\n${textParts}`;
      responseText = await generateLocalText(prompt, {
        model: getLocalForgeModel(),
        jsonMode: true,
        max_tokens: 16384,
      });
    } else if (getEngineProvider() === 'zai') {
      const textParts = materials
        .filter((mat: any) => mat.type !== 'image')
        .map((mat: any) => `--- SOURCE FILE: ${mat.fileName} ---\n${mat.content}\n--- END SOURCE FILE ---`)
        .join('\n\n');
      const prompt = `Extract the lore from the following materials.\n\n${textParts}`;
      responseText = await generateZaiText(prompt, { jsonMode: true });
    } else if (getEngineProvider() === 'hemmingway') {
      const textParts = materials
        .filter((mat: any) => mat.type !== 'image')
        .map((mat: any) => `--- SOURCE FILE: ${mat.fileName} ---\n${mat.content}\n--- END SOURCE FILE ---`)
        .join('\n\n');
      const prompt = `Extract the lore from the following materials.\n\n${textParts}`;
      responseText = await generateHemmingwayText(prompt, { jsonMode: true });
    } else {
      const policy = getGeminiPolicy("LORE_ANALYSIS");
      const response = await getAiClient().models.generateContent({
        model: policy.model,
        contents: [
          "Extract the lore from the following materials.",
          ...multimodalParts
        ],
        config: {
          systemInstruction: LORE_EXTRACTION_PROMPT,
          thinkingConfig: {
            thinkingLevel: policy.thinkingLevel,
          },
        }
      });
      responseText = response.text || "{}";
    }

    const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const extractedData = JSON.parse(cleanJsonString);

    res.json(extractedData);
  } catch (error: any) {
    console.error('Lore Extraction Failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/summarize-interview", async (req, res) => {
  const parsedBody = SummarizeInterviewRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request payload" });

  try {
    const { history } = parsedBody.data;
    const historyText = history?.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n') || '';
    const responseText = await executeForgePrompt(historyText, {
      systemInstruction: "Condense this interview history into a flat, objective list of established facts, rules, setting details, threats, and psychological parameters.",
      policyKey: "LORE_ANALYSIS",
    });
    res.json({ text: responseText || "Summary failed." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/extract-style", async (req, res) => {
  const parsedBody = ExtractStyleRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request payload" });

  try {
    const { userText } = parsedBody.data;
    const text = await executeForgePrompt(userText, {
      systemInstruction: `You are a literary analyst. Analyze the provided text and output a JSON object describing its style vectors. 
        
        REQUIRED SCHEMA:
        {
          "sentenceStructure": "one of: fragmented, staccato, compound-heavy, clinical-flat",
          "vocabularyTier": "one of: visceral, archaic, clinical, colloquial",
          "sensoryFocus": ["list", "of", "dominant", "senses"],
          "thematicCore": "The central aesthetic or philosophical obsession of the text",
          "forbiddenDevices": ["cinematic camera angles", "metaphors and similes", "forced colloquialisms", "suddenly or unexpectedly", "internal emotional assumptions"]
        }
        
        Do not include markdown blocks. Only return the JSON.`,
      policyKey: "LORE_ANALYSIS",
      responseMimeType: "application/json",
    });

    const cleanText = text.replace(/```json\n?|```/g, '').trim();
    res.json(JSON.parse(cleanText));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/distill", async (req, res) => {
  const parsedBody = DistillRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request payload" });

  try {
    const { systemPrompt, currentSummary, flattenedTranscript } = parsedBody.data;

    const payloadContent = `
      CURRENT WORLD SUMMARY:
      ${currentSummary}

      PRUNED EXCHANGES TO INTEGRATE:
      ${flattenedTranscript}
    `;

    const compressedSummary = await executeForgePrompt(systemPrompt + '\n\n' + payloadContent, {
      policyKey: "LORE_ANALYSIS",
    });
    res.json({ summary: compressedSummary.trim() });
  } catch (error) {
    console.error('Distillation route error:', error);
    res.status(500).json({ error: 'Failed to compress context' });
  }
});

router.post("/memory-forge", async (req, res) => {
  const parsedBody = MemoryForgeRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request payload" });

  try {
    const { systemPrompt, chatHistory } = parsedBody.data;
    const text = await executeForgePrompt(systemPrompt + '\n\n' + chatHistory, {
      policyKey: "LORE_ANALYSIS",
      responseMimeType: "application/json",
    });
    
    const cleanText = text.replace(/```json\n?|```/g, '').trim();
    res.json(JSON.parse(cleanText));
  } catch (error) {
    console.error('Memory Forge route error:', error);
    res.status(500).json({ error: 'Failed to forge memory' });
  }
});

router.post("/extract-blueprint", async (req, res) => {
  const parsedBody = ExtractBlueprintRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request payload" });

  try {
    const { base64Data, mimeType, fileName, pageImages } = parsedBody.data;

    // Independent server-side decoded size check
    const decodedByteLength = getDecodedBase64ByteLength(base64Data);
    if (decodedByteLength > REFERENCE_IMPORT_MAX_FILE_BYTES) {
      return res.status(413).json(createPayloadTooLargeError());
    }

    let coverImageUrl: string | undefined;
    if (mimeType.startsWith('image/')) {
      coverImageUrl = base64Data.startsWith('data:') ? base64Data : `data:${mimeType};base64,${base64Data}`;
    } else if (mimeType === 'application/pdf') {
      try {
        const pdfBuffer = Buffer.from(base64Data, 'base64');
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: pdfBuffer });
        const screenshotRes = await parser.getScreenshot({ partial: [1], imageDataUrl: true });
        if (screenshotRes?.pages?.[0]?.dataUrl) {
          coverImageUrl = screenshotRes.pages[0].dataUrl;
        }
        await parser.destroy();
      } catch (err) {
        console.warn('[FORGE COVER EXTRACT WARN]', err);
      }
    }

    const sourceId = `src-${crypto.randomUUID()}`;
    const sourceRecord: ForgeSourceRecord = {
      id: sourceId,
      fileName,
      mimeType,
      kind: 'document',
      receivedAt: Date.now(),
      fileSizeBytes: decodedByteLength,
      coverImageUrl,
    };


    const extractionPrompt = getForgeExtractionPrompt(fileName);

    const outputText = await executeForgePrompt(extractionPrompt, {
      inlineData: { mimeType, data: base64Data },
      pageImages,
      policyKey: "FORGE_ARCHITECTURE",
      responseMimeType: "application/json",
    });

    let rawJson = '';
    const codeBlockMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      rawJson = codeBlockMatch[1].trim();
    } else {
      const firstBrace = outputText.indexOf('{');
      const lastBrace = outputText.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        rawJson = outputText.slice(firstBrace, lastBrace + 1);
      }
    }

    if (!rawJson) {
      return res.status(500).json({ error: "Model did not return valid JSON." });
    }

    try {
      const parsedData: any = parseOrRepairJson(rawJson);

      // Ensure at least one depiction_contract candidate exists so document extraction succeeds
      if (parsedData && typeof parsedData === 'object') {
        const hasDepiction = Array.isArray(parsedData.candidates) &&
          parsedData.candidates.some((c: any) => c && c.target === 'depiction_contract');
        if (!hasDepiction) {
          if (!Array.isArray(parsedData.candidates)) {
            parsedData.candidates = [];
          }
          if (!Array.isArray(parsedData.evidence) || parsedData.evidence.length === 0) {
            parsedData.evidence = [{
              id: 'ev-auto-1',
              category: 'setting',
              claim: `Visual and structural reference extracted from ${sourceRecord.fileName}`,
              excerpt: `Source document ${sourceRecord.fileName}`
            }];
          }
          parsedData.candidates.unshift({
            id: 'cand-auto-depiction',
            classification: 'inference',
            target: 'depiction_contract',
            label: `${sourceRecord.fileName} Depiction Contract`,
            explanation: 'Baseline depiction contract synthesized from reference document.',
            evidenceIds: [parsedData.evidence[0].id],
            proposedValue: {
              dramaticRegister: 'Atmospheric psychological horror and tension',
              directness: 'Grounded sensory observation',
              aftermath: 'Lingering psychological and physical fatigue',
              ambiguityHandling: 'Ambiguous uncanny phenomena grounded in tangible clues'
            }
          });
        }
      }
      
      const analysis = validateAndNormalizeDocumentAnalysis(parsedData, sourceRecord);
      if (analysis.status === 'error') {
        console.error("Source analysis normalization failed:", analysis.errorMessage, "Parsed candidate targets:", (parsedData as any)?.candidates?.map((c: any) => c.target));
        return res.status(500).json({
          error: analysis.errorMessage || "Failed to validate source analysis schema.",
          details: analysis.errorMessage ? [analysis.errorMessage] : [],
        });
      }

      let sourceBinding: string | undefined;
      if (analysis.status === 'completed' || analysis.status === 'completed_with_issues') {
        sourceBinding = registerServerSource(analysis);
      }

      res.json({
        success: true,
        analysis,
        sourceBinding,
      });
    } catch (e: any) {
      console.error("Failed to parse Architect Extraction JSON:", e);
      return res.status(500).json({ error: "Failed to parse document structure: " + e.message });
    }
  } catch (error: any) {
    console.error("Extraction route error:", error);
    res.status(500).json({ error: "Failed to extract blueprint from document: " + error.message });
  }
});

router.post("/resolve-discrepancies", async (req, res) => {
  try {
    const { draft, errors, referenceText } = req.body;
    if (!draft || !errors || typeof errors !== 'object') {
      return res.status(400).json({ error: "Missing required draft or errors object." });
    }

    const errorEntries = Object.entries(errors)
      .map(([field, msgs]) => `- ${field}: ${(Array.isArray(msgs) ? msgs : [msgs]).join('; ')}`)
      .join('\n');

    const existingTitle = draft.identity?.title || draft.title || '';
    const existingPremise = draft.globalPremise || draft.premise || '';
    const existingLocation = draft.setting?.location || '';
    const existingCast = (draft.cast || []).map((c: any) => c.name).filter(Boolean).join(', ');

    const isLocal = getEngineProvider() === 'local';
    const maxRefLength = isLocal ? 3500 : 15000;

    const errorKeys = Object.keys(errors).map((k) => k.toLowerCase());
    const needsTopology = errorKeys.some((k) => k.includes('topology') || k.includes('node'));
    const needsTitle = errorKeys.some((k) => k.includes('title') || k.includes('identity'));
    const needsPremise = errorKeys.some((k) => k.includes('premise'));
    const needsSetting = errorKeys.some((k) => k.includes('setting'));
    const needsDepiction = errorKeys.some((k) => k.includes('depiction'));
    const needsCast = errorKeys.some((k) => k.includes('cast') || k.includes('character'));
    const needsAntagonist = errorKeys.some((k) => k.includes('antagonist'));
    const needsVillain = Object.values(errors)
      .flat()
      .some((msg) => String(msg).toUpperCase().includes('VILLAIN'));

    const rules: string[] = [];
    if (needsTopology) {
      rules.push(`1. TOPOLOGY:
   Generate 4 to 6 connected atmospheric chambers in "topology":
   - "startingNodeId": ID of the primary entry or central chamber
   - "nodes": array of 4 to 6 IDs in snake_case (e.g. ["containment_airlock", "autopsy_theater", "histology_lab", "specimen_vault"])
   - "nodeDefinitions": array of objects with "id", "label", "name", "description" (sensory details, sounds, exits)
   - "connections": array of bidirectional connections linking ALL chambers together into a navigable floorplan:
     [{"from": "node_a", "to": "node_b", "label": "Heavy bulkhead door", "bidirectional": true}]`);
    }
    if (needsTitle) {
      rules.push(`2. TITLE: Generate an authentic, evocative title string in "title".`);
    }
    if (needsPremise) {
      rules.push(`3. PREMISE: Generate a 2-3 sentence horror premise in "premise".`);
    }
    if (needsSetting) {
      rules.push(`4. SETTING: Generate a "setting" object with "location" and "summary".`);
    }
    if (needsDepiction) {
      rules.push(`5. DEPICTION CONTRACT: Generate a "depictionContract" object with "dramaticRegister", "directness", "aftermath", "ambiguityHandling", "specialBoundaries".`);
    }
    if (needsVillain) {
      rules.push(`6. VILLAIN: The draft is missing its required villain. Generate EXACTLY ONE villain cast member representing the scenario's antagonist (from the reference material — e.g. a named entity, machine intelligence, or hostile overseer). It MUST have "disposition": "VILLAIN". Set "isEntity": true for non-human antagonists, false for human ones. Give it a proper id, name, role, description, personality, goals, and traits like any other cast member.`);
    }
    if (needsCast && (!needsVillain || !draft.cast || draft.cast.length === 0)) {
      rules.push(`7. CAST: Generate 2 to 3 distinct mortal characters in a "cast" array with "id", "name", "role", "description", "personality", "goals", "traits", "isEntity": false, "presenceDisposition".`);
    }
    if (needsAntagonist) {
      const knownNodeList = ((draft.topology?.nodeDefinitions || []).map((n: any) => n.id).concat(draft.topology?.nodes || [])).filter(Boolean);
      const nodeHint = knownNodeList.length > 0 ? ` (each telemetryFeed "nodeId" must reference valid topology node IDs: ${knownNodeList.slice(0, 5).join(', ')} or "all")` : '';
      rules.push(`8. ANTAGONIST: Generate an "antagonistProfile" with "kind", "name", "apparatusControls", "sadisticDirectives", and "telemetryFeeds"${nodeHint}.`);
    }

    const specificRules = rules.length > 0
      ? rules.join('\n\n')
      : 'Generate ONLY the missing fields corresponding to the discrepancies above.';

    const prompt = `You are the Forge Scenario Repair Architect for The Terror Machine.
The user is compiling a scenario Blueprint, but pre-flight validation detected the following specific validation discrepancies blocking export:

VALIDATION DISCREPANCIES TO RESOLVE:
${errorEntries}

EXISTING DRAFT CONTEXT:
- Title: ${existingTitle || '(missing)'}
- Premise: ${existingPremise || '(missing)'}
- Setting Location: ${existingLocation || '(missing)'}
- Existing Cast: ${existingCast || '(none)'}
- Existing Topology Nodes: ${(draft.topology?.nodeDefinitions || []).map((n: any) => n.id).join(', ') || (draft.topology?.nodes || []).join(', ') || '(none)'}

REFERENCE SOURCE MATERIAL:
${(referenceText || '').slice(0, maxRefLength) || 'No reference text provided. Infer from premise, setting, and cast.'}

TASK:
Review the reference material and generate ONLY the missing or invalid fields needed to resolve the discrepancies listed above.
Do NOT regenerate or modify fields that are already valid.

SPECIFIC FIELD GENERATION RULES:
${specificRules}

OUTPUT FORMAT:
Return a single valid JSON object containing ONLY the patch fields to merge.
Do NOT wrap in markdown fences if possible. Do NOT include conversational filler.`;

    const rawText = await executeForgePrompt(prompt, {
      responseMimeType: 'application/json',
    });

    const patch = parseOrRepairJson<Record<string, any>>(rawText);
    if (!patch || typeof patch !== 'object') {
      throw new Error("Model response could not be parsed as a JSON patch.");
    }

    // Sanitize title & identity
    if (patch.title && typeof patch.title === 'string' && patch.title.trim()) {
      const cleanTitle = patch.title.trim();
      patch.title = cleanTitle;
      patch.identity = {
        ...(patch.identity || {}),
        title: cleanTitle,
      };
    }

    // Sanitize premise & globalPremise
    if (patch.premise && typeof patch.premise === 'string' && patch.premise.trim()) {
      const cleanPremise = patch.premise.trim();
      patch.premise = cleanPremise;
      patch.globalPremise = cleanPremise;
    }

    // Sanitize topology if returned
    if (patch.topology) {
      if (Array.isArray(patch.topology.nodeDefinitions) && patch.topology.nodeDefinitions.length > 0) {
        patch.topology.nodeDefinitions = patch.topology.nodeDefinitions.map((n: any, idx: number) => {
          const label = (n.label || n.name || n.id || `Location ${idx + 1}`).trim();
          const id = (n.id || label.toLowerCase().replace(/[^a-z0-9]+/g, '_')).trim();
          const description = (n.description && n.description.trim())
            ? n.description.trim()
            : `Atmospheric environment of ${label}.`;
          const rest = { ...n };
          delete rest.sourceId;
          delete rest.evidenceIds;
          delete rest.provenance;
          return {
            ...rest,
            id,
            label,
            name: n.name || label,
            description,
          };
        });
        patch.topology.nodes = patch.topology.nodeDefinitions.map((n: any) => n.id).filter(Boolean);
      } else if (Array.isArray(patch.topology.nodes) && patch.topology.nodes.length > 0) {
        patch.topology.nodes = patch.topology.nodes
          .map((n: any) => (typeof n === 'string' ? n.trim() : (n.id || n.name || '')).trim())
          .filter(Boolean);
        patch.topology.nodeDefinitions = patch.topology.nodes.map((id: string) => ({
          id,
          label: id.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          name: id.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          description: `Atmospheric environment of ${id.replace(/_/g, ' ')}.`,
        }));
      }

      if (!patch.topology.startingNodeId && Array.isArray(patch.topology.nodes) && patch.topology.nodes.length > 0) {
        patch.topology.startingNodeId = patch.topology.nodes[0];
      }

      // Graph continuity & edge sanitization: ensure no orphan or disconnected nodes
      const nodeIds: string[] = patch.topology.nodes || [];
      const rawConnections = Array.isArray(patch.topology.connections) ? patch.topology.connections : [];
      const sanitizedConns: any[] = [];
      const connectedNodes = new Set<string>();

      for (const edge of rawConnections) {
        if (!edge || typeof edge !== 'object') continue;
        const from = (edge.from || edge.fromNodeId || '').trim();
        const to = (edge.to || edge.toNodeId || '').trim();
        if (from && to && from !== to) {
          sanitizedConns.push({
            from,
            to,
            kind: edge.kind || 'PHYSICAL',
            userInitiated: edge.userInitiated ?? true,
          });
          connectedNodes.add(from);
          connectedNodes.add(to);

          if (edge.bidirectional) {
            sanitizedConns.push({
              from: to,
              to: from,
              kind: edge.kind || 'PHYSICAL',
              userInitiated: edge.userInitiated ?? true,
            });
          }
        }
      }

      // Wire any orphan nodes to neighbors or primary
      if (nodeIds.length > 1) {
        for (let i = 0; i < nodeIds.length; i++) {
          const nid = nodeIds[i];
          if (!connectedNodes.has(nid)) {
            const neighbor = i > 0 ? nodeIds[i - 1] : nodeIds[1];
            sanitizedConns.push({
              from: nid,
              to: neighbor,
              kind: 'PHYSICAL',
              userInitiated: true,
            });
            sanitizedConns.push({
              from: neighbor,
              to: nid,
              kind: 'PHYSICAL',
              userInitiated: true,
            });
            connectedNodes.add(nid);
            connectedNodes.add(neighbor);
          }
        }
      }

      patch.topology.connections = sanitizedConns;
    }

    // Sanitize cast if returned
    if (Array.isArray(patch.cast) && patch.cast.length > 0) {
      patch.cast = patch.cast.map((c: any, idx: number) => ({
        id: c.id || `char_${idx + 1}`,
        name: c.name || `Character ${idx + 1}`,
        role: c.role || 'Survivor',
        disposition: c.disposition || (c.isEntity ? 'VILLAIN' : 'SURVIVOR'),
        description: c.description || 'A stressed survivor.',
        personality: c.personality || 'Cautious and determined.',
        goals: c.goals || 'Survive the containment breach.',
        traits: Array.isArray(c.traits) && c.traits.length > 0 ? c.traits : ['hypervigilant', 'methodical'],
        isEntity: Boolean(c.isEntity),
        isUserCharacter: false,
        presenceDisposition: c.presenceDisposition || { kind: 'OFFSTAGE' },
      }));
    }

    // Sanitize antagonistProfile if returned
    if (patch.antagonistProfile && typeof patch.antagonistProfile === 'object') {
      const availableNodes: string[] = (patch.topology?.nodes && patch.topology.nodes.length > 0)
        ? patch.topology.nodes
        : (draft.topology?.nodeDefinitions || []).map((n: any) => n.id).concat(draft.topology?.nodes || []);
      const validNodes = Array.from(new Set(availableNodes.filter(Boolean)));

      if (Array.isArray(patch.antagonistProfile.telemetryFeeds)) {
        patch.antagonistProfile.telemetryFeeds = patch.antagonistProfile.telemetryFeeds.map(
          (feed: any, idx: number) => {
            const label = typeof feed === 'string' ? feed : (feed.label || feed.name || `Sensor Feed ${idx + 1}`);
            const rawNode = typeof feed === 'object' && feed ? feed.nodeId : undefined;
            const assignedNode = (rawNode && (validNodes.includes(rawNode) || rawNode === 'all' || rawNode === '*'))
              ? rawNode
              : (validNodes.length > 0 ? validNodes[idx % validNodes.length] : 'all');
            return {
              nodeId: assignedNode,
              feedType: (typeof feed === 'object' && feed?.feedType) || 'OPTICAL_CAM',
              status: (typeof feed === 'object' && feed?.status) || 'ONLINE',
              label,
            };
          }
        );
      }
    }

    res.json({
      success: true,
      patch,
    });
  } catch (error: any) {
    console.error("Resolve discrepancies error:", error);
    res.status(500).json({ error: "Failed to resolve discrepancies: " + (error?.message || error) });
  }
});

export async function runSweepExecution(
  job: SweepJobLedger,
  sse: SseStream,
  lenses: SweepLens[] = ['COMBINED']
): Promise<void> {
  const sourceEntry = serverSourceRegistry.get(job.sourceBinding);
  if (!sourceEntry || !sourceEntry.normalizedText) {
    job.status = 'failed';
    sse.error('Source text not retained or expired', undefined, 'SOURCE_EXPIRED');
    return;
  }

  const windows = planSweepWindows(sourceEntry.normalizedText);
  job.totalWindows = windows.length * lenses.length;

  for (const lens of lenses) {
    for (const w of windows) {
      if (job.isCancelled) {
        sse.close();
        return;
      }

      sse.send('window_started', {
        jobId: job.jobId,
        windowIndex: w.windowIndex,
        windowCount: w.windowCount,
        totalWindows: job.totalWindows,
        lens,
        tokenRange: w.tokenRange,
        sourceRange: w.sourceRange,
      });

      const prompt = buildSweepPrompt(w, lens);

      let parsed: any = null;
      let rawText = '';
      let attempts = 0;

      while (attempts < 2 && !parsed) {
        attempts++;
        try {
          rawText = await executeForgePrompt(prompt, {
            responseMimeType: 'application/json',
          });
          parsed = parseOrRepairJson<Record<string, any>>(rawText);
        } catch (err) {
          console.warn(`[SWEEP ATTEMPT ${attempts} FAILED]`, err);
        }
      }

      if (!parsed || typeof parsed !== 'object') {
        sse.send('window_failed', {
          jobId: job.jobId,
          windowIndex: w.windowIndex,
          lens,
          error: 'Envelope parsing failed after model retry',
        });
        continue;
      }

      const now = Date.now();
      const rawEvidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
      const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];

      const evidenceList: any[] = [];
      for (let i = 0; i < rawEvidence.length; i++) {
        const ev = rawEvidence[i];
        if (ev && typeof ev === 'object') {
          const evId = ev.id || `ev-sweep-${now}-${w.windowIndex}-${i + 1}`;
          const sourceRange = resolveEvidenceSourceRange(w.text, w.sourceRange.start, ev.excerpt);
          evidenceList.push({
            id: evId,
            sourceId: sourceEntry.sourceId,
            category: typeof ev.category === 'string' ? ev.category : 'setting',
            claim: ev.claim || `Claim from window ${w.windowIndex + 1}`,
            excerpt: ev.excerpt || undefined,
            sourceRange,
          });
        }
      }

      const validEvidenceIds = evidenceList.map((e) => e.id);
      const fallbackEvidenceId = validEvidenceIds[0] || `ev-sweep-${now}-${w.windowIndex}-1`;
      if (evidenceList.length === 0) {
        evidenceList.push({
          id: fallbackEvidenceId,
          sourceId: sourceEntry.sourceId,
          category: 'setting',
          claim: `Forensic claim from ${sourceEntry.fileName}`,
          excerpt: w.text.slice(0, 100),
        });
        validEvidenceIds.push(fallbackEvidenceId);
      }

      const validCandidatesList: any[] = [];

      for (let i = 0; i < rawCandidates.length; i++) {
        const cand = rawCandidates[i];
        if (!cand || typeof cand !== 'object' || (!cand.target && !cand.label)) {
          job.quarantineRecords.push({
            reason: 'Malformed candidate object missing target and label',
            raw: cand,
          });
          job.quarantinedCandidates++;
          continue;
        }

        const target = cand.target || 'topology_node';
        const label = cand.label || cand.name || `Discovered Element ${w.windowIndex + 1}.${i + 1}`;
        const candId = cand.id || `cand-sweep-${now}-${w.windowIndex}-${i + 1}`;
        let proposedValue = cand.proposedValue;

        if (target === 'cast_seed' && typeof proposedValue === 'object' && proposedValue !== null) {
          proposedValue = {
            id: proposedValue.id || `char_sw_${w.windowIndex}_${i + 1}`,
            name: proposedValue.name || label,
            role: proposedValue.role || 'Secondary Cast',
            description: proposedValue.description || 'Discovered in forensic sweep.',
            personality: proposedValue.personality || 'Wary and distressed.',
            goals: proposedValue.goals || 'Survive and escape.',
            traits: Array.isArray(proposedValue.traits) && proposedValue.traits.length > 0 ? proposedValue.traits : ['observant', 'anxious'],
            disposition: ['SURVIVOR', 'VILLAIN', 'BYSTANDER'].includes(proposedValue.disposition) ? proposedValue.disposition : 'SURVIVOR',
            isEntity: Boolean(proposedValue.isEntity),
            isUserCharacter: false,
            behaviorVector: proposedValue.behaviorVector || 'DEFENSIVE_EVASION',
          };
        } else if (target === 'topology_node' && typeof proposedValue === 'object' && proposedValue !== null) {
          const nodeId = (proposedValue.id || label.toLowerCase().replace(/[^a-z0-9]+/g, '_')).trim();
          proposedValue = {
            id: nodeId,
            name: proposedValue.name || label,
            label: proposedValue.label || label,
            description: proposedValue.description || `Secondary chamber uncovered during forensic scan.`,
          };
        } else if (typeof proposedValue === 'string') {
          proposedValue = proposedValue.trim();
        }

        const candEvidenceIds = Array.isArray(cand.evidenceIds) && cand.evidenceIds.length > 0
          ? cand.evidenceIds.filter((eid: string) => validEvidenceIds.includes(eid))
          : [fallbackEvidenceId];

        const provenance: SweepProvenance = {
          extractionPass: 2,
          lens,
          windowIndex: w.windowIndex,
          windowCount: w.windowCount,
          tokenRange: w.tokenRange,
          sourceRange: w.sourceRange,
          provider: job.modelConfig.provider,
          modelId: job.modelConfig.modelId,
        };

        const validatedCand = {
          id: candId,
          sourceId: sourceEntry.sourceId,
          classification: cand.classification === 'evidence' ? 'evidence' : 'inference',
          target,
          label,
          explanation: cand.explanation || `Unearthed in forensic sweep over ${sourceEntry.fileName}.`,
          evidenceIds: candEvidenceIds.length > 0 ? candEvidenceIds : [fallbackEvidenceId],
          proposedValue,
          extractionPass: 2,
          extractionProvenance: provenance,
          occurrences: 1,
          reviewDecision: 'accepted',
          applicationState: 'staged',
        };

        validCandidatesList.push(validatedCand);
        job.discoveredCandidates++;

        sse.send('candidate_discovered', {
          jobId: job.jobId,
          candidate: validatedCand,
        });
      }

      if (validCandidatesList.length > 0 || evidenceList.length > 0) {
        sse.send('candidates_discovered', {
          jobId: job.jobId,
          candidates: validCandidatesList,
          evidence: evidenceList,
        });
      }

      job.completedWindows++;
      sse.send('window_completed', {
        jobId: job.jobId,
        windowIndex: w.windowIndex,
        windowCount: w.windowCount,
        completedWindows: job.completedWindows,
        totalWindows: job.totalWindows,
        discoveredCandidates: job.discoveredCandidates,
        quarantinedCandidates: job.quarantinedCandidates,
      });
    }
  }

  job.status = 'complete';
  if (sourceEntry) {
    sourceEntry.pinnedJobId = undefined;
  }

  sse.send('job_complete', {
    jobId: job.jobId,
    status: 'complete',
    totalWindows: job.totalWindows,
    completedWindows: job.completedWindows,
    discoveredCandidates: job.discoveredCandidates,
    quarantinedCandidates: job.quarantinedCandidates,
  });
  sse.complete({
    jobId: job.jobId,
    status: 'complete',
    totalWindows: job.totalWindows,
    completedWindows: job.completedWindows,
    discoveredCandidates: job.discoveredCandidates,
    quarantinedCandidates: job.quarantinedCandidates,
  });
}

// 1. Queue Sweep Job
router.post('/extract-sweep', async (req, res) => {
  try {
    const parseRes = SweepJobRequestSchema.safeParse(req.body);
    if (!parseRes.success) {
      return res.status(400).json({ error: 'Invalid sweep job request', details: parseRes.error.format() });
    }
    const { sourceBinding, lenses } = parseRes.data;

    sweepExpiredServerSourceBindings();
    const sourceEntry = serverSourceRegistry.get(sourceBinding);

    if (!sourceEntry || !sourceEntry.normalizedText) {
      return res.status(404).json({ error: 'Source text not retained or expired' });
    }

    const modelConfig: PinnedModelConfig = {
      provider: getEngineProvider(),
      modelId: getEngineProvider() === 'local' ? getLocalForgeModel() : 'active-model',
    };

    const requestedLenses = lenses && lenses.length > 0 ? lenses : ['COMBINED' as SweepLens];
    const windows = planSweepWindows(sourceEntry.normalizedText);
    const job = createSweepJob(
      sourceBinding,
      sourceEntry.contentDigest,
      windows.length * requestedLenses.length,
      modelConfig
    );
    sourceEntry.pinnedJobId = job.jobId;

    res.json({
      jobId: job.jobId,
      statusUrl: `/api/extract-sweep/${job.jobId}/status`,
      streamUrl: `/api/extract-sweep/${job.jobId}/events`,
    });
  } catch (error: any) {
    console.error('Sweep queue error:', error);
    res.status(500).json({ error: 'Failed to queue sweep: ' + (error?.message || error) });
  }
});

// 2. Stream Job Events via SSE
router.get('/extract-sweep/:jobId/events', (req, res) => {
  const job = getSweepJob(req.params.jobId);
  if (!job) {
    return res.status(404).end();
  }

  const sse = new SseStream(res);
  req.on('close', () => sse.close());

  if (job.status === 'queued') {
    job.status = 'running';
    runSweepExecution(job, sse).catch((err) => {
      console.error('Sweep execution error:', err);
      job.status = 'failed';
      sse.error(err?.message || 'Sweep execution error');
    });
  }
});

// 3. Status Snapshot
router.get('/extract-sweep/:jobId/status', (req, res) => {
  const job = getSweepJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// 4. Cooperative Cancellation
router.post('/extract-sweep/:jobId/cancel', (req, res) => {
  const cancelled = cancelSweepJob(req.params.jobId);
  if (!cancelled) {
    return res.status(400).json({ error: 'Cannot cancel job' });
  }

  const job = getSweepJob(req.params.jobId);
  if (job) {
    const entry = serverSourceRegistry.get(job.sourceBinding);
    if (entry) {
      entry.pinnedJobId = undefined;
    }
  }

  res.json({ status: 'cancelled' });
});

router.post('/extract-questionnaire', async (req, res) => {
  const parseRes = z.object({
    sourceText: z.string().trim().min(1, 'sourceText is required.'),
    families: z.array(z.string()).optional(),
  }).safeParse(req.body);
  if (!parseRes.success) {
    return res.status(400).json({ success: false, error: 'sourceText is required.' });
  }
  try {
    const stage1 = await runStage1(parseRes.data.sourceText, { families: parseRes.data.families });
    const result = await runStage2(stage1);
    const violations = validateQuestionnaireResults(result);
    return res.json({
      success: true,
      stage1Responses: result.stage1Responses,
      compiledCandidates: result.compiledCandidates,
      failedBatteries: result.failedBatteries,
      violations,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Questionnaire extraction failed.' });
  }
});

export default router;

