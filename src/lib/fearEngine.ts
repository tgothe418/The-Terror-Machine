import {
  CharacterSalience,
  SalienceProvenance,
  SalienceEvent,
  FearContract,
  SomaticToken,
  SOMATIC_BAND_TOKENS,
  ThreatType,
  THREAT_TYPES,
  FeltWound,
  FeltWoundSet,
  DEFAULT_FEAR_CONTRACT,
} from '../types/fear';
import { WoundSeverity, WOUND_SEVERITIES } from '../types/death';
import { WoundLedger } from './deathLedger';

const SEVERITY_RANK: Record<WoundSeverity, number> = {
  minor: 1,
  serious: 2,
  grave: 3,
  unsurvivable: 4,
};

/**
 * Pure projection function that maps canonical ledger wound facts to character-felt wounds.
 * Guarantees FULL FIDELITY crossing: wound severities are never degraded or distorted.
 * Idempotent: multiple invocations yield identical results without modifying the underlying ledger.
 */
export function projectWoundPerception(
  characterId: string,
  woundLedger?: WoundLedger,
  witnessedEvents?: Array<{
    id: string;
    characterId: string;
    description: string;
    severity?: string;
  }>
): FeltWoundSet {
  const directWounds: FeltWound[] = [];
  const rawWounds = woundLedger?.[characterId] || [];

  for (const w of rawWounds) {
    directWounds.push({
      id: w.id,
      characterId: w.characterId,
      mechanism: w.mechanism || 'unknown cause',
      location: w.location || 'unspecified',
      severity: w.severity,
      timelineMinutes: w.timelineMinutes,
      treatability: w.treatability || 'standard first aid',
      treated: w.treated,
      treatedAtFictionalTime: w.treatedAtFictionalTime,
      source: 'direct',
      description: `${w.severity} ${w.mechanism || 'wound'} to ${w.location || 'body'}`,
    });
  }

  const witnessedWounds: FeltWound[] = [];
  if (witnessedEvents && Array.isArray(witnessedEvents)) {
    for (const ev of witnessedEvents) {
      const validSeverity =
        ev.severity && WOUND_SEVERITIES.includes(ev.severity as WoundSeverity)
          ? (ev.severity as WoundSeverity)
          : 'minor';

      witnessedWounds.push({
        id: ev.id,
        characterId: ev.characterId || characterId || 'unknown',
        mechanism: ev.description || 'witnessed injury',
        location: 'unspecified',
        severity: validSeverity,
        timelineMinutes: 0,
        treatability: 'none',
        treated: false,
        source: 'witnessed',
        witnessedEventId: ev.id,
        description: ev.description,
      });
    }
  }

  const allWounds = [...directWounds, ...witnessedWounds];

  // Determine dominant severity
  let dominantSeverity: WoundSeverity | null = null;
  let maxRank = 0;

  const candidateWounds = allWounds.filter((w) => !w.treated);
  const pool = candidateWounds.length > 0 ? candidateWounds : allWounds;

  for (const w of pool) {
    const rank = SEVERITY_RANK[w.severity] || 0;
    if (rank > maxRank) {
      maxRank = rank;
      dominantSeverity = w.severity;
    }
  }

  const hasUntreatedWounds = allWounds.some((w) => !w.treated);
  const hasUnsurvivableWound = allWounds.some((w) => w.severity === 'unsurvivable' && !w.treated);

  return {
    characterId,
    wounds: allWounds,
    dominantSeverity,
    hasUntreatedWounds,
    hasUnsurvivableWound,
  };
}

/**
 * Calculates the fear-response intensity from threat salience and authored psychology.
 * Formula: clamp((salience.spike + salience.dread) * (1 - fearlessness), 0, 1)
 */
export function calculateFearResponseIntensity(
  salience: CharacterSalience,
  fearlessness = 0
): number {
  if (!salience) return 0;
  const rawSpike = typeof salience.spike === 'number' && !Number.isNaN(salience.spike) ? salience.spike : 0;
  const rawDread = typeof salience.dread === 'number' && !Number.isNaN(salience.dread) ? salience.dread : 0;
  const f = typeof fearlessness === 'number' && !Number.isNaN(fearlessness) ? Math.max(0, Math.min(1, fearlessness)) : 0;

  const intensity = (rawSpike + rawDread) * (1 - f);
  return Math.max(0, Math.min(1, intensity));
}

/**
 * Derives somatic tokens and active band from fear-response intensity.
 * Band thresholds key off fear-response intensity, not raw salience.
 */
