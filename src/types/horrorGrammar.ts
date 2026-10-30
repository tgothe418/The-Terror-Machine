import { z } from 'zod';

// ============================================================================
// Value Holder References
// ============================================================================

export const ValueHolderCharacterSchema = z
  .object({
    kind: z.literal('CHARACTER'),
    castMemberId: z.string().min(1, 'Cast member ID is required for character value holder'),
  })
  .strict();

export const ValueHolderRelationshipSchema = z
  .object({
    kind: z.literal('RELATIONSHIP'),
    castMemberIds: z
      .tuple([
        z.string().min(1, 'First cast member ID is required'),
        z.string().min(1, 'Second cast member ID is required'),
      ])
      .refine(([a, b]) => a !== b, {
        message: 'Relationship value holder requires two distinct cast member IDs',
      }),
  })
  .strict();

export const ValueHolderPlaceSchema = z
  .object({
    kind: z.literal('PLACE'),
    nodeId: z.string().min(1, 'Topology node ID is required for place value holder'),
  })
  .strict();

export const ValueHolderScenarioSchema = z
  .object({
    kind: z.literal('SCENARIO'),
  })
  .strict();

export const ValueHolderRefSchema = z.discriminatedUnion('kind', [
  ValueHolderCharacterSchema,
  ValueHolderRelationshipSchema,
  ValueHolderPlaceSchema,
  ValueHolderScenarioSchema,
]);
export type ValueHolderRef = z.infer<typeof ValueHolderRefSchema>;

// ============================================================================
// Reviewed Provenance
// ============================================================================

export const ReviewedSourceProvenanceSchema = z
  .object({
    kind: z.literal('REVIEWED_SOURCE'),
    sourceId: z.string().min(1, 'Source ID is required for reviewed source provenance'),
    evidenceIds: z
      .array(z.string().min(1))
      .min(1, 'At least one evidence ID is required for reviewed source provenance'),
  })
  .strict();

export const CreatorDefinedProvenanceSchema = z
  .object({
    kind: z.literal('CREATOR_DEFINED'),
  })
  .strict();

export const ReviewedProvenanceSchema = z.discriminatedUnion('kind', [
  ReviewedSourceProvenanceSchema,
  CreatorDefinedProvenanceSchema,
]);
export type ReviewedProvenance = z.infer<typeof ReviewedProvenanceSchema>;

// ============================================================================
// Value Anchor
// ============================================================================

export const ValueAnchorSchema = z
  .object({
    id: z.string().min(1, 'Value anchor ID is required'),
    holder: ValueHolderRefSchema,
    label: z.string().trim().min(1, 'Label is required').max(100, 'Label exceeds 100 characters'),
    description: z
      .string()
      .trim()
      .min(1, 'Description is required')
      .max(1000, 'Description exceeds 1000 characters'),
    basisSummary: z
      .string()
      .trim()
      .min(1, 'Basis summary is required')
      .max(1000, 'Basis summary exceeds 1000 characters'),
    provenance: ReviewedProvenanceSchema,
  })
  .strict();
export type ValueAnchor = z.infer<typeof ValueAnchorSchema>;

// ============================================================================
// Character Pursuit Baseline
// ============================================================================

export const CharacterPursuitReviewWindowSchema = z.enum([
  'MOMENT',
  'SCENE_BEAT',
  'EXTENDED',
  'EVENT_DRIVEN',
]);
export type CharacterPursuitReviewWindow = z.infer<typeof CharacterPursuitReviewWindowSchema>;

export const CharacterPursuitStatusSchema = z.enum(['ACTIVE', 'DORMANT']);
export type CharacterPursuitStatus = z.infer<typeof CharacterPursuitStatusSchema>;

const BaseCharacterPursuitSchema = z
  .object({
    id: z.string().min(1, 'Pursuit ID is required'),
    castMemberId: z.string().min(1, 'Cast member ID is required for character pursuit'),
    objective: z
      .string()
      .trim()
      .min(1, 'Objective is required')
      .max(1000, 'Objective exceeds 1000 characters'),
    presentApproach: z
      .string()
      .trim()
      .min(1, 'Present approach is required')
      .max(1000, 'Present approach exceeds 1000 characters'),
    locationNodeId: z.string().min(1).nullish().default(null),
    status: CharacterPursuitStatusSchema.default('ACTIVE'),
    reviewWindow: CharacterPursuitReviewWindowSchema,
    triggerReferences: z.array(z.string().trim().min(1)).default([]),
    basisSummary: z
      .string()
      .trim()
      .min(1, 'Basis summary is required')
      .max(1000, 'Basis summary exceeds 1000 characters'),
    provenance: ReviewedProvenanceSchema,
  })
  .strict();

export const CharacterPursuitSchema = BaseCharacterPursuitSchema.refine(
  (pursuit) => {
    if (pursuit.reviewWindow === 'EVENT_DRIVEN') {
      return Array.isArray(pursuit.triggerReferences) && pursuit.triggerReferences.length > 0;
    }
    return true;
  },
  {
    message: 'EVENT_DRIVEN review window requires at least one trigger reference',
    path: ['triggerReferences'],
  }
);
export type CharacterPursuit = z.infer<typeof CharacterPursuitSchema>;

