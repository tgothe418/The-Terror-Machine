/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeBlueprint } from './normalizeBlueprint';
import { resolvePerspectiveBinding } from './playerCharacterBinding';
import { resolveCharacterEntryPlacement } from './resolveCharacterEntryPlacement';
import {
  Blueprint,
  EdgeKind,
  EngineTurnContext,
  ContextReceipt,
  PlayerRole,
  SpatialNode,
  ParticipationContext,
  normalizeParticipationContext,
  CharacterContinuityById,
  CharacterPresenceById,
  CanonicalConsequenceStateInput,
  CharacterStanceById,
  CharacterRelationshipState,
  CharacterMemoryById,
  WorldMemoryState,
  FictionalTimeLedger,
  PursuitScheduleLedger,
  HorrorGrammarTurnContext,
} from '../types';
import { buildCharacterContinuity, DEFAULT_SKEPTICISM } from './castContinuity';
import { buildCharacterPresence } from './castPresence';
import { createCanonicalConsequenceState } from './canonicalConsequences';
import { createCharacterStanceState } from './characterStance';
import { createCharacterRelationshipState } from './characterRelationships';
import { createCharacterMemoryState } from './characterMemory';
import { createWorldMemoryState, migrateLegacyLoreAndMemory } from './worldMemory';
import { createInitialFictionalTimeLedger } from './fictionalTime';
import { createInitialValueStateLedger } from './valueState';
import { createInitialCharacterPursuitLedger } from './characterPursuits';
import { createInitialCharacterDevelopmentLedger } from './characterDevelopment';
import {
  selectCastActivityEligibility,
  getRelevantValueAnchorsForOpportunities,
} from './castActivityEligibility';
import {
  CastActivityEvent,
  SituatedPressureThread,
  MAX_RECENT_ACTIVITY_EVENTS,
  MAX_ACTIVE_PRESSURE_THREADS,
} from '../types/horrorGrammar';
import {
  initializeDramaturgyRuntimeState,
  selectManifestationCue,
  resolveDiegeticObservation,
} from './composureDerivation';
import { compileSeatAwarePacingMandate } from './pacingGovernor';
import {
  DramaturgyRuntimeStateSchema,
  type DramaturgyRuntimeState,
  type DramaturgyTurnContext,
} from '../types/dramaturgy';
import { buildEvidenceRegistry } from './evidenceRegistry';
import { isVillainCastMember } from './castVillain';
import { seedVillainRelationshipsFromAnchors } from './villainDynamics';

export interface BuildEngineTurnContextOptions {
  blueprint: unknown;
  selectedRole?: PlayerRole | string;
  selectedCharacterId?: string | null;
  villainProtagonist?: boolean;
  spatialGraph?: SpatialNode[];
  participationContext?: ParticipationContext | null;
  characterContinuity?: CharacterContinuityById | null;
  characterPresence?: CharacterPresenceById | null;
  consequenceState?: CanonicalConsequenceStateInput | null;
  characterStance?: CharacterStanceById | null;
  characterRelationships?: CharacterRelationshipState | null;
  characterMemory?: CharacterMemoryById | null;
  worldMemory?: WorldMemoryState | null;
  fictionalTimeLedger?: FictionalTimeLedger | null;
  pursuitScheduleLedger?: PursuitScheduleLedger | null;
  activityEvents?: CastActivityEvent[] | null;
  pressureThreads?: SituatedPressureThread[] | null;
  characterPursuitLedger?: import('../types/horrorGrammar').CharacterPursuitLedger | null;
  valueStateLedger?: import('../types/horrorGrammar').ValueStateLedger | null;
  characterDevelopmentLedger?: import('../types/horrorGrammar').CharacterDevelopmentLedger | null;
  acceptedTriggerReferences?: string[];
  runtimeState?: {
    currentNodeId?: string | null;
    playerCharacterId?: string | null;
    phase?: string;
    tension?: number;
    coherence?: number;
    reconciliationRevision?: number;
    activeVector?: string;
    activeTier?: string;
    activeFlags?: readonly string[] | string[];
    turnCount?: number;
    participationContext?: ParticipationContext | null;
    characterRelationships?: CharacterRelationshipState | null;
    worldMemory?: WorldMemoryState | null;
    fictionalTimeLedger?: FictionalTimeLedger | null;
    fictional_time_ledger?: FictionalTimeLedger | null;
    pursuitScheduleLedger?: PursuitScheduleLedger | null;
    pursuit_schedule_ledger?: PursuitScheduleLedger | null;
    activityEvents?: CastActivityEvent[] | null;
    activity_events?: CastActivityEvent[] | null;
    pressureThreads?: SituatedPressureThread[] | null;
    pressure_threads?: SituatedPressureThread[] | null;
    characterPursuitLedger?: import('../types/horrorGrammar').CharacterPursuitLedger | null;
    character_pursuit_ledger?: import('../types/horrorGrammar').CharacterPursuitLedger | null;
    valueStateLedger?: import('../types/horrorGrammar').ValueStateLedger | null;
    value_state_ledger?: import('../types/horrorGrammar').ValueStateLedger | null;
    characterDevelopmentLedger?: import('../types/horrorGrammar').CharacterDevelopmentLedger | null;
    character_development_ledger?: import('../types/horrorGrammar').CharacterDevelopmentLedger | null;
    dramaturgyRuntimeState?: DramaturgyRuntimeState | null;
    dramaturgy_state?: DramaturgyRuntimeState | null;
  };
  dramaturgyRuntimeState?: DramaturgyRuntimeState | null;
}

