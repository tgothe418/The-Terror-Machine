import { z } from 'zod';

export const VOCALIZATION_KINDS = [
  'prose',
  'dialogue',
  'internal_monologue',
  'soliloquy',
  'transmission',
  'system_voice',
  'environmental_description',
] as const;

export const VocalizationKindSchema = z.enum(VOCALIZATION_KINDS);
export type VocalizationKind = z.infer<typeof VocalizationKindSchema>;

export const ACOUSTIC_MEDIUMS = [
  'direct',
  'internal',
  'intercom',
  'radio',
  'acoustic_bleed',
  'port_observation',
] as const;

export const AcousticMediumSchema = z.enum(ACOUSTIC_MEDIUMS);
export type AcousticMedium = z.infer<typeof AcousticMediumSchema>;

export type VocalMedium =
  | AcousticMedium
  | 'broadcast'
  | 'vent'
  | string;

export const VOCAL_DELIVERY_MODES = [
  'spoken',
  'whisper',
  'mutter',
  'shout',
  'strained',
  'synthetic',
] as const;

export const VocalDeliverySchema = z.enum(VOCAL_DELIVERY_MODES);
export type VocalDelivery = z.infer<typeof VocalDeliverySchema>;

export const VOCALIZATION_TARGETS = [
  'addressed',
  'cohort',
  'self',
  'broadcast',
  'unseen',
] as const;

export const VocalizationTargetSchema = z.enum(VOCALIZATION_TARGETS);
export type VocalizationTarget = z.infer<typeof VocalizationTargetSchema>;

export const VocalizationBlockSchema = z.object({
  type: VocalizationKindSchema,
  speaker: z.string().nullable().optional(),
  medium: AcousticMediumSchema.optional().default('direct'),
  delivery: VocalDeliverySchema.optional().default('spoken'),
  target: VocalizationTargetSchema.optional().default('addressed'),
  interrupted: z.boolean().optional().default(false),
  acousticSourceNodeId: z.string().optional(),
  content: z.string(),
});

export type VocalizationBlock = z.infer<typeof VocalizationBlockSchema>;

// ─── Vocal Capability Denial Receipts (Item 11 & Item 12) ───────────────────

import {
  ImpairedSlotIdSchema,
  type ImpairedSlotId,
  type CharacterCapabilityState,
  type CapabilityLedger,
} from './worldState';

export const VocalizationDenialReceiptSchema = z
  .object({
    allowed: z.literal(false),
    reasonCode: z.literal('CAPABILITY_IMPAIRED'),
    provenance: z.string(),
    impairedSlot: ImpairedSlotIdSchema,
  })
  .strict();
export type VocalizationDenialReceipt = z.infer<typeof VocalizationDenialReceiptSchema>;

export const VocalizationAllowedReceiptSchema = z
  .object({
    allowed: z.literal(true),
    reasonCode: z.literal('ALLOWED'),
    provenance: z.string(),
    impairedSlot: ImpairedSlotIdSchema.optional(),
  })
  .strict();
export type VocalizationAllowedReceipt = z.infer<typeof VocalizationAllowedReceiptSchema>;

export const VocalizationCapabilityResultSchema = z.discriminatedUnion('allowed', [
  VocalizationAllowedReceiptSchema,
  VocalizationDenialReceiptSchema,
]);
export type VocalizationCapabilityResult = z.infer<typeof VocalizationCapabilityResultSchema>;

export type { ImpairedSlotId, CharacterCapabilityState, CapabilityLedger };

// ─── Acoustic Topology & Routing (Item 13) ──────────────────────────────────

export interface LocationTopologyConnection {
  from?: string;
  to?: string;
  fromNodeId?: string;
  toNodeId?: string;
  source?: string;
  target?: string;
  nodes?: string[];
  nodeA?: string;
  nodeB?: string;
  status?: 'OPEN' | 'LOCKED' | 'BLOCKED' | 'SEALED' | string;
  kind?: string;
  type?: string;
  acousticBleed?: boolean;
  sealed?: boolean;
  isSealed?: boolean;
  isOpen?: boolean;
  open?: boolean;
  portal?: boolean | 'open' | 'closed' | string;
  acousticPortal?: boolean | 'open' | 'closed' | string;
  openPortal?: boolean;
  openAcousticPortal?: boolean;
  bleed?: boolean;
  hasBleed?: boolean;
  bidirectional?: boolean;
  directed?: boolean;
  oneWay?: boolean;
  [key: string]: unknown;
}

export interface LocationTopology {
  nodes?: Array<string | { id: string; [key: string]: unknown }>;
  connections?: LocationTopologyConnection[];
  topologyConnections?: LocationTopologyConnection[];
  edges?: LocationTopologyConnection[];
  [key: string]: unknown;
}

