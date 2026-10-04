import { describe, expect, it } from 'vitest';
import { applyRoleAwareIntentPolicy } from './roleAwareIntentPolicy';
import type { CausalFeasibilityResult } from './causalFeasibility';
import type { EngineTurnContext, IntentReceipt } from '../types/engineContract';

function createMockContext(overrides: Partial<EngineTurnContext> = {}): EngineTurnContext {
  return {
    version: 1,
    scenario: {
      title: 'Facility Sector',
      premise: 'Testing environment',
      worldRules: ['Standard atmospheric controls'],
      setting: { location: 'Control Hub', atmosphere: 'Sterile', timePeriod: '2094' },
      startingVector: 'COGNITIVE',
      startingTier: 'LATENT',
      incitingIncident: '',
      pacingDirective: '',
      keyPlotElements: [],
    },
    player: {
      role: 'protagonist',
      characterId: 'char-player',
      name: 'Operative Alpha',
      description: 'Lead operative',
      isEntity: false,
    },
    cast: [],
    topology: {
      currentNodeId: 'NODE_01',
      readableNodeLabel: 'Control Hub',
      allowedOutgoingExits: [
        {
          from: 'NODE_01',
          to: 'NODE_02',
          kind: 'PHYSICAL',
          userInitiated: true,
        },
      ],
    },
    runtime: {
      phase: 'LATENT',
      tension: 1,
      coherence: 1.0,
      reconciliationRevision: 0,
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      activeFlags: [],
      turnNumber: 0,
    },
    consequenceState: {
      inventory: [],
      player_injuries: [],
      psychological_status: 'STABLE',
    },
    relationshipState: [],
    memoryState: {},
    worldMemory: [],
    ...overrides,
  };
}

function createIntentReceipt(action_kind: IntentReceipt['action_kind']): IntentReceipt {
  return {
    version: 1,
    action_kind,
    action_subtype: null,
    pressure_direction: 'MAINTAIN',
    dramatic_tactic: 'NONE',
    intent_synergy: 'N/A',
  };
}

