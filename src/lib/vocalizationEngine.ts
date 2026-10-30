import { EngineTurnContext } from '../types/engineContract';
import type {
  CharacterCapabilityState,
  CapabilityLedger,
} from '../types/worldState';
import type {
  VocalizationBlock,
  AcousticMedium,
  VocalDelivery,
  VocalizationTarget,
  VocalizationCapabilityResult,
  VocalizationDenialReceipt,
  VoiceViolationReceipt,
} from '../types/vocalization';
import { VoiceViolationReceiptSchema } from '../types/vocalization';
import {
  REMOTE_COMMUNICATION_CHANNELS,
  extractConversationalUtterance,
} from './causalFeasibility';

// ─── Vocal Capability Evaluation (Item 11 & Item 12) ─────────────────────────

export const FULL_VOICE_DELIVERIES: readonly VocalDelivery[] = ['spoken', 'shout', 'strained'];
export const WHISPER_DELIVERIES: readonly VocalDelivery[] = ['whisper', 'mutter'];

export function isFullVoiceDelivery(delivery: VocalDelivery | string): boolean {
  return FULL_VOICE_DELIVERIES.includes(delivery as VocalDelivery);
}

export function isWhisperDelivery(delivery: VocalDelivery | string): boolean {
  return WHISPER_DELIVERIES.includes(delivery as VocalDelivery);
}

export function evaluateVocalCapability(
  delivery: VocalDelivery | string,
  capabilityState?: CharacterCapabilityState | null
): VocalizationCapabilityResult;
export function evaluateVocalCapability(
  characterId: string,
  delivery: VocalDelivery | string,
  capabilities?: CapabilityLedger | CharacterCapabilityState | null
): VocalizationCapabilityResult;
export function evaluateVocalCapability(
  arg1: string,
  arg2?: VocalDelivery | string | CharacterCapabilityState | null,
  arg3?: CapabilityLedger | CharacterCapabilityState | null
): VocalizationCapabilityResult {
  let delivery: string;
  let state: CharacterCapabilityState | null | undefined;

  const isArg1Delivery =
    FULL_VOICE_DELIVERIES.includes(arg1 as VocalDelivery) ||
    WHISPER_DELIVERIES.includes(arg1 as VocalDelivery) ||
    arg1 === 'synthetic';

  if (isArg1Delivery || typeof arg2 !== 'string') {
    delivery = arg1;
    state = (arg2 as CharacterCapabilityState) ?? null;
  } else {
    const charId = arg1;
    delivery = (arg2 as string) || 'spoken';
    if (arg3 && typeof arg3 === 'object') {
      if ('impairedCapabilities' in arg3) {
        state = arg3 as CharacterCapabilityState;
      } else {
        state = (arg3 as CapabilityLedger)[charId] ?? null;
      }
    }
  }

  const impaired = state?.impairedCapabilities || [];
  const normalizedDelivery = (delivery || 'spoken').toLowerCase() as VocalDelivery;

  if (isFullVoiceDelivery(normalizedDelivery)) {
    if (impaired.includes('VOCAL_FULL')) {
      return {
        allowed: false,
        reasonCode: 'CAPABILITY_IMPAIRED',
        provenance: `Vocal delivery '${normalizedDelivery}' denied: VOCAL_FULL capability is impaired.`,
        impairedSlot: 'VOCAL_FULL',
      };
    }
  } else if (isWhisperDelivery(normalizedDelivery)) {
    if (impaired.includes('VOCAL_WHISPER')) {
      return {
        allowed: false,
        reasonCode: 'CAPABILITY_IMPAIRED',
        provenance: `Vocal delivery '${normalizedDelivery}' denied: VOCAL_WHISPER capability is impaired.`,
        impairedSlot: 'VOCAL_WHISPER',
      };
    }
  }

  return {
    allowed: true,
    reasonCode: 'ALLOWED',
    provenance: `Vocal delivery '${normalizedDelivery}' permitted under capability state.`,
  };
}

export const checkVocalCapability = evaluateVocalCapability;
export const evaluateVocalDeliveryCapability = evaluateVocalCapability;

export const REMOTE_DISCONNECT_PATTERNS =
  /\b(hang\s*up|hung\s*up|disconnect[singed]*|click[singed]*\s*off|shut[ting]*\s*off\s*(the\s*)?(radio|phone|comm)|end[singed]*\s*(the\s*)?(call|transmission))\b/i;

