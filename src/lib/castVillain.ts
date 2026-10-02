import type { Blueprint, CastMember } from '../types';
import type { ForgeDraft, ForgeDraftCastMember, AntagonistProfile } from '../types/forge';
import { createNeutralSeed } from './neutralSeed';

/** Minimal shape needed to decide villain status; accepts draft or blueprint members. */
export interface VillainCheckable {
  name?: unknown;
  disposition?: unknown;
  isEntity?: unknown;
  role?: unknown;
}

/**
 * Canonical villain test, mirroring the engine's seat-availability rule:
 * explicit VILLAIN disposition, entity flag, or ANTAGONIST/VILLAIN role.
 * Case-insensitive on string fields.
 */
export function isVillainCastMember(member: VillainCheckable | null | undefined): boolean {
  if (!member || typeof member !== 'object') return false;
  const m = member as { disposition?: unknown; isEntity?: unknown; role?: unknown };
  if (String(m.disposition ?? '').toUpperCase().trim() === 'VILLAIN') return true;
  if (m.isEntity === true) return true;
  const role = String(m.role ?? '').toUpperCase().trim();
  return role === 'ANTAGONIST' || role === 'VILLAIN';
}

export function normalizedVillainName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '') // strip parentheticals: "AM (Allied Mastercomputer)" -> "AM"
    .replace(/[^a-z0-9]/g, '');
}

export function villainNamesMatch(a: unknown, b: unknown): boolean {
  const na = normalizedVillainName(a);
  const nb = normalizedVillainName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const wordsA = String(a ?? '').toLowerCase().replace(/\(.*?\)/g, '').match(/[a-z0-9]+/g) || [];
  const wordsB = String(b ?? '').toLowerCase().replace(/\(.*?\)/g, '').match(/[a-z0-9]+/g) || [];

  const setB = new Set(wordsB);
  return wordsA.some((w) => w.length >= 2 && setB.has(w));
}

/**
 * Ensure the draft satisfies the villain invariant. No-op unless ALL of these hold:
 *  - no cast member passes isVillainCastMember, AND
 *  - draft.antagonistProfile has a non-empty name, AND
 *  - no cast member fuzzy-matches that name (covers villain-protagonists:
 *    the profile names him, he is already in cast, no duplicate is synthesized).
 * The synthesized member is explicitly labeled as auto-generated so the author can
 * enrich or replace it in the Cast Manager.
 */
export function ensureVillainCastMember(draft: ForgeDraft): ForgeDraft {
  const cast: ForgeDraftCastMember[] = Array.isArray(draft.cast) ? [...draft.cast] : [];
  if (cast.some(isVillainCastMember)) return draft;

  const profile = draft.antagonistProfile;
  const profileName = String(profile?.name ?? '').trim();
  if (!profileName) return draft;
  if (cast.some((c) => villainNamesMatch(c?.name, profileName))) return draft;

  const kind = String(profile?.kind ?? '').toUpperCase();
  const isEntity =
    (profile && typeof profile === 'object' && 'isEntity' in profile && Boolean((profile as { isEntity?: boolean }).isEntity)) ||
    kind === 'ENTITY' ||
    kind === 'FORCE' ||
    kind === 'APPARATUS';

  const villainId = `villain-${normalizedVillainName(profileName) || 'antagonist'}`;
  if (cast.some((c) => c?.id === villainId)) return draft;

  const role =
    profile && typeof profile === 'object' && 'role' in profile && typeof (profile as { role?: string }).role === 'string'
      ? (profile as { role: string }).role
      : 'Antagonist';

  const newMember: ForgeDraftCastMember = {
    id: villainId,
    name: profileName,
    role,
    disposition: 'VILLAIN',
    isEntity,
    isUserCharacter: false,
    description:
      `Auto-synthesized villain cast member for antagonist profile "${profileName}". ` +
      `Review and enrich in the Cast Manager.`,
    personality: 'As defined by the antagonist profile.',
    goals: 'As defined by the antagonist profile.',
    traits: isEntity ? ['menacing', 'supernatural'] : ['menacing', 'dangerous'],
    presenceDisposition: { kind: 'OFFSTAGE' },
    seed: createNeutralSeed(
      {
        id: villainId,
        name: profileName,
        role,
        isEntity,
        isUserCharacter: false,
        description: `Auto-synthesized villain cast member for antagonist profile "${profileName}".`,
        goals: 'As defined by the antagonist profile.',
      },
      draft
    ),
  };
  cast.push(newMember);

  const next: ForgeDraft = { ...draft, cast };
  // Keep horror-grammar bookkeeping consistent with applyCandidateToDraft's cast_seed path
  const hg = next.horrorGrammar;
  if (hg) {
    const pursuitReviews = { ...(hg.pursuitReviews || {}) };
    if (!pursuitReviews[villainId]) {
      pursuitReviews[villainId] = 'REVIEWED_NONE';
    }
    next.horrorGrammar = {
      ...hg,
      pursuitReviews,
    };
  }
  return next;
}