export function deriveSomaticState(
  fearIntensity: number,
  fearContract?: Partial<FearContract>
): { band: 0 | 1 | 2 | 3 | 4; tokens: SomaticToken[] } {
  const intensity = typeof fearIntensity === 'number' && !Number.isNaN(fearIntensity) ? Math.max(0, Math.min(1, fearIntensity)) : 0;
  const bands = fearContract?.somaticBands ?? DEFAULT_FEAR_CONTRACT.somaticBands;

  const b1 = bands.band1 ?? 0.25;
  const b2 = bands.band2 ?? 0.50;
  const b3 = bands.band3 ?? 0.75;
  const b4 = bands.band4 ?? 0.90;

  if (intensity >= b4) {
    return { band: 4, tokens: [...SOMATIC_BAND_TOKENS[4]] };
  }
  if (intensity >= b3) {
    return { band: 3, tokens: [...SOMATIC_BAND_TOKENS[3]] };
  }
  if (intensity >= b2) {
    return { band: 2, tokens: [...SOMATIC_BAND_TOKENS[2]] };
  }
  if (intensity >= b1) {
    return { band: 1, tokens: [...SOMATIC_BAND_TOKENS[1]] };
  }

  return { band: 0, tokens: [] };
}

/**
 * Computes deterministic character salience for a turn:
 * 1. Discrete event ingestion into fast spike layer with provenance tracking.
 * 2. Deterministic decay with residue conversion into ratcheting dread layer.
 * 3. Authoring-defined release valve execution.
 * 4. Dominant threat typing from highest provenance contributor weight.
 * 5. Reversible prey-mode hysteresis evaluation.
 */
export function computeCharacterSalience(
  current: CharacterSalience,
  events: SalienceEvent[] = [],
  fearContract: Partial<FearContract> = {},
  activeValves: string[] = [],
  turn: number = 0,
  characterId?: string
): CharacterSalience {
  let spike = typeof current?.spike === 'number' && !Number.isNaN(current.spike) ? current.spike : 0;
  let dread = typeof current?.dread === 'number' && !Number.isNaN(current.dread) ? current.dread : 0;
  let preyMode = Boolean(current?.preyMode);
  let threatType: ThreatType = current?.threatType || 'life';

  const provenance: SalienceProvenance[] = current?.provenance
    ? current.provenance.map((p) => ({ ...p }))
    : [];

  // 1. Ingest discrete events
  for (const ev of events) {
    const spikeDelta = typeof ev.spikeDelta === 'number' && !Number.isNaN(ev.spikeDelta) ? ev.spikeDelta : 0;
    const dreadDelta = typeof ev.dreadDelta === 'number' && !Number.isNaN(ev.dreadDelta) ? ev.dreadDelta : 0;

    spike = Math.max(0, Math.min(1, spike + spikeDelta));
    dread = Math.max(0, Math.min(1, dread + dreadDelta));

    provenance.push({
      eventId: ev.eventId,
      kind: ev.kind,
      spikeDelta,
      dreadDelta,
      turn: typeof ev.turn === 'number' ? ev.turn : turn,
      threatType: ev.threatType || (ev.kind === 'wound' || ev.kind === 'witnessed-death' ? 'life' : undefined),
      sourceId: ev.sourceId,
      perceivedSourceId: ev.perceivedSourceId,
    });
  }

  // 2. Release valves (if active, zero spike and reduce dread)
  if (activeValves && activeValves.length > 0) {
    const definedValves = fearContract.releaseValves || [];
    for (const activeName of activeValves) {
      const matchedValve = definedValves.find(
        (v) => v.id === activeName || v.condition === activeName
      );
      if (matchedValve) {
        spike = 0;
        dread = Math.max(0, dread - matchedValve.reductionAmount);
      }
    }
  }

  // 3. Deterministic decay with residue
  const lambdaDecay =
    typeof fearContract.lambdaDecay === 'number' && !Number.isNaN(fearContract.lambdaDecay)
      ? fearContract.lambdaDecay
      : DEFAULT_FEAR_CONTRACT.lambdaDecay;
  const residueRatio =
    typeof fearContract.residueRatio === 'number' && !Number.isNaN(fearContract.residueRatio)
      ? fearContract.residueRatio
      : DEFAULT_FEAR_CONTRACT.residueRatio;

  const decayDelta = spike * lambdaDecay;
  spike = Math.max(0, spike - decayDelta);
  dread = Math.min(1, dread + decayDelta * residueRatio);

  // 4. Dominant threat typing
  const threatWeights: Record<ThreatType, number> = {
    life: 0,
    freedom: 0,
    identity: 0,
  };

  for (const p of provenance) {
    const t = p.threatType || (p.kind === 'wound' || p.kind === 'witnessed-death' ? 'life' : 'life');
    if (THREAT_TYPES.includes(t)) {
      threatWeights[t] += Math.abs(p.spikeDelta) + Math.abs(p.dreadDelta);
    }
  }

  let maxWeight = threatWeights[threatType] > 0 ? threatWeights[threatType] : 0;
  let dominantThreat: ThreatType = threatType;
  for (const t of THREAT_TYPES) {
    if (threatWeights[t] > maxWeight) {
      maxWeight = threatWeights[t];
      dominantThreat = t;
    }
  }
  threatType = dominantThreat;

  // 5. Prey mode with hysteresis
  const fearlessness =
    characterId && fearContract.fearlessness && typeof fearContract.fearlessness[characterId] === 'number'
      ? fearContract.fearlessness[characterId]
      : (typeof fearContract.fearlessness?.['default'] === 'number' ? fearContract.fearlessness['default'] : 0);

  const fearIntensity = calculateFearResponseIntensity(
    { spike, dread, threatType, provenance, preyMode },
    fearlessness
  );

  const enterThreshold =
    typeof fearContract.preyEnterThreshold === 'number'
      ? fearContract.preyEnterThreshold
      : DEFAULT_FEAR_CONTRACT.preyEnterThreshold;
  const exitThreshold =
    typeof fearContract.preyExitThreshold === 'number'
      ? fearContract.preyExitThreshold
      : DEFAULT_FEAR_CONTRACT.preyExitThreshold;

  if (preyMode) {
    if (fearIntensity <= exitThreshold) {
      preyMode = false;
    }
  } else {
    if (fearIntensity >= enterThreshold) {
      preyMode = true;
    }
  }

  return {
    spike: Math.max(0, Math.min(1, spike)),
    dread: Math.max(0, Math.min(1, dread)),
    threatType,
    provenance,
    preyMode,
  };
}