export const RECOGNIZED_AMBIENT_SPEAKER_PATTERN =
  /\b(waiter|waitress|server|bartender|sommelier|busboy|hostess|maitre\s*d'?|cab\s+driver|taxi\s+driver|driver|chauffeur|cabbie|doorman|concierge|bellhop|valet|porter|secretary|receptionist|clerk|cashier|teller|police\s+officer|cop|detective|investigator|dispatcher|operator|doctor|physician|surgeon|nurse|paramedic|orderly|security\s+guard|guard|watchman|passerby|patron|bystander|pedestrian|commuter|neighbor|courier|delivery\s+person|messenger|barista|attendant|flight\s+attendant|steward|stewardess|announcer|technician|engineer|automated\s+voice|intercom\s+voice|ticket\s+agent|shopkeeper|mechanic)\b/i;

export const ACOUSTIC_LINK_PATTERNS =
  /\b(observation\s*(?:port|window|glass)|intercom|airlock|duct|vent(?:ilation)?|grate|partition|speaker|pipe|hatch|window|glass|camera|feed|monitor|tannoy|pa\s*system|bulkhead)\b/i;

export function isRecognizedAmbientSpeaker(speaker: string): boolean {
  if (typeof speaker !== 'string') return false;
  return RECOGNIZED_AMBIENT_SPEAKER_PATTERN.test(speaker.trim());
}

export interface AuditoryCharacterSummary {
  id: string;
  name: string;
  role?: string;
  isPresent: boolean;
  isUserCharacter: boolean;
  communicationModes: Array<'spoken' | 'nonverbal' | 'mediated'>;
}

export interface AuditoryContext {
  coPresentCharacters: AuditoryCharacterSummary[];
  adjacentOrElsewhereCharacters: AuditoryCharacterSummary[];
  presentSpeakerNames: string[];
  isSolitary: boolean;
  hasActiveRemoteChannel: boolean;
  remoteChannelMedium: 'radio' | 'intercom' | null;
  hasAcousticTopologyLinks: boolean;
  detectedAcousticLinkMedium: 'intercom' | 'port_observation' | 'acoustic_bleed';
  adjacentNodeIds: ReadonlySet<string>;
  arrivedCastIds: ReadonlySet<string>;
  hasArrivals: boolean;
  explicitlyAddressedSpeakerId: string | null;
  extractedUtterance?: string;
  context: EngineTurnContext;
  userAction?: string;
  recentHistory?: Array<{ role: string; content: string }> | string;
  capabilities?: CapabilityLedger;
}

export function buildAuditoryContext(
  context: EngineTurnContext,
  userAction?: string,
  recentHistory?: Array<{ role: string; content: string }> | string,
  arrivedCastIds?: ReadonlySet<string>,
  explicitlyAddressedSpeakerId: string | null = null,
  capabilities?: CapabilityLedger
): AuditoryContext {
  const nonPlayerCast = (context.cast || []).filter(
    (c) => c.id !== context.player.characterId && !c.isUserCharacter
  );

  const coPresentCharacters: AuditoryCharacterSummary[] = nonPlayerCast
    .filter((c) => c.isPresent)
    .map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      isPresent: true,
      isUserCharacter: false,
      communicationModes: c.expressionProfile?.communicationModes ?? ['spoken'],
    }));

  const adjacentOrElsewhereCharacters: AuditoryCharacterSummary[] = nonPlayerCast
    .filter((c) => !c.isPresent)
    .map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      isPresent: false,
      isUserCharacter: false,
      communicationModes: c.expressionProfile?.communicationModes ?? ['spoken'],
    }));

  const presentSpeakerNames = coPresentCharacters
    .filter(
      (c) =>
        c.communicationModes.includes('spoken') ||
        c.communicationModes.includes('mediated')
    )
    .map((c) => c.name);

  const isSolitary = presentSpeakerNames.length === 0;

  const actionText = typeof userAction === 'string' ? userAction.toLowerCase() : '';
  const isDisconnectAction = REMOTE_DISCONNECT_PATTERNS.test(actionText);
  let hasActiveRemoteChannel = false;
  let remoteChannelMedium: 'radio' | 'intercom' | null = null;

  if (!isDisconnectAction) {
    if (REMOTE_COMMUNICATION_CHANNELS.test(actionText)) {
      hasActiveRemoteChannel = true;
      if (/\b(intercom|tannoy|pa\b|speaker)/i.test(actionText)) {
        remoteChannelMedium = 'intercom';
      } else {
        remoteChannelMedium = 'radio';
      }
    } else if (Array.isArray(recentHistory) && recentHistory.length > 0) {
      const recentMessages = recentHistory.slice(-4);
      for (const msg of recentMessages) {
        if (typeof msg.content === 'string' && REMOTE_COMMUNICATION_CHANNELS.test(msg.content)) {
          hasActiveRemoteChannel = true;
          if (/\b(intercom|tannoy|pa\b|speaker)/i.test(msg.content)) {
            remoteChannelMedium = 'intercom';
          } else {
            remoteChannelMedium = 'radio';
          }
          break;
        }
      }
    } else if (typeof recentHistory === 'string' && recentHistory.trim().length > 0) {
      if (REMOTE_COMMUNICATION_CHANNELS.test(recentHistory)) {
        hasActiveRemoteChannel = true;
        if (/\b(intercom|tannoy|pa\b|speaker)/i.test(recentHistory)) {
          remoteChannelMedium = 'intercom';
        } else {
          remoteChannelMedium = 'radio';
        }
      }
    }
  }

  const topologyText = [
    context.topology?.readableNodeLabel || '',
    context.topology?.currentNodeId || '',
    ...(context.topology?.allowedOutgoingExits?.map(
      (e) => `${e.from} ${e.to} ${(e.requires || []).join(' ')}`
    ) || []),
    context.scenario?.setting?.location || '',
    context.scenario?.setting?.atmosphere || '',
    context.scenario?.premise || '',
    ...(context.scenario?.worldRules || []),
    ...(context.scenario?.keyPlotElements || []),
    ...nonPlayerCast.map((c) => `${c.description} ${c.goals}`),
    actionText,
  ].join(' ');

  const hasAcousticTopologyLinks = ACOUSTIC_LINK_PATTERNS.test(topologyText);
  let detectedAcousticLinkMedium: 'intercom' | 'port_observation' | 'acoustic_bleed' =
    'acoustic_bleed';
  if (/\b(intercom|tannoy|speaker|pa\s*system)\b/i.test(topologyText)) {
    detectedAcousticLinkMedium = 'intercom';
  } else if (
    /\b(observation\s*(?:port|window|glass)|partition|window|glass)\b/i.test(
      topologyText
    )
  ) {
    detectedAcousticLinkMedium = 'port_observation';
  }

  const safeArrivals = arrivedCastIds ?? new Set<string>();
  const hasArrivals = safeArrivals.size > 0;

  const adjacentNodeIds = new Set<string>(
    (context.topology?.allowedOutgoingExits || []).map((e) => e.to)
  );

  let effectiveAddressedSpeakerId = explicitlyAddressedSpeakerId;
  let extractedUtterance: string | undefined;

  if (userAction) {
    const extracted = extractConversationalUtterance(userAction, context);
    if (extracted.conversationalUtterance) {
      extractedUtterance = extracted.conversationalUtterance;
    }
    if (!effectiveAddressedSpeakerId && extracted.addressedTargetId) {
      effectiveAddressedSpeakerId = extracted.addressedTargetId;
    }
  }

  return {
    coPresentCharacters,
    adjacentOrElsewhereCharacters,
    presentSpeakerNames,
    isSolitary,
    hasActiveRemoteChannel,
    remoteChannelMedium,
    hasAcousticTopologyLinks,
    detectedAcousticLinkMedium,
    adjacentNodeIds,
    arrivedCastIds: safeArrivals,
    hasArrivals,
    explicitlyAddressedSpeakerId: effectiveAddressedSpeakerId,
    extractedUtterance,
    context,
    userAction,
    recentHistory,
    capabilities,
  };
}