export const OPPOSITION_ROLE_TOKENS = [
  'INVESTIGATOR',
  'DETECTIVE',
  'INSPECTOR',
  'OFFICER',
  'AGENT',
  'SHERIFF',
  'HUNTER',
];

/**
 * A cast member positioned to expose or stop the villain: law enforcement,
 * investigators, or explicitly adversarial roles. Used as the antagonist-seat
 * binding and the discovery-pressure operator in villain-protagonist mode.
 */
export function isOppositionCastMember(c: VillainCheckable | null | undefined): boolean {
  if (!c || c.isEntity === true) return false;
  const role = String(c.role ?? '').toUpperCase();
  const name = String(c.name ?? '').toUpperCase();
  return OPPOSITION_ROLE_TOKENS.some((t) => role.includes(t) || name.includes(t));
}

export type BindingSource =
  | 'PLAYER_CHOICE'
  | 'USER_CHARACTER_MARK'
  | 'AUTHORED_DEFAULT'
  | 'FIRST_AUTHORED'
  | 'LEGACY_SCAN';

export interface BoundVillainResolution {
  villainId: string;
  source: BindingSource;
}

/**
 * Villain IDs available for the villain/antagonist seat, in priority order.
 * The authored roster wins when its IDs resolve to cast members;
 * otherwise the legacy disposition scan in cast order.
 * Never returns an ID with no cast member behind it.
 */
export function getAvailableVillainIds(blueprint: Blueprint, cast: CastMember[]): string[] {
  const rostered = (blueprint.villains ?? [])
    .map((v) => v.villainId)
    .filter((id) => cast.some((c) => c.id === id));
  if (rostered.length > 0) return rostered;
  return cast.filter(isVillainCastMember).map((c) => c.id);
}

export function findVillainCastMember(
  cast: CastMember[],
  villainId: string
): CastMember | undefined {
  return cast.find((c) => c.id === villainId && isVillainCastMember(c));
}

/**
 * Bound villain for the villain/antagonist seat.
 * Priority: playerChoice (if valid) > USER_CHARACTER_MARK (cast) >
 * defaultVillainId (if valid) > first authored > legacy scan > null.
 * Returns null for non-villain seats and when no villain is available.
 * `playerChoice` is the future seat-select UI channel (invalid values ignored);
 * no call site passes it in this packet.
 */
export function resolveBoundVillainId(
  seat: string,
  blueprint: Blueprint,
  cast: CastMember[],
  playerChoice?: string
): BoundVillainResolution | null {
  if (seat !== 'villain' && seat !== 'antagonist') return null;
  const available = getAvailableVillainIds(blueprint, cast);
  if (playerChoice && available.includes(playerChoice)) {
    return { villainId: playerChoice, source: 'PLAYER_CHOICE' };
  }
  const marked = cast.find((c) => c.isUserCharacter && isVillainCastMember(c));
  if (marked) {
    return { villainId: marked.id, source: 'USER_CHARACTER_MARK' };
  }
  if (blueprint.defaultVillainId && available.includes(blueprint.defaultVillainId)) {
    return { villainId: blueprint.defaultVillainId, source: 'AUTHORED_DEFAULT' };
  }
  if (available.length > 0) {
    const rostered = (blueprint.villains ?? []).length > 0;
    return { villainId: available[0], source: rostered ? 'FIRST_AUTHORED' : 'LEGACY_SCAN' };
  }
  return null;
}

/**
 * Per-villain operational profile. Roster entry wins; singular
 * blueprint.antagonistProfile is the legacy default.
 */
export function resolveVillainOperationalProfile(
  villainId: string,
  blueprint: Blueprint
): AntagonistProfile | undefined {
  const rostered = (blueprint.villains ?? []).find((v) => v.villainId === villainId);
  if (rostered?.operationalProfile) return rostered.operationalProfile;
  return blueprint.antagonistProfile ?? undefined;
}

export interface VillainPersonaFields {
  description?: string;
  personality?: string;
  goals?: string;
  traits?: string[];
}

/**
 * Merge authored roster personas into matching cast members.
 * Only non-empty fields write; re-merge is a no-op (idempotent).
 * Returns a new cast array; never mutates inputs.
 */
export function mergeVillainPersonasIntoCast<
  T extends {
    id?: string;
    description?: string;
    personality?: string;
    goals?: string;
    traits?: string[];
  }
>(
  cast: T[],
  villains: Array<{ villainId: string; castSeedPersona?: VillainPersonaFields }>
): T[] {
  return cast.map((member) => {
    if (!member.id) return member;
    const entry = villains.find((v) => v.villainId === member.id);
    const persona = entry?.castSeedPersona;
    if (!persona) return member;
    const next: T = { ...member };
    let changed = false;
    if (persona.description?.trim()) { next.description = persona.description; changed = true; }
    if (persona.personality?.trim()) { next.personality = persona.personality; changed = true; }
    if (persona.goals?.trim()) { next.goals = persona.goals; changed = true; }
    if (persona.traits && persona.traits.length > 0) { next.traits = [...persona.traits]; changed = true; }
    return changed ? next : member;
  });
}

