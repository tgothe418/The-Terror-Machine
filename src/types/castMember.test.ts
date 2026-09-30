import { describe, it, expect } from 'vitest';
import { CastMemberSchema } from './index';

describe('CastMemberSchema ID validation', () => {
  it('rejects empty and whitespace-only IDs', () => {
    expect(() => CastMemberSchema.parse({ id: '' })).toThrow();
    expect(() => CastMemberSchema.parse({ id: '   ' })).toThrow();
  });

  it('generates a char- ID when ID is undefined', () => {
    const parsed = CastMemberSchema.parse({});
    expect(parsed.id).toMatch(/^char-/);
  });

  it('preserves a valid explicit ID', () => {
    const parsed = CastMemberSchema.parse({ id: 'c1' });
    expect(parsed.id).toBe('c1');
  });
});