function cleanSpeakerContent(content: string, speakerName?: string): string {
  let cleaned = typeof content === 'string' ? content : '';
  if (speakerName) {
    const escapedSpeaker = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`^["']?\\s*${escapedSpeaker}\\s*:\\s*`, 'i'), '').trim();
  }
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2)
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function formatContentWithInterruption(content: string, interrupted: boolean): string {
  if (!interrupted) return content;
  if (content.endsWith('—') || content.endsWith('--')) return content;
  return content.replace(/[\s.,;:!?]+$/, '') + '—';
}

export interface RawVocalizationInputBlock {
  type: string;
  speaker?: string | null;
  content?: string;
  medium?: string;
  delivery?: string;
  target?: string;
  interrupted?: boolean;
  acousticSourceNodeId?: string;
  [key: string]: unknown;
}

export function validateAndNormalizeVocalization(
  blocks: Array<RawVocalizationInputBlock>,
  auditoryContext: AuditoryContext
): {
  error: string | null;
  normalizedBlocks: VocalizationBlock[];
  denialReceipts?: VocalizationDenialReceipt[];
} {
  if (!Array.isArray(blocks)) {
    return { error: null, normalizedBlocks: [], denialReceipts: [] };
  }

  const { context, arrivedCastIds, adjacentNodeIds } = auditoryContext;
  const normalizedBlocks: VocalizationBlock[] = [];
  let dialogueCount = 0;

  for (const rawBlock of blocks) {
    if (!rawBlock || typeof rawBlock !== 'object') continue;
    const block = { ...rawBlock };
    const type = block.type;
    const interrupted = Boolean(block.interrupted);

    // Adjudicate acousticSourceNodeId for remote acoustic mediums (Amendment 7: Fail-Closed Adjacency)
    let acousticSourceNodeId =
      typeof block.acousticSourceNodeId === 'string' && block.acousticSourceNodeId.trim()
        ? block.acousticSourceNodeId.trim()
        : undefined;

    const isAcousticMedium =
      block.medium === 'acoustic_bleed' || block.medium === 'port_observation';

    if (isAcousticMedium) {
      if (acousticSourceNodeId) {
        if (!adjacentNodeIds.has(acousticSourceNodeId)) {
          return {
            error: `Acoustic source node "${acousticSourceNodeId}" is not a valid adjacent chamber link.`,
            normalizedBlocks: [],
          };
        }
      } else if (adjacentNodeIds.size > 0) {
        acousticSourceNodeId = Array.from(adjacentNodeIds)[0];
      }
    }

    if (type === 'internal_monologue') {
      let speaker = typeof block.speaker === 'string' ? block.speaker.trim() : '';
      if (!speaker) {
        speaker = context.player.name;
      }
      const castMember = context.cast.find(
        (m) => m.name.toLowerCase() === speaker.toLowerCase() || m.id === speaker
      );
      if (castMember) {
        speaker = castMember.name;
      } else if (
        context.player.name.toLowerCase() === speaker.toLowerCase() ||
        context.player.characterId === speaker
      ) {
        speaker = context.player.name;
      } else if (!isRecognizedAmbientSpeaker(speaker)) {
        return {
          error: `Dialogue speaker "${speaker}" is not in the authorized cast.`,
          normalizedBlocks: [],
        };
      }

      const content = formatContentWithInterruption(
        cleanSpeakerContent(block.content, speaker),
        interrupted
      );

      normalizedBlocks.push({
        type: 'internal_monologue',
        speaker,
        medium: 'internal',
        target: 'self',
        delivery: (block.delivery as VocalDelivery) || 'spoken',
        interrupted,
        content,
      });
      continue;
    }

    if (type === 'soliloquy') {
      let speaker = typeof block.speaker === 'string' ? block.speaker.trim() : '';
      if (!speaker) {
        speaker = context.player.name;
      }
      const castMember = context.cast.find(
        (m) => m.name.toLowerCase() === speaker.toLowerCase() || m.id === speaker
      );
      if (castMember) {
        speaker = castMember.name;
      } else if (
        context.player.name.toLowerCase() === speaker.toLowerCase() ||
        context.player.characterId === speaker
      ) {
        speaker = context.player.name;
      } else if (!isRecognizedAmbientSpeaker(speaker)) {
        return {
          error: `Dialogue speaker "${speaker}" is not in the authorized cast.`,
          normalizedBlocks: [],
        };
      }

      const delivery = (block.delivery as VocalDelivery) || 'mutter';

      if (auditoryContext.capabilities) {
        const charId = castMember
          ? castMember.id
          : speaker.toLowerCase() === context.player.name.toLowerCase() ||
            speaker === context.player.characterId
          ? context.player.characterId
          : undefined;
        if (charId && auditoryContext.capabilities[charId]) {
          const capCheck = evaluateVocalCapability(delivery, auditoryContext.capabilities[charId]);
          if (!capCheck.allowed) {
            return {
              error: `Soliloquy speaker "${speaker}" vocal capability impaired: ${capCheck.impairedSlot}.`,
              normalizedBlocks: [],
              denialReceipts: [capCheck as VocalizationDenialReceipt],
            };
          }
        }
      }

      const content = formatContentWithInterruption(
        cleanSpeakerContent(block.content, speaker),
        interrupted
      );

      normalizedBlocks.push({
        type: 'soliloquy',
        speaker,
        medium: (block.medium as AcousticMedium) || 'direct',
        target: 'self',
        delivery,
        interrupted,
        content,
      });
      continue;
    }

    if (type === 'dialogue') {
      dialogueCount += 1;
      if (dialogueCount > 1) {
        return {
          error: 'Turn response may contain at most one dialogue block.',
          normalizedBlocks: [],
        };
      }

      const speaker = typeof block.speaker === 'string' ? block.speaker.trim() : '';
      if (!speaker) {
        return {
          error: 'Dialogue block is missing a speaker.',
          normalizedBlocks: [],
        };
      }

      const castMember = context.cast.find(
        (m) => m.name.toLowerCase() === speaker.toLowerCase() || m.id === speaker
      );

      if (!castMember) {
        if (isRecognizedAmbientSpeaker(speaker)) {
          const content = formatContentWithInterruption(
            cleanSpeakerContent(block.content, speaker),
            interrupted
          );

          normalizedBlocks.push({
            type: 'dialogue',
            speaker,
            medium: (block.medium as AcousticMedium) || 'direct',
            delivery: (block.delivery as VocalDelivery) || 'spoken',
            target: (block.target as VocalizationTarget) || 'addressed',
            interrupted,
            ...(acousticSourceNodeId ? { acousticSourceNodeId } : {}),
            content,
          });
          continue;
        }

        return {
          error: `Dialogue speaker "${speaker}" is not in the authorized cast.`,
          normalizedBlocks: [],
        };
      }

      const activeName = castMember.name;
      const content = formatContentWithInterruption(
        cleanSpeakerContent(block.content, activeName),
        interrupted
      );

      const delivery = (block.delivery as VocalDelivery) || 'spoken';

      if (auditoryContext.capabilities) {
        const charId = castMember.id;
        if (charId && auditoryContext.capabilities[charId]) {
          const capCheck = evaluateVocalCapability(delivery, auditoryContext.capabilities[charId]);
          if (!capCheck.allowed) {
            return {
              error: `Dialogue speaker "${activeName}" vocal capability impaired: ${capCheck.impairedSlot}.`,
              normalizedBlocks: [],
              denialReceipts: [capCheck as VocalizationDenialReceipt],
            };
          }
        }
      }

      const isPlayer =
        castMember.id === context.player.characterId || castMember.isUserCharacter;

      if (isPlayer) {
        const isSystemInit = auditoryContext.userAction === 'SYSTEM_INIT';
        const communicationModes =
          castMember.expressionProfile?.communicationModes ?? ['spoken'];
        const canSpeak =
          communicationModes.includes('spoken') ||
          communicationModes.includes('mediated');

        if (auditoryContext.capabilities) {
          const playerCap = auditoryContext.capabilities[context.player.characterId];
          if (playerCap) {
            const isMuttering =
              block.delivery === 'mutter' ||
              block.delivery === 'whisper' ||
              block.target === 'self';
            const playerDelivery =
              (block.delivery as VocalDelivery) || (isMuttering ? 'mutter' : 'spoken');
            const capCheck = evaluateVocalCapability(playerDelivery, playerCap);
            if (!capCheck.allowed) {
              return {
                error: `Player speaker "${activeName}" vocal capability impaired: ${capCheck.impairedSlot}.`,
                normalizedBlocks: [],
                denialReceipts: [capCheck as VocalizationDenialReceipt],
              };
            }
          }
        }

        if (isSystemInit) {
          dialogueCount -= 1;
          if (!canSpeak) {
            // Downgraded to prose: drop dialogue-only fields rather than
            // carrying stale speaker/medium metadata into a prose block.
            normalizedBlocks.push({
              type: 'prose',
              content,
              medium: 'direct',
              delivery: 'spoken',
              target: 'addressed',
              interrupted: false,
            });
          } else {
            normalizedBlocks.push({
              type: auditoryContext.isSolitary ? 'soliloquy' : 'dialogue',
              speaker: activeName,
              medium: 'direct',
              delivery: (block.delivery as VocalDelivery) || 'spoken',
              target: auditoryContext.isSolitary ? 'self' : 'cohort',
              interrupted,
              content,
            });
          }
          continue;
        }

        const isMuttering =
          block.delivery === 'mutter' ||
          block.delivery === 'whisper' ||
          block.target === 'self';

        if (auditoryContext.isSolitary || isMuttering) {
          dialogueCount -= 1;
          normalizedBlocks.push({
            type: 'soliloquy',
            speaker: activeName,
            medium: 'direct',
            delivery: (block.delivery as VocalDelivery) || 'mutter',
            target: 'self',
            interrupted,
            content,
          });
          continue;
        }

        return {
          error: `Dialogue speaker "${speaker}" is the player-controlled character.`,
          normalizedBlocks: [],
        };
      }

      const communicationModes =
        castMember.expressionProfile?.communicationModes ?? ['spoken'];
      const canSpeak =
        communicationModes.includes('spoken') ||
        communicationModes.includes('mediated');

      if (!canSpeak) {
        return {
          error: `Dialogue speaker "${speaker}" lacks spoken or mediated communication.`,
          normalizedBlocks: [],
        };
      }

      if (castMember.isPresent) {
        normalizedBlocks.push({
          type: 'dialogue',
          speaker: activeName,
          medium: (block.medium as AcousticMedium) || 'direct',
          delivery: (block.delivery as VocalDelivery) || 'spoken',
          target: (block.target as VocalizationTarget) || 'addressed',
          interrupted,
          content,
        });
        continue;
      }

      // If !castMember.isPresent:
      if (arrivedCastIds?.has(castMember.id)) {
        normalizedBlocks.push({
          type: 'dialogue',
          speaker: activeName,
          medium: (block.medium as AcousticMedium) || 'direct',
          delivery: (block.delivery as VocalDelivery) || 'spoken',
          target: (block.target as VocalizationTarget) || 'addressed',
          interrupted,
          content,
        });
        continue;
      }

      if (auditoryContext.hasActiveRemoteChannel) {
        const medium =
          auditoryContext.remoteChannelMedium === 'intercom' ? 'intercom' : 'radio';
        normalizedBlocks.push({
          type: 'dialogue',
          speaker: activeName,
          medium,
          delivery: (block.delivery as VocalDelivery) || 'spoken',
          target: (block.target as VocalizationTarget) || 'addressed',
          interrupted,
          content,
        });
        continue;
      }

      // Graceful Acoustic Resolution: auto-remediate to type: 'transmission'
      dialogueCount -= 1;
      const medium =
        auditoryContext.detectedAcousticLinkMedium === 'intercom'
          ? 'intercom'
          : auditoryContext.detectedAcousticLinkMedium === 'port_observation'
            ? 'port_observation'
            : 'acoustic_bleed';

      normalizedBlocks.push({
        type: 'transmission',
        speaker: activeName,
        medium,
        delivery: (block.delivery as VocalDelivery) || 'mutter',
        target: 'unseen',
        interrupted,
        ...(acousticSourceNodeId ? { acousticSourceNodeId } : {}),
        content,
      });
      continue;
    }

    if (type === 'transmission' || type === 'system_voice') {
      const speaker = typeof block.speaker === 'string' ? block.speaker.trim() : '';
      const content = formatContentWithInterruption(
        cleanSpeakerContent(block.content, speaker),
        interrupted
      );
      const medium = (block.medium as AcousticMedium) || (type === 'system_voice' ? 'intercom' : 'radio');

      normalizedBlocks.push({
        type,
        speaker: speaker || (type === 'system_voice' ? 'Automated Voice' : null),
        medium,
        delivery: (block.delivery as VocalDelivery) || (type === 'system_voice' ? 'synthetic' : 'spoken'),
        target: (block.target as VocalizationTarget) || 'broadcast',
        interrupted,
        ...(acousticSourceNodeId ? { acousticSourceNodeId } : {}),
        content,
      });
      continue;
    }

    if (type === 'prose' || type === 'environmental_description') {
      normalizedBlocks.push({
        type,
        speaker: null,
        medium: 'direct',
        delivery: 'spoken',
        target: 'addressed',
        interrupted: false,
        content: typeof block.content === 'string' ? block.content : '',
      });
      continue;
    }

    // Passthrough: the block already carried a valid vocalization shape and
    // required no normalization in this loop.
    normalizedBlocks.push(block as unknown as VocalizationBlock);
  }

  return { error: null, normalizedBlocks, denialReceipts: [] };
}

