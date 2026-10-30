import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createNeutralSeed } from './neutralSeed';
import { normalizeLegacyBlueprintShape } from './normalizeBlueprint';
import { applySeedToState } from './seedApplication';
import { initialEngineState } from '../core/engine/reducer';
import { CharacterSeedSchema } from '../types/forge';
import { backfillSeedsForFile } from '../../scripts/backfill-seeds';
import type { Blueprint, CastMember } from '../types';

describe('Seed State v1 Invariants & Backfill', () => {
  const mortuaryPath = path.resolve(__dirname, '../data/blueprints/black_iron_mortuary.json');
  const silverRestPath = path.resolve(__dirname, '../data/blueprints/silver_rest_lodge.json');
  const theRefinementPath = path.resolve(__dirname, '../data/blueprints/the_refinement.json');
  const starlightMotelPath = path.resolve(__dirname, '../data/blueprints/starlight_motel.json');

  it('validates that neutral seed generation matches CharacterSeedSchema for all canon blueprints', () => {
    const blueprintFiles = [mortuaryPath, silverRestPath, theRefinementPath, starlightMotelPath];

    for (const filePath of blueprintFiles) {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const bp = JSON.parse(raw);

      for (const member of bp.cast || []) {
        const seed = member.seed || createNeutralSeed(member, bp);
        const parsed = CharacterSeedSchema.safeParse(seed);
        expect(parsed.success, `Schema validation failed for member ${member.id} in ${path.basename(filePath)}: ${!parsed.success ? JSON.stringify(parsed.error.issues) : ''}`).toBe(true);

        // Invariant: User characters have circumstance and inclination, but no wants
        if (member.isUserCharacter) {
          expect(seed.circumstance).toBeDefined();
          expect(seed.inclination).toBeDefined();
          expect(seed.wants).toBeUndefined();
        } else {
          // Invariant: NPCs have wants, but no circumstance or inclination
          expect(seed.wants).toBeDefined();
          expect(seed.circumstance).toBeUndefined();
          expect(seed.inclination).toBeUndefined();
        }
      }
    }
  });

  it('normalizes legacy unseeded blueprints by synthesizing neutral seeds (normalizeLegacyBlueprintShape)', () => {
    const rawMortuary = JSON.parse(fs.readFileSync(mortuaryPath, 'utf-8'));
    // Strip seeds to simulate a pre-migration legacy blueprint
    const legacyMortuary: Blueprint = {
      ...rawMortuary,
      cast: (rawMortuary.cast as Array<Record<string, unknown>>).map((c) => {
        const rest = { ...c };
        delete rest.seed;
        return rest;
      }),
    };

    // Ensure they have no seed
    expect(legacyMortuary.cast.every((c) => !c.seed)).toBe(true);

    const normalized = normalizeLegacyBlueprintShape(legacyMortuary) as Blueprint;

    // All cast members now possess a valid CharacterSeed
    expect(normalized.cast.every((c) => Boolean(c.seed))).toBe(true);
    for (const c of normalized.cast) {
      const parsed = CharacterSeedSchema.safeParse(c.seed);
      expect(parsed.success).toBe(true);
    }
  });

  it('preserves S1 invariant: state initialized from unseeded blueprint via neutral seed matches baseline turn-1 state modulo SEED provenance', () => {
    const rawMortuary = JSON.parse(fs.readFileSync(mortuaryPath, 'utf-8'));
    const rawSilverRest = JSON.parse(fs.readFileSync(silverRestPath, 'utf-8'));

    for (const rawBp of [rawMortuary, rawSilverRest]) {
      // 1. Unseeded version normalized through normalizeLegacyBlueprintShape
      const unseededBp: Blueprint = {
        ...rawBp,
        cast: (rawBp.cast as Array<Record<string, unknown>>).map((c) => {
          const rest = { ...c };
          delete rest.seed;
          return rest;
        }),
      };
      const normalizedUnseeded = normalizeLegacyBlueprintShape(unseededBp) as Blueprint;
      const stateFromUnseeded = applySeedToState(initialEngineState, normalizedUnseeded);

      // 2. Explicitly backfilled version
      const seededBp: Blueprint = {
        ...rawBp,
        cast: (rawBp.cast as Array<Record<string, unknown>>).map((c) => ({
          ...c,
          seed: c.seed || createNeutralSeed(c as unknown as CastMember, rawBp as unknown as Blueprint),
        })),
      };
      const stateFromSeeded = applySeedToState(initialEngineState, seededBp);

      // Verify that castPlacement matches
      expect(stateFromUnseeded.castPlacement).toEqual(stateFromSeeded.castPlacement);

      // Verify that salience dread/spike matches
      for (const member of rawBp.cast) {
        expect(stateFromUnseeded.salienceLedger?.[member.id]?.dread).toEqual(
          stateFromSeeded.salienceLedger?.[member.id]?.dread
        );
        expect(stateFromUnseeded.salienceLedger?.[member.id]?.spike).toEqual(
          stateFromSeeded.salienceLedger?.[member.id]?.spike
        );
      }

      // Verify user circumstance / inclination
      expect(stateFromUnseeded.userCircumstance).toEqual(stateFromSeeded.userCircumstance);
      expect(stateFromUnseeded.userInclination).toEqual(stateFromSeeded.userInclination);

      // Verify NPC wants
      expect(stateFromUnseeded.characterWants).toEqual(stateFromSeeded.characterWants);

      // Verify knowledge and bond counts match
      expect(Object.keys(stateFromUnseeded.knowledgeByCharacter || {})).toEqual(
        Object.keys(stateFromSeeded.knowledgeByCharacter || {})
      );
      expect(stateFromUnseeded.bondEdges?.length).toEqual(stateFromSeeded.bondEdges?.length);
    }
  });

  it('guarantees backfill idempotency on canon blueprints', () => {
    // Test on a temporary file clone to prevent side effects
    const tmpFile = path.resolve(__dirname, '../../scratch/tmp_blueprint_test.json');
    const raw = fs.readFileSync(mortuaryPath, 'utf-8');
    fs.writeFileSync(tmpFile, raw, 'utf-8');

    try {
      // First run: backfill seeds
      const pass1 = backfillSeedsForFile(tmpFile);
      // If already seeded or newly seeded, should have cast members
      expect(pass1.memberCount).toBeGreaterThan(0);

      // Second run: MUST NOT modify the file (idempotent)
      const pass2 = backfillSeedsForFile(tmpFile);
      expect(pass2.modified).toBe(false);
      expect(pass2.memberCount).toBe(pass1.memberCount);
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  describe('Starlight Motel Blueprint Seed Invariants (Item 15)', () => {
    it('verifies Starlight Motel has complete, non-empty, non-placeholder seed data for all 5 characters', () => {
      expect(fs.existsSync(starlightMotelPath)).toBe(true);
      const raw = fs.readFileSync(starlightMotelPath, 'utf-8');
      const bp = JSON.parse(raw);

      // Assert exactly 5 cast members
      expect(bp.cast).toHaveLength(5);
      const castIds = bp.cast.map((c: CastMember) => c.id);
      expect(castIds).toEqual([
        'char-frank-mercer',
        'char-paula-mercer',
        'char-tommy-beck',
        'char-rosa-delgado',
        'char-eddie-marsh',
      ]);

      // Check for forbidden placeholder patterns anywhere in JSON text
      expect(raw).not.toMatch(/"TODO"/i);
      expect(raw).not.toMatch(/"placeholder"/i);
      expect(raw).not.toMatch(/"TBD"/i);

      for (const member of bp.cast) {
        expect(member.seed, `Member ${member.id} must have a seed`).toBeDefined();
        const seed = member.seed;
        const parsed = CharacterSeedSchema.safeParse(seed);
        expect(parsed.success, `CharacterSeedSchema validation failed for ${member.id}`).toBe(true);

        // All characters have non-empty knows and bonds
        expect(seed.knows.length, `${member.id} knows must be non-empty`).toBeGreaterThan(0);
        for (const k of seed.knows) {
          expect(k.id.length).toBeGreaterThan(0);
          expect(k.text.length).toBeGreaterThan(0);
          expect(k.text).not.toContain('TODO');
        }

        expect(seed.bonds.length, `${member.id} bonds must be non-empty`).toBeGreaterThan(0);
        for (const b of seed.bonds) {
          expect(b.characterId.length).toBeGreaterThan(0);
          expect(['trust', 'distrust', 'unsure']).toContain(b.stance);
          if (b.note) {
            expect(b.note.length).toBeGreaterThan(0);
          }
        }

        // Doing is populated
        expect(seed.doing).toBeDefined();
        expect(seed.doing.mode).toBeDefined();

        // Check user character vs NPC invariants
        if (member.isUserCharacter) {
          expect(member.id).toBe('char-tommy-beck');
          expect(seed.circumstance).toBeDefined();
          expect(seed.circumstance.length).toBeGreaterThan(0);
          expect(seed.inclination).toBeDefined();
          expect(seed.inclination.length).toBeGreaterThan(0);
          expect(seed.wants).toBeUndefined();
        } else {
          expect(seed.wants).toBeDefined();
          expect(seed.wants.text.length).toBeGreaterThan(0);
          expect(seed.circumstance).toBeUndefined();
          expect(seed.inclination).toBeUndefined();
        }
      }
    });

    it('verifies applySeedToState cleanly populates engine state from Starlight Motel seed', () => {
      const raw = fs.readFileSync(starlightMotelPath, 'utf-8');
      const bp = JSON.parse(raw);
      const state = applySeedToState(initialEngineState, bp);

      // Placements
      expect(state.castPlacement['char-frank-mercer']).toBe('office');
      expect(state.castPlacement['char-paula-mercer']).toBe('office');
      expect(state.castPlacement['char-tommy-beck']).toBe('room_6');
      expect(state.castPlacement['char-rosa-delgado']).toBe('room_7');
      expect(state.castPlacement['char-eddie-marsh']).toBe('parking_lot');
      expect(state.currentNodeId).toBe('room_6');

      // User character circumstance and inclination
      expect(state.userCircumstance).toContain('salesman');
      expect(state.userInclination).toContain('Room 6');

      // NPC wants
      expect(state.characterWants['char-frank-mercer']?.text).toContain('storm traffic');
      expect(state.characterWants['char-paula-mercer']?.text).toContain('Count the rooms');
      expect(state.characterWants['char-rosa-delgado']?.text).toContain('Stay awake');
      expect(state.characterWants['char-eddie-marsh']?.text).toContain('Nobody bothers him');

      // Knowledge and bonds
      for (const member of bp.cast) {
        expect(state.knowledgeByCharacter[member.id]?.length).toBeGreaterThan(0);
      }
      expect(state.bondEdges?.length).toBeGreaterThanOrEqual(bp.cast.length);
    });

    it('verifies backfill idempotency on Starlight Motel blueprint', () => {
      const pass = backfillSeedsForFile(starlightMotelPath);
      expect(pass.memberCount).toBe(5);
      expect(pass.modified).toBe(false);
    });
  });
});

