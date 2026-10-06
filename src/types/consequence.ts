import { z } from 'zod';

export const MAX_CONSEQUENCE_MUTATIONS = 4;
export const MAX_INVENTORY_ITEMS = 24;
export const MAX_PLAYER_INJURIES = 12;
export const MAX_CONSEQUENCE_LABEL_LENGTH = 120;
export const MAX_CONSEQUENCE_RATIONALE_LENGTH = 240;

export const PSYCHOLOGICAL_STATUSES = [
  'STABLE',
  'UNEASY',
  'DISTRESSED',
  'PANICKED',
  'DISSOCIATED',
] as const;

export const PsychologicalStatusSchema = z.enum(PSYCHOLOGICAL_STATUSES);
export type PsychologicalStatus = z.infer<typeof PsychologicalStatusSchema>;

export const InventoryConsequenceMutationSchema = z.strictObject({
  domain: z.literal('INVENTORY'),
  operation: z.enum(['ADD', 'REMOVE']),
  value: z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH),
  rationale: z.string().trim().min(1).max(MAX_CONSEQUENCE_RATIONALE_LENGTH),
});
export type InventoryConsequenceMutation = z.infer<typeof InventoryConsequenceMutationSchema>;

export const PlayerInjuryConsequenceMutationSchema = z.strictObject({
  domain: z.literal('PLAYER_INJURY'),
  operation: z.enum(['ADD', 'REMOVE']),
  value: z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH),
  rationale: z.string().trim().min(1).max(MAX_CONSEQUENCE_RATIONALE_LENGTH),
});
export type PlayerInjuryConsequenceMutation = z.infer<typeof PlayerInjuryConsequenceMutationSchema>;

export const PsychologicalStatusConsequenceMutationSchema = z.strictObject({
  domain: z.literal('PSYCHOLOGICAL_STATUS'),
  operation: z.literal('SET'),
  value: PsychologicalStatusSchema,
  rationale: z.string().trim().min(1).max(MAX_CONSEQUENCE_RATIONALE_LENGTH),
});
export type PsychologicalStatusConsequenceMutation = z.infer<typeof PsychologicalStatusConsequenceMutationSchema>;

export const DiscoveryConsequenceMutationSchema = z.strictObject({
  domain: z.literal('DISCOVERY'),
  operation: z.literal('ADD'),
  value: z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH),
  rationale: z.string().trim().min(1).max(MAX_CONSEQUENCE_RATIONALE_LENGTH),
});
export type DiscoveryConsequenceMutation = z.infer<typeof DiscoveryConsequenceMutationSchema>;

export const CanonicalConsequenceMutationSchema = z.discriminatedUnion('domain', [
  InventoryConsequenceMutationSchema,
  PlayerInjuryConsequenceMutationSchema,
  PsychologicalStatusConsequenceMutationSchema,
  DiscoveryConsequenceMutationSchema,
]);
export type CanonicalConsequenceMutation = z.infer<typeof CanonicalConsequenceMutationSchema>;

export const CanonicalConsequenceProposalSchema = z.strictObject({
  mutations: z.array(CanonicalConsequenceMutationSchema).max(MAX_CONSEQUENCE_MUTATIONS),
});
export type CanonicalConsequenceProposal = z.infer<typeof CanonicalConsequenceProposalSchema>;

export const CanonicalConsequenceStateSchema = z.strictObject({
  inventory: z.array(z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH)).max(MAX_INVENTORY_ITEMS),
  player_injuries: z.array(z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH)).max(MAX_PLAYER_INJURIES),
  psychological_status: PsychologicalStatusSchema,
});
export type CanonicalConsequenceState = z.infer<typeof CanonicalConsequenceStateSchema>;

export interface CanonicalConsequenceStateInput {
  inventory?: readonly string[];
  player_injuries?: readonly string[];
  psychological_status?: string;
}

export const CONSEQUENCE_DECISION_OUTCOMES = [
  'APPLIED',
  'REJECTED',
  'NO_CHANGE',
] as const;
export const ConsequenceDecisionOutcomeSchema = z.enum(CONSEQUENCE_DECISION_OUTCOMES);
export type ConsequenceDecisionOutcome = z.infer<typeof ConsequenceDecisionOutcomeSchema>;

export const CONSEQUENCE_DECISION_REASONS = [
  'APPLIED',
  'RECONCILIATION_SUPPRESSED',
  'ROLE_NOT_AUTHORIZED',
  'ACTION_NOT_AUTHORIZED',
  'DUPLICATE_VALUE',
  'VALUE_NOT_PRESENT',
  'STATE_LIMIT',
  'NO_CHANGE',
] as const;
export const ConsequenceDecisionReasonSchema = z.enum(CONSEQUENCE_DECISION_REASONS);
export type ConsequenceDecisionReason = z.infer<typeof ConsequenceDecisionReasonSchema>;

export const CanonicalConsequenceDecisionSchema = z.strictObject({
  mutation: CanonicalConsequenceMutationSchema,
  outcome: ConsequenceDecisionOutcomeSchema,
  reason: ConsequenceDecisionReasonSchema,
});
export type CanonicalConsequenceDecision = z.infer<typeof CanonicalConsequenceDecisionSchema>;

export const PsychologicalStatusChangeSchema = z.strictObject({
  before: PsychologicalStatusSchema,
  after: PsychologicalStatusSchema,
});
export type PsychologicalStatusChange = z.infer<typeof PsychologicalStatusChangeSchema>;

export const CanonicalConsequencePatchSchema = z.strictObject({
  inventory_added: z.array(z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH)),
  inventory_removed: z.array(z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH)),
  injuries_added: z.array(z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH)),
  injuries_removed: z.array(z.string().trim().min(1).max(MAX_CONSEQUENCE_LABEL_LENGTH)),
  psychological_status_change: PsychologicalStatusChangeSchema.nullable(),
});
export type CanonicalConsequencePatch = z.infer<typeof CanonicalConsequencePatchSchema>;

export const CanonicalConsequenceReceiptSchema = z.strictObject({
  version: z.literal(1),
  pre_state: CanonicalConsequenceStateSchema,
  post_state: CanonicalConsequenceStateSchema,
  patch: CanonicalConsequencePatchSchema,
  decisions: z.array(CanonicalConsequenceDecisionSchema),
});
export type CanonicalConsequenceReceipt = z.infer<typeof CanonicalConsequenceReceiptSchema>;
