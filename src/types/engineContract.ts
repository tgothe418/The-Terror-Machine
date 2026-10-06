import { z } from 'zod';
import { ParticipationContextSchema } from './adLib';
import {
  CanonicalConsequenceProposalSchema,
  CanonicalConsequenceReceiptSchema,
  CanonicalConsequenceStateSchema,
} from './consequence';
import {
  CharacterStanceRecordSchema,
  CharacterStanceProposalSchema,
  CharacterStanceReceiptSchema,
} from './characterStance';
import {
  CharacterRelationshipStateSchema,
  CharacterRelationshipProposalSchema,
  CharacterRelationshipReceiptSchema,
} from './characterRelationships';
import {
  CharacterMemoryByIdSchema,
  CharacterMemoryEntrySchema,
  CharacterMemoryProposalSchema,
  CharacterMemoryReceiptSchema,
} from './characterMemory';
import {
  WorldMemoryStateSchema,
  WorldMemoryProposalSchema,
  WorldMemoryReceiptSchema,
} from './worldMemory';
import {
  FictionalTimeCostSchema,
  HorrorGrammarTurnContextSchema,
  FictionalTimeReceiptSchema,
  CastActivityEligibilityReceiptSchema,
  CastActivityProposalSchema,
  SituatedPressureProposalSchema,
  CastActivityReceiptSchema,
  SituatedPressureReceiptSchema,
  ValueStateProposalSchema,
  ValueStateReceiptSchema,
  CharacterPursuitProposalSchema,
  CharacterPursuitReceiptSchema,
  CharacterDevelopmentProposalSchema,
  CharacterDevelopmentReceiptSchema,
  PressureThreadTransitionProposalSchema,
  PressureThreadTransitionReceiptSchema,
} from './horrorGrammar';
import {
  DramaturgyTurnContextSchema,
  DramaticTurnReceiptSchema,
  DramaturgyRuntimeStateSchema,
  DramaticSpineSchema,
} from './dramaturgy';
import {
  PursuitScheduleReceiptSchema,
  HorrorGrammarForensicRecordSchema,
  UserOpeningAimReviewDispositionSchema,
} from './horrorGrammar';
import { CohortStateSchema } from './cohort';
export * from './adLib';
export * from './consequence';
export * from './characterStance';
export * from './characterRelationships';
export * from './characterMemory';
export * from './worldMemory';
export * from './vocalization';
export * from './cohort';
import { WoundFactProposalSchema, TreatmentProposalSchema } from './death';
export * from './death';
import { CharacterSalienceSchema, FearContractSchema } from './fear';
export * from './fear';
import {
  ObjectTransitionProposalSchema,
  ObjectTransitionDecisionSchema,
  AttentionTransitionProposalSchema,
  AttentionTransitionDecisionSchema,
  RoutineEventSchema,
} from './worldState';

export const EdgeKindSchema = z.enum([
  'PHYSICAL',
  'FORCED_EVENT',
  'MEMORY_RECONSTRUCTION',
  'HISTORICAL_REFERENCE',
  'TERMINAL_EJECTION',
  'AUTHORED_PARADOX',
]);

export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const EngineCharacterExpressionProfileSchema = z.object({
  communicationModes: z.array(z.enum(['spoken', 'nonverbal', 'mediated'])).min(1),
  expressionGuidance: z.string().min(1),
  silenceGuidance: z.string().optional(),
  cadenceNotes: z.string().optional(),
  voiceTone: z.string().optional(),
  vocalTells: z.array(z.string()).optional(),
  lexiconNotes: z.string().optional(),
  camouflageLeakGuidance: z.string().optional(),
});

export type EngineCharacterExpressionProfile = z.infer<typeof EngineCharacterExpressionProfileSchema>;

