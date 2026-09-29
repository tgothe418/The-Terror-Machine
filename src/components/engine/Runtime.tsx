/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Loader2,
  Eye,
  Shield,
  Skull,
  Coffee,
  Film,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  BookOpen,
  Sparkles,
  Settings,
} from 'lucide-react';
import TheVoice from '../hub/TheVoice';
import MapSketch from './MapSketch';
import MortalLedger from './MortalLedger';
import ScenarioDossier from './ScenarioDossier';
import AiCalibrationModal from '../hub/AiCalibrationModal';
import ChronicleModal from './ChronicleModal';
import { buildChronicle } from '../../lib/deathChronicle';
import { normalizeRoleCategory } from '../../types/participation';
import { useEngineStore } from '../../core/store';
import { useAppStore } from '../../store/useAppStore';
import { useHydratedStores } from '../../lib/sessionReconciliation';
import { motion, AnimatePresence } from 'motion/react';
import { NarrativeBlock, TurnReceipt } from '../../types';

/* eslint-disable @typescript-eslint/no-unused-vars */
// Helper to format blocks for plain text fallback
export const formatBlocks = (blocks?: NarrativeBlock[]): string => {
  if (!blocks || !Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      const speaker = block.speaker || undefined;
      const content = block.content !== undefined && block.content !== null ? String(block.content) : '';
      if (block.type === 'internal_monologue') {
        return `[THOUGHT // ${speaker || 'POV'}]: ${content}`;
      }
      if (block.type === 'soliloquy') {
        return `[MUTTERED // ${speaker || 'SELF'}]: ${content}`;
      }
      if (block.type === 'transmission') {
        return `[TRANSMISSION // ${speaker || 'INTERCOM'}]: ${content}`;
      }
      if (block.type === 'dialogue') {
        return `${speaker?.toUpperCase()}: ${content}`;
      }
      return content;
    })
    .join('\n\n');
};
import { exportEngineLog, exportChronicleProse } from '../../lib/download';
import { executeRatificationPipeline } from '../../lib/ratificationPipeline';
import { createEngineHistoryMessage, createTurnHistoryEvents } from '../../core/engine/turnHistory';
import type { CommittedTurnPayload } from '../../core/engine/events';
import {
  coordinateCanonicalTurnPublication,
  getCanonicalSimulationState,
  isTurnAttemptCurrent,
} from '../../core/engine/commitCoordinator';
import { toTurnFailureReceipt, TurnResponseError } from '../../lib/turnResponseReader';
import { validateHorrorGrammarTurnReceipts } from '../../lib/horrorGrammarTurnValidation';
import { fetchSimulatedPlayerAction, triggerMemoryForge, type AutopilotMode } from '../../services/geminiService';
import ErgodicTextRenderer from './ErgodicTextRenderer';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { captureRuntimeSnapshot } from '../../core/engine/snapshot';
import { projectPresentationPatch } from '../../core/engine/presentationProjection';
import { applyCastSkepticismDeltas, createCastContinuityReceipt } from '../../lib/castContinuity';
import { buildCharacterPresence, createCastPresenceReceipt } from '../../lib/castPresence';
import { createCastInteractionReceipt } from '../../lib/castInteraction';
import { createFallbackIntentReceipt } from '../../lib/intentReceipt';
import { createFallbackNarrativeReconciliationReceipt } from '../../lib/narrativeReconciliation';
import { createCharacterStanceState } from '../../lib/characterStance';
import { createCharacterRelationshipState } from '../../lib/characterRelationships';
import { createCharacterMemoryState } from '../../lib/characterMemory';
import { createWorldMemoryState } from '../../lib/worldMemory';
import type {
  CharacterContinuityById,
  CastContinuityReceipt,
  CharacterPresenceById,
  CastPresenceReceipt,
} from '../../types';

const SESSION_TIMEOUT = 60 * 60 * 1000; // 60 minutes
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
/**
 * Autopilot is a soak-test harness, not a burst-load generator.  Keep an
 * observable human-scale pause before every simulated action/turn attempt.
 */
export const AUTOPILOT_MINIMUM_TURN_INTERVAL_MS = 5000;

/**
 * The engine LogicState is a passthrough record at runtime (LogicStateSchema is
 * `.passthrough()`), so legacy keys that are not part of the canonical
 * `LogicState` interface are read defensively through this typed accessor and
 * narrowed with guards at the call site.
 */
function readLogicStateKey(state: unknown, key: string): unknown {
  if (typeof state !== 'object' || state === null) return undefined;
  return (state as Record<string, unknown>)[key];
}

import { Edit2, Check, X } from 'lucide-react';
import type { UITranscriptMessage } from '../../types';

type VocalizationDisplayKind =
  | 'internal_monologue'
  | 'soliloquy'
  | 'transmission'
  | 'dialogue'
  | 'prose';

interface ProcessedVocalizationBlock {
  kind: VocalizationDisplayKind;
  speaker: string;
  medium?: string;
  interrupted?: boolean;
  acousticSourceNodeId?: string;
  content: string;
}

function classifyNarrativeBlock(
  block: NarrativeBlock | Record<string, unknown>
): ProcessedVocalizationBlock {
  const type = String(block.type || '');
  const speaker = typeof block.speaker === 'string' && block.speaker ? block.speaker : '';
  const content = String(block.content || (block as any).text || '');
  const medium = (block as any).medium ? String((block as any).medium) : '';
  const delivery = (block as any).delivery ? String((block as any).delivery) : '';
  const target = (block as any).target ? String((block as any).target) : '';
  const interrupted = Boolean((block as any).interrupted);
  const acousticSourceNodeId =
    typeof (block as any).acousticSourceNodeId === 'string' && (block as any).acousticSourceNodeId
      ? String((block as any).acousticSourceNodeId)
      : undefined;

  if (type === 'internal_monologue') {
    return {
      kind: 'internal_monologue',
      speaker: speaker || 'POV',
      medium: 'internal',
      interrupted,
      content,
    };
  }

  if (
    type === 'transmission' ||
    medium === 'intercom' ||
    medium === 'acoustic_bleed' ||
    medium === 'port_observation' ||
    medium === 'radio'
  ) {
    const isAcousticBleed = medium === 'acoustic_bleed' || medium === 'port_observation';
    const fallbackSpeaker = isAcousticBleed ? 'ADJACENT' : medium === 'radio' ? 'RADIO' : 'INTERCOM';
    return {
      kind: 'transmission',
      speaker: speaker || fallbackSpeaker,
      medium: medium || 'intercom',
      interrupted,
      acousticSourceNodeId,
      content,
    };
  }

  if (type === 'soliloquy' || delivery === 'mutter' || target === 'self') {
    return {
      kind: 'soliloquy',
      speaker: speaker || 'SELF',
      medium: medium || 'direct',
      interrupted,
      content,
    };
  }

  if (type === 'dialogue') {
    return {
      kind: 'dialogue',
      speaker: speaker || 'SPEAKER',
      medium: medium || 'direct',
      interrupted,
      acousticSourceNodeId,
      content,
    };
  }

  return {
    kind: 'prose',
    speaker: '',
    interrupted,
    content,
  };
}

function parseLinesToBlocks(content: string): ProcessedVocalizationBlock[] {
  if (!content || !content.trim()) return [];

  const lines = content.split(/\n+/);
  const result: ProcessedVocalizationBlock[] = [];
  let currentProse: string[] = [];

  const flushProse = () => {
    if (currentProse.length > 0) {
      result.push({
        kind: 'prose',
        speaker: '',
        content: currentProse.join('\n'),
      });
      currentProse = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const thoughtMatch = trimmed.match(
      /^\[(?:THOUGHT|INTROSPECTION)\s*\/\/\s*([^\]]+)\]:?\s*([\s\S]*)$/i
    );
    if (thoughtMatch) {
      flushProse();
      result.push({
        kind: 'internal_monologue',
        speaker: thoughtMatch[1].trim(),
        content: thoughtMatch[2].trim(),
      });
      continue;
    }

    const transmissionMatch = trimmed.match(
      /^\[(?:TRANSMISSION|INTERCOM \/ ACOUSTIC BLEED|INTERCOM|RADIO|ACOUSTIC BLEED)\s*\/\/\s*([^\]]+)\]:?\s*([\s\S]*)$/i
    );
    if (transmissionMatch) {
      flushProse();
      result.push({
        kind: 'transmission',
        speaker: transmissionMatch[1].trim(),
        content: transmissionMatch[2].trim(),
      });
      continue;
    }

    const soliloquyMatch = trimmed.match(
      /^\[(?:MUTTERED|MUTTERED SOTTO VOCE|SOLILOQUY)\s*\/\/\s*([^\]]+)\]:?\s*([\s\S]*)$/i
    );
    if (soliloquyMatch) {
      flushProse();
      result.push({
        kind: 'soliloquy',
        speaker: soliloquyMatch[1].trim(),
        content: soliloquyMatch[2].trim(),
      });
      continue;
    }

    const dialogueBadgeMatch = trimmed.match(
      /^\[DIALOGUE\s*\/\/\s*([^\]]+)\]:?\s*([\s\S]*)$/i
    );
    if (dialogueBadgeMatch) {
      flushProse();
      result.push({
        kind: 'dialogue',
        speaker: dialogueBadgeMatch[1].trim(),
        content: dialogueBadgeMatch[2].trim(),
      });
      continue;
    }

    const dialogueLineMatch = trimmed.match(
      /^([A-Z][A-Z0-9_.\s\-']{1,30}):\s+([\s\S]+)$/
    );
    if (
      dialogueLineMatch &&
      !['NOTE', 'WARNING', 'DIRECTOR', 'NARRATIVE', 'SYSTEM'].includes(
        dialogueLineMatch[1].trim().toUpperCase()
      )
    ) {
      flushProse();
      result.push({
        kind: 'dialogue',
        speaker: dialogueLineMatch[1].trim(),
        content: dialogueLineMatch[2].trim(),
      });
      continue;
    }

    currentProse.push(trimmed);
  }

  flushProse();
  return result;
}

