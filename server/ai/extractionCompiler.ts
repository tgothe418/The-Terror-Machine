import { z } from "zod";
import type { Stage1Response, ExtractionMetaListener } from './extractionPipeline';
import { executeForgePromptWithMeta } from './forgeProvider';
import { assertWorldStatePromptBudget } from '../../src/lib/worldPredicates';
import {
  TopologyNodeCandidateSchema,
  TopologyConnectionCandidateSchema,
  CastSeedCandidateSchema,
  CastExpressionCandidateSchema,
  AntagonistProfileCandidateSchema,
  ValueAnchorCandidateSchema,
  PremiseCandidateSchema,
  EnvironmentalRuleCandidateSchema,
  NarrativeRuleCandidateSchema,
  DepictionContractCandidateSchema,
} from '../../src/types/forge';
import { RestraintLevelSchema } from '../../src/types/worldState';
import { DramaticSpineSchema } from '../../src/types/dramaturgy';

const TopologyCompileSchema = z.object({
  nodes: z.array(TopologyNodeCandidateSchema),
  connections: z.array(TopologyConnectionCandidateSchema),
});

const SeedCompileSchema = z.object({
  seeds: z.array(CastSeedCandidateSchema),
});

export const PressureElicitationSchema = z.object({
  powerBudget: z.string().min(1),
  powerLimits: z.string().min(1),
  deathMetaphysics: z.enum(['mundane', 'zombie', 'cosmic', 'unknown']),
  successionPolicies: z.string().optional(),
  fearParameters: z.object({
    fearlessnessThresholds: z.string().optional(),
    threatVectorWeights: z
      .object({
        life: z.number().default(1.0),
        freedom: z.number().default(1.0),
        identity: z.number().default(1.0),
      })
      .optional(),
    releaseValves: z.array(z.string()).default([]),
    gazeAuthority: z.string().optional(),
    submitResponses: z.string().optional(),
  }),
  unknowns: z.array(z.string()).default([]),
});
export type PressureElicitation = z.infer<typeof PressureElicitationSchema>;

export function buildStage2Prompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are compiling question-and-answer extraction notes into structured candidates for a horror scenario forge.
Family: ${family}

Questions and answers:
---
${qa}
---

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- The object MUST have exactly two keys: "nodes" and "connections".
- Each entry in "nodes" MUST be a candidate object with: id (string), sourceId (string), classification ("evidence" or "inference"), label (string), explanation (string), evidenceIds (array of strings), target (exactly "topology_node"), proposedValue ({ id, label, name, description }).
- Each entry in "connections" MUST be a candidate object with: id (string), sourceId (string), classification ("evidence" or "inference"), label (string), explanation (string), evidenceIds (array of strings), target (exactly "topology_connection"), proposedValue ({ from, to, kind, requires, userInitiated }).
- Generate stable ids as "<family>-<kind>-<n>" (e.g. "TOPOLOGY-node-1").`;
}

export function buildStage2SeedPrompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are compiling question-and-answer extraction notes into per-character opening-seed candidates for a horror scenario forge.
Family: ${family}

Questions and answers:
---
${qa}
---

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- The object MUST have exactly one key: "seeds".
- "seeds" is an array with one entry per named character in the source. No duplicate characters.
- Each entry MUST be a candidate object with: id (string, format "SEED-seed-<n>"), sourceId (string, the source document id or "source"), classification ("evidence" or "inference"), label (string), explanation (string), evidenceIds (array of strings), target (exactly "cast_seed"), targetCastMemberId (the character's name exactly as it appears in the source), proposedValue (object).
- proposedValue MUST have: name (character name), description (what they look like right now / how they behave under stress), personality (their disposition and demeanor), goals (what they want most), traits (array of strings representing key traits), disposition (exactly one of: "SURVIVOR", "VILLAIN", "BYSTANDER"), isUserCharacter (false; the Forge marks the true user character at review), seed (object).
- seed.where: the location name exactly as it appears in the source. Do not invent node ids.
- seed.doing: object with mode ("ACTIVE" for an ongoing activity, "SUSPENDED" for an interrupted or frozen one), routineStep (the action as written in the source; omit if none), verb (ACTIVE only: one of FLEE, INVESTIGATE, CLOSE_IN, HIDE, FORTIFY, TRAP, PICK_LOCK; omit for SUSPENDED), oneShot ({ label } only for a SUSPENDED one-shot action that exists nowhere else; omit otherwise).
- seed.condition: { restraint: { level (one of UNRESTRAINED, WRISTS_BOUND_FRONT, WRISTS_BOUND_BEHIND, TIED_TO_FIXTURE, FULL_HOGTIE), boundByCharacterId (name as in source; omit if none), tiedToNodeId (location as in source; omit if none) } } or an empty object {} when no restraint.
- seed.charge: { band (exactly one of: calm, Mild Tension, Acute Fear, Severe Panic, Breaking Point), threatType (one of life, freedom, identity; omit if none applies) }.
- seed.knows: array of { id ("SEED-knows-<n>"), text }. Empty array when nothing is known.
- seed.wants: { kind ("pursuit" for an action about to be taken, "state" for a condition wanted), text, groundedIn (array of this character's own knows ids) }. Every "pursuit" kind MUST list at least one knows id from the same character in groundedIn.
- seed.bonds: array of { characterId (name as in source), stance (trust, distrust, or unsure), note (omit if none) }.
- Omit circumstance and inclination. The Forge assigns those at review.`;
}

