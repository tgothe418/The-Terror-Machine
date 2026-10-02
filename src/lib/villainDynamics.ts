import type {
  CharacterRelationshipRecord,
  CharacterRelationshipState,
  RelationshipIntensity,
  RelationshipKind,
} from '../types/characterRelationships';
import type { ValueAnchor } from '../types/horrorGrammar';

const KIND_READINGS: Record<RelationshipKind, Record<RelationshipIntensity, string>> = {
  LOYALTY: {
    3: 'will coordinate without being asked',
    2: 'reliable ally; coordinate when useful',
    1: 'tentative alignment',
  },
  DOMINANCE: {
    3: 'expects obedience; defiance will be punished',
    2: 'dominant; the other defers',
    1: 'jockeying for position',
  },
  FEAR: {
    3: 'terrified; will waver rather than cross',
    2: 'wary; avoids direct confrontation',
    1: 'uneasy',
  },
  SUSPICION: {
    3: 'actively plotting against',
    2: 'distrusts; verifies before acting',
    1: 'watchful',
  },
  HOSTILITY: {
    3: 'fracture: working at cross-purposes',
    2: 'open conflict likely',
    1: 'friction',
  },
  TRUST: {
    3: 'implicit trust',
    2: 'trusts',
    1: 'cautious trust',
  },
  DEPENDENCE: {
    3: 'cannot act without the other',
    2: 'relies on',
    1: 'leans on',
  },
  LEVERAGE: {
    3: 'owned; will obey',
    2: 'has leverage',
    1: 'minor leverage',
  },
};

export function describeVillainDynamics(
  villainIds: string[],
  relationships: CharacterRelationshipState,
  nameOf?: (id: string) => string
): string {
  if (!Array.isArray(villainIds) || villainIds.length < 2) return '';
  const villainSet = new Set(villainIds);
  const relevant = (relationships ?? [])
    .filter(
      (r) =>
        r &&
        villainSet.has(r.source_character_id) &&
        villainSet.has(r.target_character_id)
    )
    .sort((a, b) =>
      a.source_character_id.localeCompare(b.source_character_id) ||
      a.target_character_id.localeCompare(b.target_character_id) ||
      a.kind.localeCompare(b.kind)
    );
  if (relevant.length === 0) return '';
  const resolveName = (id: string) => {
    try {
      return nameOf?.(id) ?? id;
    } catch {
      return id;
    }
  };
  const lines = ['VILLAIN DYNAMICS (rival predators in play):'];
  for (const r of relevant) {
    const reading = KIND_READINGS[r.kind]?.[r.intensity] ?? '';
    lines.push(
      `• ${resolveName(r.source_character_id)} -> ${resolveName(r.target_character_id)}: ${r.kind} (${r.intensity})${reading ? ` — ${reading}` : ''}`
    );
  }
  return lines.join('\n');
}

const KIND_KEYWORDS: Array<{ kind: RelationshipKind; keywords: string[] }> = [
  { kind: 'LOYALTY', keywords: ['loyal', 'ally', 'allies', 'devoted'] },
  { kind: 'DOMINANCE', keywords: ['dominan', 'control', 'obey', 'subservien', 'master', 'servant'] },
  { kind: 'FEAR', keywords: ['fear', 'afraid', 'terrified', 'terror'] },
  { kind: 'SUSPICION', keywords: ['suspect', 'suspicion', 'distrust', 'wary', 'paranoid'] },
  { kind: 'HOSTILITY', keywords: ['hostil', 'hate', 'hatred', 'enemy', 'enemies', 'rival'] },
  { kind: 'TRUST', keywords: ['trust'] },
  { kind: 'DEPENDENCE', keywords: ['depend', 'reli', 'need'] },
  { kind: 'LEVERAGE', keywords: ['leverage', 'blackmail', 'coerc', 'hold over'] },
];

export function seedVillainRelationshipsFromAnchors(
  anchors: ValueAnchor[] | null | undefined,
  villainIds: string[]
): CharacterRelationshipRecord[] {
  if (!Array.isArray(anchors) || !Array.isArray(villainIds) || villainIds.length < 2) return [];
  const villainSet = new Set(villainIds);
  const seen = new Set<string>();
  const records: CharacterRelationshipRecord[] = [];
  for (const anchor of anchors) {
    if (!anchor || typeof anchor !== 'object') continue;
    if (anchor.holder?.kind !== 'RELATIONSHIP') continue;
    const ids = anchor.holder.castMemberIds;
    if (!Array.isArray(ids) || ids.length !== 2) continue;
    if (!villainSet.has(ids[0]) || !villainSet.has(ids[1])) continue;
    const text =
      `${anchor.label ?? ''} ${anchor.description ?? ''} ${anchor.basisSummary ?? ''}`.toLowerCase();
    let kind: RelationshipKind | null = null;
    for (const entry of KIND_KEYWORDS) {
      if (entry.keywords.some((kw) => text.includes(kw))) {
        kind = entry.kind;
        break;
      }
    }
    if (!kind) continue;
    const key = `${ids[0]}\0${ids[1]}\0${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      source_character_id: ids[0],
      target_character_id: ids[1],
      kind,
      intensity: 2,
    });
  }
  return records;
}