// ============================================================================
// Explicit Baseline Review State
// ============================================================================

export const ValueBaselineReviewStateSchema = z.enum([
  'UNREVIEWED',
  'REVIEWED_NONE',
  'REVIEWED',
]);
export type ValueBaselineReviewState = z.infer<typeof ValueBaselineReviewStateSchema>;

export const PursuitReviewStateSchema = z.enum([
  'UNREVIEWED',
  'REVIEWED_NONE',
  'REVIEWED',
]);
export type PursuitReviewState = z.infer<typeof PursuitReviewStateSchema>;

export const UserOpeningAimReviewDispositionSchema = z.enum([
  'UNREVIEWED',
  'ACCEPTED_REFERENCE',
  'CREATOR_OVERRIDE',
  'NONE_DECLARED',
]);
export type UserOpeningAimReviewDisposition = z.infer<typeof UserOpeningAimReviewDispositionSchema>;

export const UserOpeningAimSchema = z
  .object({
    castMemberId: z.string().min(1, 'Cast member ID is required for user opening aim'),
    disposition: UserOpeningAimReviewDispositionSchema.default('UNREVIEWED'),
    aimText: z.string().trim().default(''),
    provenance: ReviewedProvenanceSchema.optional(),
    reviewedAt: z.number().optional(),
    sourceDraftRevision: z.number().optional(),
    sourceBaselineRevision: z.number().optional(),
  })
  .strict();
export type UserOpeningAim = z.infer<typeof UserOpeningAimSchema>;

export const HorrorGrammarAuthoringSchema = z
  .object({
    valueBaselineReview: ValueBaselineReviewStateSchema.default('UNREVIEWED'),
    pursuitReviews: z.record(z.string(), PursuitReviewStateSchema).default({}),
    valueAnchors: z.array(ValueAnchorSchema).default([]),
    characterPursuits: z.array(CharacterPursuitSchema).default([]),
    userOpeningAim: UserOpeningAimSchema.optional(),
  })
  .strict();
export type HorrorGrammarAuthoring = z.infer<typeof HorrorGrammarAuthoringSchema>;

// ============================================================================
// Packet 1-2: Fictional Time Ledger & Receipts
// ============================================================================

export const FictionalTimeCostSchema = z.enum([
  'MOMENT',
  'SCENE_BEAT',
  'EXTENDED',
  'UNCLEAR',
]);
export type FictionalTimeCost = z.infer<typeof FictionalTimeCostSchema>;

export const FictionalTimeLedgerSchema = z
  .object({
    moment_revision: z.number().int().nonnegative().default(0),
    scene_beat_revision: z.number().int().nonnegative().default(0),
    extended_revision: z.number().int().nonnegative().default(0),
    last_cost: FictionalTimeCostSchema.nullable().default(null),
  })
  .strict();
export type FictionalTimeLedger = z.infer<typeof FictionalTimeLedgerSchema>;

export const FictionalTimeReceiptSchema = z
  .object({
    version: z.literal(1).default(1),
    preState: FictionalTimeLedgerSchema,
    acceptedCost: FictionalTimeCostSchema.or(z.literal('NONE')),
    postState: FictionalTimeLedgerSchema,
  })
  .strict();
export type FictionalTimeReceipt = z.infer<typeof FictionalTimeReceiptSchema>;

// ============================================================================
// Packet 1-2: Canonical Activity Scheduling State
// ============================================================================

export const PursuitEligibilityDispositionSchema = z.enum([
  'PRESENT_OPPORTUNITY',
  'OFFSCREEN_SELECTED',
  'OFFSCREEN_DUE_BOUNDED_OUT',
  'OFFSCREEN_NOT_DUE',
  'DORMANT',
  'NO_ACTIVE_PURSUIT',
]);
export type PursuitEligibilityDisposition = z.infer<typeof PursuitEligibilityDispositionSchema>;

export const PursuitScheduleRecordSchema = z
  .object({
    pursuitId: z.string().min(1),
    castMemberId: z.string().min(1),
    lastConsideredMomentRevision: z.number().int().nonnegative().default(0),
    lastConsideredSceneBeatRevision: z.number().int().nonnegative().default(0),
    lastConsideredExtendedRevision: z.number().int().nonnegative().default(0),
    lastConsideredTurn: z.number().int().nonnegative().nullable().default(null),
    latestDisposition: PursuitEligibilityDispositionSchema.default('OFFSCREEN_NOT_DUE'),
  })
  .strict();
export type PursuitScheduleRecord = z.infer<typeof PursuitScheduleRecordSchema>;

export const PursuitScheduleLedgerSchema = z.record(z.string(), PursuitScheduleRecordSchema);
export type PursuitScheduleLedger = z.infer<typeof PursuitScheduleLedgerSchema>;

