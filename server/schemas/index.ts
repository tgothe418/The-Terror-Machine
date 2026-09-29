import { z } from 'zod';
import { NormalizedBlueprintSchema } from '../../src/lib/normalizeBlueprint';
import { REFERENCE_IMPORT_MAX_BASE64_CHARS } from '../../src/lib/referenceImportPolicy';

// Chat & Engine Request Schema
export const EngineTurnRequestSchema = z.object({
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  history: z.array(z.any()).optional(), // We can tighten this further later
  blueprint: NormalizedBlueprintSchema.optional(),
  currentState: z.any().optional(),
  forgeContext: z.array(z.any()).optional(),
  execution_mode: z.string().optional(),
  worldStateSummary: z.string().optional(),
  currentVector: z.string().optional(),
  currentTier: z.string().optional(),
  currentTensionLevel: z.string().optional(),
  momentumIndex: z.number().optional(),
  turnCount: z.number().optional(),
  currentPhase: z.string().optional(),
  textBuffer: z.array(z.any()).optional(),
});

export const AutopilotModeSchema = z.enum(['standard', 'aggressive', 'adversarial']);
export type AutopilotMode = z.infer<typeof AutopilotModeSchema>;

export const AutopilotConfigSchema = z.object({
  mode: AutopilotModeSchema.optional().default('standard'),
});
export type AutopilotConfig = z.infer<typeof AutopilotConfigSchema>;

export const SimulatePlayerRequestSchema = z.object({
  history: z.array(z.any()),
  logicState: z.any().optional(),
  role: z.string().optional(),
  characterName: z.string().optional(),
  mode: AutopilotModeSchema.optional().default('standard'),
});

export const TestSceneRequestSchema = z.object({
  blueprint: NormalizedBlueprintSchema.optional(),
});

// Voice Request Schema
export const VoiceTelemetrySchema = z.object({
  scenarioTitle: z.string(),
  macroPhase: z.string(),
  currentChamber: z.object({
    id: z.string(),
    name: z.string()
  }),
  coPresentCast: z.array(z.object({
    id: z.string(),
    name: z.string(),
    status: z.string()
  })),
  activeClocks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    value: z.number(),
    max: z.number()
  })),
  manifestations: z.array(z.string())
}).strict();

export type VoiceTelemetry = z.infer<typeof VoiceTelemetrySchema>;

export const VoiceRequestSchema = z.object({
  message: z.string().min(1).optional(),
  history: z.array(z.any()).optional(),
  conversationHistory: z.array(z.any()).optional(),
  engineState: z.any().optional(),
  forgeTelemetry: z.any().optional(),
  engineTelemetry: VoiceTelemetrySchema.optional()
});

export type VoiceRequest = z.infer<typeof VoiceRequestSchema>;

// Forge/Blueprint Request Schema
export const ForgeRequestSchema = z.object({
  prompt: z.string().optional(),
  referenceMaterial: z.string().optional(),
});

import {
  BlueprintAmbiguityDecisionSchema,
  ForgeUnknownResolutionProposalSchema,
  DepictionContractProposalSchema,
  CompleteDepictionContractSchema,
} from '../../src/types/forge';

export const ArchitectActiveUnknownSchema = z
  .object({
    sourceBinding: z.string().min(1).max(200),
    sourceId: z.string().min(1).max(200).optional(),
    unknownId: z.string().min(1).max(200),
    category: z.string().min(1).max(100).optional(),
    question: z.string().min(1).max(1000).optional(),
    targetEffect: z.string().min(1).max(1000).optional(),
    submittedAnswer: z.string().max(2000).default(''),
    followUps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            question: z.string().min(1).max(1000),
            answer: z.string().max(1000).optional(),
          })
          .strict()
      )
      .max(2)
      .default([]),
  })
  .strict();

export const ArchitectAppliedCandidateFactSchema = z
  .object({
    target: z.string().max(100),
    classification: z.enum(['evidence', 'inference']).optional(),
    value: z.string().max(4000),
    sourceFileName: z.string().max(500).optional(),
  })
  .strict();

export const ArchitectDraftCastMemberSchema = z
  .object({
    id: z.string().max(200),
    name: z.string().max(200),
    description: z.string().max(2000).optional(),
    role: z.string().max(100).optional(),
    personality: z.string().max(2000).optional(),
    goals: z.string().max(2000).optional(),
    traits: z.union([z.array(z.string().max(200)), z.string().max(2000)]).optional(),
    isUserCharacter: z.boolean().optional(),
    isEntity: z.boolean().optional(),
    behaviorVector: z.string().max(100).optional(),
    starting_location: z.string().max(200).optional(),
    startingLocation: z.string().max(200).optional(),
  })
  .strict();