export function formatVocalizationPromptDirective(
  auditoryContext: AuditoryContext
): string {
  const {
    isSolitary,
    presentSpeakerNames,
    explicitlyAddressedSpeakerId,
    extractedUtterance,
    context,
    hasActiveRemoteChannel,
    remoteChannelMedium,
    hasAcousticTopologyLinks,
    detectedAcousticLinkMedium,
  } = auditoryContext;

  const explicitlyAddressedMember = explicitlyAddressedSpeakerId
    ? context.cast.find((c) => c.id === explicitlyAddressedSpeakerId)
    : null;

  // 1. Somatic & Psychological Sourcing Section (Amendment 4)
  const playerInjuriesText =
    context.consequenceState.player_injuries && context.consequenceState.player_injuries.length > 0
      ? ` (Injuries: ${context.consequenceState.player_injuries.join(', ')})`
      : '';
  const somaticSection = `\n\n[SOMATIC & PSYCHOLOGICAL SOURCING]
• Player Character (${context.player.name}): Psychological status is ${
    context.consequenceState.psychological_status || 'STABLE'
  }${playerInjuriesText}.
• Companions / Cast: Each companion's somatic and psychological state is sourced STRICTLY from their own cast ledger record. Companion absence of status is silence and vigilance—NEVER default to PANICKED, and NEVER project player hypothermia, shock, or injuries onto companions.`;

  // 2. Authored Camouflage Leaks (Amendment 3)
  const tension = typeof context.runtime.tension === 'number' ? context.runtime.tension : 0;
  const phase = (context.runtime.phase || '').toUpperCase();
  const isHighTension = tension >= 7 || phase === 'CLIMAX' || phase === 'CRITICAL';

  let leakSection = '';
  if (isHighTension) {
    const leakDirectives = context.cast
      .filter((c) => c.expressionProfile?.camouflageLeakGuidance)
      .map(
        (c) =>
          `• ${c.name}: Under escalating climax tension, surface composure fractures: ${c.expressionProfile!.camouflageLeakGuidance}`
      );
    if (leakDirectives.length > 0) {
      leakSection = `\n\n[AUTHORED CAMOUFLAGE LEAK DIRECTIVES]\n${leakDirectives.join('\n')}`;
    }
  }

  // 3. One-Directional Epistemic Constraints (Amendment 6)
  let epistemicSection = '';
  if (hasAcousticTopologyLinks || detectedAcousticLinkMedium === 'acoustic_bleed' || detectedAcousticLinkMedium === 'port_observation') {
    epistemicSection = `\n\n[ACOUSTIC BLEED & EPISTEMIC CONSTRAINTS]
When emitting overheard speech from adjacent chambers (medium: 'acoustic_bleed' or 'port_observation'):
The overheard character does not know they were heard. Their dialogue must not acknowledge, react to, or reference the listener unless the medium is explicitly two-way (an open intercom, a directly addressed radio call).`;
  }

  // Common attribute reminder
  const attributeReminder = `\nVOCALIZATION ATTRIBUTES:
- "interrupted": set to true when speech is abruptly cut off mid-sentence by shock, trauma, or interruption (end content with a trailing em-dash "—").
- "acousticSourceNodeId": topology node ID of the remote chamber where transmission or acoustic bleed originates.`;

  if (explicitlyAddressedMember) {
    const replyObligation = extractedUtterance
      ? `\n[MANDATORY CONVERSATIONAL REPLY: You MUST include a dialogue block from ${explicitlyAddressedMember.name} answering the player's statement: "${extractedUtterance}"]`
      : '';

    return `\n\n[MANDATORY DIALOGUE REQUIREMENT]
The user explicitly spoke to ${explicitlyAddressedMember.name}.${replyObligation}
In narrative_blocks, you MUST include 1-2 prose blocks AND exactly ONE dialogue block answering the player:
{"type": "dialogue", "speaker": "${explicitlyAddressedMember.name}", "medium": "direct", "delivery": "spoken", "target": "addressed", "content": "<The spoken response without prepending speaker name>"}
Do NOT emit only prose blocks. Do NOT put spoken dialogue into a prose block. Exactly ONE block must have type "dialogue".${somaticSection}${leakSection}${epistemicSection}${attributeReminder}`;
  }

  if (isSolitary) {
    return `\n\n[SOLITARY VOCALIZATION DIRECTIVE]
The player character (${context.player.name}) is SOLITARY in this chamber (no living companions are physically co-present).
- FORBIDDEN: Do NOT emit interpersonal room dialogue ({"type": "dialogue"}) directed to people in the room, as no one is present to hear it${
      hasActiveRemoteChannel
        ? ' (unless speaking over the active remote ' + (remoteChannelMedium || 'radio') + ' channel)'
        : ''
    }.
- INTERNAL MONOLOGUE ALLOWED: Private thoughts, cognitive dread, realizations, or suppressed terror are emitted as:
  {"type": "internal_monologue", "speaker": "${context.player.name}", "medium": "internal", "target": "self", "content": "<Private internal thought>"}
- SOLILOQUY MUTTERING ALLOWED: Speaking aloud to oneself under stress, muttering in disbelief, or quiet despair is emitted as:
  {"type": "soliloquy", "speaker": "${context.player.name}", "medium": "direct", "delivery": "mutter", "target": "self", "content": "<Muttered words to self>"}
- TRANSMISSIONS / SYSTEM VOICES: Facility PA announcements, automated security voices, radio static, or acoustic bleed muffled through bulkheads/ducts are emitted as:
  {"type": "transmission", "speaker": "<Source or null>", "medium": "intercom" | "radio" | "acoustic_bleed", "content": "<Heard transmission>"}${somaticSection}${leakSection}${epistemicSection}${attributeReminder}`;
  }

  return `\n\n[MANDATORY DIALOGUE REQUIREMENT]
The following characters are physically present in this room: ${presentSpeakerNames.join(', ')}.
To keep the world alive, people in the same room do not stand in absolute silence. In narrative_blocks, you MUST include 1-2 prose blocks AND exactly ONE dialogue block:
{"type": "dialogue", "speaker": "<Speaker Name>", "medium": "direct", "delivery": "spoken", "target": "addressed", "content": "<Spoken words without prepending speaker name>"}
The speaker must be one of the present companions (${presentSpeakerNames.join(', ')}) or a recognized ambient attendant.
Do NOT emit only prose blocks when companions are present in the room. Exactly ONE block must have type "dialogue".
VOCALIZATION FORMATS:
- Dialogue: {"type": "dialogue", "speaker": "Name", "medium": "direct", "delivery": "spoken", "target": "addressed", "content": "..."}
- Internal Monologue: {"type": "internal_monologue", "speaker": "Name", "medium": "internal", "target": "self", "content": "..."}
- Soliloquy: {"type": "soliloquy", "speaker": "Name", "medium": "direct", "delivery": "mutter", "target": "self", "content": "..."}
- Transmission: {"type": "transmission", "speaker": "Name", "medium": "intercom"|"radio"|"acoustic_bleed", "content": "..."}${somaticSection}${leakSection}${epistemicSection}${attributeReminder}`;
}

