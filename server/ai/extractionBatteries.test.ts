import { describe, it, expect } from 'vitest';
import {
  SPINE_BATTERY,
  EXTRACTION_BATTERIES,
} from './extractionBatteries';
import { buildStage2SpinePrompt } from './extractionCompiler';
import type { Stage1Response } from './extractionPipeline';

describe('extractionBatteries — SPINE_BATTERY', () => {
  it('SPINE_BATTERY is present in EXTRACTION_BATTERIES with correct properties', () => {
    expect(EXTRACTION_BATTERIES).toContain(SPINE_BATTERY);
    expect(SPINE_BATTERY.family).toBe('SPINE');
    expect(SPINE_BATTERY.compileTarget).toBe('spine');
    expect(SPINE_BATTERY.questions).toHaveLength(6);
    expect(SPINE_BATTERY.stage1Only).toBeFalsy();
  });

  it('buildStage2SpinePrompt includes spine key, all milestone kinds, target phases, and NEVER EXPOSITION_BASELINE', () => {
    const mockResponses: Stage1Response[] = [
      {
        family: 'SPINE',
        question: 'What are the story’s turning points?',
        answer: 'The breach occurs and the vault freezes.',
        citations: ['the breach occurs'],
        questionIndex: 0,
      },
    ];

    const prompt = buildStage2SpinePrompt('SPINE', mockResponses);

    // Contains spine key
    expect(prompt).toContain('"spine"');

    // Lists all four milestone kinds
    expect(prompt).toContain('DISCOVERY');
    expect(prompt).toContain('CLOCK_CRISIS');
    expect(prompt).toContain('COMPOSURE_THRESHOLD');
    expect(prompt).toContain('AUTHORED_TRIGGER');

    // Lists the six valid target phases
    expect(prompt).toContain('INCITING_RUPTURE');
    expect(prompt).toContain('COMPLICATION_ENCLOSURE');
    expect(prompt).toContain('MIDPOINT_CRISIS');
    expect(prompt).toContain('ESCALATING_VISE');
    expect(prompt).toContain('CLIMACTIC_CONFRONTATION');
    expect(prompt).toContain('AFTERMATH_DENOUEMENT');

    // Contains the NEVER EXPOSITION_BASELINE rule
    expect(prompt).toContain('NEVER EXPOSITION_BASELINE');
  });
});
