import { z } from 'zod';
import { EdgeKindSchema } from './engineContract';
import { HauntedHouseProvenanceSchema } from './participation';
import {
  BlueprintAmbiguityDecisionsSchema,
  DepictionContractSchema,
} from './blueprintAuthoring';
import {
  HorrorGrammarAuthoringSchema,
  ValueAnchorSchema,
  CharacterPursuitSchema,
  ValueBaselineReviewStateSchema,
  PursuitReviewStateSchema,
  UserOpeningAimSchema,
} from './horrorGrammar';
import {
  DramaticSpineSchema,
  CharacterPsychologicalStakesSchema,
} from './dramaturgy';
export * from './blueprintAuthoring';
export * from './horrorGrammar';
export * from './dramaturgy';
import { DeathContract, DeathContractSchema } from './death';
export * from './death';
import { FearContract, FearContractSchema, ThreatTypeSchema } from './fear';
export * from './fear';


// ============================================================================
// Phase 3E Character Expression Profile (Passive Data Seam)
// ============================================================================
export const CharacterCommunicationModeSchema = z.enum(['spoken', 'nonverbal', 'mediated']);
export type CharacterCommunicationMode = z.infer<typeof CharacterCommunicationModeSchema>;

export const CharacterExpressionProfileSchema = z.object({
  communicationModes: z.array(CharacterCommunicationModeSchema).min(1).default(['spoken']),
  expressionGuidance: z.string().min(1, 'Expression guidance is required'),
  silenceGuidance: z.string().optional(),
  cadenceNotes: z.string().optional(),
  voiceTone: z.string().optional(),
  vocalTells: z.array(z.string()).optional(),
  lexiconNotes: z.string().optional(),
  camouflageLeakGuidance: z.string().optional(),
});
export type CharacterExpressionProfile = z.infer<typeof CharacterExpressionProfileSchema>;

export const AntagonistApparatusControlSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  affectedNodeIds: z.array(z.string()).default([]),
  kind: z.enum([
    'ATMOSPHERE',
    'HYDRAULICS',
    'ELECTRICAL',
    'SURVEILLANCE',
    'SURGICAL',
    'MECHANICAL',
    'ACOUSTIC',
  ]),
  availableActions: z.array(z.string()).default([]),
  status: z.enum(['ONLINE', 'DAMAGED', 'OFFLINE']).default('ONLINE'),
});
export type AntagonistApparatusControl = z.infer<typeof AntagonistApparatusControlSchema>;

export const PreyCohortMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vulnerabilities: z.array(z.string()).default([]),
  psychologicalTriggers: z.array(z.string()).default([]),
  breakingPoint: z.string().default('Psychological or physiological collapse'),
  initialNodeId: z.string().optional(),
});
export type PreyCohortMember = z.infer<typeof PreyCohortMemberSchema>;

export const TelemetryFeedSchema = z.object({
  nodeId: z.string().min(1),
  feedType: z.enum([
    'OPTICAL_CAM',
    'ACOUSTIC_PICKUP',
    'BIOMETRIC_SENSOR',
    'THERMAL_INFRARED',
    'BLIND_SPOT',
  ]),
  status: z.enum(['ONLINE', 'INTERMITTENT', 'OFFLINE']).default('ONLINE'),
  label: z.string().optional(),
});
export type TelemetryFeed = z.infer<typeof TelemetryFeedSchema>;