export const TranscriptMessageItem = ({
  msg,
  onEdit,
  onForceCosmetic,
  userCharName,
}: {
  msg: UITranscriptMessage;
  onEdit: (id: string, text: string) => void;
  onForceCosmetic: (id: string) => void;
  userCharName: string;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content);

  const handleSave = () => {
    onEdit(msg.id, editContent);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditContent(msg.content);
    setIsEditing(false);
  };

  const rawBlocks = (msg as any).blocks as NarrativeBlock[] | undefined;
  const blocks: ProcessedVocalizationBlock[] = useMemo(() => {
    if (!msg.isEdited && Array.isArray(rawBlocks) && rawBlocks.length > 0) {
      return rawBlocks.map(classifyNarrativeBlock);
    }
    return parseLinesToBlocks(msg.content);
  }, [rawBlocks, msg.content, msg.isEdited]);

  const isDirector = msg.role === 'director';
  const isSystem = msg.role === 'system';
  const isSingleBlock = !isDirector && !isSystem && blocks.length === 1 && blocks[0].kind !== 'prose';
  const singleBlock = isSingleBlock ? blocks[0] : null;

  const getBorderColor = () => {
    if (isDirector) return 'border-l-2 border-zinc-700 pl-4 sm:pl-6';
    if (isSystem) return 'border-l-2 border-red-900/50 pl-4 sm:pl-6 bg-red-950/20 py-3';

    if (singleBlock) {
      if (singleBlock.kind === 'internal_monologue') {
        return 'border-l-2 border-indigo-900/60 pl-4 sm:pl-6';
      }
      if (singleBlock.kind === 'soliloquy') {
        return 'border-l-2 border-dashed border-amber-800/80 pl-4 sm:pl-6';
      }
      if (singleBlock.kind === 'transmission') {
        if (singleBlock.medium === 'acoustic_bleed' || singleBlock.medium === 'port_observation') {
          return 'border-l-2 border-slate-700/80 bg-slate-950/40 pl-4 sm:pl-6';
        }
        return 'border-l-2 border-cyan-900/70 bg-cyan-950/10 pl-4 sm:pl-6';
      }
      if (singleBlock.kind === 'dialogue') {
        return 'border-l-2 border-[#d97706]/70 pl-4 sm:pl-6';
      }
    }

    if (msg.role === 'narrative') return 'border-l-2 border-zinc-800 pl-4 sm:pl-6';
    return 'border-l-2 border-zinc-800 pl-4 sm:pl-6';
  };

  const getHeader = () => {
    if (isDirector) return `[ DIRECTOR: ${userCharName} ]`;
    if (isSystem) return `[ SYSTEM DIRECTIVE ]`;

    if (singleBlock) {
      if (singleBlock.kind === 'internal_monologue') {
        return `[ INTROSPECTION // ${singleBlock.speaker} ]`;
      }
      if (singleBlock.kind === 'soliloquy') {
        return `[ MUTTERED SOTTO VOCE // ${singleBlock.speaker} ]`;
      }
      if (singleBlock.kind === 'transmission') {
        if (singleBlock.medium === 'acoustic_bleed' || singleBlock.medium === 'port_observation') {
          const prov = singleBlock.acousticSourceNodeId ? ` (via ${singleBlock.acousticSourceNodeId})` : '';
          return `[ ACOUSTIC BLEED // ${singleBlock.speaker}${prov} ]`;
        }
        if (singleBlock.medium === 'radio') {
          return `[ TRANSMISSION // RADIO // ${singleBlock.speaker} ]`;
        }
        return `[ INTERCOM / ACOUSTIC BLEED // ${singleBlock.speaker} ]`;
      }
      if (singleBlock.kind === 'dialogue') {
        return `[ DIALOGUE // ${singleBlock.speaker} ]`;
      }
    }

    if (msg.role === 'narrative') return `[ NARRATIVE ]`;
    return '';
  };

  const getHeaderColor = () => {
    if (isDirector) return 'text-zinc-400';
    if (isSystem) return 'text-red-400';

    if (singleBlock) {
      if (singleBlock.kind === 'internal_monologue') return 'text-indigo-400/90';
      if (singleBlock.kind === 'soliloquy') return 'text-amber-600/90';
      if (singleBlock.kind === 'transmission') {
        if (singleBlock.medium === 'acoustic_bleed' || singleBlock.medium === 'port_observation') {
          return 'text-slate-400 font-mono font-bold';
        }
        return 'text-cyan-400';
      }
      if (singleBlock.kind === 'dialogue') return 'text-[#d97706]';
    }

    return 'text-zinc-400';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`text-sm sm:text-base leading-relaxed whitespace-pre-wrap group relative ${getBorderColor()}`}
    >
      <div className="flex items-center gap-2.5 mb-2 flex-wrap">
        <span className={`text-xs uppercase tracking-widest font-mono font-bold ${getHeaderColor()}`}>
          {getHeader()}
        </span>
        {msg.isEdited && (
          <span className="text-xs uppercase tracking-widest text-zinc-500 font-mono italic">
            (Edited)
          </span>
        )}
        {msg.reconciliationStatus === 'pending' && (
          <span className="text-xs uppercase tracking-widest text-blue-400 font-mono border border-blue-900/50 px-1.5 py-0.5 rounded bg-blue-900/20 animate-pulse">
            Reconciling...
          </span>
        )}
        {msg.reconciliationStatus === 'synced' && (
          <span className="text-xs uppercase tracking-widest text-green-400 font-mono border border-green-900/50 px-1.5 py-0.5 rounded bg-green-900/20">
            Synced
          </span>
        )}
        {msg.reconciliationStatus === 'failed' && (
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-amber-400 font-mono border border-amber-900/50 px-1.5 py-0.5 rounded bg-amber-900/20">
              ⚠️ Sync Failed
            </span>
            <button
              onClick={() => onForceCosmetic(msg.id)}
              className="text-xs uppercase tracking-widest text-zinc-300 font-mono border border-zinc-700 px-2 py-0.5 rounded bg-zinc-900 hover:text-white transition-colors"
            >
              Force Accept as Cosmetic
            </button>
          </div>
        )}
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-zinc-500 hover:text-zinc-200 ml-auto"
            title="Edit Message"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2 mt-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full bg-zinc-950 text-gray-200 border border-zinc-700 p-3 text-sm font-mono rounded resize-y min-h-[120px] focus:outline-none focus:border-zinc-500"
          />
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={handleCancel}
              className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={handleSave}
              className="p-1.5 hover:bg-green-900/50 rounded text-green-400 transition-colors"
            >
              <Check className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : isDirector ? (
        <div className="text-zinc-200 italic">
          <ErgodicTextRenderer text={msg.content} psychologicalStatus="Stable" />
        </div>
      ) : isSystem ? (
        <div className="text-red-400 font-mono">
          <ErgodicTextRenderer text={msg.content} psychologicalStatus="Stable" />
        </div>
      ) : isSingleBlock && singleBlock ? (
        <div
          className={
            singleBlock.kind === 'internal_monologue'
              ? 'italic text-indigo-100/90'
              : singleBlock.kind === 'soliloquy'
              ? 'text-zinc-400'
              : singleBlock.kind === 'transmission'
              ? singleBlock.medium === 'acoustic_bleed' || singleBlock.medium === 'port_observation'
                ? 'font-mono text-slate-300 text-sm'
                : 'font-mono text-cyan-200/90 text-sm'
              : singleBlock.kind === 'dialogue'
              ? `text-[#e6e4dc] ${singleBlock.interrupted ? 'italic text-amber-200/90' : ''}`
              : 'text-zinc-200'
          }
        >
          {singleBlock.kind === 'transmission' &&
            (singleBlock.medium === 'radio' || singleBlock.medium === 'intercom') &&
            !singleBlock.content.includes('[CHIRP]') && (
              <span className="text-cyan-500/70 select-none mr-1 font-bold">&gt; [CHIRP] </span>
            )}
          <ErgodicTextRenderer text={singleBlock.content} psychologicalStatus="Stable" />
          {singleBlock.kind === 'transmission' &&
            (singleBlock.medium === 'radio' || singleBlock.medium === 'intercom') &&
            !singleBlock.content.includes('[CHIRP]') && (
              <span className="text-cyan-500/70 select-none ml-1 font-bold"> [STATIC]</span>
            )}
        </div>
      ) : blocks.length > 0 ? (
        <div className="space-y-4">
          {blocks.map((block, idx) => {
            if (block.kind === 'internal_monologue') {
              return (
                <div
                  key={idx}
                  className="border-l-2 border-indigo-900/60 pl-4 py-2 bg-indigo-950/10 rounded-r my-2"
                >
                  <div className="text-xs uppercase tracking-widest text-indigo-400/90 font-mono font-bold mb-1.5">
                    [ INTROSPECTION // {block.speaker} ]
                  </div>
                  <div className="italic text-indigo-100/90">
                    <ErgodicTextRenderer text={block.content} psychologicalStatus="Stable" />
                  </div>
                </div>
              );
            }
            if (block.kind === 'soliloquy') {
              return (
                <div
                  key={idx}
                  className="border-l-2 border-dashed border-amber-800/80 pl-4 py-2 bg-amber-950/5 rounded-r my-2"
                >
                  <div className="text-xs uppercase tracking-widest text-amber-600/90 font-mono font-bold mb-1.5">
                    [ MUTTERED SOTTO VOCE // {block.speaker} ]
                  </div>
                  <div className="text-zinc-400">
                    <ErgodicTextRenderer text={block.content} psychologicalStatus="Stable" />
                  </div>
                </div>
              );
            }
            if (block.kind === 'transmission') {
              const isAcoustic =
                block.medium === 'acoustic_bleed' || block.medium === 'port_observation';
              const prov = block.acousticSourceNodeId
                ? ` (via ${block.acousticSourceNodeId})`
                : '';
              const headerText = isAcoustic
                ? `[ ACOUSTIC BLEED // ${block.speaker}${prov} ]`
                : block.medium === 'radio'
                ? `[ TRANSMISSION // RADIO // ${block.speaker} ]`
                : `[ INTERCOM / ACOUSTIC BLEED // ${block.speaker} ]`;

              const showSquelch =
                !isAcoustic &&
                (block.medium === 'radio' || block.medium === 'intercom') &&
                !block.content.includes('[CHIRP]');

              return (
                <div
                  key={idx}
                  className={
                    isAcoustic
                      ? 'border-l-2 border-slate-700/80 bg-slate-950/40 pl-4 py-2.5 rounded-r font-mono my-2'
                      : 'border-l-2 border-cyan-900/70 bg-cyan-950/10 pl-4 py-2.5 rounded-r font-mono my-2'
                  }
                >
                  <div
                    className={
                      isAcoustic
                        ? 'text-xs uppercase tracking-widest text-slate-400 font-mono font-bold mb-1.5'
                        : 'text-xs uppercase tracking-widest text-cyan-400 font-mono font-bold mb-1.5'
                    }
                  >
                    {headerText}
                  </div>
                  <div
                    className={
                      isAcoustic
                        ? 'text-slate-300 font-mono text-sm'
                        : 'text-cyan-200/90 font-mono text-sm'
                    }
                  >
                    {showSquelch && (
                      <span className="text-cyan-500/70 select-none mr-1 font-bold">&gt; [CHIRP] </span>
                    )}
                    <ErgodicTextRenderer text={block.content} psychologicalStatus="Stable" />
                    {showSquelch && (
                      <span className="text-cyan-500/70 select-none ml-1 font-bold"> [STATIC]</span>
                    )}
                  </div>
                </div>
              );
            }
            if (block.kind === 'dialogue') {
              const isInterrupted = block.interrupted || block.content.endsWith('—');
              return (
                <div
                  key={idx}
                  className="border-l-2 border-[#d97706]/70 pl-4 py-2 bg-amber-950/5 rounded-r my-2"
                >
                  <div className="text-xs uppercase tracking-widest text-[#d97706] font-mono font-bold mb-1.5">
                    [ DIALOGUE // {block.speaker} ]
                  </div>
                  <div className={`text-[#e6e4dc] ${isInterrupted ? 'italic text-amber-200/90' : ''}`}>
                    <ErgodicTextRenderer text={block.content} psychologicalStatus="Stable" />
                  </div>
                </div>
              );
            }
            return (
              <div key={idx} className="text-zinc-200 my-1">
                <ErgodicTextRenderer text={block.content} psychologicalStatus="Stable" />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-zinc-200">
          <ErgodicTextRenderer text={msg.content} psychologicalStatus="Stable" />
        </div>
      )}

      {msg.systemLogic && msg.systemLogic.length > 0 && (
        <details className="mt-4 text-xs text-amber-500/70 border border-zinc-900 rounded opacity-70 hover:opacity-100 transition-opacity">
          <summary className="cursor-pointer p-2 bg-zinc-950 font-mono uppercase tracking-[0.2em] outline-none font-bold">
            ⚙️ SYSTEM INTERVENTION
          </summary>
          <div className="p-3 bg-black border-t border-zinc-900 space-y-2">
            {msg.systemLogic.map((logic, idx) => (
              <div
                key={idx}
                className="font-mono bg-black/50 p-2 rounded flex flex-col gap-1 text-[10px]"
              >
                <div className="flex gap-2">
                  <span className="text-zinc-500">TYPE:</span>
                  <span className="text-amber-400">{logic.type}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">TRIGGER:</span>
                  <span className="text-amber-400">{logic.trigger}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-zinc-500">MUTATION:</span>
                  <span className="text-amber-300 whitespace-pre-wrap">{logic.mutation}</span>
                </div>
                {logic.directive_injected !== undefined && (
                  <div className="flex gap-2">
                    <span className="text-zinc-500">INJECTED:</span>
                    <span className="text-amber-400">
                      {logic.directive_injected ? 'TRUE' : 'FALSE'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </motion.div>
  );
};

export default function Runtime() {
  const activeBlueprint = useEngineStore((state) => state.activeBlueprint);
  const gameState = useEngineStore((state) => state.gameState);
  const updateGameState = useEngineStore((state) => state.updateGameState);
  const engineMessages = useAppStore((state) => state.history);
  const uiTranscript = useAppStore((state) => state.uiTranscript);
  const editTranscriptMessage = useAppStore((state) => state.editTranscriptMessage);
  const forceAcceptCosmetic = useAppStore((state) => state.forceAcceptCosmetic);
  const dispatch = useAppStore((state) => state.dispatch);
  const appPhase = useAppStore((state) => state.phase);

  const setPhase = useAppStore((state) => state.setPhase);
  const telemetry = useEngineStore((state) => state.telemetry);
  const playerRole = useEngineStore((state) => state.gameState?.player_role);
  const participationContext = useAppStore((state) => state.participationContext);
  const effectiveCategory = normalizeRoleCategory(participationContext?.mode || playerRole);
  const turnCount = useAppStore((state) => state.turnCount);
  const currentSimulationPhase = useTelemetryStore((state) => state.currentPhase);
  const lastTurnCheckpoint = useAppStore((state) => state.lastTurnCheckpoint);
  const retakeLastTurn = useAppStore((state) => state.retakeLastTurn);
  const resetSession = useAppStore((state) => state.resetSession);
  const sessionId = useAppStore((state) => state.sessionId);
  const blueprintId = useAppStore((state) => state.blueprintId);
  const deathRecords = useAppStore((state) => state.deathRecords);
  const nodeEvidence = useAppStore((state) => state.nodeEvidence);
  const castPlacement = useAppStore((state) => state.castPlacement);
  const cohortState = useAppStore((state) => state.cohortState);
  const [dismissedChronicleTurnCount, setDismissedChronicleTurnCount] = useState<number | null>(null);
  const isChronicleOpen = appPhase === 'TERMINATED' && dismissedChronicleTurnCount !== turnCount;

  const chronicle = useMemo(() => {
    if (!deathRecords || deathRecords.length === 0) return null;
    const allEvidence: string[] = [];
    Object.values(nodeEvidence || {}).forEach((items) => {
      items.forEach((item) => {
        if (item.text) allEvidence.push(item.text);
      });
    });

    return buildChronicle({
      scenarioTitle: activeBlueprint?.title || activeBlueprint?.identity?.title || 'Scenario',
      turnCount: turnCount || 0,
      fictionalSeconds: (turnCount || 0) * 60,
      deathRecords,
      phaseHistory: cohortState?.peakPhase ? [cohortState.peakPhase] : ['ONSET'],
      evidence: allEvidence,
      cast: (activeBlueprint?.cast as Array<{ id: string; name?: string; starting_location?: string; locationNodeId?: string }>) || [],
      castPlacement: castPlacement || undefined,
    });
  }, [activeBlueprint, deathRecords, nodeEvidence, turnCount, cohortState, castPlacement]);

  const prevPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevPhaseRef.current && prevPhaseRef.current !== currentSimulationPhase) {
      if (
        (prevPhaseRef.current === 'LATENT' && currentSimulationPhase === 'MANIFEST') ||
        (prevPhaseRef.current === 'MANIFEST' && currentSimulationPhase === 'TERMINAL')
      ) {
        const messagesToDistill = engineMessages.length > 3 ? engineMessages.slice(1, -2) : [];
        const textToDistill = messagesToDistill.map((m) => `${m.role}: ${m.content}`).join('\n');

        const currentRevision = useAppStore.getState().timelineRevision;
        triggerMemoryForge(
          textToDistill || 'The void shifts, remembering nothing.',
          currentRevision
        );
      }
    }
    prevPhaseRef.current = currentSimulationPhase;
  }, [currentSimulationPhase, engineMessages]);

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inFlightInput, setInFlightInput] = useState<{
    text: string;
    category: string;
    timestamp: number;
  } | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastActivity, setLastActivity] = useState<number>(() => Date.now());
  const { isHydrated, isCoherent } = useHydratedStores();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [isHgForensicsOpen, setIsHgForensicsOpen] = useState(true);
  const [isTerminated, setIsTerminated] = useState(false);
  const [terminalResolution, setTerminalResolution] = useState<string | null>(null);
  const [isLeftWingOpen, setIsLeftWingOpen] = useState(true);
  const [isRightWingOpen, setIsRightWingOpen] = useState(true);
  const [rightWingTab, setRightWingTab] = useState<'historian' | 'dossier'>('historian');
  const [isAuthorityModalOpen, setIsAuthorityModalOpen] = useState(false);
  const [isAiCalibrationOpen, setIsAiCalibrationOpen] = useState(false);

  // Hoisted accessors so the memo dependency lists stay statically analyzable.
  const topology = activeBlueprint?.topology;
  const startingNodeId = topology?.startingNodeId;
  const rawCurrentNodeId = readLogicStateKey(gameState, 'current_node_id');
  const playerPresenceNodeId =
    gameState?.player_character_id != null
      ? gameState?.character_presence?.[String(gameState.player_character_id)]?.nodeId
      : undefined;
  const legacyNodeId =
    typeof rawCurrentNodeId === 'string' && rawCurrentNodeId ? rawCurrentNodeId : null;
  const presenceNodeId =
    typeof playerPresenceNodeId === 'string' && playerPresenceNodeId ? playerPresenceNodeId : null;
  const currentNodeId = legacyNodeId ?? presenceNodeId;

  // Compute visited nodes from history + current node + starting node for Fog of War
  const visitedNodeIds = React.useMemo(() => {
    const visited = new Set<string>();
    if (currentNodeId) {
      visited.add(currentNodeId);
    }
    if (startingNodeId) {
      visited.add(startingNodeId);
    }
    engineMessages.forEach((msg) => {
      if (msg.turnReceipt?.nodeBefore) visited.add(msg.turnReceipt.nodeBefore);
      if (msg.turnReceipt?.nodeAfter) visited.add(msg.turnReceipt.nodeAfter);
    });
    return visited;
  }, [currentNodeId, startingNodeId, engineMessages]);

  // Compute node definitions for MapSketch
  const nodeDefinitions = React.useMemo(() => {
    if (!topology) return [];
    if (topology.nodeDefinitions && topology.nodeDefinitions.length > 0) {
      return topology.nodeDefinitions.map((n) => ({
        id: n.id,
        label: n.label || (n as any).name || n.id,
        description: n.description,
      }));
    }
    if (topology.nodes && topology.nodes.length > 0) {
      return topology.nodes.map((id) => ({
        id,
        label: id.replace(/_/g, ' '),
        description: undefined,
      }));
    }
    return [];
  }, [topology]);

  // Compute connections for MapSketch
  const topologyConnections = React.useMemo(() => {
    return activeBlueprint?.topology?.connections || [];
  }, [activeBlueprint?.topology?.connections]);

  // Compute cohort members for MortalLedger
  const cohortCastMembers = React.useMemo(() => {
    const dramaturgyStakes = gameState?.dramaturgy_state?.characterStakes;
    return (activeBlueprint?.cast || []).map((c) => {
      const presence = gameState?.character_presence?.[c.id];
      const continuity = gameState?.character_continuity?.[c.id];
      const ledgerEntry = telemetry?.castLedger?.find(
        (l: any) => l.character_id === c.id || l.character_name === c.name
      );
      const stakes = dramaturgyStakes?.[c.id] || (c as any).psychologicalStakes;
      return {
        id: c.id,
        name: c.name,
        role: c.role,
        location: presence?.nodeId || ledgerEntry?.current_location || 'Co-present',
        psychological_status:
          ledgerEntry?.psychological_status || (c as any).psychological_status || 'Composed',
        skepticism: typeof continuity?.skepticism === 'number' ? continuity.skepticism : undefined,
        isCurrentPlayer: c.id === gameState?.player_character_id,
        isObstructed: stakes?.isObstructed ?? false,
        obstructionReason: stakes?.obstructionReason,
        currentComposure: stakes?.currentComposure,
      };
    });
  }, [
    activeBlueprint?.cast,
    gameState?.character_presence,
    gameState?.character_continuity,
    gameState?.player_character_id,
    gameState?.dramaturgy_state,
    telemetry?.castLedger,
  ]);

  const latestForensicRecord = React.useMemo(() => {
    for (let i = engineMessages.length - 1; i >= 0; i--) {
      const msg = engineMessages[i];
      if (msg.turnReceipt?.horrorGrammarForensics) {
        return msg.turnReceipt.horrorGrammarForensics;
      }
    }
    return null;
  }, [engineMessages]);

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      const targetNode = nodeDefinitions.find((n) => n.id === nodeId);
      const targetName = targetNode?.label || nodeId;
      setInput(`Advance toward ${targetName} and investigate...`);
      inputRef.current?.focus();

      // INVARIANT: Do NOT force activeCategory = 'ACTION'.
      // effectiveCategory must remain derived from participation mode / player role.
    },
    [nodeDefinitions]
  );

  const systemFlags = useAppStore((state) => state.activeMemory.systemFlags);

  // terminal conditions check
  useEffect(() => {
    if (!systemFlags || systemFlags.length === 0 || isTerminated) return;

    const tc = activeBlueprint?.terminalConditions;
    if (!tc) return;

    let resolved = false;
    let resolutionText = '';

    // Evaluate the flag and pull the hardcoded resolution text
    if (systemFlags.includes('SOMATIC_TERMINAL')) {
      resolved = true;
      resolutionText = tc.somaticTerminal.narrativeResolution;
    } else if (systemFlags.includes('NARRATIVE_CONVERGENCE')) {
      resolved = true;
      resolutionText = tc.narrativeConvergence.resolutionSequence;
    } else if (systemFlags.includes('COGNITIVE_COLLAPSE')) {
      resolved = true;
      resolutionText = tc.cognitiveCollapse.collapseResolution;
    }

    if (resolved) {
      queueMicrotask(() => {
        setIsTerminated(true);
        setTerminalResolution(resolutionText);
        dispatch({
          type: 'SYSTEM_MESSAGE',
          payload: `[ TERMINAL CONDITION REACHED ]\n\n${resolutionText}`,
        });
      });
      console.log('// SIMULATION HALTED: TERMINAL CONDITION MET //');
    }
  }, [systemFlags, activeBlueprint?.terminalConditions, isTerminated, dispatch]);

  // Tab key shortcuts toggle between The Historian and Scenario Dossier
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setIsRightWingOpen(true);
        setRightWingTab((prev) => (prev === 'historian' ? 'dossier' : 'historian'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [autopilotTarget, setAutopilotTarget] = useState<number>(5);
  const [autopilotMode, setAutopilotMode] = useState<AutopilotMode>('standard');
  const [isAutopilotRunning, setIsAutopilotRunning] = useState<boolean>(false);
  const autopilotRef = useRef<boolean>(false); // Ref for immediate abort checking
  const autopilotRunIdRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      // Invalidate a pending cadence timer if the runtime is unmounted or reloaded.
      autopilotRef.current = false;
      autopilotRunIdRef.current += 1;
    };
  }, []);

  const currentSessionId = useAppStore((state) => state.sessionId);
  const currentBlueprintId = useAppStore((state) => state.blueprintId);
  const prevSessionIdentityRef = useRef({
    sessionId: currentSessionId,
    blueprintId: currentBlueprintId,
    turnCount,
  });

  useEffect(() => {
    const isSessionReplaced =
      prevSessionIdentityRef.current.sessionId !== currentSessionId ||
      prevSessionIdentityRef.current.blueprintId !== currentBlueprintId;
    const isRetaken = turnCount < prevSessionIdentityRef.current.turnCount;

    if (isSessionReplaced || isRetaken) {
      setIsLoading(false);
      autopilotRef.current = false;
      autopilotRunIdRef.current += 1;
      setIsAutopilotRunning(false);
    }

    prevSessionIdentityRef.current = {
      sessionId: currentSessionId,
      blueprintId: currentBlueprintId,
      turnCount,
    };
  }, [currentSessionId, currentBlueprintId, turnCount]);

  const userCharName = gameState?.player_character_id
    ? activeBlueprint?.cast?.find((c) => c.id === gameState.player_character_id)?.name ||
      'Protagonist'
    : gameState?.perspective_mode
      ? gameState.perspective_mode.toUpperCase()
      : 'UNKNOWN';

  const handleExit = useCallback(() => {
    autopilotRef.current = false;
    autopilotRunIdRef.current += 1;
    setIsAutopilotRunning(false);
    // DO NOT clearBlueprint() - maintain session until explicit wipe
    setPhase('hub');
  }, [setPhase]);

  const handleRetake = useCallback(() => {
    if (!lastTurnCheckpoint) return;
    autopilotRef.current = false;
    autopilotRunIdRef.current += 1;
    setIsAutopilotRunning(false);
    setIsLoading(false);

    const previousCommand = lastTurnCheckpoint.commandText;
    const success = retakeLastTurn();
    if (success) {
      setDismissedChronicleTurnCount(null);
      setInput(previousCommand);
      setIsTerminated(false);
      setTerminalResolution(null);
    }
  }, [lastTurnCheckpoint, retakeLastTurn]);

  const startSimulation = useCallback(async () => {
    setIsLoading(true);
    const canonicalPreState = getCanonicalSimulationState();
    const preSnapshot = captureRuntimeSnapshot(canonicalPreState.app);
    let isObsolete = false;

    try {
      const data = await executeRatificationPipeline('SYSTEM_INIT', preSnapshot);

      const currentAppState = useAppStore.getState();
      if (!isTurnAttemptCurrent(currentAppState, preSnapshot)) {
        isObsolete = true;
        console.warn('[Runtime] Ignoring obsolete SYSTEM_INIT response: attempt no longer current', {
          attemptSessionId: preSnapshot.sessionId,
          currentSessionId: currentAppState.sessionId,
          attemptRevision: preSnapshot.canonicalRevision,
          currentRevision: currentAppState.canonicalRevision,
        });
        return;
      }

      // Check if opening narration has already been accepted in current session to prevent duplicates
      const hasOpeningAlready = (currentAppState.history || []).some(
        (msg) =>
          (msg.role === 'assistant' || msg.role === 'narrative') &&
          !msg.content?.startsWith('[CRITICAL ENGINE FAILURE]') &&
          !msg.content?.startsWith('[TURN_FAILED]') &&
          (msg.blocks?.length || msg.content?.trim().length)
      );
      if (hasOpeningAlready) {
        console.warn('[Runtime] Opening narration already accepted; skipping duplicate INIT dispatch');
        return;
      }

      const formattedText = formatBlocks(data.narrative_blocks);
      dispatch({
        type: 'ADD_MESSAGE',
        message: createEngineHistoryMessage(formattedText, data),
      });
    } catch (err: any) {
      const currentAppState = useAppStore.getState();
      if (!isTurnAttemptCurrent(currentAppState, preSnapshot)) {
        isObsolete = true;
        console.warn('[Runtime] Ignoring obsolete SYSTEM_INIT error: attempt no longer current', err);
        return;
      }

      console.error(err);
      dispatch({
        type: 'ADD_MESSAGE',
        message: {
          role: 'assistant',
          content: `[CRITICAL ENGINE FAILURE]: ${err.message}. The house refused to open.`,
          timestamp: Date.now(),
        },
      });
    } finally {
      if (!isObsolete) {
        setIsLoading(false);
      }
    }
  }, [dispatch]);

  // Monitor for idle timeout
  useEffect(() => {
    const checkIdle = setInterval(() => {
      const idleTime = Date.now() - lastActivity;
      if (idleTime > SESSION_TIMEOUT) {
        dispatch({
          type: 'ADD_MESSAGE',
          message: {
            role: 'assistant',
            content:
              '[ SYSTEM: NEURAL LINK SEVERED DUE TO PROLONGED INACTIVITY. RETURNING TO HUB. ]',
            timestamp: Date.now(),
          },
        });
        setTimeout(() => handleExit(), 3000);
      }
    }, 10000);

    return () => clearInterval(checkIdle);
  }, [lastActivity, dispatch, handleExit]);

  // Keep-alive heartbeat (visual only to reassure user)
  useEffect(() => {
    const heartbeat = setInterval(() => {
      console.debug('[ THE ENGINE ]: Neural Link Pulse Confirmed');
    }, HEARTBEAT_INTERVAL);
    return () => clearInterval(heartbeat);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [engineMessages, isLoading]);

  // Note: Activity timestamp is updated via event handlers to avoid cascading renders

  // Initial simulation start
  const lastStartedSessionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isHydrated || !isCoherent) return;
    const currentSessionKey = `${sessionId || ''}:${blueprintId || ''}`;
    // Only fire if the log is empty AND this session/blueprint hasn't started yet AND an active blueprint exists
    if (
      engineMessages.length === 0 &&
      lastStartedSessionKeyRef.current !== currentSessionKey &&
      activeBlueprint
    ) {
      lastStartedSessionKeyRef.current = currentSessionKey;
      startSimulation();
    }
  }, [isHydrated, isCoherent, engineMessages.length, startSimulation, activeBlueprint, sessionId, blueprintId]);

  const handleCommand = async (
    e?: React.FormEvent,
    overrideInput?: string
  ): Promise<'COMMITTED' | 'REFUSED' | 'FAILED' | 'IGNORED'> => {
    e?.preventDefault();
    if (!isHydrated || !isCoherent) return 'IGNORED';
    const commandText = overrideInput || input;
    if (!commandText.trim() || isLoading) return 'IGNORED';

    const currentCategory = effectiveCategory || 'ACTION';
    setInFlightInput({
      text: commandText,
      category: currentCategory,
      timestamp: Date.now(),
    });

    if (!overrideInput) setInput('');
    setIsLoading(true);

    const canonicalPreState = getCanonicalSimulationState();
    const preSnapshot = captureRuntimeSnapshot(canonicalPreState.app);
    const engineGameStateBefore = canonicalPreState.gameState
      ? JSON.parse(JSON.stringify(canonicalPreState.gameState))
      : null;

    let isObsolete = false;

    try {
      const response = await executeRatificationPipeline(commandText, preSnapshot, {
        onToken: (token) => {
          setStreamingText((prev) => (prev ? prev + token : token));
        },
      });

      // Check attempt currentness before validating, preparing payload, or mutating stores
      const currentAppState = useAppStore.getState();
      if (!isTurnAttemptCurrent(currentAppState, preSnapshot)) {
        isObsolete = true;
        console.warn('[Runtime] Ignoring obsolete turn response: attempt no longer current', {
          attemptSessionId: preSnapshot.sessionId,
          currentSessionId: currentAppState.sessionId,
          attemptRevision: preSnapshot.canonicalRevision,
          currentRevision: currentAppState.canonicalRevision,
          attemptTurnCount: preSnapshot.turnCount,
          currentTurnCount: currentAppState.turnCount,
        });
        return 'IGNORED';
      }

      if (
        !response ||
        !response.characterMemoryReceipt ||
        typeof response.characterMemoryReceipt !== 'object' ||
        !response.characterMemoryReceipt.post_state ||
        typeof response.characterMemoryReceipt.post_state !== 'object' ||
        !response.worldMemoryReceipt ||
        typeof response.worldMemoryReceipt !== 'object' ||
        !Array.isArray(response.worldMemoryReceipt.post_state)
      ) {
        throw new Error('Malformed turn response: missing required characterMemoryReceipt or worldMemoryReceipt');
      }

      const formattedText = formatBlocks(response.narrative_blocks);

      const effectiveCurrentNode = preSnapshot.currentNodeId;
      const effectiveTurnNumber = preSnapshot.turnCount + 1;

      const transitionReceipt = response.transitionReceipt || {
        requestedNodeId: response.logic_state.requested_transition || null,
        accepted: false,
        fromNodeId: effectiveCurrentNode,
        toNodeId: effectiveCurrentNode,
        reason: 'NO_RECEIPT_ATTACHED',
      };

      const postTurnNodeId =
        transitionReceipt.accepted && transitionReceipt.toNodeId
          ? transitionReceipt.toNodeId
          : effectiveCurrentNode;

      const latestEngineState = useEngineStore.getState();
      const baseGameState =
        engineGameStateBefore || latestEngineState.gameState || ({} as typeof latestEngineState.gameState);
      let nextCharacterContinuity: CharacterContinuityById | null = null;
      let castContinuityReceipt: CastContinuityReceipt;
      let nextCharacterPresence: CharacterPresenceById | null = null;
      let castPresenceReceipt: CastPresenceReceipt;

      if (activeBlueprint) {
        nextCharacterContinuity = applyCastSkepticismDeltas(
          activeBlueprint.cast || [],
          baseGameState.character_continuity,
          response.logic_state.cast_deltas,
        );
        castContinuityReceipt = createCastContinuityReceipt(
          nextCharacterContinuity,
          response.logic_state.cast_deltas,
        );

        const runtimeSpatialGraph = useAppStore.getState().spatialGraph || [];
        const runtimeNodeIds = runtimeSpatialGraph
          .map((node) => node.id)
          .filter(
            (id): id is string =>
              typeof id === 'string' && id.trim().length > 0,
          )
          .map((id) => id.trim());

        const blueprintNodes = activeBlueprint.topology?.nodes || [];
        const validNodeIds = runtimeNodeIds.length > 0 ? runtimeNodeIds : blueprintNodes;

        const presenceUpdates: Record<string, string | null> = {};
        const castArrivals = readLogicStateKey(response.logic_state, 'cast_arrivals');
        if (Array.isArray(castArrivals)) {
          for (const arrivingId of castArrivals) {
            if (typeof arrivingId === 'string' && arrivingId.trim().length > 0) {
              presenceUpdates[arrivingId.trim()] = postTurnNodeId;
            }
          }
        }
        const castDepartures = readLogicStateKey(response.logic_state, 'cast_departures');
        if (Array.isArray(castDepartures)) {
          for (const departingId of castDepartures) {
            if (typeof departingId === 'string' && departingId.trim().length > 0) {
              presenceUpdates[departingId.trim()] = null;
            }
          }
        }

        nextCharacterPresence = buildCharacterPresence(
          activeBlueprint.cast || [],
          baseGameState.character_presence,
          validNodeIds,
          postTurnNodeId,
          baseGameState.player_character_id,
          presenceUpdates,
        );
        castPresenceReceipt = createCastPresenceReceipt(nextCharacterPresence);
      } else {
        castContinuityReceipt = createCastContinuityReceipt(
          baseGameState.character_continuity || {},
          [],
        );
        castPresenceReceipt = createCastPresenceReceipt(
          baseGameState.character_presence || {},
        );
      }

      const turnReceipt: TurnReceipt = {
        turnNumber: effectiveTurnNumber,
        nodeBefore: effectiveCurrentNode,
        requestedTarget: response.logic_state.requested_transition || null,
        accepted: transitionReceipt.accepted,
        reason: transitionReceipt.reason,
        nodeAfter: postTurnNodeId,
        activeVector: preSnapshot.activeVector,
        activeTier: preSnapshot.activeTier,
        tension:
          typeof response.logic_state.suggested_tension === 'number'
            ? response.logic_state.suggested_tension
            : preSnapshot.tension,
        preSnapshot,
        castContinuityReceipt,
        castPresenceReceipt,
        castInteractionReceipt:
          response.castInteractionReceipt ||
          createCastInteractionReceipt({}),
        intentReceipt:
          response.intentReceipt ||
          createFallbackIntentReceipt(),
        narrativeReconciliationReceipt:
          response.narrativeReconciliationReceipt ||
          createFallbackNarrativeReconciliationReceipt(),
        canonicalConsequenceReceipt: response.canonicalConsequenceReceipt,
        characterStanceReceipt: response.characterStanceReceipt,
        characterRelationshipReceipt: response.characterRelationshipReceipt,
        characterMemoryReceipt: response.characterMemoryReceipt,
        worldMemoryReceipt: response.worldMemoryReceipt,
        fictionalTimeReceipt: response.fictionalTimeReceipt,
        castActivityReceipt: response.castActivityReceipt,
        pursuitScheduleReceipt: response.pursuitScheduleReceipt,
        castActivityProposalReceipt: response.castActivityProposalReceipt,
        situatedPressureReceipt: response.situatedPressureReceipt,
        valueStateReceipt: response.valueStateReceipt,
        characterPursuitReceipt: response.characterPursuitReceipt,
        characterDevelopmentReceipt: response.characterDevelopmentReceipt,
        pressureThreadTransitionReceipt: response.pressureThreadTransitionReceipt,
        horrorGrammarForensics: response.horrorGrammarForensics,
        dramaticTurnReceipt: response.dramaticTurnReceipt,
      };

      const committedTurnPayload: CommittedTurnPayload = {
        commandText,
        formattedText,
        frame: response,
        transitionReceipt,
        turnReceipt,
        preSnapshot,
        engineGameStateBefore,
      };

      // 1. Validate complete HG1 receipt chain before publication
      const hgValidation = validateHorrorGrammarTurnReceipts(engineGameStateBefore, response);
      if (!hgValidation.isValid) {
        console.error(
          '[Runtime] HG1 receipt chain validation failed:',
          hgValidation.errorCode,
          hgValidation.reason
        );
        throw new TurnResponseError({
          code: 'MODEL_CONTRACT_MISMATCH',
          message: hgValidation.reason,
        });
      }

      // 2. Prepare complete situated game state covering all canonical receipt domains
      const preparedGameState = {
        ...baseGameState,
        ...(response.canonicalConsequenceReceipt
          ? {
              inventory: [...response.canonicalConsequenceReceipt.post_state.inventory],
              player_injuries: [...response.canonicalConsequenceReceipt.post_state.player_injuries],
              psychological_status:
                response.canonicalConsequenceReceipt.post_state.psychological_status,
            }
          : {}),
        ...(response.characterStanceReceipt
          ? {
              character_stance: createCharacterStanceState(
                response.characterStanceReceipt.post_state
              ),
            }
          : {}),
        ...(response.characterRelationshipReceipt
          ? {
              character_relationships: createCharacterRelationshipState(
                response.characterRelationshipReceipt.post_state
              ),
            }
          : {}),
        ...(response.characterMemoryReceipt
          ? {
              character_memory: createCharacterMemoryState(
                response.characterMemoryReceipt.post_state
              ),
            }
          : {}),
        world_memory: createWorldMemoryState(response.worldMemoryReceipt.post_state),
        ...hgValidation.postState,
        ...(response.logic_state?.dramaturgyState
          ? { dramaturgy_state: response.logic_state.dramaturgyState }
          : {}),
        ...(response.dramaticTurnReceipt
          ? { dramatic_turn_receipt: response.dramaticTurnReceipt }
          : {}),
        ...(nextCharacterContinuity ? { character_continuity: nextCharacterContinuity } : {}),
        ...(nextCharacterPresence ? { character_presence: nextCharacterPresence } : {}),
        ...(postTurnNodeId ? { current_node_id: postTurnNodeId } : {}),
      };

      // 2. Coordinated Canonical Publication
      const presentationPatch = projectPresentationPatch(response.logic_state);
      coordinateCanonicalTurnPublication({
        appStore: useAppStore,
        engineStore: useEngineStore,
        committedPayload: committedTurnPayload,
        preparedGameState,
        presentationPatch,
      });

      return 'COMMITTED';
    } catch (err: unknown) {
      setStreamingText(null);
      const currentAppState = useAppStore.getState();
      if (!isTurnAttemptCurrent(currentAppState, preSnapshot)) {
        isObsolete = true;
        console.warn('[Runtime] Ignoring obsolete turn error: attempt no longer current', err);
        return 'IGNORED';
      }

      console.error(err);
      const failureReceipt = toTurnFailureReceipt(err);

      if (!overrideInput) {
        setInput(commandText);
      }

      dispatch({
        type: 'TURN_FAILED',
        payload: {
          commandText,
          failureReceipt,
          errorCategory: failureReceipt.code,
          errorMessage: failureReceipt.message,
          statusCode: failureReceipt.status,
          contentType: failureReceipt.contentType,
          preSnapshot,
          engineGameStateBefore,
        },
      });

      return failureReceipt.code === 'PROVIDER_REFUSAL' ? 'REFUSED' : 'FAILED';
    } finally {
      setStreamingText(null);
      setInFlightInput(null);
      if (!isObsolete) {
        setIsLoading(false);
      }
    }
  };

  interface AutopilotRunState {
    mode: AutopilotMode;
    role: string;
    characterName: string | null;
    targetTurns: number;
    turnsAttempted: number;
    turnsCommitted: number;
    consecutiveNonCommittedCap: number;
    consecutiveNonCommitted: number;
    refusalCount: number;
    refusalBudget: number;
    refusalCodes: Record<string, number>;
    generationFailures: {
      AUTOPILOT_ACTION_FAILURE: number;
      TURN_NETWORK_FAILURE: number;
      [code: string]: number;
    };
    turnOutcomes: {
      COMMITTED: number;
      FAILED: number;
      REFUSED: number;
      [outcome: string]: number;
    };
  }

  const runAutopilotSequence = async (
    turnsRemaining: number,
    runId: number,
    initialRunState?: AutopilotRunState
  ) => {
    const isActiveRun = () =>
      autopilotRef.current && autopilotRunIdRef.current === runId;

    const runState: AutopilotRunState = initialRunState || {
      mode: autopilotMode,
      role: participationContext?.mode || playerRole || 'survivor',
      characterName: participationContext?.seat?.name || null,
      targetTurns: turnsRemaining,
      turnsAttempted: 0,
      turnsCommitted: 0,
      consecutiveNonCommittedCap: 3,
      consecutiveNonCommitted: 0,
      refusalCount: 0,
      refusalBudget: 3,
      refusalCodes: {},
      generationFailures: {
        AUTOPILOT_ACTION_FAILURE: 0,
        TURN_NETWORK_FAILURE: 0,
      },
      turnOutcomes: {
        COMMITTED: 0,
        FAILED: 0,
        REFUSED: 0,
      },
    };

    const emitRunReport = (aborted: boolean, abortReason: string | null) => {
      if (runState.mode === 'adversarial') {
        const report = {
          autopilotRunReport: true,
          mode: runState.mode,
          role: runState.role,
          characterName: runState.characterName,
          targetTurns: runState.targetTurns,
          turnsAttempted: runState.turnsAttempted,
          turnsCommitted: runState.turnsCommitted,
          refusals: runState.refusalCount,
          consecutiveNonCommittedCap: runState.consecutiveNonCommittedCap,
          aborted,
          abortReason,
          providerRefusals: {
            count: runState.refusalCount,
            budget: runState.refusalBudget,
            codes: runState.refusalCodes,
          },
          actionGenerationFailures: {
            AUTOPILOT_ACTION_FAILURE: runState.generationFailures.AUTOPILOT_ACTION_FAILURE || 0,
            TURN_NETWORK_FAILURE: runState.generationFailures.TURN_NETWORK_FAILURE || 0,
          },
          turnOutcomes: {
            COMMITTED: runState.turnOutcomes.COMMITTED || 0,
            FAILED: runState.turnOutcomes.FAILED || 0,
            REFUSED: runState.turnOutcomes.REFUSED || 0,
          },
        };
        console.log(report);
      }
    };

    const finishRun = (aborted: boolean = false, abortReason: string | null = null) => {
      if (autopilotRunIdRef.current !== runId) return;
      autopilotRef.current = false;
      setIsAutopilotRunning(false);
      emitRunReport(aborted, abortReason);
    };

    if (turnsRemaining <= 0 || !isActiveRun()) {
      finishRun(turnsRemaining > 0, turnsRemaining > 0 ? 'MANUAL_ABORT' : null);
      console.log('// AUTOPILOT SEQUENCE COMPLETE OR ABORTED //');
      return;
    }

    try {
      // Give the current frame time to settle before the harness asks for the
      // next simulated action. This intentionally applies to the opening turn
      // as well, so Engage cannot immediately create a second provider request.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, AUTOPILOT_MINIMUM_TURN_INTERVAL_MS);
      });

      if (!isActiveRun()) {
        finishRun(true, 'MANUAL_ABORT');
        return;
      }

      // A. Grab coherent simulation state
      const canonicalState = getCanonicalSimulationState();

      runState.turnsAttempted += 1;

      // B. Fetch the Ghost Player's action
      const simulatedResult = await fetchSimulatedPlayerAction(
        canonicalState.app.history || [],
        canonicalState.gameState || null,
        {
          role: participationContext?.mode || playerRole,
          characterName: participationContext?.seat?.name,
          mode: runState.mode,
        }
      );

      if (!isActiveRun()) {
        finishRun(true, 'MANUAL_ABORT');
        return;
      }

      if (!simulatedResult.success || !simulatedResult.action) {
        const failureCode = !simulatedResult.success && 'code' in simulatedResult ? simulatedResult.code : 'AUTOPILOT_ACTION_FAILURE';

        if (failureCode === 'PROVIDER_REFUSAL') {
          runState.refusalCount += 1;
          runState.refusalCodes[failureCode] = (runState.refusalCodes[failureCode] || 0) + 1;
          runState.turnOutcomes.REFUSED = (runState.turnOutcomes.REFUSED || 0) + 1;
          runState.consecutiveNonCommitted += 1;

          if (runState.refusalCount > 3) {
            console.warn('// AUTOPILOT ABORTED // Provider refusal budget exceeded (4th refusal).');
            finishRun(true, 'PROVIDER_REFUSAL_BUDGET');
            return;
          }

          if (runState.mode === 'adversarial' && runState.consecutiveNonCommitted >= 3) {
            console.warn('// AUTOPILOT ABORTED // 3 consecutive non-committed turns.');
            finishRun(true, 'CONSECUTIVE_NON_COMMITTED_CAP');
            return;
          }

          console.warn('// AUTOPILOT REFUSAL // Refusal logged; retrying next cadence with turnsRemaining unchanged.');
          await runAutopilotSequence(turnsRemaining, runId, runState);
          return;
        }

        // Non-refusal generation failure
        runState.generationFailures[failureCode] = (runState.generationFailures[failureCode] || 0) + 1;
        runState.consecutiveNonCommitted += 1;

        if (runState.mode === 'adversarial') {
          if (runState.consecutiveNonCommitted >= 3) {
            console.warn('// AUTOPILOT ABORTED // 3 consecutive non-committed turns.');
            finishRun(true, 'CONSECUTIVE_NON_COMMITTED_CAP');
            return;
          }
          await runAutopilotSequence(turnsRemaining - 1, runId, runState);
          return;
        }

        console.warn('// AUTOPILOT STOPPED // Action generation failed or declined.');
        finishRun(true, failureCode);
        return;
      }

      // C. Inject the simulated action into your standard submission pipeline
      const outcome = await handleCommand(undefined, simulatedResult.action);

      if (!isActiveRun()) {
        finishRun(true, 'MANUAL_ABORT');
        return;
      }

      runState.turnOutcomes[outcome] = (runState.turnOutcomes[outcome] || 0) + 1;

      if (outcome === 'COMMITTED') {
        runState.turnsCommitted += 1;
        runState.consecutiveNonCommitted = 0;
        await runAutopilotSequence(turnsRemaining - 1, runId, runState);
        return;
      }

      // Non-committed outcome (FAILED, REFUSED, IGNORED)
      runState.consecutiveNonCommitted += 1;

      if (runState.mode === 'adversarial') {
        if (outcome === 'REFUSED') {
          runState.refusalCount += 1;
          runState.refusalCodes['PROVIDER_REFUSAL'] = (runState.refusalCodes['PROVIDER_REFUSAL'] || 0) + 1;
          if (runState.refusalCount > 3) {
            console.warn('// AUTOPILOT ABORTED // Provider refusal budget exceeded (4th refusal).');
            finishRun(true, 'PROVIDER_REFUSAL_BUDGET');
            return;
          }
        }

        if (runState.consecutiveNonCommitted >= 3) {
          console.warn('// AUTOPILOT ABORTED // 3 consecutive non-committed turns.');
          finishRun(true, 'CONSECUTIVE_NON_COMMITTED_CAP');
          return;
        }

        console.log('// AUTOPILOT ADVERSARIAL // Non-committed outcome recorded:', outcome);
        await runAutopilotSequence(turnsRemaining - 1, runId, runState);
        return;
      }

      console.warn('// AUTOPILOT STOPPED // Non-committed outcome in standard/aggressive:', outcome);
      finishRun(true, outcome);
    } catch (err) {
      console.error('// AUTOPILOT FATAL ERROR // Loop terminated.', err);
      finishRun(true, 'FATAL_ERROR');
    }
  };


  const handleStartAutopilot = () => {
    // State updates are asynchronous, so use the ref as the authoritative
    // immediate admission gate for double-clicks and concurrent starts.
    if (isLoading || isTerminated || autopilotRef.current) return;

    const runId = autopilotRunIdRef.current + 1;
    autopilotRunIdRef.current = runId;
    setIsAutopilotRunning(true);
    autopilotRef.current = true;
    void runAutopilotSequence(autopilotTarget, runId);
  };

  const handleStopAutopilot = () => {
    autopilotRef.current = false;
    autopilotRunIdRef.current += 1;
    setIsAutopilotRunning(false);
  };

  if (!isHydrated || !isCoherent) return null;

  return (
    <div
      className="h-screen bg-[#060608] text-zinc-100 flex flex-col font-mono selection:bg-stone-800 selection:text-amber-200 overflow-hidden w-full max-w-[3440px] mx-auto"
      onKeyDown={() => setLastActivity(Date.now())}
      onClick={() => setLastActivity(Date.now())}
    >
      {/* Occult Scrying Apparatus Header */}
      <header className="h-16 border-b border-zinc-900 flex items-center justify-between pl-14 sm:pl-16 pr-6 sm:pr-8 bg-[#040406] z-10 shrink-0">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setIsAiCalibrationOpen(true)}
            className="p-1.5 border border-zinc-800/80 bg-zinc-950/80 hover:border-amber-500/60 hover:bg-zinc-900 text-zinc-400 hover:text-amber-400 rounded transition-colors shadow-sm cursor-pointer group flex items-center justify-center"
            title="Apparatus Calibration & Intelligence Tiers"
          >
            <Settings className="w-4 h-4 transition-transform duration-500 group-hover:rotate-90" />
          </button>
          <button
            onClick={handleExit}
            className="flex items-center gap-2 text-zinc-400 hover:text-amber-300 transition-colors uppercase text-xs tracking-[0.2em] font-serif cursor-pointer"
            title="Return to The Portal"
          >
            <ArrowLeft className="w-4 h-4 text-amber-500" />
            Portal
          </button>
          <div className="h-4 w-[1px] bg-zinc-800" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-xs sm:text-sm font-bold tracking-[0.25em] uppercase text-zinc-100 font-serif">
                {activeBlueprint?.title || 'Haunted House'}
              </h1>
              {/* Austin Osman Spare small sigil glyph */}
              <svg
                className="w-3.5 h-3.5 text-zinc-600 inline-block"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              >
                <circle cx="12" cy="12" r="9" strokeDasharray="2 2" />
                <path d="M12 3v18M3 12h18M8 8l8 8M16 8l-8 8" />
              </svg>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-mono">
                Scale: {activeBlueprint?.contentScale || 12}
              </span>
              <span className="text-[11px] text-zinc-600 uppercase tracking-widest font-mono">
                // {activeBlueprint?.contentLevelDescription || 'Procedural Architecture'}
              </span>
              {/* Role Graphical Flair Badge & Optional Authority Pill */}
              {effectiveCategory === 'VILLAIN' ? (
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded border border-red-800/80 bg-red-950/40 text-red-300 font-bold text-[10px] tracking-wider uppercase flex items-center gap-1.5 shadow-[0_0_10px_rgba(239,68,68,0.15)]">
                    <Skull className="w-3 h-3 text-red-500 animate-pulse" /> VILLAIN PREDATOR LINK // ENGAGED
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAuthorityModalOpen(true)}
                    className="px-2 py-0.5 rounded border border-red-800/80 bg-red-950/60 hover:bg-red-900/60 text-red-200 hover:text-white font-mono text-[10px] tracking-wider uppercase transition-colors cursor-pointer"
                    title="Inspect Inscribed Authority Contract & Boundaries"
                  >
                    [ Authority Contract ]
                  </button>
                </div>
              ) : effectiveCategory === 'BYSTANDER' ? (
                <span className="px-2 py-0.5 rounded border border-amber-800/80 bg-amber-950/40 text-amber-300 font-bold text-[10px] tracking-wider uppercase flex items-center gap-1.5 shadow-[0_0_10px_rgba(245,158,11,0.15)]">
                  <Coffee className="w-3 h-3 text-amber-400" /> BYSTANDER PERSPECTIVE // DETACHED
                </span>
              ) : effectiveCategory === 'DIRECTOR' ? (
                <span className="px-2 py-0.5 rounded border border-purple-800/80 bg-purple-950/40 text-purple-300 font-bold text-[10px] tracking-wider uppercase flex items-center gap-1.5 shadow-[0_0_10px_rgba(168,85,247,0.15)]">
                  <Film className="w-3 h-3 text-purple-400" /> DIRECTOR SLATE // FRAMING
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded border border-emerald-800/80 bg-emerald-950/40 text-emerald-300 font-bold text-[10px] tracking-wider uppercase flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.15)]">
                  <Shield className="w-3 h-3 text-emerald-400" /> SURVIVOR LINK // ACTIVE
                </span>
              )}
              <button
                onClick={() => setPhase('hub')}
                className="ml-2 text-xs text-zinc-500 hover:text-white uppercase tracking-widest underline decoration-zinc-800 cursor-pointer font-mono"
              >
                Change Scenario
              </button>
            </div>
          </div>
        </div>

        {/* Center: Analog Rolling Tape Counter & HG2 Pacing Indicator */}
        <div className="hidden lg:flex items-center gap-3">
          <div className="flex items-center gap-3 px-3.5 py-1.5 rounded border border-zinc-800/90 bg-zinc-950/80 shadow-inner">
            <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-mono font-semibold">
              Recorded Cycles
            </span>
            <div className="tape-counter" title={`Simulation Cycles: ${turnCount || 0}`}>
              {(turnCount || 0)
                .toString()
                .padStart(5, '0')
                .split('')
                .map((digit, idx) => (
                  <span key={idx} className="tape-counter-digit">
                    {digit}
                  </span>
                ))}
            </div>
          </div>

          {(gameState?.dramaturgy_state || activeBlueprint?.dramaticSpine) && (
            <div
              data-testid="runtime-pacing-indicator"
              className="flex items-center gap-2 px-3 py-1.5 rounded border border-amber-950/70 bg-amber-950/20 text-[10px] font-mono tracking-wider text-amber-200/90 shadow-sm"
              title="Dramaturgical Pacing State (HG2)"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="uppercase text-zinc-400">Phase:</span>
              <span className="font-semibold text-amber-300">
                {(gameState?.dramaturgy_state?.currentMacroPhase || 'EXPOSITION_BASELINE').replace(
                  /_/g,
                  ' '
                )}
              </span>
              <span className="text-zinc-600">|</span>
              <span className="uppercase text-zinc-400">Cadence:</span>
              <span className="font-semibold text-amber-400">
                {(gameState?.dramaturgy_state?.activePacingCadence || 'SIMMERING_DREAD').replace(
                  /_/g,
                  ' '
                )}
              </span>
            </div>
          )}
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-3">
          {/* Wing Toggle Buttons */}
          <button
            onClick={() => setIsLeftWingOpen(!isLeftWingOpen)}
            className={`px-2.5 py-1.5 text-xs font-mono rounded border transition-colors flex items-center gap-1.5 cursor-pointer ${
              isLeftWingOpen
                ? 'bg-zinc-900 border-zinc-700 text-zinc-200 shadow-sm'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
            title="Toggle Chambers & Mortal Ledger Wing"
          >
            {isLeftWingOpen ? (
              <PanelLeftClose className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <PanelLeft className="w-3.5 h-3.5" />
            )}
            <span className="text-[10px] uppercase tracking-wider hidden sm:inline">Chambers</span>
          </button>

          <button
            onClick={() => setIsRightWingOpen(!isRightWingOpen)}
            className={`px-2.5 py-1.5 text-xs font-mono rounded border transition-colors flex items-center gap-1.5 cursor-pointer ${
              isRightWingOpen
                ? 'bg-zinc-900 border-zinc-700 text-zinc-200 shadow-sm'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
            title="Toggle The Historian & Dossier Wing"
          >
            <span className="text-[10px] uppercase tracking-wider hidden sm:inline">Oracle</span>
            {isRightWingOpen ? (
              <PanelRightClose className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <PanelRight className="w-3.5 h-3.5" />
            )}
          </button>

          <div className="h-4 w-[1px] bg-zinc-800" />

          <button
            onClick={() =>
              exportChronicleProse(
                engineMessages,
                activeBlueprint || undefined
              )
            }
            className="px-2.5 py-1 text-xs font-mono text-amber-400 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/80 transition-colors rounded cursor-pointer flex items-center gap-1.5"
            title="Export Pure Literary Prose Chronicle (.md)"
          >
            [ EXPORT CHRONICLE ]
          </button>

          <button
            onClick={() =>
              exportEngineLog(
                engineMessages,
                'md',
                'engine-telemetry',
                activeBlueprint || undefined
              )
            }
            className="px-2.5 py-1 text-xs font-mono text-zinc-400 hover:text-zinc-100 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 transition-colors rounded cursor-pointer"
            title="Export to Markdown"
          >
            [ EXPORT .MD ]
          </button>
          <button
            onClick={() =>
              exportEngineLog(
                engineMessages,
                'html',
                'engine-telemetry',
                activeBlueprint || undefined
              )
            }
            className="px-2.5 py-1 text-xs font-mono text-zinc-400 hover:text-zinc-100 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 transition-colors rounded cursor-pointer"
            title="Export to HTML"
          >
            [ EXPORT .HTML ]
          </button>
          <button
            onClick={() => {
              useAppStore.getState().resetSession();
            }}
            className="px-2.5 py-1 text-xs font-mono text-red-400 hover:text-red-100 bg-red-900/20 hover:bg-red-900/50 border border-red-900/50 transition-colors duration-150 rounded cursor-pointer"
            title="Hard Reset Engine"
          >
            [ FLUSH STATE ]
          </button>
          <button
            onClick={handleRetake}
            disabled={isLoading || isAutopilotRunning || !lastTurnCheckpoint}
            className="px-2.5 py-1 text-xs font-mono text-amber-400 hover:text-amber-100 bg-amber-900/20 hover:bg-amber-900/50 border border-amber-900/50 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150 rounded cursor-pointer"
            title="Retake last turn (restore state and previous input)"
          >
            [ RETAKE ]
          </button>

          <div className="flex items-center gap-1.5 ml-1">
            <span className="jewel-amber" title="Scrying link connected" />
            <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-mono hidden xl:inline">
              Simulation Active
            </span>
          </div>
        </div>
      </header>

      {/* Authority Contract Modal for Villain / Antagonist */}
      {isAuthorityModalOpen && participationContext && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#09090c] border border-red-900/80 rounded-lg shadow-2xl max-w-2xl w-full p-6 space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-red-950/80 pb-3">
              <div className="flex items-center gap-2">
                <Skull className="w-4 h-4 text-red-500" />
                <span className="font-serif font-bold text-sm text-red-300 uppercase tracking-widest">
                  Inscribed Authority Contract // {participationContext.seat?.name || 'Opposition'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsAuthorityModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-200 text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-800 transition-colors cursor-pointer"
              >
                [ Close ]
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto no-scrollbar text-zinc-300">
              <div className="p-3 bg-black/60 rounded border border-zinc-850 space-y-1">
                <span className="text-zinc-500 uppercase font-bold text-[10px] tracking-wider block">
                  Designated Seat & Kind
                </span>
                <p className="text-zinc-200">
                  {participationContext.seat?.name || 'Predatory Villain'} ({participationContext.seat?.kind || 'Entity'})
                </p>
                {participationContext.seat?.description && (
                  <p className="text-zinc-400 text-[11px] italic mt-1">
                    {participationContext.seat.description}
                  </p>
                )}
              </div>

              <div className="p-3 bg-black/60 rounded border border-amber-950/60 space-y-1">
                <span className="text-amber-500 uppercase font-bold text-[10px] tracking-wider block">
                  Inscribed Authority & Reach
                </span>
                <p className="text-zinc-200 leading-relaxed whitespace-pre-wrap">
                  {participationContext.authorityContract?.authority ||
                    participationContext.seat?.ability ||
                    'Only already authored and ratified scenario facts apply. Bounded to authored reach.'}
                </p>
              </div>

              <div className="p-3 bg-black/60 rounded border border-red-950/60 space-y-1">
                <span className="text-red-400 uppercase font-bold text-[10px] tracking-wider block">
                  Non-Negotiable Limitations & Anchors
                </span>
                <p className="text-zinc-200 leading-relaxed whitespace-pre-wrap">
                  {participationContext.authorityContract?.limits ||
                    participationContext.seat?.limitation ||
                    'Strictly bounded to authored scenario facts and ratified state. No ungrounded omnipresence.'}
                </p>
              </div>

              {participationContext.initialGoal && (
                <div className="p-3 bg-black/60 rounded border border-zinc-850 space-y-1">
                  <span className="text-zinc-500 uppercase font-bold text-[10px] tracking-wider block">
                    Core Target / Primary Vector
                  </span>
                  <p className="text-zinc-300">
                    {participationContext.initialGoal}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setIsAuthorityModalOpen(false)}
                className="px-4 py-2 bg-red-950 hover:bg-red-900 text-red-200 border border-red-800 rounded text-xs uppercase tracking-wider font-bold transition-colors cursor-pointer"
              >
                [ Veil Authority Dossier ]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 4-PANE ULTRAWIDE 3440PX WORKSPACE         */}
      {/* ========================================= */}
      <div className="flex-1 min-h-0 flex gap-4 px-4 sm:px-6 py-3 overflow-hidden w-full">
        {/* LEFT WING: Map Sketch & Mortal Ledger */}
        {isLeftWingOpen && (
          <aside
            data-testid="engine-left-wing"
            className="w-[580px] xl:w-[640px] 2xl:w-[700px] shrink-0 h-full flex flex-col gap-3 overflow-y-auto no-scrollbar select-none"
          >
            <MapSketch
              currentNodeId={currentNodeId || startingNodeId || null}
              nodeDefinitions={nodeDefinitions}
              connections={topologyConnections}
              visitedNodeIds={visitedNodeIds}
              onSelectNode={handleSelectNode}
              className="shrink-0"
            />
            <MortalLedger
              playerCharacterName={userCharName}
              playerRoleCategory={effectiveCategory}
              psychologicalStatus={gameState?.psychological_status || 'Stable'}
              injuries={gameState?.player_injuries || []}
              inventory={gameState?.inventory || []}
              castMembers={cohortCastMembers}
              impendingClocks={
                gameState?.dramaturgy_state?.impendingClocks
                  ? Object.values(gameState.dramaturgy_state.impendingClocks)
                  : activeBlueprint?.dramaticSpine?.impendingClocks || []
              }
              currentLocationNodeId={currentNodeId || startingNodeId || undefined}
              macroPhase={gameState?.dramaturgy_state?.currentMacroPhase}
              pacingCadence={gameState?.dramaturgy_state?.activePacingCadence}
              className="flex-1 min-h-[320px]"
            />
          </aside>
        )}

        {/* CENTER STAGE: Primary Literary Prose & Impulse Slate */}
        <main
          data-testid="engine-center-stage"
          className="flex-1 min-w-0 h-full flex flex-col overflow-hidden bg-[#09090c]/90 border border-zinc-800/80 rounded-lg shadow-2xl backdrop-blur-sm"
        >
          {/* Scrollable Narrative Stream */}
          <div
            ref={scrollRef}
            data-testid="narrative-stream-container"
            className="flex-1 overflow-y-auto no-scrollbar px-6 sm:px-12 py-8 scroll-smooth"
          >
            <div className="w-full max-w-[68%] mx-auto space-y-8">
              <AnimatePresence initial={false}>
                {engineMessages.map((msg, idx) => (
                  <TranscriptMessageItem
                    key={msg.id || idx}
                    msg={msg as any}
                    onEdit={editTranscriptMessage}
                    onForceCosmetic={forceAcceptCosmetic}
                    userCharName={userCharName}
                  />
                ))}
                {inFlightInput && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="border border-amber-900/50 bg-zinc-950/90 p-5 rounded-lg text-zinc-300 relative overflow-hidden backdrop-blur-sm shadow-xl shadow-black/40"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_#d97706] animate-pulse" />
                      <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-400 font-semibold">
                        [ IMPULSE OFFERING // {inFlightInput.category} ]
                      </span>
                    </div>
                    <p className="font-serif italic text-zinc-200 text-base leading-relaxed pl-3 border-l-2 border-amber-700/60">
                      {inFlightInput.text}
                    </p>
                  </motion.div>
                )}
                {streamingText && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="border border-cyan-900/40 bg-zinc-950/90 p-5 rounded-lg text-zinc-300 relative overflow-hidden backdrop-blur-sm shadow-xl shadow-black/40"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_#06b6d4] animate-pulse" />
                      <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-cyan-400 font-semibold">
                        [ STREAMING TRANSMISSION ]
                      </span>
                    </div>
                    <p className="font-serif text-zinc-200 text-base leading-relaxed whitespace-pre-wrap pl-3 border-l-2 border-cyan-700/60">
                      {streamingText}
                      <span className="inline-block w-1.5 h-4 bg-cyan-400 ml-1 animate-pulse" />
                    </p>
                  </motion.div>
                )}
                {isLoading && !streamingText && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 text-amber-500/80 text-xs uppercase tracking-widest font-mono pt-2"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                    Channeling Inscription into the Obsidian Slate...
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Scalable Multi-line Impulse Slate */}
          {isTerminated ? (
            <div className="w-full shrink-0 p-6 bg-black/80 border-t border-red-900/80 text-center">
              <div className="text-red-500 font-bold tracking-[0.3em] uppercase mb-2 text-sm sm:text-base font-serif">
                [ SIMULATION TERMINATED ]
              </div>
              <p className="text-zinc-400 font-serif text-sm sm:text-base leading-relaxed">
                {terminalResolution}
              </p>
            </div>
          ) : (
            <div className="w-full shrink-0 p-3 sm:p-4 bg-[#050507] border-t border-zinc-800/90 relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#d97706] shadow-[0_0_6px_#d97706] animate-pulse" />
                  <span className="text-[11px] font-serif uppercase tracking-[0.2em] text-zinc-300 font-semibold">
                    The Impulse Slate // {effectiveCategory} Offering
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono">
                  Shift+Enter for newline · Enter to channel
                </div>
              </div>

              <div className="flex items-end gap-3">
                <button
                  onClick={() => handleCommand(undefined, '[USER_ACTION: OBSERVE]')}
                  disabled={isLoading || isAutopilotRunning || isTerminated}
                  className="flex flex-col items-center justify-center gap-1 px-3 py-2 rounded border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:text-white text-zinc-400 transition-colors disabled:opacity-30 shrink-0 h-[52px] cursor-pointer"
                  title="Observe / Silence (Advance Simulation)"
                >
                  <Eye className="w-4 h-4" />
                  <span className="text-[10px] uppercase tracking-wider font-mono">Observe</span>
                </button>

                <div className="flex-1 relative flex items-center border border-zinc-800 focus-within:border-amber-600/80 rounded bg-zinc-950/80 transition-colors">
                  <textarea
                    ref={inputRef}
                    autoFocus
                    value={input}
                    disabled={isLoading || isAutopilotRunning || isTerminated}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleCommand();
                      }
                    }}
                    placeholder={
                      isTerminated
                        ? 'TERMINAL CONDITION REACHED'
                        : isLoading
                        ? 'Inscribing impulse...'
                        : isAutopilotRunning
                        ? 'Autopilot channeling...'
                        : effectiveCategory === 'VILLAIN'
                        ? "Issue Predatory Directive or Actuate Environment (e.g. 'Fixate on Paul Allen\\'s card with cold appraisal; test his confidence')..."
                        : effectiveCategory === 'BYSTANDER'
                        ? "Mundane civilian action or self-preservation (e.g. 'Mind my own business, finish my coffee, and dial 911 from the payphone')..."
                        : effectiveCategory === 'DIRECTOR'
                        ? "Frame scene, calibrate pacing, or introduce environmental tension..."
                        : 'What is your next impulse? (Shift+Enter for new line)'
                    }
                    className="w-full bg-transparent text-sm sm:text-base px-4 py-3 resize-none focus:outline-none placeholder:text-zinc-600 min-h-[52px] max-h-[25vh] custom-scrollbar leading-relaxed text-zinc-100 font-serif"
                  />
                </div>

                <button
                  onClick={() => handleCommand()}
                  disabled={isLoading || isAutopilotRunning || isTerminated || !input.trim()}
                  className="px-5 py-2.5 rounded bg-amber-900/30 hover:bg-amber-900/60 border border-amber-700/80 text-amber-200 font-serif tracking-widest text-xs uppercase transition-all disabled:opacity-30 disabled:pointer-events-none shrink-0 h-[52px] flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  <span>Channel</span>
                </button>

                {/* Autopilot Controls */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded shrink-0 h-[52px]">
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">
                      Autopilot
                    </span>
                    <input
                      type="number"
                      min="2"
                      max="25"
                      value={autopilotTarget}
                      onChange={(e) => setAutopilotTarget(Number(e.target.value))}
                      disabled={isAutopilotRunning || isLoading || isTerminated}
                      className="w-10 bg-black text-zinc-200 text-xs p-0.5 border border-zinc-800 rounded text-center focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">
                      Mode
                    </span>
                    <select
                      value={autopilotMode}
                      onChange={(e) => setAutopilotMode(e.target.value as AutopilotMode)}
                      disabled={isAutopilotRunning || isLoading || isTerminated}
                      className="bg-black text-zinc-200 text-xs p-1 border border-zinc-800 rounded focus:outline-none font-mono"
                    >
                      <option value="standard">Standard</option>
                      <option value="aggressive">Aggressive</option>
                      <option value="adversarial">Adversarial</option>
                    </select>
                  </div>
                  {!isAutopilotRunning ? (
                    <button
                      onClick={handleStartAutopilot}
                      disabled={isLoading || isTerminated}
                      className="text-[10px] uppercase tracking-wider bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2.5 py-1.5 rounded transition-colors font-mono cursor-pointer disabled:opacity-30"
                      type="button"
                    >
                      Engage
                    </button>
                  ) : (
                    <button
                      onClick={handleStopAutopilot}
                      className="text-[10px] uppercase tracking-wider bg-red-950 hover:bg-red-900 text-red-200 px-2.5 py-1.5 border border-red-800 rounded transition-colors font-mono cursor-pointer"
                      type="button"
                    >
                      Abort
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* RIGHT WING: The Historian Docked & Scenario Dossier */}
        {isRightWingOpen && (
          <aside
            data-testid="engine-right-wing"
            className="w-[460px] 2xl:w-[500px] shrink-0 h-full flex flex-col overflow-hidden bg-zinc-950/90 border border-zinc-800/80 rounded-lg shadow-2xl backdrop-blur-md"
          >
            {/* Wing Navigation Tabs */}
            <div className="flex items-center border-b border-zinc-800/80 bg-black/60 shrink-0 select-none">
              <button
                type="button"
                onClick={() => setRightWingTab('historian')}
                className={`flex-1 py-3 px-3 text-xs font-serif tracking-widest uppercase transition-all flex items-center justify-center gap-2 border-r border-zinc-800/80 cursor-pointer ${
                  rightWingTab === 'historian'
                    ? 'bg-zinc-900/70 text-amber-300 font-bold border-b-2 border-b-amber-500'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 text-amber-500" />
                The Historian
              </button>
              <button
                type="button"
                onClick={() => setRightWingTab('dossier')}
                className={`flex-1 py-3 px-3 text-xs font-serif tracking-widest uppercase transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  rightWingTab === 'dossier'
                    ? 'bg-zinc-900/70 text-amber-300 font-bold border-b-2 border-b-amber-500'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Scenario Dossier
              </button>
            </div>

            {/* Wing Content Container */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {!isTerminated && rightWingTab === 'historian' ? (
                <TheVoice isDocked={true} className="h-full border-none rounded-none shadow-none" />
              ) : (
                <ScenarioDossier
                  blueprint={activeBlueprint}
                  telemetry={telemetry}
                  turnCount={turnCount}
                  latestForensicRecord={latestForensicRecord}
                  className="h-full border-none rounded-none shadow-none"
                />
              )}
            </div>
          </aside>
        )}
      </div>
      {/* AI Calibration Modal */}
      <AiCalibrationModal
        isOpen={isAiCalibrationOpen}
        onClose={() => setIsAiCalibrationOpen(false)}
      />
      {/* Chronicle Modal for Terminated Runs */}
      {appPhase === 'TERMINATED' && deathRecords && deathRecords.length > 0 && chronicle && (
        <ChronicleModal
          chronicle={chronicle}
          isOpen={isChronicleOpen}
          onClose={() => setDismissedChronicleTurnCount(turnCount)}
          canRetake={Boolean(lastTurnCheckpoint)}
          onRetake={() => {
            setDismissedChronicleTurnCount(null);
            retakeLastTurn();
          }}
          onReset={() => {
            setDismissedChronicleTurnCount(null);
            resetSession();
          }}
        />
      )}
    </div>
  );
}
