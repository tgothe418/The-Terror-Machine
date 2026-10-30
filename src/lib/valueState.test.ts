import { describe, it, expect } from 'vitest';
import {
  createInitialValueStateLedger,
  resolveValueState,
  selectPressuredAnchors,
} from './valueState';
import { normalizeBlueprint } from './normalizeBlueprint';
import { Blueprint } from '../types';
import { ValueStateLedger, ValueStateRecord } from '../types/horrorGrammar';


describe('valueState unit tests', () => {
  const createMockBlueprint = (): Blueprint =>
    normalizeBlueprint({
      id: 'bp_1',
      title: 'Research Station Epsilon',
      userCharacterId: 'char_player',
      cast: [
        {
          id: 'char_player',
          name: 'Dr. Evans',
          isUserCharacter: true,
          role: 'Lead',
          description: 'Lead researcher',
          personality: 'Stoic',
          goals: 'Finish project',
          traits: ['Focused'],
          isEntity: false,
          behaviorVector: 'COGNITIVE',
          starting_location: 'LAB_A',
        },
        {
          id: 'char_ally',
          name: 'Dr. Aris',
          isUserCharacter: false,
          role: 'Technician',
          description: 'Engineer',
          personality: 'Cautious',
          goals: 'Keep power running',
          traits: ['Analytical'],
          isEntity: false,
          behaviorVector: 'COGNITIVE',
          starting_location: 'LAB_A',
        },
      ],
      topology: { nodes: ['LAB_A'], connections: [] },
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED',
        pursuitReviews: {},
        valueAnchors: [
          {
            id: 'val_user_sanity',
            label: 'Dr. Evans Mind',
            description: 'Cognitive integrity of the primary researcher.',
            holder: { kind: 'CHARACTER', castMemberId: 'char_player' },
            basisSummary: 'Psychological profile',
            provenance: { kind: 'CREATOR_DEFINED' },
          },
          {
            id: 'val_station_power',
            label: 'Auxiliary Core',
            description: 'Geothermal power feed.',
            holder: { kind: 'SCENARIO' },
            basisSummary: 'Facility engineering',
            provenance: { kind: 'CREATOR_DEFINED' },
          },
        ],
        characterPursuits: [],
      },
    }) as Blueprint;

  it('initializes runtime value state ledger from blueprint without mutating blueprint', () => {
    const bp = createMockBlueprint();
    const ledger = createInitialValueStateLedger(bp);
    expect(ledger.val_user_sanity).toBeDefined();
    expect(ledger.val_user_sanity.condition).toBe('ESTABLISHED');
    expect(ledger.val_user_sanity.lifecycle).toBe('ACTIVE');
    expect(ledger.val_station_power.condition).toBe('ESTABLISHED');
  });

  it('applies valid SET_CONDITION transition citing accepted cause', () => {
    const bp = createMockBlueprint();
    const preState = createInitialValueStateLedger(bp);
    const receipt = resolveValueState({
      proposal: {
        changes: [
          {
            anchorId: 'val_station_power',
            operation: 'SET_CONDITION',
            expectedBeforeCondition: 'ESTABLISHED',
            proposedCondition: 'THREATENED',
            proposedLifecycle: 'ACTIVE',
            proposedFormNote: null,
            causeReference: 'act-1-core-overload',
            rationale: 'Core temperature spiking due to accepted generator fault.',
          },
        ],
      },
      preState,
      currentTurn: 1,
      blueprint: bp,
      userCharacterId: 'char_player',
      validCauses: ['act-1-core-overload'],
    });

    expect(receipt.decisions[0].outcome).toBe('APPLIED');
    expect(receipt.postState.val_station_power.condition).toBe('THREATENED');
    expect(receipt.postState.val_station_power.lastChangedTurn).toBe(1);
    expect(receipt.postState.val_station_power.lastCauseReference).toBe('act-1-core-overload');
  });

  it('rejects revision or retirement of User character value anchor to protect subjectivity', () => {
    const bp = createMockBlueprint();
    const preState = createInitialValueStateLedger(bp);
    const receipt = resolveValueState({
      proposal: {
        changes: [
          {
            anchorId: 'val_user_sanity',
            operation: 'REVISE',
            proposedCondition: 'TRANSFORMED',
            proposedLifecycle: 'REVISED',
            proposedFormNote: 'Obsessed with the machine now.',
            causeReference: 'USER_ACTION',
            rationale: 'Changing player beliefs.',
          },
        ],
      },
      preState,
      currentTurn: 1,
      blueprint: bp,
      userCharacterId: 'char_player',
      validCauses: ['USER_ACTION'],
    });

    expect(receipt.decisions[0].outcome).toBe('REJECTED');
    expect(receipt.decisions[0].reasonCode).toBe('USER_VALUE_SUBJECTIVITY_PROTECTED');
    expect(receipt.postState.val_user_sanity.condition).toBe('ESTABLISHED');
  });

  it('rejects transition citing unsupported or rejected cause', () => {
    const bp = createMockBlueprint();
    const preState = createInitialValueStateLedger(bp);
    const receipt = resolveValueState({
      proposal: {
        changes: [
          {
            anchorId: 'val_station_power',
            operation: 'SET_CONDITION',
            proposedCondition: 'LOST',
            proposedLifecycle: 'ACTIVE',
            proposedFormNote: null,
            causeReference: 'fabricated-cause-999',
            rationale: 'Total power loss.',
          },
        ],
      },
      preState,
      currentTurn: 1,
      blueprint: bp,
      userCharacterId: 'char_player',
      validCauses: ['act-1-core-overload'],
    });

    expect(receipt.decisions[0].outcome).toBe('REJECTED');
    expect(receipt.decisions[0].reasonCode).toBe('UNSUPPORTED_CAUSE_REFERENCE');
    expect(receipt.postState.val_station_power.condition).toBe('ESTABLISHED');
  });

  describe('Packet 05: User Value Protection Across Operation Forms', () => {
    it('pairs RETIRE with SET_CONDITION carrying RETIRED for the same User-owned active anchor (both rejected)', () => {
      const bp = createMockBlueprint();
      const preState = createInitialValueStateLedger(bp);

      // 1. Direct RETIRE
      const retireReceipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_user_sanity',
              operation: 'RETIRE',
              proposedCondition: 'LOST',
              causeReference: 'USER_ACTION',
              rationale: 'Retiring player sanity commitment',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['USER_ACTION'],
      });

      expect(retireReceipt.decisions[0].outcome).toBe('REJECTED');
      expect(retireReceipt.decisions[0].reasonCode).toBe('USER_VALUE_SUBJECTIVITY_PROTECTED');
      expect(retireReceipt.postState.val_user_sanity.lifecycle).toBe('ACTIVE');
      expect(retireReceipt.postState.val_user_sanity.condition).toBe('ESTABLISHED');

      // 2. Equivalent SET_CONDITION carrying proposedLifecycle: 'RETIRED'
      const setConditionRetireReceipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_user_sanity',
              operation: 'SET_CONDITION',
              proposedCondition: 'LOST',
              proposedLifecycle: 'RETIRED',
              causeReference: 'USER_ACTION',
              rationale: 'Sneaking retirement past guard via SET_CONDITION',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['USER_ACTION'],
      });

      expect(setConditionRetireReceipt.decisions[0].outcome).toBe('REJECTED');
      expect(setConditionRetireReceipt.decisions[0].reasonCode).toBe('USER_VALUE_SUBJECTIVITY_PROTECTED');
      expect(setConditionRetireReceipt.postState.val_user_sanity.lifecycle).toBe('ACTIVE');
      expect(setConditionRetireReceipt.postState.val_user_sanity.condition).toBe('ESTABLISHED');
    });

    it('rejects equivalent revision and restoration attempts through SET_CONDITION payload forms', () => {
      const bp = createMockBlueprint();
      const preState = createInitialValueStateLedger(bp);

      // Attempt 1: SET_CONDITION with proposedLifecycle: 'REVISED'
      const reviseAttemptReceipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_user_sanity',
              operation: 'SET_CONDITION',
              proposedCondition: 'TRANSFORMED',
              proposedLifecycle: 'REVISED',
              causeReference: 'USER_ACTION',
              rationale: 'Attempting revision via SET_CONDITION',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['USER_ACTION'],
      });
      expect(reviseAttemptReceipt.decisions[0].outcome).toBe('REJECTED');
      expect(reviseAttemptReceipt.decisions[0].reasonCode).toBe('USER_VALUE_SUBJECTIVITY_PROTECTED');

      // Attempt 2: SET_CONDITION rewriting proposedFormNote
      const noteAttemptReceipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_user_sanity',
              operation: 'SET_CONDITION',
              proposedCondition: 'COMPROMISED',
              proposedFormNote: 'Dr. Evans has embraced the entity',
              causeReference: 'USER_ACTION',
              rationale: 'Attempting note rewrite via SET_CONDITION',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['USER_ACTION'],
      });
      expect(noteAttemptReceipt.decisions[0].outcome).toBe('REJECTED');
      expect(noteAttemptReceipt.decisions[0].reasonCode).toBe('USER_VALUE_SUBJECTIVITY_PROTECTED');

      // Attempt 3: SET_CONDITION with proposedLifecycle: 'ACTIVE' on a RETIRED User anchor (restoration)
      const retiredPreState = {
        ...preState,
        val_user_sanity: {
          ...preState.val_user_sanity,
          lifecycle: 'RETIRED' as const,
        },
      };
      const restoreAttemptReceipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_user_sanity',
              operation: 'SET_CONDITION',
              proposedCondition: 'ESTABLISHED',
              proposedLifecycle: 'ACTIVE',
              causeReference: 'USER_ACTION',
              rationale: 'Attempting restoration via SET_CONDITION',
            },
          ],
        },
        preState: retiredPreState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['USER_ACTION'],
      });
      expect(restoreAttemptReceipt.decisions[0].outcome).toBe('REJECTED');
      expect(restoreAttemptReceipt.decisions[0].reasonCode).toBe('USER_VALUE_SUBJECTIVITY_PROTECTED');
      expect(restoreAttemptReceipt.postState.val_user_sanity.lifecycle).toBe('RETIRED');
    });

    it('rejects attempt to bypass User protection using misleading holder data in proposal payload', () => {
      const bp = createMockBlueprint();
      const preState = createInitialValueStateLedger(bp);

      // Model claims in payload that the target is a SCENARIO anchor
      const receipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_user_sanity',
              operation: 'RETIRE',
              proposedCondition: 'LOST',
              causeReference: 'USER_ACTION',
              rationale: 'Claiming this is not user held',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['USER_ACTION'],
      });

      expect(receipt.decisions[0].outcome).toBe('REJECTED');
      expect(receipt.decisions[0].reasonCode).toBe('USER_VALUE_SUBJECTIVITY_PROTECTED');
    });

    it('permits legitimate descriptive condition update on User value without changing protected lifecycle or commitment', () => {
      const bp = createMockBlueprint();
      const preState = createInitialValueStateLedger(bp);

      // Case A: omitted proposedLifecycle
      const receiptA = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_user_sanity',
              operation: 'SET_CONDITION',
              proposedCondition: 'THREATENED',
              causeReference: 'USER_ACTION',
              rationale: 'Horror encounter causes shock and elevated heart rate',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['USER_ACTION'],
      });

      expect(receiptA.decisions[0].outcome).toBe('APPLIED');
      expect(receiptA.decisions[0].reasonCode).toBe('VALUE_STATE_TRANSITION_APPLIED');
      expect(receiptA.postState.val_user_sanity.condition).toBe('THREATENED');
      expect(receiptA.postState.val_user_sanity.lifecycle).toBe('ACTIVE');
      expect(receiptA.postState.val_user_sanity.currentFormNote).toBeNull();

      // Case B: explicit matching proposedLifecycle: 'ACTIVE'
      const receiptB = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_user_sanity',
              operation: 'SET_CONDITION',
              proposedCondition: 'COMPROMISED',
              proposedLifecycle: 'ACTIVE',
              causeReference: 'USER_ACTION',
              rationale: 'Ongoing sensory assault compromises composure',
            },
          ],
        },
        preState: receiptA.postState,
        currentTurn: 2,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['USER_ACTION'],
      });

      expect(receiptB.decisions[0].outcome).toBe('APPLIED');
      expect(receiptB.postState.val_user_sanity.condition).toBe('COMPROMISED');
      expect(receiptB.postState.val_user_sanity.lifecycle).toBe('ACTIVE');
    });

    it('does not silently reactivate a RETIRED anchor when proposedLifecycle is omitted on SET_CONDITION', () => {
      const bp = createMockBlueprint();
      const preState = createInitialValueStateLedger(bp);
      const retiredPreState = {
        ...preState,
        val_station_power: {
          ...preState.val_station_power,
          lifecycle: 'RETIRED' as const,
          condition: 'LOST' as const,
        },
      };

      const receipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_station_power',
              operation: 'SET_CONDITION',
              proposedCondition: 'TRANSFORMED',
              causeReference: 'act-1-core-overload',
              rationale: 'Power grid debris transformed',
            },
          ],
        },
        preState: retiredPreState,
        currentTurn: 2,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['act-1-core-overload'],
      });

      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.postState.val_station_power.condition).toBe('TRANSFORMED');
      // Crucial: omitted proposedLifecycle must NOT silently reactivate to 'ACTIVE'
      expect(receipt.postState.val_station_power.lifecycle).toBe('RETIRED');
    });

    it('permits valid non-User anchor lifecycle transitions under authorized causes', () => {
      const bp = createMockBlueprint();
      const preState = createInitialValueStateLedger(bp);

      // 1. RETIRE on scenario anchor
      const retireReceipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_station_power',
              operation: 'RETIRE',
              proposedCondition: 'LOST',
              causeReference: 'act-1-core-overload',
              rationale: 'Auxiliary core permanently melted down',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['act-1-core-overload'],
      });

      expect(retireReceipt.decisions[0].outcome).toBe('APPLIED');
      expect(retireReceipt.postState.val_station_power.lifecycle).toBe('RETIRED');
      expect(retireReceipt.postState.val_station_power.condition).toBe('LOST');

      // 2. SET_CONDITION with proposedLifecycle: 'RETIRED' on scenario anchor
      const setConditionRetireReceipt = resolveValueState({
        proposal: {
          changes: [
            {
              anchorId: 'val_station_power',
              operation: 'SET_CONDITION',
              proposedCondition: 'LOST',
              proposedLifecycle: 'RETIRED',
              causeReference: 'act-1-core-overload',
              rationale: 'Core offline and retired via SET_CONDITION',
            },
          ],
        },
        preState,
        currentTurn: 1,
        blueprint: bp,
        userCharacterId: 'char_player',
        validCauses: ['act-1-core-overload'],
      });

      expect(setConditionRetireReceipt.decisions[0].outcome).toBe('APPLIED');
      expect(setConditionRetireReceipt.postState.val_station_power.lifecycle).toBe('RETIRED');
    });
  });

  describe('selectPressuredAnchors', () => {
    it('returns an empty array when ledger is empty', () => {
      expect(selectPressuredAnchors({})).toEqual([]);
    });

    it('ranks anchors deterministically by current pressure severity descending', () => {
      const ledger: ValueStateLedger = {
        anchor_established: {
          anchorId: 'anchor_established',
          lifecycle: 'ACTIVE',
          condition: 'ESTABLISHED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 0,
        },
        anchor_secured: {
          anchorId: 'anchor_secured',
          lifecycle: 'ACTIVE',
          condition: 'SECURED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 1,
        },
        anchor_threatened: {
          anchorId: 'anchor_threatened',
          lifecycle: 'ACTIVE',
          condition: 'THREATENED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 2,
        },
        anchor_compromised: {
          anchorId: 'anchor_compromised',
          lifecycle: 'ACTIVE',
          condition: 'COMPROMISED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 3,
        },
        anchor_transformed: {
          anchorId: 'anchor_transformed',
          lifecycle: 'REVISED',
          condition: 'TRANSFORMED',
          currentFormNote: 'Altered core conviction',
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 4,
        },
        anchor_lost: {
          anchorId: 'anchor_lost',
          lifecycle: 'RETIRED',
          condition: 'LOST',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 5,
        },
      };

      const ranked = selectPressuredAnchors(ledger);
      expect(ranked.map((r) => r.condition)).toEqual([
        'COMPROMISED',
        'THREATENED',
        'LOST',
        'TRANSFORMED',
        'ESTABLISHED',
        'SECURED',
      ]);
      expect(ranked.map((r) => r.anchorId)).toEqual([
        'anchor_compromised',
        'anchor_threatened',
        'anchor_lost',
        'anchor_transformed',
        'anchor_established',
        'anchor_secured',
      ]);
    });

    it('breaks ties deterministically by anchorId ascending when severity levels match', () => {
      const ledger: ValueStateLedger = {
        delta_anchor: {
          anchorId: 'delta_anchor',
          lifecycle: 'ACTIVE',
          condition: 'THREATENED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 0,
        },
        alpha_anchor: {
          anchorId: 'alpha_anchor',
          lifecycle: 'ACTIVE',
          condition: 'THREATENED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 0,
        },
        charlie_anchor: {
          anchorId: 'charlie_anchor',
          lifecycle: 'ACTIVE',
          condition: 'COMPROMISED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 0,
        },
        bravo_anchor: {
          anchorId: 'bravo_anchor',
          lifecycle: 'ACTIVE',
          condition: 'COMPROMISED',
          currentFormNote: null,
          lastCauseReference: 'BASELINE',
          lastChangedTurn: 0,
        },
      };

      const ranked = selectPressuredAnchors(ledger);
      expect(ranked.map((r) => r.anchorId)).toEqual([
        'bravo_anchor',
        'charlie_anchor',
        'alpha_anchor',
        'delta_anchor',
      ]);
    });

    it('preserves all record fields untouched without mutation', () => {
      const record: ValueStateRecord = {
        anchorId: 'custom_anchor_1',
        lifecycle: 'REVISED',
        condition: 'COMPROMISED',
        currentFormNote: 'Beliefs shattered and reorganized',
        lastCauseReference: 'trauma_event_7',
        lastChangedTurn: 42,
      };
      const ledger: ValueStateLedger = {
        custom_anchor_1: { ...record },
      };

      const result = selectPressuredAnchors(ledger);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(record);
      expect(result[0].anchorId).toBe('custom_anchor_1');
      expect(result[0].lifecycle).toBe('REVISED');
      expect(result[0].condition).toBe('COMPROMISED');
      expect(result[0].currentFormNote).toBe('Beliefs shattered and reorganized');
      expect(result[0].lastCauseReference).toBe('trauma_event_7');
      expect(result[0].lastChangedTurn).toBe(42);
    });
  });
});