/**
 * Resolves the turn's dramaturgy runtime state and enforces the
 * DramaturgyRuntimeStateSchema contract at the hydration boundary: schema-valid
 * persisted state passes through with schema defaults filled; corrupt state is
 * repaired to authored defaults with a visible forensic note rather than
 * entering the governor unvalidated.
 */
export function hydrateValidatedDramaturgyRuntimeState(
  opts: Pick<BuildEngineTurnContextOptions, 'dramaturgyRuntimeState' | 'runtimeState'>,
  normBp: Blueprint
): DramaturgyRuntimeState | undefined {
  const candidate =
    opts.dramaturgyRuntimeState ||
    opts.runtimeState?.dramaturgyRuntimeState ||
    opts.runtimeState?.dramaturgy_state;
  if (candidate) {
    const parsed = DramaturgyRuntimeStateSchema.safeParse(candidate);
    if (parsed.success) {
      return parsed.data;
    }
    console.warn(
      '[DRAMATURGY HYDRATION REPAIR] Persisted dramaturgy state failed schema validation; repairing to authored defaults.',
      JSON.stringify(parsed.error.issues.slice(0, 4))
    );
  }
  return normBp.dramaticSpine ? initializeDramaturgyRuntimeState(normBp) : undefined;
}

/**
 * Pure, deterministic builder that resolves the canonical EngineTurnContext.
 */
