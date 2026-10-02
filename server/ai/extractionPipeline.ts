import { EXTRACTION_BATTERIES } from './extractionBatteries';
import { compileBattery } from './extractionCompiler';
import { executeForgePromptWithMeta } from './forgeProvider';

export interface Stage1Response {
  family: string;
  questionIndex: number;
  question: string;
  answer: string;
  citations: string[];
}

export interface PipelineResult {
  stage1Responses: Stage1Response[];
  compiledCandidates: Record<string, unknown>;
  failedBatteries: string[];
}

const CITATION_RE = /^CITE:\s*"((?:[^"\\]|\\.)*)"/gm;

export function buildStage1Prompt(sourceText: string, family: string, question: string): string {
  return `You are extracting structured facts from a source document for a horror scenario forge.
Family: ${family}

Source document:
---
${sourceText}
---

Question: ${question}

Instructions:
- Answer in plain prose. No JSON, no markdown fences.
- Every factual claim in your answer MUST be supported by at least one citation line.
- Citation format: a line starting with CITE: followed by the exact quoted span from the source document, for example:
CITE: "the north door was barred from the inside"
- If the source document does not contain the answer, say so explicitly and cite nothing.`;
}

export function extractCitations(text: string): { answer: string; citations: string[] } {
  const normalized = text.replace(/\r\n/g, '\n');
  const citations: string[] = [];
  const regex = new RegExp(CITATION_RE.source, CITATION_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = regex.exec(normalized)) !== null) {
    if (m[1].trim().length > 0) {
      citations.push(m[1]);
    }
  }
  const answer = normalized
    .replace(/^CITE:\s*"((?:[^"\\]|\\.)*)"[ \t]*$/gm, '')
    .replace(regex, '')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { answer, citations };
}

async function callStage1(prompt: string): Promise<string> {
  const first = await executeForgePromptWithMeta(prompt);
  if (first.finish_reason !== 'length') return first.text;
  const second = await executeForgePromptWithMeta(prompt);
  if (second.finish_reason === 'length') {
    throw new Error('Forge extraction Stage 1 truncated on length after one retry; shorten the source text or raise the output budget.');
  }
  return second.text;
}

export async function runStage1(
  sourceText: string,
  opts: { families?: string[] } = {}
): Promise<Stage1Response[]> {
  const batteries = opts.families && opts.families.length > 0
    ? EXTRACTION_BATTERIES.filter((b) => opts.families!.includes(b.family))
    : EXTRACTION_BATTERIES;
  const out: Stage1Response[] = [];
  for (const battery of batteries) {
    for (let questionIndex = 0; questionIndex < battery.questions.length; questionIndex++) {
      const question = battery.questions[questionIndex];
      const prompt = buildStage1Prompt(sourceText, battery.family, question);
      const text = await callStage1(prompt);
      const { answer, citations } = extractCitations(text);
      out.push({ family: battery.family, questionIndex, question, answer, citations });
    }
  }
  return out;
}

export async function runStage2(stage1Responses: Stage1Response[]): Promise<PipelineResult> {
  const compiled: Record<string, unknown> = {};
  const failed: string[] = [];
  const families = [...new Set(stage1Responses.map((r) => r.family))].sort();
  for (const family of families) {
    try {
      const battery = EXTRACTION_BATTERIES.find((b) => b.family === family);
      if (!battery) throw new Error(`[UNSUPPORTED BATTERY] No battery definition for ${family}.`);
      if (battery.stage1Only) continue;
      const responses = stage1Responses
        .filter((r) => r.family === family)
        .sort((a, b) => a.questionIndex - b.questionIndex);
      compiled[battery.compileTarget] = await compileBattery(family, responses, battery.compileTarget);
    } catch {
      failed.push(family);
    }
  }
  return { stage1Responses, compiledCandidates: compiled, failedBatteries: failed };
}