export function buildStage2ExpressionPrompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are compiling question-and-answer extraction notes into character expression guidance candidates for a horror scenario forge.
Family: ${family}

Questions and answers:
---
${qa}
---

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- The object MUST have exactly one key: "expressionGuidance".
- Each entry MUST be a candidate object with: id (string, format "SEED-expr-<n>"), sourceId (string), classification ("evidence" or "inference"), label (string), explanation (string), evidenceIds (array of strings), target (exactly "cast_expression_guidance"), targetCastMemberId (the character's name exactly as it appears in the source), proposedValue (the character's expression profile object).`;
}

export function buildStage2VillainPrompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are compiling question-and-answer extraction notes into an antagonist profile candidate for a horror scenario forge.
Family: ${family}

Questions and answers:
---
${qa}
---

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- Output format: { "profiles": [...], "villainProtagonist": boolean }.
- "profiles" MUST contain 1 to 3 entries — one per distinct villain/antagonist in the source (R10 caps at 3).
- Each entry MUST be a candidate object with: id ("VILLAIN-profile-<n>"), sourceId (string), classification ("evidence" or "inference"), label (string), explanation (string), evidenceIds (array of strings), target (exactly "antagonist_profile"), proposedValue ({ name, kind (one of FORCE, APPARATUS, ENTITY), plus any other antagonist fields }).
- "villainProtagonist": true if the Q&A answers yes to first-person predator narration, else false.`;
}

export function buildStage2RelationshipsPrompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are compiling question-and-answer extraction notes into relationship value anchor candidates for a horror scenario forge.
Family: ${family}

Questions and answers:
---
${qa}
---

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- The object MUST have exactly one key: "anchors".
- Each entry MUST be a candidate object with: id ("RELATIONSHIPS-anchor-<n>"), sourceId (string), classification ("evidence" or "inference"), label (string), explanation (string), evidenceIds (array of strings), target (exactly "value_anchor"), proposedValue ({ id, holder ({ kind, ... }), label, description, basisSummary, provenance }).`;
}

export function buildStage2PressureRulesPrompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are compiling question-and-answer extraction notes into pressure and narrative rule candidates for a horror scenario forge.
Family: ${family}

Questions and answers:
---
${qa}
---

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- The object MUST have exactly one key: "rules".
- Each entry MUST be a candidate object with: id ("PRESSURE-rule-<n>"), sourceId (string), classification ("evidence" or "inference"), label (string), explanation (string), evidenceIds (array of strings), target (exactly one of "premise", "environmental_rule", "narrative_rule"), proposedValue (string).`;
}

export function buildStage2PressureElicitationPrompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are extracting structured pressure elicitation parameters from question-and-answer notes for a horror scenario forge.
Family: ${family}

