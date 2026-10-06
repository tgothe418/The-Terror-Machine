import { describe, it, expect } from 'vitest';
import {
  CanonicalConsequenceMutationSchema,
  CanonicalConsequenceProposalSchema,
  CanonicalConsequenceStateSchema,
  CanonicalConsequenceDecisionSchema,
  CanonicalConsequencePatchSchema,
  CanonicalConsequenceReceiptSchema,
  DiscoveryConsequenceMutationSchema,
  MAX_CONSEQUENCE_MUTATIONS,
  MAX_INVENTORY_ITEMS,
  MAX_PLAYER_INJURIES,
  PSYCHOLOGICAL_STATUSES,
  CanonicalConsequenceProposal,
  CanonicalConsequenceState,
  IntentReceipt,
  NarrativeReconciliationReceipt,
} from '../types';
import {
  normalizeConsequenceLabel,
  createCanonicalConsequenceState,
  resolveCanonicalConsequences,
} from './canonicalConsequences';

describe('Canonical Consequence Contracts and Pure Resolver (Phase 3H.1A)', () => {
  const baseIntent: IntentReceipt = Object.freeze({
    version: 1,
    action_kind: 'MANIPULATE',
    action_subtype: null,
    pressure_direction: 'MAINTAIN',
    dramatic_tactic: 'NONE',
    intent_synergy: 'SUCCESS',
  });

  const baseReconciliation: NarrativeReconciliationReceipt = Object.freeze({
    version: 1,
    mode: 'CANONICAL',
    feasibility: 'SUPPORTED',
    reason_code: 'NONE',
    fictional_time_cost: 'MOMENT',
    authority_alignment: 'WITHIN_CONTRACT',
    memory_echo_candidate: null,
    revision_increment: 0,
  });

  const baseState: CanonicalConsequenceState = Object.freeze({
    inventory: Object.freeze(['item_alpha', 'item_beta']) as unknown as string[],
    player_injuries: Object.freeze(['injury_minor']) as unknown as string[],
    psychological_status: 'STABLE',
  });

  // 1. Strict schemas reject unknown keys
  it('exports exact closed psychological vocabulary and strict schemas reject unknown keys', () => {
    expect(PSYCHOLOGICAL_STATUSES).toEqual([
      'STABLE',
      'UNEASY',
      'DISTRESSED',
      'PANICKED',
      'DISSOCIATED',
    ]);
    // Unknown key in mutation
    expect(() =>
      CanonicalConsequenceMutationSchema.parse({
        domain: 'INVENTORY',
        operation: 'ADD',
        value: 'item_gamma',
        rationale: 'found item',
        extra_key: 123,
      })
    ).toThrow();

    // Unknown key in proposal
    expect(() =>
      CanonicalConsequenceProposalSchema.parse({
        mutations: [],
        extra_field: 'illegal',
      })
    ).toThrow();

    // Unknown key in state
    expect(() =>
      CanonicalConsequenceStateSchema.parse({
        inventory: ['item_1'],
        player_injuries: [],
        psychological_status: 'STABLE',
        unrecognized: true,
      })
    ).toThrow();

    // Unknown key in decision
    expect(() =>
      CanonicalConsequenceDecisionSchema.parse({
        mutation: {
          domain: 'INVENTORY',
          operation: 'ADD',
          value: 'item_1',
          rationale: 'rationale',
        },
        outcome: 'APPLIED',
        reason: 'APPLIED',
        rogue_property: 'reject',
      })
    ).toThrow();

    // Unknown key in patch
    expect(() =>
      CanonicalConsequencePatchSchema.parse({
        inventory_added: [],
        inventory_removed: [],
        injuries_added: [],
        injuries_removed: [],
        psychological_status_change: null,
        extra: 'fail',
      })
    ).toThrow();

    // Unknown key in receipt
    expect(() =>
      CanonicalConsequenceReceiptSchema.parse({
        version: 1,
        pre_state: {
          inventory: [],
          player_injuries: [],
          psychological_status: 'STABLE',
        },
        post_state: {
          inventory: [],
          player_injuries: [],
          psychological_status: 'STABLE',
        },
        patch: {
          inventory_added: [],
          inventory_removed: [],
          injuries_added: [],
          injuries_removed: [],
          psychological_status_change: null,
        },
        decisions: [],
        unexpected: 42,
      })
    ).toThrow();
  });

  // 2. Discriminated union rejects invalid operation / domain pairings
  it('discriminated union rejects SET for inventory and ADD for psychological status', () => {
    expect(() =>
      CanonicalConsequenceMutationSchema.parse({
        domain: 'INVENTORY',
        operation: 'SET',
        value: 'item_1',
        rationale: 'invalid operation for inventory',
      })
    ).toThrow();

    expect(() =>
      CanonicalConsequenceMutationSchema.parse({
        domain: 'PSYCHOLOGICAL_STATUS',
        operation: 'ADD',
        value: 'PANICKED',
        rationale: 'invalid operation for psychological status',
      })
    ).toThrow();

    expect(() =>
      CanonicalConsequenceMutationSchema.parse({
        domain: 'PLAYER_INJURY',
        operation: 'SET',
        value: 'fracture',
        rationale: 'invalid operation for injury',
      })
    ).toThrow();
  });

  // 3. Caps and string bounds are strictly enforced
  it('enforces proposal mutation limit and string bounds', () => {
    const mutations = Array.from({ length: MAX_CONSEQUENCE_MUTATIONS + 1 }, (_, i) => ({
      domain: 'INVENTORY' as const,
      operation: 'ADD' as const,
      value: `item_${i}`,
      rationale: `rationale_${i}`,
    }));

    expect(() =>
      CanonicalConsequenceProposalSchema.parse({
        mutations,
      })
    ).toThrow();

    // String length boundary checks
    expect(() =>
      CanonicalConsequenceMutationSchema.parse({
        domain: 'INVENTORY',
        operation: 'ADD',
        value: 'a'.repeat(121),
        rationale: 'valid rationale',
      })
    ).toThrow();

    expect(() =>
      CanonicalConsequenceMutationSchema.parse({
        domain: 'INVENTORY',
        operation: 'ADD',
        value: 'valid value',
        rationale: 'b'.repeat(241),
      })
    ).toThrow();

    expect(() =>
      CanonicalConsequenceMutationSchema.parse({
        domain: 'INVENTORY',
        operation: 'ADD',
        value: '   ',
        rationale: 'valid rationale',
      })
    ).toThrow();
  });

  // 4. Normalization: Unicode compatibility, whitespace collapsing, and case-insensitivity
  it('handles Unicode compatibility, surrounding/internal whitespace, and case-insensitive comparison', () => {
    expect(normalizeConsequenceLabel('  item\t\talpha   beta  ')).toBe('item alpha beta');
    // Unicode compatibility NFKC
    expect(normalizeConsequenceLabel(' \uFB01le  \u212Aey ')).toBe('file Key');

    const state = createCanonicalConsequenceState({
      inventory: ['  Torch  ', 'torch', 'TORCH', 'Key\u00A0Card'],
      player_injuries: ['  Bleeding Arm  ', 'bleeding arm'],
      psychological_status: '  uneasy  ',
    });

    expect(state.inventory).toEqual(['Torch', 'Key Card']);
    expect(state.player_injuries).toEqual(['Bleeding Arm']);
    expect(state.psychological_status).toBe('UNEASY');
  });

  // 5. State construction deduplicates without mutating input and falls back to STABLE
  it('deduplicates without mutating input and falls back to STABLE for invalid legacy status', () => {
    const rawInput = Object.freeze({
      inventory: Object.freeze(['Item A', 'item a', 'Item B']) as readonly string[],
      player_injuries: Object.freeze(['Cut', 'CUT', 'Bruise']) as readonly string[],
      psychological_status: 'UNKNOWN_OR_CORRUPT_LEGACY_STATUS',
    });

    const state = createCanonicalConsequenceState(rawInput);
    expect(state.inventory).toEqual(['Item A', 'Item B']);
    expect(state.player_injuries).toEqual(['Cut', 'Bruise']);
    expect(state.psychological_status).toBe('STABLE');

    // Also verify null/undefined inputs
    const emptyState = createCanonicalConsequenceState(null);
    expect(emptyState).toEqual({
      inventory: [],
      player_injuries: [],
      psychological_status: 'STABLE',
    });
  });

  // 6. Action matrix: accepted and rejected examples for each row
  it('validates each row of the action matrix with accepted and rejected examples', () => {
    // Row 1: Inventory ADD / REMOVE requires MANIPULATE
    const invAddProposal: CanonicalConsequenceProposal = {
      mutations: [
        { domain: 'INVENTORY', operation: 'ADD', value: 'gear_1', rationale: 'found' },
      ],
    };

    const resInvAddOk = resolveCanonicalConsequences({
      proposal: invAddProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'MANIPULATE' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resInvAddOk.decisions[0].outcome).toBe('APPLIED');
    expect(resInvAddOk.decisions[0].reason).toBe('APPLIED');

    const resInvAddFail = resolveCanonicalConsequences({
      proposal: invAddProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'MOVE' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resInvAddFail.decisions[0].outcome).toBe('REJECTED');
    expect(resInvAddFail.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');

    const invRemProposal: CanonicalConsequenceProposal = {
      mutations: [
        { domain: 'INVENTORY', operation: 'REMOVE', value: 'item_alpha', rationale: 'dropped' },
      ],
    };
    const resInvRemFail = resolveCanonicalConsequences({
      proposal: invRemProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'OBSERVE' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resInvRemFail.decisions[0].outcome).toBe('REJECTED');
    expect(resInvRemFail.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');

    // Row 2: Injury ADD allows MOVE and MANIPULATE, rejects others
    const injAddProposal: CanonicalConsequenceProposal = {
      mutations: [
        { domain: 'PLAYER_INJURY', operation: 'ADD', value: 'sprained_ankle', rationale: 'fell' },
      ],
    };
    const resInjMoveOk = resolveCanonicalConsequences({
      proposal: injAddProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'MOVE' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resInjMoveOk.decisions[0].outcome).toBe('APPLIED');

    const resInjManipOk = resolveCanonicalConsequences({
      proposal: injAddProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'MANIPULATE' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resInjManipOk.decisions[0].outcome).toBe('APPLIED');

    const resInjObsFail = resolveCanonicalConsequences({
      proposal: injAddProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'OBSERVE' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resInjObsFail.decisions[0].outcome).toBe('REJECTED');
    expect(resInjObsFail.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');

    // Row 3: Injury REMOVE requires MANIPULATE
    const injRemProposal: CanonicalConsequenceProposal = {
      mutations: [
        { domain: 'PLAYER_INJURY', operation: 'REMOVE', value: 'injury_minor', rationale: 'treated' },
      ],
    };
    const resInjRemOk = resolveCanonicalConsequences({
      proposal: injRemProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'MANIPULATE' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resInjRemOk.decisions[0].outcome).toBe('APPLIED');

    const resInjRemMoveFail = resolveCanonicalConsequences({
      proposal: injRemProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'MOVE' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resInjRemMoveFail.decisions[0].outcome).toBe('REJECTED');
    expect(resInjRemMoveFail.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');

    // Row 4: Psychological Status SET allows OBSERVE, INVESTIGATE, COMMUNICATE, MOVE, MANIPULATE, WAIT
    const psychPermittedKinds = [
      'OBSERVE',
      'INVESTIGATE',
      'COMMUNICATE',
      'MOVE',
      'MANIPULATE',
      'WAIT',
    ] as const;

    for (const kind of psychPermittedKinds) {
      const res = resolveCanonicalConsequences({
        proposal: {
          mutations: [
            { domain: 'PSYCHOLOGICAL_STATUS', operation: 'SET', value: 'DISTRESSED', rationale: 'shock' },
          ],
        },
        currentState: baseState,
        intentReceipt: { ...baseIntent, action_kind: kind },
        reconciliationReceipt: baseReconciliation,
        effectiveRole: 'protagonist',
      });
      expect(res.decisions[0].outcome).toBe('APPLIED');
    }

    const resPsychOtherFail = resolveCanonicalConsequences({
      proposal: {
        mutations: [
          { domain: 'PSYCHOLOGICAL_STATUS', operation: 'SET', value: 'DISTRESSED', rationale: 'shock' },
        ],
      },
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'OTHER' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resPsychOtherFail.decisions[0].outcome).toBe('REJECTED');
    expect(resPsychOtherFail.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');
  });

  // 7. Global rejection conditions and role coverage
  it('covers all global rejection conditions and role classifications', () => {
    const testProposal: CanonicalConsequenceProposal = {
      mutations: [
        { domain: 'INVENTORY', operation: 'ADD', value: 'key_1', rationale: 'found' },
      ],
    };

    // Mode NOT_REQUIRED
    const resNotReq = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: { ...baseReconciliation, mode: 'NOT_REQUIRED' },
      effectiveRole: 'protagonist',
    });
    expect(resNotReq.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

    // Mode EXPERIENTIAL_REANCHORED
    const resReanchored = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: { ...baseReconciliation, mode: 'EXPERIENTIAL_REANCHORED' },
      effectiveRole: 'protagonist',
    });
    expect(resReanchored.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

    // Feasibility IMPOSSIBLE
    const resImpossible = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: { ...baseReconciliation, feasibility: 'IMPOSSIBLE' },
      effectiveRole: 'protagonist',
    });
    expect(resImpossible.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

    // Feasibility UNCLEAR is NOT globally suppressed
    const resUnclearFeasibility = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: { ...baseReconciliation, feasibility: 'UNCLEAR' },
      effectiveRole: 'protagonist',
    });
    expect(resUnclearFeasibility.decisions[0].outcome).toBe('APPLIED');

    // Action kind SYSTEM
    const resSystem = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: { ...baseIntent, action_kind: 'SYSTEM' },
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(resSystem.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

    // Possessed role authorized
    const resPossessed = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'possessed',
    });
    expect(resPossessed.decisions[0].outcome).toBe('APPLIED');

    // Antagonist WITHIN_CONTRACT authorized
    const resAntagWithin = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: { ...baseReconciliation, authority_alignment: 'WITHIN_CONTRACT' },
      effectiveRole: 'antagonist',
    });
    expect(resAntagWithin.decisions[0].outcome).toBe('APPLIED');

    // Antagonist EXCEEDS_CONTRACT rejected ROLE_NOT_AUTHORIZED
    const resAntagExceeds = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: { ...baseReconciliation, authority_alignment: 'EXCEEDS_CONTRACT' },
      effectiveRole: 'antagonist',
    });
    expect(resAntagExceeds.decisions[0].outcome).toBe('REJECTED');
    expect(resAntagExceeds.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');

    // Antagonist UNCLEAR rejected ROLE_NOT_AUTHORIZED
    const resAntagUnclear = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: { ...baseReconciliation, authority_alignment: 'UNCLEAR' },
      effectiveRole: 'antagonist',
    });
    expect(resAntagUnclear.decisions[0].outcome).toBe('REJECTED');
    expect(resAntagUnclear.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');

    // Director rejected ROLE_NOT_AUTHORIZED
    const resDirector = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'director',
    });
    expect(resDirector.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');

    // Witness rejected ROLE_NOT_AUTHORIZED
    const resWitness = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'witness',
    });
    expect(resWitness.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');

    // Unknown role rejected ROLE_NOT_AUTHORIZED
    const resUnknown = resolveCanonicalConsequences({
      proposal: testProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'observer_spectator',
    });
    expect(resUnknown.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');
  });

  // 8. Add, remove, duplicate, missing, full-state, and same-status behavior
  it('correctly produces outcomes, reasons, and patches for state operations', () => {
    // 8a. Add duplicate value
    const dupRes = resolveCanonicalConsequences({
      proposal: {
        mutations: [
          { domain: 'INVENTORY', operation: 'ADD', value: 'ITEM_ALPHA', rationale: 'dup' },
        ],
      },
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(dupRes.decisions[0].outcome).toBe('NO_CHANGE');
    expect(dupRes.decisions[0].reason).toBe('DUPLICATE_VALUE');
    expect(dupRes.patch.inventory_added).toEqual([]);
    expect(dupRes.post_state.inventory).toEqual(baseState.inventory);

    // 8b. Remove missing value
    const missRes = resolveCanonicalConsequences({
      proposal: {
        mutations: [
          { domain: 'INVENTORY', operation: 'REMOVE', value: 'non_existent', rationale: 'miss' },
        ],
      },
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(missRes.decisions[0].outcome).toBe('NO_CHANGE');
    expect(missRes.decisions[0].reason).toBe('VALUE_NOT_PRESENT');
    expect(missRes.patch.inventory_removed).toEqual([]);

    // 8c. State limit reached for inventory (24)
    const fullInventory = Array.from({ length: MAX_INVENTORY_ITEMS }, (_, i) => `item_${i}`);
    const stateAtCap = { ...baseState, inventory: fullInventory };
    const capRes = resolveCanonicalConsequences({
      proposal: {
        mutations: [
          { domain: 'INVENTORY', operation: 'ADD', value: 'item_overflow', rationale: 'over' },
        ],
      },
      currentState: stateAtCap,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(capRes.decisions[0].outcome).toBe('REJECTED');
    expect(capRes.decisions[0].reason).toBe('STATE_LIMIT');

    // 8d. State limit reached for injuries (12)
    const fullInjuries = Array.from({ length: MAX_PLAYER_INJURIES }, (_, i) => `injury_${i}`);
    const injStateAtCap = { ...baseState, player_injuries: fullInjuries };
    const injCapRes = resolveCanonicalConsequences({
      proposal: {
        mutations: [
          { domain: 'PLAYER_INJURY', operation: 'ADD', value: 'injury_overflow', rationale: 'over' },
        ],
      },
      currentState: injStateAtCap,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(injCapRes.decisions[0].outcome).toBe('REJECTED');
    expect(injCapRes.decisions[0].reason).toBe('STATE_LIMIT');

    // 8e. Psychological status same vs changed
    const samePsychRes = resolveCanonicalConsequences({
      proposal: {
        mutations: [
          { domain: 'PSYCHOLOGICAL_STATUS', operation: 'SET', value: 'STABLE', rationale: 'calm' },
        ],
      },
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(samePsychRes.decisions[0].outcome).toBe('NO_CHANGE');
    expect(samePsychRes.decisions[0].reason).toBe('NO_CHANGE');
    expect(samePsychRes.patch.psychological_status_change).toBeNull();

    const changePsychRes = resolveCanonicalConsequences({
      proposal: {
        mutations: [
          { domain: 'PSYCHOLOGICAL_STATUS', operation: 'SET', value: 'DISSOCIATED', rationale: 'fracture' },
        ],
      },
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(changePsychRes.decisions[0].outcome).toBe('APPLIED');
    expect(changePsychRes.patch.psychological_status_change).toEqual({
      before: 'STABLE',
      after: 'DISSOCIATED',
    });

    // 8f. Removal retains canonical stored spelling in patch
    const removeCaseRes = resolveCanonicalConsequences({
      proposal: {
        mutations: [
          { domain: 'INVENTORY', operation: 'REMOVE', value: 'ITEM_ALPHA', rationale: 'drop' },
        ],
      },
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });
    expect(removeCaseRes.decisions[0].outcome).toBe('APPLIED');
    expect(removeCaseRes.patch.inventory_removed).toEqual(['item_alpha']);
  });

  // 9. Ordered mutations see prior accepted mutations in the same proposal
  it('ordered mutations see prior accepted mutations from the same proposal', () => {
    // Add item, then remove it in the same turn
    const chainedProposal: CanonicalConsequenceProposal = {
      mutations: [
        { domain: 'INVENTORY', operation: 'ADD', value: 'item_new', rationale: 'pickup' },
        { domain: 'INVENTORY', operation: 'REMOVE', value: 'ITEM_NEW', rationale: 'throw' },
      ],
    };

    const res = resolveCanonicalConsequences({
      proposal: chainedProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });

    expect(res.decisions[0].outcome).toBe('APPLIED');
    expect(res.decisions[1].outcome).toBe('APPLIED');
    expect(res.patch.inventory_added).toEqual(['item_new']);
    expect(res.patch.inventory_removed).toEqual(['item_new']);
    expect(res.post_state.inventory).toEqual(baseState.inventory);

    // Add item, then second mutation tries to add duplicate of same item
    const duplicateChainedProposal: CanonicalConsequenceProposal = {
      mutations: [
        { domain: 'INVENTORY', operation: 'ADD', value: 'crystal_1', rationale: 'first' },
        { domain: 'INVENTORY', operation: 'ADD', value: 'CRYSTAL_1', rationale: 'second' },
      ],
    };

    const resDup = resolveCanonicalConsequences({
      proposal: duplicateChainedProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });

    expect(resDup.decisions[0].outcome).toBe('APPLIED');
    expect(resDup.decisions[1].outcome).toBe('NO_CHANGE');
    expect(resDup.decisions[1].reason).toBe('DUPLICATE_VALUE');
  });

  // 10. Empty proposal produces unchanged version-1 receipt
  it('empty proposal produces unchanged version-1 receipt with empty decisions and patch', () => {
    const emptyProposal: CanonicalConsequenceProposal = { mutations: [] };
    const res = resolveCanonicalConsequences({
      proposal: emptyProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });

    expect(res.version).toBe(1);
    expect(res.decisions).toEqual([]);
    expect(res.patch).toEqual({
      inventory_added: [],
      inventory_removed: [],
      injuries_added: [],
      injuries_removed: [],
      psychological_status_change: null,
    });
    expect(res.pre_state).toEqual(baseState);
    expect(res.post_state).toEqual(baseState);
  });

  // 11. Immutability of inputs
  it('preserves input immutability even under deep-frozen inputs', () => {
    const deepFrozenProposal: CanonicalConsequenceProposal = Object.freeze({
      mutations: Object.freeze([
        Object.freeze({
          domain: 'INVENTORY',
          operation: 'ADD',
          value: 'item_fresh',
          rationale: 'found item',
        }),
      ]) as unknown as CanonicalConsequenceProposal['mutations'],
    });

    const deepFrozenState: CanonicalConsequenceState = Object.freeze({
      inventory: Object.freeze(['item_1']) as unknown as string[],
      player_injuries: Object.freeze(['injury_1']) as unknown as string[],
      psychological_status: 'STABLE',
    });

    const res = resolveCanonicalConsequences({
      proposal: deepFrozenProposal,
      currentState: deepFrozenState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });

    expect(res.decisions[0].outcome).toBe('APPLIED');
    // Ensure returned state and patch arrays are distinct references
    expect(res.pre_state).not.toBe(deepFrozenState);
    expect(res.post_state.inventory).not.toBe(deepFrozenState.inventory);
    expect(res.post_state.inventory).toEqual(['item_1', 'item_fresh']);
  });

  // 12. Parse returned receipt with CanonicalConsequenceReceiptSchema
  it('validates that any returned receipt parses successfully against CanonicalConsequenceReceiptSchema', () => {
    const mixedProposal: CanonicalConsequenceProposal = {
      mutations: [
        { domain: 'INVENTORY', operation: 'ADD', value: 'key_bronze', rationale: 'unlocked drawer' },
        { domain: 'PLAYER_INJURY', operation: 'ADD', value: 'bruised_wrist', rationale: 'strained' },
        { domain: 'PSYCHOLOGICAL_STATUS', operation: 'SET', value: 'PANICKED', rationale: 'dread' },
      ],
    };

    const receipt = resolveCanonicalConsequences({
      proposal: mixedProposal,
      currentState: baseState,
      intentReceipt: baseIntent,
      reconciliationReceipt: baseReconciliation,
      effectiveRole: 'protagonist',
    });

    const parsed = CanonicalConsequenceReceiptSchema.parse(receipt);
    expect(parsed).toEqual(receipt);
    expect(parsed.version).toBe(1);
    expect(parsed.decisions).toHaveLength(3);
    expect(parsed.patch.inventory_added).toEqual(['key_bronze']);
    expect(parsed.patch.injuries_added).toEqual(['bruised_wrist']);
    expect(parsed.patch.psychological_status_change).toEqual({
      before: 'STABLE',
      after: 'PANICKED',
    });
  });

  describe('DISCOVERY consequence domain (Discovery 1/6)', () => {
    it('DiscoveryConsequenceMutationSchema enforces ADD operation and valid bounds', () => {
      // Valid ADD
      const valid = DiscoveryConsequenceMutationSchema.parse({
        domain: 'DISCOVERY',
        operation: 'ADD',
        value: 'broken_seal',
        rationale: 'investigated cryo door',
      });
      expect(valid.domain).toBe('DISCOVERY');
      expect(valid.operation).toBe('ADD');
      expect(valid.value).toBe('broken_seal');

      // Reject REMOVE
      expect(() =>
        DiscoveryConsequenceMutationSchema.parse({
          domain: 'DISCOVERY',
          operation: 'REMOVE',
          value: 'broken_seal',
          rationale: 'cannot remove discovery',
        })
      ).toThrow();

      // Reject SET
      expect(() =>
        DiscoveryConsequenceMutationSchema.parse({
          domain: 'DISCOVERY',
          operation: 'SET',
          value: 'broken_seal',
          rationale: 'cannot set discovery',
        })
      ).toThrow();

      // CanonicalConsequenceMutationSchema discriminated union enforces the same
      expect(() =>
        CanonicalConsequenceMutationSchema.parse({
          domain: 'DISCOVERY',
          operation: 'REMOVE',
          value: 'broken_seal',
          rationale: 'illegal operation',
        })
      ).toThrow();
    });

    it('resolves APPLIED for OBSERVE, INVESTIGATE, and MANIPULATE actions', () => {
      const authorizedKinds: Array<IntentReceipt['action_kind']> = ['OBSERVE', 'INVESTIGATE', 'MANIPULATE'];

      for (const action_kind of authorizedKinds) {
        const intent: IntentReceipt = { ...baseIntent, action_kind };
        const proposal: CanonicalConsequenceProposal = {
          mutations: [
            {
              domain: 'DISCOVERY',
              operation: 'ADD',
              value: '  bloodied_scalpel  ',
              rationale: '  spotted on tray  ',
            },
          ],
        };

        const res = resolveCanonicalConsequences({
          proposal,
          currentState: baseState,
          intentReceipt: intent,
          reconciliationReceipt: baseReconciliation,
          effectiveRole: 'protagonist',
        });

        expect(res.decisions).toHaveLength(1);
        expect(res.decisions[0].outcome).toBe('APPLIED');
        expect(res.decisions[0].reason).toBe('APPLIED');
        expect(res.decisions[0].mutation.value).toBe('bloodied_scalpel');
        expect(res.decisions[0].mutation.rationale).toBe('spotted on tray');

        // Record-only: pre_state and post_state are identical
        expect(res.post_state.inventory).toEqual(res.pre_state.inventory);
        expect(res.post_state.player_injuries).toEqual(res.pre_state.player_injuries);
        expect(res.post_state.psychological_status).toBe(res.pre_state.psychological_status);
        expect(res.patch.inventory_added).toHaveLength(0);
        expect(res.patch.injuries_added).toHaveLength(0);
        expect(res.patch.psychological_status_change).toBeNull();
      }
    });

    it('rejects DISCOVERY mutation with ACTION_NOT_AUTHORIZED for unauthorized actions (e.g. MOVE)', () => {
      const intent: IntentReceipt = { ...baseIntent, action_kind: 'MOVE' };
      const proposal: CanonicalConsequenceProposal = {
        mutations: [
          {
            domain: 'DISCOVERY',
            operation: 'ADD',
            value: 'hidden_passcode',
            rationale: 'ran past keypad',
          },
        ],
      };

      const res = resolveCanonicalConsequences({
        proposal,
        currentState: baseState,
        intentReceipt: intent,
        reconciliationReceipt: baseReconciliation,
        effectiveRole: 'protagonist',
      });

      expect(res.decisions).toHaveLength(1);
      expect(res.decisions[0].outcome).toBe('REJECTED');
      expect(res.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');
    });

    it('respects D3 role policy: villain resolves APPLIED with WITHIN_CONTRACT, REJECTED with EXCEEDS_CONTRACT', () => {
      const proposal: CanonicalConsequenceProposal = {
        mutations: [
          {
            domain: 'DISCOVERY',
            operation: 'ADD',
            value: 'escape_tunnel_map',
            rationale: 'interrogated survivor',
          },
        ],
      };

      // Villain with WITHIN_CONTRACT -> APPLIED
      const resWithin = resolveCanonicalConsequences({
        proposal,
        currentState: baseState,
        intentReceipt: { ...baseIntent, action_kind: 'INVESTIGATE' },
        reconciliationReceipt: {
          ...baseReconciliation,
          authority_alignment: 'WITHIN_CONTRACT',
        },
        effectiveRole: 'villain',
      });
      expect(resWithin.decisions[0].outcome).toBe('APPLIED');

      // Villain with EXCEEDS_CONTRACT -> REJECTED (ROLE_NOT_AUTHORIZED)
      const resExceeds = resolveCanonicalConsequences({
        proposal,
        currentState: baseState,
        intentReceipt: { ...baseIntent, action_kind: 'INVESTIGATE' },
        reconciliationReceipt: {
          ...baseReconciliation,
          authority_alignment: 'EXCEEDS_CONTRACT',
        },
        effectiveRole: 'villain',
      });
      expect(resExceeds.decisions[0].outcome).toBe('REJECTED');
      expect(resExceeds.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');
    });

    it('rejects DISCOVERY mutation with RECONCILIATION_SUPPRESSED when reconciliation is suppressed', () => {
      const proposal: CanonicalConsequenceProposal = {
        mutations: [
          {
            domain: 'DISCOVERY',
            operation: 'ADD',
            value: 'sealed_archive',
            rationale: 'spotted on terminal',
          },
        ],
      };

      // Suppressed via mode NOT_REQUIRED
      const resNotRequired = resolveCanonicalConsequences({
        proposal,
        currentState: baseState,
        intentReceipt: { ...baseIntent, action_kind: 'INVESTIGATE' },
        reconciliationReceipt: {
          ...baseReconciliation,
          mode: 'NOT_REQUIRED',
        },
        effectiveRole: 'protagonist',
      });
      expect(resNotRequired.decisions[0].outcome).toBe('REJECTED');
      expect(resNotRequired.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

      // Suppressed via feasibility IMPOSSIBLE
      const resImpossible = resolveCanonicalConsequences({
        proposal,
        currentState: baseState,
        intentReceipt: { ...baseIntent, action_kind: 'INVESTIGATE' },
        reconciliationReceipt: {
          ...baseReconciliation,
          feasibility: 'IMPOSSIBLE',
        },
        effectiveRole: 'protagonist',
      });
      expect(resImpossible.decisions[0].outcome).toBe('REJECTED');
      expect(resImpossible.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');

      // Suppressed via action_kind SYSTEM
      const resSystem = resolveCanonicalConsequences({
        proposal,
        currentState: baseState,
        intentReceipt: { ...baseIntent, action_kind: 'SYSTEM' },
        reconciliationReceipt: baseReconciliation,
        effectiveRole: 'protagonist',
      });
      expect(resSystem.decisions[0].outcome).toBe('REJECTED');
      expect(resSystem.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');
    });
  });
});

