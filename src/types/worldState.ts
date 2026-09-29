import { z } from 'zod';

// ─── Restraint Ledger ───────────────────────────────────────────────────────

export const RestraintLevelSchema = z.enum([
  'UNRESTRAINED',
  'WRISTS_BOUND_FRONT',
  'WRISTS_BOUND_BEHIND',
  'TIED_TO_FIXTURE',
  'FULL_HOGTIE',
]);
export type RestraintLevel = z.infer<typeof RestraintLevelSchema>;

export const CharacterBindingSchema = z
  .object({
    characterId: z.string().min(1),
    level: RestraintLevelSchema,
    tiedToNodeId: z.string().optional(),
    boundByCharacterId: z.string().optional(),
  })
  .strict();
export type CharacterBinding = z.infer<typeof CharacterBindingSchema>;

export const LockTargetKindSchema = z.enum(['EDGE', 'CONTAINER']);
export type LockTargetKind = z.infer<typeof LockTargetKindSchema>;

export const LockStateSchema = z
  .object({
    targetRef: z.object({
      kind: LockTargetKindSchema,
      id: z.string().min(1),
    }),
    locked: z.boolean(),
    keyObjectId: z.string().optional(),
  })
  .strict();
export type LockState = z.infer<typeof LockStateSchema>;

export const RestraintLedgerSchema = z
  .object({
    bindings: z.record(z.string(), CharacterBindingSchema).default({}),
    locks: z.record(z.string(), LockStateSchema).default({}),
  })
  .strict();
export type RestraintLedger = z.infer<typeof RestraintLedgerSchema>;

// ─── World-Object Ledger ────────────────────────────────────────────────────

export const ObjectLocationKindSchema = z.enum(['NODE', 'CONTAINER', 'CARRIER']);
export type ObjectLocationKind = z.infer<typeof ObjectLocationKindSchema>;

export const ObjectSizeClassSchema = z.enum(['LIGHT', 'STANDARD', 'HEAVY']);
export type ObjectSizeClass = z.infer<typeof ObjectSizeClassSchema>;

export const WorldObjectStateSchema = z
  .object({
    objectId: z.string().min(1),
    name: z.string().min(1),
    location: z.object({
      kind: ObjectLocationKindSchema,
      id: z.string().min(1), // nodeId, containerObjectId, or characterId
    }),
    containerState: z.enum(['OPEN', 'CLOSED']).optional(),
    affordances: z.array(z.string()).default([]),
    sizeClass: ObjectSizeClassSchema.default('STANDARD'),
    effects: z.array(z.any()).default([]), // A8 DSL, frozen until Phase 3
  })
  .strict();
export type WorldObjectState = z.infer<typeof WorldObjectStateSchema>;
export type WorldObjectLedger = Record<string, WorldObjectState>;

// ─── Attention Ledger ───────────────────────────────────────────────────────

export const AttentionTargetKindSchema = z.enum(['NODE', 'OBJECT', 'CHARACTER']);
export type AttentionTargetKind = z.infer<typeof AttentionTargetKindSchema>;

export const AttentionTargetSchema = z
  .object({
    kind: AttentionTargetKindSchema,
    id: z.string().min(1),
  })
  .strict();
export type AttentionTarget = z.infer<typeof AttentionTargetSchema>;

export const AttentionStateSchema = z
  .object({
    characterId: z.string().min(1),
    attendingTo: AttentionTargetSchema.nullable().default(null),
    lapse: z
      .object({
        active: z.boolean(),
        expiresAtFictionalTime: z.number().int().nonnegative(),
      })
      .nullable()
      .default(null),
    distractibility: z.number().min(0).max(1).default(0.5),
  })
  .strict();
export type AttentionState = z.infer<typeof AttentionStateSchema>;
export type AttentionLedger = Record<string, AttentionState>;

// ─── Routine Ledger & Drift ─────────────────────────────────────────────────

export const DriftModifierPredicateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CO_LOCATION'), charA: z.string(), charB: z.string() }),
  z.object({ kind: z.literal('RESTRAINT_LEVEL'), characterId: z.string(), level: RestraintLevelSchema }),
  z.object({ kind: z.literal('CLOCK_PHASE'), clockId: z.string(), minPhase: z.string() }),
  z.object({ kind: z.literal('RELATIONSHIP_STANCE'), charA: z.string(), charB: z.string(), stance: z.string() }),
  z.object({ kind: z.literal('OBJECT_PRESENT'), nodeId: z.string(), objectId: z.string() }),
]);
export type DriftModifierPredicate = z.infer<typeof DriftModifierPredicateSchema>;

