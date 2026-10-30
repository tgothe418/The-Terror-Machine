import {
  Blueprint,
  BlueprintSchema,
  LogicState,
  ParticipationContext,
} from '../types';
import { EngineState, initialEngineState } from '../core/engine/reducer';
import { normalizeBlueprint } from './normalizeBlueprint';
import { compileRuntimeTopology } from './compileRuntimeTopology';
import { applySeedToState } from './seedApplication';
import { initializeDramaturgyRuntimeState } from './composureDerivation';
import { createInitialValueStateLedger } from './valueState';
import { createInitialCharacterPursuitLedger } from './characterPursuits';
import { createInitialCharacterDevelopmentLedger } from './characterDevelopment';
import { createInitialFictionalTimeLedger } from './fictionalTime';
import { isHorrorVector, isExposureTier } from '../core/engine/snapshot';
import {
  CampaignCarryoverWhitelist,
  CampaignCarryoverWhitelistSchema,
  createCampaignCarryoverWhitelist,
  CampaignCharacterContinuity,
  CampaignCharacterContinuitySchema,
  CampaignTransitionReceipt,
  CampaignTransitionReceiptSchema,
  CampaignCarryoverReceipt,
  CampaignCarryoverReceiptSchema,
  CampaignCarryoverFieldEntry,
  CampaignValueAnchorContinuity,
  CampaignValueAnchorContinuitySchema,
  CampaignCharacterBond,
  CampaignCharacterBondSchema,
} from '../types/campaignContinuity';
import {
  PhysicalCapability,
  PhysicalCapabilitySchema,
  WorldObjectLedger,
  BondEdges,
  BondEdge,
} from '../types/worldState';
import { ValueStateLedger, ValueCondition, ValueLifecycle } from '../types/horrorGrammar';
import { DeathRecord } from '../types/death';
import { DramaturgyRuntimeState } from '../types/dramaturgy';

// ============================================================================
// Types & Constants (HG2 Epistemic Containment & Strict Determinism)
// ============================================================================

/**
 * GameState representation containing EngineState with optional LogicState
 * projection and campaign act history.
 */
export type GameState = EngineState & {
  gameState?: LogicState;
  dramaturgyState?: DramaturgyRuntimeState;
  dramaturgy_state?: DramaturgyRuntimeState;
  campaignActHistory?: unknown[];
  capabilities?: Record<string, { impairedCapabilities: PhysicalCapability[]; provenance?: string[] }>;
  capabilityLedger?: Record<string, { impairedCapabilities: PhysicalCapability[]; provenance?: string[] }>;
  value_state_ledger?: ValueStateLedger;
  valueStateLedger?: ValueStateLedger;
  character_pursuit_ledger?: unknown;
  character_development_ledger?: unknown;
  [key: string]: unknown;
};

export interface CampaignTransitionResult {
  nextState: GameState;
  receipt: CampaignTransitionReceipt;
  carryoverReceipt: CampaignCarryoverReceipt;
}

/**
 * Ephemeral state keys pruned during scenario transition to guarantee epistemic containment.
 * Scenario-specific topology, placed items, local pressure, and villain bindings are destroyed.
 */
export const CAMPAIGN_PRUNED_EPHEMERAL_KEYS = [
  'locationTopology',
  'obsoleteClocks',
  'placedClues',
  'routineSchedules',
  'situatedPressureLedger',
  'sourceRoomNodes',
  'temporaryDecayMetrics',
  'villainBindings',
  'worldObjectLedger',
] as const;

// ============================================================================
// Living Survivor Filter
// ============================================================================

/**
 * Pure filter that identifies living survivors from source scenario state.
 * Characters present in deathRecords, marked dead, or with unsurvivable wounds
 * are excluded from carryover.
 */
