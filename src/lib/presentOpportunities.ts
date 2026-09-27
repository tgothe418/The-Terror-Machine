import type { AttemptFilterContext } from '../types/worldState';
import { isActionUnobserved } from './attentionMechanics';

export interface OpportunityProposal {
  id?: string;
  castMemberId?: string;
  targetKind: 'NODE' | 'OBJECT' | 'CHARACTER';
  targetId: string;
  requiresStealth?: boolean;
  [key: string]: unknown;
}

/**
 * Filters opportunity proposals based on NPC attention.
 * Invariant 4: Actions that require stealth are filtered out if observed by any co-located captor.
 * Non-stealth opportunities pass unconditionally.
 */
export function filterOpportunitiesByAttention<
  T extends { targetKind?: 'NODE' | 'OBJECT' | 'CHARACTER'; targetId?: string; requiresStealth?: boolean }
>(
  opportunities: T[],
  characterId: string,
  ctx: AttemptFilterContext
): T[] {
  void characterId;
  return opportunities.filter((opp) => {
    if (opp.requiresStealth) {
      const targetRef = { kind: opp.targetKind || 'NODE', id: opp.targetId || '' };
      return isActionUnobserved(targetRef, ctx);
    }
    return true;
  });
}
