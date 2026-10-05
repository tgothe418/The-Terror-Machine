import { describe, it, expect } from 'vitest';
import { SimulatePlayerRequestSchema, AutopilotConfigSchema, AutopilotModeSchema } from './index';

describe('Autopilot Mode Schema & Config Validation', () => {
  it('accepts all three valid modes in AutopilotModeSchema', () => {
    expect(AutopilotModeSchema.parse('standard')).toBe('standard');
    expect(AutopilotModeSchema.parse('aggressive')).toBe('aggressive');
    expect(AutopilotModeSchema.parse('adversarial')).toBe('adversarial');
  });

  it('rejects invalid modes in AutopilotModeSchema', () => {
    expect(() => AutopilotModeSchema.parse('invalid')).toThrow();
    expect(() => AutopilotModeSchema.parse('chaotic')).toThrow();
    expect(() => AutopilotModeSchema.parse('')).toThrow();
  });

  it('defaults mode to standard in AutopilotConfigSchema when omitted', () => {
    const parsed = AutopilotConfigSchema.parse({});
    expect(parsed.mode).toBe('standard');
  });

  it('defaults mode to standard in SimulatePlayerRequestSchema when omitted', () => {
    const parsed = SimulatePlayerRequestSchema.parse({
      history: [{ role: 'user', content: 'hello' }],
    });
    expect(parsed.mode).toBe('standard');
  });

  it('preserves specified mode in SimulatePlayerRequestSchema', () => {
    const parsedAggressive = SimulatePlayerRequestSchema.parse({
      history: [{ role: 'user', content: 'hello' }],
      mode: 'aggressive',
    });
    expect(parsedAggressive.mode).toBe('aggressive');

    const parsedAdversarial = SimulatePlayerRequestSchema.parse({
      history: [{ role: 'user', content: 'hello' }],
      mode: 'adversarial',
    });
    expect(parsedAdversarial.mode).toBe('adversarial');
  });

  it('rejects invalid mode in SimulatePlayerRequestSchema', () => {
    expect(() =>
      SimulatePlayerRequestSchema.parse({
        history: [{ role: 'user', content: 'hello' }],
        mode: 'reckless',
      })
    ).toThrow();
  });

  it('parses valid villainIdentity in SimulatePlayerRequestSchema', () => {
    const parsed = SimulatePlayerRequestSchema.parse({
      history: [{ role: 'user', content: 'hello' }],
      villainIdentity: {
        name: 'The Stalker',
        description: 'Prowls the corridors',
        personality: 'Relentless and patient',
        goals: 'Trap survivors in the morgue',
        traits: ['silent', 'calculating'],
        directives: ['Sever communications first'],
        coVillains: ['The Caretaker'],
      },
    });
    expect(parsed.villainIdentity).toBeDefined();
    expect(parsed.villainIdentity?.name).toBe('The Stalker');
    expect(parsed.villainIdentity?.directives).toEqual(['Sever communications first']);
    expect(parsed.villainIdentity?.coVillains).toEqual(['The Caretaker']);
  });

  it('rejects villainIdentity missing name or with empty name', () => {
    expect(() =>
      SimulatePlayerRequestSchema.parse({
        history: [{ role: 'user', content: 'hello' }],
        villainIdentity: {
          description: 'No name provided',
        },
      })
    ).toThrow();

    expect(() =>
      SimulatePlayerRequestSchema.parse({
        history: [{ role: 'user', content: 'hello' }],
        villainIdentity: {
          name: '',
        },
      })
    ).toThrow();
  });
});
