import { describe, it, expect } from 'vitest';
import { BlueprintSchema } from './index';
import { normalizeBlueprint } from '../lib/normalizeBlueprint';
import blackIronMortuary from '../data/blueprints/black_iron_mortuary.json';
import silverRestLodge from '../data/blueprints/silver_rest_lodge.json';
import theRefinement from '../data/blueprints/the_refinement.json';

describe('BlueprintSchema Named Villain & Cast Invariants (HG4 Packet 5a)', () => {
  const validBaseBlueprint = {
    title: 'Observation Outpost',
    cast: [
      {
        id: 'char-1',
        name: 'Thomas Wright',
        role: 'Engineer',
        disposition: 'SURVIVOR',
        isEntity: false,
      },
      {
        id: 'char-2',
        name: 'Dale Brennan',
        role: 'Custodian',
        disposition: 'VILLAIN',
        isEntity: false,
      },
      {
        id: 'char-3',
        name: 'Arthur Pendelton',
        role: 'Administrator',
        disposition: 'VILLAIN',
        isEntity: false,
      },
      {
        id: 'char-4',
        name: 'David Keller',
        role: 'Technician',
        disposition: 'VILLAIN',
        isEntity: false,
      },
    ],
  };

  it('throws when defaultVillainId is not in the villains roster', () => {
    const bp = {
      ...validBaseBlueprint,
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
      ],
      defaultVillainId: 'char-3',
    };
    expect(() => BlueprintSchema.parse(bp)).toThrow(/defaultVillainId/);
  });

  it('throws when defaultVillainId does not match any cast member id when no roster is present', () => {
    const bp = {
      ...validBaseBlueprint,
      defaultVillainId: 'char-nonexistent',
    };
    expect(() => BlueprintSchema.parse(bp)).toThrow(/defaultVillainId/);
  });

  it('throws when two cast members have isUserCharacter: true', () => {
    const bp = {
      ...validBaseBlueprint,
      cast: [
        {
          id: 'char-1',
          name: 'Thomas Wright',
          role: 'Engineer',
          isUserCharacter: true,
        },
        {
          id: 'char-2',
          name: 'Dale Brennan',
          role: 'Custodian',
          isUserCharacter: true,
        },
      ],
    };
    expect(() => BlueprintSchema.parse(bp)).toThrow(/isUserCharacter/);
  });

  it('throws with the R10 message when more than 3 villains are authored', () => {
    const bp = {
      ...validBaseBlueprint,
      villains: [
        { villainId: 'char-1', name: 'Thomas Wright' },
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-3', name: 'Arthur Pendelton' },
        { villainId: 'char-4', name: 'David Keller' },
      ],
    };
    expect(() => BlueprintSchema.parse(bp)).toThrow(
      'R10: TTM supports 1-3 villains; a fourth is a design problem, not a schema problem.'
    );
  });

  it('throws when duplicate villainId values are present in the villains roster', () => {
    const bp = {
      ...validBaseBlueprint,
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-2', name: 'Dale Duplicate' },
      ],
    };
    expect(() => BlueprintSchema.parse(bp)).toThrow(/Duplicate villainId/);
  });

  it('throws when a roster villainId does not match any cast member id', () => {
    const bp = {
      ...validBaseBlueprint,
      villains: [
        { villainId: 'char-phantom-99', name: 'Phantom Figure' },
      ],
    };
    expect(() => BlueprintSchema.parse(bp)).toThrow(/does not match any cast member id/);
  });

  it('parses cleanly when 1-3 valid villains are authored with matching cast and valid defaultVillainId', () => {
    const bp = {
      ...validBaseBlueprint,
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-3', name: 'Arthur Pendelton' },
      ],
      defaultVillainId: 'char-2',
    };
    const parsed = BlueprintSchema.parse(bp);
    expect(parsed.villains).toHaveLength(2);
    expect(parsed.defaultVillainId).toBe('char-2');
  });

  it('parses cleanly at the boundary of exactly 3 villains', () => {
    const bp = {
      ...validBaseBlueprint,
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
        { villainId: 'char-3', name: 'Arthur Pendelton' },
        { villainId: 'char-4', name: 'David Keller' },
      ],
      defaultVillainId: 'char-4',
    };
    const parsed = BlueprintSchema.parse(bp);
    expect(parsed.villains).toHaveLength(3);
    expect(parsed.defaultVillainId).toBe('char-4');
  });

  it('parses cleanly with a single villain in roster', () => {
    const bp = {
      ...validBaseBlueprint,
      villains: [
        { villainId: 'char-2', name: 'Dale Brennan' },
      ],
      defaultVillainId: 'char-2',
    };
    const parsed = BlueprintSchema.parse(bp);
    expect(parsed.villains).toHaveLength(1);
    expect(parsed.defaultVillainId).toBe('char-2');
  });

  it('parses cleanly with valid defaultVillainId matching a cast member when no roster is authored', () => {
    const bp = {
      ...validBaseBlueprint,
      defaultVillainId: 'char-2',
    };
    const parsed = BlueprintSchema.parse(bp);
    expect(parsed.villains).toBeUndefined();
    expect(parsed.defaultVillainId).toBe('char-2');
  });

  it('parses the three canon blueprints unchanged', () => {
    expect(() => normalizeBlueprint(blackIronMortuary)).not.toThrow();
    expect(() => normalizeBlueprint(silverRestLodge)).not.toThrow();
    expect(() => normalizeBlueprint(theRefinement)).not.toThrow();

    const parsedMortuary = normalizeBlueprint(blackIronMortuary);
    expect(parsedMortuary.villains).toBeUndefined();
    expect(parsedMortuary.defaultVillainId).toBeUndefined();

    const parsedLodge = normalizeBlueprint(silverRestLodge);
    expect(parsedLodge.villains).toBeUndefined();
    expect(parsedLodge.defaultVillainId).toBeUndefined();

    const parsedRefinement = normalizeBlueprint(theRefinement);
    expect(parsedRefinement.villains).toBeUndefined();
    expect(parsedRefinement.defaultVillainId).toBeUndefined();
  });
});
