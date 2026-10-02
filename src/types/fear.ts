import { z } from 'zod';
import type { WoundSeverity } from './death';

/**
 * Immutable engine-universal somatic vocabulary across four fear-response bands.
 * Declared by the Machine, narrated by the LLM.
 */
export const SOMATIC_TOKENS = [
  // Band 1: Mild Tension (>= 0.25)
  'PULSE_ELEVATED',
  'VOICE_HESITATION',
  'RESTLESS_GAZE',
  // Band 2: Acute Fear (>= 0.50)
  'HAND_TREMOR',
  'VOICE_TREMOR',
  'COLD_SWEAT',
  'PERIPHERAL_TUNNELING',
  // Band 3: Severe Panic (>= 0.75)
  'HYPERVENTILATION',
  'PALLOR_EXTREME',
  'MOTOR_STUMBLE',
  'SPEECH_FRAGMENTED',
  // Band 4: Breaking Point (>= 0.90)
  'FREEZE_IMMOBILITY',
  'DISSOCIATIVE_STARE',
  'INVOLUNTARY_VOCALIZATION',
] as const;

export const SomaticTokenSchema = z.enum(SOMATIC_TOKENS);
export type SomaticToken = z.infer<typeof SomaticTokenSchema>;

export const SOMATIC_BAND_TOKENS: Record<1 | 2 | 3 | 4, readonly SomaticToken[]> = {
  1: ['PULSE_ELEVATED', 'VOICE_HESITATION', 'RESTLESS_GAZE'],
  2: ['HAND_TREMOR', 'VOICE_TREMOR', 'COLD_SWEAT', 'PERIPHERAL_TUNNELING'],
  3: ['HYPERVENTILATION', 'PALLOR_EXTREME', 'MOTOR_STUMBLE', 'SPEECH_FRAGMENTED'],
  4: ['FREEZE_IMMOBILITY', 'DISSOCIATIVE_STARE', 'INVOLUNTARY_VOCALIZATION'],
};

export const THREAT_TYPES = ['life', 'freedom', 'identity'] as const;
export const ThreatTypeSchema = z.enum(THREAT_TYPES);
export type ThreatType = z.infer<typeof ThreatTypeSchema>;

export const MORTALITY_BELIEFS = ['mortal', 'immortal', 'protected', 'vulnerable'] as const;
export const MortalityBeliefSchema = z.enum(MORTALITY_BELIEFS);
export type MortalityBelief = z.infer<typeof MortalityBeliefSchema>;

export const SALIENCE_PROVENANCE_KINDS = [
  'wound',
  'witnessed-death',
  'panic-trace',
  'threat-event',
  'other',
] as const;
export const SalienceProvenanceKindSchema = z.enum(SALIENCE_PROVENANCE_KINDS);
export type SalienceProvenanceKind = z.infer<typeof SalienceProvenanceKindSchema>;

/**
 * Provenance tracking for fear/salience events.
 * - sourceId: the character that actually caused the event. Absent = unattributed.
 * - perceivedSourceId: who the prey believes caused it. Absent = perception not established (do NOT assume the prey knows; aggregation treats it as unknown).
 */
export interface SalienceProvenance {
  eventId: string;
  kind: SalienceProvenanceKind;
  spikeDelta: number;
  dreadDelta: number;
  turn: number;
  threatType?: ThreatType;
  sourceId?: string;          // actual causer (character id), when known
  perceivedSourceId?: string; // who the prey believes caused it, when established
}

export const SalienceProvenanceSchema = z.object({
  eventId: z.string().min(1),
  kind: SalienceProvenanceKindSchema,
  spikeDelta: z.number(),
  dreadDelta: z.number(),
  turn: z.number().int().nonnegative(),
  threatType: ThreatTypeSchema.optional(),
  sourceId: z.string().min(1).optional(),
  perceivedSourceId: z.string().min(1).optional(),
});

export interface CharacterSalience {
  spike: number;            // 0..1, fast layer
  dread: number;            // 0..1, slow layer, ratchets
  threatType: ThreatType;   // dominant current threat
  provenance: SalienceProvenance[]; // contributing events, newest last
  preyMode: boolean;
}

export const CharacterSalienceSchema = z.object({
  spike: z.number().min(0).max(1),
  dread: z.number().min(0).max(1),
  threatType: ThreatTypeSchema,
  provenance: z.array(SalienceProvenanceSchema),
  preyMode: z.boolean(),
});