export const AntagonistProfileSchema = z.preprocess(
  (val: unknown) => {
    if (val && typeof val === 'object') {
      const v = val as Record<string, unknown>;
      const name = String(v.name || v.entityName || v.entity || 'Opposition').trim();
      let kind = v.kind;
      if (!kind || !['FORCE', 'APPARATUS', 'ENTITY'].includes(kind as string)) {
        const lower = String(v.role || v.kind || '').toLowerCase();
        if (lower.includes('entity') || lower.includes('monster') || lower.includes('creature')) kind = 'ENTITY';
        else if (lower.includes('force') || lower.includes('cosmic') || lower.includes('phenomenon')) kind = 'FORCE';
        else kind = 'APPARATUS';
      }

      const apparatusControls = Array.isArray(v.apparatusControls)
        ? v.apparatusControls.map((ctrl: unknown, idx: number) => {
            if (typeof ctrl === 'string') {
              const cleaned = ctrl.trim();
              return {
                id: `control-${idx + 1}`,
                name: cleaned,
                kind: 'MECHANICAL',
                affectedNodeIds: [],
                availableActions: ['ACTIVATE', 'SEAL'],
                status: 'ONLINE',
              };
            }
            if (ctrl && typeof ctrl === 'object') {
              const c = ctrl as Record<string, unknown>;
              return {
                id: (typeof c.id === 'string' && c.id) || `control-${idx + 1}`,
                name: (typeof c.name === 'string' && c.name) || `Control ${idx + 1}`,
                kind: c.kind || 'MECHANICAL',
                affectedNodeIds: Array.isArray(c.affectedNodeIds) ? c.affectedNodeIds : [],
                availableActions: Array.isArray(c.availableActions) ? c.availableActions : ['ACTIVATE'],
                status: c.status || 'ONLINE',
              };
            }
            return ctrl;
          })
        : [];

      const telemetryFeeds = Array.isArray(v.telemetryFeeds)
        ? v.telemetryFeeds.map((feed: unknown) => {
            if (typeof feed === 'string') {
              const cleaned = feed.trim();
              return {
                nodeId: 'all',
                feedType: 'OPTICAL_CAM',
                status: 'ONLINE',
                label: cleaned,
              };
            }
            if (feed && typeof feed === 'object') {
              const f = feed as Record<string, unknown>;
              return {
                nodeId: f.nodeId || 'all',
                feedType: f.feedType || 'OPTICAL_CAM',
                status: f.status || 'ONLINE',
                label: f.label || f.name,
              };
            }
            return feed;
          })
        : [];

      const sadisticDirectives = Array.isArray(v.sadisticDirectives)
        ? v.sadisticDirectives
            .map((d: unknown) =>
              typeof d === 'string' ? d.trim() : typeof d === 'object' && d ? JSON.stringify(d) : ''
            )
            .filter(Boolean)
        : [];

      const preyCohort = Array.isArray(v.preyCohort) ? v.preyCohort : [];

      return {
        ...v,
        kind,
        name,
        apparatusControls,
        telemetryFeeds,
        sadisticDirectives,
        preyCohort,
      };
    }
    return val;
  },
  z.object({
    kind: z.enum(['FORCE', 'APPARATUS', 'ENTITY']).default('APPARATUS'),
    name: z.string().default('Opposition'),
    apparatusControls: z.array(AntagonistApparatusControlSchema).default([]),
    preyCohort: z.array(PreyCohortMemberSchema).default([]),
    sadisticDirectives: z.array(z.string()).default([]),
    telemetryFeeds: z.array(TelemetryFeedSchema).default([]),
  })
);
export type AntagonistProfile = z.infer<typeof AntagonistProfileSchema>;

export const VillainProfileSchema = z.object({
  villainId: z.string().min(1),
  name: z.string().min(1),
  operationalProfile: AntagonistProfileSchema.optional(),
  castSeedPersona: z.object({
    description: z.string().optional(),
    personality: z.string().optional(),
    goals: z.string().optional(),
    traits: z.array(z.string()).optional(),
  }).strict().optional(),
}).strict();
export type VillainProfile = z.infer<typeof VillainProfileSchema>;

const normalizeVulnerabilityValue = (val: unknown): number => {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0.5;
  if (val > 10) return Math.min(1, Math.max(0, val / 100));
  if (val > 1) return Math.min(1, Math.max(0, val / 10));
  return Math.min(1, Math.max(0, val));
};

export const ForgeVulnerabilityIndexSchema = z.object({
  resilience: z.preprocess(normalizeVulnerabilityValue, z.number().min(0).max(1)).default(0.5),
  skepticism: z.preprocess(normalizeVulnerabilityValue, z.number().min(0).max(1)).default(0.5),
  baggage: z.preprocess(normalizeVulnerabilityValue, z.number().min(0).max(1)).default(0.5),
});

export const ForgeDraftIdentitySchema = z.object({
  title: z.string().optional().default(''),
  version: z.string().optional().default('1.0'),
  author: z.string().optional().default(''),
  thematicAnchor: z.string().optional().default(''),
});

export const ForgeDraftSettingSchema = z.object({
  location: z.string().optional().default(''),
  atmosphere: z.string().optional().default(''),
  timePeriod: z.string().optional().default(''),
});

export const PresenceDispositionKindSchema = z.enum(['AT_NODE', 'OFFSTAGE', 'NONLOCAL']);
export type PresenceDispositionKind = z.infer<typeof PresenceDispositionKindSchema>;

export const CharacterPresenceDispositionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('AT_NODE'),
      nodeId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('OFFSTAGE'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('NONLOCAL'),
    })
    .strict(),
]);
export type CharacterPresenceDisposition = z.infer<typeof CharacterPresenceDispositionSchema>;

