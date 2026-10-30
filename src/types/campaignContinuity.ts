import { z } from 'zod';
import { PhysicalCapabilitySchema } from './worldState';
import {
  ValueConditionSchema,
  ValueLifecycleSchema,
} from './horrorGrammar';
import { RelationshipKindSchema } from './characterRelationships';

// ============================================================================
// Campaign Carryover Whitelist (HG2 Epistemic Containment)
// ============================================================================

/**
 * Whitelist categories permitted to persist across scenario / blueprint transitions.
 * Epistemic Containment: Only survivor psychological, physical, relational, and value
 * traces are permitted. Scenario-specific topology, objects, and scripted state are
 * strictly reset to avoid cross-scenario leakage.
 */
export const CAMPAIGN_CARRYOVER_WHITELIST = [
  'survivors',
  'valueStateLedger',
  'campaignActHistory',
] as const;

export type CampaignCarryoverCategory = (typeof CAMPAIGN_CARRYOVER_WHITELIST)[number];

/**
 * Configures which categories of character state persist across scenario transitions.
 * Strictly sealed to validate that ONLY character persistent traces are whitelisted —
 * NO leaking of scenario-specific nodes, room objects, or scripted state.
 */
export const CampaignCarryoverWhitelistSchema = z
  .strictObject({
    survivingCharacterIds: z
      .array(z.string().trim().min(1, 'Surviving character ID must not be empty'))
      .refine(
        (ids) => new Set(ids).size === ids.length,
        { message: 'survivingCharacterIds must contain unique IDs with no duplicates' }
      ),
    carryPsychologicalScars: z.boolean(),
    carryValueShifts: z.boolean(),
    carryRelationshipBonds: z.boolean(),
    carryPhysicalImpairments: z.boolean(),
  })
  .strict();

export type CampaignCarryoverWhitelist = z.infer<typeof CampaignCarryoverWhitelistSchema>;

export const DEFAULT_CAMPAIGN_CARRYOVER_WHITELIST_FLAGS = {
  carryPsychologicalScars: true,
  carryValueShifts: true,
  carryRelationshipBonds: true,
  carryPhysicalImpairments: true,
} as const;

export function createCampaignCarryoverWhitelist(
  survivingCharacterIds: string[],
  overrides?: Partial<Omit<CampaignCarryoverWhitelist, 'survivingCharacterIds'>>
): CampaignCarryoverWhitelist {
  return CampaignCarryoverWhitelistSchema.parse({
    survivingCharacterIds,
    carryPsychologicalScars:
      overrides?.carryPsychologicalScars ??
      DEFAULT_CAMPAIGN_CARRYOVER_WHITELIST_FLAGS.carryPsychologicalScars,
    carryValueShifts:
      overrides?.carryValueShifts ??
      DEFAULT_CAMPAIGN_CARRYOVER_WHITELIST_FLAGS.carryValueShifts,
    carryRelationshipBonds:
      overrides?.carryRelationshipBonds ??
      DEFAULT_CAMPAIGN_CARRYOVER_WHITELIST_FLAGS.carryRelationshipBonds,
    carryPhysicalImpairments:
      overrides?.carryPhysicalImpairments ??
      DEFAULT_CAMPAIGN_CARRYOVER_WHITELIST_FLAGS.carryPhysicalImpairments,
  });
}

// ============================================================================
// Character Continuity Snapshot
// ============================================================================

/**
 * Snapshot of a persistent value anchor carried forward across campaign transitions.
 */
export const CampaignValueAnchorContinuitySchema = z
  .strictObject({
    anchorId: z.string().trim().min(1, 'Anchor ID must not be empty'),
    condition: ValueConditionSchema,
    lifecycle: ValueLifecycleSchema.optional().default('ACTIVE'),
    currentFormNote: z.string().nullable().optional().default(null),
    lastCauseReference: z.string().optional(),
    lastChangedTurn: z.number().int().nonnegative().optional(),
    note: z.string().nullable().optional(),
  })
  .strict();

export type CampaignValueAnchorContinuity = z.infer<typeof CampaignValueAnchorContinuitySchema>;

/**
 * Relational bond carried forward between surviving characters across transitions.
 */
