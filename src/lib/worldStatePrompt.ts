import type { AttemptFilterContext } from '../types/worldState';
import { inReach, assertWorldStatePromptBudget } from './worldPredicates';

export const OBJECT_SECTION_CHAR_BUDGET = 600;
export const ATTENTION_SECTION_CHAR_BUDGET = 400;

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
 * Composed world-state section for the turn prompt. P3 appends attended items;
 * P4 appends active routines. The assert runs HERE, once, on the composed whole.
 */
export function composeWorldStatePromptSection(characterId: string, ctx: AttemptFilterContext): string {
  const lines = [
    formatWorldObjectPromptSection(characterId, ctx),
    formatAttentionPromptSection(characterId, ctx),
  ].filter((l) => l !== '');
  const section = lines.join('\n');
  assertWorldStatePromptBudget(section);
  return section;
}