export const ForgeTopologyNodeSchema = z.preprocess(
  (val: unknown) => {
    if (val && typeof val === 'object') {
      const v = val as Record<string, unknown>;
      const effectiveLabel = String(v.label || v.name || '').trim();
      return {
        ...v,
        label: effectiveLabel,
        name: String(v.name || v.label || '').trim(),
      };
    }
    return val;
  },
  z.object({
    id: z.string().min(1, 'Node definition ID cannot be empty'),
    label: z.string().min(1, 'Node definition label cannot be empty'),
    name: z.string().optional(),
    description: z.string().optional(),
    classification: z.enum(['evidence', 'inference', 'creator']).optional(),
    evidenceIds: z.array(z.string()).optional(),
    sourceId: z.string().optional(),
    sensoryGuidance: z.string().optional(),
    chroma: z.string().optional(),
  })
);
export type ForgeTopologyNode = z.infer<typeof ForgeTopologyNodeSchema>;

export const ForgeExpandableAnchorSchema = z.object({
  id: z.string().min(1),
  parentNodeId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  classification: z.enum(['evidence', 'inference', 'creator']).optional(),
  evidenceIds: z.array(z.string()).optional(),
  sourceId: z.string().optional(),
  statement: z.string().optional(),
});
export type ForgeExpandableAnchor = z.infer<typeof ForgeExpandableAnchorSchema>;

export const CastDispositionSchema = z.enum(['SURVIVOR', 'VILLAIN', 'BYSTANDER']);
export type CastDisposition = z.infer<typeof CastDispositionSchema>;

export const SeedChargeBandSchema = z.enum([
  'calm',
  'Mild Tension',
  'Acute Fear',
  'Severe Panic',
  'Breaking Point',
]);
export type SeedChargeBand = z.infer<typeof SeedChargeBandSchema>;

export const SeedDoingModeSchema = z.enum(['ACTIVE', 'SUSPENDED']);
export type SeedDoingMode = z.infer<typeof SeedDoingModeSchema>;

export const SeedKnowsEntrySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type SeedKnowsEntry = z.infer<typeof SeedKnowsEntrySchema>;

export const SeedWantsSchema = z.object({
  kind: z.enum(['pursuit', 'state']),
  text: z.string(),
  groundedIn: z.array(z.string().min(1)).optional(),
});
export type SeedWants = z.infer<typeof SeedWantsSchema>;

export const SeedBondSchema = z.object({
  characterId: z.string().min(1),
  stance: z.enum(['trust', 'distrust', 'unsure']),
  note: z.string().optional(),
});
export type SeedBond = z.infer<typeof SeedBondSchema>;

export const SeedDoingSchema = z.object({
  mode: SeedDoingModeSchema,
  routineStep: z.string().optional(),
  oneShot: z.object({ label: z.string().min(1) }).optional(),
  verb: z.string().optional(),
});
export type SeedDoing = z.infer<typeof SeedDoingSchema>;

export const SeedConditionSchema = z.object({
  restraint: z
    .object({
      level: z.string(), // RestraintLevel; validate against engine's RestraintLevel values
      boundByCharacterId: z.string().optional(),
      tiedToNodeId: z.string().optional(),
    })
    .optional(),
});
export type SeedCondition = z.infer<typeof SeedConditionSchema>;

export const SeedChargeSchema = z.object({
  band: SeedChargeBandSchema,
  threatType: ThreatTypeSchema.optional(),
});
export type SeedCharge = z.infer<typeof SeedChargeSchema>;

export const CharacterSeedSchema = z.object({
  where: z.string().min(1),
  doing: SeedDoingSchema,
  condition: SeedConditionSchema,
  charge: SeedChargeSchema,
  knows: z.array(SeedKnowsEntrySchema),
  wants: SeedWantsSchema.optional(), // NPC only
  circumstance: z.string().optional(), // user character only: immutable facts
  inclination: z.string().optional(), // user character only: free-form, overridable
  bonds: z.array(SeedBondSchema),
});
export type CharacterSeed = z.infer<typeof CharacterSeedSchema>;