export const PursuitScheduleReceiptSchema = z
  .object({
    version: z.literal(1),
    preState: PursuitScheduleLedgerSchema,
    postState: PursuitScheduleLedgerSchema,
  })
  .strict();
export type PursuitScheduleReceipt = z.infer<typeof PursuitScheduleReceiptSchema>;

// ============================================================================
// Packet 1-2: Cast Activity Opportunities & Eligibility Receipts
// ============================================================================

export const ActivityOpportunityKindSchema = z.enum(['PRESENT', 'OFFSCREEN_PURSUIT']);
export type ActivityOpportunityKind = z.infer<typeof ActivityOpportunityKindSchema>;

export const ActivityOpportunityCandidateSchema = z
  .object({
    castMemberId: z.string().min(1),
    opportunityKind: ActivityOpportunityKindSchema,
    locationNodeId: z.string().nullable().optional(),
    pursuitId: z.string().nullable().optional(),
    objective: z.string().nullable().optional(),
    presentApproach: z.string().nullable().optional(),
    reviewWindow: CharacterPursuitReviewWindowSchema.nullable().optional(),
    referencedValueIds: z.array(z.string()).default([]),
  })
  .strict();
export type ActivityOpportunityCandidate = z.infer<typeof ActivityOpportunityCandidateSchema>;

export const CastActivityEligibilityReceiptSchema = z
  .object({
    version: z.literal(1).default(1),
    presentOpportunities: z.array(ActivityOpportunityCandidateSchema).default([]),
    offscreenOpportunities: z.array(ActivityOpportunityCandidateSchema).max(2).default([]),
    boundedOutPursuitIds: z.array(z.string()).default([]),
    dormantCount: z.number().int().nonnegative().default(0),
    notDueCount: z.number().int().nonnegative().default(0),
    ledgerSnapshot: FictionalTimeLedgerSchema,
    scheduleSnapshotRevision: z.number().int().nonnegative().default(0),
  })
  .strict();
export type CastActivityEligibilityReceipt = z.infer<typeof CastActivityEligibilityReceiptSchema>;



// ============================================================================
// Packet 1-3: Non-User Initiative, Situated Pressure, Events & Threads
// ============================================================================

export const MAX_RECENT_ACTIVITY_EVENTS = 10;
export const MAX_ACTIVE_PRESSURE_THREADS = 5;

export const PERCEPTION_PATHS = [
  'DIRECT',
  'MEDIATED',
  'LOCAL_TRACE',
  'UNOBSERVED',
] as const;

export const PerceptionPathSchema = z.enum(PERCEPTION_PATHS);
export type PerceptionPath = z.infer<typeof PerceptionPathSchema>;

export const PRESSURE_OPERATORS = [
  'EXPOSE',
  'CONSTRAIN_ACCESS',
  'ACCELERATE',
  'CORRUPT_TRUST',
  'DEGRADE_CAPABILITY',
  'CLOSE_DISTANCE',
  'DESTABILIZE_KNOWLEDGE',
  'VIOLATE_EXPECTATION',
  'IMPOSE_COST',
  'INTERNAL',
  'OTHER',
] as const;

export const PressureOperatorSchema = z.enum(PRESSURE_OPERATORS);
export type PressureOperator = z.infer<typeof PressureOperatorSchema>;

export const AFFECTED_DIMENSIONS = [
  'ACCESS',
  'KNOWLEDGE',
  'TIME',
  'TRUST',
  'EXPOSURE',
  'CAPABILITY',
  'SAFETY',
  'RELATIONSHIP',
  'FREEDOM',
  'IDENTITY',
  'OTHER',
] as const;

export const AffectedDimensionSchema = z.enum(AFFECTED_DIMENSIONS);
export type AffectedDimension = z.infer<typeof AffectedDimensionSchema>;

export const PERSISTENCE_TARGETS = [
  'CANONICAL_CONDITION',
  'WORLD_MEMORY',
  'PRESSURE_THREAD',
  'SCENARIO_STATE',
] as const;

export const PersistenceTargetSchema = z.enum(PERSISTENCE_TARGETS);
export type PersistenceTarget = z.infer<typeof PersistenceTargetSchema>;

export const ManifestationBlockSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('prose'),
      content: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('dialogue'),
      speaker: z.string().trim().min(1).max(100),
      content: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
export type ManifestationBlock = z.infer<typeof ManifestationBlockSchema>;

// --- Cast Activity Proposal ---

export const CastActivityProposalNoneSchema = z
  .object({
    kind: z.literal('NONE'),
    reason: z.string().max(200).optional(),
  })
  .strict();

export const CastActivityProposalActiveSchema = z
  .object({
    kind: z.literal('ACTIVITY'),
    proposalId: z.string().min(1),
    castMemberId: z.string().min(1),
    pursuitId: z.string().min(1).nullable().optional(),
    locationNodeId: z.string().min(1).nullable().optional(),
    activitySummary: z.string().trim().min(1).max(500),
    authorityReferences: z.array(z.string().trim().min(1)).optional(),
    perceptionPath: PerceptionPathSchema,
    manifestationBlock: ManifestationBlockSchema.nullable().optional(),
  })
  .strict();

