import React from 'react';
import type { Blueprint } from '../types';

export interface ChromaEntry {
  pattern: string;
  color: string;
}

export const CHROMA_PALETTE = [
  '#e8c25a', // 1. amber
  '#e08a3c', // 2. burnt orange
  '#b48ac9', // 3. muted violet
  '#7da05c', // 4. sickly green
  '#d98a2b', // 5. sodium orange
  '#c9a83c', // 6. jaundiced yellow
  '#6ea8d8', // 7. cold blue
  '#c96a6a', // 8. dried-blood red
] as const;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a deduplicated, priority-ordered list of chromatic highlight patterns from a blueprint.
 * Order:
 * 1. Signature noun (if present)
 * 2. Cast members (full name, plus unambiguous first-name alias)
 * 3. Topology nodes (distinct label, name, id >= 3 chars, non-colliding with cast/prior)
 */
export function buildChromaMap(blueprint: Blueprint): ChromaEntry[] {
  if (!blueprint) return [];

  const entries: ChromaEntry[] = [];
  const seenPatterns = new Set<string>();

  // 1. Signature noun
  if (
    blueprint.chromaSignature &&
    typeof blueprint.chromaSignature.word === 'string' &&
    blueprint.chromaSignature.word.trim().length > 0 &&
    typeof blueprint.chromaSignature.color === 'string' &&
    blueprint.chromaSignature.color.trim().length > 0
  ) {
    const word = blueprint.chromaSignature.word.trim();
    const wordLower = word.toLowerCase();
    entries.push({
      pattern: word,
      color: blueprint.chromaSignature.color.trim(),
    });
    seenPatterns.add(wordLower);
  }

  // 2. Cast
  const cast = blueprint.cast || [];
  const castCount = cast.length;

  for (let i = 0; i < castCount; i++) {
    const member = cast[i];
    if (!member || typeof member.name !== 'string') continue;
    const fullName = member.name.trim();
    if (!fullName) continue;

    const memberChroma = typeof (member as { chroma?: string }).chroma === 'string'
      ? (member as { chroma?: string }).chroma?.trim()
      : undefined;
    const color = memberChroma && memberChroma.length > 0
      ? memberChroma
      : CHROMA_PALETTE[i % CHROMA_PALETTE.length];

    const fullNameLower = fullName.toLowerCase();
    if (!seenPatterns.has(fullNameLower)) {
      entries.push({ pattern: fullName, color });
      seenPatterns.add(fullNameLower);
    }

    // First-name alias (text before first space)
    const nameParts = fullName.split(/\s+/);
    if (nameParts.length > 1) {
      const firstName = nameParts[0];
      const firstNameLower = firstName.toLowerCase();

      // Check collision with another cast member's first name or full name
      let collides = false;
      for (let k = 0; k < castCount; k++) {
        if (k === i) continue;
        const other = cast[k];
        if (!other || typeof other.name !== 'string') continue;
        const otherFull = other.name.trim().toLowerCase();
        if (!otherFull) continue;
        const otherFirst = otherFull.split(/\s+/)[0];

        if (firstNameLower === otherFull || firstNameLower === otherFirst) {
          collides = true;
          break;
        }
      }

      if (!collides && !seenPatterns.has(firstNameLower)) {
        entries.push({ pattern: firstName, color });
        seenPatterns.add(firstNameLower);
      }
    }
  }

  // 3. Topology nodes
  const nodeDefs = blueprint.topology?.nodeDefinitions || [];
  for (let j = 0; j < nodeDefs.length; j++) {
    const node = nodeDefs[j];
    if (!node) continue;

    const nodeChroma = typeof (node as { chroma?: string }).chroma === 'string'
      ? (node as { chroma?: string }).chroma?.trim()
      : undefined;
    const color = nodeChroma && nodeChroma.length > 0
      ? nodeChroma
      : CHROMA_PALETTE[(castCount + j) % CHROMA_PALETTE.length];

    const candidates = [node.label, node.name, node.id];
    for (const cand of candidates) {
      if (typeof cand !== 'string') continue;
      const candidatePattern = cand.trim();
      if (candidatePattern.length < 3) continue;

      const candLower = candidatePattern.toLowerCase();
      if (seenPatterns.has(candLower)) continue;

      entries.push({ pattern: candidatePattern, color });
      seenPatterns.add(candLower);
    }
  }

  return entries;
}

/**
 * Splits plain text into strings and chromatic <span> elements based on the chroma map.
 * Case-insensitive, Unicode word-boundary aware, longest pattern wins, left-to-right scan.
 */
export function chromaSegments(text: string, map: ChromaEntry[]): React.ReactNode[] {
  if (!text) {
    return [text];
  }
  if (!map || map.length === 0) {
    return [text];
  }

  // Filter and sort entries by pattern length descending (longest pattern wins)
  const sorted = [...map]
    .filter((entry) => entry && typeof entry.pattern === 'string' && entry.pattern.trim().length > 0)
    .sort((a, b) => b.pattern.length - a.pattern.length);

  if (sorted.length === 0) {
    return [text];
  }

  const colorMap = new Map<string, string>();
  for (const entry of sorted) {
    const key = entry.pattern.toLowerCase();
    if (!colorMap.has(key)) {
      colorMap.set(key, entry.color);
    }
  }

  const patternAlternation = sorted.map((entry) => escapeRegex(entry.pattern)).join('|');
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])(${patternAlternation})(?![\\p{L}\\p{N}])`, 'giu');

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchText = match[0];
    if (!matchText) {
      regex.lastIndex++;
      continue;
    }

    const matchStart = match.index;
    const matchEnd = matchStart + matchText.length;

    if (matchStart > lastIndex) {
      nodes.push(text.slice(lastIndex, matchStart));
    }

    const color = colorMap.get(matchText.toLowerCase()) || '#e8c25a';
    nodes.push(
      React.createElement(
        'span',
        {
          className: 'ttm-chroma',
          style: { color },
          key: `chroma-${matchIndex++}`,
        },
        matchText
      )
    );

    lastIndex = matchEnd;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
