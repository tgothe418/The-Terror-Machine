import { z } from 'zod';

export const RELATIONSHIP_KINDS = [
  'TRUST',
  'HOSTILITY',
  'DEPENDENCE',
  'LEVERAGE',
  'SUSPICION',
  'FEAR',
  'LOYALTY',
  'DOMINANCE',
] as const;

export const MAX_RELATIONSHIP_CHANGES_PER_TURN = 2;
export const MAX_CHARACTER_RELATIONSHIPS = 48;
export const MAX_RELATIONSHIP_RATIONALE_LENGTH = 240;

export const RelationshipKindSchema = z.enum(RELATIONSHIP_KINDS);
export type RelationshipKind = z.infer<typeof RelationshipKindSchema>;

export const RelationshipIntensitySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type RelationshipIntensity = z.infer<typeof RelationshipIntensitySchema>;

export const RelationshipDeltaSchema = z.union([
  z.literal(-1),
  z.literal(1),
]);
export type RelationshipDelta = z.infer<typeof RelationshipDeltaSchema>;

export const CharacterRelationshipRecordSchema = z.strictObject({
  source_character_id: z.string().trim().min(1).max(120),
  target_character_id: z.string().trim().min(1).max(120),
  kind: RelationshipKindSchema,
  intensity: RelationshipIntensitySchema,
});
export type CharacterRelationshipRecord = z.infer<typeof CharacterRelationshipRecordSchema>;

export const CharacterRelationshipStateSchema = z
  .array(CharacterRelationshipRecordSchema)
  .max(MAX_CHARACTER_RELATIONSHIPS);
export type CharacterRelationshipState = z.infer<typeof CharacterRelationshipStateSchema>;

export const CharacterRelationshipChangeProposalSchema = z.strictObject({
  source_character_id: z.string().trim().min(1).max(120),
  target_character_id: z.string().trim().min(1).max(120),
  kind: RelationshipKindSchema,
  delta: RelationshipDeltaSchema,
  rationale: z.string().trim().min(1).max(MAX_RELATIONSHIP_RATIONALE_LENGTH),
});
export type CharacterRelationshipChangeProposal = z.infer<
  typeof CharacterRelationshipChangeProposalSchema
>;

export const CharacterRelationshipProposalSchema = z.strictObject({
  changes: z
    .array(CharacterRelationshipChangeProposalSchema)
    .max(MAX_RELATIONSHIP_CHANGES_PER_TURN),
});
export type CharacterRelationshipProposal = z.infer<typeof CharacterRelationshipProposalSchema>;

export const RELATIONSHIP_DECISION_OUTCOMES = ['APPLIED', 'REJECTED', 'NO_CHANGE'] as const;
export const RelationshipDecisionOutcomeSchema = z.enum(RELATIONSHIP_DECISION_OUTCOMES);
export type RelationshipDecisionOutcome = z.infer<typeof RelationshipDecisionOutcomeSchema>;

export const RELATIONSHIP_DECISION_REASONS = [
  'APPLIED',
  'RECONCILIATION_SUPPRESSED',
  'ROLE_NOT_AUTHORIZED',
  'ACTION_NOT_AUTHORIZED',
  'PLAYER_ID_UNAVAILABLE',
  'UNKNOWN_CHARACTER',
  'SELF_RELATIONSHIP',
  'PLAYER_NOT_INVOLVED',
  'CHARACTER_ABSENT',
  'COMMUNICATION_TARGET_MISMATCH',
  'RELATIONSHIP_NOT_FOUND',
  'INTENSITY_LIMIT',
  'STATE_LIMIT',
] as const;
export const RelationshipDecisionReasonSchema = z.enum(RELATIONSHIP_DECISION_REASONS);
export type RelationshipDecisionReason = z.infer<typeof RelationshipDecisionReasonSchema>;

export const CharacterRelationshipDecisionSchema = z.strictObject({
  proposal: CharacterRelationshipChangeProposalSchema,
  outcome: RelationshipDecisionOutcomeSchema,
  reason: RelationshipDecisionReasonSchema,
  before: CharacterRelationshipRecordSchema.nullable(),
  after: CharacterRelationshipRecordSchema.nullable(),
});
export type CharacterRelationshipDecision = z.infer<typeof CharacterRelationshipDecisionSchema>;

export const CharacterRelationshipReceiptSchema = z.strictObject({
  version: z.literal(1),
  pre_state: CharacterRelationshipStateSchema,
  post_state: CharacterRelationshipStateSchema,
  decisions: z.array(CharacterRelationshipDecisionSchema),
});
export type CharacterRelationshipReceipt = z.infer<typeof CharacterRelationshipReceiptSchema>;