export const CastActivityProposalSchema = z.discriminatedUnion('kind', [
  CastActivityProposalNoneSchema,
  CastActivityProposalActiveSchema,
]);
export type CastActivityProposal = z.infer<typeof CastActivityProposalSchema>;

// --- Situated Pressure Proposal ---

export const SituatedPressureProposalNoneSchema = z
  .object({
    kind: z.literal('NONE'),
    reason: z.string().max(200).optional(),
  })
  .strict();

export const SituatedPressureProposalActiveSchema = z
  .object({
    kind: z.literal('PRESSURE'),
    proposalId: z.string().min(1),
    valueAnchorId: z.string().min(1),
    sourceReference: z.string().min(1),
    operator: PressureOperatorSchema,
    affectedDimension: AffectedDimensionSchema,
    adverseProspect: z.string().trim().min(1).max(500),
    authorityReferences: z.array(z.string().trim().min(1)).optional(),
    persistenceTarget: PersistenceTargetSchema.optional(),
    responseWindowOpen: z.boolean().optional(),
    manifestationBlock: ManifestationBlockSchema.nullable().optional(),
  })
  .strict();

export const SituatedPressureProposalSchema = z.discriminatedUnion('kind', [
  SituatedPressureProposalNoneSchema,
  SituatedPressureProposalActiveSchema,
]);
export type SituatedPressureProposal = z.infer<typeof SituatedPressureProposalSchema>;

// --- Canonical Activity Events & Pressure Threads State ---

export const CastActivityEventSchema = z
  .object({
    id: z.string().min(1),
    castMemberId: z.string().min(1),
    pursuitId: z.string().nullable().default(null),
    activitySummary: z.string().min(1),
    locationNodeId: z.string().nullable().default(null),
    perceptionPath: PerceptionPathSchema,
    committedTurn: z.number().int().nonnegative(),
    authorityReferences: z.array(z.string()).default([]),
    wasManifested: z.boolean().default(false),
  })
  .strict();
export type CastActivityEvent = z.infer<typeof CastActivityEventSchema>;

export const SituatedPressureThreadStatusSchema = z.enum([
  'OPEN',
  'RESOLVED',
  'REALIZED',
  'RELEASED',
  'TRANSFORMED',
  'DEFLECTED',
  'EXPIRED',
]);
export type SituatedPressureThreadStatus = z.infer<typeof SituatedPressureThreadStatusSchema>;

export const SituatedPressureThreadSchema = z
  .object({
    id: z.string().min(1),
    valueAnchorId: z.string().min(1),
    holder: ValueHolderRefSchema,
    sourceReference: z.string().min(1),
    operator: PressureOperatorSchema,
    affectedDimension: AffectedDimensionSchema,
    adverseProspect: z.string().min(1),
    manifestationSummary: z.string().nullable().default(null),
    status: SituatedPressureThreadStatusSchema.default('OPEN'),
    createdTurn: z.number().int().nonnegative(),
    lastChangedTurn: z.number().int().nonnegative(),
    persistenceTarget: PersistenceTargetSchema.default('PRESSURE_THREAD'),
    authorityReferences: z.array(z.string()).default([]),
    perceptionPath: PerceptionPathSchema.optional(),
    locationNodeId: z.string().nullable().optional(),
  })
  .strict();
export type SituatedPressureThread = z.infer<typeof SituatedPressureThreadSchema>;

// --- Receipts ---

export const CastActivityReceiptOutcomeSchema = z.enum(['ACCEPTED', 'REJECTED', 'NO_PROPOSAL']);
export type CastActivityReceiptOutcome = z.infer<typeof CastActivityReceiptOutcomeSchema>;

export const CastActivityReceiptSchema = z
  .object({
    version: z.literal(1).default(1),
    outcome: CastActivityReceiptOutcomeSchema,
    reasonCode: z.string(),
    preState: z.array(CastActivityEventSchema).default([]),
    postState: z.array(CastActivityEventSchema).default([]),
    admittedManifestation: z.boolean().default(false),
    acceptedEventId: z.string().nullable().default(null),
    proposalSnapshot: z.unknown().optional(),
  })
  .strict();
export type CastActivityReceipt = z.infer<typeof CastActivityReceiptSchema>;

export const SituatedPressureReceiptOutcomeSchema = z.enum(['ACCEPTED', 'REJECTED', 'NO_PROPOSAL']);
export type SituatedPressureReceiptOutcome = z.infer<typeof SituatedPressureReceiptOutcomeSchema>;

export const SituatedPressureReceiptSchema = z
  .object({
    version: z.literal(1).default(1),
    outcome: SituatedPressureReceiptOutcomeSchema,
    reasonCode: z.string(),
    preState: z.array(SituatedPressureThreadSchema).default([]),
    postState: z.array(SituatedPressureThreadSchema).default([]),
    admittedManifestation: z.boolean().default(false),
    acceptedThreadId: z.string().nullable().default(null),
    proposalSnapshot: z.unknown().optional(),
    boundedOutChangeIds: z.array(z.string()).default([]),
  })
  .strict();
