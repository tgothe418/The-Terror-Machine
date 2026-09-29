import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  TEXTURE_DOMINANCE_THRESHOLD,
  TEXTURE_DIRECTIVES,
  classifyFearTexture,
  formatFearTextureLine,
} from './fearTexture';
import { formatSomaticStatePrompt } from './fearEngine';
import type { CharacterSalience } from '../types/fear';

describe('HG3 Packet T-01 — Fear Texture Injection (Spike/Dread Prose Differentiation)', () => {
  describe('Constants and Exports', () => {
    it('exports the locked TEXTURE_DOMINANCE_THRESHOLD of 0.60', () => {
      expect(TEXTURE_DOMINANCE_THRESHOLD).toBe(0.6);
    });

    it('exports locked TEXTURE_DIRECTIVES with exact clause text', () => {
      expect(TEXTURE_DIRECTIVES.DREAD).toBe('heavy, atmospheric; time slows, fixate on mundane detail.');
      expect(TEXTURE_DIRECTIVES.SPIKE).toBe('sharp, visceral, localized; sudden sensory interrupts, involuntary micro-movements.');
      expect(TEXTURE_DIRECTIVES.DREAD_CLAUSE).toBe('heavy, atmospheric; time slows, fixate on mundane detail');
      expect(TEXTURE_DIRECTIVES.SPIKE_CLAUSE).toBe('sharp, visceral, localized; sudden sensory interrupts, involuntary micro-movements');
    });
  });

  describe('classifyFearTexture — Boundary and Dominance Classification', () => {
    it('classifies exact boundary shares accurately', () => {
      // share = spike / (spike + dread)
      // share = 0.60 -> SPIKE (spike = 6, dread = 4)
      expect(classifyFearTexture(0.6, 0.4)).toBe('SPIKE');

      // share = 0.61 -> SPIKE (spike = 6.1, dread = 3.9)
      expect(classifyFearTexture(0.61, 0.39)).toBe('SPIKE');

      // share = 0.59 -> BLENDED (spike = 5.9, dread = 4.1)
      expect(classifyFearTexture(0.59, 0.41)).toBe('BLENDED');

      // share = 0.41 -> BLENDED (spike = 4.1, dread = 5.9)
      expect(classifyFearTexture(0.41, 0.59)).toBe('BLENDED');

      // share = 0.40 -> DREAD (spike = 4.0, dread = 6.0)
      expect(classifyFearTexture(0.4, 0.6)).toBe('DREAD');

      // share = 0.39 -> DREAD (spike = 3.9, dread = 6.1)
      expect(classifyFearTexture(0.39, 0.61)).toBe('DREAD');
    });

    it('classifies extreme single-layer values correctly', () => {
      // spike-only -> SPIKE
      expect(classifyFearTexture(0.8, 0)).toBe('SPIKE');
      expect(classifyFearTexture(1.0, 0)).toBe('SPIKE');

      // dread-only -> DREAD
      expect(classifyFearTexture(0, 0.8)).toBe('DREAD');
      expect(classifyFearTexture(0, 1.0)).toBe('DREAD');
    });

    it('returns null when total salience is zero or non-positive', () => {
      expect(classifyFearTexture(0, 0)).toBeNull();
      expect(classifyFearTexture(-0.5, 0)).toBeNull();
      expect(classifyFearTexture(NaN, 0)).toBeNull();
      expect(classifyFearTexture(0, NaN)).toBeNull();
    });

    it('formalizes scale invariance (Locked Decision 6): texture is invariant to uniform scaling k > 0', () => {
      const pairs = [
        [0.7, 0.3], // SPIKE
        [0.2, 0.8], // DREAD
        [0.5, 0.5], // BLENDED
        [0.45, 0.55], // BLENDED (dread larger)
        [0.55, 0.45], // BLENDED (spike larger)
      ];

      const multipliers = [0.01, 0.1, 0.5, 0.75, 1.0, 2.0, 5.0, 10.0];

      for (const [spike, dread] of pairs) {
        const baseline = classifyFearTexture(spike, dread);
        for (const k of multipliers) {
          expect(classifyFearTexture(spike * k, dread * k)).toBe(baseline);
        }
      }
    });
  });

  describe('formatFearTextureLine — Injection String Snapshots & BLENDED Ordering', () => {
    it('formats exact injection string for DREAD-dominant texture', () => {
      const line = formatFearTextureLine('DREAD', 0.2, 0.8);
      expect(line).toBe(
        '[Fear texture: DREAD-dominant (tonic) — heavy, atmospheric; time slows, fixate on mundane detail.]'
      );
    });

    it('formats exact injection string for SPIKE-dominant texture', () => {
      const line = formatFearTextureLine('SPIKE', 0.8, 0.2);
      expect(line).toBe(
        '[Fear texture: SPIKE-dominant (phasic) — sharp, visceral, localized; sudden sensory interrupts, involuntary micro-movements.]'
      );
    });

    it('formats exact injection string for BLENDED texture with DREAD > SPIKE (dread clauses first)', () => {
      const line = formatFearTextureLine('BLENDED', 0.45, 0.55);
      expect(line).toBe(
        '[Fear texture: BLENDED (tonic+phasic) — heavy, atmospheric; time slows, fixate on mundane detail; sharp, visceral, localized; sudden sensory interrupts, involuntary micro-movements.]'
      );
    });

    it('formats exact injection string for BLENDED texture with SPIKE > DREAD (spike clauses first)', () => {
      const line = formatFearTextureLine('BLENDED', 0.55, 0.45);
      expect(line).toBe(
        '[Fear texture: BLENDED (tonic+phasic) — sharp, visceral, localized; sudden sensory interrupts, involuntary micro-movements; heavy, atmospheric; time slows, fixate on mundane detail.]'
      );
    });

    it('formats exact injection string for BLENDED texture with equal shares (deterministic dread-first)', () => {
      const line = formatFearTextureLine('BLENDED', 0.5, 0.5);
      expect(line).toBe(
        '[Fear texture: BLENDED (tonic+phasic) — heavy, atmospheric; time slows, fixate on mundane detail; sharp, visceral, localized; sudden sensory interrupts, involuntary micro-movements.]'
      );
    });
  });

  describe('Budget Guard Ratchet (Anti-Bloat)', () => {
    it('ensures formatted texture line is <= 240 characters for all variants', () => {
      const variants: Array<[Parameters<typeof formatFearTextureLine>[0], number, number]> = [
        ['DREAD', 0.1, 0.9],
        ['SPIKE', 0.9, 0.1],
        ['BLENDED', 0.45, 0.55],
        ['BLENDED', 0.55, 0.45],
        ['BLENDED', 0.5, 0.5],
      ];

      for (const [texture, spike, dread] of variants) {
        const line = formatFearTextureLine(texture, spike, dread);
        expect(line.length).toBeLessThanOrEqual(240);
      }
    });

    it('ensures total somatic + texture injection per character is <= 2 lines', () => {
      const salienceLedger: Record<string, CharacterSalience> = {
        'test-character': {
          spike: 0.2,
          dread: 0.6,
          threatType: 'life',
          provenance: [],
          preyMode: false,
        },
      };
      const cast = [{ id: 'test-character', name: 'Test Character' }];

      const formatted = formatSomaticStatePrompt(salienceLedger, cast, {});
      expect(formatted).not.toBeNull();
      const lines = formatted!.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('[SOMATIC STATE: Test Character');
      expect(lines[1]).toContain('[Fear texture:');
    });

    it('verifies that no numeric intensity or percentages leak into injection output', () => {
      const salienceLedger: Record<string, CharacterSalience> = {
        'test-character': {
          spike: 0.354,
          dread: 0.521,
          threatType: 'life',
          provenance: [],
          preyMode: false,
        },
      };
      const cast = [{ id: 'test-character', name: 'Test Character' }];

      const formatted = formatSomaticStatePrompt(salienceLedger, cast, {});
      expect(formatted).not.toBeNull();

      // Ensure no decimal digits like "0.35" or percentage "%" or raw intensity numbers
      expect(formatted).not.toMatch(/\d+\.\d+/);
      expect(formatted).not.toMatch(/\d+%/);
    });
  });

  describe('Overload Snapshot Test (Locked Decision 7)', () => {
    it('ensures (characterName, band, tokens) overload is byte-identical to pre-packet behavior', () => {
      const output = formatSomaticStatePrompt('Dale Brennan', 2, [
        'HAND_TREMOR',
        'COLD_SWEAT',
      ]);
      expect(output).toBe('[SOMATIC STATE: Dale Brennan (Band 2: HAND_TREMOR, COLD_SWEAT)]');
    });

    it('returns null for zero band or empty tokens in direct overload', () => {
      expect(formatSomaticStatePrompt('Dale Brennan', 0, [])).toBeNull();
      expect(formatSomaticStatePrompt('Dale Brennan', 0, ['HAND_TREMOR'])).toBeNull();
      expect(formatSomaticStatePrompt('Dale Brennan', 2, [])).toBeNull();
    });
  });

  describe('Import-Graph Guard (Prose-Only Invariant Enforcement)', () => {
    it('verifies restricted mechanical and behavior modules do not import fearTexture', () => {
      const restrictedFiles = [
        'src/lib/cohortEngine.ts',
        'src/lib/cohortBehaviors.ts',
        'src/lib/submitContract.ts',
        'src/lib/cohortCognition.ts',
      ];

      for (const relPath of restrictedFiles) {
        const fullPath = path.resolve(process.cwd(), relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          expect(content).not.toContain('fearTexture');
          expect(content).not.toContain('classifyFearTexture');
          expect(content).not.toContain('formatFearTextureLine');
        }
      }
    });
  });
});
