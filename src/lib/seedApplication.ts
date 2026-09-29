import type { Blueprint } from '../types';
import type { EngineState } from '../core/engine/reducer';
import type { RestraintLevel, RestraintLedger, RoutineState } from '../types/worldState';
import { DEFAULT_FEAR_CONTRACT, ThreatType } from '../types/fear';
import { createInitialCharacterPursuitLedger } from './characterPursuits';
import type { CharacterPursuitLedger, CharacterPursuitRecord } from '../types/horrorGrammar';

export interface SeedReceipt {
  target: string;
  field: string;
  value: unknown;
  provenance: 'SEED';
}

export interface ReSeedCallerOptions {
  caller?: {
    role?: string;
    isDirector?: boolean;
    userConfirmed?: boolean;
  };
}

/**
 * Directorial gate: rewriting user circumstance mid-run requires Director seat or user confirmation.
 */
export function canRewriteUserCircumstance(caller?: {
  role?: string;
  isDirector?: boolean;
  userConfirmed?: boolean;
}): boolean {
  if (!caller) return false;
  return Boolean(
    caller.isDirector ||
    String(caller.role || '').toUpperCase() === 'DIRECTOR' ||
    caller.userConfirmed === true
  );
}

/**
 * Pure function that applies Scenario Opening State and Character Seeds to EngineState.
 * Follows strict deterministic order:
 * 1. openingState (if present) -> world ledgers
 * 2. Per-character in cast-list order:
 *    where -> wants / circumstance+inclination -> condition -> charge -> knows/bonds -> doing
 * Every write carries provenance 'SEED'.
 * Re-seeds mid-run layer over existing state as forward ledger events.
 */