export type SalienceLedger = Record<string, CharacterSalience>;

export interface SalienceEvent {
  eventId: string;
  kind: SalienceProvenanceKind;
  spikeDelta: number;
  dreadDelta?: number;
  threatType?: ThreatType;
  turn?: number;
  sourceId?: string;
  perceivedSourceId?: string;
}

export const SalienceEventSchema = z.object({
  eventId: z.string().min(1),
  kind: SalienceProvenanceKindSchema,
  spikeDelta: z.number(),
  dreadDelta: z.number().optional().default(0),
  threatType: ThreatTypeSchema.optional(),
  turn: z.number().int().nonnegative().optional(),
  sourceId: z.string().min(1).optional(),
  perceivedSourceId: z.string().min(1).optional(),
});

export interface ReleaseValve {
  id: string;
  condition: string;
  reductionAmount: number;
}

export const ReleaseValveSchema = z.object({
  id: z.string().min(1),
  condition: z.string().min(1),
  reductionAmount: z.number().nonnegative(),
});

export interface SomaticBands {
  band1: number;
  band2: number;
  band3: number;
  band4: number;
}

export const SomaticBandsSchema = z.object({
  band1: z.number().min(0).max(1).default(0.25),
  band2: z.number().min(0).max(1).default(0.50),
  band3: z.number().min(0).max(1).default(0.75),
  band4: z.number().min(0).max(1).default(0.90),
});

export interface FearContract {
  fearlessness: Record<string, number>;
  mortalityBelief: Record<string, MortalityBelief>;
  threatWeights: Record<ThreatType, number>;
  lambdaDecay: number;
  residueRatio: number;
  preyEnterThreshold: number;
  preyExitThreshold: number;
  somaticBands: SomaticBands;
  releaseValves: ReleaseValve[];
  villainGazeAuthorized: boolean;
  submitResponse: Record<string, 'ACCEPT' | 'REJECT' | 'PUNISH' | 'IGNORE' | string>;
}

export const DEFAULT_FEAR_CONTRACT: FearContract = {
  fearlessness: {},
  mortalityBelief: {},
  threatWeights: {
    life: 1.0,
    freedom: 1.0,
    identity: 1.0,
  },
  lambdaDecay: 0.35,
  residueRatio: 0.25,
  preyEnterThreshold: 0.70,
  preyExitThreshold: 0.40,
  somaticBands: {
    band1: 0.25,
    band2: 0.50,
    band3: 0.75,
    band4: 0.90,
  },
  releaseValves: [],
  villainGazeAuthorized: false,
  submitResponse: {},
};

export const FearContractSchema = z.object({
  fearlessness: z.record(z.string(), z.number().min(0).max(1)).default({}),
  mortalityBelief: z.record(z.string(), MortalityBeliefSchema).default({}),
  threatWeights: z
    .object({
      life: z.number().default(1.0),
      freedom: z.number().default(1.0),
      identity: z.number().default(1.0),
    })
    .default({ life: 1.0, freedom: 1.0, identity: 1.0 }),
  lambdaDecay: z.number().min(0).max(1).default(0.35),
  residueRatio: z.number().min(0).max(1).default(0.25),
  preyEnterThreshold: z.number().min(0).max(1).default(0.70),
  preyExitThreshold: z.number().min(0).max(1).default(0.40),
  somaticBands: SomaticBandsSchema.default({
    band1: 0.25,
    band2: 0.50,
    band3: 0.75,
    band4: 0.90,
  }),
  releaseValves: z.array(ReleaseValveSchema).default([]),
  villainGazeAuthorized: z.boolean().default(false),
  submitResponse: z.record(z.string(), z.string()).default({}),
});

export interface FeltWound {
  id: string;
  characterId: string;
  mechanism: string;
  location: string;
  severity: WoundSeverity;
  timelineMinutes: number;
  treatability: string;
  treated: boolean;
  treatedAtFictionalTime?: number;
  source: 'direct' | 'witnessed';
  witnessedEventId?: string;
  description?: string;
}

export interface FeltWoundSet {
  characterId: string;
  wounds: FeltWound[];
  dominantSeverity: WoundSeverity | null;
  hasUntreatedWounds: boolean;
  hasUnsurvivableWound: boolean;
}
