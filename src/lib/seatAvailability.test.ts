import { describe, it, expect } from 'vitest';
import {
  resolveSeatAvailabilities,
  buildActiveParticipationContext,
} from './seatAvailability';
import {
  Blueprint,
  MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH,
  ParticipationContextSchema,
} from '../types';
import { normalizeBlueprint } from './normalizeBlueprint';

describe('Seat Availability Resolver & Participation Context Builder', () => {
  const baseBlueprint: Blueprint = normalizeBlueprint({
    title: 'Experimental Habitat',
    setting: {
      location: 'Sub-Level 3',
      timePeriod: '2099',
      atmosphere: 'Sterile fluorescent humming',
    },
    cast: [
      {
        id: 'char-protagonist',
        name: 'Dr. Jennifer Hayes',
        role: 'protagonist',
        isUserCharacter: true,
        isEntity: false,
        description: 'Biochemist trapped in the research sector.',
      },
      {
        id: 'char-antagonist',
        name: 'Specimen 404',
        role: 'antagonist',
        isUserCharacter: false,
        isEntity: true,
        description: 'Synthetic predator with thermal vision.',
      },
    ],
  });

  it('correctly resolves all 3 seats when both mortal protagonist and entity antagonist are present', () => {
    const seats = resolveSeatAvailabilities(baseBlueprint);

    expect(seats.protagonist.available).toBe(true);
    expect(seats.protagonist.boundCharacterName).toBe('Dr. Jennifer Hayes');
    expect(seats.protagonist.boundCharacterId).toBe('char-protagonist');

    expect(seats.antagonist.available).toBe(true);
    expect(seats.antagonist.boundCharacterName).toBeNull();
    expect(seats.antagonist.boundCharacterId).toBeNull();

    expect(seats.director.available).toBe(false);
    expect(seats.director.reason).toBe('Director mode is not yet built.');
    expect(seats.director.boundCharacterName).toBeNull();
  });

  it('marks Protagonist unavailable with reason when no mortal cast member exists', () => {
    const blueprint: Blueprint = normalizeBlueprint({
      ...baseBlueprint,
      cast: [
        {
          id: 'char-antagonist',
          name: 'The Spectral Void',
          role: 'antagonist',
          isEntity: true,
        },
      ],
    });

    const seats = resolveSeatAvailabilities(blueprint);

    expect(seats.protagonist.available).toBe(false);
    expect(seats.protagonist.reason).toBe('No mortal protagonist cast member found in blueprint.');
    expect(seats.protagonist.boundCharacterId).toBeNull();

    expect(seats.antagonist.available).toBe(true);
    expect(seats.director.available).toBe(false);
  });

  it('marks Antagonist unavailable with reason when no entity cast or antagonist perspective exists', () => {
    const blueprint: Blueprint = normalizeBlueprint({
      ...baseBlueprint,
      cast: [
        {
          id: 'char-protagonist',
          name: 'Scout Miller',
          role: 'protagonist',
          isEntity: false,
        },
      ],
    });

    const seats = resolveSeatAvailabilities(blueprint);

    expect(seats.protagonist.available).toBe(true);
    expect(seats.antagonist.available).toBe(false);
    expect(seats.antagonist.reason).toBe(
      'No antagonist entity or opposition authority found in blueprint.'
    );
    expect(seats.director.available).toBe(false);
  });

  it('marks Director unavailable with reason even when cast list is completely empty', () => {
    const blueprint: Blueprint = normalizeBlueprint({
      ...baseBlueprint,
      cast: [],
    });

    const seats = resolveSeatAvailabilities(blueprint);

    expect(seats.protagonist.available).toBe(false);
    expect(seats.antagonist.available).toBe(false);
    expect(seats.director.available).toBe(false);
    expect(seats.director.reason).toBe('Director mode is not yet built.');
    expect(seats.director.boundCharacterName).toBeNull();
  });

  it('buildActiveParticipationContext constructs distinct contexts for each role without mutating blueprint', () => {
    const protagContext = buildActiveParticipationContext(baseBlueprint, 'protagonist');
    expect(protagContext?.mode).toBe('protagonist');
    expect(protagContext?.seat.name).toBe('Dr. Jennifer Hayes');

    const antagContext = buildActiveParticipationContext(baseBlueprint, 'antagonist');
    expect(antagContext?.mode).toBe('antagonist');
    expect(antagContext?.seat.name).toBe('Specimen 404');

    const directorContext = buildActiveParticipationContext(baseBlueprint, 'director');
    expect(directorContext?.mode).toBe('director');
    expect(directorContext?.seat.kind).toBe('director');

    // Verify original blueprint was not mutated
    expect(baseBlueprint.cast).toHaveLength(2);
    expect(baseBlueprint.cast[0].name).toBe('Dr. Jennifer Hayes');
  });

  it('resolves Antagonist seat when Haunted House provenance indicates antagonist mode even without entity flag in cast', () => {
    const blueprint: Blueprint = normalizeBlueprint({
      title: 'Haunted Induction Test',
      setting: { location: 'Derelict Ship' },
      cast: [],
      hauntedHouse: {
        source: 'haunted-house',
        version: 1,
        recommendedParticipationMode: 'antagonist',
        participationContext: {
          mode: 'antagonist',
          seat: {
            kind: 'force',
            name: 'The Ship Entity',
          },
          initialGoal: 'Hunt remaining crew',
          boundedFacts: [],
        },
      },
    });

    const seats = resolveSeatAvailabilities(blueprint);
    expect(seats.antagonist.available).toBe(true);
    expect(seats.antagonist.boundCharacterName).toBeNull();
    expect(seats.antagonist.boundCharacterId).toBeNull();
  });

  it('buildActiveParticipationContext respects explicit resolvedCharacterId for non-default cast members', () => {
    const multiMortalBp = normalizeBlueprint({
      ...baseBlueprint,
      cast: [
        {
          id: 'char-elena',
          name: 'Elena Ward',
          role: 'Historian',
          isEntity: false,
          description: 'Senior archivist',
        },
        {
          id: 'char-marcus',
          name: 'Marcus Gray',
          role: 'Engineer',
          isEntity: false,
          description: 'Surveyor engineer',
        },
      ],
    });

    const context = buildActiveParticipationContext(multiMortalBp, 'protagonist', 'char-marcus');
    expect(context?.mode).toBe('protagonist');
    expect(context?.seat.name).toBe('Marcus Gray');
    expect(context?.seat.description).toBe('Surveyor engineer');
  });

  it('accepts a generated participation-seat summary up to 1,000 characters', () => {
    const summary = 'x'.repeat(MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH);
    const blueprint = normalizeBlueprint({
      ...baseBlueprint,
      cast: [
        {
          id: 'char-selected',
          name: 'Selected Mortal',
          role: 'Subject',
          isEntity: false,
          description: summary,
        },
      ],
    });

    const context = buildActiveParticipationContext(
      blueprint,
      'protagonist',
      'char-selected'
    );
    const parsed = ParticipationContextSchema.safeParse(context);

    expect(context?.seat.description).toHaveLength(1000);
    expect(parsed.success).toBe(true);
  });

  it('continues to reject participation-seat summaries over 1,000 characters', () => {
    const parsed = ParticipationContextSchema.safeParse({
      mode: 'protagonist',
      seat: {
        kind: 'protagonist',
        name: 'Selected Mortal',
        description: 'x'.repeat(MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH + 1),
      },
      initialGoal: 'Proceed through the enclosure.',
      boundedFacts: [],
    });

    expect(parsed.success).toBe(false);
  });

  it('correctly resolves Villain, Survivor, and Bystander seats for human predator scenario (e.g. American Psycho)', () => {
    const americanPsychoBlueprint: Blueprint = normalizeBlueprint({
      title: 'American Psycho - Manhattan Enclosure',
      setting: {
        location: "Evelyn's Townhouse",
        timePeriod: '1987',
        atmosphere: 'Polished marble, high-end caterers, underlying homicidal dread',
      },
      cast: [
        {
          id: 'char-bateman',
          name: 'Patrick Bateman',
          role: 'Vice President',
          isEntity: false,
          disposition: 'VILLAIN',
          description: 'Wealthy investment banker concealing escalating predatory impulses.',
        },
        {
          id: 'char-evelyn',
          name: 'Evelyn Williams',
          role: 'Fiancée',
          isEntity: false,
          disposition: 'SURVIVOR',
          description: 'Socialite trapped in shallow surface pleasantries.',
        },
        {
          id: 'char-waiter',
          name: 'Catering Waiter',
          role: 'Staff',
          isEntity: false,
          disposition: 'BYSTANDER',
          description: 'Temporary staff trying to get through the evening shift without incident.',
        },
      ],
    });

    const seats = resolveSeatAvailabilities(americanPsychoBlueprint);

    // Villain seat should be available and un-pre-bound
    expect(seats.villain.available).toBe(true);
    expect(seats.villain.boundCharacterName).toBeNull();
    expect(seats.villain.boundCharacterId).toBeNull();

    // Survivor seat should be available and bound to Evelyn
    expect(seats.survivor.available).toBe(true);
    expect(seats.survivor.boundCharacterName).toBe('Evelyn Williams');
    expect(seats.survivor.boundCharacterId).toBe('char-evelyn');

    // Bystander seat should be available and bound to Waiter
    expect(seats.bystander.available).toBe(true);
    expect(seats.bystander.boundCharacterName).toBe('Catering Waiter');
    expect(seats.bystander.boundCharacterId).toBe('char-waiter');

    // Director seat is not yet built
    expect(seats.director.available).toBe(false);
    expect(seats.director.reason).toBe('Director mode is not yet built.');

    // Active context for Villain
    const villainContext = buildActiveParticipationContext(
      americanPsychoBlueprint,
      'villain',
      'char-bateman'
    );
    expect(villainContext?.mode).toBe('villain');
    expect(villainContext?.seat.name).toBe('Patrick Bateman');
    expect(villainContext?.authorityContract?.authority).toContain('stalk');
    expect(villainContext?.victimField?.kind).toBe('group');
    if (villainContext?.victimField?.kind === 'group') {
      expect(villainContext.victimField.members?.some((m) => m.name === 'Evelyn Williams')).toBe(true);
    }

    // Active context for Bystander
    const bystanderContext = buildActiveParticipationContext(
      americanPsychoBlueprint,
      'bystander',
      'char-waiter'
    );
    expect(bystanderContext?.mode).toBe('bystander');
    expect(bystanderContext?.seat.name).toBe('Catering Waiter');
    expect(bystanderContext?.initialGoal).toContain('Mind your own business');

    // Active context for Survivor
    const survivorContext = buildActiveParticipationContext(
      americanPsychoBlueprint,
      'survivor',
      'char-evelyn'
    );
    expect(survivorContext?.mode).toBe('survivor');
    expect(survivorContext?.seat.name).toBe('Evelyn Williams');
  });

  describe('Villain-Protagonist Engine Model (§4a, §4b, §4c, §4d)', () => {
    it('correctly identifies opposition cast members with isOppositionCastMember', async () => {
      const { isOppositionCastMember } = await import('./castVillain');
      expect(isOppositionCastMember({ role: 'Police Detective', name: 'Miller', isEntity: false })).toBe(true);
      expect(isOppositionCastMember({ role: 'Lead Investigator', name: 'Elena', isEntity: false })).toBe(true);
      expect(isOppositionCastMember({ role: 'Sheriff', name: 'Holt', isEntity: false })).toBe(true);
      expect(isOppositionCastMember({ role: 'Colleague', name: 'Paul Allen', isEntity: false })).toBe(false);
      expect(isOppositionCastMember({ role: 'Investigator', name: 'Ghost', isEntity: true })).toBe(false);
      expect(isOppositionCastMember(null)).toBe(false);
    });

    const vCast = [
      {
        id: 'char-villain',
        name: 'Patrick Bateman',
        role: 'Vice President',
        disposition: 'VILLAIN',
        isEntity: false,
        goals: 'Maintain flawless facade while sating urge.',
        traits: ['vain', 'narcissistic'],
      },
      {
        id: 'char-survivor',
        name: 'Jean Secretary',
        role: 'Secretary',
        disposition: 'SURVIVOR',
        isEntity: false,
        goals: 'Keep schedule organized and survive the week.',
        traits: ['diligent', 'innocent'],
      },
      {
        id: 'char-opposition',
        name: 'Donald Kimball',
        role: 'Private Detective',
        disposition: 'SURVIVOR',
        isEntity: false,
        goals: 'Investigate Paul Allen disappearance.',
        traits: ['methodical', 'skeptical'],
      },
    ];

    it('binds villain to protagonist/villain and investigator to antagonist when villainProtagonist is true', () => {
      const bp: Blueprint = normalizeBlueprint({
        title: 'Manhattan Nights',
        villainProtagonist: true,
        cast: vCast,
      });

      const seats = resolveSeatAvailabilities(bp);

      // Protagonist seat binds villain
      expect(seats.protagonist.available).toBe(true);
      expect(seats.protagonist.boundCharacterId).toBe('char-villain');
      expect(seats.protagonist.boundCharacterName).toBe('Patrick Bateman');

      // Villain seat binds villain
      expect(seats.villain.available).toBe(true);
      expect(seats.villain.boundCharacterId).toBe('char-villain');
      expect(seats.villain.boundCharacterName).toBe('Patrick Bateman');

      // Antagonist seat binds opposition
      expect(seats.antagonist.available).toBe(true);
      expect(seats.antagonist.boundCharacterId).toBe('char-opposition');
      expect(seats.antagonist.boundCharacterName).toBe('Donald Kimball');

      // Survivor seat binds survivor
      expect(seats.survivor.available).toBe(true);
      expect(seats.survivor.boundCharacterId).toBe('char-survivor');
      expect(seats.survivor.boundCharacterName).toBe('Jean Secretary');
    });

    it('marks antagonist seat unavailable when villainProtagonist is true and no opposition exists', () => {
      const bp: Blueprint = normalizeBlueprint({
        title: 'Solitary Predator',
        villainProtagonist: true,
        cast: [vCast[0], vCast[1]], // V + S, no investigator
      });

      const seats = resolveSeatAvailabilities(bp);
      expect(seats.protagonist.available).toBe(true);
      expect(seats.protagonist.boundCharacterId).toBe('char-villain');

      expect(seats.antagonist.available).toBe(false);
      expect(seats.antagonist.reason).toBe(
        'The villain is the protagonist; no separate opposition figure exists in cast.'
      );
      expect(seats.antagonist.boundCharacterId).toBeNull();
    });

    it('preserves standard seat resolution when villainProtagonist is false', () => {
      const bp: Blueprint = normalizeBlueprint({
        title: 'Standard Enclosure',
        villainProtagonist: false,
        cast: vCast,
      });

      const seats = resolveSeatAvailabilities(bp);
      // Standard protagonist binds top mortal survivor
      expect(seats.protagonist.available).toBe(true);
      expect(seats.protagonist.boundCharacterId).toBe('char-survivor');
    });

    it('builds active participation context for villain-protagonist with victimField and camouflage', () => {
      const bp: Blueprint = normalizeBlueprint({
        title: 'Manhattan Nights',
        villainProtagonist: true,
        cast: vCast,
      });

      const context = buildActiveParticipationContext(bp, 'protagonist');
      expect(context).not.toBeNull();
      expect(context?.mode).toBe('protagonist');
      expect(context?.seat.name).toBe('Patrick Bateman');
      expect(context?.boundedFacts).toContain('Social Camouflage: Active');
      expect(context?.boundedFacts?.some((f) => f.includes('Maintain flawless facade'))).toBe(true);
      expect(context?.victimField).toBeDefined();
      expect(context?.victimField?.kind).toBe('group');
      if (context?.victimField?.kind === 'group') {
        expect(context.victimField.members?.some((m) => m.name === 'Jean Secretary')).toBe(true);
        expect(context.victimField.members?.some((m) => m.name === 'Donald Kimball')).toBe(true);
      }
    });

    it('builds active participation context for opposition antagonist with investigative framing', () => {
      const bp: Blueprint = normalizeBlueprint({
        title: 'Manhattan Nights',
        villainProtagonist: true,
        cast: vCast,
      });

      const context = buildActiveParticipationContext(bp, 'antagonist');
      expect(context).not.toBeNull();
      expect(context?.mode).toBe('antagonist');
      expect(context?.seat.name).toBe('Donald Kimball');
      expect(context?.authorityContract?.authority).toContain('Authorized to investigate');
      expect(context?.authorityContract?.limits).toContain('Bound by evidence');
      expect(context?.initialGoal).toContain('Investigate Paul Allen disappearance');
      expect(context?.victimField).toBeUndefined();
    });

    it('villainProtagonist: true + defaultVillainId: protagonist seat availability resolves the default-bound member', () => {
      const bp: Blueprint = normalizeBlueprint({
        title: 'Cold Storage Terminal',
        villainProtagonist: true,
        villains: [
          { villainId: 'char-villain-1', name: 'Dale Brennan' },
          { villainId: 'char-villain-2', name: 'Arthur Pendelton' },
        ],
        defaultVillainId: 'char-villain-2',
        cast: [
          {
            id: 'char-villain-1',
            name: 'Dale Brennan',
            role: 'Foreman',
            disposition: 'VILLAIN',
            isEntity: false,
          },
          {
            id: 'char-villain-2',
            name: 'Arthur Pendelton',
            role: 'Inspector',
            disposition: 'VILLAIN',
            isEntity: false,
          },
          {
            id: 'char-survivor',
            name: 'Gordon Cole',
            role: 'Technician',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
        ],
      });

      const seats = resolveSeatAvailabilities(bp);
      expect(seats.protagonist.available).toBe(true);
      expect(seats.protagonist.boundCharacterId).toBe('char-villain-2');
      expect(seats.protagonist.boundCharacterName).toBe('Arthur Pendelton');
      expect(seats.villain.boundCharacterId).toBe('char-villain-2');
      expect(seats.villain.boundCharacterName).toBe('Arthur Pendelton');
    });
  });

  describe('Honest seat availability guarantees', () => {
    it('marks bystander unavailable when blueprint has survivor but no BYSTANDER disposition', () => {
      const bp = normalizeBlueprint({
        ...baseBlueprint,
        cast: [
          {
            id: 'char-survivor-only',
            name: 'Sole Survivor',
            role: 'Engineer',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
        ],
      });

      const seats = resolveSeatAvailabilities(bp);
      expect(seats.bystander.available).toBe(false);
      expect(seats.bystander.reason).toBe('No bystander or civilian cast member found in blueprint.');
      expect(seats.bystander.boundCharacterId).toBeNull();
      expect(seats.bystander.boundCharacterName).toBeNull();
    });

    it('marks director unavailable with "Director mode is not yet built."', () => {
      const seats = resolveSeatAvailabilities(baseBlueprint);
      expect(seats.director.available).toBe(false);
      expect(seats.director.reason).toBe('Director mode is not yet built.');
      expect(seats.director.boundCharacterId).toBeNull();
      expect(seats.director.boundCharacterName).toBeNull();
    });

    it('does not silently pre-bind villain on multi-villain blueprints', () => {
      const bp = normalizeBlueprint({
        title: 'Multi-Villain Bunker',
        cast: [
          {
            id: 'v-alpha',
            name: 'Alpha Warden',
            role: 'Warden',
            disposition: 'VILLAIN',
            isEntity: false,
          },
          {
            id: 'v-beta',
            name: 'Beta Warden',
            role: 'Enforcer',
            disposition: 'VILLAIN',
            isEntity: false,
          },
          {
            id: 's-one',
            name: 'Prisoner',
            role: 'Inmate',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
        ],
      });

      const seats = resolveSeatAvailabilities(bp);
      expect(seats.villain.available).toBe(true);
      expect(seats.villain.boundCharacterId).toBeNull();
      expect(seats.villain.boundCharacterName).toBeNull();
      expect(seats.antagonist.available).toBe(true);
      expect(seats.antagonist.boundCharacterId).toBeNull();
      expect(seats.antagonist.boundCharacterName).toBeNull();
    });
  });
});