export const EngineTurnContextSchema = z.object({
  version: z.literal(1).default(1),
  scenario: z.object({
    id: z.string().optional(),
    title: z.string().default('Unknown Enclosure'),
    premise: z.string().default(''),
    worldRules: z.array(z.string()).default([]),
    setting: z.object({
      location: z.string().default('Unknown'),
      atmosphere: z.string().default(''),
      timePeriod: z.string().default(''),
    }),
    startingVector: z.string().default('COGNITIVE'),
    startingTier: z.string().default('LATENT'),
    incitingIncident: z.string().default(''),
    pacingDirective: z.string().default(''),
    keyPlotElements: z.array(z.string()).default([]),
  }),
  player: z
    .object({
      role: z.enum([
        'protagonist',
        'antagonist',
        'director',
        'witness',
        'possessed',
        'survivor',
        'villain',
        'bystander',
      ]),
      characterId: z.string().nullable().optional(),
      name: z.string().default('Protagonist'),
      description: z.string().default(''),
      isEntity: z.boolean().default(false),
      openingAim: z.string().optional(),
      openingAimDisposition: UserOpeningAimReviewDispositionSchema.optional(),
      sovereigntyInstruction: z.string().optional(),
    })
    .superRefine((val, ctx) => {
      if (
        val.openingAimDisposition === 'ACCEPTED_REFERENCE' ||
        val.openingAimDisposition === 'CREATOR_OVERRIDE'
      ) {
        if (!val.openingAim || !val.openingAim.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Reviewed opening aim disposition "${val.openingAimDisposition}" requires non-empty openingAim text.`,
            path: ['openingAim'],
          });
        }
      } else if (val.openingAimDisposition === 'NONE_DECLARED') {
        if (val.openingAim && val.openingAim.trim().length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'NONE_DECLARED opening aim disposition must have no openingAim text.',
            path: ['openingAim'],
          });
        }
      }
    }),
  cast: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string().default('Subject'),
        description: z.string().default(''),
        personality: z.string().default(''),
        goals: z.string().default(''),
        traits: z.array(z.string()).default([]),
        isEntity: z.boolean().default(false),
        isUserCharacter: z.boolean().default(false),
        expressionProfile: EngineCharacterExpressionProfileSchema.optional(),
        skepticism: z.number().finite().min(0).max(1).default(0.5),
        isPresent: z.boolean().default(true),
        stance: CharacterStanceRecordSchema.nullable().default(null),
        memory: z.array(CharacterMemoryEntrySchema).max(24).default([]),
      })
    )
    .default([]),
  topology: z.object({
    currentNodeId: z.string(),
    readableNodeLabel: z.string(),
    allowedOutgoingExits: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          kind: EdgeKindSchema,
          requires: z.array(z.string()).optional(),
          userInitiated: z.boolean().default(true),
        })
      )
      .default([]),
    // Placed clue objects (Discovery series 2/6); label max mirrors MAX_CONSEQUENCE_LABEL_LENGTH.
    nodeClues: z.record(z.string(), z.array(z.object({
      id: z.string().min(1),
      label: z.string().trim().min(1).max(120),
    }))).optional(),
  }),
  runtime: z
    .object({
      phase: z.string().default('LATENT'),
      tension: z.number().default(0),
      coherence: z.number().default(1.0),
      reconciliationRevision: z.number().default(0),
      activeVector: z.string().default('COGNITIVE'),
      activeTier: z.string().default('LATENT'),
      activeFlags: z.array(z.string()).default([]),
      turnNumber: z.number().int().nonnegative().default(0),
    })
    .strict(),
  participationContext: ParticipationContextSchema.optional(),
  consequenceState: CanonicalConsequenceStateSchema.default({
    inventory: [],
    player_injuries: [],
    psychological_status: 'STABLE',
  }),
  relationshipState: CharacterRelationshipStateSchema.default([]),
  memoryState: CharacterMemoryByIdSchema.default({}),
  worldMemory: WorldMemoryStateSchema.default([]),
  horrorGrammar: HorrorGrammarTurnContextSchema.optional(),
  dramaturgyContext: DramaturgyTurnContextSchema.optional(),
  dramaturgyRuntimeState: DramaturgyRuntimeStateSchema.optional(),
  dramaticSpine: DramaticSpineSchema.optional(),
  villainProtagonist: z.boolean().optional(),
  narratorFraming: z.string().optional(),
  cohortState: CohortStateSchema.optional(),
  salienceLedger: z.record(z.string(), CharacterSalienceSchema).optional(),
  fearContract: FearContractSchema.optional(),
});

export type EngineTurnContext = z.infer<typeof EngineTurnContextSchema>;

export const TurnRequestSchema = z.object({
  userAction: z.string().min(1, 'User action is required'),
  recentHistory: z.string(),
  systemDirective: z.string(),
  isExpansionExpected: z.boolean(),
  stateContext: z.object({
    currentNodeId: z.string().nullable(),
    currentPhase: z.string(),
    tensionLevel: z.number(),
    reconciliationRevision: z.number(),
    activeVector: z.string().optional(),
    activeTier: z.string().optional(),
    lastTransitionRejected: z.boolean().optional(),
    lastTransitionBlocked: z.boolean().optional(),
  }),
  context: EngineTurnContextSchema,
});

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export const TransitionReceiptSchema = z.object({
  requestedNodeId: z.string().nullable(),
  accepted: z.boolean(),
  fromNodeId: z.string().nullable(),
  toNodeId: z.string().nullable(),
  reason: z.string().optional(),
});

export type TransitionReceipt = z.infer<typeof TransitionReceiptSchema>;

export const NarrativeBlockSchema = z.object({
  type: z.enum([
    'prose',
    'dialogue',
    'internal_monologue',
    'soliloquy',
    'transmission',
    'system_voice',
    'environmental_description',
  ]),
  speaker: z.string().nullable().optional(),
  medium: z.enum(['direct', 'internal', 'intercom', 'radio', 'acoustic_bleed', 'port_observation']).optional().default('direct'),
  delivery: z.enum(['spoken', 'whisper', 'mutter', 'shout', 'strained', 'synthetic']).optional().default('spoken'),
  target: z.enum(['addressed', 'cohort', 'self', 'broadcast', 'unseen']).optional().default('addressed'),
  content: z.string(),
});

export type NarrativeBlock = z.infer<typeof NarrativeBlockSchema>;

export const TopologyDeltaSchema = z.object({
  isExpansion: z.boolean(),
  exitDirection: z.string().nullable().optional(),
  newNodeDef: z
    .object({
      id: z.string(),
      geometry: z.string(),
      hazards: z.array(z.string()),
      exitVectors: z.array(
        z.object({
          direction: z.string(),
          targetNodeId: z.string(),
          kind: EdgeKindSchema.optional(),
          requires: z.array(z.string()).optional(),
          userInitiated: z.boolean().optional(),
        })
      ),
    })
    .nullable()
    .optional(),
});

export type TopologyDelta = z.infer<typeof TopologyDeltaSchema>;

export const ACTION_KINDS = [
  'OBSERVE',
  'INVESTIGATE',
  'COMMUNICATE',
  'MOVE',
  'MANIPULATE',
  'WAIT',
  'ACTUATE_ENVIRONMENT',
  'PSYCHOLOGICAL_TORMENT',
  'DEPLOY_HAZARD',
  'OBSERVE_TELEMETRY',
  'HARVEST_OR_CONFRONT',
  'SYSTEM',
  'OTHER',
] as const;

export const ACTION_SUBTYPES = [
  'FLEE',
  'HIDE',
  'CORNER',
  'BAIT',
  'ISOLATE',
  'OVERWHELM',
  'FALSE_HOPE',
] as const;

export const PRESSURE_DIRECTIONS = [
  'DE_ESCALATE',
  'MAINTAIN',
  'ESCALATE',
  'MIXED',
  'UNCLEAR',
] as const;

export const DRAMATIC_TACTICS = [
  'FLIGHT',
  'DENIAL',
  'FIXATION',
  'EXPOSURE',
  'CONCEALMENT',
  'MISDIRECTION',
  'SUBVERSION',
  'NONE',
] as const;

export const INTENT_SYNERGIES = ['SUCCESS', 'FAILURE', 'N/A'] as const;

export const ActionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const ActionSubtypeSchema = z.enum(ACTION_SUBTYPES).nullable();
export type ActionSubtype = z.infer<typeof ActionSubtypeSchema>;

export const PressureDirectionSchema = z.enum(PRESSURE_DIRECTIONS);
export type PressureDirection = z.infer<typeof PressureDirectionSchema>;

export const DramaticTacticSchema = z.enum(DRAMATIC_TACTICS);
export type DramaticTactic = z.infer<typeof DramaticTacticSchema>;

export const IntentSynergySchema = z.enum(INTENT_SYNERGIES);
export type IntentSynergy = z.infer<typeof IntentSynergySchema>;

export const IntentProposalSchema = z.object({
  action_kind: ActionKindSchema,
  action_subtype: ActionSubtypeSchema,
  pressure_direction: PressureDirectionSchema,
  dramatic_tactic: DramaticTacticSchema,
  intent_synergy: IntentSynergySchema,
}).strict();
export type IntentProposal = z.infer<typeof IntentProposalSchema>;

export const IntentReceiptSchema = IntentProposalSchema.extend({
  version: z.literal(1),
});
export type IntentReceipt = z.infer<typeof IntentReceiptSchema>;

export const RECONCILIATION_MODES = [
  'NOT_REQUIRED',
  'CANONICAL',
  'EXPERIENTIAL_REANCHORED',
  'MIXED',
] as const;

export const RECONCILIATION_FEASIBILITIES = [
  'SUPPORTED',
  'CONSTRAINED',
  'IMPOSSIBLE',
  'UNCLEAR',
] as const;

export const RECONCILIATION_REASON_CODES = [
  'NONE',
  'BLUEPRINT_RULE',
  'AUTHORITY_LIMIT',
  'TOPOLOGY_LIMIT',
  'CAST_PRESENCE_LIMIT',
  'PHYSICAL_LIMIT',
  'UNSUPPORTED_PREMISE',
  'OTHER_CONSTRAINT',
] as const;

export const FICTIONAL_TIME_COSTS = [
  'MOMENT',
  'SCENE_BEAT',
  'EXTENDED',
  'UNCLEAR',
] as const;

export const AUTHORITY_ALIGNMENTS = [
  'WITHIN_CONTRACT',
  'EXCEEDS_CONTRACT',
  'NOT_APPLICABLE',
  'UNCLEAR',
] as const;

export const ReconciliationModeSchema = z.enum(RECONCILIATION_MODES);
export type ReconciliationMode = z.infer<typeof ReconciliationModeSchema>;

export const ReconciliationFeasibilitySchema = z.enum(RECONCILIATION_FEASIBILITIES);
export type ReconciliationFeasibility = z.infer<typeof ReconciliationFeasibilitySchema>;

export const ReconciliationReasonCodeSchema = z.enum(RECONCILIATION_REASON_CODES);
export type ReconciliationReasonCode = z.infer<typeof ReconciliationReasonCodeSchema>;

export const AuthorityAlignmentSchema = z.enum(AUTHORITY_ALIGNMENTS);
export type AuthorityAlignment = z.infer<typeof AuthorityAlignmentSchema>;

export const NarrativeReconciliationProposalSchema = z.object({
  mode: ReconciliationModeSchema,
  feasibility: ReconciliationFeasibilitySchema,
  reason_code: ReconciliationReasonCodeSchema,
  fictional_time_cost: FictionalTimeCostSchema,
  authority_alignment: AuthorityAlignmentSchema,
  memory_echo_candidate: z.string().trim().min(1).max(240).nullable(),
}).strict();
export type NarrativeReconciliationProposal = z.infer<typeof NarrativeReconciliationProposalSchema>;

export const NarrativeReconciliationReceiptSchema = NarrativeReconciliationProposalSchema.extend({
  version: z.literal(1),
  revision_increment: z.union([z.literal(0), z.literal(1)]),
});
export type NarrativeReconciliationReceipt = z.infer<typeof NarrativeReconciliationReceiptSchema>;

export const CastInteractionReceiptSchema = z.object({
  version: z.literal(1),
  addressedCharacterId: z.string().nullable(),
  respondingCharacterId: z.string().nullable(),
  outcome: z.enum([
    'RESPONDED',
    'ADDRESS_UNANSWERED',
    'UNSOLICITED_DIALOGUE',
    'MISMATCH',
    'NONE',
  ]),
});

export type CastInteractionReceipt = z.infer<typeof CastInteractionReceiptSchema>;

export const TurnResultSchema = z.object({
  narrative_blocks: z.array(NarrativeBlockSchema).max(3),
  engine_thoughts: z.string().optional(),
  intent_proposal: IntentProposalSchema,
  reconciliation_proposal: NarrativeReconciliationProposalSchema,
  consequence_proposal: CanonicalConsequenceProposalSchema,
  character_stance_proposal: CharacterStanceProposalSchema,
  character_relationship_proposal: CharacterRelationshipProposalSchema,
  character_memory_proposal: CharacterMemoryProposalSchema,
  world_memory_proposal: WorldMemoryProposalSchema,
  cast_activity_proposal: CastActivityProposalSchema,
  situated_pressure_proposal: SituatedPressureProposalSchema,
  value_state_proposal: ValueStateProposalSchema,
  character_pursuit_proposal: CharacterPursuitProposalSchema,
  character_development_proposal: CharacterDevelopmentProposalSchema,
  pressure_transition_proposal: PressureThreadTransitionProposalSchema,
  logic_state: z
    .object({
      current_phase: z.string().optional(),
      requested_transition: z.string().nullable().optional().default(null),
      suggested_tension: z.number().int().min(0).max(100).optional(),
      terminal_flags: z.array(z.string()).default([]),
      cast_arrivals: z.array(z.string()).default([]),
      cast_departures: z.array(z.string()).default([]),
      cast_deltas: z
        .array(
          z.object({
            character_id: z.string(),
            skepticism_delta: z.number(),
          })
        )
        .default([]),
      cast_ledger: z.array(z.any()).default([]),
      npc_fixations: z.array(z.string()).optional(),
      matrix_mutation: z
        .object({
          next_vector: z.string().optional(),
          next_tier: z.string().optional(),
          increment_rooms: z.boolean().optional(),
          note: z.string().optional(),
        })
        .nullable()
        .optional(),
      matrix_shift: z
        .object({
          next_vector: z.string().optional(),
          next_tier: z.string().optional(),
        })
        .nullable()
        .optional(),
    })
    .strict()
    .transform((val) => {
      if (!val.matrix_mutation && val.matrix_shift) {
        return {
          ...val,
          matrix_mutation: {
            next_vector: val.matrix_shift.next_vector,
            next_tier: val.matrix_shift.next_tier,
          },
        };
      }
      return val;
    }),
  topologyDelta: TopologyDeltaSchema.nullable().optional(),
  wound_facts: z.array(WoundFactProposalSchema).optional(),
  treatment_proposals: z.array(TreatmentProposalSchema).optional(),
  objectTransitions: z.array(ObjectTransitionProposalSchema).optional(),
  attentionTransitions: z.array(AttentionTransitionProposalSchema).optional(),
});

export type TurnResult = z.infer<typeof TurnResultSchema>;

export const ClueDiscoveryReceiptSchema = z.object({
  clueId: z.string().min(1),
  clueLabel: z.string().min(1),
  nodeId: z.string().min(1),
  characterId: z.string().min(1),
  actionKind: z.string().min(1),
});
export type ClueDiscoveryReceipt = z.infer<typeof ClueDiscoveryReceiptSchema>;

export const TurnResponseSchema = TurnResultSchema.omit({
  narrative_blocks: true,
  logic_state: true,
  intent_proposal: true,
  reconciliation_proposal: true,
  consequence_proposal: true,
  character_stance_proposal: true,
  character_relationship_proposal: true,
  character_memory_proposal: true,
  world_memory_proposal: true,
  cast_activity_proposal: true,
  situated_pressure_proposal: true,
  value_state_proposal: true,
  character_pursuit_proposal: true,
  character_development_proposal: true,
  pressure_transition_proposal: true,
  objectTransitions: true,
  attentionTransitions: true,
}).extend({
  narrative_blocks: z.array(NarrativeBlockSchema).max(4),
  logic_state: z.record(z.string(), z.any()),
  transitionReceipt: TransitionReceiptSchema.optional(),
  castInteractionReceipt: CastInteractionReceiptSchema.optional(),
  intentReceipt: IntentReceiptSchema.optional(),
  narrativeReconciliationReceipt: NarrativeReconciliationReceiptSchema.optional(),
  canonicalConsequenceReceipt: CanonicalConsequenceReceiptSchema,
  characterStanceReceipt: CharacterStanceReceiptSchema,
  characterRelationshipReceipt: CharacterRelationshipReceiptSchema,
  characterMemoryReceipt: CharacterMemoryReceiptSchema,
  worldMemoryReceipt: WorldMemoryReceiptSchema,
  fictionalTimeReceipt: FictionalTimeReceiptSchema,
  castActivityReceipt: CastActivityEligibilityReceiptSchema,
  pursuitScheduleReceipt: PursuitScheduleReceiptSchema,
  castActivityProposalReceipt: CastActivityReceiptSchema,
  situatedPressureReceipt: SituatedPressureReceiptSchema,
  valueStateReceipt: ValueStateReceiptSchema,
  characterPursuitReceipt: CharacterPursuitReceiptSchema,
  characterDevelopmentReceipt: CharacterDevelopmentReceiptSchema,
  pressureThreadTransitionReceipt: PressureThreadTransitionReceiptSchema,
  horrorGrammarForensics: HorrorGrammarForensicRecordSchema.optional(),
  dramaticTurnReceipt: DramaticTurnReceiptSchema.optional(),
  objectTransitions: z.array(ObjectTransitionProposalSchema).optional(),
  objectTransitionReceipt: z.array(ObjectTransitionDecisionSchema).optional(),
  attentionTransitions: z.array(AttentionTransitionProposalSchema).optional(),
  attentionTransitionReceipt: z.array(AttentionTransitionDecisionSchema).optional(),
  routineReceipt: z.array(RoutineEventSchema).optional(),
  clueDiscoveryReceipt: z.array(ClueDiscoveryReceiptSchema).optional(),
});

export type TurnResponse = z.infer<typeof TurnResponseSchema>;

export const RestraintGatedVerbSchema = z.enum([
  'CLOSE_IN',
  'TRAP',
  'DENY',
  'HIDE',
  'FLEE',
  'MISDIRECT',
  'PURSUE_AGENDA',
  'MOURN',
  'PARLEY',
  'FRACTURE',
  'WARN',
  'RECRUIT',
  'FORTIFY',
  'INVESTIGATE',
  'PICK_LOCK',
  'SUBMIT',
]);
export type RestraintGatedVerb = z.infer<typeof RestraintGatedVerbSchema>;

export const EngineProposalSchema = z
  .object({
    characterId: z.string().min(1),
    verb: z.union([RestraintGatedVerbSchema, z.string().min(1)]),
    targetId: z.string().nullable().optional(),
  })
  .strict();
export type EngineProposal = z.infer<typeof EngineProposalSchema>;

