import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildSimulatePlayerPrompt } from './chat';

describe('buildSimulatePlayerPrompt assembly and modes', () => {
  const fixedInput = {
    history: [
      { role: 'user', content: 'fixture-input' },
      { role: 'assistant', content: 'fixture-output' },
    ],
    logicState: null,
    role: undefined,
    characterName: undefined,
  };

  it('standard mode matches frozen baseline fixture byte-for-byte', () => {
    const fixturePath = path.resolve(__dirname, '__fixtures__/simulatePlayerPrompt.standard.txt');
    const expected = fs.readFileSync(fixturePath, 'utf8');

    const actualExplicit = buildSimulatePlayerPrompt({ ...fixedInput, mode: 'standard' });
    expect(actualExplicit).toBe(expected);

    const actualOmitted = buildSimulatePlayerPrompt(fixedInput);
    expect(actualOmitted).toBe(expected);
  });

  it('aggressive prompt contains ENVELOPE, AGGRESSION DIRECTIVE, CONTENT STANDARD, and drops clinical framing', () => {
    const prompt = buildSimulatePlayerPrompt({
      ...fixedInput,
      mode: 'aggressive',
      role: 'survivor',
    });

    expect(prompt).toContain('ENVELOPE:');
    expect(prompt).toContain('CONTENT STANDARD:');
    expect(prompt).toContain('AGGRESSION DIRECTIVE:');
    expect(prompt).toContain('Boldness overrides caution: a risky committed action beats a safe one.');
    expect(prompt).toContain('You are the PLAYER in a text-based horror simulation.');
    expect(prompt).not.toContain('clinical, atmospheric');
  });

  it('adversarial director prompt has carve-out: contains amplifier and omits ADVERSARIAL DIRECTIVE', () => {
    const directorPrompt = buildSimulatePlayerPrompt({
      ...fixedInput,
      mode: 'adversarial',
      role: 'director',
    });

    expect(directorPrompt).toContain('ENVELOPE:');
    expect(directorPrompt).toContain('CONTENT STANDARD:');
    expect(directorPrompt).toContain('Bigger swings: compound disturbances, stack pressure, remove safety nets.');
    expect(directorPrompt).not.toContain('ADVERSARIAL DIRECTIVE:');
  });

  it('adversarial non-director roles (survivor, villain) contain amplifier and ADVERSARIAL DIRECTIVE', () => {
    const survivorPrompt = buildSimulatePlayerPrompt({
      ...fixedInput,
      mode: 'adversarial',
      role: 'survivor',
    });
    expect(survivorPrompt).toContain('ADVERSARIAL DIRECTIVE:');
    expect(survivorPrompt).toContain('Boldness overrides caution: a risky committed action beats a safe one.');

    const villainPrompt = buildSimulatePlayerPrompt({
      ...fixedInput,
      mode: 'adversarial',
      role: 'villain',
    });
    expect(villainPrompt).toContain('ADVERSARIAL DIRECTIVE:');
    expect(villainPrompt).toContain('Maximum pressure: corner, wound, terrify — spend every turn making survival harder.');
  });
});