export type SituatedPressureReceipt = z.infer<typeof SituatedPressureReceiptSchema>;

// ============================================================================
// Packet 1-4: Value Condition, Pursuit Overlays & Character Development
// ============================================================================

// --- Value Condition & Lifecycle ---

export const VALUE_LIFECYCLES = ['ACTIVE', 'REVISED', 'RETIRED'] as const;

export const VALUE_CONDITIONS = [
  'ESTABLISHED',
  'THREATENED',
  'COMPROMISED',
  'SECURED',
  'LOST',
  'TRANSFORMED',
] as const;

export const VALUE_OPERATIONS = [
  'SET_CONDITION',
  'REVISE',
  'RETIRE',
  'RESTORE',
] as const;

export const ValueLifecycleSchema = z.enum(VALUE_LIFECYCLES);
export type ValueLifecycle = z.infer<typeof ValueLifecycleSchema>;

export const ValueConditionSchema = z.enum(VALUE_CONDITIONS);
export type ValueCondition = z.infer<typeof ValueConditionSchema>;

export const ValueOperationSchema = z.enum(VALUE_OPERATIONS);
export type ValueOperation = z.infer<typeof ValueOperationSchema>;

export const ValueStateRecordSchema = z
  .object({
    anchorId: z.string().min(1),
    lifecycle: ValueLifecycleSchema.default('ACTIVE'),
    condition: ValueConditionSchema.default('ESTABLISHED'),
    currentFormNote: z.string().nullable().default(null),
    lastCauseReference: z.string().default('BASELINE'),
    lastChangedTurn: z.number().int().nonnegative().default(0),
  })
  .strict();
export type ValueStateRecord = z.infer<typeof ValueStateRecordSchema>;

export const ValueStateLedgerSchema = z.record(z.string(), ValueStateRecordSchema);
export type ValueStateLedger = z.infer<typeof ValueStateLedgerSchema>;

export const ValueStateProposalEntrySchema = z
  .object({
    anchorId: z.string().min(1),
    operation: ValueOperationSchema,
    expectedBeforeCondition: ValueConditionSchema.optional(),
    expectedBeforeLifecycle: ValueLifecycleSchema.optional(),
    proposedCondition: ValueConditionSchema,
    proposedLifecycle: ValueLifecycleSchema.optional(),
    proposedFormNote: z.string().trim().max(300).nullable().optional(),
    causeReference: z.string().trim().min(1).max(300),
    rationale: z.string().trim().min(1).max(300),
  })
  .strict();
export type ValueStateProposalEntry = z.infer<typeof ValueStateProposalEntrySchema>;

export const MAX_VALUE_STATE_CHANGES_PER_TURN = 3;

export const ValueStateProposalSchema = z
  .object({
    changes: z.array(ValueStateProposalEntrySchema).max(MAX_VALUE_STATE_CHANGES_PER_TURN),
  })
  .strict();
export type ValueStateProposal = z.infer<typeof ValueStateProposalSchema>;

export const ValueStateReceiptSchema = z
  .object({
    version: z.literal(1).default(1),
    preState: ValueStateLedgerSchema,
    postState: ValueStateLedgerSchema,
    decisions: z
      .array(
        z.object({
          anchorId: z.string(),
          operation: ValueOperationSchema,
          outcome: z.enum(['APPLIED', 'REJECTED', 'NO_CHANGE']),
          reasonCode: z.string(),
          causeReference: z.string(),
        })
      )
      .default([]),
    boundedOutChangeIds: z.array(z.string()).default([]),
  })
  .strict();
export type ValueStateReceipt = z.infer<typeof ValueStateReceiptSchema>;

// --- Character Pursuit Runtime Overlays ---

export const PURSUIT_STATUSES = [
  'ACTIVE',
  'DORMANT',
  'BLOCKED',
  'COMPLETED',
  'ABANDONED',
] as const;

export const PURSUIT_OPERATIONS = [
  'ADVANCE',
  'SETBACK',
  'REDIRECT',
  'BLOCK',
  'COMPLETE',
  'ABANDON',
  'PAUSE',
  'RESUME',
] as const;

export const PursuitStatusSchema = z.enum(PURSUIT_STATUSES);
export type PursuitStatus = z.infer<typeof PursuitStatusSchema>;

export const PursuitOperationSchema = z.enum(PURSUIT_OPERATIONS);
export type PursuitOperation = z.infer<typeof PursuitOperationSchema>;

export const CharacterPursuitRecordSchema = z
  .object({
    pursuitId: z.string().min(1),
    castMemberId: z.string().min(1),
    currentObjective: z.string().min(1),
    currentApproach: z.string().min(1),
    currentLocationNodeId: z.string().nullable().default(null),
    status: PursuitStatusSchema.default('ACTIVE'),
    progressSummary: z.string().default('Initial baseline pursuit'),
    lastCauseReference: z.string().default('BASELINE'),
    lastActivityTurn: z.number().int().nonnegative().nullable().default(null),
    lastChangedTurn: z.number().int().nonnegative().default(0),
    reviewWindow: CharacterPursuitReviewWindowSchema.default('MOMENT'),
  })
  .strict();