export const ScenarioOpeningStateSchema = z.object({
  restraint: z
    .object({
      bindings: z.record(z.string(), z.unknown()),
      locks: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export type ScenarioOpeningState = z.infer<typeof ScenarioOpeningStateSchema>;

export const ForgeDraftCastMemberBaseSchema = z.object({
  id: z.string().default(() => `char-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
  name: z.string().default(''),
  description: z.string().optional().default(''),
  role: z.string().optional().default('Subject'),
  personality: z.string().optional().default(''),
  goals: z.string().optional().default(''),
  traits: z.array(z.string()).optional().default([]),
  isUserCharacter: z.boolean().optional().default(false),
  behaviorVector: z.string().optional().default('ADAPTIVE'),
  isEntity: z.boolean().optional().default(false),
  disposition: CastDispositionSchema.optional().default('SURVIVOR'),
  psychological_status: z.string().optional(),
  starting_location: z.string().optional(),
  presenceDisposition: CharacterPresenceDispositionSchema.optional(),
  vulnerabilityBase: ForgeVulnerabilityIndexSchema.optional(),
  expressionProfile: CharacterExpressionProfileSchema.optional(),
  psychologicalStakes: CharacterPsychologicalStakesSchema.optional(),
  seed: CharacterSeedSchema.optional(),
  chroma: z.string().optional(),
});

export const ForgeDraftCastMemberSchema = ForgeDraftCastMemberBaseSchema.superRefine((data, ctx) => {
    if (!data.seed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Character seed is required',
        path: ['seed'],
      });
      return;
    }
    if (data.isUserCharacter === true) {
      if (typeof data.seed.circumstance !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'User character requires circumstance in seed',
          path: ['seed', 'circumstance'],
        });
      }
      if (typeof data.seed?.inclination !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'User character requires inclination in seed',
          path: ['seed', 'inclination'],
        });
      }
      if (data.seed?.wants !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'User character seed must not declare wants',
          path: ['seed', 'wants'],
        });
      }
    } else {
      if (!data.seed?.wants) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NPC requires wants in seed',
          path: ['seed', 'wants'],
        });
      }
      if (data.seed?.circumstance !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NPC seed must not declare circumstance',
          path: ['seed', 'circumstance'],
        });
      }
      if (data.seed?.inclination !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NPC seed must not declare inclination',
          path: ['seed', 'inclination'],
        });
      }
    }
  });

export const ForgeDraftPerspectiveRoleSchema = z.enum([
  'PROTAGONIST',
  'ANTAGONIST',
  'DIRECTOR',
  'WITNESS',
  'POSSESSED',
]);

export const ForgeDraftPerspectiveSchema = z.object({
  role: z.string().default('PROTAGONIST'),
  framingDirective: z.string().optional(),
  sensoryBias: z.array(z.string()).optional(),
  startingSemanticState: z
    .union([
      z.string(),
      z.object({
        soma: z.array(z.string()).optional(),
        geom: z.array(z.string()).optional(),
        imp: z.string().optional(),
      }),
    ])
    .optional(),
  subjectCharacterId: z.string().optional(),
});

export const ForgeDraftTopologyEdgeObjectSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: EdgeKindSchema.default('PHYSICAL'),
  requires: z.array(z.string()).optional(),
  userInitiated: z.boolean().default(true),
  legacyUpgraded: z.boolean().optional(),
  authority: z.enum(['user', 'engine', 'system']).optional(),
  classification: z.enum(['evidence', 'inference', 'creator']).optional(),
  evidenceIds: z.array(z.string()).optional(),
  sourceId: z.string().optional(),
});

export const ForgeDraftTopologyEdgeSchema = z.union([
  z.string(),
  ForgeDraftTopologyEdgeObjectSchema,
]);

export const ForgeDraftTopologySchema = z.object({
  startingNodeId: z.string().optional(),
  startingNodeProvenance: z
    .object({
      sourceId: z.string().optional(),
      evidenceIds: z.array(z.string()).optional(),
      classification: z.enum(['evidence', 'inference', 'creator']).optional(),
    })
    .optional(),
  nodes: z.array(z.string()).optional().default([]),
  nodeDefinitions: z.array(ForgeTopologyNodeSchema).optional().default([]),
  connections: z.array(ForgeDraftTopologyEdgeSchema).optional().default([]),
  anchors: z.array(ForgeExpandableAnchorSchema).optional().default([]),
});

export const ForgeDraftNarrativeRulesSchema = z.object({
  incitingIncident: z.string().optional().default(''),
  phaseDirectives: z.record(z.string(), z.string()).optional().default({}),
  currentTensionLevel: z.string().optional().default('buildup'),
  keyPlotElements: z.array(z.string()).optional().default([]),
  pacingDirectives: z.string().optional(),
});

export const ForgeDraftSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  identity: ForgeDraftIdentitySchema.optional().default({
    title: '',
    version: '1.0',
    author: '',
    thematicAnchor: '',
  }),
  title: z.string().optional().default(''),
  premise: z.string().optional().default(''),
  globalPremise: z.string().optional().default(''),
  setting: ForgeDraftSettingSchema.optional().default({
    location: '',
    atmosphere: '',
    timePeriod: '',
  }),
  startingVector: z
    .enum(['SOMATIC', 'COGNITIVE', 'COSMIC', 'SOCIO_MORAL'])
    .default('COGNITIVE'),
  startingTier: z
    .enum(['GATEWAY', 'LATENT', 'MANIFEST', 'TERMINAL'])
    .default('LATENT'),
  environmentalRules: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .default(''),
  constraints: z.array(z.string()).optional().default([]),
  contentScale: z.number().optional().default(3),
  contentLevelDescription: z.string().optional().default('Standard'),
  userCharacterId: z.string().optional(),
  cast: z.array(ForgeDraftCastMemberSchema).optional().default([]),
  perspectives: z.array(ForgeDraftPerspectiveSchema).optional().default([]),
  topology: ForgeDraftTopologySchema.optional().default({
    nodes: [],
    nodeDefinitions: [],
    connections: [],
    anchors: [],
  }),
  narrativeRules: ForgeDraftNarrativeRulesSchema.optional().default({
    incitingIncident: '',
    phaseDirectives: {},
    currentTensionLevel: 'buildup',
    keyPlotElements: [],
  }),
  references: z.array(z.string()).optional().default([]),
  coverImageUrl: z.string().optional(),
  backCoverBlurb: z.string().optional(),
  terminalConditions: z.unknown().optional(),
  characters: z.array(z.unknown()).optional().default([]),
  hauntedHouse: HauntedHouseProvenanceSchema.optional(),
  antagonistProfile: AntagonistProfileSchema.optional(),
  villains: z.array(VillainProfileSchema).max(3).optional(),
  /**
   * When true, the scenario's protagonist is its villain. Inverts protagonist seat binding and the pressure model.
   */
  villainProtagonist: z.boolean().default(false),
  ambiguities: BlueprintAmbiguityDecisionsSchema.optional().default([]),
  depictionContract: DepictionContractSchema.optional(),
  userOpeningAim: UserOpeningAimSchema.optional(),
  horrorGrammar: HorrorGrammarAuthoringSchema.optional().default(() => ({
    valueBaselineReview: 'UNREVIEWED' as const,
    pursuitReviews: {},
    valueAnchors: [],
    characterPursuits: [],
  })),
  dramaticSpine: DramaticSpineSchema.optional(),
  deathContract: DeathContractSchema,
  fearContract: FearContractSchema,
  openingState: ScenarioOpeningStateSchema.optional(),
});

export type ForgeDraftTopology = Omit<z.input<typeof ForgeDraftTopologySchema>, 'nodeDefinitions'> & {
  nodeDefinitions?: ForgeTopologyNode[];
};
export type ForgeDraft = Omit<z.input<typeof ForgeDraftSchema>, 'topology' | 'antagonistProfile'> & {
  topology?: ForgeDraftTopology;
  antagonistProfile?: Partial<AntagonistProfile>;
  deathContract: DeathContract;
  fearContract: FearContract;
  openingState?: ScenarioOpeningState;
};
export type ForgeDraftPatch = Partial<ForgeDraft>;
export type ForgeDraftIdentity = z.input<typeof ForgeDraftIdentitySchema>;
export type ForgeDraftSetting = z.input<typeof ForgeDraftSettingSchema>;
export type ForgeDraftCastMember = z.input<typeof ForgeDraftCastMemberSchema>;
export type ForgeDraftCastMemberOutput = z.output<typeof ForgeDraftCastMemberSchema>;
export type ForgeDraftPerspective = z.input<typeof ForgeDraftPerspectiveSchema>;
export type ForgeDraftNarrativeRules = z.input<typeof ForgeDraftNarrativeRulesSchema>;

export interface ForgeValidationResult {
  valid: boolean;
  errors: Record<string, string[]>;
  warnings?: Record<string, string[]>;
}

export interface ForgeCompilationContext {
  draftRevision?: number;
  sourceBaselineRevision?: number;
  sourceAnalyses?: Record<string, ForgeSourceAnalysis> | null;
}

export interface ForgeReviewArtifact {
  blueprint: import('./index').Blueprint;
  json: string;
  fileName: string;
  compiledAt: number;
  sourceDraftId: string;
  sourceDraftRevision: number;
  sourceBaselineRevision: number;
}

export type ForgeCompileResult =
  | {
      success: true;
      artifact: ForgeReviewArtifact;
      blueprint: import('./index').Blueprint;
      errors?: never;
    }
  | {
      success: false;
      errors: Record<string, string[]>;
      artifact?: never;
      blueprint?: never;
    };

// ============================================================================
// Phase 3D-2 Source Intake & Scenario Baseline Review Contracts
// ============================================================================

export const ForgeSourceRecordSchema = z
  .object({
    id: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    kind: z.enum(['native_blueprint', 'document']),
    receivedAt: z.number(),
    fileSizeBytes: z.number().optional(),
    coverImageUrl: z.string().optional(),
  })
  .strict();

export type ForgeSourceRecord = z.infer<typeof ForgeSourceRecordSchema>;

export const ForgeSourceEvidenceCategorySchema = z.enum([
  'identity',
  'premise',
  'setting',
  'cast',
  'chronology',
  'motif',
  'rule',
  'topology',
  'expression',
  'other',
]);
export type ForgeSourceEvidenceCategory = z.infer<typeof ForgeSourceEvidenceCategorySchema>;

export const ForgeSourceEvidenceSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    category: ForgeSourceEvidenceCategorySchema,
    claim: z.string().min(1),
    excerpt: z.string().optional(),
  })
  .strict();
export type ForgeSourceEvidence = z.infer<typeof ForgeSourceEvidenceSchema>;

export const ForgeSourceCandidateTargetSchema = z.enum([
  'scenario_title',
  'premise',
  'setting_location',
  'setting_atmosphere',
  'setting_time_period',
  'environmental_rule',
  'narrative_rule',
  'cast_seed',
  'cast_expression_guidance',
  'topology_node',
  'topology_connection',
  'expandable_space_anchor',
  'cast_opening_placement',
  'reference_attribution',
  'value_anchor',
  'character_pursuit',
  'depiction_contract',
  'antagonist_profile',
] as const);
export type ForgeSourceCandidateTarget = z.infer<typeof ForgeSourceCandidateTargetSchema>;

export const ForgeCandidateReviewDecisionSchema = z.enum(['accepted', 'rejected']);
export type ForgeCandidateReviewDecision = z.infer<typeof ForgeCandidateReviewDecisionSchema>;

export const ForgeCandidateApplicationStateSchema = z.enum(['staged', 'applied', 'superseded']);
export type ForgeCandidateApplicationState = z.infer<typeof ForgeCandidateApplicationStateSchema>;

/**
 * @deprecated Legacy review state schema for migration compatibility.
 */
export const ForgeSourceCandidateReviewStateSchema = z.enum(['pending', 'accepted', 'rejected']);
export type ForgeSourceCandidateReviewState = z.infer<typeof ForgeSourceCandidateReviewStateSchema>;

export const SweepLensSchema = z.enum([
  'COMBINED',
  'TOPOLOGY',
  'CAST',
  'TRAITS',
  'CLOCKS_HAZARDS_OBJECTS',
]);
export type SweepLens = z.infer<typeof SweepLensSchema>;

export const SweepProvenanceSchema = z
  .object({
    extractionPass: z.literal(2),
    lens: SweepLensSchema,
    windowIndex: z.number().int().nonnegative(),
    windowCount: z.number().int().positive(),
    tokenRange: z.object({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    }),
    sourceRange: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      })
      .optional(),
    provider: z.enum(['gemini', 'zai', 'hemmingway', 'local']),
    modelId: z.string().min(1),
  })
  .strict();
export type SweepProvenance = z.infer<typeof SweepProvenanceSchema>;

const BaseCandidateProps = {
  id: z.string().min(1),
  sourceId: z.string().min(1),
  classification: z.enum(['evidence', 'inference']),
  label: z.string().min(1),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  evidenceIds: z.array(z.string()).default([]),
  targetCastMemberId: z.string().optional(),
  extractionPass: z.number().int().optional(),
  extractionProvenance: SweepProvenanceSchema.optional(),
  occurrences: z.number().int().optional(),
  reviewDecision: ForgeCandidateReviewDecisionSchema.default('accepted'),
  applicationState: ForgeCandidateApplicationStateSchema.default('staged'),
};

export const ScenarioTitleCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('scenario_title'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const PremiseCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('premise'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const SettingLocationCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('setting_location'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const SettingAtmosphereCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('setting_atmosphere'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const SettingTimePeriodCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('setting_time_period'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const EnvironmentalRuleCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('environmental_rule'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const NarrativeRuleCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('narrative_rule'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const InitialTopologyNodeCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('initial_topology_node'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const ReferenceAttributionCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('reference_attribution'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const CastSeedCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('cast_seed'),
    proposedValue: ForgeDraftCastMemberBaseSchema.extend({
      isUserCharacter: z.boolean(),
    }),
  })
  .strict();

export const CastExpressionCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('cast_expression_guidance'),
    proposedValue: CharacterExpressionProfileSchema,
    targetCastMemberId: z.string().min(1, 'targetCastMemberId is required for expression guidance'),
  })
  .strict();

export const ValueAnchorCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('value_anchor'),
    proposedValue: ValueAnchorSchema,
  })
  .strict();

export const TopologyNodeCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('topology_node'),
    proposedValue: ForgeTopologyNodeSchema,
  })
  .strict();

export const TopologyConnectionCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('topology_connection'),
    proposedValue: ForgeDraftTopologyEdgeObjectSchema,
  })
  .strict();

export const StartingNodeSelectionCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('starting_node_selection'),
    proposedValue: z.string().trim().min(1),
  })
  .strict();

export const ExpandableSpaceAnchorCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('expandable_space_anchor'),
    proposedValue: ForgeExpandableAnchorSchema,
    parentNodeId: z.string().min(1).optional(),
  })
  .strict();

export const CastOpeningPlacementCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('cast_opening_placement'),
    targetCastMemberId: z.string().min(1, 'targetCastMemberId is required for cast opening placement'),
    proposedValue: CharacterPresenceDispositionSchema,
  })
  .strict();

export const CharacterPursuitCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('character_pursuit'),
    proposedValue: CharacterPursuitSchema,
  })
  .strict();

export const UserOpeningAimCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('user_opening_aim_default'),
    targetCastMemberId: z.string().min(1, 'targetCastMemberId is required for user opening aim default'),
    proposedValue: z.union([
      z.string().trim().min(1).max(2000),
      z.object({
        castMemberId: z.string().optional(),
        aimText: z.string().trim().min(1).max(2000),
        evidenceIds: z.array(z.string()).optional(),
        disposition: z.string().optional(),
        provenance: z.unknown().optional(),
      }),
      UserOpeningAimSchema,
    ]),
  })
  .strict();

export const DepictionContractCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('depiction_contract'),
    confidence: z.number().min(0).max(1).optional(),
    evidenceIds: z.array(z.string().min(1)).min(1).max(12),
    proposedValue: DepictionContractSchema,
  })
  .strict();

export const AntagonistProfileCandidateSchema = z
  .object({
    ...BaseCandidateProps,
    target: z.literal('antagonist_profile'),
    proposedValue: AntagonistProfileSchema,
  })
  .strict();

export const ForgeSourceCandidateSchema = z.discriminatedUnion('target', [
  ScenarioTitleCandidateSchema,
  PremiseCandidateSchema,
  SettingLocationCandidateSchema,
  SettingAtmosphereCandidateSchema,
  SettingTimePeriodCandidateSchema,
  EnvironmentalRuleCandidateSchema,
  NarrativeRuleCandidateSchema,
  CastSeedCandidateSchema,
  CastExpressionCandidateSchema,
  InitialTopologyNodeCandidateSchema,
  TopologyNodeCandidateSchema,
  TopologyConnectionCandidateSchema,
  StartingNodeSelectionCandidateSchema,
  ExpandableSpaceAnchorCandidateSchema,
  CastOpeningPlacementCandidateSchema,
  ReferenceAttributionCandidateSchema,
  ValueAnchorCandidateSchema,
  CharacterPursuitCandidateSchema,
  UserOpeningAimCandidateSchema,
  DepictionContractCandidateSchema,
  AntagonistProfileCandidateSchema,
]);
export type ForgeSourceCandidate = z.infer<typeof ForgeSourceCandidateSchema>;

export const ForgeSourceUnknownStatusSchema = z.enum([
  'queued',
  'submitting',
  'awaiting_response',
  'follow_up_required',
  'awaiting_confirmation',
  'recoverable_failure',
  'resolved',
  'contextual_discretion',
  'terminal_binding_loss',
]);
export type ForgeSourceUnknownStatus = z.infer<typeof ForgeSourceUnknownStatusSchema>;

export const ForgeUnknownFollowUpSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().trim().min(1).max(1000),
    answer: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ForgeUnknownFollowUp = z.infer<typeof ForgeUnknownFollowUpSchema>;

export const ForgeResolutionPatchOperationSchema = z.discriminatedUnion('target', [
  z
    .object({
      target: z.literal('cast_description'),
      castMemberId: z.string().min(1),
      text: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      target: z.literal('cast_personality'),
      castMemberId: z.string().min(1),
      text: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      target: z.literal('premise_detail'),
      text: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      target: z.literal('setting_atmosphere'),
      text: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      target: z.literal('environmental_rule'),
      text: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      target: z.literal('narrative_rule'),
      text: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      target: z.literal('add_value_anchor'),
      anchor: ValueAnchorSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal('set_value_review_state'),
      state: ValueBaselineReviewStateSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal('add_character_pursuit'),
      pursuit: CharacterPursuitSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal('set_character_pursuit_review_state'),
      castMemberId: z.string().min(1),
      state: PursuitReviewStateSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal('remove_value_anchor'),
      anchorId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      target: z.literal('remove_character_pursuit'),
      pursuitId: z.string().min(1),
    })
    .strict(),
]);
export type ForgeResolutionPatchOperation = z.infer<typeof ForgeResolutionPatchOperationSchema>;

export const ForgeResolutionDraftPatchSchema = z
  .object({
    operations: z.array(ForgeResolutionPatchOperationSchema).max(10).default([]),
  })
  .strict();
export type ForgeResolutionDraftPatch = z.infer<typeof ForgeResolutionDraftPatchSchema>;

export const ForgeUnknownResolutionProposalSchema = z
  .object({
    resolution: z.string().trim().min(1).max(1000),
    targetEffect: z.string().trim().min(1).max(1000),
    draftPatch: ForgeResolutionDraftPatchSchema.optional(),
  })
  .strict();
export type ForgeUnknownResolutionProposal = z.infer<typeof ForgeUnknownResolutionProposalSchema>;

export const CompleteDepictionContractSchema = z
  .object({
    dramaticRegister: z.string().trim().min(1).max(1000),
    directness: z.string().trim().min(1).max(1000),
    aftermath: z.string().trim().min(1).max(1000),
    ambiguityHandling: z.string().trim().min(1).max(1000),
    specialBoundaries: z.string().trim().max(1000),
  })
  .strict();

export const DepictionContractProposalSchema = z
  .object({
    contract: CompleteDepictionContractSchema,
    rationale: z.string().trim().min(1).max(1000),
    sourceDraftRevision: z.number().int().positive(),
    sourceBaselineRevision: z.number().int().positive(),
    createdAt: z.number().int().positive(),
  })
  .strict();
export type DepictionContractProposal = z.infer<typeof DepictionContractProposalSchema>;

export const ForgeSourceUnknownSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    category: ForgeSourceEvidenceCategorySchema,
    question: z.string().min(1),
    status: ForgeSourceUnknownStatusSchema.default('queued'),
    targetEffect: z.string().trim().min(1).max(1000),
    submittedAnswer: z.string().trim().max(1000).optional(),
    resolutionProposal: ForgeUnknownResolutionProposalSchema.optional(),
    followUps: z.array(ForgeUnknownFollowUpSchema).max(2).default([]),
    lastError: z.string().optional(),
  })
  .strict();
export type ForgeSourceUnknown = z.infer<typeof ForgeSourceUnknownSchema>;

export const ForgeValidationIssueCodeSchema = z.enum([
  'INVALID_ENUM',
  'INVALID_DISCRIMINATOR',
  'MISSING_REQUIRED_FIELD',
  'UNRESOLVED_EVIDENCE',
  'INVALID_CANDIDATE_SHAPE',
]);
export type ForgeValidationIssueCode = z.infer<typeof ForgeValidationIssueCodeSchema>;

export const ForgeValidationIssueSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    candidateIndex: z.number().int().positive(),
    candidateTarget: z.string().max(100).optional(),
    label: z.string().max(100).optional(),
    fieldPath: z.string().max(200),
    code: ForgeValidationIssueCodeSchema,
    message: z.string().max(300),
    allowedValues: z.array(z.string().max(100)).max(20).optional(),
    disposition: z.literal('QUARANTINED').default('QUARANTINED'),
  })
  .strict();
export type ForgeValidationIssue = z.infer<typeof ForgeValidationIssueSchema>;
export const MAX_VALIDATION_ISSUES = 50;

export const ForgeSourceAnalysisSchema = z
  .object({
    id: z.string().min(1),
    sourceRecord: ForgeSourceRecordSchema,
    summary: z.string().optional(),
    villainProtagonist: z.boolean().optional(),
    evidence: z.array(ForgeSourceEvidenceSchema).default([]),
    candidates: z.array(ForgeSourceCandidateSchema).default([]),
    unknowns: z.array(ForgeSourceUnknownSchema).default([]),
    validationIssues: z.array(ForgeValidationIssueSchema).max(MAX_VALIDATION_ISSUES).default([]).optional(),
    omittedValidationIssueCount: z.number().int().nonnegative().optional(),
    status: z.enum(['completed', 'completed_with_issues', 'error']).default('completed'),
    errorMessage: z.string().optional(),
  })
  .strict();
export type ForgeSourceAnalysis = z.infer<typeof ForgeSourceAnalysisSchema>;