export function buildEngineTurnContext(
  optionsOrState: BuildEngineTurnContextOptions | any
): EngineTurnContext {
  let opts: BuildEngineTurnContextOptions;
  if (
    optionsOrState &&
    typeof optionsOrState === 'object' &&
    ('spatialGraph' in optionsOrState ||
      'selectedRole' in optionsOrState ||
      'selectedCharacterId' in optionsOrState ||
      'characterContinuity' in optionsOrState ||
      'consequenceState' in optionsOrState ||
      'characterStance' in optionsOrState ||
      'characterRelationships' in optionsOrState ||
      'characterMemory' in optionsOrState ||
      'worldMemory' in optionsOrState ||
      'runtimeState' in optionsOrState)
  ) {
    opts = optionsOrState;
  } else if (
    optionsOrState &&
    typeof optionsOrState === 'object' &&
    'blueprint' in optionsOrState &&
    !('turnNumber' in optionsOrState) &&
    !('currentNodeId' in optionsOrState) &&
    !('world_memory' in optionsOrState)
  ) {
    opts = optionsOrState;
  } else {
    const s = optionsOrState || {};
    opts = {
      blueprint: s.blueprint,
      selectedRole: s.selectedRole || s.playerRole,
      selectedCharacterId:
        s.selectedCharacterId !== undefined
          ? s.selectedCharacterId
          : s.player_character_id !== undefined
          ? s.player_character_id
          : s.playerCharacterId,
      spatialGraph: s.spatialGraph,
      participationContext: s.participationContext,
      characterContinuity: s.character_continuity || s.characterContinuity,
      characterPresence: s.character_presence || s.characterPresence,
      consequenceState: {
        inventory: s.inventory,
        player_injuries: s.player_injuries,
        psychological_status: s.psychological_status,
      },
      characterStance: s.character_stance || s.characterStance,
      characterRelationships: s.character_relationships || s.characterRelationships,
      characterMemory: s.character_memory || s.characterMemory,
      worldMemory: s.world_memory ?? s.worldMemory,
      runtimeState: {
        currentNodeId: s.currentNodeId,
        playerCharacterId: s.player_character_id ?? s.playerCharacterId,
        phase: s.phase,
        tension: s.tension,
        coherence: s.coherence,
        reconciliationRevision: s.reconciliationRevision,
        activeVector: s.activeVector,
        activeTier: s.activeTier,
        activeFlags: s.activeFlags,
        turnCount: s.turnNumber ?? s.turnCount,
      },
    };
  }

  const {
    blueprint,
    selectedRole = 'protagonist',
    selectedCharacterId: explicitCharId,
    spatialGraph,
    participationContext,
    characterContinuity,
    characterPresence,
    consequenceState: rawConsequenceState,
    characterStance,
    characterRelationships: rawRelationships,
    characterMemory: rawMemory,
    worldMemory: rawWorldMemoryProp,
    runtimeState = {},
  } = opts;

  const normBp: Blueprint = normalizeBlueprint(blueprint);
  const effectiveRole = (selectedRole as PlayerRole) || 'protagonist';

  const consequenceState = createCanonicalConsequenceState(rawConsequenceState);
  const normalizedStance = createCharacterStanceState(characterStance);
  const seededVillainRelationships = seedVillainRelationshipsFromAnchors(
    normBp.horrorGrammar?.valueAnchors ?? [],
    (normBp.cast ?? []).filter((c) => isVillainCastMember(c)).map((c) => c.id)
  );
  const rawList = rawRelationships ?? runtimeState.characterRelationships;
  const relationshipState = createCharacterRelationshipState([
    ...((Array.isArray(rawList) ? rawList : []) as CharacterRelationshipState),
    ...seededVillainRelationships,
  ]);
  const memoryState = createCharacterMemoryState(rawMemory);

  const hasExplicitRuntimeWorldMemory =
    rawWorldMemoryProp !== undefined || runtimeState.worldMemory !== undefined;

  const rawWorldMemory = hasExplicitRuntimeWorldMemory
    ? (rawWorldMemoryProp ?? runtimeState.worldMemory ?? [])
    : (normBp as any).world_memory !== undefined
    ? (normBp as any).world_memory
    : (blueprint as any)?.world_memory !== undefined
    ? (blueprint as any).world_memory
    : (normBp as any).lore_and_memory
    ? migrateLegacyLoreAndMemory((normBp as any).lore_and_memory)
    : (blueprint as any)?.lore_and_memory
    ? migrateLegacyLoreAndMemory((blueprint as any).lore_and_memory)
    : [];
  const worldMemory = createWorldMemoryState(rawWorldMemory);

  // 0. Participation Context resolution
  const rawParticipation =
    participationContext ??
    runtimeState.participationContext ??
    null;
  const resolvedParticipation = normalizeParticipationContext(rawParticipation);

  // 1. World rules
  let worldRules: string[] = [];
  if (typeof normBp.environmentalRules === 'string') {
    const trimmed = normBp.environmentalRules.trim();
    if (trimmed) worldRules = [trimmed];
  } else if (Array.isArray(normBp.environmentalRules)) {
    worldRules = normBp.environmentalRules.map((r) => String(r).trim()).filter((r) => r.length > 0);
  }

  // 2. Player identity
  const resolvedRequestedCharId =
    explicitCharId !== undefined
      ? explicitCharId
      : runtimeState.playerCharacterId !== undefined
      ? runtimeState.playerCharacterId
      : undefined;

  const isVillainProtagonistScenario =
    opts.villainProtagonist === true ||
    normBp.villainProtagonist === true ||
    (blueprint as { villainProtagonist?: boolean } | null | undefined)?.villainProtagonist === true;

  const { playerRole, characterId } = resolvePerspectiveBinding(
    normBp,
    effectiveRole,
    resolvedRequestedCharId
  );
  let playerName = '';
  let playerDescription = '';
  let playerIsEntity = false;

  const boundChar = characterId && normBp.cast ? normBp.cast.find((c) => c.id === characterId) : null;
  const isBoundVillain = Boolean(boundChar && isVillainCastMember(boundChar));

  if (boundChar) {
    playerName = boundChar.name || 'Unknown Character';
    playerDescription = boundChar.description || '';
    playerIsEntity = Boolean(boundChar.isEntity);
  }

  if (!playerDescription && playerRole === 'protagonist' && isBoundVillain) {
    playerDescription = 'Villain-protagonist perspective.';
  }

  if (!playerName) {
    if (playerRole === 'antagonist' || playerRole === 'villain') {
      playerName = resolvedParticipation?.seat?.name || (playerRole === 'villain' ? 'Predatory Villain' : 'Opposition Force');
      playerDescription = resolvedParticipation?.seat?.description || (playerRole === 'villain' ? 'Predatory adversary / human sociopath.' : 'Hostile presence / adversary.');
      playerIsEntity = playerRole !== 'villain';
    } else if (playerRole === 'bystander') {
      playerName = resolvedParticipation?.seat?.name || 'Bystander';
      playerDescription = resolvedParticipation?.seat?.description || 'Civilian bystander / unaware collateral.';
      playerIsEntity = false;
    } else if (playerRole === 'director') {
      playerName = 'Director';
      playerDescription = 'External narrative director.';
      playerIsEntity = false;
    } else if (playerRole === 'witness') {
      playerName = 'Witness';
      playerDescription = 'External observer.';
      playerIsEntity = false;
    } else {
      playerName = 'Survivor';
      playerDescription = isBoundVillain
        ? 'Villain-protagonist perspective.'
        : 'Primary mortal survivor perspective.';
      playerIsEntity = false;
    }
  }

  const narratorFraming =
    isVillainProtagonistScenario && playerRole === 'protagonist' && isBoundVillain
      ? 'The player is the villain. The horror is not what hunts them but what they are, what they are becoming, and how close the world is to seeing it. Never position the protagonist as prey. Other cast members are resources and risks, not fellow survivors. Discovery is the threat; the self is the haunting.'
      : undefined;

  let playerOpeningAim: string | undefined = undefined;
  let sovereigntyInstruction: string | undefined = undefined;
  let openingAimDisposition:
    | import('../types/horrorGrammar').UserOpeningAimReviewDisposition
    | undefined = undefined;

  if (characterId) {
    const charPursuit = normBp.horrorGrammar?.characterPursuits?.find(
      (p) => p.castMemberId === characterId
    );
    const reviewStatus = normBp.horrorGrammar?.pursuitReviews?.[characterId];

    if (charPursuit && charPursuit.objective && charPursuit.objective.trim().length > 0) {
      playerOpeningAim = charPursuit.objective.trim();
      openingAimDisposition = 'ACCEPTED_REFERENCE';
      sovereigntyInstruction =
        'This opening aim represents historical starting orientation only. The user retains complete sovereignty over whether, when, and how to pursue it. The Engine must never assert unchosen user actions, internal decisions, or mandatory quests based on this aim.';
    } else if (reviewStatus === 'REVIEWED_NONE') {
      playerOpeningAim = undefined;
      openingAimDisposition = 'NONE_DECLARED';
      sovereigntyInstruction =
        'No opening aim was declared for this character. The Engine must never infer, fabricate, or supply an unchosen starting goal or quest.';
    } else {
      // Legacy fallback: check top-level userOpeningAim
      const userAim = normBp.userOpeningAim || normBp.horrorGrammar?.userOpeningAim;
      if (userAim && userAim.castMemberId === characterId) {
        openingAimDisposition = userAim.disposition;
        if (
          (userAim.disposition === 'ACCEPTED_REFERENCE' || userAim.disposition === 'CREATOR_OVERRIDE') &&
          userAim.aimText &&
          userAim.aimText.trim().length > 0
        ) {
          playerOpeningAim = userAim.aimText.trim();
          sovereigntyInstruction =
            'This opening aim represents historical starting orientation only. The user retains complete sovereignty over whether, when, and how to pursue it. The Engine must never assert unchosen user actions, internal decisions, or mandatory quests based on this aim.';
        } else if (userAim.disposition === 'NONE_DECLARED') {
          playerOpeningAim = undefined;
          sovereigntyInstruction =
            'No opening aim was declared for this character. The Engine must never infer, fabricate, or supply an unchosen starting goal or quest.';
        }
      }
    }
  }

  // 3. Topology boundary (resolved early for presence calculations)
  const nodes = normBp.topology?.nodes || [];
  const currentNodeId =
    runtimeState.currentNodeId ||
    resolveCharacterEntryPlacement({
      blueprint: normBp,
      characterId,
    });
  const connections = normBp.topology?.connections || [];

  const runtimeNodeIds = (spatialGraph ?? [])
    .map((node) => node.id)
    .filter(
      (id): id is string =>
        typeof id === 'string' && id.trim().length > 0,
    )
    .map((id) => id.trim());

  const validNodeIds = runtimeNodeIds.length > 0 ? runtimeNodeIds : nodes;

  const continuity = buildCharacterContinuity(normBp.cast || [], characterContinuity);
  const presence = buildCharacterPresence(
    normBp.cast || [],
    characterPresence,
    validNodeIds,
    currentNodeId,
    characterId,
  );

  // 4. Full canonical cast roster (does NOT omit the antagonist)
  const cast = (normBp.cast || []).map((c) => {
    const canonicalId = c.id || `char-${c.name}`;
    const resolvedPresenceNodeId =
      (c.id && presence[c.id]?.nodeId) ?? presence[canonicalId]?.nodeId;
    return {
      id: canonicalId,
      name: c.name || 'Unknown',
      role: c.role || 'Subject',
      description: c.description || '',
      personality: c.personality || '',
      goals: c.goals || '',
      traits: c.traits || [],
      isEntity: Boolean(c.isEntity),
      isUserCharacter: characterId !== null ? canonicalId === characterId : false,
      expressionProfile: c.expressionProfile,
      skepticism: (c.id && continuity[c.id]?.skepticism !== undefined)
        ? continuity[c.id].skepticism
        : (continuity[canonicalId]?.skepticism ?? DEFAULT_SKEPTICISM),
      isPresent: resolvedPresenceNodeId === currentNodeId,
      stance: normalizedStance[canonicalId]
        ? {
            focus: normalizedStance[canonicalId].focus,
            stance: normalizedStance[canonicalId].stance,
          }
        : null,
      memory: (memoryState[canonicalId] ?? []).map((entry) => ({ ...entry })),
    };
  });

  const runtimeNode = spatialGraph?.find((n) => n.id === currentNodeId);
  const readableNodeLabel = runtimeNode?.name || currentNodeId.replace(/_/g, ' ');

  let allowedOutgoingExits: Array<{
    from: string;
    to: string;
    kind: EdgeKind;
    requires?: string[];
    userInitiated: boolean;
  }> = [];

  if (runtimeNode && Array.isArray(runtimeNode.exits)) {
    allowedOutgoingExits = runtimeNode.exits.map((exit) => {
      const matchingConn = connections.find(
        (conn) => conn.from === currentNodeId && conn.to === exit.targetNodeId
      );
      return {
        from: currentNodeId,
        to: exit.targetNodeId,
        kind: (matchingConn?.kind as EdgeKind) || exit.kind || 'PHYSICAL',
        requires:
          matchingConn?.requires && matchingConn.requires.length > 0
            ? matchingConn.requires
            : exit.requires && exit.requires.length > 0
              ? exit.requires
              : undefined,
        userInitiated: matchingConn?.userInitiated ?? exit.userInitiated ?? true,
      };
    });
  } else {
    allowedOutgoingExits = connections
      .filter((conn) => conn.from === currentNodeId)
      .map((conn) => ({
        from: conn.from,
        to: conn.to,
        kind: (conn.kind as EdgeKind) || 'PHYSICAL',
        requires: conn.requires && conn.requires.length > 0 ? conn.requires : undefined,
        userInitiated: conn.userInitiated !== false,
      }));
  }

  // 5. Runtime conditions
  const activeVector = runtimeState.activeVector || normBp.startingVector || 'COGNITIVE';
  const activeTier = runtimeState.activeTier || normBp.startingTier || 'LATENT';
  const phase = runtimeState.phase || 'LATENT';
  const tension = typeof runtimeState.tension === 'number' ? runtimeState.tension : 0;
  const coherence = typeof runtimeState.coherence === 'number' ? runtimeState.coherence : 1.0;
  const reconciliationRevision =
    typeof runtimeState.reconciliationRevision === 'number'
      ? runtimeState.reconciliationRevision
      : 0;
  const activeFlags = Array.isArray(runtimeState.activeFlags) ? runtimeState.activeFlags : [];
  const turnNumber =
    typeof runtimeState.turnCount === 'number' &&
    Number.isInteger(runtimeState.turnCount) &&
    runtimeState.turnCount >= 0
      ? runtimeState.turnCount
      : 0;

  const fictionalTime =
    opts.fictionalTimeLedger ??
    opts.runtimeState?.fictionalTimeLedger ??
    opts.runtimeState?.fictional_time_ledger ??
    createInitialFictionalTimeLedger();

  const pursuitSchedule =
    opts.pursuitScheduleLedger ??
    opts.runtimeState?.pursuitScheduleLedger ??
    opts.runtimeState?.pursuit_schedule_ledger ??
    {};

  const activityEvents: CastActivityEvent[] =
    opts.activityEvents ??
    opts.runtimeState?.activityEvents ??
    opts.runtimeState?.activity_events ??
    [];

  const pressureThreads: SituatedPressureThread[] =
    opts.pressureThreads ??
    opts.runtimeState?.pressureThreads ??
    opts.runtimeState?.pressure_threads ??
    [];

  const valueState =
    opts.valueStateLedger ??
    opts.runtimeState?.valueStateLedger ??
    opts.runtimeState?.value_state_ledger ??
    createInitialValueStateLedger(normBp);

  const characterPursuits =
    opts.characterPursuitLedger ??
    opts.runtimeState?.characterPursuitLedger ??
    opts.runtimeState?.character_pursuit_ledger ??
    createInitialCharacterPursuitLedger(normBp);

  const characterDevelopment =
    opts.characterDevelopmentLedger ??
    opts.runtimeState?.characterDevelopmentLedger ??
    opts.runtimeState?.character_development_ledger ??
    createInitialCharacterDevelopmentLedger();

  const castPresenceMap: Record<string, string> = {};
  for (const [cId, rec] of Object.entries(presence)) {
    if (rec?.nodeId) castPresenceMap[cId] = rec.nodeId;
  }

  // Derive acceptedTriggerReferences if not explicitly supplied
  const effectiveTriggerReferences: string[] =
    opts.acceptedTriggerReferences && opts.acceptedTriggerReferences.length > 0
      ? opts.acceptedTriggerReferences
      : (() => {
          const derived: string[] = [];
          for (const evt of activityEvents) {
            derived.push(evt.id);
            if (Array.isArray(evt.authorityReferences)) {
              for (const ref of evt.authorityReferences) {
                if (ref && !derived.includes(ref)) derived.push(ref);
              }
            }
          }
          for (const thread of pressureThreads) {
            derived.push(thread.id);
          }
          const flags = opts.runtimeState?.activeFlags;
          if (Array.isArray(flags)) {
            for (const f of flags) {
              if (f && !derived.includes(f)) derived.push(f);
            }
          }
          return derived;
        })();

  const eligibility = selectCastActivityEligibility({
    blueprint: normBp,
    currentTopologyNode: currentNodeId,
    fictionalTime,
    pursuitSchedule,
    characterPursuitLedger: characterPursuits,
    userCharacterId: characterId,
    turnNumber,
    acceptedTriggerReferences: effectiveTriggerReferences,
    castPresenceMap,
    activityEvents,
  });

  const relevantValueAnchors = getRelevantValueAnchorsForOpportunities(
    [...eligibility.presentOpportunities, ...eligibility.offscreenOpportunities],
    normBp
  );

  const evidenceRegistry = buildEvidenceRegistry({
    presentOpportunities: eligibility.presentOpportunities,
    offscreenOpportunities: eligibility.offscreenOpportunities,
    cast: normBp.cast,
    castPresenceMap,
    worldRules,
    scenarioId: normBp.id,
    valueAnchors: normBp.horrorGrammar?.valueAnchors,
    pressureThreads,
    playerOpeningAim,
    characterId,
    activityEvents,
    maxRecentActivityEvents: MAX_RECENT_ACTIVITY_EVENTS,
  });

  const horrorGrammarContext: HorrorGrammarTurnContext = {
    fictionalTime,
    activityEligibility: eligibility,
    presentActorOpportunities: eligibility.presentOpportunities,
    offscreenPursuitOpportunities: eligibility.offscreenOpportunities,
    relevantValueAnchors,
    authorityInstruction:
      'Only non-User characters listed under presentActorOpportunities and offscreenPursuitOpportunities are eligible for activity consideration on this turn. Do not generate independent actions for other cast members or the User character.',
    runtimeState: {
      fictionalTime,
      pursuitSchedule,
      recentActivityEvents: activityEvents.slice(-MAX_RECENT_ACTIVITY_EVENTS),
      activePressureThreads: pressureThreads
        .filter((t) => t.status === 'OPEN')
        .slice(-MAX_ACTIVE_PRESSURE_THREADS),
      valueState,
      characterPursuits,
      characterDevelopment,
    },
    authoringBaseline: {
      valueBaselineReview: normBp.horrorGrammar?.valueBaselineReview || 'UNREVIEWED',
      pursuitReviews: normBp.horrorGrammar?.pursuitReviews || {},
      valueAnchors: normBp.horrorGrammar?.valueAnchors || [],
      characterPursuits: normBp.horrorGrammar?.characterPursuits || [],
    },
    evidenceRegistry,
  };

  const nodeCluesRecord = Object.fromEntries(
    (normBp.topology?.nodeDefinitions ?? [])
      .filter((d) => d && typeof d.id === 'string' && Array.isArray(d.clues) && d.clues.length > 0)
      .map((d) => [d.id, d.clues])
  );

  return {
    version: 1,
    villainProtagonist: isVillainProtagonistScenario,
    ...(narratorFraming ? { narratorFraming } : {}),
    scenario: {
      id: normBp.id,
      title: normBp.title || normBp.identity?.title || 'Unknown Enclosure',
      premise: normBp.premise || normBp.globalPremise || '',
      worldRules,
      setting: {
        location: normBp.setting?.location || 'Unknown',
        atmosphere: normBp.setting?.atmosphere || '',
        timePeriod: normBp.setting?.timePeriod || '',
      },
      startingVector: normBp.startingVector || 'COGNITIVE',
      startingTier: normBp.startingTier || 'LATENT',
      incitingIncident:
        normBp.narrativeRules?.incitingIncident || (normBp as any).incitingIncident || '',
      pacingDirective:
        normBp.narrativeRules?.pacingDirectives || (normBp as any).pacingDirectives || '',
      keyPlotElements:
        normBp.narrativeRules?.keyPlotElements || (normBp as any).keyPlotElements || [],
    },
    player: {
      role: playerRole,
      characterId: characterId || null,
      name: playerName,
      description: playerDescription,
      isEntity: playerIsEntity,
      openingAim: playerOpeningAim,
      openingAimDisposition,
      sovereigntyInstruction,
    },
    cast,
    topology: {
      currentNodeId,
      readableNodeLabel,
      allowedOutgoingExits,
      ...(Object.keys(nodeCluesRecord).length > 0 ? { nodeClues: nodeCluesRecord } : {}),
    },
    runtime: {
      phase,
      tension,
      coherence,
      reconciliationRevision,
      activeVector,
      activeTier,
      activeFlags,
      turnNumber,
    },
    participationContext: resolvedParticipation || undefined,
    consequenceState,
    relationshipState,
    memoryState,
    worldMemory,
    horrorGrammar: horrorGrammarContext,
    dramaturgyContext: (() => {
      const dramState = hydrateValidatedDramaturgyRuntimeState(opts, normBp);

      if (!dramState) return undefined;

      const macroPhase = dramState.currentMacroPhase;
      const activePacingCadence = dramState.activePacingCadence;
      const pacingDirective = compileSeatAwarePacingMandate(
        playerRole,
        macroPhase,
        activePacingCadence,
        dramState.consecutiveTurnsInCadence
      );

      const activeClockManifestations: string[] = [];
      const diegeticReadings: Array<{
        instrumentName: string;
        nodeId: string;
        level: number;
        readingText: string;
      }> = [];

      for (const clock of Object.values(dramState.impendingClocks || {})) {
        const cue = selectManifestationCue(clock);
        if (cue) {
          activeClockManifestations.push(cue);
        }
        const reading = resolveDiegeticObservation(clock, currentNodeId);
        if (reading) {
          diegeticReadings.push({
            instrumentName: reading.instrumentName,
            nodeId: reading.nodeId,
            level: reading.level,
            readingText: reading.readingText,
          });
        }
      }

      const companionFrictionDirectives: Record<string, string> = {};
      for (const [cId, stakes] of Object.entries(dramState.characterStakes || {})) {
        if (stakes.isObstructed && stakes.obstructionReason) {
          companionFrictionDirectives[cId] = `[OBSTRUCTED: ${stakes.obstructionReason}]`;
        }
      }

      const ctx: DramaturgyTurnContext = {
        macroPhase,
        activePacingCadence,
        pacingDirective,
        activeClockManifestations,
        diegeticReadings,
        companionFrictionDirectives,
      };
      return ctx;
    })(),
    dramaturgyRuntimeState: hydrateValidatedDramaturgyRuntimeState(opts, normBp),
    dramaticSpine: normBp.dramaticSpine,
  };
}

export function buildContextReceipt(
  context: EngineTurnContext,
  rawOrNormalizedBlueprint?: unknown
): ContextReceipt {
  let topologyNodeCount = 0;
  let topologyConnectionCount = 0;

  if (rawOrNormalizedBlueprint && typeof rawOrNormalizedBlueprint === 'object') {
    const bp = rawOrNormalizedBlueprint as any;
    topologyNodeCount = bp.topology?.nodes?.length || 0;
    topologyConnectionCount = bp.topology?.connections?.length || 0;
  }

  return {
    version: context.version,
    scenarioTitle: context.scenario.title,
    blueprintId: context.scenario.id,
    selectedRole: context.player.role,
    resolvedPlayerName: context.player.name,
    resolvedPlayerId: context.player.characterId || null,
    currentNodeId: context.topology.currentNodeId,
    readableNodeLabel: context.topology.readableNodeLabel,
    activeVector: context.runtime.activeVector,
    activeTier: context.runtime.activeTier,
    castCount: context.cast.length,
    worldRuleCount: context.scenario.worldRules.length,
    topologyNodeCount,
    topologyConnectionCount,
  };
}