export const ArchitectDraftContextSchema = z
  .object({
    title: z.string().max(500).optional(),
    premise: z.string().max(4000).optional(),
    setting: z
      .object({
        location: z.string().max(500).optional(),
        atmosphere: z.string().max(2000).optional(),
        timePeriod: z.string().max(500).optional(),
      })
      .optional(),
    environmentalRules: z.union([z.string().max(1000), z.array(z.string().max(1000))]).optional(),
    cast: z.array(ArchitectDraftCastMemberSchema).max(100).optional(),
    ambiguities: z.array(BlueprintAmbiguityDecisionSchema).max(100).optional().default([]),
    references: z.array(z.string().max(500)).max(50).optional(),
    draftRevision: z.number().int().nonnegative().default(1),
  })
  .strict();

export const ArchitectEvidenceItemSchema = z
  .object({
    id: z.string().max(200),
    category: z.string().max(100),
    claim: z.string().max(2000),
    excerpt: z.string().max(4000).optional(),
  })
  .strict();

export const ArchitectSourceContextSchema = z
  .object({
    sourceFileName: z.string().max(500).optional(),
    sourceSummary: z.string().max(4000).optional(),
    evidence: z.array(ArchitectEvidenceItemSchema).max(12).default([]),
    canonicalAmbiguities: z.array(BlueprintAmbiguityDecisionSchema).max(100).default([]),
  })
  .strict();

export const ArchitectBaselineContextSchema = z
  .object({
    sourceCount: z.number().int().nonnegative().default(0),
    sourceSummary: z.string().max(4000).optional(),
    sourceSummaries: z.array(z.string().max(4000)).max(20).optional(),
    appliedCandidateFacts: z.array(ArchitectAppliedCandidateFactSchema).max(100).default([]),
    evidenceClaims: z
      .array(
        z
          .object({
            claim: z.string().max(2000),
            excerpt: z.string().max(4000).optional(),
            category: z.string().max(100),
          })
          .strict()
      )
      .max(100)
      .default([]),
    canonicalAmbiguities: z.array(BlueprintAmbiguityDecisionSchema).max(100).default([]),
    sourceBaselineRevision: z.number().int().nonnegative().default(1),
    draftRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

// --- DEPICTION-SPECIFIC BOUNDED REQUEST SCHEMAS ---
export const ArchitectDepictionCandidateFactSchema = z
  .object({
    target: z.string().trim().min(1).max(100),
    classification: z.enum(['evidence', 'inference']),
    value: z.string().trim().min(1).max(4000),
    sourceFileName: z.string().trim().min(1).max(500),
  })
  .strict();

export const ArchitectDepictionEvidenceClaimSchema = z
  .object({
    claim: z.string().trim().min(1).max(2000),
    excerpt: z.string().trim().max(4000).optional(),
    category: z.string().trim().min(1).max(100),
  })
  .strict();

export const ArchitectDepictionDraftContextSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    premise: z.string().trim().min(1).max(4000),
    setting: z
      .object({
        location: z.string().trim().max(500).optional(),
        atmosphere: z.string().trim().max(2000).optional(),
        timePeriod: z.string().trim().max(500).optional(),
      })
      .strict(),
    environmentalRules: z.union([
      z.string().trim().max(1000),
      z.array(z.string().trim().max(1000)).max(50),
    ]),
    cast: z.array(ArchitectDraftCastMemberSchema).max(100),
    ambiguities: z.array(BlueprintAmbiguityDecisionSchema).max(100),
    references: z.array(z.string().trim().min(1).max(500)).max(50),
    draftRevision: z.number().int().positive(),
  })
  .strict();

export const ArchitectDepictionBaselineContextSchema = z
  .object({
    sourceCount: z.number().int().nonnegative().max(20),
    sourceSummaries: z.array(z.string().trim().min(1).max(4000)).max(20),
    appliedCandidateFacts: z.array(ArchitectDepictionCandidateFactSchema).max(100),
    evidenceClaims: z.array(ArchitectDepictionEvidenceClaimSchema).max(100),
    canonicalAmbiguities: z.array(BlueprintAmbiguityDecisionSchema).max(100),
    sourceBaselineRevision: z.number().int().positive(),
  })
  .strict();

