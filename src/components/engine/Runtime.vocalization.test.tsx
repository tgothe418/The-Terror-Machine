import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { TranscriptMessageItem, formatBlocks } from './Runtime';
import type { UITranscriptMessage, NarrativeBlock } from '../../types';
import { VocalizationBlockSchema } from '../../types/vocalization';

// The engine contract carries vocalization fields (medium/delivery/target/
// interrupted) that the legacy NarrativeBlock interface does not declare; the
// fixtures below author blocks in the vocalization schema's input shape.
type VocalizationBlockFixture = z.input<typeof VocalizationBlockSchema>;

describe('Vocalization & Dialogue Subsystem - Phase 3', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root!.unmount();
      });
      container.remove();
    }
    container = null;
    root = null;
  });

  describe('formatBlocks helper', () => {
    it('formats internal_monologue with [THOUGHT // ]: content', () => {
      const blocks: NarrativeBlock[] = [
        { type: 'internal_monologue', speaker: 'Dr. Evans', content: 'The air feels wrong.' },
        { type: 'internal_monologue', speaker: null, content: 'Is anyone listening?' },
      ];
      const result = formatBlocks(blocks);
      expect(result).toBe(
        '[THOUGHT // Dr. Evans]: The air feels wrong.\n\n[THOUGHT // POV]: Is anyone listening?'
      );
    });

    it('formats soliloquy with [MUTTERED // ]: content', () => {
      const blocks: NarrativeBlock[] = [
        { type: 'soliloquy', speaker: 'Mercer', content: 'Hold it together.' },
        { type: 'soliloquy', speaker: undefined, content: 'One more step.' },
      ];
      const result = formatBlocks(blocks);
      expect(result).toBe(
        '[MUTTERED // Mercer]: Hold it together.\n\n[MUTTERED // SELF]: One more step.'
      );
    });

    it('formats transmission with [TRANSMISSION // ]: content', () => {
      const blocks: NarrativeBlock[] = [
        { type: 'transmission', speaker: 'Station AI', content: 'Decompression hazard.' },
        { type: 'transmission', speaker: null, content: 'Static burst.' },
      ];
      const result = formatBlocks(blocks);
      expect(result).toBe(
        '[TRANSMISSION // Station AI]: Decompression hazard.\n\n[TRANSMISSION // INTERCOM]: Static burst.'
      );
    });

    it('formats dialogue with : content', () => {
      const blocks: NarrativeBlock[] = [
        { type: 'dialogue', speaker: 'kane', content: 'Look at the console.' },
      ];
      const result = formatBlocks(blocks);
      expect(result).toBe('KANE: Look at the console.');
    });

    it('formats prose blocks as raw content', () => {
      const blocks: NarrativeBlock[] = [
        { type: 'prose', content: 'The lights pulse once, then go dark.' },
      ];
      const result = formatBlocks(blocks);
      expect(result).toBe('The lights pulse once, then go dark.');
    });

    it('returns empty string for null or non-array inputs', () => {
      expect(formatBlocks(undefined)).toBe('');
      expect(formatBlocks([])).toBe('');
    });
  });

  describe('TranscriptMessageItem Rendering with Structured Blocks', () => {
    it('renders internal_monologue with dusky-violet/indigo border, italicized text, and no header badge', async () => {
      const msg: UITranscriptMessage = {
        id: 'msg-thought-1',
        role: 'assistant',
        content: '[THOUGHT // Dr. Evans]: The shadow moved.',
        blocks: [
          { type: 'internal_monologue', speaker: 'Dr. Evans', content: 'The shadow moved.' },
        ],
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('The shadow moved.');
      expect(container!.querySelector('.border-indigo-900\\/60')).toBeTruthy();
      expect(container!.querySelector('.italic')).toBeTruthy();
    });

    it('renders soliloquy with dashed amber border, dimmed text, and no header badge', async () => {
      const msg: UITranscriptMessage = {
        id: 'msg-soliloquy-1',
        role: 'assistant',
        content: '[MUTTERED // Mercer]: Keep your breathing slow.',
        blocks: [
          { type: 'soliloquy', speaker: 'Mercer', content: 'Keep your breathing slow.' },
        ],
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('Keep your breathing slow.');
      expect(container!.querySelector('.border-dashed')).toBeTruthy();
      expect(container!.querySelector('.border-amber-800\\/80')).toBeTruthy();
      expect(container!.querySelector('.text-zinc-400')).toBeTruthy();
    });

    it('renders transmission / intercom / acoustic bleed with CRT phosphor-cyan scanline border and no header badge', async () => {
      const blocks: VocalizationBlockFixture[] = [
        {
          type: 'transmission',
          speaker: 'STATION CONTROL',
          medium: 'intercom',
          content: 'Pressure drop in corridor 4.',
        },
      ];
      const msg: UITranscriptMessage = {
        id: 'msg-transmission-1',
        role: 'assistant',
        content: '[TRANSMISSION // STATION CONTROL]: Pressure drop in corridor 4.',
        blocks,
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('Pressure drop in corridor 4.');
      expect(container!.querySelector('.border-cyan-900\\/70')).toBeTruthy();
      expect(container!.querySelector('.bg-cyan-950\\/10')).toBeTruthy();
      expect(container!.querySelector('.font-mono')).toBeTruthy();
    });

    it('renders standard dialogue with solid candle-amber border, bone-ivory text, and no header badge', async () => {
      const msg: UITranscriptMessage = {
        id: 'msg-dialogue-1',
        role: 'assistant',
        content: 'KANE: Grab the maintenance key.',
        blocks: [
          {
            type: 'dialogue',
            speaker: 'Kane',
            content: 'Grab the maintenance key.',
          },
        ],
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('Grab the maintenance key.');
      expect(container!.querySelector('.border-\\[\\#d97706\\]\\/70')).toBeTruthy();
      expect(container!.querySelector('.text-\\[\\#e6e4dc\\]')).toBeTruthy();
    });
  });

  describe('TranscriptMessageItem Line Inspection Fallback (no blocks)', () => {
    it('parses [THOUGHT // POV]: text into internal monologue when blocks is missing', async () => {
      const msg: UITranscriptMessage = {
        id: 'msg-fallback-thought',
        role: 'assistant',
        content: '[THOUGHT // POV]: They know we are here.',
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('They know we are here.');
      expect(container!.querySelector('.border-indigo-900\\/60')).toBeTruthy();
      expect(container!.querySelector('.italic')).toBeTruthy();
    });

    it('parses [MUTTERED // SELF]: text into soliloquy when blocks is missing', async () => {
      const msg: UITranscriptMessage = {
        id: 'msg-fallback-soliloquy',
        role: 'assistant',
        content: '[MUTTERED // SELF]: Not again.',
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('Not again.');
      expect(container!.querySelector('.border-dashed')).toBeTruthy();
      expect(container!.querySelector('.border-amber-800\\/80')).toBeTruthy();
    });

    it('parses [TRANSMISSION // INTERCOM]: text into transmission when blocks is missing', async () => {
      const msg: UITranscriptMessage = {
        id: 'msg-fallback-transmission',
        role: 'assistant',
        content: '[TRANSMISSION // INTERCOM]: Containment failure in Sector 2.',
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('Containment failure in Sector 2.');
      expect(container!.querySelector('.border-cyan-900\\/70')).toBeTruthy();
      expect(container!.querySelector('.bg-cyan-950\\/10')).toBeTruthy();
    });

    it('parses SPEAKER: text into dialogue when blocks is missing', async () => {
      const msg: UITranscriptMessage = {
        id: 'msg-fallback-dialogue',
        role: 'assistant',
        content: 'CHIEF BRANSON: Stand clear of the bulkheads.',
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('Stand clear of the bulkheads.');
      expect(container!.querySelector('.border-\\[\\#d97706\\]\\/70')).toBeTruthy();
      expect(container!.querySelector('.text-\\[\\#e6e4dc\\]')).toBeTruthy();
    });
  });

  describe('TranscriptMessageItem Multi-Block Messages', () => {
    it('renders composite narrative containing prose, dialogue, transmission, and internal monologue', async () => {
      const msg: UITranscriptMessage = {
        id: 'msg-composite-1',
        role: 'assistant',
        content: 'The air turns freezing cold.\n\nKANE: Get back!\n\n[TRANSMISSION // COMM-AI]: Bio-signature approaching.\n\n[THOUGHT // POV]: There is nowhere to run.',
        blocks: [
          { type: 'prose', content: 'The air turns freezing cold.' },
          { type: 'dialogue', speaker: 'Kane', content: 'Get back!' },
          {
            type: 'transmission',
            speaker: 'COMM-AI',
            content: 'Bio-signature approaching.',
          },
          {
            type: 'internal_monologue',
            speaker: 'POV',
            content: 'There is nowhere to run.',
          },
        ],
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      // Assert no bracketed badge headers are present
      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);

      // Assert contents are present
      expect(container!.textContent).toContain('The air turns freezing cold.');
      expect(container!.textContent).toContain('Get back!');
      expect(container!.textContent).toContain('Bio-signature approaching.');
      expect(container!.textContent).toContain('There is nowhere to run.');

      // Assert styling classes are present
      expect(container!.querySelector('.border-\\[\\#d97706\\]\\/70')).toBeTruthy();
      expect(container!.querySelector('.border-cyan-900\\/70')).toBeTruthy();
      expect(container!.querySelector('.border-indigo-900\\/60')).toBeTruthy();
    });

    it('renders mediated radio transmission with typographic squelch markers (Amendment 2 & Lane 3)', async () => {
      const blocks: VocalizationBlockFixture[] = [
        {
          type: 'transmission',
          speaker: 'Officer Marcus Holt',
          medium: 'radio',
          content: 'Pressure is venting from the airlock.',
        },
      ];
      const msg: UITranscriptMessage = {
        id: 'msg-squelch-1',
        role: 'assistant',
        content: 'Officer Marcus Holt over radio.',
        blocks,
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('> [CHIRP]');
      expect(container!.textContent).toContain('[STATIC]');
      expect(container!.textContent).toContain('Pressure is venting from the airlock.');
    });

    it('renders acoustic bleed with shrouded styling and no header badge (Lane 3)', async () => {
      const blocks: VocalizationBlockFixture[] = [
        {
          type: 'transmission',
          speaker: 'Orderly Thomas',
          medium: 'acoustic_bleed',
          acousticSourceNodeId: 'Histology Substation',
          content: 'The lights went out on Sub-Level 3...',
        },
      ];
      const msg: UITranscriptMessage = {
        id: 'msg-bleed-1',
        role: 'assistant',
        content: 'Muffled sounds through ventilation.',
        blocks,
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('The lights went out on Sub-Level 3...');
      expect(container!.querySelector('.border-slate-700\\/80')).toBeTruthy();
    });

    it('renders interrupted dialogue with italic stress styling (Amendment 2 & Lane 3)', async () => {
      const blocks: VocalizationBlockFixture[] = [
        {
          type: 'dialogue',
          speaker: 'Jules Mercer',
          interrupted: true,
          content: 'Wait, behind you—',
        },
      ];
      const msg: UITranscriptMessage = {
        id: 'msg-interrupted-1',
        role: 'assistant',
        content: 'Wait, behind you—',
        blocks,
      };

      await act(async () => {
        root!.render(
          <TranscriptMessageItem
            msg={msg}
            onEdit={vi.fn()}
            onForceCosmetic={vi.fn()}
            userCharName="Dr. Evans"
          />
        );
      });

      expect(container!.textContent).not.toMatch(/\[[^\]]*\/\//);
      expect(container!.textContent).toContain('Wait, behind you—');
      expect(container!.querySelector('.italic')).toBeTruthy();
    });
  });
});