export type CharacterPursuitRecord = z.infer<typeof CharacterPursuitRecordSchema>;

export const CharacterPursuitLedgerSchema = z.record(z.string(), CharacterPursuitRecordSchema);
export type CharacterPursuitLedger = z.infer<typeof CharacterPursuitLedgerSchema>;

export const CharacterPursuitProposalEntrySchema = z
  .object({
    pursuitId: z.string().min(1),
    operation: PursuitOperationSchema,
    expectedStatus: PursuitStatusSchema.optional(),
    proposedObjective: z.string().trim().min(1).max(300).optional(),
    proposedApproach: z.string().trim().min(1).max(300).optional(),
    proposedLocationNodeId: z.string().min(1).nullable().optional(),
    proposedStatus: PursuitStatusSchema.optional(),
    progressSummary: z.string().trim().min(1).max(300),
    causeReference: z.string().trim().min(1).max(300),
    rationale: z.string().trim().min(1).max(300),
  })
  .strict();
export type CharacterPursuitProposalEntry = z.infer<typeof CharacterPursuitProposalEntrySchema>;

export const MAX_CHARACTER_PURSUIT_CHANGES_PER_TURN = 2;

export const CharacterPursuitProposalSchema = z
  .object({
    changes: z.array(CharacterPursuitProposalEntrySchema).max(
      MAX_CHARACTER_PURSUIT_CHANGES_PER_TURN
    ),
  })
  .strict();
export type CharacterPursuitProposal = z.infer<typeof CharacterPursuitProposalSchema>;

export const CharacterPursuitReceiptSchema = z
  .object({
    version: z.literal(1).default(1),
    preState: CharacterPursuitLedgerSchema,
    postState: CharacterPursuitLedgerSchema,
    decisions: z
      .array(
        z.object({
          pursuitId: z.string(),
          operation: PursuitOperationSchema,
          outcome: z.enum(['APPLIED', 'REJECTED', 'NO_CHANGE']),
          reasonCode: z.string(),
          causeReference: z.string(),
        })
      )
      .default([]),
    boundedOutChangeIds: z.array(z.string()).default([]),
  })
  .strict();
export type CharacterPursuitReceipt = z.infer<typeof CharacterPursuitReceiptSchema>;

// --- Non-User Character Development Facts ---

export const DEVELOPMENT_DIMENSIONS = [
  'GOAL',
  'BELIEF',
  'IDENTITY',
  'ATTACHMENT',
  'DISPOSITION',
  'OTHER',
] as const;

export const DEVELOPMENT_OPERATIONS = ['ESTABLISH', 'REVISE', 'RETIRE'] as const;

export const DevelopmentDimensionSchema = z.enum(DEVELOPMENT_DIMENSIONS);
export type DevelopmentDimension = z.infer<typeof DevelopmentDimensionSchema>;

export const DevelopmentLifecycleSchema = z.enum(['ACTIVE', 'SUPERSEDED', 'RETIRED']);
export type DevelopmentLifecycle = z.infer<typeof DevelopmentLifecycleSchema>;

export const DevelopmentOperationSchema = z.enum(DEVELOPMENT_OPERATIONS);
export type DevelopmentOperation = z.infer<typeof DevelopmentOperationSchema>;

export const CharacterDevelopmentFactSchema = z
  .object({
    id: z.string().min(1),
    castMemberId: z.string().min(1),
    dimension: DevelopmentDimensionSchema,
    statement: z.string().trim().min(1).max(300),
    lifecycle: DevelopmentLifecycleSchema.default('ACTIVE'),
    establishedTurn: z.number().int().nonnegative(),
    lastChangedTurn: z.number().int().nonnegative(),
    causeReference: z.string().min(1),
  })
  .strict();
export type CharacterDevelopmentFact = z.infer<typeof CharacterDevelopmentFactSchema>;

export const CharacterDevelopmentLedgerSchema = z.record(
  z.string(),
  z.array(CharacterDevelopmentFactSchema)
);
export type CharacterDevelopmentLedger = z.infer<typeof CharacterDevelopmentLedgerSchema>;

export const CharacterDevelopmentProposalEntrySchema = z
  .object({
    castMemberId: z.string().min(1),
    operation: DevelopmentOperationSchema,
    targetFactId: z.string().min(1).nullable().optional(),
    dimension: DevelopmentDimensionSchema,
    statement: z.string().trim().min(1).max(300),
    causeReference: z.string().trim().min(1).max(300),
    rationale: z.string().trim().min(1).max(300),
  })
  .strict();
export type CharacterDevelopmentProposalEntry = z.infer<
  typeof CharacterDevelopmentProposalEntrySchema
>;

export const MAX_CHARACTER_DEVELOPMENT_CHANGES_PER_TURN = 2;

