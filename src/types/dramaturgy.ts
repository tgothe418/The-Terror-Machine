import { z } from 'zod';

// ============================================================================
// 1. Macro-Phase & Narrative Movement
// ============================================================================

export const MacroPhaseSchema = z.enum([
  'EXPOSITION_BASELINE',     // Initial quiet threshold, false baseline, orientation
  'INCITING_RUPTURE',        // Initial breach, containment failure, anomaly confirmed
  'COMPLICATION_ENCLOSURE',  // Escape routes obstructed, resource strain, perimeter tightening
  'MIDPOINT_CRISIS',         // Nature of horror transforms; pivotal truth or betrayal revealed
  'ESCALATING_VISE',         // Severe deprivation, physiological/psychological attrition
  'CLIMACTIC_CONFRONTATION', // Final desperate gambit, breach attempt, or sacrifice
  'AFTERMATH_DENOUEMENT',    // Quiet dread, survival tally, lingering psychological residue
]);
export type MacroPhase = z.infer<typeof MacroPhaseSchema>;

// ============================================================================
// 2. Pacing Cadence (The Breath)
// ============================================================================

export const PacingCadenceSchema = z.enum([
  'RESPITE_AFTERMATH',     // Forced lull, post-kinetic shock, binding wounds in darkness
  'SIMMERING_DREAD',       // Atmospheric quiet, sensory suspense, distant cues
  'MOUNTING_COMPLICATION', // Subtle escalation, system strain, ticking clocks
  'KINETIC_RUPTURE',       // Direct confrontation, physical breach, acute danger
]);
export type PacingCadence = z.infer<typeof PacingCadenceSchema>;

// ============================================================================
// 2b. Composure Bands (A1)
// ============================================================================

export const COMPOSURE_BANDS = [
  'BASELINE',
  'STRAINED',
  'PANICKED',
  'FRACTURED',
  'CATATONIC',
] as const;
export const ComposureBandSchema = z.enum(COMPOSURE_BANDS);
export type ComposureBand = z.infer<typeof ComposureBandSchema>;

// ============================================================================
// 3. Impending Environmental Clocks (A3, A4, D2)
// ============================================================================

export const ClockAdvanceModeSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('TIME'),
    rate: z.enum(['SLOW', 'MODERATE', 'RAPID']),
    minutesPerPoint: z.number().positive(),
  }),
  z.object({
    mode: z.literal('EVENT'),
    consequencePatterns: z.array(z.string().min(1)).min(1),
    pointsPerEvent: z.number().positive(),
  }),
]);
export type ClockAdvanceMode = z.infer<typeof ClockAdvanceModeSchema>;

export const ClockManifestationCueSchema = z.object({
  atLevel: z.number().min(0).max(100),
  cue: z.string().min(1),
});
export type ClockManifestationCue = z.infer<typeof ClockManifestationCueSchema>;

export const ImpendingClockSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  domain: z.enum(['ENVIRONMENTAL', 'SOMATIC', 'BEHAVIORAL', 'STRUCTURAL']),
  currentLevel: z.number().min(0).max(100).default(0),
  advanceMode: ClockAdvanceModeSchema,
  manifestationCues: z.array(ClockManifestationCueSchema).default([]),
  diegeticInstrument: z.string().optional(), // D2: in-world physical display name
  instrumentNodeId: z.string().optional(),   // D2: node where instrument physically resides
  crisisThreshold: z.number().min(0).max(100).default(80),
  accumulatedMinutes: z.number().min(0).default(0),
});
export type ImpendingClock = z.infer<typeof ImpendingClockSchema>;

// ============================================================================
// 4. Character Psychological Stakes & Obstructive Breaking Points (A1, D3)
// ============================================================================

export const DeterministicLiftConditionSchema = z.object({
  kind: z.enum([
    'PERSUASION',             // Ratified successful speech/persuasion event
    'REST_RESPITE',           // Spent turns in calm/respite cadence
    'MEDICAL_STABILIZATION',  // Physical medical triage/sedation
    'ABANDONMENT',            // Player leaves NPC behind in chamber
    'TERMINAL_PERMANENT',     // Irreversible catatonia/psychosis
  ]),
  composureRecoveryThreshold: z.number().min(0).max(100),
  description: z.string().min(1),
});
export type DeterministicLiftCondition = z.infer<typeof DeterministicLiftConditionSchema>;

export const CharacterPsychologicalStakesSchema = z.object({
  characterId: z.string().min(1),
  coreDesireOrNeed: z.string().min(1),
  copingMechanism: z.string().min(1),
  vulnerabilityOrGuilt: z.string().optional(),
  breakingPointTrigger: z.string().min(1),
  breakingPointThreshold: z.number().min(0).max(100).default(20),
  isObstructed: z.boolean().default(false),
  obstructionReason: z.string().optional(),
  liftConditions: z.array(DeterministicLiftConditionSchema).default([]),
  composureSensitivity: z.number().min(0.1).max(3.0).default(1.0),
  currentComposure: z.number().min(0).max(100).default(100),
});
export type CharacterPsychologicalStakes = z.infer<typeof CharacterPsychologicalStakesSchema>;

