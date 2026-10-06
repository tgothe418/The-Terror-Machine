import { describe, it, expect } from 'vitest';
import {
  normalizeCastActivityProposal,
  normalizeGeminiTurnProviderPayload,
  type CastNormalizationContext,
} from './geminiTurnTransport';
import { CastActivityProposalSchema } from '../../src/types/horrorGrammar';

describe('geminiTurnTransport: normalizeCastActivityProposal', () => {
  it('preserves an already valid active proposal', () => {
    const raw = {
      kind: 'ACTIVITY',
      proposalId: 'prop-123',
      castMemberId: 'char-entity-41',
      pursuitId: 'pursuit-1',
      locationNodeId: 'node-morgue',
      activitySummary: 'The suture apparatus advances along overhead rails.',
      authorityReferences: ['[aim-char-entity-41]'],
      perceptionPath: 'DIRECT',
      manifestationBlock: {
        type: 'prose',
        content: 'A metallic scraping sound echoes from above.',
      },
    };

    const normalized = normalizeCastActivityProposal(raw);
    expect(normalized.castMemberId).toBe('char-entity-41');
    expect(normalized.proposalId).toBe('prop-123');
    expect(normalized.perceptionPath).toBe('DIRECT');

    const validated = CastActivityProposalSchema.parse(normalized);
    expect(validated.kind).toBe('ACTIVITY');
  });

  it('recovers missing castMemberId from authorityReferences (Owner: <id>) (Magnum v4 pattern)', () => {
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'The entity aligns its surgical calipers over the operating slab.',
      authorityReferences: ['[aim-char-entity-41] Restorative Protocol. Owner: char-entity-41'],
      manifestationBlock: {
        type: 'prose',
        content: 'Pneumatics hiss as steel claws descend toward the table.',
      },
    };

    const normalized = normalizeCastActivityProposal(raw);
    expect(normalized.castMemberId).toBe('char-entity-41');
    expect(typeof normalized.proposalId).toBe('string');
    expect(normalized.perceptionPath).toBe('DIRECT');

    const validated = CastActivityProposalSchema.parse(normalized);
    expect(validated.kind).toBe('ACTIVITY');
    if (validated.kind === 'ACTIVITY') {
      expect(validated.castMemberId).toBe('char-entity-41');
    }
  });

  it('recovers missing castMemberId from bracketed aim pattern [aim-char-marcus-holt]', () => {
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'Marcus Holt tests the emergency seal on the bulkhead.',
      authorityReferences: ['[aim-char-marcus-holt] Secure the perimeter'],
    };

    const normalized = normalizeCastActivityProposal(raw);
    expect(normalized.castMemberId).toBe('char-marcus-holt');
    const validated = CastActivityProposalSchema.parse(normalized);
    expect(validated.kind).toBe('ACTIVITY');
  });

  it('recovers missing castMemberId from char- token in authorityReferences', () => {
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'Maren Ross inspects the cryogenic log files.',
      authorityReferences: ['Authority granted to char-maren-ross for specimen diagnostics'],
    };

    const normalized = normalizeCastActivityProposal(raw);
    expect(normalized.castMemberId).toBe('char-maren-ross');
    const validated = CastActivityProposalSchema.parse(normalized);
    expect(validated.kind).toBe('ACTIVITY');
  });

  it('recovers missing castMemberId from common alias properties (characterId, cast_member_id, castId)', () => {
    const rawWithCharId = {
      kind: 'ACTIVITY',
      characterId: 'char-maren-ross',
      activitySummary: 'Ross readies her dissection scalpel.',
    };
    expect(normalizeCastActivityProposal(rawWithCharId).castMemberId).toBe('char-maren-ross');

    const rawWithSnake = {
      kind: 'ACTIVITY',
      cast_member_id: 'char-marcus-holt',
      activitySummary: 'Holt checks the chamber radio.',
    };
    expect(normalizeCastActivityProposal(rawWithSnake).castMemberId).toBe('char-marcus-holt');

    const rawWithCastId = {
      kind: 'ACTIVITY',
      castId: 'char-entity-41',
      activitySummary: 'Entity-41 glides across the ceiling track.',
    };
    expect(normalizeCastActivityProposal(rawWithCastId).castMemberId).toBe('char-entity-41');
  });

  it('recovers missing castMemberId from manifestationBlock.speaker if present', () => {
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'Holt shouts through the intercom.',
      manifestationBlock: {
        type: 'dialogue',
        speaker: 'char-marcus-holt',
        content: 'Ross! Back away from the rail!',
      },
    };

    const normalized = normalizeCastActivityProposal(raw);
    expect(normalized.castMemberId).toBe('char-marcus-holt');
    const validated = CastActivityProposalSchema.parse(normalized);
    expect(validated.kind).toBe('ACTIVITY');
  });

  it('recovers missing castMemberId from char- id pattern in activitySummary', () => {
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'Target specimen char-entity-41 activates hydraulic feed lines.',
    };

    const normalized = normalizeCastActivityProposal(raw);
    expect(normalized.castMemberId).toBe('char-entity-41');
    const validated = CastActivityProposalSchema.parse(normalized);
    expect(validated.kind).toBe('ACTIVITY');
  });

  it('leaves castMemberId undefined if irrecoverable, preserving fail-closed validation', () => {
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'Someone or something knocks on the airlock door.',
    };

    const normalized = normalizeCastActivityProposal(raw);
    expect(normalized.castMemberId).toBeUndefined();
    expect(() => CastActivityProposalSchema.parse(normalized)).toThrow();
  });

  it('integrates cleanly into normalizeGeminiTurnProviderPayload', () => {
    const fullPayload = {
      narrative_blocks: [{ type: 'prose', content: 'The darkness deepens.' }],
      cast_activity_proposal: {
        kind: 'ACTIVITY',
        activitySummary: 'The Entity tightens hydraulic grip on the slab.',
        authorityReferences: ['Owner: char-entity-41'],
      },
    };

    const normalized = normalizeGeminiTurnProviderPayload(fullPayload) as {
      cast_activity_proposal?: { castMemberId?: string; perceptionPath?: string };
    };
    expect(normalized.cast_activity_proposal?.castMemberId).toBe('char-entity-41');
    expect(normalized.cast_activity_proposal?.perceptionPath).toBe('DIRECT');
  });
});

