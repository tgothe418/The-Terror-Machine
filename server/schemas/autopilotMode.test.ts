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
});
