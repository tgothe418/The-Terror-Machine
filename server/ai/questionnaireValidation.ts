import { EXTRACTION_BATTERIES } from './extractionBatteries';
import type { PipelineResult } from './extractionPipeline';

export interface QuestionnaireViolation {
  family: string;
  question: string;
  reason: string;
}

export interface FamilyRequirement {
  family: string;
  target: string;
  min: number;
  max: number;
  questionIndex: number;
  predicate?: (c: Record<string, unknown>) => boolean;
  predicateNote?: string;
}

export const REQUIREMENTS: FamilyRequirement[] = [
  { family: 'TOPOLOGY', target: 'topology_node', min: 1, max: Infinity, questionIndex: 0 },
  { family: 'SEED', target: 'cast_seed', min: 1, max: Infinity, questionIndex: 7 },
  {
    family: 'SEED',
    target: 'cast_seed',
    min: 1,
    max: Infinity,
    questionIndex: 7,
    predicate: (c) => (c.proposedValue as { disposition?: string } | undefined)?.disposition === 'VILLAIN',
    predicateNote: 'with disposition VILLAIN (§4b)',
  },
  { family: 'VILLAIN', target: 'antagonist_profile', min: 1, max: 3, questionIndex: 0 },
  { family: 'DEPICTION', target: 'depiction_contract', min: 1, max: 1, questionIndex: 0 },
  { family: 'PRESSURE', target: 'premise', min: 1, max: Infinity, questionIndex: 0 },
];

export const EVASIVE_RE =
  /\b(source|document|text|material)\b[^.?!]{0,80}\bdoes?\s+not\s+(contain|mention|describe|state|say|include|provide)\b/i;

// Flatten the known Stage 2 output shapes into a single candidate list.
// Shapes must match server/ai/extractionCompiler.ts outputs:
// { nodes, connections } → both arrays; { seeds } → seeds;
// { expressionGuidance } → expressionGuidance; { profiles } → profiles;
// { anchors } → anchors; { rules } → rules; { contract } → [contract].
// { elicitation } is not a candidate and is ignored here.
export function collectQuestionnaireCandidates(
  compiledCandidates: Record<string, unknown>
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const pushArray = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const c of v) {
        if (c && typeof c === 'object') out.push(c as Record<string, unknown>);
      }
    }
  };
  for (const value of Object.values(compiledCandidates)) {
    if (!value || typeof value !== 'object') continue;
    const o = value as Record<string, unknown>;
    pushArray(o.nodes);
    pushArray(o.connections);
    pushArray(o.seeds);
    pushArray(o.expressionGuidance);
    pushArray(o.profiles);
    pushArray(o.anchors);
    pushArray(o.rules);
    if (o.contract && typeof o.contract === 'object') {
      out.push(o.contract as Record<string, unknown>);
    }
  }
  return out;
}

export function validateQuestionnaireResults(result: PipelineResult): QuestionnaireViolation[] {
  const violations: QuestionnaireViolation[] = [];
  const allCandidates = collectQuestionnaireCandidates(result.compiledCandidates);
  const failedSet = new Set(result.failedBatteries || []);
  for (const req of REQUIREMENTS) {
    const battery = EXTRACTION_BATTERIES.find((b) => b.family === req.family);
    if (!battery) continue;
    const familyResponses = result.stage1Responses.filter((r) => r.family === req.family);
    if (familyResponses.length === 0) continue; // family was not run; nothing to require
    let matching = allCandidates.filter((c) => c.target === req.target);
    if (req.predicate) matching = matching.filter(req.predicate);
    const ok = matching.length >= req.min && matching.length <= req.max;
    if (ok) continue;
    const question = battery.questions[req.questionIndex] ?? battery.questions[0] ?? req.family;
    const allEvasive = familyResponses.every(
      (r) => !r.answer || !r.answer.trim() || EVASIVE_RE.test(r.answer)
    );
    const rangeText =
      req.max === Infinity
        ? `at least ${req.min}`
        : req.min === req.max
        ? `exactly ${req.min}`
        : `${req.min}-${req.max}`;
    let reason =
      `required ${rangeText} ${req.target} candidate(s)` +
      (req.predicateNote ? ` ${req.predicateNote}` : '') +
      `; compiled ${matching.length}`;
    if (failedSet.has(req.family)) reason += '; family failed Stage 2 compilation';
    if (allEvasive) reason += '; the source explicitly did not answer the battery questions';
    violations.push({ family: req.family, question, reason });
  }
  return violations;
}