Questions and answers:
---
${qa}
---

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- Output matching the elicitation shape: powerBudget (string), powerLimits (string), deathMetaphysics (one of mundane, zombie, cosmic, unknown), successionPolicies (string, omit if not elicited), fearParameters ({ fearlessnessThresholds, threatVectorWeights ({ life, freedom, identity } numbers), releaseValves (array of strings), gazeAuthority, submitResponses }), unknowns (array of strings).
- Elicit from the Q&A only. Where the Q&A is silent or ambiguous, put an entry in unknowns describing what is unknown. Do not invent canon.`;
}

export function buildStage2DepictionPrompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are compiling question-and-answer extraction notes into a depiction contract candidate for a horror scenario forge.
Family: ${family}

Questions and answers:
---
${qa}
---

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- The object MUST have exactly one key: "contract".
- The contract MUST be a candidate object with: id ("DEPICTION-contract-1"), sourceId (string), classification ("evidence" or "inference"), label (string), explanation (string), evidenceIds (1-12 entries), target (exactly "depiction_contract"), proposedValue ({ dramaticRegister, directness, aftermath, ambiguityHandling, specialBoundaries }).`;
}

export function buildStage2SpinePrompt(family: string, responses: Stage1Response[]): string {
  const qa = responses
    .map((r) => `Q: ${r.question}\nA: ${r.answer}\nCitations: ${r.citations.map((c) => `"${c}"`).join('; ') || '(none)'}`)
    .join('\n\n');
  return `You are compiling question-and-answer extraction notes into a dramatic spine candidate for a horror scenario forge.
Family: ${family}

Questions and answers:
----
${qa}
----

Instructions:
- Output a single raw JSON object, no markdown fences, no explanations.
- The object MUST have exactly one key: "spine".
- "spine" MUST be an object with:
  - "dramaticQuestions": array of 1-3 strings, the story's central dramatic questions.
  - "pacingProfile": exactly one of SLOW_BURN_DREAD, RELENTLESS_PURSUIT, GOTHIC_PSYCHOLOGICAL, BALANCED_HORROR.
  - "milestoneConditions": array of 2-4 objects. Each MUST have:
    - "id": "milestone-1", "milestone-2", etc.
    - "targetPhase": exactly one of INCITING_RUPTURE, COMPLICATION_ENCLOSURE, MIDPOINT_CRISIS, ESCALATING_VISE, CLIMACTIC_CONFRONTATION, AFTERMATH_DENOUEMENT. NEVER EXPOSITION_BASELINE. Use at least two distinct phases across the array, in escalating story order.
    - "description": string.
    - "kind": exactly one of DISCOVERY, CLOCK_CRISIS, COMPOSURE_THRESHOLD, AUTHORED_TRIGGER.
    - "referenceId": string, with per-kind rules:
      - CLOCK_CRISIS: MUST equal the "id" of one entry in this payload's "impendingClocks". At least one milestone MUST be kind CLOCK_CRISIS.
      - AUTHORED_TRIGGER: a case-insensitive regex pattern matched against ratified consequence text (example: "blood|wound|stabbed"). MUST be a valid regex.
      - DISCOVERY: the clue or evidence label exactly as named in the answers.
      - COMPOSURE_THRESHOLD: the character's full name exactly as named in the answers, plus "thresholdValue" (number 0-100).
    - "satisfied": false.
  - "impendingClocks": array of 1-3 objects. Each MUST have:
    - "id": "clock-<slug>", lowercase letters and hyphens only.
    - "name": string.
    - "domain": exactly one of ENVIRONMENTAL, SOMATIC, BEHAVIORAL, STRUCTURAL.
    - "currentLevel": 0.
    - "advanceMode": either {"mode": "TIME", "rate": one of SLOW, MODERATE, RAPID, "minutesPerPoint": positive number} or {"mode": "EVENT", "consequencePatterns": array of 1+ strings, "pointsPerEvent": positive number}.
    - "crisisThreshold": number 0-100 (default 80).
    - "manifestationCues": array of 1-3 objects {"atLevel": number 0-100, "cue": string}.
- "thematicPremise": optional string, may be included.`;
}

