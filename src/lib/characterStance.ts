import {
  CharacterStanceById,
  CharacterStanceChangeProposal,
  CharacterStanceDecision,
  CharacterStanceProposal,
  CharacterStanceReceipt,
  CharacterStanceRecordSchema,
  EngineTurnContext,
  IntentReceipt,
  NarrativeReconciliationReceipt,
  CastInteractionReceipt,
  StanceDecisionOutcome,
  StanceDecisionReason,
} from '../types';

export function createCharacterStanceState(
  input?: CharacterStanceById | null
): CharacterStanceById {
  const result: CharacterStanceById = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return result;
  }

  const sortedKeys = Object.keys(input).sort();
  for (const rawKey of sortedKeys) {
    if (typeof rawKey !== 'string') continue;
    const trimmedKey = rawKey.trim();
    if (!trimmedKey) continue;

    const rawRecord = input[rawKey];
    if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) continue;

    const parsed = CharacterStanceRecordSchema.safeParse(rawRecord);
    if (parsed.success) {
      result[trimmedKey] = {
        focus: parsed.data.focus,
        stance: parsed.data.stance,
      };
    }
  }

  const orderedResult: CharacterStanceById = {};
  for (const key of Object.keys(result).sort()) {
    orderedResult[key] = result[key];
  }

  return orderedResult;
}

