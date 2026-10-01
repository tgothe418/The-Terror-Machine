import { z } from "zod";
import type { Stage1Response } from './extractionPipeline';
import { executeForgePromptWithMeta } from './forgeProvider';
import { assertWorldStatePromptBudget } from '../../src/lib/worldPredicates';
import {
  TopologyNodeCandidateSchema,
  TopologyConnectionCandidateSchema,
  CastSeedCandidateSchema,
} from '../../src/types/forge';
import { RestraintLevelSchema } from '../../src/types/worldState';

const TopologyCompileSchema = z.object({
  nodes: z.array(TopologyNodeCandidateSchema),
  connections: z.array(TopologyConnectionCandidateSchema),
});

const SeedCompileSchema = z.object({
  seeds: z.array(CastSeedCandidateSchema),
});

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
- proposedValue MUST have: name (character name), isUserCharacter (false; the Forge marks the true user character at review), seed (object).
- seed.where: the location name exactly as it appears in the source. Do not invent node ids.
- seed.doing: object with mode ("ACTIVE" for an ongoing activity, "SUSPENDED" for an interrupted or frozen one), routineStep (the action as written in the source; omit if none), verb (ACTIVE only: one of FLEE, INVESTIGATE, CLOSE_IN, HIDE, FORTIFY, TRAP, PICK_LOCK; omit for SUSPENDED), oneShot ({ label } only for a SUSPENDED one-shot action that exists nowhere else; omit otherwise).
- seed.condition: { restraint: { level (one of UNRESTRAINED, WRISTS_BOUND_FRONT, WRISTS_BOUND_BEHIND, TIED_TO_FIXTURE, FULL_HOGTIE), boundByCharacterId (name as in source; omit if none), tiedToNodeId (location as in source; omit if none) } } or an empty object {} when no restraint.
- seed.charge: { band (exactly one of: calm, Mild Tension, Acute Fear, Severe Panic, Breaking Point), threatType (one of life, freedom, identity; omit if none applies) }.
- seed.knows: array of { id ("SEED-knows-<n>"), text }. Empty array when nothing is known.
- seed.wants: { kind ("pursuit" for an action about to be taken, "state" for a condition wanted), text, groundedIn (array of this character's own knows ids) }. Every "pursuit" kind MUST list at least one knows id from the same character in groundedIn.
- seed.bonds: array of { characterId (name as in source), stance (trust, distrust, or unsure), note (omit if none) }.
- Omit circumstance and inclination. The Forge assigns those at review.`;
}

async function callStage2(prompt: string): Promise<string> {
  const opts = { responseMimeType: 'application/json' };
  const first = await executeForgePromptWithMeta(prompt, opts);
  if (first.finish_reason !== 'length') return first.text;
  const second = await executeForgePromptWithMeta(prompt, opts);
  if (second.finish_reason === 'length') {
    throw new Error('Forge extraction Stage 2 truncated on length after one retry; shorten the source text or raise the output budget.');
  }
  return second.text;
}

export async function compileSeedBattery(
  family: string,
  responses: Stage1Response[]
): Promise<unknown> {
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  const raw = await callStage2(buildStage2SeedPrompt(family, responses));
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
    const key = (s.targetCastMemberId || '').toLowerCase();
    if (seen.has(key)) {
      throw new Error(`[DUPLICATE SEED] Multiple seed candidates for character "${s.targetCastMemberId}".`);
    }
    seen.add(key);
  }
  assertWorldStatePromptBudget(JSON.stringify(validated));
  return validated;
}

export async function compileBattery(
  family: string,
  responses: Stage1Response[],
  _compileTarget: string
): Promise<unknown> {
  void _compileTarget;
  for (const r of responses) {
    const hasCitations = r.citations && r.citations.some((c) => Boolean(c && c.trim().length > 0));
    if (!hasCitations) {
      throw new Error(`[CITATION REQUIRED] Question "${r.question}" has no excerpt citations.`);
    }
  }
  if (family === 'SEED') {
    return compileSeedBattery(family, responses);
  }
  if (family !== 'TOPOLOGY') {
    throw new Error(`[UNSUPPORTED BATTERY] Compilation for ${family} not yet implemented.`);
  }
  const raw = await callStage2(buildStage2Prompt(family, responses));
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