export const CampaignCharacterBondSchema = z
  .preprocess((val: unknown) => {
    if (val && typeof val === 'object') {
      const rec = val as Record<string, unknown>;
      const targetCharacterId = rec.targetCharacterId ?? rec.target_character_id ?? rec.characterId;
      return {
        ...rec,
        targetCharacterId,
      };
    }
    return val;
  }, z.strictObject({
    targetCharacterId: z.string().trim().min(1, 'Target character ID must not be empty'),
    target_character_id: z.string().trim().min(1).optional(),
    characterId: z.string().trim().min(1).optional(),
    kind: z.union([RelationshipKindSchema, z.string().trim().min(1)]).optional(),
    stance: z.string().trim().min(1).optional(),
    intensity: z.number().int().min(1).max(3).optional(),
    note: z.string().optional(),
  }))
  .refine(
    (bond) => typeof bond.targetCharacterId === 'string' && bond.targetCharacterId.length > 0,
    { message: 'Target character ID is required for continuity bond' }
  );

export type CampaignCharacterBond = z.infer<typeof CampaignCharacterBondSchema>;

/**
 * Represents the carryover snapshot of an individual surviving character into the next scenario.
 */
export const CampaignCharacterContinuitySchema = z
  .strictObject({
    characterId: z.string().trim().min(1, 'Character ID must not be empty'),
    composure: z
      .number()
      .min(0, 'Composure must be non-negative')
      .max(100, 'Composure cannot exceed 100'),
    scars: z.array(z.string().trim().min(1, 'Scar description must not be empty')),
    impairedCapabilities: z.array(PhysicalCapabilitySchema),
    valueAnchors: z.array(CampaignValueAnchorContinuitySchema),
    bonds: z.array(CampaignCharacterBondSchema),
  })
  .strict();

export type CampaignCharacterContinuity = z.infer<typeof CampaignCharacterContinuitySchema>;

// ============================================================================
// Campaign Transition Receipt (Strict Horror Grammar HG2)
// ============================================================================

/**
 * Strict Horror Grammar receipt emitted when resolving scenario / blueprint transitions.
 * Enforces zero RNG, auditability, epistemic containment, and explicit pruning of non-whitelisted state.
 */
export const CampaignTransitionReceiptSchema = z
  .strictObject({
    receiptId: z.string().trim().min(1, 'Receipt ID must not be empty'),
    sourceScenarioId: z.string().trim().min(1, 'Source scenario ID must not be empty'),
    targetBlueprintId: z.string().trim().min(1, 'Target blueprint ID must not be empty'),
    transitionTurn: z.number().int().nonnegative('Transition turn must be non-negative'),
    carriedCharacters: z
      .array(CampaignCharacterContinuitySchema)
      .refine(
        (chars) => {
          const ids = chars.map((c) => c.characterId);
          return new Set(ids).size === ids.length;
        },
        { message: 'carriedCharacters must have unique characterIds' }
      ),
    prunedStateKeys: z.array(z.string().trim().min(1)),
    timestamp: z.string().trim().min(1, 'Timestamp or sequence identifier must not be empty'),
  })
  .strict();

export type CampaignTransitionReceipt = z.infer<typeof CampaignTransitionReceiptSchema>;

// ============================================================================
// Field-Level Carryover Entries & Carryover Receipt (Plan §3 Item 17)
// ============================================================================

export const CampaignCarryoverFieldEntrySchema = z
  .strictObject({
    fieldPath: z.string().trim().min(1),
    sourceValue: z.unknown(),
    carriedValue: z.unknown(),
    notes: z.string().optional(),
  })
  .strict();

export type CampaignCarryoverFieldEntry = z.infer<typeof CampaignCarryoverFieldEntrySchema>;

export const CampaignCarryoverReceiptSchema = z
  .strictObject({
    receiptId: z.string().trim().min(1),
    fromBlueprintTitle: z.string().trim().min(1),
    toBlueprintTitle: z.string().trim().min(1),
    transitionTurnNumber: z.number().int().nonnegative(),
    carriedFields: z.array(CampaignCarryoverFieldEntrySchema),
    resetFields: z.array(z.string().trim().min(1)),
    survivorCharacterIds: z.array(z.string().trim().min(1)).optional(),
    timestamp: z.string().trim().min(1),
  })
  .strict();

export type CampaignCarryoverReceipt = z.infer<typeof CampaignCarryoverReceiptSchema>;

