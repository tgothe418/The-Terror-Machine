import type { AttemptFilterContext } from '../types/worldState';
import { inReach, assertWorldStatePromptBudget } from './worldPredicates';

export const OBJECT_SECTION_CHAR_BUDGET = 600;
export const ATTENTION_SECTION_CHAR_BUDGET = 400;
export const ROUTINE_SECTION_CHAR_BUDGET = 300;

/**
 * CC2 first reader: in-reach objects only. Deterministic ordering (objectId sort)
 * so identical state yields identical prompts. Overflow is summarized, never truncated mid-item.
 */
export function formatWorldObjectPromptSection(characterId: string, ctx: AttemptFilterContext): string {
  const reachable = Object.values(ctx.objects)
    .filter((o) => inReach(characterId, o.objectId, ctx))
    .sort((a, b) => a.objectId.localeCompare(b.objectId));
  if (reachable.length === 0) return '';

  const parts: string[] = [];
  let budget = OBJECT_SECTION_CHAR_BUDGET;
  let omitted = 0;
  for (const o of reachable) {
    const desc =
      o.containerState !== undefined
        ? `${o.name} (${o.sizeClass}, ${o.containerState})`
        : `${o.name} (${o.sizeClass})`;
    const piece = parts.length === 0 ? desc : `, ${desc}`;
    if (piece.length > budget) {
      omitted += 1;
      continue;
    }
    parts.push(piece);
    budget -= piece.length;
  }
  const suffix = omitted > 0 ? `${parts.length > 0 ? ' ' : ''}+${omitted} more` : '';
  return `[IN REACH: ${parts.join('')}${suffix}]`;
}

/**
 * P3: Formats co-located characters with an active attendingTo target.
 * Sorted deterministically by characterId ascending.
 * Enforces ATTENTION_SECTION_CHAR_BUDGET with '+N more' overflow summary.
 */
export function formatAttentionPromptSection(characterId: string, ctx: AttemptFilterContext): string {
  const charNode = ctx.characterNodes[characterId];
  if (!charNode || !ctx.attention) return '';

  const attended = Object.values(ctx.attention)
    .filter((att) => {
      if (!att.attendingTo) return false;
      const node = ctx.characterNodes[att.characterId];
      return Boolean(node && node === charNode);
    })
    .sort((a, b) => a.characterId.localeCompare(b.characterId));

  if (attended.length === 0) return '';

  const parts: string[] = [];
  let budget = ATTENTION_SECTION_CHAR_BUDGET;
  let omitted = 0;
  for (const att of attended) {
    const desc = `${att.characterId} → ${att.attendingTo!.id}`;
    const piece = parts.length === 0 ? desc : `, ${desc}`;
    if (piece.length > budget) {
      omitted += 1;
      continue;
    }
    parts.push(piece);
    budget -= piece.length;
  }
  const suffix = omitted > 0 ? `${parts.length > 0 ? ' ' : ''}+${omitted} more` : '';
  return `[ATTENDED: ${parts.join('')}${suffix}]`;
}

/**
 * P4: Formats active routines co-located with characterId where step duration has not elapsed.
 * Format: [ROUTINES: <charId> — <actionSummary> step <x>/<total> (~<remaining>m)]
 * Sorted deterministically by characterId ascending.
 * Enforces ROUTINE_SECTION_CHAR_BUDGET with '+N more' overflow summary.
 */
export function formatRoutinePromptSection(
  characterId: string,
  ctx: AttemptFilterContext,
  maxBudget = ROUTINE_SECTION_CHAR_BUDGET
): string {
  const charNode = ctx.characterNodes[characterId];
  if (!charNode || !ctx.routines) return '';

  const activeRoutines = Object.values(ctx.routines)
    .filter((r) => {
      if (r.lastFiredFictionalTime === undefined) return false;
      const node = ctx.characterNodes[r.characterId];
      if (!node || node !== charNode) return false;
      if (!r.steps || r.steps.length === 0) return false;

      const currentIdx = r.currentStepIndex ?? 0;
      const activeStepIndex = currentIdx === 0 ? r.steps.length - 1 : currentIdx - 1;
      const activeStep = r.steps[activeStepIndex];
      if (!activeStep) return false;

      const stepDurationSec = activeStep.durationMinutes * 60;
      return r.lastFiredFictionalTime + stepDurationSec > ctx.fictionalTime;
    })
    .sort((a, b) => a.characterId.localeCompare(b.characterId));

  if (activeRoutines.length === 0) return '';
  if (maxBudget < 25) return '';

  const parts: string[] = [];
  // Reserve 25 chars for '[ROUTINES: ' prefix (11) and ' +99 more]' suffix (11-14)
  let budget = maxBudget - 25;
  let omitted = 0;

  for (const r of activeRoutines) {
    const currentIdx = r.currentStepIndex ?? 0;
    const activeStepIndex = currentIdx === 0 ? r.steps.length - 1 : currentIdx - 1;
    const activeStep = r.steps[activeStepIndex];
    if (!activeStep) continue;

    const elapsed = Math.max(0, ctx.fictionalTime - r.lastFiredFictionalTime!);
    const remainingMinutes = Math.max(1, Math.ceil((activeStep.durationMinutes * 60 - elapsed) / 60));
    const desc = `${r.characterId} — ${activeStep.actionSummary} step ${activeStep.stepNumber}/${r.steps.length} (~${remainingMinutes}m)`;
    const piece = parts.length === 0 ? desc : `, ${desc}`;
    if (piece.length > budget) {
      omitted += 1;
      continue;
    }
    parts.push(piece);
    budget -= piece.length;
  }

  const suffix = omitted > 0 ? `${parts.length > 0 ? ' ' : ''}+${omitted} more` : '';
  const result = parts.length > 0 || omitted > 0 ? `[ROUTINES: ${parts.join('')}${suffix}]` : '';
  if (result.length > maxBudget) return '';
  return result;
}

/**
 * Composed world-state section for the turn prompt.
 * Combines objects + attention + routines.
 * The assert runs HERE, once, on the composed whole (budget <= 1200 chars).
 */
export function composeWorldStatePromptSection(characterId: string, ctx: AttemptFilterContext): string {
  const objLine = formatWorldObjectPromptSection(characterId, ctx);
  const attLine = formatAttentionPromptSection(characterId, ctx);

  const usedSoFar = (objLine ? objLine.length + 1 : 0) + (attLine ? attLine.length + 1 : 0);
  const availableBudget = Math.max(0, 1200 - usedSoFar);
  const routineBudget = Math.min(ROUTINE_SECTION_CHAR_BUDGET, availableBudget);

  const routineLine = formatRoutinePromptSection(characterId, ctx, routineBudget);

  const lines = [objLine, attLine, routineLine].filter((l) => l !== '');
  const section = lines.join('\n');
  assertWorldStatePromptBudget(section);
  return section;
}
