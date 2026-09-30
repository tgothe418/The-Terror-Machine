import { describe, it, expect } from 'vitest';
import {
  isVillainCastMember,
  ensureVillainCastMember,
  normalizedVillainName,
  villainNamesMatch,
  getAvailableVillainIds,
  findVillainCastMember,
  resolveBoundVillainId,
} from './castVillain';
import { normalizeCastDisposition } from './sourceBaseline';
import type { ForgeDraft, AntagonistProfile } from '../types/forge';
import type { Blueprint, CastMember } from '../types';
import { DEFAULT_FEAR_CONTRACT } from '../types/fear';

describe('isVillainCastMember', () => {
  it('returns true when disposition is VILLAIN (case-insensitive)', () => {
    expect(isVillainCastMember({ disposition: 'VILLAIN' })).toBe(true);
    expect(isVillainCastMember({ disposition: 'villain' })).toBe(true);
    expect(isVillainCastMember({ disposition: ' Villain ' })).toBe(true);
  });

  it('returns true when isEntity is true', () => {
    expect(isVillainCastMember({ isEntity: true })).toBe(true);
    expect(isVillainCastMember({ isEntity: true, disposition: 'SURVIVOR' })).toBe(true);
  });

  it('returns true when role is ANTAGONIST or VILLAIN (case-insensitive)', () => {
    expect(isVillainCastMember({ role: 'Antagonist' })).toBe(true);
    expect(isVillainCastMember({ role: 'antagonist' })).toBe(true);
    expect(isVillainCastMember({ role: 'VILLAIN' })).toBe(true);
    expect(isVillainCastMember({ role: '  Antagonist  ' })).toBe(true);
  });

  it('returns false for mortal survivors or bystanders', () => {
    expect(isVillainCastMember({ disposition: 'SURVIVOR', isEntity: false, role: 'Survivor' })).toBe(false);
    expect(isVillainCastMember({ disposition: 'BYSTANDER', isEntity: false, role: 'Bystander' })).toBe(false);
    expect(isVillainCastMember({ isEntity: false, role: 'Protagonist' })).toBe(false);
  });

  it('handles null, undefined, and non-object inputs safely', () => {
    expect(isVillainCastMember(null)).toBe(false);
    expect(isVillainCastMember(undefined)).toBe(false);
    expect(isVillainCastMember({})).toBe(false);
  });
});