export function resolveCharacterStance(input: {
  proposal: CharacterStanceProposal;
  currentState: CharacterStanceById;
  context: EngineTurnContext;
  intentReceipt: IntentReceipt;
  reconciliationReceipt: NarrativeReconciliationReceipt;
  castInteractionReceipt: CastInteractionReceipt;
}): CharacterStanceReceipt {
  const preState = createCharacterStanceState(input.currentState);
  const workingState: CharacterStanceById = {};
  for (const [key, record] of Object.entries(preState)) {
    workingState[key] = { ...record };
  }

  const decisions: CharacterStanceDecision[] = [];
  const changes = Array.isArray(input.proposal?.changes) ? input.proposal.changes : [];

  for (const rawChange of changes) {
    const characterId =
      typeof rawChange.character_id === 'string' ? rawChange.character_id.trim() : '';
    const proposal: CharacterStanceChangeProposal = {
      character_id: characterId,
      focus: rawChange.focus,
      stance: rawChange.stance,
      rationale: typeof rawChange.rationale === 'string' ? rawChange.rationale.trim() : '',
    };

    const currentRecord = workingState[characterId] ? { ...workingState[characterId] } : null;

    let outcome: StanceDecisionOutcome;
    let reason: StanceDecisionReason;

    // 1. RECONCILIATION_SUPPRESSED when mode is NOT_REQUIRED or EXPERIENTIAL_REANCHORED,
    // feasibility is IMPOSSIBLE, or action is SYSTEM
    if (
      input.reconciliationReceipt.mode === 'NOT_REQUIRED' ||
      input.reconciliationReceipt.mode === 'EXPERIENTIAL_REANCHORED' ||
      input.reconciliationReceipt.feasibility === 'IMPOSSIBLE' ||
      input.intentReceipt.action_kind === 'SYSTEM'
    ) {
      outcome = 'REJECTED';
      reason = 'RECONCILIATION_SUPPRESSED';
    } else {
      // 2. ROLE_NOT_AUTHORIZED unless effective role is protagonist or possessed,
      // or antagonist with WITHIN_CONTRACT alignment
      const effectiveRole = (
        input.context.participationContext?.mode ?? input.context.player.role
      ).toLowerCase();

      const isAuthorizedRole =
        effectiveRole === 'protagonist' ||
        effectiveRole === 'survivor' ||
        effectiveRole === 'bystander' ||
        effectiveRole === 'possessed' ||
        ((effectiveRole === 'antagonist' || effectiveRole === 'villain') &&
          input.reconciliationReceipt.authority_alignment === 'WITHIN_CONTRACT');

      if (!isAuthorizedRole) {
        outcome = 'REJECTED';
        reason = 'ROLE_NOT_AUTHORIZED';
      } else if (input.intentReceipt.action_kind === 'WAIT') {
        // 3. ACTION_NOT_AUTHORIZED for WAIT; all other non-system action kinds may produce an observable stance change
        outcome = 'REJECTED';
        reason = 'ACTION_NOT_AUTHORIZED';
      } else {
        // 4. UNKNOWN_CHARACTER when no exact cast ID exists
        const castMember = input.context.cast?.find((c) => c.id === characterId);
        if (!castMember) {
          outcome = 'REJECTED';
          reason = 'UNKNOWN_CHARACTER';
        } else if (
          (input.context.player.characterId && input.context.player.characterId === characterId) ||
          Boolean(castMember.isUserCharacter)
        ) {
          // 5. PLAYER_CHARACTER when the ID is context.player.characterId or the cast member is isUserCharacter
          outcome = 'REJECTED';
          reason = 'PLAYER_CHARACTER';
        } else if (
          castMember.isPresent === false &&
          !(
            input.intentReceipt.action_kind === 'COMMUNICATE' &&
            (input.castInteractionReceipt.addressedCharacterId === characterId ||
              input.castInteractionReceipt.respondingCharacterId === characterId)
          )
        ) {
          // 6. CHARACTER_ABSENT when the cast member is not present and not engaged in remote communication
          outcome = 'REJECTED';
          reason = 'CHARACTER_ABSENT';
        } else if (
          input.intentReceipt.action_kind === 'COMMUNICATE' &&
          input.castInteractionReceipt.addressedCharacterId !== characterId &&
          input.castInteractionReceipt.respondingCharacterId !== characterId
        ) {
          // 7. For COMMUNICATE, COMMUNICATION_TARGET_MISMATCH unless the ID equals castInteractionReceipt.addressedCharacterId or respondingCharacterId
          outcome = 'REJECTED';
          reason = 'COMMUNICATION_TARGET_MISMATCH';
        } else if (
          currentRecord &&
          currentRecord.focus === proposal.focus &&
          currentRecord.stance === proposal.stance
        ) {
          // 8. NO_CHANGE when current focus and stance already equal the proposal
          outcome = 'NO_CHANGE';
          reason = 'NO_CHANGE';
        } else {
          // 9. Otherwise APPLIED and replace that character's record
          outcome = 'APPLIED';
          reason = 'APPLIED';
          workingState[characterId] = {
            focus: proposal.focus,
            stance: proposal.stance,
          };
        }
      }
    }

    const before = currentRecord ? { ...currentRecord } : null;
    const after = workingState[characterId] ? { ...workingState[characterId] } : null;

    decisions.push({
      proposal,
      outcome,
      reason,
      before,
      after,
    });
  }

  const postState = createCharacterStanceState(workingState);

  return {
    version: 1,
    pre_state: preState,
    post_state: postState,
    decisions,
  };
}

export interface FocusFlipDescriberBeat {
  character_id: string;
  previousFocus: string;
  currentFocus: string;
  beat: string;
}

export function deriveFocusFlipBeats(
  input: CharacterStanceDecision[] | CharacterStanceReceipt
): FocusFlipDescriberBeat[] {
  const decisions = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray(input.decisions)
      ? input.decisions
      : [];

  const beats: FocusFlipDescriberBeat[] = [];

  for (const decision of decisions) {
    if (decision.outcome !== 'APPLIED') {
      continue;
    }

    const previousFocus = decision.before?.focus;
    const currentFocus = decision.after?.focus;

    if (
      previousFocus !== undefined &&
      previousFocus !== null &&
      currentFocus !== undefined &&
      currentFocus !== null &&
      previousFocus !== currentFocus
    ) {
      const characterId = decision.proposal?.character_id ?? '';
      beats.push({
        character_id: characterId,
        previousFocus,
        currentFocus,
        beat: `${characterId} shifts focus from ${previousFocus} to ${currentFocus}`,
      });
    }
  }

  return beats;
}