export function applySeedToState(
  state: EngineState,
  blueprint: Blueprint,
  options?: ReSeedCallerOptions
): EngineState {
  const nextState: EngineState = { ...state };
  const receipts: SeedReceipt[] = [...(nextState.seedReceipts || [])];
  const isMidRun = (state.turnCount || 0) > 0;

  // Resolve topology node IDs for validation
  const topologyNodeIds = new Set<string>();
  if (Array.isArray(blueprint.topology?.nodeDefinitions)) {
    blueprint.topology.nodeDefinitions.forEach((d) => d?.id && topologyNodeIds.add(d.id));
  }
  if (Array.isArray(blueprint.topology?.nodes)) {
    blueprint.topology.nodes.forEach((n) => n && topologyNodeIds.add(n));
  }
  const bpRecord = blueprint as Record<string, unknown>;
  if (Array.isArray(bpRecord.spatialGraph)) {
    (bpRecord.spatialGraph as Array<{ id?: string }>).forEach((n) => n?.id && topologyNodeIds.add(n.id));
  }
  if (Array.isArray(nextState.spatialGraph)) {
    nextState.spatialGraph.forEach((n) => n?.id && topologyNodeIds.add(n.id));
  }

  const castList = blueprint.cast || [];
  const castIds = new Set(castList.map((c) => c.id));

  // ─── 1. Opening State (World Ledgers) ──────────────────────────────────────
  if (blueprint.openingState?.restraint) {
    const openingRestraint = blueprint.openingState.restraint;
    const currentRestraint: RestraintLedger = nextState.restraintLedger
      ? JSON.parse(JSON.stringify(nextState.restraintLedger))
      : { bindings: {}, locks: {} };

    if (openingRestraint.bindings) {
      for (const [charId, bindingRaw] of Object.entries(openingRestraint.bindings)) {
        if (!castIds.has(charId)) {
          throw new Error(
            `Scenario openingState restraint binds unknown character ID "${charId}".`
          );
        }
        const b = bindingRaw as {
          level?: string;
          boundByCharacterId?: string;
          tiedToNodeId?: string;
        };

        if (b.boundByCharacterId && !castIds.has(b.boundByCharacterId)) {
          throw new Error(
            `Scenario openingState restraint boundByCharacterId "${b.boundByCharacterId}" does not exist in cast.`
          );
        }
        if (b.tiedToNodeId && topologyNodeIds.size > 0 && !topologyNodeIds.has(b.tiedToNodeId)) {
          throw new Error(
            `Scenario openingState restraint tiedToNodeId "${b.tiedToNodeId}" does not exist in topology.`
          );
        }

        const level = (b.level || 'UNRESTRAINED') as RestraintLevel;
        currentRestraint.bindings[charId] = {
          characterId: charId,
          level,
          boundByCharacterId: b.boundByCharacterId,
          tiedToNodeId: b.tiedToNodeId,
        };

        receipts.push({
          target: `restraint.bindings.${charId}`,
          field: 'level',
          value: level,
          provenance: 'SEED',
        });
      }
    }

    if (openingRestraint.locks) {
      for (const [lockId, lockRaw] of Object.entries(openingRestraint.locks)) {
        const l = lockRaw as {
          targetRef: { kind: 'EDGE' | 'CONTAINER'; id: string };
          locked: boolean;
          keyObjectId?: string;
        };
        currentRestraint.locks[lockId] = {
          targetRef: l.targetRef,
          locked: l.locked,
          keyObjectId: l.keyObjectId,
        };

        receipts.push({
          target: `restraint.locks.${lockId}`,
          field: 'locked',
          value: l.locked,
          provenance: 'SEED',
        });
      }
    }

    nextState.restraintLedger = currentRestraint;
  }

  // Ensure state ledger records exist
  nextState.castPlacement = { ...(nextState.castPlacement || {}) };
  nextState.salienceLedger = { ...(nextState.salienceLedger || {}) };
  nextState.knowledgeByCharacter = { ...(nextState.knowledgeByCharacter || {}) };
  nextState.bondEdges = nextState.bondEdges ? [...nextState.bondEdges] : [];
  nextState.characterWants = { ...(nextState.characterWants || {}) };
  nextState.routineLedger = nextState.routineLedger
    ? JSON.parse(JSON.stringify(nextState.routineLedger))
    : {};

  // If routineLedger was empty, populate from blueprint routines if available
  if (Object.keys(nextState.routineLedger).length === 0) {
    const bpRecord = blueprint as Record<string, unknown>;
    const bpRoutines = bpRecord.routines || bpRecord.routineLedger;
    if (Array.isArray(bpRoutines)) {
      (bpRoutines as RoutineState[]).forEach((r) => {
        if (r?.routineId) nextState.routineLedger![r.routineId] = JSON.parse(JSON.stringify(r));
      });
    } else if (bpRoutines && typeof bpRoutines === 'object') {
      Object.entries(bpRoutines as Record<string, RoutineState>).forEach(([k, r]) => {
        if (r) nextState.routineLedger![k] = JSON.parse(JSON.stringify(r));
      });
    }
  }

  // ─── 2. Per-character Seeds in Cast-list Order ─────────────────────────────
  for (const member of castList) {
    const seed = member.seed;
    if (!seed) continue;

    const charId = member.id;

    // A. where
    nextState.castPlacement[charId] = seed.where;
    if (member.isUserCharacter && (!nextState.currentNodeId || nextState.currentNodeId === 'ORIGIN')) {
      nextState.currentNodeId = seed.where;
    }
    receipts.push({
      target: `castPlacement.${charId}`,
      field: 'where',
      value: seed.where,
      provenance: 'SEED',
    });

    // B. wants (NPC) or circumstance/inclination (User character)
    if (member.isUserCharacter) {
      if (
        isMidRun &&
        seed.circumstance !== undefined &&
        nextState.userCircumstance !== undefined &&
        seed.circumstance !== nextState.userCircumstance
      ) {
        if (!canRewriteUserCircumstance(options?.caller)) {
          throw new Error(
            'Rewriting user circumstance mid-run is restricted to the Director seat or explicit user confirmation.'
          );
        }
      }
      if (seed.circumstance !== undefined) {
        nextState.userCircumstance = seed.circumstance;
        receipts.push({
          target: `userCharacter.${charId}`,
          field: 'circumstance',
          value: seed.circumstance,
          provenance: 'SEED',
        });
      }
      if (seed.inclination !== undefined) {
        nextState.userInclination = seed.inclination;
        receipts.push({
          target: `userCharacter.${charId}`,
          field: 'inclination',
          value: seed.inclination,
          provenance: 'SEED',
        });
      }
    } else {
      if (seed.wants) {
        nextState.characterWants[charId] = seed.wants;
        receipts.push({
          target: `characterWants.${charId}`,
          field: 'wants',
          value: seed.wants,
          provenance: 'SEED',
        });

        if (seed.wants.kind === 'pursuit') {
          const pursuitHost = nextState as EngineState & {
            characterPursuitLedger?: CharacterPursuitLedger;
            gameState?: { character_pursuit_ledger?: CharacterPursuitLedger };
          };
          if (!pursuitHost.characterPursuitLedger) {
            pursuitHost.characterPursuitLedger = createInitialCharacterPursuitLedger(blueprint);
          }
          if (pursuitHost.gameState && !pursuitHost.gameState.character_pursuit_ledger) {
            pursuitHost.gameState.character_pursuit_ledger = pursuitHost.characterPursuitLedger;
          }
          const existingPursuit = Object.values(pursuitHost.characterPursuitLedger).find(
            (p: CharacterPursuitRecord) => p?.castMemberId === charId
          );
          if (existingPursuit) {
            existingPursuit.status = 'ACTIVE';
            existingPursuit.currentObjective = seed.wants.text;
            existingPursuit.lastCauseReference = 'SEED';
            if (seed.where) {
              existingPursuit.currentLocationNodeId = seed.where;
            }
          } else {
            const pursuitId = `pursuit-seed-${charId}`;
            const newRecord: CharacterPursuitRecord = {
              pursuitId,
              castMemberId: charId,
              currentObjective: seed.wants.text,
              currentApproach: 'SEED_INITIAL',
              currentLocationNodeId: seed.where,
              status: 'ACTIVE',
              progressSummary: 'Seeded pursuit initiated',
              lastCauseReference: 'SEED',
              lastActivityTurn: null,
              lastChangedTurn: nextState.turnCount || 0,
              reviewWindow: 'MOMENT',
            };
            pursuitHost.characterPursuitLedger[pursuitId] = newRecord;
            if (pursuitHost.gameState?.character_pursuit_ledger) {
              pursuitHost.gameState.character_pursuit_ledger[pursuitId] = newRecord;
            }
          }
        }
      }
    }

    // C. condition (Restraint)
    if (seed.condition?.restraint) {
      if (!nextState.restraintLedger) {
        nextState.restraintLedger = { bindings: {}, locks: {} };
      }
      const r = seed.condition.restraint;
      const level = (r.level || 'UNRESTRAINED') as RestraintLevel;
      nextState.restraintLedger.bindings[charId] = {
        characterId: charId,
        level,
        boundByCharacterId: r.boundByCharacterId,
        tiedToNodeId: r.tiedToNodeId,
      };
      receipts.push({
        target: `restraint.bindings.${charId}`,
        field: 'level',
        value: level,
        provenance: 'SEED',
      });
    }

    // D. charge (Fear & Salience)
    const somaticBands =
      blueprint.fearContract?.somaticBands ?? DEFAULT_FEAR_CONTRACT.somaticBands;
    const chargeBand = seed.charge?.band ?? 'calm';
    let dread = 0.0;
    if (chargeBand === 'calm') {
      dread = 0.0;
    } else if (chargeBand === 'Mild Tension') {
      dread = somaticBands.band1;
    } else if (chargeBand === 'Acute Fear') {
      dread = somaticBands.band2;
    } else if (chargeBand === 'Severe Panic') {
      dread = somaticBands.band3;
    } else if (chargeBand === 'Breaking Point') {
      dread = somaticBands.band4;
    }

    const preyEnterThreshold =
      blueprint.fearContract?.preyEnterThreshold ?? DEFAULT_FEAR_CONTRACT.preyEnterThreshold;
    const preyMode = dread >= preyEnterThreshold;
    const threatType: ThreatType = seed.charge?.threatType || 'life';

    nextState.salienceLedger[charId] = {
      spike: 0,
      dread,
      threatType,
      preyMode,
      provenance: [
        {
          eventId: 'seed',
          kind: 'other',
          spikeDelta: 0,
          dreadDelta: dread,
          turn: nextState.turnCount || 0,
          ...(seed.charge?.threatType ? { threatType: seed.charge.threatType } : {}),
        },
      ],
    };
    receipts.push({
      target: `salienceLedger.${charId}`,
      field: 'charge',
      value: { band: seed.charge.band, dread, spike: 0, threatType, preyMode },
      provenance: 'SEED',
    });

    // E. knows & bonds
    const charKnows = nextState.knowledgeByCharacter[charId]
      ? [...nextState.knowledgeByCharacter[charId]]
      : [];
    for (const k of seed.knows || []) {
      const existingIdx = charKnows.findIndex((entry) => entry.id === k.id);
      if (existingIdx >= 0) {
        charKnows[existingIdx] = { id: k.id, text: k.text, provenance: 'SEED' };
      } else {
        charKnows.push({ id: k.id, text: k.text, provenance: 'SEED' });
      }
    }
    nextState.knowledgeByCharacter[charId] = charKnows;
    receipts.push({
      target: `knowledgeByCharacter.${charId}`,
      field: 'knows',
      value: charKnows.length,
      provenance: 'SEED',
    });

    for (const b of seed.bonds || []) {
      const existingIdx = nextState.bondEdges.findIndex(
        (e) => e.fromCharacterId === charId && e.toCharacterId === b.characterId
      );
      const edge = {
        fromCharacterId: charId,
        toCharacterId: b.characterId,
        stance: b.stance,
        note: b.note,
        provenance: 'SEED',
      };
      if (existingIdx >= 0) {
        nextState.bondEdges[existingIdx] = edge;
      } else {
        nextState.bondEdges.push(edge);
      }
    }
    receipts.push({
      target: `bondEdges.${charId}`,
      field: 'bonds',
      value: (seed.bonds || []).length,
      provenance: 'SEED',
    });

    // F. doing
    if (seed.doing.mode === 'ACTIVE') {
      const charRoutines = Object.values(nextState.routineLedger).filter(
        (r) => r?.characterId === charId
      );
      for (const r of charRoutines) {
        if (seed.doing.routineStep && Array.isArray(r.steps)) {
          const stepIdx = r.steps.findIndex(
            (s: { stepNumber?: number; actionSummary?: string; id?: string }) =>
              String(s.stepNumber) === seed.doing.routineStep ||
              s.actionSummary === seed.doing.routineStep ||
              s.id === seed.doing.routineStep
          );
          if (stepIdx >= 0) {
            r.currentStepIndex = stepIdx;
          }
        }
        r.nextFireFictionalTime = (r.cadence?.firstFireMinutes ?? 0) * 60;
      }
      receipts.push({
        target: `routineLedger.${charId}`,
        field: 'doing',
        value: { mode: 'ACTIVE', routineStep: seed.doing.routineStep, verb: seed.doing.verb },
        provenance: 'SEED',
      });
    } else if (seed.doing.mode === 'SUSPENDED') {
      if (seed.doing.oneShot) {
        const oneShotId = `one-shot-seed-${charId}`;
        nextState.routineLedger[oneShotId] = {
          routineId: oneShotId,
          characterId: charId,
          cadence: { periodMinutes: 999999, firstFireMinutes: 999999 },
          steps: [
            {
              stepNumber: 1,
              nodeId: seed.where,
              durationMinutes: 1,
              actionSummary: seed.doing.oneShot.label,
            },
          ],
          currentStepIndex: 0,
          varianceBand: { minMinutes: 0, maxMinutes: 0 },
          modifiers: [],
          nextFireFictionalTime: Number.MAX_SAFE_INTEGER,
        };
        receipts.push({
          target: `routineLedger.${oneShotId}`,
          field: 'oneShot',
          value: seed.doing.oneShot.label,
          provenance: 'SEED',
        });
      }

      const charRoutines = Object.values(nextState.routineLedger).filter(
        (r) => r?.characterId === charId && !r.routineId.startsWith('one-shot-seed-')
      );
      for (const r of charRoutines) {
        if (seed.doing.routineStep && Array.isArray(r.steps)) {
          const stepIdx = r.steps.findIndex(
            (s: { stepNumber?: number; actionSummary?: string; id?: string }) =>
              String(s.stepNumber) === seed.doing.routineStep ||
              s.actionSummary === seed.doing.routineStep ||
              s.id === seed.doing.routineStep
          );
          if (stepIdx >= 0) {
            r.currentStepIndex = stepIdx;
          }
        }
        r.nextFireFictionalTime = Number.MAX_SAFE_INTEGER; // Cadence halted
      }
      receipts.push({
        target: `routineLedger.${charId}`,
        field: 'doing',
        value: { mode: 'SUSPENDED', routineStep: seed.doing.routineStep },
        provenance: 'SEED',
      });
    }
  }

  nextState.seedReceipts = receipts;
  return nextState;
}