describe('normalizeCastActivityProposal — Roster Validation & Sole-Active Fallback', () => {
  const context: CastNormalizationContext = {
    scenarioCastIds: ['char-entity-41', 'char-marcus-holt'],
    activeCastIds: ['char-entity-41']
  };

  it('fails closed when model provides a hallucinated castMemberId not in roster', () => {
    const raw = {
      kind: 'ACTIVITY',
      castMemberId: 'char-phantom-ghost',
      activitySummary: 'A ghost appears'
    };
    const result = normalizeCastActivityProposal(raw, context);
    expect(result.castMemberId).toBeUndefined();
  });

  it('fails closed when recovered castMemberId is not in scenario roster', () => {
    const raw = {
      kind: 'ACTIVITY',
      authorityReferences: ['Owner: char-phantom-ghost'],
      activitySummary: 'A sound echoes'
    };
    const result = normalizeCastActivityProposal(raw, context);
    expect(result.castMemberId).toBeUndefined();
  });

  it('fails closed when scenarioCastIds is an explicit empty array', () => {
    const emptyRosterContext: CastNormalizationContext = {
      scenarioCastIds: [],
      activeCastIds: []
    };
    const raw = {
      kind: 'ACTIVITY',
      castMemberId: 'char-entity-41',
      activitySummary: 'An entity stirs'
    };
    const result = normalizeCastActivityProposal(raw, emptyRosterContext);
    expect(result.castMemberId).toBeUndefined();
  });

  it('preserves valid castMemberId present in scenario roster', () => {
    const raw = {
      kind: 'ACTIVITY',
      castMemberId: 'char-marcus-holt',
      activitySummary: 'Locks the cellar door'
    };
    const result = normalizeCastActivityProposal(raw, context);
    expect(result.castMemberId).toBe('char-marcus-holt');
  });

  it('falls back to lone active chamber cast member if no ID can be inferred', () => {
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'A scalpel drops onto the metal tray'
    };
    const result = normalizeCastActivityProposal(raw, context);
    expect(result.castMemberId).toBe('char-entity-41');
  });

  it('does not fall back when activeCastIds is empty (e.g. only player is present)', () => {
    const playerOnlyContext: CastNormalizationContext = {
      scenarioCastIds: ['char-entity-41', 'char-marcus-holt'],
      activeCastIds: [] // Player filtered out, no other cast present
    };
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'The player catches their breath alone'
    };
    const result = normalizeCastActivityProposal(raw, playerOnlyContext);
    expect(result.castMemberId).toBeUndefined();
  });

  it('does not fall back if multiple active cast members are in the chamber', () => {
    const multiContext: CastNormalizationContext = {
      scenarioCastIds: ['char-entity-41', 'char-marcus-holt'],
      activeCastIds: ['char-entity-41', 'char-marcus-holt']
    };
    const raw = {
      kind: 'ACTIVITY',
      activitySummary: 'Footsteps creak on wood'
    };
    const result = normalizeCastActivityProposal(raw, multiContext);
    expect(result.castMemberId).toBeUndefined();
  });

  describe('sentinel normalization (D2/F2)', () => {
    it('maps string sentinels "null", "NULL", "NONE", "none", "nil", "n/a" to null', () => {
      const sentinels = ['null', 'NULL', 'NONE', 'none', 'nil', 'n/a', '  null  ', ''];
      for (const s of sentinels) {
        const payload: Record<string, unknown> = {
          logic_state: {
            requested_transition: s,
          },
        };
        const normalized = normalizeGeminiTurnProviderPayload(payload) as Record<string, Record<string, unknown>>;
        expect(normalized.logic_state?.requested_transition).toBeNull();
      }
    });

    it('preserves legitimate destinations (e.g. "room_6") untouched', () => {
      const payload: Record<string, unknown> = {
        logic_state: {
          requested_transition: 'room_6',
        },
      };
      const normalized = normalizeGeminiTurnProviderPayload(payload) as Record<string, Record<string, unknown>>;
      expect(normalized.logic_state?.requested_transition).toBe('room_6');
    });
  });

  describe('consequence proposal normalization: DISCOVERY domain (Discovery 1/6)', () => {
    it('passes DISCOVERY with operation ADD through', () => {
      const payload: Record<string, unknown> = {
        consequence_proposal: {
          mutations: [
            {
              domain: 'DISCOVERY',
              operation: 'ADD',
              value: 'torn_manifest',
              rationale: 'found on desk',
            },
          ],
        },
      };
      const normalized = normalizeGeminiTurnProviderPayload(payload) as {
        consequence_proposal: { mutations: Array<{ domain: string; operation: string; value: string; rationale: string }> };
      };
      expect(normalized.consequence_proposal?.mutations).toHaveLength(1);
      expect(normalized.consequence_proposal.mutations[0]).toEqual({
        domain: 'DISCOVERY',
        operation: 'ADD',
        value: 'torn_manifest',
        rationale: 'found on desk',
      });
    });

    it('drops DISCOVERY with operation REMOVE or SET', () => {
      const payload: Record<string, unknown> = {
        consequence_proposal: {
          mutations: [
            {
              domain: 'DISCOVERY',
              operation: 'REMOVE',
              value: 'torn_manifest',
              rationale: 'illegal remove',
            },
            {
              domain: 'DISCOVERY',
              operation: 'SET',
              value: 'torn_manifest',
              rationale: 'illegal set',
            },
          ],
        },
      };
      const normalized = normalizeGeminiTurnProviderPayload(payload) as {
        consequence_proposal: { mutations: unknown[] };
      };
      expect(normalized.consequence_proposal?.mutations).toHaveLength(0);
    });

    it('drops unknown consequence domains', () => {
      const payload: Record<string, unknown> = {
        consequence_proposal: {
          mutations: [
            {
              domain: 'UNKNOWN_DOMAIN',
              operation: 'ADD',
              value: 'item',
              rationale: 'none',
            },
          ],
        },
      };
      const normalized = normalizeGeminiTurnProviderPayload(payload) as {
        consequence_proposal: { mutations: unknown[] };
      };
      expect(normalized.consequence_proposal?.mutations).toHaveLength(0);
    });

    it('filters mixed proposal keeping valid DISCOVERY ADD and dropping invalid operations', () => {
      const payload: Record<string, unknown> = {
        consequence_proposal: {
          mutations: [
            {
              domain: 'DISCOVERY',
              operation: 'ADD',
              value: 'valid_clue',
              rationale: 'valid rationale',
            },
            {
              domain: 'DISCOVERY',
              operation: 'REMOVE',
              value: 'invalid_clue_1',
              rationale: 'invalid op',
            },
            {
              domain: 'DISCOVERY',
              operation: 'UNKNOWN_OP',
              value: 'invalid_clue_2',
              rationale: 'invalid op',
            },
          ],
        },
      };
      const normalized = normalizeGeminiTurnProviderPayload(payload) as {
        consequence_proposal: { mutations: Array<{ domain: string; operation: string; value: string; rationale: string }> };
      };
      expect(normalized.consequence_proposal?.mutations).toHaveLength(1);
      expect(normalized.consequence_proposal.mutations[0].value).toBe('valid_clue');
    });
  });
});