export const DriftModifierSchema = z
  .object({
    id: z.string().min(1),
    predicate: DriftModifierPredicateSchema,
    deltaMinutes: z.number().int(),
  })
  .strict();
export type DriftModifier = z.infer<typeof DriftModifierSchema>;

export const RoutineCadenceSchema = z.object({
  periodMinutes: z.number().int().positive(),
  firstFireMinutes: z.number().int().nonnegative(),
  phaseOffsetMinutes: z.number().int().default(0),
}).strict();
export type RoutineCadence = Omit<z.infer<typeof RoutineCadenceSchema>, 'phaseOffsetMinutes'> & {
  phaseOffsetMinutes?: number;
};

export const RoutineStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    nodeId: z.string().min(1),
    durationMinutes: z.number().int().positive(),
    actionSummary: z.string().min(1),
    attentionTarget: AttentionTargetSchema.optional(),
  })
  .strict();
export type RoutineStep = z.infer<typeof RoutineStepSchema>;

export const RoutineStateSchema = z
  .object({
    routineId: z.string().min(1),
    characterId: z.string().min(1),
    cadence: RoutineCadenceSchema,
    steps: z.array(RoutineStepSchema),
    currentStepIndex: z.number().int().nonnegative().default(0),
    varianceBand: z.object({
      minMinutes: z.number().int(),
      maxMinutes: z.number().int(),
    }),
    modifiers: z.array(DriftModifierSchema).default([]),
    nextFireFictionalTime: z.number().int().nonnegative().optional(),
    lastFiredFictionalTime: z.number().int().nonnegative().optional(),
  })
  .strict();
export type RoutineState = Omit<z.infer<typeof RoutineStateSchema>, 'currentStepIndex' | 'modifiers' | 'cadence'> & {
  cadence: RoutineCadence;
  currentStepIndex?: number;
  modifiers?: DriftModifier[];
};
export type RoutineLedger = Record<string, RoutineState>;

export const RoutineEventSchema = z.object({
  routineId: z.string().min(1),
  characterId: z.string().min(1).optional(),
  stepNumber: z.number().int().positive(),
  firedAtFictionalTime: z.number().int().nonnegative(),
  driftMinutes: z.number().int(),
  firedModifierIds: z.array(z.string()),
  nodeTransition: z.object({ fromNodeId: z.string(), toNodeId: z.string() }).optional(),
  attentionSet: AttentionTargetSchema.optional(),
  skipped: z.object({
    reasonCode: z.enum(['RESTRAINT_BINDING', 'CAPABILITY_IMPAIRED', 'NOT_AN_NPC', 'PLAYER_SEAT']),
    provenance: z.string(),
  }).optional(),
}).strict();
export type RoutineEvent = z.infer<typeof RoutineEventSchema>;

// ─── Physical Capabilities (A5 Stub) ────────────────────────────────────────

export const PhysicalCapabilitySchema = z.enum([
  'GRIP_FINE',
  'GRIP_COARSE',
  'LOCOMOTION_RAPID',
  'LOCOMOTION_NORMAL',
  'VOCAL_FULL',
  'VOCAL_WHISPER',
]);
export type PhysicalCapability = z.infer<typeof PhysicalCapabilitySchema>;

export interface CharacterCapabilityState {
  impairedCapabilities: PhysicalCapability[];
  provenance?: string[];
}
export type CapabilityLedger = Record<string, CharacterCapabilityState>;

// ─── Projection Context & Reason Codes ──────────────────────────────────────

export interface SeatRoleContext {
  captorCharacterIds: string[];
  preyCharacterIds: string[];
}

export interface AttemptFilterContext {
  restraint: RestraintLedger;
  objects: WorldObjectLedger;
  attention: AttentionLedger;
  routines: RoutineLedger;
  capabilities: CapabilityLedger;
  seats: SeatRoleContext;
  fictionalTime: number; // in seconds
  characterNodes: Record<string, string>; // characterId -> nodeId
  topologyConnections: Array<{ fromNodeId: string; toNodeId: string; status: 'OPEN' | 'LOCKED' | 'BLOCKED' }>;
  relationships?: Array<{ charA: string; charB: string; stance: string }>;
  clocks?: Record<string, string>;
}