// ─── Acoustic Audience Routing (Item 13) ────────────────────────────────────

import {
  resolveAcousticAudience,
  type LocationTopology,
  type VocalMedium,
} from './acousticRouting';

export {
  resolveAcousticAudience,
  connectionCarriesAcousticBleed,
  isSealedTopologyConnection,
  type LocationTopology,
  type LocationTopologyConnection,
  type VocalMedium,
} from './acousticRouting';

// ─── Voice Violation Receipts (Item 14) ─────────────────────────────────────

export {
  VoiceViolationReceiptSchema,
  type VoiceViolationReceipt,
};

export interface ScanTurnForVoiceViolationsInput {
  turnNumber: number;
  narrativeBlocks?: Array<Record<string, unknown>>;
  narrative_blocks?: Array<Record<string, unknown>>;
  vocalizations?: Array<Record<string, unknown>>;
  capabilities?: CapabilityLedger | Record<string, CharacterCapabilityState>;
  topology?: LocationTopology;
  characterNodes?: Record<string, string> | Map<string, string>;
  cast?: Array<{ id: string; name?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export function scanTurnForVoiceViolations(
  input: ScanTurnForVoiceViolationsInput
): VoiceViolationReceipt[] {
  if (!input || typeof input !== 'object') {
    return [];
  }

  const turnNumber = typeof input.turnNumber === 'number' ? input.turnNumber : 0;

  // Extract raw narrative/vocalization blocks across possible property shapes
  const rawList: Array<Record<string, unknown>> = [];
  if (Array.isArray(input.narrativeBlocks)) rawList.push(...input.narrativeBlocks);
  if (Array.isArray(input.narrative_blocks)) rawList.push(...input.narrative_blocks);
  if (Array.isArray(input.vocalizations)) rawList.push(...input.vocalizations);

  const rawBlocks: Array<Record<string, unknown>> = [];
  const seenObjects = new Set<Record<string, unknown>>();
  for (const item of rawList) {
    if (item && typeof item === 'object' && !seenObjects.has(item)) {
      seenObjects.add(item);
      rawBlocks.push(item);
    }
  }

  if (rawBlocks.length === 0) {
    return [];
  }

  const castMembers = Array.isArray(input.cast) ? input.cast : [];

  function resolveCharacterId(rawIdOrName?: unknown): string | null {
    if (typeof rawIdOrName !== 'string') return null;
    const trimmed = rawIdOrName.trim();
    if (!trimmed) return null;

    // 1. Cast match
    const castMatch = castMembers.find(
      (c) =>
        c.id === trimmed ||
        (typeof c.name === 'string' && c.name.toLowerCase() === trimmed.toLowerCase())
    );
    if (castMatch) return castMatch.id;

    // 2. Direct match in capabilities
    if (input.capabilities && typeof input.capabilities === 'object') {
      if (trimmed in input.capabilities) return trimmed;
      const lower = trimmed.toLowerCase();
      for (const key of Object.keys(input.capabilities)) {
        if (key.toLowerCase() === lower) return key;
      }
    }

    // 3. Direct match in characterNodes
    if (input.characterNodes) {
      if (input.characterNodes instanceof Map) {
        if (input.characterNodes.has(trimmed)) return trimmed;
        const lower = trimmed.toLowerCase();
        for (const key of input.characterNodes.keys()) {
          if (key.toLowerCase() === lower) return key;
        }
      } else if (typeof input.characterNodes === 'object') {
        if (trimmed in input.characterNodes) return trimmed;
        const lower = trimmed.toLowerCase();
        for (const key of Object.keys(input.characterNodes)) {
          if (key.toLowerCase() === lower) return key;
        }
      }
    }

    return trimmed;
  }

  function getCharacterNode(charId: string): string | undefined {
    if (!input.characterNodes || !charId) return undefined;
    if (input.characterNodes instanceof Map) {
      if (input.characterNodes.has(charId)) return input.characterNodes.get(charId);
      const lower = charId.toLowerCase();
      for (const [key, val] of input.characterNodes.entries()) {
        if (key.toLowerCase() === lower) return val;
      }
    } else if (typeof input.characterNodes === 'object') {
      if (charId in input.characterNodes) return input.characterNodes[charId];
      const lower = charId.toLowerCase();
      for (const [key, val] of Object.entries(input.characterNodes)) {
        if (key.toLowerCase() === lower) return val;
      }
    }
    return undefined;
  }

  function getCapabilityState(charId: string): CharacterCapabilityState | undefined {
    if (!input.capabilities || typeof input.capabilities !== 'object') return undefined;
    if (charId in input.capabilities) return input.capabilities[charId];
    const lower = charId.toLowerCase();
    for (const [key, val] of Object.entries(input.capabilities)) {
      if (key.toLowerCase() === lower) return val;
    }
    return undefined;
  }

  const receipts: VoiceViolationReceipt[] = [];

  // Track recorded vocalizations for reaction matching across blocks
  interface RecordedVocalization {
    speakerId: string;
    sourceNodeId: string;
    medium: VocalMedium;
    delivery: VocalDelivery;
    audibleAudience: string[];
    blockIndex: number;
  }
  const recordedVocalizations: RecordedVocalization[] = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i];
    const rawSpeaker =
      block.speaker ??
      block.speakerId ??
      block.sourceCharacterId ??
      block.characterId ??
      null;
    const speakerId = resolveCharacterId(rawSpeaker);
    const rawType = typeof block.type === 'string' ? block.type.trim().toLowerCase() : '';
    const isInternal = rawType === 'internal_monologue' || block.medium === 'internal';

    const delivery = (
      typeof block.delivery === 'string' && block.delivery.trim()
        ? block.delivery.trim().toLowerCase()
        : 'spoken'
    ) as VocalDelivery;

    const medium = (
      typeof block.medium === 'string' && block.medium.trim()
        ? block.medium.trim().toLowerCase()
        : 'direct'
    ) as VocalMedium;

    // ── Check 1: Vocal Impairment State (Item 12: VOCAL_FULL, VOCAL_WHISPER) ──
    // Does not apply to internal thoughts (internal monologue)
    if (speakerId && !isInternal) {
      const capState = getCapabilityState(speakerId);
      if (capState) {
        const impaired = capState.impairedCapabilities || [];
        if (isFullVoiceDelivery(delivery) && impaired.includes('VOCAL_FULL')) {
          receipts.push(
            VoiceViolationReceiptSchema.parse({
              characterId: speakerId,
              turnNumber,
              violatedRule: 'VOCAL_FULL',
              impairedSlot: 'VOCAL_FULL',
              evidence: `Character '${speakerId}' spoke with full-voice delivery '${delivery}' on turn ${turnNumber} while VOCAL_FULL capability is impaired.`,
            })
          );
        } else if (isWhisperDelivery(delivery) && impaired.includes('VOCAL_WHISPER')) {
          receipts.push(
            VoiceViolationReceiptSchema.parse({
              characterId: speakerId,
              turnNumber,
              violatedRule: 'VOCAL_WHISPER',
              impairedSlot: 'VOCAL_WHISPER',
              evidence: `Character '${speakerId}' spoke with whisper delivery '${delivery}' on turn ${turnNumber} while VOCAL_WHISPER capability is impaired.`,
            })
          );
        }
      }
    }

    // ── Check 2: Acoustic Hearability Sets (Item 13: resolveAcousticAudience) ──
    if (input.topology && input.characterNodes) {
      const rawSource =
        block.acousticSourceNodeId ??
        block.sourceNodeId ??
        (speakerId ? getCharacterNode(speakerId) : undefined) ??
        block.nodeId;
      const sourceNodeId =
        typeof rawSource === 'string' && rawSource.trim() ? rawSource.trim() : undefined;

      let audibleAudience: string[] = [];
      if (sourceNodeId && !isInternal) {
        audibleAudience = resolveAcousticAudience(
          medium,
          input.topology,
          sourceNodeId,
          input.characterNodes,
          delivery
        );
      }

      if (speakerId && sourceNodeId) {
        recordedVocalizations.push({
          speakerId,
          sourceNodeId,
          medium,
          delivery,
          audibleAudience,
          blockIndex: i,
        });
      }

      const audibleSet = new Set(audibleAudience.map((id) => id.toLowerCase()));

      // 2a. Addressed Listeners on this block
      const candidateAddressed: unknown[] = [];
      if (block.addressedCharacterId) candidateAddressed.push(block.addressedCharacterId);
      if (block.addressedCharacter) candidateAddressed.push(block.addressedCharacter);
      if (block.addressedListenerId) candidateAddressed.push(block.addressedListenerId);
      if (block.addressedListener) candidateAddressed.push(block.addressedListener);
      if (block.addressedTo) candidateAddressed.push(block.addressedTo);
      if (block.listenerId) candidateAddressed.push(block.listenerId);
      if (block.listener) candidateAddressed.push(block.listener);
      if (block.targetCharacterId) candidateAddressed.push(block.targetCharacterId);
      if (block.targetCharacter) candidateAddressed.push(block.targetCharacter);
      if (Array.isArray(block.addressedListeners)) candidateAddressed.push(...block.addressedListeners);
      if (Array.isArray(block.addressedCharacters)) candidateAddressed.push(...block.addressedCharacters);
      if (Array.isArray(block.listeners)) candidateAddressed.push(...block.listeners);
      if (
        typeof block.target === 'string' &&
        !['addressed', 'cohort', 'self', 'broadcast', 'unseen'].includes(block.target.toLowerCase())
      ) {
        candidateAddressed.push(block.target);
      }

      for (const cand of candidateAddressed) {
        const listenerId = resolveCharacterId(cand);
        if (listenerId && listenerId !== speakerId) {
          if (!audibleSet.has(listenerId.toLowerCase())) {
            const listenerNode = getCharacterNode(listenerId) ?? 'unknown';
            receipts.push(
              VoiceViolationReceiptSchema.parse({
                characterId: listenerId,
                turnNumber,
                violatedRule: 'UNHEARABLE_AUDIENCE_ROUTING',
                impairedSlot: 'UNSPECIFIED',
                evidence: `Addressed listener '${listenerId}' at node '${listenerNode}' is outside acoustic audience for vocalization from '${
                  speakerId ?? 'unknown'
                }' at node '${sourceNodeId ?? 'unknown'}' on turn ${turnNumber}.`,
              })
            );
          }
        }
      }

      // 2b. Reacting Characters on this block
      const candidateReactors: unknown[] = [];
      if (block.reactingCharacterId) candidateReactors.push(block.reactingCharacterId);
      if (block.reactingCharacter) candidateReactors.push(block.reactingCharacter);
      if (block.reactorId) candidateReactors.push(block.reactorId);
      if (block.reactor) candidateReactors.push(block.reactor);
      if (block.reactionCharacterId) candidateReactors.push(block.reactionCharacterId);
      if (block.reactionCharacter) candidateReactors.push(block.reactionCharacter);
      if (Array.isArray(block.reactingCharacters)) candidateReactors.push(...block.reactingCharacters);
      if (Array.isArray(block.reactors)) candidateReactors.push(...block.reactors);
      if (Array.isArray(block.reactions)) {
        for (const rx of block.reactions) {
          if (typeof rx === 'string') candidateReactors.push(rx);
          else if (rx && typeof rx === 'object') {
            if (rx.characterId) candidateReactors.push(rx.characterId);
            else if (rx.speaker) candidateReactors.push(rx.speaker);
          }
        }
      }

      // If the block itself represents a reaction from its speaker to a prior vocalization
      const reactingTarget =
        block.reactingTo ||
        block.reactionTo ||
        block.inResponseTo ||
        block.replyingTo ||
        block.responseTo;

      if (reactingTarget && speakerId) {
        // speakerId is the reactor
        const targetSpeakerId = resolveCharacterId(reactingTarget);
        const matchingVoc = recordedVocalizations
          .slice(0, i)
          .reverse()
          .find((v) => !targetSpeakerId || v.speakerId.toLowerCase() === targetSpeakerId.toLowerCase());

        if (matchingVoc) {
          const vocAudibleSet = new Set(matchingVoc.audibleAudience.map((id) => id.toLowerCase()));
          if (!vocAudibleSet.has(speakerId.toLowerCase())) {
            const reactorNode = getCharacterNode(speakerId) ?? 'unknown';
            receipts.push(
              VoiceViolationReceiptSchema.parse({
                characterId: speakerId,
                turnNumber,
                violatedRule: 'UNHEARABLE_AUDIENCE_ROUTING',
                impairedSlot: 'UNSPECIFIED',
                evidence: `Reacting character '${speakerId}' at node '${reactorNode}' is outside acoustic audience for vocalization from '${matchingVoc.speakerId}' at node '${matchingVoc.sourceNodeId}' on turn ${turnNumber}.`,
              })
            );
          }
        }
      }

      for (const cand of candidateReactors) {
        const reactorId = resolveCharacterId(cand);
        if (reactorId && reactorId !== speakerId) {
          // If this block is a vocalization, check against this block's audible audience
          // If this block is prose without its own vocalization, check against the most recent recorded vocalization
          let vocAudible = audibleSet;
          let vocSource = sourceNodeId;
          let vocSpeaker = speakerId;

          if (!speakerId && recordedVocalizations.length > 0) {
            const lastVoc = recordedVocalizations[recordedVocalizations.length - 1];
            vocAudible = new Set(lastVoc.audibleAudience.map((id) => id.toLowerCase()));
            vocSource = lastVoc.sourceNodeId;
            vocSpeaker = lastVoc.speakerId;
          }

          if (!vocAudible.has(reactorId.toLowerCase())) {
            const reactorNode = getCharacterNode(reactorId) ?? 'unknown';
            receipts.push(
              VoiceViolationReceiptSchema.parse({
                characterId: reactorId,
                turnNumber,
                violatedRule: 'UNHEARABLE_AUDIENCE_ROUTING',
                impairedSlot: 'UNSPECIFIED',
                evidence: `Reacting character '${reactorId}' at node '${reactorNode}' is outside acoustic audience for vocalization from '${
                  vocSpeaker ?? 'unknown'
                }' at node '${vocSource ?? 'unknown'}' on turn ${turnNumber}.`,
              })
            );
          }
        }
      }
    }
  }

  // Deduplicate receipts
  const seenKeys = new Set<string>();
  const uniqueReceipts: VoiceViolationReceipt[] = [];
  for (const r of receipts) {
    const key = `${r.turnNumber}:${r.characterId}:${r.violatedRule}:${r.impairedSlot ?? ''}:${r.evidence}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueReceipts.push(r);
    }
  }

  // Sort deterministically by (turnNumber, characterId, violatedRule, impairedSlot, evidence)
  uniqueReceipts.sort((a, b) => {
    if (a.turnNumber !== b.turnNumber) {
      return a.turnNumber - b.turnNumber;
    }
    const cmpChar = a.characterId.localeCompare(b.characterId);
    if (cmpChar !== 0) {
      return cmpChar;
    }
    const cmpRule = a.violatedRule.localeCompare(b.violatedRule);
    if (cmpRule !== 0) {
      return cmpRule;
    }
    const slotA = a.impairedSlot ?? '';
    const slotB = b.impairedSlot ?? '';
    const cmpSlot = slotA.localeCompare(slotB);
    if (cmpSlot !== 0) {
      return cmpSlot;
    }
    return a.evidence.localeCompare(b.evidence);
  });

  return uniqueReceipts;
}