/**
 * Creates a clean default salience state for a character.
 */
export function createInitialCharacterSalience(
  overrides?: Partial<CharacterSalience>
): CharacterSalience {
  return {
    spike: 0,
    dread: 0,
    threatType: 'life',
    provenance: [],
    preyMode: false,
    ...overrides,
  };
}

/**
 * Deep clones a CharacterSalience record to guarantee zero shared state across snapshots or retakes.
 */
export function cloneCharacterSalience(salience: CharacterSalience): CharacterSalience {
  return {
    spike: salience.spike,
    dread: salience.dread,
    threatType: salience.threatType,
    preyMode: salience.preyMode,
    provenance: salience.provenance ? salience.provenance.map((p) => ({ ...p })) : [],
  };
}

/**
 * Deep clones a full SalienceLedger.
 */
export function cloneSalienceLedger(
  ledger?: Record<string, CharacterSalience>
): Record<string, CharacterSalience> {
  if (!ledger) return {};
  const cloned: Record<string, CharacterSalience> = {};
  for (const [id, salience] of Object.entries(ledger)) {
    cloned[id] = cloneCharacterSalience(salience);
  }
  return cloned;
}

import type { CohortTraceEmission } from '../types/cohort';
import { classifyFearTexture, formatFearTextureLine } from './fearTexture';

export interface SalienceSourceContribution {
  spike: number;
  dread: number;
  events: number;
}

export function salienceBySource(
  salience: CharacterSalience | null | undefined
): Record<string, SalienceSourceContribution> {
  const out: Record<string, SalienceSourceContribution> = {};
  if (!salience || !Array.isArray(salience.provenance)) return out;
  for (const p of salience.provenance) {
    if (!p) continue;
    const key = p.perceivedSourceId || p.sourceId || 'unknown';
    const entry = out[key] || { spike: 0, dread: 0, events: 0 };
    entry.spike += Math.abs(p.spikeDelta || 0);
    entry.dread += Math.abs(p.dreadDelta || 0);
    entry.events += 1;
    out[key] = entry;
  }
  return out;
}

/**
 * Generates the deterministic somatic state prompt injection string.
 * Supports both multi-character cast ledger formatting and single-character formatting:
 * 1. formatSomaticStatePrompt(salienceLedger, cast, fearContract) -> joined string
 * 2. formatSomaticStatePrompt(characterName, band, tokens) -> single block or null
 * Example: `[SOMATIC STATE: Dale Brennan (Band 2: HAND_TREMOR, COLD_SWEAT)]`
 */
