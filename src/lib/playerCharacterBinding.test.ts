import { describe, it, expect } from 'vitest';
import {
  resolvePerspectiveBinding,
  isCharacterEligibleForRole,
  PlayerCharacterBindingError,
} from './playerCharacterBinding';
import { normalizeBlueprint } from './normalizeBlueprint';

describe('playerCharacterBinding', () => {
  const genericBlueprint = normalizeBlueprint({
    title: 'Generic Enclosure',
    contentScale: 3,
    contentLevelDescription: 'Standard',
    globalPremise: 'A generic test premise.',
    environmentalRules: ['Rule 1'],
    cast: [
      {
        id: 'char-1',
        name: 'Mortal One',
        role: 'Specialist',
        description: 'First generic mortal subject.',
        personality: 'Cautious',
        goals: 'Survive',
        traits: ['Observant'],
        isEntity: false,
      },
      {
        id: 'char-2',
        name: 'Mortal Two',
        role: 'Operator',
        description: 'Second generic mortal subject.',
        personality: 'Pragmatic',
        goals: 'Repair systems',
        traits: ['Analytical'],
        isEntity: false,
      },
      {
        id: 'entity-1',
        name: 'Entity One',
        role: 'Apparition',
        description: 'First generic entity presence.',
        personality: 'Hostile',
        goals: 'Isolate subjects',
        traits: ['Incorporeal'],
        isEntity: true,
      },
    ],
    setting: {
      location: 'Chamber 01',
      timePeriod: 'Present',
      atmosphere: 'Sterile',
    },
    narrativeRules: {
      incitingIncident: 'System alert triggered.',
    },
    topology: {
      nodes: ['CHAMBER_01', 'CHAMBER_02'],
      connections: [],
    },
  });

  describe('isCharacterEligibleForRole', () => {
    it('identifies all cast members as eligible for embodied roles', () => {
      const mortal = genericBlueprint.cast[0];
      const entity = genericBlueprint.cast[2];
      expect(isCharacterEligibleForRole(mortal, 'protagonist')).toBe(true);
      expect(isCharacterEligibleForRole(mortal, 'antagonist')).toBe(true);
      expect(isCharacterEligibleForRole(mortal, 'possessed')).toBe(true);
      expect(isCharacterEligibleForRole(entity, 'protagonist')).toBe(true);
      expect(isCharacterEligibleForRole(entity, 'antagonist')).toBe(true);
      expect(isCharacterEligibleForRole(entity, 'possessed')).toBe(true);
    });
  });

  describe('resolvePerspectiveBinding with explicit selection', () => {
    it('binds explicitly to non-default mortal for protagonist (second eligible)', () => {
      const binding = resolvePerspectiveBinding(genericBlueprint, 'protagonist', 'char-2');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-2',
        perspectiveMode: 'embodied',
      });
    });

    it('binds explicitly to entity for antagonist', () => {
      const binding = resolvePerspectiveBinding(genericBlueprint, 'antagonist', 'entity-1');
      expect(binding).toEqual({
        playerRole: 'antagonist',
        characterId: 'entity-1',
        perspectiveMode: 'entity_embodied',
      });
    });

    it('binds explicitly to entity for protagonist (universal cast eligibility)', () => {
      const binding = resolvePerspectiveBinding(genericBlueprint, 'protagonist', 'entity-1');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'entity-1',
        perspectiveMode: 'embodied',
      });
    });

    it('binds explicitly to mortal for antagonist (universal cast eligibility)', () => {
      const binding = resolvePerspectiveBinding(genericBlueprint, 'antagonist', 'char-1');
      expect(binding).toEqual({
        playerRole: 'antagonist',
        characterId: 'char-1',
        perspectiveMode: 'entity_embodied',
      });
    });

    it('throws NON_EMBODIED_ROLE when attempting explicit character binding for director or witness', () => {
      expect(() => {
        resolvePerspectiveBinding(genericBlueprint, 'director', 'char-1');
      }).toThrow(PlayerCharacterBindingError);

      try {
        resolvePerspectiveBinding(genericBlueprint, 'director', 'char-1');
      } catch (err) {
        expect((err as PlayerCharacterBindingError).code).toBe('NON_EMBODIED_ROLE');
      }

      expect(() => {
        resolvePerspectiveBinding(genericBlueprint, 'witness', 'char-1');
      }).toThrow(PlayerCharacterBindingError);

      try {
        resolvePerspectiveBinding(genericBlueprint, 'witness', 'char-1');
      } catch (err) {
        expect((err as PlayerCharacterBindingError).code).toBe('NON_EMBODIED_ROLE');
      }
    });
  });

  describe('resolvePerspectiveBinding with default binding (undefined)', () => {
    it('defaults protagonist to first mortal member when no authored perspectives exist', () => {
      const binding = resolvePerspectiveBinding(genericBlueprint, 'protagonist');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-1',
        perspectiveMode: 'embodied',
      });
    });

    it('defaults antagonist to first entity member when no authored perspectives exist', () => {
      const binding = resolvePerspectiveBinding(genericBlueprint, 'antagonist');
      expect(binding).toEqual({
        playerRole: 'antagonist',
        characterId: 'entity-1',
        perspectiveMode: 'entity_embodied',
      });
    });

    it('binds to authored subjectCharacterId from top-level Blueprint.perspectives array', () => {
      const blueprintWithPerspectives = normalizeBlueprint({
        ...genericBlueprint,
        perspectives: [
          {
            role: 'PROTAGONIST',
            subjectCharacterId: 'char-2',
            mode: 'embodied',
          },
          {
            role: 'ANTAGONIST',
            subjectCharacterId: 'entity-1',
            mode: 'entity_embodied',
          },
        ],
      });

      const protagBinding = resolvePerspectiveBinding(blueprintWithPerspectives, 'protagonist');
      expect(protagBinding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-2',
        perspectiveMode: 'embodied',
      });

      const antagBinding = resolvePerspectiveBinding(blueprintWithPerspectives, 'antagonist');
      expect(antagBinding).toEqual({
        playerRole: 'antagonist',
        characterId: 'entity-1',
        perspectiveMode: 'entity_embodied',
      });
    });

    it('proves hauntedHouse is not read for perspectives array and top-level takes precedence', () => {
      const blueprintWithHauntedHouse = normalizeBlueprint({
        ...genericBlueprint,
        perspectives: [
          {
            role: 'PROTAGONIST',
            subjectCharacterId: 'char-2',
          },
        ],
        hauntedHouse: {
          source: 'haunted-house',
          version: 1,
          recommendedParticipationMode: 'protagonist',
          participationContext: {
            mode: 'protagonist',
            initialGoal: 'Escape',
            boundedFacts: [],
          },
        },
      });

      const binding = resolvePerspectiveBinding(blueprintWithHauntedHouse, 'protagonist');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-2',
        perspectiveMode: 'embodied',
      });
    });

    it('defaults director to perspectiveMode director with characterId null', () => {
      const directorBinding = resolvePerspectiveBinding(genericBlueprint, 'director');
      expect(directorBinding).toEqual({
        playerRole: 'director',
        characterId: null,
        perspectiveMode: 'director',
      });
    });

    it('defaults witness to perspectiveMode witness with characterId null', () => {
      const witnessBinding = resolvePerspectiveBinding(genericBlueprint, 'witness');
      expect(witnessBinding).toEqual({
        playerRole: 'witness',
        characterId: null,
        perspectiveMode: 'witness',
      });
    });

    it('Forge 1C-6: resolves blueprint.userCharacterId strictly for protagonist', () => {
      const blueprintWithUserChar = normalizeBlueprint({
        ...genericBlueprint,
        userCharacterId: 'char-2',
      });

      const binding = resolvePerspectiveBinding(blueprintWithUserChar, 'protagonist');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-2',
        perspectiveMode: 'embodied',
      });
    });

    it('honors explicit selection over legacy blueprint.userCharacterId', () => {
      const blueprintWithUserChar = normalizeBlueprint({
        ...genericBlueprint,
        userCharacterId: 'char-1',
      });

      const binding = resolvePerspectiveBinding(blueprintWithUserChar, 'protagonist', 'char-2');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-2',
        perspectiveMode: 'embodied',
      });
    });

    it('Forge 1C-6: throws UNKNOWN_CHARACTER_ID if blueprint.userCharacterId is not in cast', () => {
      const invalidBlueprint = normalizeBlueprint({
        ...genericBlueprint,
        userCharacterId: 'char-nonexistent',
      });

      expect(() => {
        resolvePerspectiveBinding(invalidBlueprint, 'protagonist');
      }).toThrow(PlayerCharacterBindingError);
    });

    it('binds villain member to protagonist when villainProtagonist is true even when survivor exists and no isUserCharacter is set', () => {
      const bp = normalizeBlueprint({
        ...genericBlueprint,
        villainProtagonist: true,
        cast: [
          {
            id: 'char-survivor-1',
            name: 'Elena Mercer',
            role: 'Specialist',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
          {
            id: 'char-villain-1',
            name: 'Patrick Bateman',
            role: 'Executive',
            disposition: 'VILLAIN',
            isEntity: false,
          },
        ],
      });

      const binding = resolvePerspectiveBinding(bp, 'protagonist');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-villain-1',
        perspectiveMode: 'embodied',
      });
    });

    it('explicit userCharacterId still wins over villainProtagonist flag', () => {
      const bp = normalizeBlueprint({
        ...genericBlueprint,
        villainProtagonist: true,
        userCharacterId: 'char-survivor-1',
        cast: [
          {
            id: 'char-survivor-1',
            name: 'Elena Mercer',
            role: 'Specialist',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
          {
            id: 'char-villain-1',
            name: 'Patrick Bateman',
            role: 'Executive',
            disposition: 'VILLAIN',
            isEntity: false,
          },
        ],
      });

      const binding = resolvePerspectiveBinding(bp, 'protagonist');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-survivor-1',
        perspectiveMode: 'embodied',
      });
    });
  });

  describe('HG4 Packet 5a: Named Villain Binding (B1)', () => {
    it('Villain seat, legacy blueprint (no roster): binds first VILLAIN-disposition cast member', () => {
      const bp = normalizeBlueprint({
        ...genericBlueprint,
        cast: [
          {
            id: 'char-survivor-1',
            name: 'Thomas Wright',
            role: 'Technician',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
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
        ],
      });

      const binding = resolvePerspectiveBinding(bp, 'villain');
      expect(binding).toEqual({
        playerRole: 'villain',
        characterId: 'char-villain-1',
        perspectiveMode: 'entity_embodied',
      });
    });

    it('Villain seat, roster + defaultVillainId: binds the default villain cast member', () => {
      const bp = normalizeBlueprint({
        ...genericBlueprint,
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
        ],
      });

      const binding = resolvePerspectiveBinding(bp, 'villain');
      expect(binding).toEqual({
        playerRole: 'villain',
        characterId: 'char-villain-2',
        perspectiveMode: 'entity_embodied',
      });
    });

    it('villainProtagonist: true + isUserCharacter villain: binds that villain (first preference)', () => {
      const bp = normalizeBlueprint({
        ...genericBlueprint,
        villainProtagonist: true,
        defaultVillainId: 'char-villain-2',
        villains: [
          { villainId: 'char-villain-1', name: 'Dale Brennan' },
          { villainId: 'char-villain-2', name: 'Arthur Pendelton' },
        ],
        cast: [
          {
            id: 'char-villain-1',
            name: 'Dale Brennan',
            role: 'Foreman',
            disposition: 'VILLAIN',
            isEntity: false,
            isUserCharacter: true,
          },
          {
            id: 'char-villain-2',
            name: 'Arthur Pendelton',
            role: 'Inspector',
            disposition: 'VILLAIN',
            isEntity: false,
            isUserCharacter: false,
          },
        ],
      });

      const binding = resolvePerspectiveBinding(bp, 'protagonist');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-villain-1',
        perspectiveMode: 'embodied',
      });
    });

    it('villainProtagonist: true + defaultVillainId, no user marking: binds the default villain', () => {
      const bp = normalizeBlueprint({
        ...genericBlueprint,
        villainProtagonist: true,
        defaultVillainId: 'char-villain-2',
        villains: [
          { villainId: 'char-villain-1', name: 'Dale Brennan' },
          { villainId: 'char-villain-2', name: 'Arthur Pendelton' },
        ],
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
        ],
      });

      const binding = resolvePerspectiveBinding(bp, 'protagonist');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-villain-2',
        perspectiveMode: 'embodied',
      });
    });

    it('villainProtagonist: true, no marking, no default: legacy chain unchanged', () => {
      const bp = normalizeBlueprint({
        ...genericBlueprint,
        villainProtagonist: true,
        cast: [
          {
            id: 'char-survivor-1',
            name: 'Thomas Wright',
            role: 'Technician',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
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
        ],
      });

      const binding = resolvePerspectiveBinding(bp, 'protagonist');
      expect(binding).toEqual({
        playerRole: 'protagonist',
        characterId: 'char-villain-1',
        perspectiveMode: 'embodied',
      });
    });

    it('Villain seat, no villains in cast: binds cast[0] fallback', () => {
      const bp = normalizeBlueprint({
        ...genericBlueprint,
        cast: [
          {
            id: 'char-survivor-1',
            name: 'Thomas Wright',
            role: 'Technician',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
          {
            id: 'char-survivor-2',
            name: 'Gordon Cole',
            role: 'Operator',
            disposition: 'SURVIVOR',
            isEntity: false,
          },
        ],
      });

      const binding = resolvePerspectiveBinding(bp, 'villain');
      expect(binding).toEqual({
        playerRole: 'villain',
        characterId: 'char-survivor-1',
        perspectiveMode: 'entity_embodied',
      });
    });
  });
});
