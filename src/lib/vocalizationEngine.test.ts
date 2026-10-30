import { describe, it, expect } from 'vitest';
import { EngineTurnContextSchema } from '../types/engineContract';
import {
  buildAuditoryContext,
  validateAndNormalizeVocalization,
  formatVocalizationPromptDirective,
  isRecognizedAmbientSpeaker,
  evaluateVocalCapability,
  checkVocalCapability,
  FULL_VOICE_DELIVERIES,
  WHISPER_DELIVERIES,
  resolveAcousticAudience,
  type LocationTopology,
} from './vocalizationEngine';

describe('vocalizationEngine', () => {
  const baseContext = EngineTurnContextSchema.parse({
    scenario: {
      title: 'Sub-Level 4 Research Lab',
      premise: 'Isolated containment deep underground.',
      worldRules: ['Atmospheric pressure differentials apply.'],
      setting: {
        location: 'Containment Control Hub',
        atmosphere: 'Oppressive cold, distant pipe groans',
        timePeriod: '1987',
      },
    },
    player: {
      role: 'protagonist',
      characterId: 'char-aria',
      name: 'Dr. Aria Bell',
      description: 'Senior research director.',
      isEntity: false,
    },
    cast: [
      {
        id: 'char-aria',
        name: 'Dr. Aria Bell',
        role: 'Protagonist',
        description: 'Lead researcher.',
        isUserCharacter: true,
        isEntity: false,
        expressionProfile: {
          communicationModes: ['spoken'],
          expressionGuidance: 'Precise and controlled.',
        },
      },
      {
        id: 'char-jules',
        name: 'Jules Mercer',
        role: 'Technician',
        description: 'Systems engineer trapped in duct maintenance.',
        isUserCharacter: false,
        isEntity: false,
        isPresent: true,
        expressionProfile: {
          communicationModes: ['spoken', 'mediated'],
          expressionGuidance: 'Nervous staccato cadence.',
        },
      },
      {
        id: 'char-marcus',
        name: 'Dr. Marcus Sterling',
        role: 'Biologist',
        description: 'Lead pathologist behind the reinforced observation port.',
        isUserCharacter: false,
        isEntity: false,
        isPresent: false,
        expressionProfile: {
          communicationModes: ['spoken'],
          expressionGuidance: 'Cold clinical detachment.',
        },
      },
      {
        id: 'char-mute-specimen',
        name: 'Specimen 9',
        role: 'Anomaly',
        description: 'Chittering bio-mass.',
        isUserCharacter: false,
        isEntity: true,
        isPresent: true,
        expressionProfile: {
          communicationModes: ['nonverbal'],
          expressionGuidance: 'Wet clicking and throat-vibrations.',
        },
      },
    ],
    topology: {
      currentNodeId: 'node-hub',
      readableNodeLabel: 'Containment Control Hub (Observation Port to Holding Cell)',
      allowedOutgoingExits: [
        {
          from: 'node-hub',
          to: 'node-cell',
          kind: 'PHYSICAL',
          requires: ['airlock-keycard'],
          userInitiated: true,
        },
      ],
    },
    runtime: {
      phase: 'LATENT',
      tension: 0,
      coherence: 1.0,
      reconciliationRevision: 0,
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      activeFlags: [],
      turnNumber: 0,
    },
  });

  describe('buildAuditoryContext', () => {
    it('accurately categorizes co-present vs elsewhere characters and solitary status', () => {
      const auditory = buildAuditoryContext(baseContext);

      expect(auditory.isSolitary).toBe(false);
      expect(auditory.presentSpeakerNames).toEqual(['Jules Mercer']);
      expect(auditory.coPresentCharacters.map((c) => c.name)).toContain('Jules Mercer');
      expect(auditory.coPresentCharacters.map((c) => c.name)).toContain('Specimen 9');
      expect(auditory.adjacentOrElsewhereCharacters.map((c) => c.name)).toContain('Dr. Marcus Sterling');
      expect(auditory.hasActiveRemoteChannel).toBe(false);
      expect(auditory.hasAcousticTopologyLinks).toBe(true);
      expect(auditory.detectedAcousticLinkMedium).toBe('port_observation');
    });

    it('detects solitary condition when no speaking companions are present', () => {
      const solitaryContext = EngineTurnContextSchema.parse({
        ...baseContext,
        cast: baseContext.cast.map((c) =>
          c.id === 'char-jules' ? { ...c, isPresent: false } : c
        ),
      });

      const auditory = buildAuditoryContext(solitaryContext);
      // Jules is absent, and Specimen 9 is nonverbal only, so solitary is true
      expect(auditory.isSolitary).toBe(true);
      expect(auditory.presentSpeakerNames).toHaveLength(0);
    });

    it('detects active remote communication channels from user action or history', () => {
      const radioAuditory = buildAuditoryContext(
        baseContext,
        'I speak into my walkie radio: Jules, do you copy?'
      );
      expect(radioAuditory.hasActiveRemoteChannel).toBe(true);
      expect(radioAuditory.remoteChannelMedium).toBe('radio');

      const intercomAuditory = buildAuditoryContext(
        baseContext,
        'I press the intercom button on the security console.'
      );
      expect(intercomAuditory.hasActiveRemoteChannel).toBe(true);
      expect(intercomAuditory.remoteChannelMedium).toBe('intercom');

      const historyAuditory = buildAuditoryContext(
        baseContext,
        'What was that sound?',
        [
          { role: 'user', content: 'I dial the internal telephone line.' },
          { role: 'assistant', content: 'Static clicks across the receiver.' },
        ]
      );
      expect(historyAuditory.hasActiveRemoteChannel).toBe(true);

      const hungUpAuditory = buildAuditoryContext(
        baseContext,
        'I hang up the phone receiver.',
        [
          { role: 'user', content: 'I dial the internal telephone line.' },
          { role: 'assistant', content: 'Static clicks across the receiver.' },
        ]
      );
      expect(hungUpAuditory.hasActiveRemoteChannel).toBe(false);
    });

    it('identifies cast arrivals from arrivedCastIds', () => {
      const arrivalSet = new Set(['char-marcus']);
      const auditory = buildAuditoryContext(
        baseContext,
        'I wait by the vault door.',
        undefined,
        arrivalSet
      );
      expect(auditory.hasArrivals).toBe(true);
      expect(auditory.arrivedCastIds.has('char-marcus')).toBe(true);
    });
  });

  describe('validateAndNormalizeVocalization', () => {
    it('allows internal monologue for player character and normalizes medium to internal and target to self', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        {
          type: 'internal_monologue',
          speaker: 'Dr. Aria Bell',
          content: 'Dr. Aria Bell: If the seals rupture, none of us survive.',
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks).toHaveLength(1);
      expect(normalizedBlocks[0]).toMatchObject({
        type: 'internal_monologue',
        speaker: 'Dr. Aria Bell',
        medium: 'internal',
        target: 'self',
        content: 'If the seals rupture, none of us survive.',
      });
    });

    it('allows internal monologue for companion character without requiring co-presence', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        {
          type: 'internal_monologue',
          speaker: 'Dr. Marcus Sterling',
          content: 'Dr. Marcus Sterling: "The antigen is failing."',
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks).toHaveLength(1);
      expect(normalizedBlocks[0]).toMatchObject({
        type: 'internal_monologue',
        speaker: 'Dr. Marcus Sterling',
        medium: 'internal',
        target: 'self',
        content: 'The antigen is failing.',
      });
    });

    it('allows solitary character muttering/soliloquy when alone', () => {
      const solitaryContext = EngineTurnContextSchema.parse({
        ...baseContext,
        cast: baseContext.cast.map((c) =>
          c.id === 'char-jules' ? { ...c, isPresent: false } : c
        ),
      });
      const auditory = buildAuditoryContext(solitaryContext);

      // Soliloquy block
      const blocks = [
        {
          type: 'soliloquy',
          speaker: 'Dr. Aria Bell',
          content: 'Dr. Aria Bell: Just breathe. Keep your hands steady.',
        },
      ];
      const res1 = validateAndNormalizeVocalization(blocks, auditory);
      expect(res1.error).toBeNull();
      expect(res1.normalizedBlocks[0]).toMatchObject({
        type: 'soliloquy',
        speaker: 'Dr. Aria Bell',
        delivery: 'mutter',
        target: 'self',
        content: 'Just breathe. Keep your hands steady.',
      });

      // Player speech emitted as dialogue when solitary auto-normalizes to soliloquy
      const dialogueBlocks = [
        {
          type: 'dialogue',
          speaker: 'Dr. Aria Bell',
          content: 'There has to be a secondary bypass valve.',
        },
      ];
      const res2 = validateAndNormalizeVocalization(dialogueBlocks, auditory);
      expect(res2.error).toBeNull();
      expect(res2.normalizedBlocks[0]).toMatchObject({
        type: 'soliloquy',
        speaker: 'Dr. Aria Bell',
        target: 'self',
        delivery: 'mutter',
        content: 'There has to be a secondary bypass valve.',
      });
    });

    it('allows interpersonal dialogue when companions are present', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Jules Mercer',
          content: 'Jules Mercer: "The auxiliary power line is completely severed!"',
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks).toHaveLength(1);
      expect(normalizedBlocks[0]).toMatchObject({
        type: 'dialogue',
        speaker: 'Jules Mercer',
        medium: 'direct',
        delivery: 'spoken',
        target: 'addressed',
        content: 'The auxiliary power line is completely severed!',
      });
    });

    it('rejects player dialogue when companions are present and delivery is not muttering', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Dr. Aria Bell',
          delivery: 'spoken',
          content: 'Cover the vents!',
        },
      ];

      const { error } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toContain('player-controlled');
    });

    it('allows ambient extra speech and cleans duplicate name prefixes', () => {
      const auditory = buildAuditoryContext(baseContext);
      expect(isRecognizedAmbientSpeaker('Orderly')).toBe(true);
      expect(isRecognizedAmbientSpeaker('Technician')).toBe(true);
      expect(isRecognizedAmbientSpeaker('Hostess')).toBe(true);

      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Technician',
          content: 'Technician: Core temperature rising rapidly in sector 3.',
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks[0]).toMatchObject({
        type: 'dialogue',
        speaker: 'Technician',
        content: 'Core temperature rising rapidly in sector 3.',
      });
    });

    it('auto-resolves absent character speech to acoustic bleed or transmission rather than failing with 502 error', () => {
      // Dr. Marcus Sterling is absent (isPresent: false) and no active phone call
      const auditory = buildAuditoryContext(
        baseContext,
        'I listen against the reinforced bulkhead glass.'
      );
      expect(auditory.hasActiveRemoteChannel).toBe(false);

      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Dr. Marcus Sterling',
          content: 'Dr. Marcus Sterling: "Aria! Can you hear me through the observation glass?"',
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks).toHaveLength(1);
      // Gracefully auto-remediated into transmission rather than 502 crash
      expect(normalizedBlocks[0].type).toBe('transmission');
      expect(normalizedBlocks[0].speaker).toBe('Dr. Marcus Sterling');
      expect(normalizedBlocks[0].medium).toBe('port_observation');
      expect(normalizedBlocks[0].content).toBe(
        'Aria! Can you hear me through the observation glass?'
      );
    });

    it('rejects completely hallucinated arbitrary characters not in cast or ambient extra list', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Grand Inquisitor Malakor',
          content: 'Kneel before the entity!',
        },
      ];

      const { error } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBe('Dialogue speaker "Grand Inquisitor Malakor" is not in the authorized cast.');
    });

    it('enforces at most one dialogue block per turn', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        { type: 'dialogue', speaker: 'Jules Mercer', content: 'Step back!' },
        { type: 'dialogue', speaker: 'Jules Mercer', content: 'I said step back!' },
      ];

      const { error } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toContain('at most one dialogue block');
    });

    it('rejects nonverbal characters attempting spoken dialogue', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Specimen 9',
          content: 'Leave us.',
        },
      ];

      const { error } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBe('Dialogue speaker "Specimen 9" lacks spoken or mediated communication.');
    });

    it('allows facility transmissions and automated system voices', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        {
          type: 'system_voice',
          speaker: 'Facility PA',
          content: 'Facility PA: Decontamination cycle initiating in ten seconds.',
        },
        {
          type: 'transmission',
          speaker: 'Distress Beacon',
          content: 'Distress Beacon: SOS... repeater offline.',
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks).toHaveLength(2);
      expect(normalizedBlocks[0]).toMatchObject({
        type: 'system_voice',
        speaker: 'Facility PA',
        medium: 'intercom',
        content: 'Decontamination cycle initiating in ten seconds.',
      });
      expect(normalizedBlocks[1]).toMatchObject({
        type: 'transmission',
        speaker: 'Distress Beacon',
        medium: 'radio',
        content: 'SOS... repeater offline.',
      });
    });
  });

  describe('formatVocalizationPromptDirective', () => {
    it('formats solitary vocalization directive when character is alone', () => {
      const solitaryContext = EngineTurnContextSchema.parse({
        ...baseContext,
        cast: baseContext.cast.map((c) =>
          c.id === 'char-jules' ? { ...c, isPresent: false } : c
        ),
      });
      const auditory = buildAuditoryContext(solitaryContext);
      const directive = formatVocalizationPromptDirective(auditory);

      expect(directive).toContain('[SOLITARY VOCALIZATION DIRECTIVE]');
      expect(directive).toContain('SOLITARY in this chamber');
      expect(directive).toContain('INTERNAL MONOLOGUE ALLOWED');
      expect(directive).toContain('SOLILOQUY MUTTERING ALLOWED');
      expect(directive).toContain('TRANSMISSIONS / SYSTEM VOICES');
    });

    it('formats living dialogue mandate when companions are present', () => {
      const auditory = buildAuditoryContext(baseContext);
      const directive = formatVocalizationPromptDirective(auditory);

      expect(directive).toContain('[MANDATORY DIALOGUE REQUIREMENT]');
      expect(directive).toContain('Jules Mercer');
      expect(directive).toContain('VOCALIZATION FORMATS');
    });

    it('formats explicitly addressed dialogue mandate when cast member was targeted', () => {
      const auditory = buildAuditoryContext(
        baseContext,
        'I shout to Jules.',
        undefined,
        undefined,
        'char-jules'
      );
      const directive = formatVocalizationPromptDirective(auditory);

      expect(directive).toContain('[MANDATORY DIALOGUE REQUIREMENT]');
      expect(directive).toContain('The user explicitly spoke to Jules Mercer');
    });

    it('gracefully normalizes player dialogue on SYSTEM_INIT opening turn for verbal characters', () => {
      const auditory = buildAuditoryContext(baseContext, 'SYSTEM_INIT');
      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Dr. Aria Bell',
          delivery: 'spoken',
          content: 'The air in this ward is freezing.',
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks).toHaveLength(1);
      expect(normalizedBlocks[0].type).toBe('dialogue');
      expect(normalizedBlocks[0].speaker).toBe('Dr. Aria Bell');
      expect(normalizedBlocks[0].content).toBe('The air in this ward is freezing.');
    });

    it('gracefully converts player dialogue on SYSTEM_INIT to prose for nonverbal entities', () => {
      const nonverbalContext = EngineTurnContextSchema.parse({
        ...baseContext,
        player: {
          name: 'Entity-41',
          characterId: 'char-entity-41',
          role: 'antagonist',
          isEntity: true,
        },
        cast: [
          {
            id: 'char-entity-41',
            name: 'Entity-41',
            role: 'antagonist',
            isUserCharacter: true,
            isEntity: true,
            isPresent: true,
            expressionProfile: {
              communicationModes: ['nonverbal'],
              expressionGuidance: 'Silent mechanical movements only.',
            },
          },
        ],
      });

      const auditory = buildAuditoryContext(nonverbalContext, 'SYSTEM_INIT');
      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Entity-41',
          content: 'Pneumatic valves hiss along the ceiling track.',
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks).toHaveLength(1);
      expect(normalizedBlocks[0].type).toBe('prose');
      expect(normalizedBlocks[0].content).toBe('Pneumatic valves hiss along the ceiling track.');
    });

    it('appends em-dash to interrupted speech when missing (Amendment 2)', () => {
      const auditory = buildAuditoryContext(baseContext);
      const blocks = [
        {
          type: 'dialogue',
          speaker: 'Jules Mercer',
          content: 'Wait, what is that behind you',
          interrupted: true,
        },
      ];

      const { error, normalizedBlocks } = validateAndNormalizeVocalization(blocks, auditory);
      expect(error).toBeNull();
      expect(normalizedBlocks[0].interrupted).toBe(true);
      expect(normalizedBlocks[0].content).toBe('Wait, what is that behind you—');
    });

    it('enforces fail-closed validation for fabricated acousticSourceNodeId (Amendment 7)', () => {
      const auditory = buildAuditoryContext(baseContext);
      // 'node-cell' is the only valid exit from 'node-hub' in baseContext
      const validBlocks = [
        {
          type: 'transmission',
          speaker: 'Dr. Marcus Sterling',
          medium: 'acoustic_bleed',
          acousticSourceNodeId: 'node-cell',
          content: 'The cold is seeping under the door...',
        },
      ];

      const validResult = validateAndNormalizeVocalization(validBlocks, auditory);
      expect(validResult.error).toBeNull();
      expect(validResult.normalizedBlocks[0].acousticSourceNodeId).toBe('node-cell');

      const fabricatedBlocks = [
        {
          type: 'transmission',
          speaker: 'Dr. Marcus Sterling',
          medium: 'acoustic_bleed',
          acousticSourceNodeId: 'fabricated-secret-lab-99',
          content: 'Can anyone hear me?',
        },
      ];

      const invalidResult = validateAndNormalizeVocalization(fabricatedBlocks, auditory);
      expect(invalidResult.error).toContain('is not a valid adjacent chamber link');
      expect(invalidResult.normalizedBlocks).toHaveLength(0);
    });
  });

  describe('formatVocalizationPromptDirective Amendments (Amendments 3, 4, 6, 8)', () => {
    it('generates mandatory conversational reply directive with extracted utterance (Amendment 8)', () => {
      const auditory = buildAuditoryContext(
        baseContext,
        'I turn to Jules Mercer and say, "Can you bypass the security lock?"'
      );
      const directive = formatVocalizationPromptDirective(auditory);

      expect(directive).toContain('[MANDATORY CONVERSATIONAL REPLY: You MUST include a dialogue block from Jules Mercer answering the player\'s statement: "Can you bypass the security lock?"]');
    });

    it('injects somatic and psychological sourcing separating player from companions (Amendment 4)', () => {
      const hypothermicContext = EngineTurnContextSchema.parse({
        ...baseContext,
        consequenceState: {
          inventory: [],
          player_injuries: ['Hypothermia stage 2'],
          psychological_status: 'DISTRESSED',
        },
      });

      const auditory = buildAuditoryContext(hypothermicContext);
      const directive = formatVocalizationPromptDirective(auditory);

      expect(directive).toContain('Player Character (Dr. Aria Bell): Psychological status is DISTRESSED (Injuries: Hypothermia stage 2).');
      expect(directive).toContain('Companion absence of status is silence and vigilance—NEVER default to PANICKED, and NEVER project player hypothermia, shock, or injuries onto companions.');
    });

    it('injects authored camouflage leak guidance only during high tension (Amendment 3)', () => {
      const castWithCamouflage = baseContext.cast.map((c) =>
        c.id === 'char-jules'
          ? {
              ...c,
              expressionProfile: {
                ...c.expressionProfile!,
                camouflageLeakGuidance:
                  'Staccato stuttering slips into frenzied whispers about the air vents.',
              },
            }
          : c
      );

      const lowTensionContext = EngineTurnContextSchema.parse({
        ...baseContext,
        cast: castWithCamouflage,
        runtime: {
          ...baseContext.runtime,
          tension: 3,
          phase: 'MANIFEST',
        },
      });

      const lowTensionDirective = formatVocalizationPromptDirective(
        buildAuditoryContext(lowTensionContext)
      );
      expect(lowTensionDirective).not.toContain('[AUTHORED CAMOUFLAGE LEAK DIRECTIVES]');

      const highTensionContext = EngineTurnContextSchema.parse({
        ...baseContext,
        cast: castWithCamouflage,
        runtime: {
          ...baseContext.runtime,
          tension: 8,
          phase: 'CLIMAX',
        },
      });

      const highTensionDirective = formatVocalizationPromptDirective(
        buildAuditoryContext(highTensionContext)
      );
      expect(highTensionDirective).toContain('[AUTHORED CAMOUFLAGE LEAK DIRECTIVES]');
      expect(highTensionDirective).toContain('Jules Mercer: Under escalating climax tension, surface composure fractures: Staccato stuttering slips into frenzied whispers about the air vents.');
    });

    it('appends one-directional epistemic constraints when acoustic links exist (Amendment 6)', () => {
      const auditory = buildAuditoryContext(baseContext);
      const directive = formatVocalizationPromptDirective(auditory);

      expect(directive).toContain('[ACOUSTIC BLEED & EPISTEMIC CONSTRAINTS]');
      expect(directive).toContain('The overheard character does not know they were heard. Their dialogue must not acknowledge, react to, or reference the listener unless the medium is explicitly two-way');
    });
  });

  describe('vocal capability enforcement (Item 12)', () => {
    it('evaluateVocalCapability: VOCAL_FULL impaired denies full-voice deliveries and allows whispers', () => {
      const state = { impairedCapabilities: ['VOCAL_FULL' as const] };

      // full-voice deliveries: spoken, shout, strained denied with VOCAL_FULL
      for (const delivery of FULL_VOICE_DELIVERIES) {
        const result = evaluateVocalCapability(delivery, state);
        expect(result.allowed).toBe(false);
        expect(result.reasonCode).toBe('CAPABILITY_IMPAIRED');
        expect(result.impairedSlot).toBe('VOCAL_FULL');
        expect(result.provenance).toContain('VOCAL_FULL');
      }

      // whisper deliveries: whisper, mutter allowed
      for (const delivery of WHISPER_DELIVERIES) {
        const result = evaluateVocalCapability(delivery, state);
        expect(result.allowed).toBe(true);
        expect(result.reasonCode).toBe('ALLOWED');
      }

      // synthetic delivery allowed
      expect(evaluateVocalCapability('synthetic', state).allowed).toBe(true);
    });

    it('evaluateVocalCapability: VOCAL_WHISPER impaired denies whispers and allows full-voice deliveries', () => {
      const state = { impairedCapabilities: ['VOCAL_WHISPER' as const] };

      // whisper deliveries denied with VOCAL_WHISPER
      for (const delivery of WHISPER_DELIVERIES) {
        const result = evaluateVocalCapability(delivery, state);
        expect(result.allowed).toBe(false);
        expect(result.reasonCode).toBe('CAPABILITY_IMPAIRED');
        expect(result.impairedSlot).toBe('VOCAL_WHISPER');
        expect(result.provenance).toContain('VOCAL_WHISPER');
      }

      // full-voice deliveries allowed
      for (const delivery of FULL_VOICE_DELIVERIES) {
        const result = evaluateVocalCapability(delivery, state);
        expect(result.allowed).toBe(true);
        expect(result.reasonCode).toBe('ALLOWED');
      }
    });

    it('evaluateVocalCapability: both VOCAL_FULL and VOCAL_WHISPER impaired denies all vocal deliveries with respective slots', () => {
      const state = { impairedCapabilities: ['VOCAL_FULL' as const, 'VOCAL_WHISPER' as const] };

      // full-voice denied with VOCAL_FULL
      for (const delivery of FULL_VOICE_DELIVERIES) {
        const result = evaluateVocalCapability(delivery, state);
        expect(result.allowed).toBe(false);
        expect(result.reasonCode).toBe('CAPABILITY_IMPAIRED');
        expect(result.impairedSlot).toBe('VOCAL_FULL');
      }

      // whisper denied with VOCAL_WHISPER
      for (const delivery of WHISPER_DELIVERIES) {
        const result = evaluateVocalCapability(delivery, state);
        expect(result.allowed).toBe(false);
        expect(result.reasonCode).toBe('CAPABILITY_IMPAIRED');
        expect(result.impairedSlot).toBe('VOCAL_WHISPER');
      }
    });

    it('evaluateVocalCapability: completely unimpaired allows all deliveries', () => {
      const emptyState = { impairedCapabilities: [] };
      const nullState = null;

      for (const delivery of [...FULL_VOICE_DELIVERIES, ...WHISPER_DELIVERIES, 'synthetic' as const]) {
        expect(evaluateVocalCapability(delivery, emptyState).allowed).toBe(true);
        expect(evaluateVocalCapability(delivery, nullState).allowed).toBe(true);
        expect(checkVocalCapability(delivery).allowed).toBe(true);
      }
    });

    it('evaluateVocalCapability: supports characterId indirection and CapabilityLedger', () => {
      const ledger = {
        'char-jules': { impairedCapabilities: ['VOCAL_FULL' as const] },
        'char-marcus': { impairedCapabilities: ['VOCAL_WHISPER' as const] },
      };

      const julesShout = evaluateVocalCapability('char-jules', 'shout', ledger);
      expect(julesShout.allowed).toBe(false);
      expect(julesShout.impairedSlot).toBe('VOCAL_FULL');

      const julesWhisper = evaluateVocalCapability('char-jules', 'whisper', ledger);
      expect(julesWhisper.allowed).toBe(true);

      const marcusWhisper = evaluateVocalCapability('char-marcus', 'whisper', ledger);
      expect(marcusWhisper.allowed).toBe(false);
      expect(marcusWhisper.impairedSlot).toBe('VOCAL_WHISPER');
    });

    it('validateAndNormalizeVocalization: enforces vocal capability checks against AuditoryContext.capabilities', () => {
      // Jules Mercer has VOCAL_FULL impaired
      const capabilities = {
        'char-jules': { impairedCapabilities: ['VOCAL_FULL' as const] },
      };

      const auditory = buildAuditoryContext(
        baseContext,
        undefined,
        undefined,
        undefined,
        null,
        capabilities
      );

      // Dialogue with default delivery (spoken) from Jules is denied with VOCAL_FULL
      const fullVoiceDialogue = [
        {
          type: 'dialogue',
          speaker: 'Jules Mercer',
          content: 'We need to get out through the vents.',
        },
      ];

      const resFull = validateAndNormalizeVocalization(fullVoiceDialogue, auditory);
      expect(resFull.error).toContain('vocal capability impaired: VOCAL_FULL');
      expect(resFull.normalizedBlocks).toHaveLength(0);
      expect(resFull.denialReceipts).toHaveLength(1);
      expect(resFull.denialReceipts![0]).toEqual({
        allowed: false,
        reasonCode: 'CAPABILITY_IMPAIRED',
        provenance: expect.stringContaining('VOCAL_FULL'),
        impairedSlot: 'VOCAL_FULL',
      });

      // Dialogue with whisper delivery from Jules is allowed
      const whisperDialogue = [
        {
          type: 'dialogue',
          speaker: 'Jules Mercer',
          delivery: 'whisper',
          content: 'Keep quiet, something is in the ducts.',
        },
      ];

      const resWhisper = validateAndNormalizeVocalization(whisperDialogue, auditory);
      expect(resWhisper.error).toBeNull();
      expect(resWhisper.normalizedBlocks).toHaveLength(1);
      expect(resWhisper.normalizedBlocks[0].delivery).toBe('whisper');
      expect(resWhisper.denialReceipts).toEqual([]);

      // Both slots impaired denies even whispered dialogue
      const doubleImpairedAuditory = buildAuditoryContext(
        baseContext,
        undefined,
        undefined,
        undefined,
        null,
        {
          'char-jules': { impairedCapabilities: ['VOCAL_FULL' as const, 'VOCAL_WHISPER' as const] },
        }
      );

      const resDouble = validateAndNormalizeVocalization(whisperDialogue, doubleImpairedAuditory);
      expect(resDouble.error).toContain('vocal capability impaired: VOCAL_WHISPER');
      expect(resDouble.denialReceipts![0].impairedSlot).toBe('VOCAL_WHISPER');
    });
  });

  describe('resolveAcousticAudience (Item 13)', () => {
    const baseTopology: LocationTopology = {
      nodes: ['room-hub', 'room-office', 'room-lab', 'room-storage', 'room-deep-vault'],
      connections: [
        // room-hub <-> room-office (door with acoustic bleed)
        {
          from: 'room-hub',
          to: 'room-office',
          kind: 'door',
          status: 'OPEN',
          acousticBleed: true,
        },
        // room-hub <-> room-lab (solid door without acoustic bleed)
        {
          from: 'room-hub',
          to: 'room-lab',
          kind: 'heavy_door',
          status: 'OPEN',
          acousticBleed: false,
        },
        // room-hub <-> room-storage (hermetically sealed bulkhead)
        {
          from: 'room-hub',
          to: 'room-storage',
          kind: 'bulkhead',
          status: 'SEALED',
          sealed: true,
          acousticBleed: true, // sealed takes precedence over acousticBleed
        },
        // room-office <-> room-deep-vault (distance = 2 from room-hub)
        {
          from: 'room-office',
          to: 'room-deep-vault',
          kind: 'corridor',
          status: 'OPEN',
          acousticBleed: true,
        },
      ],
    };

    const characterPlacements: Record<string, string> = {
      'char-hub-1': 'room-hub',
      'char-hub-2': 'room-hub',
      'char-office': 'room-office',
      'char-lab': 'room-lab',
      'char-storage': 'room-storage',
      'char-deep-vault': 'room-deep-vault',
    };

    it('returns empty audience [] for internal medium regardless of delivery or character placements', () => {
      const resSpoken = resolveAcousticAudience(
        'internal',
        baseTopology,
        'room-hub',
        characterPlacements,
        'spoken'
      );
      expect(resSpoken).toEqual([]);

      const resWhisper = resolveAcousticAudience(
        'internal',
        baseTopology,
        'room-hub',
        characterPlacements,
        'whisper'
      );
      expect(resWhisper).toEqual([]);

      const resShout = resolveAcousticAudience(
        'internal',
        baseTopology,
        'room-hub',
        characterPlacements,
        'shout'
      );
      expect(resShout).toEqual([]);

      const resDefault = resolveAcousticAudience(
        'internal',
        baseTopology,
        'room-hub',
        characterPlacements
      );
      expect(resDefault).toEqual([]);
    });

    it('returns only same-node characters for direct medium with whisper or mutter delivery', () => {
      // whisper delivery
      const resWhisper = resolveAcousticAudience(
        'direct',
        baseTopology,
        'room-hub',
        characterPlacements,
        'whisper'
      );
      expect(resWhisper).toEqual(['char-hub-1', 'char-hub-2']);

      // mutter delivery
      const resMutter = resolveAcousticAudience(
        'direct',
        baseTopology,
        'room-hub',
        characterPlacements,
        'mutter'
      );
      expect(resMutter).toEqual(['char-hub-1', 'char-hub-2']);
    });

    it('propagates direct spoken delivery to same-node plus adjacent nodes with acousticBleed: true', () => {
      // room-office has acousticBleed: true
      // room-lab has acousticBleed: false
      // room-storage is sealed
      // room-deep-vault is distance 2
      const resSpoken = resolveAcousticAudience(
        'direct',
        baseTopology,
        'room-hub',
        characterPlacements,
        'spoken'
      );
      expect(resSpoken).toEqual(['char-hub-1', 'char-hub-2', 'char-office']);

      // delivery omitted defaults to spoken
      const resDefault = resolveAcousticAudience(
        'direct',
        baseTopology,
        'room-hub',
        characterPlacements
      );
      expect(resDefault).toEqual(['char-hub-1', 'char-hub-2', 'char-office']);
    });

    it('excludes adjacent nodes with acousticBleed: false or sealed connections for spoken delivery', () => {
      const audience = resolveAcousticAudience(
        'direct',
        baseTopology,
        'room-hub',
        characterPlacements,
        'spoken'
      );

      // room-lab is directly adjacent but acousticBleed is false
      expect(audience).not.toContain('char-lab');

      // room-storage is directly adjacent but sealed: true and status: 'SEALED'
      expect(audience).not.toContain('char-storage');
    });

    it('allows spoken delivery through open acoustic portals and unsealed connections with bleed', () => {
      const portalTopology: LocationTopology = {
        connections: [
          { from: 'room-hub', to: 'room-portal-1', openAcousticPortal: true },
          { from: 'room-hub', to: 'room-portal-2', acousticPortal: 'open' },
          { from: 'room-hub', to: 'room-portal-3', portal: 'open' },
          { from: 'room-hub', to: 'room-portal-4', kind: 'portal', status: 'OPEN' },
          { from: 'room-hub', to: 'room-portal-5', bleed: true },
          { from: 'room-hub', to: 'room-portal-6', kind: 'vent', status: 'open' },
        ],
      };

      const portalCharacters = {
        'char-hub': 'room-hub',
        'char-p1': 'room-portal-1',
        'char-p2': 'room-portal-2',
        'char-p3': 'room-portal-3',
        'char-p4': 'room-portal-4',
        'char-p5': 'room-portal-5',
        'char-p6': 'room-portal-6',
      };

      const res = resolveAcousticAudience(
        'direct',
        portalTopology,
        'room-hub',
        portalCharacters,
        'spoken'
      );

      expect(res).toEqual([
        'char-hub',
        'char-p1',
        'char-p2',
        'char-p3',
        'char-p4',
        'char-p5',
        'char-p6',
      ]);
    });

    it('propagates direct shout to all directly adjacent connected nodes regardless of acousticBleed or sealed status', () => {
      const resShout = resolveAcousticAudience(
        'direct',
        baseTopology,
        'room-hub',
        characterPlacements,
        'shout'
      );

      // Same room + all 3 directly connected rooms: office, lab, storage
      // room-deep-vault is distance 2 and must NOT be included
      expect(resShout).toEqual([
        'char-hub-1',
        'char-hub-2',
        'char-lab',
        'char-office',
        'char-storage',
      ]);
      expect(resShout).not.toContain('char-deep-vault');
    });

    it('propagates non-direct broadcast mediums (intercom, broadcast, vent) to all directly adjacent connected nodes', () => {
      const intercomRes = resolveAcousticAudience(
        'intercom',
        baseTopology,
        'room-hub',
        characterPlacements
      );
      expect(intercomRes).toEqual([
        'char-hub-1',
        'char-hub-2',
        'char-lab',
        'char-office',
        'char-storage',
      ]);

      const broadcastRes = resolveAcousticAudience(
        'broadcast',
        baseTopology,
        'room-hub',
        characterPlacements
      );
      expect(broadcastRes).toEqual([
        'char-hub-1',
        'char-hub-2',
        'char-lab',
        'char-office',
        'char-storage',
      ]);

      const ventRes = resolveAcousticAudience(
        'vent',
        baseTopology,
        'room-hub',
        characterPlacements
      );
      expect(ventRes).toEqual([
        'char-hub-1',
        'char-hub-2',
        'char-lab',
        'char-office',
        'char-storage',
      ]);
    });

    it('strictly excludes non-adjacent nodes (graph distance >= 2) across all mediums and deliveries', () => {
      // Test across whisper, spoken, shout, intercom, broadcast, vent
      const modes: Array<{ medium: string; delivery?: string }> = [
        { medium: 'direct', delivery: 'whisper' },
        { medium: 'direct', delivery: 'spoken' },
        { medium: 'direct', delivery: 'shout' },
        { medium: 'intercom' },
        { medium: 'broadcast' },
        { medium: 'vent' },
      ];

      for (const { medium, delivery } of modes) {
        const audience = resolveAcousticAudience(
          medium,
          baseTopology,
          'room-hub',
          characterPlacements,
          delivery
        );
        expect(audience).not.toContain('char-deep-vault');
      }
    });

    it('handles Map characterNodes identically to Record and sorts deterministically', () => {
      const charMap = new Map<string, string>([
        ['char-zulu', 'room-hub'],
        ['char-alpha', 'room-hub'],
        ['char-bravo', 'room-office'],
      ]);

      const res = resolveAcousticAudience(
        'direct',
        baseTopology,
        'room-hub',
        charMap,
        'spoken'
      );

      // Deterministically sorted: alpha, bravo, zulu
      expect(res).toEqual(['char-alpha', 'char-bravo', 'char-zulu']);
    });

    it('deduplicates character IDs and handles edge cases gracefully', () => {
      // Empty character mapping returns empty audience
      expect(resolveAcousticAudience('direct', baseTopology, 'room-hub', {})).toEqual([]);

      // Invalid or empty source node returns empty audience
      expect(
        resolveAcousticAudience('direct', baseTopology, '', characterPlacements)
      ).toEqual([]);

      // Topology with no connections returns only same-room characters for non-internal
      const isolatedTopology: LocationTopology = { connections: [] };
      expect(
        resolveAcousticAudience('direct', isolatedTopology, 'room-hub', characterPlacements, 'shout')
      ).toEqual(['char-hub-1', 'char-hub-2']);

      // Multiple connections between same two nodes: if one is sealed but second carries bleed, bleed succeeds
      const multiEdgeTopology: LocationTopology = {
        connections: [
          { from: 'room-hub', to: 'room-annex', status: 'SEALED', sealed: true },
          { from: 'room-hub', to: 'room-annex', kind: 'vent', acousticBleed: true },
        ],
      };
      const annexChars = { 'char-hub': 'room-hub', 'char-annex': 'room-annex' };
      expect(
        resolveAcousticAudience('direct', multiEdgeTopology, 'room-hub', annexChars, 'spoken')
      ).toEqual(['char-annex', 'char-hub']);

      // Directed connection obeying directionality
      const directedTopology: LocationTopology = {
        connections: [
          { from: 'room-other', to: 'room-hub', acousticBleed: true, directed: true },
        ],
      };
      // Sound at room-hub cannot propagate backwards against directed connection
      expect(
        resolveAcousticAudience('direct', directedTopology, 'room-hub', {
          'char-hub': 'room-hub',
          'char-other': 'room-other',
        }, 'spoken')
      ).toEqual(['char-hub']);
    });
  });
});