export function formatSomaticStatePrompt(
  characterNameOrLedger: string | Record<string, CharacterSalience>,
  bandOrCast?: number | Array<{ id: string; name?: string; disposition?: string }>,
  tokensOrContract?: SomaticToken[] | Partial<FearContract>
): string | null {
  if (typeof characterNameOrLedger === 'string') {
    const characterName = characterNameOrLedger;
    const band = typeof bandOrCast === 'number' ? bandOrCast : 0;
    const tokens = Array.isArray(tokensOrContract) ? tokensOrContract : [];
    if (band === 0 || tokens.length === 0) return null;
    return `[SOMATIC STATE: ${characterName} (Band ${band}: ${tokens.join(', ')})]`;
  }

  const salienceLedger = characterNameOrLedger || {};
  const rawCast = Array.isArray(bandOrCast) ? bandOrCast : [];
  const cast =
    rawCast.length > 0
      ? rawCast
      : Object.keys(salienceLedger).map((id) => ({ id, name: id }));
  const fearContract =
    tokensOrContract && !Array.isArray(tokensOrContract)
      ? (tokensOrContract as Partial<FearContract>)
      : {};

  const nameById = new Map<string, string>();
  for (const member of cast) {
    if (member && member.id) nameById.set(member.id, member.name || member.id);
  }

  const lines: string[] = [];
  for (const member of cast) {
    const salience = salienceLedger[member.id];
    if (!salience) continue;

    const fearlessness =
      fearContract.fearlessness && typeof fearContract.fearlessness[member.id] === 'number'
        ? fearContract.fearlessness[member.id]
        : typeof fearContract.fearlessness?.['default'] === 'number'
        ? fearContract.fearlessness['default']
        : 0;

    const intensity = calculateFearResponseIntensity(salience, fearlessness);
    const { band, tokens } = deriveSomaticState(intensity, fearContract);

    if (band > 0 && tokens.length > 0) {
      lines.push(
        `[SOMATIC STATE: ${member.name || member.id} (Band ${band}: ${tokens.join(', ')})]`
      );
      const texture = classifyFearTexture(salience.spike, salience.dread);
      if (texture) {
        lines.push(formatFearTextureLine(texture, salience.spike, salience.dread));
      }
      const bySource = salienceBySource(salience);
      let dominantId: string | null = null;
      let dominantWeight = 0;
      for (const [id, contrib] of Object.entries(bySource)) {
        if (id === 'unknown') continue;
        const weight = contrib.spike + contrib.dread;
        if (weight > dominantWeight) {
          dominantWeight = weight;
          dominantId = id;
        }
      }
      if (dominantId) {
        const sourceName = nameById.get(dominantId) || dominantId;
        lines.push(`[FEAR SOURCE: ${member.name || member.id} — driven by ${sourceName}]`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Degrades / distorts external world observations for terrified POV characters (Band 3+ / intensity >= 0.75).
 * Invariant 4: External observations are distorted; internal felt wound severity is NEVER touched or degraded.
 */
export function distortPovObservations(
  observations: string[],
  povFearIntensity: number
): string[] {
  if (povFearIntensity < 0.75 || !Array.isArray(observations) || observations.length === 0) {
    return Array.isArray(observations) ? [...observations] : [];
  }

  const woundKeywords = [
    'wound',
    'laceration',
    'incision',
    'puncture',
    'fracture',
    'bleeding',
    'severed',
    'pain',
    'amputation',
    'vital',
    'hemorrhage',
    'injury',
    'arterial',
  ];

  return observations.map((obs) => {
    if (!obs || typeof obs !== 'string') return obs;
    const lower = obs.toLowerCase();
    // Guard Invariant 4: Never distort wound or bodily injury statements
    const isWoundFact = woundKeywords.some((kw) => lower.includes(kw));
    if (isWoundFact) {
      return obs;
    }

    // Degrade external observation (tunnel vision, blurred peripheral cues)
    if (obs.startsWith('[DISTORTED]') || obs.startsWith('[PERIPHERAL TUNNELING]')) {
      return obs;
    }
    return `[PERIPHERAL TUNNELING: Blurred / Misread Cue] ${obs}`;
  });
}

/**
 * Generates a panic trace emission for characters at fear-response intensity >= 0.75.
 * Anti-rebroadcast: Tagged with deterministic event id derived from characterId-panic-${salienceSpikeTurn} (consumed identity).
 * If lastEmittedPanicTurn matches or exceeds salienceSpikeTurn, duplicate emission is suppressed.
 */
export function generatePanicTrace(
  characterId: string,
  fearIntensity: number,
  nodeId: string,
  turnNumber: number,
  fictionalTime: number,
  salienceSpikeTurn?: number,
  lastEmittedPanicTurn?: number
): CohortTraceEmission | null {
  if (fearIntensity < 0.75) {
    return null;
  }

  const spikeTurn = salienceSpikeTurn !== undefined ? salienceSpikeTurn : turnNumber;

  if (lastEmittedPanicTurn !== undefined && lastEmittedPanicTurn >= spikeTurn) {
    return null;
  }

  const isBand4 = fearIntensity >= 0.9;
  return {
    id: `${characterId}-panic-${spikeTurn}`,
    channel: 'ACOUSTIC',
    nodeId,
    clarity: isBand4 ? 'STARK' : 'AUDIBLE',
    cueText: isBand4
      ? `Involuntary shriek of absolute terror from ${characterId}!`
      : `A ragged, panicked scream echoes from ${characterId}!`,
    fictionalTime,
  };
}