export function identifyLivingSurvivors(
  sourceState: Partial<EngineState> & Record<string, unknown>,
  candidateIds?: string[]
): string[] {
  const deathRecords = (sourceState.deathRecords as DeathRecord[]) || [];
  const deadCharIds = new Set<string>();

  for (const record of deathRecords) {
    if (record?.characterId) {
      deadCharIds.add(record.characterId);
    }
  }

  // Also check cast ledger / cast member disposition if explicitly dead
  const castList = (sourceState.cast as Array<{ id: string; isDead?: boolean; disposition?: string }>) || [];
  for (const member of castList) {
    if (member && (member.isDead === true || member.disposition === 'DEAD')) {
      deadCharIds.add(member.id);
    }
  }

  const idsToEvaluate =
    candidateIds && candidateIds.length > 0
      ? candidateIds
      : castList.map((c) => c.id).filter((id) => Boolean(id));

  const survivingIds = idsToEvaluate.filter((id) => !deadCharIds.has(id));
  return Array.from(new Set(survivingIds)).sort();
}

// ============================================================================
// Surviving Character Continuity Extractor
// ============================================================================

/**
 * Extracts a verified CampaignCharacterContinuity snapshot for a living survivor.
 * Adheres strictly to the carryover whitelist flags.
 */
export function extractSurvivingCharacterContinuity(
  sourceState: Partial<EngineState> & Record<string, unknown>,
  characterId: string,
  whitelist: CampaignCarryoverWhitelist,
  livingSurvivorIds: Set<string>
): CampaignCharacterContinuity {
  // 1. Composure (0 - 100)
  let composure = 100;
  if (whitelist.carryPsychologicalScars) {
    const dramState =
      (sourceState.dramaturgyState as DramaturgyRuntimeState) ||
      (sourceState.dramaturgy_state as DramaturgyRuntimeState);

    if (typeof dramState?.characterStakes?.[characterId]?.currentComposure === 'number') {
      composure = dramState.characterStakes[characterId].currentComposure;
    } else if (
      typeof (sourceState.character_continuity as Record<string, { composure?: number }>)?.[characterId]?.composure ===
      'number'
    ) {
      composure = (sourceState.character_continuity as Record<string, { composure?: number }>)[characterId].composure!;
    } else if (
      typeof (sourceState.composureByCharacter as Record<string, number>)?.[characterId] === 'number'
    ) {
      composure = (sourceState.composureByCharacter as Record<string, number>)[characterId];
    } else {
      const castList = (sourceState.cast as Array<{ id: string; composure?: number }>) || [];
      const found = castList.find((c) => c.id === characterId);
      if (typeof found?.composure === 'number') {
        composure = found.composure;
      }
    }
  }
  const clampedComposure = Math.max(0, Math.min(100, Math.round(composure)));

  // 2. Psychological Scars
  const scars: string[] = [];
  if (whitelist.carryPsychologicalScars) {
    const rawCharScars =
      (sourceState.characterScars as Record<string, string[]>)?.[characterId] ||
      (sourceState.character_continuity as Record<string, { scars?: string[] }>)?.[characterId]?.scars;

    if (Array.isArray(rawCharScars)) {
      for (const s of rawCharScars) {
        if (typeof s === 'string' && s.trim().length > 0) {
          scars.push(s.trim());
        }
      }
    }

    // Cast member scars
    const castList = (sourceState.cast as Array<{ id: string; scars?: string[] }>) || [];
    const foundCast = castList.find((c) => c.id === characterId);
    if (Array.isArray(foundCast?.scars)) {
      for (const s of foundCast.scars) {
        if (typeof s === 'string' && s.trim().length > 0) {
          scars.push(s.trim());
        }
      }
    }

    // Player injuries if character is player
    if (
      sourceState.player_character_id === characterId &&
      Array.isArray(sourceState.player_injuries)
    ) {
      for (const injury of sourceState.player_injuries) {
        if (typeof injury === 'string' && injury.trim().length > 0) {
          scars.push(injury.trim());
        }
      }
    }

    // TraumaLedger text entries tagged for this character or general trauma
    if (Array.isArray(sourceState.traumaLedger)) {
      for (const entry of sourceState.traumaLedger) {
        if (typeof entry === 'string' && entry.trim().length > 0) {
          scars.push(entry.trim());
        } else if (entry && typeof entry === 'object' && typeof (entry as { text?: unknown }).text === 'string') {
          const text = (entry as { text: string }).text.trim();
          if (text.length > 0) {
            scars.push(text);
          }
        }
      }
    }
  }
  const uniqueScars = Array.from(new Set(scars)).sort();

  // 3. Physical & Vocal Capability Impairments
  const impairments: PhysicalCapability[] = [];
  if (whitelist.carryPhysicalImpairments) {
    const capsFromLedger =
      (sourceState.capabilityLedger as Record<string, { impairedCapabilities?: unknown[] }>)?.[characterId]?.impairedCapabilities ||
      (sourceState.capabilities as Record<string, { impairedCapabilities?: unknown[] }>)?.[characterId]?.impairedCapabilities ||
      (sourceState.character_continuity as Record<string, { impairedCapabilities?: unknown[] }>)?.[characterId]?.impairedCapabilities;

    if (Array.isArray(capsFromLedger)) {
      for (const cap of capsFromLedger) {
        const parsed = PhysicalCapabilitySchema.safeParse(cap);
        if (parsed.success) {
          impairments.push(parsed.data);
        }
      }
    }

    const castList = (sourceState.cast as Array<{ id: string; impairedCapabilities?: unknown[] }>) || [];
    const foundCast = castList.find((c) => c.id === characterId);
    if (Array.isArray(foundCast?.impairedCapabilities)) {
      for (const cap of foundCast.impairedCapabilities) {
        const parsed = PhysicalCapabilitySchema.safeParse(cap);
        if (parsed.success) {
          impairments.push(parsed.data);
        }
      }
    }
  }
  const uniqueImpairments = Array.from(new Set(impairments)).sort();

  // 4. Value Anchors
  const carriedAnchors: CampaignValueAnchorContinuity[] = [];
  if (whitelist.carryValueShifts) {
    const valueLedger =
      (sourceState.value_state_ledger as ValueStateLedger) ||
      (sourceState.valueStateLedger as ValueStateLedger) ||
      {};

    const candidateAnchors =
      (sourceState.character_continuity as Record<string, { valueAnchors?: unknown[] }>)?.[characterId]?.valueAnchors ||
      (sourceState.characterValueAnchors as Record<string, unknown[]>)?.[characterId];

    if (Array.isArray(candidateAnchors)) {
      for (const a of candidateAnchors) {
        const parsed = CampaignValueAnchorContinuitySchema.safeParse(a);
        if (parsed.success) {
          carriedAnchors.push(parsed.data);
        }
      }
    }

    // Inspect general value ledger entries associated with this character
    for (const [anchorId, record] of Object.entries(valueLedger)) {
      if (!record || typeof record !== 'object') continue;
      const rec = record as {
        anchorId?: string;
        condition?: ValueCondition;
        lifecycle?: ValueLifecycle;
        currentFormNote?: string | null;
        lastCauseReference?: string;
        lastChangedTurn?: number;
        note?: string | null;
        holder?: { kind?: string; castMemberId?: string };
      };

      const matchesHolder = rec.holder?.castMemberId === characterId;
      const matchesId = anchorId.includes(characterId);
      const isAlreadyAdded = carriedAnchors.some((a) => a.anchorId === (rec.anchorId || anchorId));

      if ((matchesHolder || matchesId) && !isAlreadyAdded) {
        const candidate = {
          anchorId: rec.anchorId || anchorId,
          condition: rec.condition || 'ESTABLISHED',
          lifecycle: rec.lifecycle || 'ACTIVE',
          currentFormNote: rec.currentFormNote ?? null,
          lastCauseReference: rec.lastCauseReference,
          lastChangedTurn: rec.lastChangedTurn,
          note: rec.note ?? null,
        };
        const parsed = CampaignValueAnchorContinuitySchema.safeParse(candidate);
        if (parsed.success) {
          carriedAnchors.push(parsed.data);
        }
      }
    }
  }
  // Sort value anchors deterministically by anchorId
  carriedAnchors.sort((a, b) => a.anchorId.localeCompare(b.anchorId));

  // 5. Inter-Survivor Bonds (Epistemic Containment: target MUST be a living survivor)
  const carriedBonds: CampaignCharacterBond[] = [];
  if (whitelist.carryRelationshipBonds) {
    const bondsFromEdges = (sourceState.bondEdges as Array<{ fromCharacterId?: string; toCharacterId?: string; from?: string; to?: string; [k: string]: unknown }>) || [];
    for (const edge of bondsFromEdges) {
      const fromId = edge.fromCharacterId || edge.from;
      const toId = edge.toCharacterId || edge.to;
      if (fromId === characterId && toId && livingSurvivorIds.has(toId)) {
        const parsed = CampaignCharacterBondSchema.safeParse({
          targetCharacterId: toId,
          kind: edge.kind,
          stance: edge.stance,
          intensity: edge.intensity,
          note: edge.note,
        });
        if (parsed.success) {
          carriedBonds.push(parsed.data);
        }
      }
    }

    const relationships =
      (sourceState.character_relationships as Array<{ source_character_id?: string; target_character_id?: string; [k: string]: unknown }>) ||
      [];
    if (Array.isArray(relationships)) {
      for (const rel of relationships) {
        if (
          rel.source_character_id === characterId &&
          rel.target_character_id &&
          livingSurvivorIds.has(rel.target_character_id)
        ) {
          const parsed = CampaignCharacterBondSchema.safeParse({
            targetCharacterId: rel.target_character_id,
            kind: rel.kind,
            intensity: rel.intensity,
            stance: rel.stance,
            note: rel.note,
          });
          if (parsed.success) {
            carriedBonds.push(parsed.data);
          }
        }
      }
    }

    const castList = (sourceState.cast as Array<{ id: string; seed?: { bonds?: Array<{ characterId?: string; [k: string]: unknown }> } }>) || [];
    const foundCast = castList.find((c) => c.id === characterId);
    if (Array.isArray(foundCast?.seed?.bonds)) {
      for (const b of foundCast.seed.bonds) {
        const targetId = b.characterId;
        if (targetId && livingSurvivorIds.has(targetId)) {
          const isAlreadyAdded = carriedBonds.some((cb) => cb.targetCharacterId === targetId);
          if (!isAlreadyAdded) {
            const parsed = CampaignCharacterBondSchema.safeParse({
              targetCharacterId: targetId,
              stance: b.stance,
              note: b.note,
            });
            if (parsed.success) {
              carriedBonds.push(parsed.data);
            }
          }
        }
      }
    }
  }

  // Deduplicate and sort bonds deterministically by targetCharacterId
  const uniqueBondsMap = new Map<string, CampaignCharacterBond>();
  for (const b of carriedBonds) {
    if (!uniqueBondsMap.has(b.targetCharacterId)) {
      uniqueBondsMap.set(b.targetCharacterId, b);
    }
  }
  const sortedBonds = Array.from(uniqueBondsMap.values()).sort((a, b) =>
    a.targetCharacterId.localeCompare(b.targetCharacterId)
  );

  return CampaignCharacterContinuitySchema.parse({
    characterId,
    composure: clampedComposure,
    scars: uniqueScars,
    impairedCapabilities: uniqueImpairments,
    valueAnchors: carriedAnchors,
    bonds: sortedBonds,
  });
}