describe('normalizeCastDisposition', () => {
  it('coerces villain aliases to VILLAIN', () => {
    expect(normalizeCastDisposition('HOSTILE', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('hostile', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('villain', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('ANTAGONIST', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('EVIL', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('MALEVOLENT', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('MONSTER', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('KILLER', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('PSYCHOPATH', false)).toBe('VILLAIN');
    expect(normalizeCastDisposition('MURDERER', false)).toBe('VILLAIN');
  });

  it('coerces bystander aliases to BYSTANDER', () => {
    expect(normalizeCastDisposition('BYSTANDER', false)).toBe('BYSTANDER');
    expect(normalizeCastDisposition('NEUTRAL', false)).toBe('BYSTANDER');
    expect(normalizeCastDisposition('INNOCENT', false)).toBe('BYSTANDER');
    expect(normalizeCastDisposition('CIVILIAN', false)).toBe('BYSTANDER');
    expect(normalizeCastDisposition('OBSERVER', false)).toBe('BYSTANDER');
  });

  it('coerces survivor aliases to SURVIVOR', () => {
    expect(normalizeCastDisposition('SURVIVOR', false)).toBe('SURVIVOR');
    expect(normalizeCastDisposition('PROTAGONIST', false)).toBe('SURVIVOR');
    expect(normalizeCastDisposition('HERO', false)).toBe('SURVIVOR');
    expect(normalizeCastDisposition('VICTIM', false)).toBe('SURVIVOR');
  });

  it('falls back to VILLAIN for unrecognized values if isEntity is true', () => {
    expect(normalizeCastDisposition('UNKNOWN_ALIEN_AI', true)).toBe('VILLAIN');
    expect(normalizeCastDisposition(null, true)).toBe('VILLAIN');
    expect(normalizeCastDisposition(undefined, true)).toBe('VILLAIN');
    expect(normalizeCastDisposition('', true)).toBe('VILLAIN');
  });

  it('falls back to SURVIVOR for unrecognized values if mortal (isEntity false)', () => {
    expect(normalizeCastDisposition('UNKNOWN_STATUS', false)).toBe('SURVIVOR');
    expect(normalizeCastDisposition(null, false)).toBe('SURVIVOR');
    expect(normalizeCastDisposition(undefined, false)).toBe('SURVIVOR');
    expect(normalizeCastDisposition('', false)).toBe('SURVIVOR');
  });
});

describe('villain name matching helpers', () => {
  it('strips parentheticals and punctuation in normalizedVillainName', () => {
    expect(normalizedVillainName('AM (Allied Mastercomputer)')).toBe('am');
    expect(normalizedVillainName('Dr. Aris (Lead Scientist)')).toBe('draris');
    expect(normalizedVillainName('Patrick Bateman')).toBe('patrickbateman');
  });

  it('matches villain names with fuzzy substring and parenthetical stripping', () => {
    expect(villainNamesMatch('AM', 'AM (Allied Mastercomputer)')).toBe(true);
    expect(villainNamesMatch('AM (Allied Mastercomputer)', 'AM')).toBe(true);
    expect(villainNamesMatch('Patrick Bateman', 'Patrick Bateman')).toBe(true);
    expect(villainNamesMatch('The Overseer', 'Overseer')).toBe(true);
    expect(villainNamesMatch('Elena Mercer', 'AM')).toBe(false);
  });
});

describe('ensureVillainCastMember', () => {
  const baseDraft: ForgeDraft = {
    title: 'Test Scenario',
    premise: 'Testing scenario mechanics.',
    startingVector: 'SOMATIC',
    startingTier: 'MANIFEST',
    deathContract: {
      metaphysics: 'mundane',
      deathMetaphysics: 'mundane',
      powerBudget: 'Physical constraints.',
      seatSuccession: {},
    },
    fearContract: DEFAULT_FEAR_CONTRACT,
    cast: [
      {
        id: 'char-elena',
        name: 'Elena Mercer',
        role: 'Researcher',
        disposition: 'SURVIVOR',
        isEntity: false,
      },
    ],
    horrorGrammar: {
      valueBaselineReview: 'REVIEWED_NONE',
      pursuitReviews: { 'char-elena': 'REVIEWED_NONE' },
      valueAnchors: [],
      characterPursuits: [],
    },
  };

  it('is a no-op when a VILLAIN-disposition member already exists', () => {
    const draftWithVillain: ForgeDraft = {
      ...baseDraft,
      cast: [
        ...baseDraft.cast!,
        {
          id: 'char-villain',
          name: 'Hostile Entity',
          role: 'Nemesis',
          disposition: 'VILLAIN',
          isEntity: true,
        },
      ],
      antagonistProfile: {
        name: 'Hostile Entity',
        kind: 'ENTITY',
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };

    const result = ensureVillainCastMember(draftWithVillain);
    expect(result).toBe(draftWithVillain);
    expect(result.cast).toHaveLength(2);
  });

  it('is a no-op when an entity member already exists (no explicit disposition)', () => {
    const draftWithEntity: ForgeDraft = {
      ...baseDraft,
      cast: [
        ...baseDraft.cast!,
        {
          id: 'char-am',
          name: 'AM',
          role: 'Overlord',
          isEntity: true,
        },
      ],
      antagonistProfile: {
        name: 'AM',
        kind: 'ENTITY',
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };

    const result = ensureVillainCastMember(draftWithEntity);
    expect(result).toBe(draftWithEntity);
    expect(result.cast).toHaveLength(2);
  });

  it('is a no-op when role is ANTAGONIST or VILLAIN', () => {
    const draftWithAntagonistRole: ForgeDraft = {
      ...baseDraft,
      cast: [
        ...baseDraft.cast!,
        {
          id: 'char-inquisitor',
          name: 'The Inquisitor',
          role: 'Antagonist',
          disposition: 'SURVIVOR',
          isEntity: false,
        },
      ],
      antagonistProfile: {
        name: 'The Inquisitor',
        kind: 'APPARATUS',
        preyCohort: [],
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };

    const result = ensureVillainCastMember(draftWithAntagonistRole);
    expect(result).toBe(draftWithAntagonistRole);
    expect(result.cast).toHaveLength(2);
  });

  it('is a no-op when antagonistProfile name fuzzy-matches an existing cast member (e.g. Patrick Bateman)', () => {
    const batemanDraft: ForgeDraft = {
      ...baseDraft,
      cast: [
        {
          id: 'char-bateman',
          name: 'Patrick Bateman',
          role: 'Executive',
          disposition: 'SURVIVOR',
          isEntity: false,
        },
      ],
      antagonistProfile: {
        name: 'Patrick Bateman',
        kind: 'APPARATUS',
        preyCohort: [],
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };

    const result = ensureVillainCastMember(batemanDraft);
    expect(result).toBe(batemanDraft);
    expect(result.cast).toHaveLength(1);
  });

  it('is a no-op when antagonistProfile name fuzzy-matches with parentheticals', () => {
    const parentheticalDraft: ForgeDraft = {
      ...baseDraft,
      cast: [
        {
          id: 'char-am',
          name: 'AM (Allied Mastercomputer)',
          role: 'Computer',
          disposition: 'SURVIVOR',
          isEntity: false,
        },
      ],
      antagonistProfile: {
        name: 'AM',
        kind: 'ENTITY',
        preyCohort: [],
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };

    const result = ensureVillainCastMember(parentheticalDraft);
    expect(result).toBe(parentheticalDraft);
    expect(result.cast).toHaveLength(1);
  });

  it('is a no-op when there is no antagonistProfile or profile name is empty', () => {
    const noProfileDraft: ForgeDraft = {
      ...baseDraft,
    };
    expect(ensureVillainCastMember(noProfileDraft)).toBe(noProfileDraft);

    const emptyNameDraft: ForgeDraft = {
      ...baseDraft,
      antagonistProfile: {
        name: '   ',
        kind: 'ENTITY',
        preyCohort: [],
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };
    expect(ensureVillainCastMember(emptyNameDraft)).toBe(emptyNameDraft);
  });

  it('synthesizes a VILLAIN cast member when antagonistProfile names an antagonist not in mortal-only cast', () => {
    const draft: ForgeDraft = {
      ...baseDraft,
      antagonistProfile: {
        name: 'AM',
        kind: 'ENTITY',
        preyCohort: [],
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };

    const result = ensureVillainCastMember(draft);
    expect(result.cast).toHaveLength(2);
    const synthesized = result.cast?.find((c) => c.id === 'villain-am');
    expect(synthesized).toBeDefined();
    expect(synthesized?.name).toBe('AM');
    expect(synthesized?.disposition).toBe('VILLAIN');
    expect(synthesized?.isEntity).toBe(true);
    expect(synthesized?.presenceDisposition).toEqual({ kind: 'OFFSTAGE' });
    expect(synthesized?.traits).toEqual(['menacing', 'supernatural']);
    expect(synthesized?.description).toContain('Auto-synthesized villain cast member');

    // Horror grammar pursuitReviews updated
    expect(result.horrorGrammar?.pursuitReviews?.['villain-am']).toBe('REVIEWED_NONE');
  });

  it('synthesizes a mortal villain with isEntity false when kind is mortal', () => {
    const draft: ForgeDraft = {
      ...baseDraft,
      antagonistProfile: {
        name: 'The Warden',
        kind: 'HUMAN' as unknown as 'APPARATUS',
        role: 'Chief Overseer',
        preyCohort: [],
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      } as unknown as AntagonistProfile,
    };

    const result = ensureVillainCastMember(draft);
    expect(result.cast).toHaveLength(2);
    const synthesized = result.cast?.find((c) => c.id === 'villain-thewarden');
    expect(synthesized).toBeDefined();
    expect(synthesized?.name).toBe('The Warden');
    expect(synthesized?.disposition).toBe('VILLAIN');
    expect(synthesized?.isEntity).toBe(false);
    expect(synthesized?.role).toBe('Chief Overseer');
    expect(synthesized?.traits).toEqual(['menacing', 'dangerous']);
  });

  it('is idempotent and never creates duplicates on repeated calls', () => {
    const draft: ForgeDraft = {
      ...baseDraft,
      antagonistProfile: {
        name: 'AM',
        kind: 'ENTITY',
        preyCohort: [],
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };

    const run1 = ensureVillainCastMember(draft);
    expect(run1.cast).toHaveLength(2);

    const run2 = ensureVillainCastMember(run1);
    expect(run2.cast).toHaveLength(2);
    expect(run2).toBe(run1);
  });
});

describe('getAvailableVillainIds', () => {
  const cast = [
    {
      id: 'char-1',
      name: 'Thomas Wright',
      role: 'Technician',
      disposition: 'SURVIVOR',
      isEntity: false,
    },
    {
      id: 'char-2',
      name: 'Dale Brennan',
      role: 'Foreman',
      disposition: 'VILLAIN',
      isEntity: false,
    },
    {
      id: 'char-3',
      name: 'Arthur Pendelton',
      role: 'Inspector',
      disposition: 'VILLAIN',
      isEntity: false,
    },
  ] as unknown as CastMember[];

  it('authored roster resolving to cast -> roster IDs in authored order', () => {
    const bp = {
      title: 'Testing Facility',
      villains: [
        { villainId: 'char-3', name: 'Arthur Pendelton' },
        { villainId: 'char-2', name: 'Dale Brennan' },
      ],
      cast,
    } as Blueprint;

    expect(getAvailableVillainIds(bp, cast)).toEqual(['char-3', 'char-2']);
  });

  it('roster with phantom IDs -> phantoms filtered', () => {
    const bp = {
      title: 'Testing Facility',
      villains: [
        { villainId: 'char-phantom', name: 'Phantom Figure' },
        { villainId: 'char-2', name: 'Dale Brennan' },
      ],
      cast,
    } as Blueprint;

    expect(getAvailableVillainIds(bp, cast)).toEqual(['char-2']);
  });

  it('no roster -> VILLAIN-disposition cast IDs in cast order', () => {
    const bp = {
      title: 'Testing Facility',
      cast,
    } as Blueprint;

    expect(getAvailableVillainIds(bp, cast)).toEqual(['char-2', 'char-3']);
  });

  it('empty cast -> []', () => {
    const bp = {
      title: 'Empty Facility',
      villains: [{ villainId: 'char-2', name: 'Dale Brennan' }],
      cast: [],
    } as unknown as Blueprint;

    expect(getAvailableVillainIds(bp, [])).toEqual([]);
  });
});

describe('findVillainCastMember', () => {
  const cast = [
    {
      id: 'char-mortal',
      name: 'Thomas Wright',
      disposition: 'SURVIVOR',
      isEntity: false,
    },
    {
      id: 'char-villain',
      name: 'Dale Brennan',
      disposition: 'VILLAIN',
      isEntity: false,
    },
  ] as unknown as CastMember[];

  it('finds villain cast member by id if passing isVillainCastMember', () => {
    const found = findVillainCastMember(cast, 'char-villain');
    expect(found?.id).toBe('char-villain');
    expect(found?.name).toBe('Dale Brennan');
  });

  it('returns undefined if matching cast member is not a villain', () => {
    expect(findVillainCastMember(cast, 'char-mortal')).toBeUndefined();
  });

  it('finds villain cast member by id if character is an entity without explicit VILLAIN disposition', () => {
    const entityCast: CastMember[] = [
      ...cast,
      {
        id: 'char-entity',
        name: 'The Apparatus',
        isEntity: true,
      } as unknown as CastMember,
    ];
    const found = findVillainCastMember(entityCast, 'char-entity');
    expect(found?.id).toBe('char-entity');
    expect(found?.name).toBe('The Apparatus');
  });

  it('returns undefined if villainId does not exist in cast', () => {
    expect(findVillainCastMember(cast, 'char-nonexistent')).toBeUndefined();
  });
});

describe('resolveBoundVillainId', () => {
  const cast = [
    {
      id: 'char-1',
      name: 'Thomas Wright',
      disposition: 'SURVIVOR',
      isEntity: false,
      isUserCharacter: false,
    },
    {
      id: 'char-2',
      name: 'Dale Brennan',
      disposition: 'VILLAIN',
      isEntity: false,
      isUserCharacter: false,
    },
    {
      id: 'char-3',
      name: 'Arthur Pendelton',
      disposition: 'VILLAIN',
      isEntity: false,
      isUserCharacter: false,
    },
  ] as unknown as CastMember[];

  it('seat "protagonist" -> null', () => {
    const bp = {
      title: 'Facility',
      cast,
    } as Blueprint;

    expect(resolveBoundVillainId('protagonist', bp, cast)).toBeNull();
  });

  it('seat "survivor" -> null', () => {
    const bp = {
      title: 'Facility',
      cast,
    } as Blueprint;

    expect(resolveBoundVillainId('survivor', bp, cast)).toBeNull();
  });

  it('valid playerChoice -> { villainId, source: "PLAYER_CHOICE" }', () => {
    const bp = {
      title: 'Facility',
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-3', name: 'Arthur Pendelton' },
      ],
      defaultVillainId: 'char-2',
      cast,
    } as Blueprint;

    const res = resolveBoundVillainId('villain', bp, cast, 'char-3');
    expect(res).toEqual({ villainId: 'char-3', source: 'PLAYER_CHOICE' });
  });

  it('invalid playerChoice -> falls through to next rule', () => {
    const bp = {
      title: 'Facility',
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-3', name: 'Arthur Pendelton' },
      ],
      defaultVillainId: 'char-3',
      cast,
    } as Blueprint;

    const res = resolveBoundVillainId('villain', bp, cast, 'char-invalid');
    expect(res).toEqual({ villainId: 'char-3', source: 'AUTHORED_DEFAULT' });
  });

  it('isUserCharacter villain on cast beats defaultVillainId -> "USER_CHARACTER_MARK"', () => {
    const markedCast: CastMember[] = [
      cast[0],
      { ...cast[1], isUserCharacter: true },
      cast[2],
    ];
    const bp = {
      title: 'Facility',
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-3', name: 'Arthur Pendelton' },
      ],
      defaultVillainId: 'char-3',
      cast: markedCast,
    } as Blueprint;

    const res = resolveBoundVillainId('villain', bp, markedCast);
    expect(res).toEqual({ villainId: 'char-2', source: 'USER_CHARACTER_MARK' });
  });

  it('valid defaultVillainId -> "AUTHORED_DEFAULT"', () => {
    const bp = {
      title: 'Facility',
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-3', name: 'Arthur Pendelton' },
      ],
      defaultVillainId: 'char-3',
      cast,
    } as Blueprint;

    const res = resolveBoundVillainId('villain', bp, cast);
    expect(res).toEqual({ villainId: 'char-3', source: 'AUTHORED_DEFAULT' });
  });

  it('roster without default -> "FIRST_AUTHORED"', () => {
    const bp = {
      title: 'Facility',
      villains: [
        { villainId: 'char-3', name: 'Arthur Pendelton' },
        { villainId: 'char-2', name: 'Dale Brennan' },
      ],
      cast,
    } as Blueprint;

    const res = resolveBoundVillainId('villain', bp, cast);
    expect(res).toEqual({ villainId: 'char-3', source: 'FIRST_AUTHORED' });
  });

  it('no roster -> "LEGACY_SCAN"', () => {
    const bp = {
      title: 'Facility',
      cast,
    } as Blueprint;

    const res = resolveBoundVillainId('villain', bp, cast);
    expect(res).toEqual({ villainId: 'char-2', source: 'LEGACY_SCAN' });
  });

  it('seat "antagonist" -> resolves bound villain identically to villain seat', () => {
    const bp = {
      title: 'Facility',
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-3', name: 'Arthur Pendelton' },
      ],
      defaultVillainId: 'char-3',
      cast,
    } as Blueprint;

    const res = resolveBoundVillainId('antagonist', bp, cast);
    expect(res).toEqual({ villainId: 'char-3', source: 'AUTHORED_DEFAULT' });
  });

  it('no villains at all -> null', () => {
    const nonVillainCast: CastMember[] = [cast[0]];
    const bp = {
      title: 'Facility',
      cast: nonVillainCast,
    } as Blueprint;

    expect(resolveBoundVillainId('villain', bp, nonVillainCast)).toBeNull();
  });

  it('empty cast -> null', () => {
    const bp = {
      title: 'Empty Facility',
      villains: [{ villainId: 'char-2', name: 'Dale Brennan' }],
      cast: [],
    } as unknown as Blueprint;

    expect(resolveBoundVillainId('villain', bp, [])).toBeNull();
  });
});