describe('applyRoleAwareIntentPolicy', () => {
  const supportedBase: CausalFeasibilityResult = {
    feasibility: 'SUPPORTED',
    reason_code: 'NONE',
    authority_alignment: 'NOT_APPLICABLE',
    suppressStructuralDeltas: false,
  };

  const unclearBase: CausalFeasibilityResult = {
    feasibility: 'UNCLEAR',
    reason_code: 'NONE',
    authority_alignment: 'NOT_APPLICABLE',
    suppressStructuralDeltas: false,
  };

  it('1. Protagonist and possessed preserve base causal fields and force NOT_APPLICABLE', () => {
    const protagonistContext = createMockContext({
      player: { role: 'protagonist', name: 'Operative', description: '', isEntity: false },
    });
    const possessedContext = createMockContext({
      player: { role: 'possessed', name: 'Subject', description: '', isEntity: false },
    });

    const receipt = createIntentReceipt('MOVE');

    const resultProtagonist = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: receipt,
      context: protagonistContext,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(resultProtagonist).toEqual({
      feasibility: 'SUPPORTED',
      reason_code: 'NONE',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: false,
    });

    const resultPossessed = applyRoleAwareIntentPolicy({
      base: unclearBase,
      intentReceipt: receipt,
      context: possessedContext,
      proposedAuthorityAlignment: 'EXCEEDS_CONTRACT',
    });
    expect(resultPossessed).toEqual({
      feasibility: 'UNCLEAR',
      reason_code: 'NONE',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: false,
    });
  });

  it('2. Director direct MOVE and MANIPULATE are constrained and suppressed', () => {
    const directorContext = createMockContext({
      player: { role: 'director', name: 'Director', description: '', isEntity: false },
    });

    const moveResult = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: createIntentReceipt('MOVE'),
      context: directorContext,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(moveResult).toEqual({
      feasibility: 'CONSTRAINED',
      reason_code: 'AUTHORITY_LIMIT',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: true,
    });

    const manipResult = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: createIntentReceipt('MANIPULATE'),
      context: directorContext,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(manipResult).toEqual({
      feasibility: 'CONSTRAINED',
      reason_code: 'AUTHORITY_LIMIT',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: true,
    });
  });

  it('3. Director OTHER is unclear but not automatically suppressed', () => {
    const directorContext = createMockContext({
      player: { role: 'director', name: 'Director', description: '', isEntity: false },
    });

    const otherResult = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: createIntentReceipt('OTHER'),
      context: directorContext,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(otherResult).toEqual({
      feasibility: 'UNCLEAR',
      reason_code: 'AUTHORITY_LIMIT',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: false,
    });
  });

  it('4. Director observational and communicative kinds preserve base rules', () => {
    const directorContext = createMockContext({
      player: { role: 'director', name: 'Director', description: '', isEntity: false },
    });

    const observationalKinds: IntentReceipt['action_kind'][] = [
      'OBSERVE',
      'INVESTIGATE',
      'COMMUNICATE',
      'WAIT',
    ];

    for (const kind of observationalKinds) {
      const result = applyRoleAwareIntentPolicy({
        base: supportedBase,
        intentReceipt: createIntentReceipt(kind),
        context: directorContext,
        proposedAuthorityAlignment: 'WITHIN_CONTRACT',
      });
      expect(result).toEqual({
        feasibility: 'SUPPORTED',
        reason_code: 'NONE',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: false,
      });
    }
  });

  it('5. Witness OBSERVE and WAIT preserve base rules', () => {
    const witnessContext = createMockContext({
      player: { role: 'witness', name: 'Witness', description: '', isEntity: false },
    });

    const observeResult = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: createIntentReceipt('OBSERVE'),
      context: witnessContext,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(observeResult).toEqual({
      feasibility: 'SUPPORTED',
      reason_code: 'NONE',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: false,
    });

    const waitResult = applyRoleAwareIntentPolicy({
      base: unclearBase,
      intentReceipt: createIntentReceipt('WAIT'),
      context: witnessContext,
      proposedAuthorityAlignment: 'NOT_APPLICABLE',
    });
    expect(waitResult).toEqual({
      feasibility: 'UNCLEAR',
      reason_code: 'NONE',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: false,
    });
  });

  it('6. Every other Witness action is constrained and suppressed', () => {
    const witnessContext = createMockContext({
      player: { role: 'witness', name: 'Witness', description: '', isEntity: false },
    });

    const activeKinds: IntentReceipt['action_kind'][] = [
      'MOVE',
      'INVESTIGATE',
      'MANIPULATE',
      'COMMUNICATE',
      'OTHER',
    ];

    for (const kind of activeKinds) {
      const result = applyRoleAwareIntentPolicy({
        base: supportedBase,
        intentReceipt: createIntentReceipt(kind),
        context: witnessContext,
        proposedAuthorityAlignment: 'WITHIN_CONTRACT',
      });
      expect(result).toEqual({
        feasibility: 'CONSTRAINED',
        reason_code: 'AUTHORITY_LIMIT',
        authority_alignment: 'NOT_APPLICABLE',
        suppressStructuralDeltas: true,
      });
    }
  });

  it('7. Antagonist without an explicit complete contract is conservative even if proposal says WITHIN_CONTRACT', () => {
    const antagonistNoContract = createMockContext({
      player: { role: 'antagonist', name: 'Entity', description: '', isEntity: true },
    });

    const result = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: createIntentReceipt('MANIPULATE'),
      context: antagonistNoContract,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(result).toEqual({
      feasibility: 'IMPOSSIBLE',
      reason_code: 'AUTHORITY_LIMIT',
      authority_alignment: 'EXCEEDS_CONTRACT',
      suppressStructuralDeltas: true,
    });
  });

  it('8. Antagonist with a complete contract covers WITHIN_CONTRACT, EXCEEDS_CONTRACT, UNCLEAR, and NOT_APPLICABLE', () => {
    const antagonistWithContract = createMockContext({
      player: { role: 'antagonist', name: 'Facility AI', description: '', isEntity: true },
      participationContext: {
        mode: 'antagonist',
        seat: { kind: 'force', name: 'Facility AI' },
        initialGoal: 'Isolate Sector',
        boundedFacts: ['Power is operational'],
        authorityContract: {
          authority: 'Can control lighting and locks.',
          limits: 'Cannot physically move structures.',
        },
        victimField: {
          kind: 'group',
          collectiveDesignation: 'Survivors',
          members: [],
        },
      },
    });

    const receipt = createIntentReceipt('MANIPULATE');

    // WITHIN_CONTRACT: preserves base feasibility, reason, suppression; alignment is WITHIN_CONTRACT
    const withinResult = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: receipt,
      context: antagonistWithContract,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(withinResult).toEqual({
      feasibility: 'SUPPORTED',
      reason_code: 'NONE',
      authority_alignment: 'WITHIN_CONTRACT',
      suppressStructuralDeltas: false,
    });

    // EXCEEDS_CONTRACT: CONSTRAINED / AUTHORITY_LIMIT / EXCEEDS_CONTRACT, suppress true
    const exceedsResult = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: receipt,
      context: antagonistWithContract,
      proposedAuthorityAlignment: 'EXCEEDS_CONTRACT',
    });
    expect(exceedsResult).toEqual({
      feasibility: 'CONSTRAINED',
      reason_code: 'AUTHORITY_LIMIT',
      authority_alignment: 'EXCEEDS_CONTRACT',
      suppressStructuralDeltas: true,
    });

    // UNCLEAR: UNCLEAR / AUTHORITY_LIMIT / UNCLEAR, suppress false
    const unclearResult = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: receipt,
      context: antagonistWithContract,
      proposedAuthorityAlignment: 'UNCLEAR',
    });
    expect(unclearResult).toEqual({
      feasibility: 'UNCLEAR',
      reason_code: 'AUTHORITY_LIMIT',
      authority_alignment: 'UNCLEAR',
      suppressStructuralDeltas: false,
    });

    // NOT_APPLICABLE -> normalized to UNCLEAR
    const notApplicableResult = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: receipt,
      context: antagonistWithContract,
      proposedAuthorityAlignment: 'NOT_APPLICABLE',
    });
    expect(notApplicableResult).toEqual({
      feasibility: 'UNCLEAR',
      reason_code: 'AUTHORITY_LIMIT',
      authority_alignment: 'UNCLEAR',
      suppressStructuralDeltas: false,
    });
  });

  it('9. Blank authority or blank limits counts as missing contract', () => {
    const blankAuthContext = createMockContext({
      player: { role: 'antagonist', name: 'Entity', description: '', isEntity: true },
      participationContext: {
        mode: 'antagonist',
        seat: { kind: 'force', name: 'Entity' },
        initialGoal: 'Subdue',
        boundedFacts: [],
        authorityContract: {
          authority: '   ',
          limits: 'Cannot breach hull.',
        },
        victimField: { kind: 'group', collectiveDesignation: 'Crew', members: [] },
      },
    });

    const blankLimitsContext = createMockContext({
      player: { role: 'antagonist', name: 'Entity', description: '', isEntity: true },
      participationContext: {
        mode: 'antagonist',
        seat: { kind: 'force', name: 'Entity' },
        initialGoal: 'Subdue',
        boundedFacts: [],
        authorityContract: {
          authority: 'Controls doors.',
          limits: '',
        },
        victimField: { kind: 'group', collectiveDesignation: 'Crew', members: [] },
      },
    });

    const resAuth = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: createIntentReceipt('MANIPULATE'),
      context: blankAuthContext,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(resAuth.feasibility).toBe('IMPOSSIBLE');
    expect(resAuth.reason_code).toBe('AUTHORITY_LIMIT');
    expect(resAuth.authority_alignment).toBe('EXCEEDS_CONTRACT');
    expect(resAuth.suppressStructuralDeltas).toBe(true);

    const resLimits = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: createIntentReceipt('MANIPULATE'),
      context: blankLimitsContext,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });
    expect(resLimits.feasibility).toBe('IMPOSSIBLE');
    expect(resLimits.reason_code).toBe('AUTHORITY_LIMIT');
    expect(resLimits.authority_alignment).toBe('EXCEEDS_CONTRACT');
    expect(resLimits.suppressStructuralDeltas).toBe(true);
  });

  it('10. A topology or cast-presence hard boundary cannot be loosened by any role or proposed alignment', () => {
    const hardTopologyBoundary: CausalFeasibilityResult = {
      feasibility: 'IMPOSSIBLE',
      reason_code: 'TOPOLOGY_LIMIT',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: true,
    };

    const hardCastBoundary: CausalFeasibilityResult = {
      feasibility: 'IMPOSSIBLE',
      reason_code: 'CAST_PRESENCE_LIMIT',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: true,
    };

    const roles: EngineTurnContext['player']['role'][] = [
      'protagonist',
      'antagonist',
      'director',
      'witness',
      'possessed',
    ];

    for (const role of roles) {
      const ctx = createMockContext({
        player: { role, name: 'Participant', description: '', isEntity: false },
        participationContext:
          role === 'antagonist'
            ? {
                mode: 'antagonist',
                seat: { kind: 'force', name: 'Entity' },
                initialGoal: 'Subdue',
                boundedFacts: [],
                authorityContract: { authority: 'Full', limits: 'None' },
                victimField: { kind: 'group', collectiveDesignation: 'Crew', members: [] },
              }
            : undefined,
      });

      const topResult = applyRoleAwareIntentPolicy({
        base: hardTopologyBoundary,
        intentReceipt: createIntentReceipt('MOVE'),
        context: ctx,
        proposedAuthorityAlignment: 'WITHIN_CONTRACT',
      });
      expect(topResult.feasibility).toBe('IMPOSSIBLE');
      expect(topResult.reason_code).toBe('TOPOLOGY_LIMIT');
      expect(topResult.suppressStructuralDeltas).toBe(true);

      const castResult = applyRoleAwareIntentPolicy({
        base: hardCastBoundary,
        intentReceipt: createIntentReceipt('COMMUNICATE'),
        context: ctx,
        proposedAuthorityAlignment: 'WITHIN_CONTRACT',
      });
      expect(castResult.feasibility).toBe('IMPOSSIBLE');
      expect(castResult.reason_code).toBe('CAST_PRESENCE_LIMIT');
      expect(castResult.suppressStructuralDeltas).toBe(true);
    }
  });

  it('11. Inputs are not mutated', () => {
    const baseCopy = { ...supportedBase };
    const receipt = createIntentReceipt('MOVE');
    const receiptCopy = { ...receipt };
    const context = createMockContext();
    const contextCopy = JSON.parse(JSON.stringify(context));

    applyRoleAwareIntentPolicy({
      base: baseCopy,
      intentReceipt: receipt,
      context,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });

    expect(baseCopy).toEqual(supportedBase);
    expect(receipt).toEqual(receiptCopy);
    expect(context).toEqual(contextCopy);
  });

  it('12. SYSTEM action kind always preserves base with NOT_APPLICABLE', () => {
    const antagonistContext = createMockContext({
      player: { role: 'antagonist', name: 'Entity', description: '', isEntity: true },
    });

    const result = applyRoleAwareIntentPolicy({
      base: supportedBase,
      intentReceipt: createIntentReceipt('SYSTEM'),
      context: antagonistContext,
      proposedAuthorityAlignment: 'WITHIN_CONTRACT',
    });

    expect(result).toEqual({
      feasibility: 'SUPPORTED',
      reason_code: 'NONE',
      authority_alignment: 'NOT_APPLICABLE',
      suppressStructuralDeltas: false,
    });
  });

  describe('deterministic villain authority mapping (D3)', () => {
    const antagonistWithContract = createMockContext({
      player: { role: 'antagonist', name: 'Facility AI', description: '', isEntity: false },
      participationContext: {
        mode: 'antagonist',
        seat: { kind: 'character', name: 'Facility AI' },
        initialGoal: 'Isolate Sector',
        boundedFacts: ['Power is operational'],
        authorityContract: {
          authority: 'Can control lighting and locks.',
          limits: 'Cannot physically move structures.',
        },
        victimField: {
          kind: 'group',
          collectiveDesignation: 'Survivors',
          members: [],
        },
      },
    });

    const baseWithinContract: CausalFeasibilityResult = {
      feasibility: 'SUPPORTED',
      reason_code: 'NONE',
      authority_alignment: 'WITHIN_CONTRACT',
      suppressStructuralDeltas: false,
    };

    const baseUnclear: CausalFeasibilityResult = {
      feasibility: 'UNCLEAR',
      reason_code: 'NONE',
      authority_alignment: 'UNCLEAR',
      suppressStructuralDeltas: false,
    };

    it('base WITHIN_CONTRACT + proposed UNCLEAR -> WITHIN_CONTRACT', () => {
      const result = applyRoleAwareIntentPolicy({
        base: baseWithinContract,
        intentReceipt: createIntentReceipt('MANIPULATE'),
        context: antagonistWithContract,
        proposedAuthorityAlignment: 'UNCLEAR',
      });
      expect(result).toEqual({
        feasibility: 'SUPPORTED',
        reason_code: 'NONE',
        authority_alignment: 'WITHIN_CONTRACT',
        suppressStructuralDeltas: false,
      });
    });

    it('base WITHIN_CONTRACT + proposed EXCEEDS_CONTRACT -> EXCEEDS_CONTRACT', () => {
      const result = applyRoleAwareIntentPolicy({
        base: baseWithinContract,
        intentReceipt: createIntentReceipt('MANIPULATE'),
        context: antagonistWithContract,
        proposedAuthorityAlignment: 'EXCEEDS_CONTRACT',
      });
      expect(result).toEqual({
        feasibility: 'CONSTRAINED',
        reason_code: 'AUTHORITY_LIMIT',
        authority_alignment: 'EXCEEDS_CONTRACT',
        suppressStructuralDeltas: true,
      });
    });

    it('base WITHIN_CONTRACT + proposed WITHIN_CONTRACT -> WITHIN_CONTRACT', () => {
      const result = applyRoleAwareIntentPolicy({
        base: baseWithinContract,
        intentReceipt: createIntentReceipt('MANIPULATE'),
        context: antagonistWithContract,
        proposedAuthorityAlignment: 'WITHIN_CONTRACT',
      });
      expect(result).toEqual({
        feasibility: 'SUPPORTED',
        reason_code: 'NONE',
        authority_alignment: 'WITHIN_CONTRACT',
        suppressStructuralDeltas: false,
      });
    });

    it('base UNCLEAR + proposed UNCLEAR -> UNCLEAR', () => {
      const result = applyRoleAwareIntentPolicy({
        base: baseUnclear,
        intentReceipt: createIntentReceipt('MANIPULATE'),
        context: antagonistWithContract,
        proposedAuthorityAlignment: 'UNCLEAR',
      });
      expect(result).toEqual({
        feasibility: 'UNCLEAR',
        reason_code: 'AUTHORITY_LIMIT',
        authority_alignment: 'UNCLEAR',
        suppressStructuralDeltas: false,
      });
    });
  });
});
