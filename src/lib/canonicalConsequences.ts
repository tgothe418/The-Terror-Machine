import {
  CanonicalConsequenceDecision,
  CanonicalConsequenceMutation,
  CanonicalConsequencePatch,
  CanonicalConsequenceProposal,
  CanonicalConsequenceReceipt,
  CanonicalConsequenceState,
  CanonicalConsequenceStateInput,
  IntentReceipt,
  MAX_INVENTORY_ITEMS,
  MAX_PLAYER_INJURIES,
  NarrativeReconciliationReceipt,
  PSYCHOLOGICAL_STATUSES,
  PsychologicalStatus,
} from '../types';

export function normalizeConsequenceLabel(value: string): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function createCanonicalConsequenceState(
  input?: CanonicalConsequenceStateInput | null
): CanonicalConsequenceState {
  const inventory: string[] = [];
  const seenInventory = new Set<string>();

  if (input?.inventory && Array.isArray(input.inventory)) {
    for (const rawItem of input.inventory) {
      if (typeof rawItem !== 'string') continue;
      const normalized = normalizeConsequenceLabel(rawItem);
      if (!normalized) continue;
      const key = normalized.toLocaleLowerCase('en-US');
      if (!seenInventory.has(key)) {
        seenInventory.add(key);
        inventory.push(normalized);
        if (inventory.length >= MAX_INVENTORY_ITEMS) break;
      }
    }
  }

  const injuries: string[] = [];
  const seenInjuries = new Set<string>();

  if (input?.player_injuries && Array.isArray(input.player_injuries)) {
    for (const rawInjury of input.player_injuries) {
      if (typeof rawInjury !== 'string') continue;
      const normalized = normalizeConsequenceLabel(rawInjury);
      if (!normalized) continue;
      const key = normalized.toLocaleLowerCase('en-US');
      if (!seenInjuries.has(key)) {
        seenInjuries.add(key);
        injuries.push(normalized);
        if (injuries.length >= MAX_PLAYER_INJURIES) break;
      }
    }
  }

  let psychological_status: PsychologicalStatus = 'STABLE';
  if (input?.psychological_status && typeof input.psychological_status === 'string') {
    const raw = normalizeConsequenceLabel(input.psychological_status).toUpperCase();
    if ((PSYCHOLOGICAL_STATUSES as readonly string[]).includes(raw)) {
      psychological_status = raw as PsychologicalStatus;
    }
  }

  return {
    inventory,
    player_injuries: injuries,
    psychological_status,
  };
}