// ============================================================================
// 5. Causal Phase-Transition Milestones (A5)
// ============================================================================

export const DramaticMilestoneConditionSchema = z.object({
  id: z.string().min(1),
  targetPhase: MacroPhaseSchema,
  description: z.string().min(1),
  kind: z.enum([
    'DISCOVERY',           // Discovered world evidence / clue
    'CLOCK_CRISIS',        // Named clock reached crisis threshold
    'COMPOSURE_THRESHOLD', // Named character's composure fell below threshold
    'AUTHORED_TRIGGER',    // Specific ratified scenario consequence / tag
  ]),
  referenceId: z.string().optional(), // clockId, characterId, or evidence tag
  thresholdValue: z.number().optional(),
  satisfied: z.boolean().default(false),
  satisfiedAtFictionalTime: z.string().optional(),
});
export type DramaticMilestoneCondition = z.infer<typeof DramaticMilestoneConditionSchema>;

// ============================================================================
// 6. Forge Scenario Dramatic Spine
// ============================================================================

export const DramaticSpineSchema = z.object({
  thematicPremise: z.string().optional(),
  dramaticQuestions: z.array(z.string().min(1)).default([]),
  pacingProfile: z.enum([
    'SLOW_BURN_DREAD',
    'RELENTLESS_PURSUIT',
    'GOTHIC_PSYCHOLOGICAL',
    'BALANCED_HORROR',
  ]).default('BALANCED_HORROR'),
  milestoneConditions: z.array(DramaticMilestoneConditionSchema).default([]),
  impendingClocks: z.array(ImpendingClockSchema).default([]),
});
export type DramaticSpine = z.infer<typeof DramaticSpineSchema>;

// ============================================================================
// 7. Dramatic Turn Receipt (A10)
// ============================================================================

export const DramaticTurnReceiptSchema = z.object({
  turn: z.number().int().nonnegative(),
  fictionalTimeMarker: z.string().min(1), // HG1 fictional-time reference; NOT wall-clock (monotonic under Retake)
  transitions: z.array(
    z.object({
      from: MacroPhaseSchema,
      to: MacroPhaseSchema,
      cause: z.string().min(1),
    })
  ),
  clockAdvances: z.array(
    z.object({
      clockId: z.string().min(1),
      fromLevel: z.number().min(0).max(100),
      toLevel: z.number().min(0).max(100),
      cause: z.string().min(1),
    })
  ),
  composureDeltas: z.array(
    z.object({
      characterId: z.string().min(1),
      delta: z.number(),
      cause: z.string().min(1),
    })
  ),
  cadence: PacingCadenceSchema,
});
export type DramaticTurnReceipt = z.infer<typeof DramaticTurnReceiptSchema>;

// ============================================================================
// 8. Runtime Dramaturgy State & Turn Context (A1, A2, A7)
// ============================================================================

export const DramaturgyRuntimeStateSchema = z.object({
  currentMacroPhase: MacroPhaseSchema.default('EXPOSITION_BASELINE'),
  activePacingCadence: PacingCadenceSchema.default('SIMMERING_DREAD'),
  consecutiveTurnsInCadence: z.number().int().nonnegative().default(0),
  impendingClocks: z.record(z.string(), ImpendingClockSchema).default({}),
  characterStakes: z.record(z.string(), CharacterPsychologicalStakesSchema).default({}),
  milestones: z.array(DramaticMilestoneConditionSchema).default([]),
  receiptHistory: z.array(DramaticTurnReceiptSchema).default([]),
  discoveredClueIds: z.array(z.string()).default([]),
});
export type DramaturgyRuntimeState = z.infer<typeof DramaturgyRuntimeStateSchema>;

export const DramaturgyTurnContextSchema = z.object({
  macroPhase: MacroPhaseSchema,
  activePacingCadence: PacingCadenceSchema,
  pacingDirective: z.string(), // Mandate compiled relative to seat (A6, A11)
  activeClockManifestations: z.array(z.string()), // Threshold-keyed cues (A3)
  diegeticReadings: z.array(
    z.object({
      instrumentName: z.string(),
      nodeId: z.string(),
      level: z.number(),
      readingText: z.string(),
    })
  ).default([]), // D2 situated instrument observations
  companionFrictionDirectives: z.record(z.string(), z.string()).default({}), // NPC psychological friction
});
export type DramaturgyTurnContext = z.infer<typeof DramaturgyTurnContextSchema>;