export const CharacterDevelopmentProposalSchema = z
  .object({
    changes: z.array(CharacterDevelopmentProposalEntrySchema).max(
      MAX_CHARACTER_DEVELOPMENT_CHANGES_PER_TURN
    ),
  })
  .strict();
export type CharacterDevelopmentProposal = z.infer<typeof CharacterDevelopmentProposalSchema>;

export const CharacterDevelopmentReceiptSchema = z
  .object({
    version: z.literal(1).default(1),
    preState: CharacterDevelopmentLedgerSchema,
    postState: CharacterDevelopmentLedgerSchema,
    decisions: z
      .array(
        z.object({
          factId: z.string().nullable(),
          castMemberId: z.string(),
          operation: DevelopmentOperationSchema,
          outcome: z.enum(['APPLIED', 'REJECTED', 'NO_CHANGE']),
          reasonCode: z.string(),
          causeReference: z.string(),
        })
      )
      .default([]),
  })
  .strict();
export type CharacterDevelopmentReceipt = z.infer<typeof CharacterDevelopmentReceiptSchema>;

// --- Pressure Thread Lifecycle Transitions ---

export const PRESSURE_THREAD_TERMINAL_STATUSES = [
  'RESOLVED',
  'REALIZED',
  'RELEASED',
  'TRANSFORMED',
] as const;

export const PressureThreadTransitionProposalEntrySchema = z
  .object({
    threadId: z.string().min(1),
    proposedStatus: z.enum(PRESSURE_THREAD_TERMINAL_STATUSES),
    causeReference: z.string().trim().min(1).max(300),
    replacementAdverseProspect: z.string().trim().min(1).max(500).optional(),
    rationale: z.string().trim().min(1).max(300),
  })
  .strict();
export type PressureThreadTransitionProposalEntry = z.infer<
  typeof PressureThreadTransitionProposalEntrySchema
>;

export const MAX_PRESSURE_THREAD_TRANSITIONS_PER_TURN = 2;

export const PressureThreadTransitionProposalSchema = z
  .object({
    transitions: z.array(PressureThreadTransitionProposalEntrySchema).max(
      MAX_PRESSURE_THREAD_TRANSITIONS_PER_TURN
    ),
  })
  .strict();
export type PressureThreadTransitionProposal = z.infer<
  typeof PressureThreadTransitionProposalSchema
>;

export const PressureThreadTransitionReceiptSchema = z
  .object({
    version: z.literal(1).default(1),
    preState: z.array(SituatedPressureThreadSchema).default([]),
    postState: z.array(SituatedPressureThreadSchema).default([]),
    decisions: z
      .array(
        z.object({
          threadId: z.string(),
          proposedStatus: z.string(),
          outcome: z.enum(['APPLIED', 'REJECTED', 'NO_CHANGE']),
          reasonCode: z.string(),
          causeReference: z.string(),
        })
      )
      .default([]),
    boundedOutChangeIds: z.array(z.string()).default([]),
  })
  .strict();
export type PressureThreadTransitionReceipt = z.infer<
  typeof PressureThreadTransitionReceiptSchema
>;

// ============================================================================
// Packet 1-6: Horror Grammar Runtime Snapshot & Turn Context
// ============================================================================

export const HorrorGrammarRuntimeStateSchema = z
  .object({
    fictionalTime: FictionalTimeLedgerSchema,
    pursuitSchedule: PursuitScheduleLedgerSchema.default({}),
    recentActivityEvents: z.array(CastActivityEventSchema).max(MAX_RECENT_ACTIVITY_EVENTS).default([]),
    activePressureThreads: z.array(SituatedPressureThreadSchema).max(MAX_ACTIVE_PRESSURE_THREADS).default([]),
    valueState: ValueStateLedgerSchema.default({}),
    characterPursuits: CharacterPursuitLedgerSchema.default({}),
    characterDevelopment: CharacterDevelopmentLedgerSchema.default({}),
  })
  .strict();
export type HorrorGrammarRuntimeState = z.infer<typeof HorrorGrammarRuntimeStateSchema>;

export const HorrorGrammarAuthoringBaselineSchema = z
  .object({
    valueBaselineReview: ValueBaselineReviewStateSchema.default('UNREVIEWED'),
    pursuitReviews: z.record(z.string(), PursuitReviewStateSchema).default({}),
    valueAnchors: z.array(ValueAnchorSchema).default([]),
    characterPursuits: z.array(CharacterPursuitSchema).default([]),
  })
  .strict();
export type HorrorGrammarAuthoringBaseline = z.infer<typeof HorrorGrammarAuthoringBaselineSchema>;

// ============================================================================
// Packet 1-7: Evidence Registry & Authority Evidence
// ============================================================================

export const EvidenceCategorySchema = z.enum([
  'OPPORTUNITY',
  'EXPRESSION_CAPABILITY',
  'TOPOLOGY_PRESENCE',
  'SCENARIO_RULE',
  'AUTHORITY_CONTRACT',
  'CANONICAL_CONDITION',
  'WORLD_MEMORY',
  'PRESSURE_THREAD',
  'ACTIVITY_EVENT',
  'CONSEQUENCE',
  'VALUE_ANCHOR',
  'INTERNAL_COMPULSION',
]);
export type EvidenceCategory = z.infer<typeof EvidenceCategorySchema>;