async function callStage2(
  prompt: string,
  meta?: { family: string },
  listener?: ExtractionMetaListener
): Promise<string> {
  const opts = { responseMimeType: 'application/json' };
  const first = await executeForgePromptWithMeta(prompt, opts);
  if (listener && meta) {
    try {
      listener({
        stage: 2,
        family: meta.family,
        attempt: 1,
        finish_reason: first.finish_reason,
      });
    } catch {
      // Listener errors must never break extraction
    }
  }
  if (first.finish_reason !== 'length') return first.text;
  const second = await executeForgePromptWithMeta(prompt, opts);
  if (listener && meta) {
    try {
      listener({
        stage: 2,
        family: meta.family,
        attempt: 2,
        finish_reason: second.finish_reason,
      });
    } catch {
      // Listener errors must never break extraction
    }
  }
  if (second.finish_reason === 'length') {
    throw new Error('Forge extraction Stage 2 truncated on length after one retry; shorten the source text or raise the output budget.');
  }
  return second.text;
}

export async function compileSeedBattery(
  family: string,
  responses: Stage1Response[],
  listener?: ExtractionMetaListener
): Promise<unknown> {
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  const raw = await callStage2(buildStage2SeedPrompt(family, responses), { family }, listener);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  const validated = SeedCompileSchema.parse(parsed);
  for (const s of validated.seeds) {
    const pv = s.proposedValue as {
      name?: string;
      seed?: {
        condition?: { restraint?: { level?: string } };
        knows?: Array<{ id: string }>;
        wants?: { kind?: string; groundedIn?: string[] };
      };
    };
    const charName = pv.name || s.targetCastMemberId || 'unknown';
    const level = pv.seed?.condition?.restraint?.level;
    if (level !== undefined && !RestraintLevelSchema.safeParse(level).success) {
      throw new Error(`[INVALID RESTRAINT] Character "${charName}" has unknown restraint level "${level}".`);
    }
    const knowsIds = new Set((pv.seed?.knows || []).map((k) => k.id));
    const wants = pv.seed?.wants;
    if (wants?.kind === 'pursuit') {
      const cited = wants.groundedIn || [];
      const unresolvable = cited.filter((c) => !knowsIds.has(c));
      if (cited.length === 0 || unresolvable.length > 0) {
        throw new Error(
          `[GROUNDING REQUIRED] Character "${charName}" pursuit want cites no resolvable knows id.`
        );
      }
    }
  }
  const seen = new Set<string>();
  for (const s of validated.seeds) {
    const pv = s.proposedValue as { name?: string };
    const charName = (s.targetCastMemberId || pv?.name || '').trim();
    const key = charName.toLowerCase();
    if (key.length > 0 && seen.has(key)) {
      throw new Error(`[DUPLICATE SEED] Multiple seed candidates for character "${charName}".`);
    }
    if (key.length > 0) {
      seen.add(key);
    }
  }

  const rawExpr = await callStage2(buildStage2ExpressionPrompt(family, responses), { family }, listener);
  let parsedExpr: unknown;
  try {
    parsedExpr = JSON.parse(rawExpr);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  const validatedExpr = z.object({
    expressionGuidance: z.array(CastExpressionCandidateSchema),
  }).parse(parsedExpr);

  const result = {
    seeds: validated.seeds,
    expressionGuidance: validatedExpr.expressionGuidance,
  };
  assertWorldStatePromptBudget(JSON.stringify(result));
  return result;
}

export async function compileVillainBattery(
  family: string,
  responses: Stage1Response[],
  listener?: ExtractionMetaListener
): Promise<unknown> {
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  const raw = await callStage2(buildStage2VillainPrompt(family, responses), { family }, listener);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as Record<string, unknown>).profiles) ||
    (parsed as { profiles: unknown[] }).profiles.length < 1 ||
    (parsed as { profiles: unknown[] }).profiles.length > 3
  ) {
    throw new Error('[VILLAIN COUNT] VILLAIN battery must produce 1-3 antagonist profiles (R10).');
  }
  if (typeof (parsed as Record<string, unknown>).villainProtagonist !== 'boolean') {
    throw new Error('[VILLAIN FLAG] villainProtagonist must be a boolean.');
  }
  const validatedProfiles = z
    .array(AntagonistProfileCandidateSchema)
    .parse((parsed as { profiles: unknown[] }).profiles);
  // Primary antagonist carries the villainProtagonist flag
  (validatedProfiles[0].proposedValue as Record<string, unknown>).villainProtagonist = (
    parsed as { villainProtagonist: boolean }
  ).villainProtagonist;
  assertWorldStatePromptBudget(JSON.stringify({ profiles: validatedProfiles }));
  return { profiles: validatedProfiles };
}