export function resolveCanonicalConsequences(input: {
  proposal: CanonicalConsequenceProposal;
  currentState: CanonicalConsequenceState;
  intentReceipt: IntentReceipt;
  reconciliationReceipt: NarrativeReconciliationReceipt;
  effectiveRole: string;
}): CanonicalConsequenceReceipt {
  const pre_state = createCanonicalConsequenceState(input.currentState);
  const workingInventory = [...pre_state.inventory];
  const workingInjuries = [...pre_state.player_injuries];
  let workingPsychStatus: PsychologicalStatus = pre_state.psychological_status;

  const decisions: CanonicalConsequenceDecision[] = [];
  const inventory_added: string[] = [];
  const inventory_removed: string[] = [];
  const injuries_added: string[] = [];
  const injuries_removed: string[] = [];

  const { reconciliationReceipt, intentReceipt, effectiveRole } = input;
  const normalizedRole = typeof effectiveRole === 'string' ? effectiveRole.trim().toLowerCase() : '';

  for (const mutation of input.proposal.mutations) {
    const normalizedMutation: CanonicalConsequenceMutation =
      mutation.domain === 'PSYCHOLOGICAL_STATUS'
        ? {
            domain: mutation.domain,
            operation: mutation.operation,
            value: mutation.value,
            rationale: normalizeConsequenceLabel(mutation.rationale),
          }
        : mutation.domain === 'DISCOVERY'
          ? {
              domain: mutation.domain,
              operation: mutation.operation,
              value: normalizeConsequenceLabel(mutation.value),
              rationale: normalizeConsequenceLabel(mutation.rationale),
            }
          : {
              domain: mutation.domain,
              operation: mutation.operation,
              value: normalizeConsequenceLabel(mutation.value),
              rationale: normalizeConsequenceLabel(mutation.rationale),
            };

    // 1. Check RECONCILIATION_SUPPRESSED
    const isReconciliationSuppressed =
      reconciliationReceipt.mode === 'NOT_REQUIRED' ||
      reconciliationReceipt.mode === 'EXPERIENTIAL_REANCHORED' ||
      reconciliationReceipt.feasibility === 'IMPOSSIBLE' ||
      intentReceipt.action_kind === 'SYSTEM';

    if (isReconciliationSuppressed) {
      decisions.push({
        mutation: normalizedMutation,
        outcome: 'REJECTED',
        reason: 'RECONCILIATION_SUPPRESSED',
      });
      continue;
    }

    // 2. Check ROLE_NOT_AUTHORIZED
    const isRoleAuthorized =
      normalizedRole === 'protagonist' ||
      normalizedRole === 'survivor' ||
      normalizedRole === 'bystander' ||
      normalizedRole === 'possessed' ||
      ((normalizedRole === 'antagonist' || normalizedRole === 'villain') &&
        reconciliationReceipt.authority_alignment === 'WITHIN_CONTRACT');

    if (!isRoleAuthorized) {
      decisions.push({
        mutation: normalizedMutation,
        outcome: 'REJECTED',
        reason: 'ROLE_NOT_AUTHORIZED',
      });
      continue;
    }

    // 3. Check ACTION_NOT_AUTHORIZED
    let isActionAuthorized = false;
    if (mutation.domain === 'INVENTORY') {
      isActionAuthorized = intentReceipt.action_kind === 'MANIPULATE';
    } else if (mutation.domain === 'PLAYER_INJURY') {
      if (mutation.operation === 'ADD') {
        isActionAuthorized =
          intentReceipt.action_kind === 'MOVE' || intentReceipt.action_kind === 'MANIPULATE';
      } else if (mutation.operation === 'REMOVE') {
        isActionAuthorized = intentReceipt.action_kind === 'MANIPULATE';
      }
    } else if (mutation.domain === 'PSYCHOLOGICAL_STATUS') {
      isActionAuthorized =
        intentReceipt.action_kind === 'OBSERVE' ||
        intentReceipt.action_kind === 'INVESTIGATE' ||
        intentReceipt.action_kind === 'COMMUNICATE' ||
        intentReceipt.action_kind === 'MOVE' ||
        intentReceipt.action_kind === 'MANIPULATE' ||
        intentReceipt.action_kind === 'WAIT';
    } else if (mutation.domain === 'DISCOVERY') {
      isActionAuthorized =
        intentReceipt.action_kind === 'OBSERVE' ||
        intentReceipt.action_kind === 'INVESTIGATE' ||
        intentReceipt.action_kind === 'MANIPULATE';
    }

    if (!isActionAuthorized) {
      decisions.push({
        mutation: normalizedMutation,
        outcome: 'REJECTED',
        reason: 'ACTION_NOT_AUTHORIZED',
      });
      continue;
    }

    // 4. State decisions
    if (mutation.domain === 'INVENTORY') {
      const targetLabel = normalizeConsequenceLabel(mutation.value);
      const targetKey = targetLabel.toLocaleLowerCase('en-US');

      if (mutation.operation === 'ADD') {
        const alreadyExists = workingInventory.some(
          (item) => item.toLocaleLowerCase('en-US') === targetKey
        );
        if (alreadyExists) {
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'NO_CHANGE',
            reason: 'DUPLICATE_VALUE',
          });
        } else if (workingInventory.length >= MAX_INVENTORY_ITEMS) {
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'REJECTED',
            reason: 'STATE_LIMIT',
          });
        } else {
          workingInventory.push(targetLabel);
          inventory_added.push(targetLabel);
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'APPLIED',
            reason: 'APPLIED',
          });
        }
      } else if (mutation.operation === 'REMOVE') {
        const foundIndex = workingInventory.findIndex(
          (item) => item.toLocaleLowerCase('en-US') === targetKey
        );
        if (foundIndex === -1) {
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'NO_CHANGE',
            reason: 'VALUE_NOT_PRESENT',
          });
        } else {
          const canonicalSpelling = workingInventory[foundIndex];
          workingInventory.splice(foundIndex, 1);
          inventory_removed.push(canonicalSpelling);
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'APPLIED',
            reason: 'APPLIED',
          });
        }
      }
    } else if (mutation.domain === 'PLAYER_INJURY') {
      const targetLabel = normalizeConsequenceLabel(mutation.value);
      const targetKey = targetLabel.toLocaleLowerCase('en-US');

      if (mutation.operation === 'ADD') {
        const alreadyExists = workingInjuries.some(
          (item) => item.toLocaleLowerCase('en-US') === targetKey
        );
        if (alreadyExists) {
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'NO_CHANGE',
            reason: 'DUPLICATE_VALUE',
          });
        } else if (workingInjuries.length >= MAX_PLAYER_INJURIES) {
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'REJECTED',
            reason: 'STATE_LIMIT',
          });
        } else {
          workingInjuries.push(targetLabel);
          injuries_added.push(targetLabel);
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'APPLIED',
            reason: 'APPLIED',
          });
        }
      } else if (mutation.operation === 'REMOVE') {
        const foundIndex = workingInjuries.findIndex(
          (item) => item.toLocaleLowerCase('en-US') === targetKey
        );
        if (foundIndex === -1) {
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'NO_CHANGE',
            reason: 'VALUE_NOT_PRESENT',
          });
        } else {
          const canonicalSpelling = workingInjuries[foundIndex];
          workingInjuries.splice(foundIndex, 1);
          injuries_removed.push(canonicalSpelling);
          decisions.push({
            mutation: normalizedMutation,
            outcome: 'APPLIED',
            reason: 'APPLIED',
          });
        }
      }
    } else if (mutation.domain === 'PSYCHOLOGICAL_STATUS') {
      const proposedStatus = mutation.value;
      if (workingPsychStatus === proposedStatus) {
        decisions.push({
          mutation: normalizedMutation,
          outcome: 'NO_CHANGE',
          reason: 'NO_CHANGE',
        });
      } else {
        workingPsychStatus = proposedStatus;
        decisions.push({
          mutation: normalizedMutation,
          outcome: 'APPLIED',
          reason: 'APPLIED',
        });
      }
    } else if (mutation.domain === 'DISCOVERY') {
      decisions.push({
        mutation: normalizedMutation,
        outcome: 'APPLIED',
        reason: 'APPLIED',
      });
    }
  }

  const post_state: CanonicalConsequenceState = {
    inventory: workingInventory,
    player_injuries: workingInjuries,
    psychological_status: workingPsychStatus,
  };

  const patch: CanonicalConsequencePatch = {
    inventory_added,
    inventory_removed,
    injuries_added,
    injuries_removed,
    psychological_status_change:
      post_state.psychological_status !== pre_state.psychological_status
        ? {
            before: pre_state.psychological_status,
            after: post_state.psychological_status,
          }
        : null,
  };

  return {
    version: 1,
    pre_state,
    post_state,
    patch,
    decisions,
  };
}

/**
 * Feeds structured wound facts alongside player_injuries (§15).
 */
export function createWoundFactFromPlayerInjury(
  injury: string,
  characterId: string,
  overrides?: Partial<import('../types/death').WoundFactProposal>
): import('../types/death').WoundFactProposal {
  const norm = normalizeConsequenceLabel(injury);
  return {
    characterId,
    mechanism: norm || 'physical trauma',
    location: 'torso',
    severity: 'serious',
    timelineMinutes: 120,
    treatability: 'field dressing',
    valence: 'accident',
    ...overrides,
  };
}