export const EvidenceRegistryEntrySchema = z
  .object({
    id: z.string().min(1),
    category: EvidenceCategorySchema,
    ownerRef: z.string().min(1),
    description: z.string().trim().min(1).max(800),
  })
  .strict();
export type EvidenceRegistryEntry = z.infer<typeof EvidenceRegistryEntrySchema>;

export const EvidenceRegistrySchema = z.array(EvidenceRegistryEntrySchema);
export type EvidenceRegistry = z.infer<typeof EvidenceRegistrySchema>;

export const HorrorGrammarTurnContextSchema = z
  .object({
    fictionalTime: FictionalTimeLedgerSchema,
    activityEligibility: CastActivityEligibilityReceiptSchema,
    presentActorOpportunities: z.array(ActivityOpportunityCandidateSchema).default([]),
    offscreenPursuitOpportunities: z.array(ActivityOpportunityCandidateSchema).max(2).default([]),
    relevantValueAnchors: z.array(ValueAnchorSchema).default([]),
    authorityInstruction: z.string().default(
      'Only non-User characters listed under presentActorOpportunities and offscreenPursuitOpportunities are eligible for activity consideration on this turn. Do not generate independent actions for other cast members or the User character.'
    ),
    runtimeState: HorrorGrammarRuntimeStateSchema,
    authoringBaseline: HorrorGrammarAuthoringBaselineSchema.default({
      valueBaselineReview: 'UNREVIEWED',
      pursuitReviews: {},
      valueAnchors: [],
      characterPursuits: [],
    }),
    evidenceRegistry: EvidenceRegistrySchema.default([]),
  })
  .strict();
export type HorrorGrammarTurnContext = z.infer<typeof HorrorGrammarTurnContextSchema>;

// ============================================================================
// Packet 1-8: Typed Forensics & Export Containment
// ============================================================================

export const ForensicActivityEvidenceSchema = z
  .object({
    disposition: z.enum(['NONE', 'ACCEPTED', 'REJECTED']),
    reasonCode: z.string(),
    admittedToNarrative: z.boolean(),
    proposalId: z.string().nullable().optional(),
    castMemberId: z.string().nullable().optional(),
    pursuitId: z.string().nullable().optional(),
    locationNodeId: z.string().nullable().optional(),
    perceptionPath: PerceptionPathSchema.nullable().optional(),
    activitySummary: z.string().nullable().optional(),
    authorityReferences: z.array(z.string()).default([]),
    manifestationBlock: ManifestationBlockSchema.nullable().optional(),
    acceptedEventId: z.string().nullable().optional(),
  })
  .strict();
export type ForensicActivityEvidence = z.infer<typeof ForensicActivityEvidenceSchema>;

export const ForensicPressureEvidenceSchema = z
  .object({
    disposition: z.enum(['NONE', 'ACCEPTED', 'REJECTED']),
    reasonCode: z.string(),
    admittedToNarrative: z.boolean(),
    proposalId: z.string().nullable().optional(),
    valueAnchorId: z.string().nullable().optional(),
    sourceReference: z.string().nullable().optional(),
    operator: PressureOperatorSchema.nullable().optional(),
    affectedDimension: AffectedDimensionSchema.nullable().optional(),
    adverseProspect: z.string().nullable().optional(),
    authorityReferences: z.array(z.string()).default([]),
    manifestationBlock: ManifestationBlockSchema.nullable().optional(),
    acceptedThreadId: z.string().nullable().optional(),
  })
  .strict();
export type ForensicPressureEvidence = z.infer<typeof ForensicPressureEvidenceSchema>;

export const HorrorGrammarForensicRecordSchema = z
  .object({
    version: z.literal(1).default(1),
    turnNumber: z.number().int().nonnegative(),
    preFictionalTime: FictionalTimeLedgerSchema,
    postFictionalTime: FictionalTimeLedgerSchema.optional(),
    presentOpportunityIds: z.array(z.string()).default([]),
    selectedOffscreenPursuitIds: z.array(z.string()).default([]),
    boundedOutPursuitIds: z.array(z.string()).default([]),
    dormantCount: z.number().int().default(0),
    notDueCount: z.number().int().default(0),
    activityEvidence: ForensicActivityEvidenceSchema,
    pressureEvidence: ForensicPressureEvidenceSchema,
    causalDecisions: z
      .object({
        valueDecisions: z.array(z.unknown()).default([]),
        pursuitDecisions: z.array(z.unknown()).default([]),
        developmentDecisions: z.array(z.unknown()).default([]),
        pressureTransitions: z.array(z.unknown()).default([]),
      })
      .strict(),
    composedNarrativeBlockCount: z.number().int().nonnegative().default(0),
  })
  .strict();
export type HorrorGrammarForensicRecord = z.infer<typeof HorrorGrammarForensicRecordSchema>;