// ============================================================================
// Campaign Transition Pure Resolver (Item 17.2)
// ============================================================================

/**
 * Pure transition resolver for multi-scenario campaign carryover.
 * - Zero mutations to sourceState or targetBlueprint.
 * - Epistemic containment: carries forward only whitelisted character traces.
 * - Initializes target scenario state from target blueprint seeds, topology, and objects.
 * - Merges surviving character continuity records into next scenario state.
 * - Prunes all non-whitelisted ephemeral scene/room state.
 * - Generates and returns verified CampaignTransitionReceipt and CampaignCarryoverReceipt.
 */
export function resolveCampaignTransition(
  sourceState: Partial<EngineState> & Record<string, unknown>,
  targetBlueprint: Blueprint | Record<string, unknown>,
  whitelist: CampaignCarryoverWhitelist | string[]
): CampaignTransitionResult {
  // Normalize & validate whitelist
  const normalizedWhitelist: CampaignCarryoverWhitelist = Array.isArray(whitelist)
    ? createCampaignCarryoverWhitelist(whitelist)
    : CampaignCarryoverWhitelistSchema.parse(whitelist);

  // Pure inputs verification: do not mutate inputs
  const sourceScenarioId = String(
    sourceState.blueprintId || sourceState.sessionId || 'source-scenario'
  ).trim();
  const transitionTurn =
    typeof sourceState.turnCount === 'number' && Number.isFinite(sourceState.turnCount)
      ? Math.max(0, Math.floor(sourceState.turnCount))
      : 0;

  // Canonical target blueprint normalization
  const parsedTarget = BlueprintSchema.safeParse(targetBlueprint);
  const isAlreadyCanonical =
    parsedTarget.success && JSON.stringify(targetBlueprint) === JSON.stringify(parsedTarget.data);
  const normalizedTarget: Blueprint = isAlreadyCanonical
    ? (targetBlueprint as Blueprint)
    : normalizeBlueprint(targetBlueprint);

  const targetBlueprintId = String(
    normalizedTarget.id || (targetBlueprint as Record<string, unknown>).id || 'target-blueprint'
  ).trim();

  // Identify living survivors
  const livingSurvivorIds = identifyLivingSurvivors(
    sourceState,
    normalizedWhitelist.survivingCharacterIds
  );
  const livingSurvivorSet = new Set(livingSurvivorIds);

  // Extract character continuity for all living survivors
  const carriedCharacters: CampaignCharacterContinuity[] = [];
  for (const charId of livingSurvivorIds) {
    const continuity = extractSurvivingCharacterContinuity(
      sourceState,
      charId,
      normalizedWhitelist,
      livingSurvivorSet
    );
    carriedCharacters.push(continuity);
  }
  // Deterministic sorting of carried characters
  carriedCharacters.sort((a, b) => a.characterId.localeCompare(b.characterId));

  // Compile runtime topology for target blueprint
  const compiledTopology = compileRuntimeTopology({
    topology: normalizedTarget.topology,
    fallbackSetting: normalizedTarget.setting,
  });
  const startNodeId = compiledTopology.startNodeId || 'ORIGIN';

  // Deterministic new session & revision tracking
  const nextSessionId = String(
    sourceState.sessionId || `session-campaign-${transitionTurn}`
  ).trim();
  const nextRevision = ((sourceState.canonicalRevision as number) || 0) + 1;

  // Base next scenario engine state
  const baseSessionState: EngineState = {
    ...initialEngineState,
    sessionId: nextSessionId,
    blueprintId: targetBlueprintId,
    canonicalRevision: nextRevision,
    participationContext: (sourceState.participationContext as ParticipationContext | null) || null,
    phase: 'LATENT',
    currentPhase: 'LATENT',
    escalation_state: 'LATENT',
    currentNodeId: startNodeId,
    activeVector: isHorrorVector(normalizedTarget.startingVector)
      ? normalizedTarget.startingVector
      : 'COGNITIVE',
    activeTier: isExposureTier(normalizedTarget.startingTier)
      ? normalizedTarget.startingTier
      : 'LATENT',
    decay: { stage: 'STABLE', coherence: 1.0 },
    turnCount: 0,
    roomsGenerated: 0,
    traumaLedger: [],
    activeMemory: {
      systemFlags: [],
      somaState: [],
      geomState: [],
    },
    motifLedger: {},
    pacingLedger: {
      failedEscapeAttempts: 0,
      memoryAnchorsRemaining: 3,
      spatialContradictions: 0,
    },
    timelineRevision: 0,
    lastDistilledRevision: -1,
    reconciliationRevision: 0,
    history: [],
    storyLog: [],
    spatialGraph: compiledTopology.spatialGraph,
    cast: JSON.parse(JSON.stringify(normalizedTarget.cast || [])),
    fearContract: normalizedTarget.fearContract,
    deathContract: normalizedTarget.deathContract,
    lastTurnCheckpoint: null,
  };

  // Apply scenario opening state & narrative seeds from target blueprint
  const seededState: GameState = applySeedToState(baseSessionState, normalizedTarget) as GameState;

  // Initialize runtime dramaturgy and value ledgers for target scenario
  const dramaturgyRuntime = initializeDramaturgyRuntimeState(normalizedTarget);
  seededState.dramaturgyState = dramaturgyRuntime;
  seededState.dramaturgy_state = dramaturgyRuntime;

  const targetValueLedger = createInitialValueStateLedger(normalizedTarget);
  const targetPursuitLedger = createInitialCharacterPursuitLedger(normalizedTarget);

  // Merge surviving characters into target cast while preserving target scenario cast integrity
  const targetCastList = [...(seededState.cast || [])];
  const targetCastIds = new Set(targetCastList.map((c) => c.id));
  const castPlacement: Record<string, string> = { ...(seededState.castPlacement || {}) };

  // Setup capabilities ledgers
  const capabilityLedger: Record<string, { impairedCapabilities: PhysicalCapability[]; provenance?: string[] }> = {};
  const capabilities: Record<string, { impairedCapabilities: PhysicalCapability[]; provenance?: string[] }> = {};

  // Setup trauma ledger
  const nextTraumaScars = new Set<string>();

  // Setup carried bonds
  const bondEdges: BondEdges = Array.isArray(seededState.bondEdges) ? [...seededState.bondEdges] : [];

  for (const carried of carriedCharacters) {
    // 1. Cast member integration
    if (!targetCastIds.has(carried.characterId)) {
      // Find original profile in source state or build survivor record
      const sourceProfile = (sourceState.cast as Array<{ id: string; [k: string]: unknown }>)?.find(
        (c) => c.id === carried.characterId
      );
      const isUserChar = sourceProfile?.isUserCharacter === true || sourceState.player_character_id === carried.characterId;

      const survivorMember = sourceProfile
        ? {
            ...JSON.parse(JSON.stringify(sourceProfile)),
            starting_location: startNodeId,
            isUserCharacter: isUserChar,
          }
        : {
            id: carried.characterId,
            name: carried.characterId,
            role: 'Survivor',
            disposition: 'SURVIVOR' as const,
            starting_location: startNodeId,
            isUserCharacter: isUserChar,
          };
      targetCastList.push(survivorMember);
      targetCastIds.add(carried.characterId);
    }
    castPlacement[carried.characterId] = startNodeId;

    // 2. Composure integration into dramaturgy stakes
    if (!seededState.dramaturgyState.characterStakes) {
      seededState.dramaturgyState.characterStakes = {};
    }
    if (seededState.dramaturgyState.characterStakes[carried.characterId]) {
      seededState.dramaturgyState.characterStakes[carried.characterId].currentComposure = carried.composure;
    } else {
      seededState.dramaturgyState.characterStakes[carried.characterId] = {
        characterId: carried.characterId,
        coreDesireOrNeed: 'Survival',
        copingMechanism: 'Vigilance',
        breakingPointTrigger: 'Isolation',
        breakingPointThreshold: 20,
        isObstructed: false,
        liftConditions: [],
        composureSensitivity: 1.0,
        currentComposure: carried.composure,
      };
    }

    // 3. Physical & vocal capabilities integration
    capabilityLedger[carried.characterId] = {
      impairedCapabilities: [...carried.impairedCapabilities],
      provenance: ['CAMPAIGN_CARRYOVER'],
    };
    capabilities[carried.characterId] = {
      impairedCapabilities: [...carried.impairedCapabilities],
      provenance: ['CAMPAIGN_CARRYOVER'],
    };

    // 4. Psychological scars integration
    for (const scar of carried.scars) {
      nextTraumaScars.add(scar);
    }

    // 5. Value anchor integration into target ledger
    for (const anchor of carried.valueAnchors) {
      targetValueLedger[anchor.anchorId] = {
        anchorId: anchor.anchorId,
        condition: anchor.condition,
        lifecycle: anchor.lifecycle || 'ACTIVE',
        currentFormNote: anchor.currentFormNote || null,
        lastCauseReference: anchor.lastCauseReference || 'CAMPAIGN_CARRYOVER',
        lastChangedTurn: transitionTurn,
      };
    }

    // 6. Relational bonds integration
    for (const bond of carried.bonds) {
      const validStances = ['trust', 'distrust', 'unsure'] as const;
      const isStanceValid = (val: string | undefined): val is (typeof validStances)[number] =>
        Boolean(val && (validStances as readonly string[]).includes(val));
      const effectiveStance = isStanceValid(bond.stance) ? bond.stance : 'trust';

      const bondEdgeItem: BondEdge = {
        fromCharacterId: carried.characterId,
        toCharacterId: bond.targetCharacterId,
        stance: effectiveStance,
        provenance: 'CAMPAIGN_CARRYOVER',
        ...(bond.note ? { note: bond.note } : {}),
      };
      bondEdges.push(bondEdgeItem);
    }

    // 7. Carried inventory: keep items held by this survivor in carrier state
    if (sourceState.worldObjectLedger && typeof sourceState.worldObjectLedger === 'object') {
      const sourceObjects = sourceState.worldObjectLedger as WorldObjectLedger;
      if (!seededState.worldObjectLedger) {
        seededState.worldObjectLedger = {};
      }
      for (const [objId, obj] of Object.entries(sourceObjects)) {
        if (obj?.location?.kind === 'CARRIER' && obj.location.id === carried.characterId) {
          (seededState.worldObjectLedger as WorldObjectLedger)[objId] = JSON.parse(JSON.stringify(obj));
        }
      }
    }
  }

  // Update cast, placement, and ledgers in nextState
  seededState.cast = targetCastList;
  seededState.castPlacement = castPlacement;
  seededState.capabilityLedger = capabilityLedger;
  seededState.capabilities = capabilities;
  seededState.traumaLedger = Array.from(nextTraumaScars).sort();
  seededState.bondEdges = bondEdges;

  // Preserve campaign act history
  const priorHistory = Array.isArray(sourceState.campaignActHistory)
    ? [...sourceState.campaignActHistory]
    : [];

  const deterministicReceiptId = `receipt-campaign-${sourceScenarioId}-${targetBlueprintId}-turn-${transitionTurn}`;
  const deterministicTimestamp = `transition-turn-${transitionTurn}-${sourceScenarioId}-to-${targetBlueprintId}`;

  const currentActSummary = {
    actIndex: priorHistory.length + 1,
    fromBlueprintId: sourceScenarioId,
    toBlueprintId: targetBlueprintId,
    transitionTurn,
    survivorCount: carriedCharacters.length,
    survivorIds: carriedCharacters.map((c) => c.characterId),
    receiptId: deterministicReceiptId,
  };
  const updatedCampaignActHistory = [...priorHistory, currentActSummary];

  // Assemble sorted pruned state keys (strictly verified)
  const prunedStateKeys = Array.from(CAMPAIGN_PRUNED_EPHEMERAL_KEYS).sort();

  // Generate verified CampaignTransitionReceipt
  const receipt: CampaignTransitionReceipt = CampaignTransitionReceiptSchema.parse({
    receiptId: deterministicReceiptId,
    sourceScenarioId,
    targetBlueprintId,
    transitionTurn,
    carriedCharacters,
    prunedStateKeys,
    timestamp: deterministicTimestamp,
  });

  // Generate verified CampaignCarryoverReceipt
  const carriedFields: CampaignCarryoverFieldEntry[] = [];
  for (const c of carriedCharacters) {
    carriedFields.push({
      fieldPath: `survivor.${c.characterId}.composure`,
      sourceValue: c.composure,
      carriedValue: c.composure,
      notes: `Survivor ${c.characterId} composure level`,
    });
    carriedFields.push({
      fieldPath: `survivor.${c.characterId}.scars`,
      sourceValue: c.scars,
      carriedValue: c.scars,
      notes: `Survivor ${c.characterId} psychological scars`,
    });
    carriedFields.push({
      fieldPath: `survivor.${c.characterId}.impairedCapabilities`,
      sourceValue: c.impairedCapabilities,
      carriedValue: c.impairedCapabilities,
      notes: `Survivor ${c.characterId} physical capability impairments`,
    });
    carriedFields.push({
      fieldPath: `survivor.${c.characterId}.valueAnchors`,
      sourceValue: c.valueAnchors,
      carriedValue: c.valueAnchors,
      notes: `Survivor ${c.characterId} carried value anchors`,
    });
    carriedFields.push({
      fieldPath: `survivor.${c.characterId}.bonds`,
      sourceValue: c.bonds,
      carriedValue: c.bonds,
      notes: `Survivor ${c.characterId} inter-survivor relational bonds`,
    });
  }

  const fromTitle = String(
    (sourceState.blueprintTitle as string | undefined) ??
      ((sourceState.blueprint as { title?: string } | undefined)?.title) ??
      sourceScenarioId
  );
  const toTitle = String(
    normalizedTarget.title ||
      normalizedTarget.identity?.title ||
      targetBlueprintId
  );

  const carryoverReceipt: CampaignCarryoverReceipt = CampaignCarryoverReceiptSchema.parse({
    receiptId: `carryover-campaign-${sourceScenarioId}-${targetBlueprintId}-turn-${transitionTurn}`,
    fromBlueprintTitle: fromTitle,
    toBlueprintTitle: toTitle,
    transitionTurnNumber: transitionTurn,
    carriedFields,
    resetFields: prunedStateKeys,
    survivorCharacterIds: carriedCharacters.map((c) => c.characterId),
    timestamp: deterministicTimestamp,
  });

  // Prepare full GameState result
  const activeUserMember = seededState.cast?.find((c) => c.isUserCharacter);
  const activePlayerCharId = activeUserMember?.id || (sourceState.player_character_id as string | undefined) || null;

  const nextGameState: LogicState = {
    current_location: normalizedTarget.setting?.location || 'Unknown',
    player_character_id: activePlayerCharId,
    player_role: (sourceState.player_role as string) || 'PROTAGONIST',
    perspective_mode: (sourceState.perspective_mode as string) || 'FIRST_PERSON',
    current_tension_level: 'buildup',
    psychological_status: 'Stable',
    player_injuries: [],
    inventory: [],
    lore_and_memory: {
      established_facts: [],
      permanent_consequences: [],
    },
    npc_fixations: [],
    fictional_time_ledger: createInitialFictionalTimeLedger(),
    pursuit_schedule_ledger: {},
    activity_events: [],
    pressure_threads: [],
    value_state_ledger: targetValueLedger,
    character_pursuit_ledger: targetPursuitLedger,
    character_development_ledger: createInitialCharacterDevelopmentLedger(),
    dramaturgy_state: seededState.dramaturgyState,
  };

  const nextState: GameState = {
    ...seededState,
    turnCount: 0,
    gameState: nextGameState,
    value_state_ledger: targetValueLedger,
    valueStateLedger: targetValueLedger,
    character_pursuit_ledger: targetPursuitLedger,
    campaignActHistory: updatedCampaignActHistory,
  };

  return {
    nextState,
    receipt,
    carryoverReceipt,
  };
}