export type AttemptReasonCode =
  | 'ALLOWED'
  | 'RESTRAINT_BINDING'
  | 'LOCK'
  | 'OUT_OF_REACH'
  | 'CONTAINER_CLOSED'
  | 'CAPABILITY_IMPAIRED';

export interface CanAttemptResult {
  allowed: boolean;
  reasonCode: AttemptReasonCode;
  provenance: string;
}

// ─── Object Transitions (additive) ──────────────────────────────────────────

export const OBJECT_TRANSITION_KINDS = [
  'PICKUP',
  'DROP',
  'PLACE_IN',
  'OPEN',
  'CLOSE',
  'UNLOCK',
] as const;
export const ObjectTransitionKindSchema = z.enum(OBJECT_TRANSITION_KINDS);
export type ObjectTransitionKind = z.infer<typeof ObjectTransitionKindSchema>;

export const ObjectTransitionProposalSchema = z
  .object({
    objectId: z.string().min(1),
    transition: ObjectTransitionKindSchema,
    targetContainerId: z.string().optional(), // PLACE_IN only
  })
  .strict();
export type ObjectTransitionProposal = z.infer<typeof ObjectTransitionProposalSchema>;

export const ObjectTransitionReasonSchema = z.enum([
  'ALLOWED',
  'RESTRAINT_BINDING',
  'LOCK',
  'OUT_OF_REACH',
  'CONTAINER_CLOSED',
  'CAPABILITY_IMPAIRED',
  'NOT_AN_OBJECT',
  'NOT_A_CONTAINER',
  'ALREADY_IN_STATE',
]);
export type ObjectTransitionReason = z.infer<typeof ObjectTransitionReasonSchema>;

export const ObjectTransitionDecisionSchema = z
  .object({
    proposal: ObjectTransitionProposalSchema,
    accepted: z.boolean(),
    reasonCode: ObjectTransitionReasonSchema,
    provenance: z.string(),
  })
  .strict();
export type ObjectTransitionDecision = z.infer<typeof ObjectTransitionDecisionSchema>;

// ─── Attention Transitions (additive) ────────────────────────────────────────

export const ATTENTION_TRANSITION_KINDS = ['CAPTURE', 'RELEASE', 'DISTRACT'] as const;
export const AttentionTransitionKindSchema = z.enum(ATTENTION_TRANSITION_KINDS);
export type AttentionTransitionKind = z.infer<typeof AttentionTransitionKindSchema>;

export const AttentionTransitionProposalSchema = z
  .object({
    characterId: z.string().min(1),
    transition: AttentionTransitionKindSchema,
    target: AttentionTargetSchema.optional(),
    durationMinutes: z.number().int().positive().optional(),
  })
  .strict();
export type AttentionTransitionProposal = z.infer<typeof AttentionTransitionProposalSchema>;

export const ATTENTION_TRANSITION_REASONS = [
  'ALLOWED',
  'NOT_AN_NPC',
  'TARGET_OUT_OF_REACH',
  'ALREADY_IN_STATE',
  'DURATION_REQUIRED',
  'TARGET_REQUIRED',
] as const;
export const AttentionTransitionReasonSchema = z.enum(ATTENTION_TRANSITION_REASONS);
export type AttentionTransitionReason = z.infer<typeof AttentionTransitionReasonSchema>;

export const AttentionTransitionDecisionSchema = z
  .object({
    proposal: AttentionTransitionProposalSchema,
    accepted: z.boolean(),
    reasonCode: AttentionTransitionReasonSchema,
    provenance: z.string(),
  })
  .strict();
export type AttentionTransitionDecision = z.infer<typeof AttentionTransitionDecisionSchema>;

// ─── Seed State: Knowledge & Bond Edges ─────────────────────────────────────

export const KnowledgeEntrySchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    provenance: z.string().default('SEED'),
  })
  .strict();
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;
export type KnowledgeByCharacter = Record<string, KnowledgeEntry[]>;

export const BondEdgeSchema = z
  .object({
    fromCharacterId: z.string().min(1),
    toCharacterId: z.string().min(1),
    stance: z.enum(['trust', 'distrust', 'unsure']),
    note: z.string().optional(),
    provenance: z.string().default('SEED'),
  })
  .strict();
export type BondEdge = z.infer<typeof BondEdgeSchema>;
export type BondEdges = BondEdge[];