export const RawDepictionModelOutputSchema = z
  .object({
    contract: CompleteDepictionContractSchema,
    rationale: z.string().trim().min(1).max(1000),
    message: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();

export const ArchitectChatMessageSchema = z
  .object({
    role: z.enum(['user', 'architect']),
    content: z.string().max(4000),
  })
  .strict();

export const ArchitectAmbiguityResolutionRequestSchema = z
  .object({
    kind: z.literal('AMBIGUITY_RESOLUTION'),
    userMessage: z.string().max(2000),
    activeUnknown: ArchitectActiveUnknownSchema,
    draftContext: ArchitectDraftContextSchema,
    sourceContext: ArchitectSourceContextSchema.optional(),
    history: z.array(ArchitectChatMessageSchema).max(50).default([]),
  })
  .strict();

export const ArchitectDepictionContractProposalRequestSchema = z
  .object({
    kind: z.literal('DEPICTION_CONTRACT_PROPOSAL'),
    draftContext: ArchitectDepictionDraftContextSchema,
    baselineContext: ArchitectDepictionBaselineContextSchema,
    history: z.array(ArchitectChatMessageSchema).max(50).default([]),
  })
  .strict();

export const ArchitectGeneralMessageRequestSchema = z
  .object({
    kind: z.literal('GENERAL_MESSAGE'),
    userMessage: z.string().max(2000),
    draftContext: ArchitectDraftContextSchema.optional(),
    history: z.array(ArchitectChatMessageSchema).max(50).default([]),
  })
  .strict();

export const ArchitectRequestSchema = z.discriminatedUnion('kind', [
  ArchitectAmbiguityResolutionRequestSchema,
  ArchitectDepictionContractProposalRequestSchema,
  ArchitectGeneralMessageRequestSchema,
]);
export type ArchitectRequest = z.infer<typeof ArchitectRequestSchema>;

export const ArchitectFollowUpResponseSchema = z
  .object({
    type: z.literal('FOLLOW_UP'),
    message: z.string().trim().min(1),
    followUpQuestion: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    unknownId: z.string().trim().min(1),
  })
  .strict();

export const ArchitectResolutionProposalResponseSchema = z
  .object({
    type: z.literal('RESOLUTION_PROPOSAL'),
    sourceId: z.string().trim().min(1),
    unknownId: z.string().trim().min(1),
    message: z.string().trim().min(1),
    proposal: ForgeUnknownResolutionProposalSchema,
  })
  .strict();

export const ArchitectDepictionContractProposalResponseSchema = z
  .object({
    type: z.literal('DEPICTION_CONTRACT_PROPOSAL'),
    message: z.string().trim().min(1).max(4000).optional(),
    proposal: DepictionContractProposalSchema,
  })
  .strict();

export const ArchitectMessageResponseSchema = z
  .object({
    type: z.literal('MESSAGE'),
    message: z.string().trim().min(1),
  })
  .strict();

export const ArchitectResponseSchema = z.discriminatedUnion('type', [
  ArchitectFollowUpResponseSchema,
  ArchitectResolutionProposalResponseSchema,
  ArchitectDepictionContractProposalResponseSchema,
  ArchitectMessageResponseSchema,
]);
export type ArchitectResponse = z.infer<typeof ArchitectResponseSchema>;

export const TestBlueprintRequestSchema = z.object({
  blueprint: z.any().optional(),
});

export const AnalyzeReferenceRequestSchema = z.object({
  materials: z.array(z.any()).optional(),
});

export const SummarizeInterviewRequestSchema = z.object({
  history: z.array(z.any()).optional(),
});

export const ExtractStyleRequestSchema = z.object({
  userText: z.any().optional(),
});

export const DistillRequestSchema = z.object({
  systemPrompt: z.string().optional(),
  currentSummary: z.string().optional(),
  flattenedTranscript: z.string().optional(),
});

export const MemoryForgeRequestSchema = z.object({
  systemPrompt: z.string().optional(),
  chatHistory: z.string().optional(),
});

export const ExtractBlueprintRequestSchema = z.object({
  base64Data: z.string().min(1, "base64Data is required").max(REFERENCE_IMPORT_MAX_BASE64_CHARS, "base64Data exceeds maximum allowed size"),
  mimeType: z.string().min(1, "mimeType is required"),
  fileName: z.string().min(1, "fileName is required"),
  pageImages: z.array(z.string()).optional(),
});

export const SweepLensSchema = z.enum([
  'COMBINED',
  'TOPOLOGY',
  'CAST',
  'TRAITS',
  'CLOCKS_HAZARDS_OBJECTS'
]);
export type SweepLens = z.infer<typeof SweepLensSchema>;

export const SweepProvenanceSchema = z.object({
  extractionPass: z.literal(2),
  lens: SweepLensSchema,
  windowIndex: z.number().int().nonnegative(),
  windowCount: z.number().int().positive(),
  tokenRange: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive()
  }),
  sourceRange: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive()
  }).optional(),
  provider: z.enum(['gemini', 'zai', 'hemmingway', 'local']),
  modelId: z.string().min(1)
}).strict();
export type SweepProvenance = z.infer<typeof SweepProvenanceSchema>;

export const SweepJobRequestSchema = z.object({
  sourceBinding: z.string().min(1),
  lenses: z.array(SweepLensSchema).optional()
});
export type SweepJobRequest = z.infer<typeof SweepJobRequestSchema>;

