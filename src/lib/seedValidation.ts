import type { Blueprint, CastMember } from '../types';
import type {
  ForgeDraft,
  ForgeDraftCastMember,
  CharacterSeed,
  ScenarioOpeningState,
} from '../types/forge';
import type { AttemptFilterContext, RestraintLevel } from '../types/worldState';
import { RestraintLevelSchema } from '../types/worldState';
import {
  VERB_RESTRAINT_REQUIREMENTS,
  evaluateVerbRestraint,
} from './restraintMechanics';
import { isOppositionCastMember } from './castVillain';

export interface SeedValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates scenario openingState against cast and topology.
 */
export function validateScenarioOpeningState(
  openingState: ScenarioOpeningState | undefined,
  _draft: ForgeDraft | Blueprint,
  castList: Array<CastMember | ForgeDraftCastMember>,
  topologyNodeIds: Set<string>
): SeedValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!openingState) {
    return { valid: true, errors, warnings };
  }

  if (openingState.restraint?.bindings) {
    const castIds = new Set(castList.map((c) => c.id));
    for (const [charId, bindingRaw] of Object.entries(openingState.restraint.bindings)) {
      if (!castIds.has(charId)) {
        errors.push(`Scenario openingState restraint binds unknown character ID "${charId}".`);
      }
      if (bindingRaw && typeof bindingRaw === 'object') {
        const b = bindingRaw as {
          boundByCharacterId?: string;
          tiedToNodeId?: string;
          level?: string;
        };
        if (b.level && !RestraintLevelSchema.safeParse(b.level).success) {
          errors.push(`Scenario openingState restraint has invalid restraint level "${b.level}".`);
        }
        if (b.boundByCharacterId && !castIds.has(b.boundByCharacterId)) {
          errors.push(
            `Scenario openingState restraint boundByCharacterId "${b.boundByCharacterId}" not found in cast.`
          );
        }
        if (b.tiedToNodeId && topologyNodeIds.size > 0 && !topologyNodeIds.has(b.tiedToNodeId)) {
          errors.push(
            `Scenario openingState restraint tiedToNodeId "${b.tiedToNodeId}" not found in topology.`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates a character's seed against the blueprint/draft and internal seed invariants.
 */
export function validateSeed(
  seed: CharacterSeed,
  member: CastMember | ForgeDraftCastMember,
  draft: ForgeDraft | Blueprint,
  castList: Array<CastMember | ForgeDraftCastMember>,
  topologyNodeIds: Set<string>
): SeedValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const charName = member.name || member.id;
  const castMap = new Map<string, CastMember | ForgeDraftCastMember>();
  castList.forEach((c) => castMap.set(c.id, c));

  // ─── 1. Seed-vs-Blueprint: where node exists in topology ───────────────────
  if (topologyNodeIds.size > 0 && !topologyNodeIds.has(seed.where)) {
    errors.push(
      `Character "${charName}" seed.where node "${seed.where}" does not exist in topology.`
    );
  }

  // ─── 2. Seed-vs-Blueprint: condition restraint validation ──────────────────
  if (seed.condition?.restraint) {
    const r = seed.condition.restraint;
    if (r.level && !RestraintLevelSchema.safeParse(r.level).success) {
      errors.push(`Character "${charName}" seed restraint has invalid level "${r.level}".`);
    }

    if (r.boundByCharacterId) {
      const binder = castMap.get(r.boundByCharacterId);
      if (!binder) {
        errors.push(
          `Character "${charName}" seed restraint boundByCharacterId "${r.boundByCharacterId}" not found in cast.`
        );
      } else {
        // Dramatic inconsistency check: binder's own seed location differs from target
        const binderSeed = (binder as { seed?: CharacterSeed }).seed;
        if (binderSeed?.where && binderSeed.where !== seed.where) {
          warnings.push(
            `Dramatic inconsistency: Binder "${binder.name || binder.id}" is seeded at "${binderSeed.where}" while bound character "${charName}" is at "${seed.where}".`
          );
        }
      }
    }

    if (r.tiedToNodeId && topologyNodeIds.size > 0 && !topologyNodeIds.has(r.tiedToNodeId)) {
      errors.push(
        `Character "${charName}" seed restraint tiedToNodeId "${r.tiedToNodeId}" not found in topology.`
      );
    }
  }

  // ─── 3. Seed-vs-Blueprint: bonds target exists in cast ─────────────────────
  if (Array.isArray(seed.bonds)) {
    for (const b of seed.bonds) {
      if (!castMap.has(b.characterId)) {
        errors.push(
          `Character "${charName}" seed bond references unknown character ID "${b.characterId}".`
        );
      }
    }
  }

  // ─── 4. Seed-vs-Blueprint & S4a: doing mode and routine cursor ─────────────
  // Collect authored routines for this character
  type RoutineWithSteps = {
    characterId?: string;
    steps?: Array<{ stepNumber?: number; actionSummary?: string; nodeId?: string; id?: string }>;
  };
  const draftRecord = draft as Record<string, unknown>;
  const bpRoutines = draftRecord.routines || draftRecord.routineLedger;
  let memberRoutines: RoutineWithSteps[] = [];

  if (Array.isArray(bpRoutines)) {
    memberRoutines = (bpRoutines as RoutineWithSteps[]).filter((item) => item?.characterId === member.id);
  } else if (bpRoutines && typeof bpRoutines === 'object') {
    memberRoutines = Object.values(bpRoutines as Record<string, RoutineWithSteps>).filter(
      (item) => item?.characterId === member.id
    );
  }
  const memberRecord = member as Record<string, unknown>;
  if (memberRoutines.length === 0 && Array.isArray(memberRecord.routines)) {
    memberRoutines = memberRecord.routines as RoutineWithSteps[];
  }

  // Match referenced routineStep
  let matchedStep: { stepNumber?: number; actionSummary?: string; nodeId?: string; id?: string } | undefined;
  if (seed.doing.routineStep) {
    for (const r of memberRoutines) {
      if (Array.isArray(r.steps)) {
        const found = r.steps.find(
          (s) =>
            String(s.stepNumber) === seed.doing.routineStep ||
            s.actionSummary === seed.doing.routineStep ||
            s.id === seed.doing.routineStep
        );
        if (found) {
          matchedStep = found;
          break;
        }
      }
    }

    if (!matchedStep && !seed.doing.oneShot) {
      errors.push(
        `Character "${charName}" seed doing routineStep "${seed.doing.routineStep}" does not reference an existing routine step.`
      );
    }
  }

  // S4a: Bilocation violation: referenced routine step's node must equal seed.where
  if (matchedStep?.nodeId && matchedStep.nodeId !== seed.where) {
    errors.push(
      `Bilocation violation: Character "${charName}" routine step node "${matchedStep.nodeId}" does not match seed.where "${seed.where}".`
    );
  }

  // S4a: ACTIVE requires verb; verb must be a key in VERB_RESTRAINT_REQUIREMENTS
  if (seed.doing.mode === 'ACTIVE') {
    if (!seed.doing.verb) {
      errors.push(`Character "${charName}" has ACTIVE doing mode without a declared verb.`);
    } else {
      if (!Object.prototype.hasOwnProperty.call(VERB_RESTRAINT_REQUIREMENTS, seed.doing.verb)) {
        errors.push(
          `Character "${charName}" active verb "${seed.doing.verb}" is not a recognized restraint-gated verb.`
        );
      } else {
        // Run evaluateVerbRestraint against minimal context
        const bindingLevel = (seed.condition?.restraint?.level || 'UNRESTRAINED') as RestraintLevel;
        const ctx: AttemptFilterContext = {
          restraint: {
            bindings: {
              [member.id]: {
                characterId: member.id,
                level: bindingLevel,
                boundByCharacterId: seed.condition?.restraint?.boundByCharacterId,
                tiedToNodeId: seed.condition?.restraint?.tiedToNodeId,
              },
            },
            locks: {},
          },
          objects: {},
          attention: {},
          routines: {},
          capabilities: {},
          seats: { captorCharacterIds: [], preyCharacterIds: [] },
          fictionalTime: 0,
          characterNodes: { [member.id]: seed.where },
          topologyConnections: [],
        };

        const evalResult = evaluateVerbRestraint(member.id, seed.doing.verb, ctx);
        if (!evalResult.allowed) {
          errors.push(
            `Restraint denied: Character "${charName}" binding level ${bindingLevel} denies active verb "${seed.doing.verb}".`
          );
        }
      }
    }

    if (seed.doing.oneShot) {
      errors.push(`Character "${charName}" cannot declare oneShot in ACTIVE doing mode.`);
    }
  }

  // S4a: SUSPENDED mode must not declare a verb
  if (seed.doing.mode === 'SUSPENDED') {
    if (seed.doing.verb) {
      errors.push(`Character "${charName}" cannot declare a verb in SUSPENDED doing mode.`);
    }
  }

  // ─── 5. S4b: Law 6 Grounding ──────────────────────────────────────────────
  if (!member.isUserCharacter) {
    if (seed.wants?.kind === 'pursuit') {
      const citations = seed.wants.groundedIn || [];
      const knowsIds = new Set((seed.knows || []).map((k) => k.id));
      const isOpposition = isOppositionCastMember(member);

      let ungrounded = false;
      let reason = '';

      if (citations.length === 0) {
        ungrounded = true;
        reason = `NPC "${charName}" pursuit want requires non-empty groundedIn citations.`;
      } else {
        const unresolvable = citations.filter((cId) => !knowsIds.has(cId));
        if (unresolvable.length > 0) {
          ungrounded = true;
          reason = `NPC "${charName}" pursuit want cites unresolvable knowledge ID(s): ${unresolvable.join(', ')}.`;
        }
      }

      if (ungrounded) {
        if (isOpposition) {
          errors.push(reason);
        } else {
          warnings.push(reason);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
