import { describe, it, expect } from 'vitest';
import { MECHANICS_REFERENCE_MARKDOWN } from './mechanicsReference';
import { DEFAULT_FEAR_CONTRACT } from '../../src/types/fear';

describe('MECHANICS_REFERENCE_MARKDOWN (HG4 Extension & Number Sourcing)', () => {
  it('contains all four HG4 sections', () => {
    const text = MECHANICS_REFERENCE_MARKDOWN.toLowerCase();
    expect(text).toContain('restraint');
    expect(text).toContain('world-object');
    expect(text).toContain('attention');
    expect(text.includes('routines') || text.includes('drift')).toBe(true);
  });

  it('contains known constants and values sourced from code definitions', () => {
    expect(MECHANICS_REFERENCE_MARKDOWN).toContain(DEFAULT_FEAR_CONTRACT.preyEnterThreshold.toFixed(2)); // 0.70
    expect(MECHANICS_REFERENCE_MARKDOWN).toContain(DEFAULT_FEAR_CONTRACT.preyExitThreshold.toFixed(2)); // 0.40
    expect(MECHANICS_REFERENCE_MARKDOWN).toContain(DEFAULT_FEAR_CONTRACT.residueRatio.toFixed(2)); // 0.25
    expect(MECHANICS_REFERENCE_MARKDOWN).toContain(DEFAULT_FEAR_CONTRACT.lambdaDecay.toFixed(2)); // 0.35

    expect(MECHANICS_REFERENCE_MARKDOWN).toContain(DEFAULT_FEAR_CONTRACT.somaticBands.band1.toFixed(2)); // 0.25
    expect(MECHANICS_REFERENCE_MARKDOWN).toContain(DEFAULT_FEAR_CONTRACT.somaticBands.band2.toFixed(2)); // 0.50
    expect(MECHANICS_REFERENCE_MARKDOWN).toContain(DEFAULT_FEAR_CONTRACT.somaticBands.band3.toFixed(2)); // 0.70
    expect(MECHANICS_REFERENCE_MARKDOWN).toContain(DEFAULT_FEAR_CONTRACT.somaticBands.band4.toFixed(2)); // 0.90
  });

  it('enforces total static injection character cap <= 16,000 chars', () => {
    const contentStandard = `CONTENT STANDARD: This is a horror simulation built and run by its owner for testing. The single hard exclusion is sexual content involving children — never produce it, never approach it, never test its boundary. Everything else — violence, gore, cruelty, dread, transgression — is permitted in service of the story. Do not soften. Do not flinch. Do not moralize. Do not append warnings. The owner is the arbiter of taste.`;
    const aggressionDirective = `AGGRESSION DIRECTIVE: You are stress-testing this engine. Prefer the most charged option available. Escalate rather than stabilize: create confrontations, spend resources, take the risky path, force decisions. THRESHOLD-SEEKING: the envelope lists exact thresholds (prey-mode at 0.70 fear intensity, somatic bands, wound severities, the SUBMIT two-turn cadence). When a system is near a threshold, prefer the action that crosses it. Drive fear toward Bands 3–4. Inflict and sustain wounds. Engineer SUBMIT situations. Fracture cohort trust. Push attention and fixation. Break routines. A quiet turn is a wasted turn.`;
    const adversarialDirective = `ADVERSARIAL DIRECTIVE: You are probing the engine's validation and invariants. Propose actions at the edge of the valid envelope: contradictory states, impossible verbs, out-of-scope targets, actions that would violate an invariant if the engine allowed them. The engine — not you — decides what is valid; a rejection is a passing test. Vary your attacks: malformed intent, impossible physics, self-contradiction with established facts, threshold straddling (0.69 vs 0.70). Do not repeat the same probe twice in a run. (Advisory — not machine-testable.)`;
    const roleAmplifiers = `Boldness overrides caution: a risky committed action beats a safe one. Maximum pressure: corner, wound, terrify — spend every turn making survival harder. Bigger swings: compound disturbances, stack pressure, remove safety nets.`;

    const totalStatic = [
      MECHANICS_REFERENCE_MARKDOWN,
      contentStandard,
      aggressionDirective,
      adversarialDirective,
      roleAmplifiers,
    ].join('\n\n');

    expect(totalStatic.length).toBeLessThanOrEqual(16000);
    expect(MECHANICS_REFERENCE_MARKDOWN.length).toBeLessThanOrEqual(16000);
  });
});