export async function compileRelationshipsBattery(
  family: string,
  responses: Stage1Response[],
  listener?: ExtractionMetaListener
): Promise<unknown> {
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  const raw = await callStage2(buildStage2RelationshipsPrompt(family, responses), { family }, listener);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  const validated = z.object({ anchors: z.array(ValueAnchorCandidateSchema) }).parse(parsed);
  assertWorldStatePromptBudget(JSON.stringify(validated));
  return { anchors: validated.anchors };
}

export async function compilePressureBattery(
  family: string,
  responses: Stage1Response[],
  listener?: ExtractionMetaListener
): Promise<unknown> {
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  const rawRules = await callStage2(buildStage2PressureRulesPrompt(family, responses), { family }, listener);
  let parsedRules: unknown;
  try {
    parsedRules = JSON.parse(rawRules);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  const validatedRules = z
    .object({
      rules: z.array(
        z.union([
          PremiseCandidateSchema,
          EnvironmentalRuleCandidateSchema,
          NarrativeRuleCandidateSchema,
        ])
      ),
    })
    .parse(parsedRules);

  const rawElicitation = await callStage2(buildStage2PressureElicitationPrompt(family, responses), { family }, listener);
  let parsedElicitation: unknown;
  try {
    parsedElicitation = JSON.parse(rawElicitation);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  const validatedElicitation = PressureElicitationSchema.parse(parsedElicitation);

  const result = {
    rules: validatedRules.rules,
    elicitation: validatedElicitation,
  };
  assertWorldStatePromptBudget(JSON.stringify(result));
  return result;
}

export async function compileDepictionBattery(
  family: string,
  responses: Stage1Response[],
  listener?: ExtractionMetaListener
): Promise<unknown> {
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  const raw = await callStage2(buildStage2DepictionPrompt(family, responses), { family }, listener);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  const validated = z
    .object({ contract: DepictionContractCandidateSchema })
    .strict()
    .parse(parsed);
  assertWorldStatePromptBudget(JSON.stringify(validated));
  return { contract: validated.contract };
}

export async function compileSpineBattery(
  family: string,
  responses: Stage1Response[],
  listener?: ExtractionMetaListener
): Promise<unknown> {
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  const raw = await callStage2(buildStage2SpinePrompt(family, responses), { family }, listener);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  const validated = z
    .object({ spine: DramaticSpineSchema })
    .strict()
    .parse(parsed);
  assertWorldStatePromptBudget(JSON.stringify(validated));
  return validated;
}

export async function compileBattery(
  family: string,
  responses: Stage1Response[],
  compileTargetOrListener?: string | ExtractionMetaListener,
  listenerArg?: ExtractionMetaListener
): Promise<unknown> {
  const listener = typeof compileTargetOrListener === 'function' ? compileTargetOrListener : listenerArg;
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  if (family === 'SEED') return compileSeedBattery(family, responses, listener);
  if (family === 'VILLAIN') return compileVillainBattery(family, responses, listener);
  if (family === 'RELATIONSHIPS') return compileRelationshipsBattery(family, responses, listener);
  if (family === 'PRESSURE') return compilePressureBattery(family, responses, listener);
  if (family === 'DEPICTION') return compileDepictionBattery(family, responses, listener);
  if (family === 'SPINE') return compileSpineBattery(family, responses, listener);
  if (family !== 'TOPOLOGY') {
    throw new Error(`[UNSUPPORTED BATTERY] Compilation for ${family} not yet implemented.`);
  }
  const raw = await callStage2(buildStage2Prompt(family, responses), { family }, listener);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('[COMPILE PARSE] Stage 2 did not return valid JSON.');
  }
  const validated = TopologyCompileSchema.parse(parsed);
  assertWorldStatePromptBudget(JSON.stringify(validated));
  return validated;
}

