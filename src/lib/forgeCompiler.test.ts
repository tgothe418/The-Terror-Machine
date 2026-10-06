import { describe, it, expect } from 'vitest';
import {
  compileForgeDraft,
  compileForgeDraftOrThrow,
  validateForgeDraft,
  projectAcceptedStagedCandidates,
  ForgeCompilationError,
} from './forgeCompiler';
import { ForgeDraft, ForgeSourceAnalysis } from '../types/forge';

describe('forgeCompiler Voice & Acoustic Dossier Compilation', () => {
  const baseValidDraft: ForgeDraft = {
    id: 'draft-mortuary-voice',
    title: 'The Black Iron Mortuary',
    premise: 'A quarantined subterranean mortuary where the dead whisper through copper drains.',
    globalPremise: 'A quarantined subterranean mortuary where the dead whisper through copper drains.',
    identity: {
      title: 'The Black Iron Mortuary',
      version: '1.0',
      author: 'Acoustic Archivist',
      thematicAnchor: 'Somatopsychic acoustic terror',
    },
    setting: {
      location: 'Black Iron Subterranean Complex',
      atmosphere: 'Sulfurous cold and hum of copper conduit pipes',
      timePeriod: '1948 Post-War Quarantine',
    },
    startingVector: 'SOMATIC',
    startingTier: 'GATEWAY',
    topology: {
      startingNodeId: 'AUTOPSY_THEATRE',
      nodes: ['AUTOPSY_THEATRE', 'DRAINAGE_CRYPT', 'REFRIGERATION_VAULT'],
      nodeDefinitions: [
        {
          id: 'AUTOPSY_THEATRE',
          label: 'Autopsy Theatre',
          description: 'Surgical amphitheatre lined with tiered slate seats and blood drains.',
        },
        {
          id: 'DRAINAGE_CRYPT',
          label: 'Drainage Crypt',
          description: 'Low-ceilinged sump collecting wash-off from the zinc tables.',
        },
        {
          id: 'REFRIGERATION_VAULT',
          label: 'Refrigeration Vault',
          description: 'Heavy insulated steel doors humming with ammonia coolant.',
        },
      ],
      connections: [
        { from: 'AUTOPSY_THEATRE', to: 'DRAINAGE_CRYPT', kind: 'PHYSICAL' },
        { from: 'DRAINAGE_CRYPT', to: 'REFRIGERATION_VAULT', kind: 'PHYSICAL' },
      ],
      anchors: [],
    },
    depictionContract: {
      dramaticRegister: 'Somatopsychic dread grounded in physical pathology',
      directness: 'Visceral surgical and acoustic directness within subterranean chambers',
      aftermath: 'Irreversible necrotic contamination and sensory rot',
      ambiguityHandling: 'Preserve mechanical acoustic provenance without explaining origin',
      specialBoundaries: 'None',
    },
    horrorGrammar: {
      valueBaselineReview: 'REVIEWED_NONE',
      valueAnchors: [],
      characterPursuits: [],
      pursuitReviews: {
        'char-ross': 'REVIEWED_NONE',
        'char-holt': 'REVIEWED_NONE',
        'char-entity-41': 'REVIEWED_NONE',
      },
    },
    antagonistProfile: {
      name: 'Entity-41',
      preyCohort: [
        {
          id: 'char-holt',
          name: 'Officer Holt',
          vulnerabilities: ['Acoustic resonance'],
          psychologicalTriggers: ['Subterranean isolation'],
          breakingPoint: 'Sensory overload',
        },
      ],
    },
    deathContract: {
      powerBudget: 'Subterranean acoustic resonance capable of bursting capillaries',
      deathMetaphysics: 'mundane',
      seatSuccession: {
        'char-holt': 'recruit',
      },
    },
    fearContract: {
      fearlessness: { 'char-ross': 0.2, 'char-holt': 0.1, 'char-entity-41': 1.0 },
      mortalityBelief: {},
      threatWeights: { life: 1.0, freedom: 1.0, identity: 1.0 },
      lambdaDecay: 0.35,
      residueRatio: 0.25,
      preyEnterThreshold: 0.70,
      preyExitThreshold: 0.40,
      somaticBands: { band1: 0.25, band2: 0.50, band3: 0.75, band4: 0.90 },
      releaseValves: [],
      villainGazeAuthorized: false,
      submitResponse: {},
    },
    cast: [
      {
        id: 'char-ross',
        name: 'Dr. Ross',
        role: 'Chief Pathologist',
        description: 'Exhausted medical officer documenting anomalies under surgical lights.',
        isUserCharacter: false,
        isEntity: false,
        behaviorVector: 'ADAPTIVE',
        presenceDisposition: { kind: 'AT_NODE', nodeId: 'AUTOPSY_THEATRE' },
        starting_location: 'AUTOPSY_THEATRE',
        traits: ['Hyper-Vigilance', 'Somatic Tremor'],
        goals: 'Isolate the resonant frequency in the bone marrow',
        personality: 'Fastidious, speaks only to clarify autopsy findings',
        psychological_status: 'Tremor in surgical hands when sound stops',
        expressionProfile: {
          communicationModes: ['spoken', 'mediated'],
          expressionGuidance: 'Precise clinical cadence, speaking into overhead dictation microphone.',
          silenceGuidance: 'Falls abruptly silent when background hum shifts pitch.',
          cadenceNotes: 'Rapid, clipped terminal clauses; breath inhalations caught mid-throat.',
          voiceTone: 'Dry academic gravel with strained vocal cord compression.',
          vocalTells: ['swallows dryly between incisions', 'sibilant whistling on s-sounds'],
          lexiconNotes: 'Rigid anatomical terminology, refuses colloquial descriptors.',
          camouflageLeakGuidance:
            'When panic breaches threshold, clinical vocabulary dissolves into rhythmic counting.',
        },
        seed: {
          where: 'AUTOPSY_THEATRE',
          doing: { mode: 'SUSPENDED' },
          condition: {},
          charge: { band: 'calm' },
          knows: [],
          wants: { kind: 'state', text: 'Isolate the resonant frequency in the bone marrow' },
          bonds: [],
        },
      },
      {
        id: 'char-holt',
        name: 'Officer Holt',
        role: 'Quarantine Guard',
        description: 'Sentry stationed at the decontamination bulkhead.',
        isUserCharacter: false,
        isEntity: false,
        behaviorVector: 'INSURGENT',
        presenceDisposition: { kind: 'AT_NODE', nodeId: 'DRAINAGE_CRYPT' },
        starting_location: 'DRAINAGE_CRYPT',
        traits: ['Paranoia', 'Claustrophobia'],
        goals: 'Prevent any specimen from ascending the hoist',
        personality: 'Gripping service revolver through rubberized glove',
        psychological_status: 'Ear canals bleeding from subsonic resonance',
        // Holt has NO expression profile to test graceful defaults
        seed: {
          where: 'DRAINAGE_CRYPT',
          doing: { mode: 'SUSPENDED' },
          condition: {},
          charge: { band: 'calm' },
          knows: [],
          wants: { kind: 'state', text: 'Prevent any specimen from ascending the hoist' },
          bonds: [],
        },
      },
      {
        id: 'char-entity-41',
        name: 'Entity-41',
        role: 'Acoustic Aberration',
        description: 'Translucent vibrational mass vibrating within the drainage grates.',
        disposition: 'VILLAIN',
        isUserCharacter: false,
        isEntity: true,
        behaviorVector: 'ADAPTIVE',
        presenceDisposition: { kind: 'NONLOCAL' },
        traits: ['Epistemic Dread'],
        goals: 'Mimic human vocal registers to draw personnel deeper into the drains',
        seed: {
          where: 'DRAINAGE_CRYPT',
          doing: { mode: 'SUSPENDED' },
          condition: {},
          charge: { band: 'calm' },
          knows: [],
          wants: { kind: 'state', text: 'Mimic human vocal registers to draw personnel deeper into the drains' },
          bonds: [],
        },
        expressionProfile: {
          communicationModes: ['nonverbal', 'mediated'],
          expressionGuidance: 'Echoing playback of dead crew members through ventilation ducting.',
          silenceGuidance: 'Complete sonic vacuum preceding a pressure stroke.',
          cadenceNotes: 'Erratic tempo shifting from 0.5x crawl to 3x hyper-speed.',
          voiceTone: 'Metallic tape-decay distortion with resonant room flutter.',
          vocalTells: ['splices phonemes unnaturally', 'reproduces dead relatives radio calls'],
          lexiconNotes: 'Fragmentary quotes extracted from historical mortuary logs.',
          camouflageLeakGuidance:
            'Acoustic mask tears during visceral climax to reveal deafening pressurized steam hiss.',
        },
      },
    ],
  };

  it('compiles a Forge draft and preserves all authored Voice & Acoustic Dossier fields', () => {
    const result = compileForgeDraft(baseValidDraft);
    expect(result.success).toBe(true);
    expect(result.blueprint).toBeDefined();

    const compiledCast = result.blueprint?.cast;
    expect(compiledCast).toHaveLength(3);

    // Dr. Ross voice dossier verification
    const ross = compiledCast?.find((c) => c.id === 'char-ross');
    expect(ross).toBeDefined();
    expect(ross?.expressionProfile).toEqual({
      communicationModes: ['spoken', 'mediated'],
      expressionGuidance: 'Precise clinical cadence, speaking into overhead dictation microphone.',
      silenceGuidance: 'Falls abruptly silent when background hum shifts pitch.',
      cadenceNotes: 'Rapid, clipped terminal clauses; breath inhalations caught mid-throat.',
      voiceTone: 'Dry academic gravel with strained vocal cord compression.',
      vocalTells: ['swallows dryly between incisions', 'sibilant whistling on s-sounds'],
      lexiconNotes: 'Rigid anatomical terminology, refuses colloquial descriptors.',
      camouflageLeakGuidance:
        'When panic breaches threshold, clinical vocabulary dissolves into rhythmic counting.',
    });

    // Officer Holt (no expression profile) verification
    const holt = compiledCast?.find((c) => c.id === 'char-holt');
    expect(holt).toBeDefined();
    expect(holt?.expressionProfile).toBeUndefined();

    // Entity-41 voice dossier verification
    const entity = compiledCast?.find((c) => c.id === 'char-entity-41');
    expect(entity).toBeDefined();
    expect(entity?.expressionProfile).toEqual({
      communicationModes: ['nonverbal', 'mediated'],
      expressionGuidance: 'Echoing playback of dead crew members through ventilation ducting.',
      silenceGuidance: 'Complete sonic vacuum preceding a pressure stroke.',
      cadenceNotes: 'Erratic tempo shifting from 0.5x crawl to 3x hyper-speed.',
      voiceTone: 'Metallic tape-decay distortion with resonant room flutter.',
      vocalTells: ['splices phonemes unnaturally', 'reproduces dead relatives radio calls'],
      lexiconNotes: 'Fragmentary quotes extracted from historical mortuary logs.',
      camouflageLeakGuidance:
        'Acoustic mask tears during visceral climax to reveal deafening pressurized steam hiss.',
    });
  });

  it('compiles minimal expression profile with default vocalTells: []', () => {
    const minimalDraft: ForgeDraft = {
      ...baseValidDraft,
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        valueAnchors: [],
        characterPursuits: [],
        pursuitReviews: {
          'char-minimal': 'REVIEWED_NONE',
          'char-minimal-villain': 'REVIEWED_NONE',
        },
      },
      cast: [
        {
          id: 'char-minimal',
          name: 'Surgeon Bell',
          role: 'Surgeon',
          description: 'Junior autopsy prosector.',
          isUserCharacter: false,
          isEntity: false,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'AUTOPSY_THEATRE' },
          expressionProfile: {
            communicationModes: ['spoken'],
            expressionGuidance: 'Subdued whispering.',
          },
          seed: {
            where: 'AUTOPSY_THEATRE',
            doing: { mode: 'SUSPENDED' },
            condition: {},
            charge: { band: 'calm' },
            knows: [],
            wants: { kind: 'state', text: 'Assist in autopsy' },
            bonds: [],
          },
        },
        {
          id: 'char-minimal-villain',
          name: 'The Resident',
          role: 'Antagonist',
          description: 'Unseen presence behind the refrigeration vault.',
          disposition: 'VILLAIN',
          isUserCharacter: false,
          isEntity: true,
          presenceDisposition: { kind: 'NONLOCAL' },
          seed: {
            where: 'AUTOPSY_THEATRE',
            doing: { mode: 'SUSPENDED' },
            condition: {},
            charge: { band: 'calm' },
            knows: [],
            wants: { kind: 'state', text: 'Haunt' },
            bonds: [],
          },
        },
      ],
    };

    const result = compileForgeDraft(minimalDraft);
    expect(result.success).toBe(true);

    const compiledBell = result.blueprint?.cast[0];
    expect(compiledBell?.expressionProfile).toEqual({
      communicationModes: ['spoken'],
      expressionGuidance: 'Subdued whispering.',
    });
  });

  it('compileForgeDraftOrThrow returns deeply frozen artifact with compiled blueprint', () => {
    const artifact = compileForgeDraftOrThrow(baseValidDraft);
    expect(artifact).toBeDefined();
    expect(artifact.blueprint).toBeDefined();
    expect(artifact.fileName).toContain('mortuary');
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.blueprint)).toBe(true);
  });

  it('rejects invalid cast member names (empty, whitespace, or banned cliches)', () => {
    const emptyNameDraft: ForgeDraft = {
      ...baseValidDraft,
      cast: [
        {
          id: 'char-empty',
          name: '   ',
          description: 'Empty name test.',
        },
      ],
    };
    const validationEmpty = validateForgeDraft(emptyNameDraft);
    expect(validationEmpty.valid).toBe(false);
    expect(validationEmpty.errors['cast[0].name']).toBeDefined();

    const bannedNameDraft: ForgeDraft = {
      ...baseValidDraft,
      cast: [
        {
          id: 'char-cliche',
          name: 'Arthur Penhaligon',
          description: 'Cliché name test.',
        },
      ],
    };
    const validationBanned = validateForgeDraft(bannedNameDraft);
    expect(validationBanned.valid).toBe(false);
    expect(validationBanned.errors['cast[0].name']).toBeDefined();
    expect(validationBanned.errors['cast[0].name'][0]).toContain('Banned AI cliché name');
  });

  it('rejects drafts with no VILLAIN in cast (villain invariant)', () => {
    const noVillainDraft: ForgeDraft = {
      ...baseValidDraft,
      cast: baseValidDraft.cast.map((m) =>
        m.id === 'char-entity-41'
          ? { ...m, isEntity: false, disposition: 'SURVIVOR' as const, role: 'Survivor' }
          : m
      ),
    };
    const validation = validateForgeDraft(noVillainDraft);
    expect(validation.valid).toBe(false);
    expect(validation.errors['cast']).toBeDefined();
    expect(validation.errors['cast'].join(' ')).toContain('VILLAIN');

    const withExplicitVillain = validateForgeDraft(baseValidDraft);
    expect(withExplicitVillain.errors['cast']).toBeUndefined();

    // Entity with no explicit disposition passes
    const entityWithoutDispositionDraft: ForgeDraft = {
      ...baseValidDraft,
      cast: [
        {
          id: 'char-ross',
          name: 'Dr. Ross',
          role: 'Chief Pathologist',
          description: 'Mortal survivor.',
          disposition: 'SURVIVOR',
          isEntity: false,
        },
        {
          id: 'char-am',
          name: 'Allied Mastercomputer',
          role: 'Overlord',
          description: 'Hostile machine intelligence.',
          isEntity: true,
        },
      ],
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        pursuitReviews: { 'char-ross': 'REVIEWED_NONE', 'char-am': 'REVIEWED_NONE' },
        valueAnchors: [],
        characterPursuits: [],
      },
    };
    const entityValidation = validateForgeDraft(entityWithoutDispositionDraft);
    expect(entityValidation.errors['cast']).toBeUndefined();

    // Role Antagonist with no disposition passes
    const antagonistRoleDraft: ForgeDraft = {
      ...baseValidDraft,
      cast: [
        {
          id: 'char-ross',
          name: 'Dr. Ross',
          role: 'Chief Pathologist',
          description: 'Mortal survivor.',
          disposition: 'SURVIVOR',
          isEntity: false,
        },
        {
          id: 'char-nemesis',
          name: 'The Inquisitor',
          role: 'Antagonist',
          description: 'Mortal human villain pursuing the survivors.',
          isEntity: false,
        },
      ],
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        pursuitReviews: { 'char-ross': 'REVIEWED_NONE', 'char-nemesis': 'REVIEWED_NONE' },
        valueAnchors: [],
        characterPursuits: [],
      },
    };
    const antagonistValidation = validateForgeDraft(antagonistRoleDraft);
    expect(antagonistValidation.errors['cast']).toBeUndefined();

    // When no villain is in cast but antagonistProfile exists, error guides the author with the name
    const draftWithAntagonistProfile: ForgeDraft = {
      ...noVillainDraft,
      antagonistProfile: {
        name: 'AM',
        kind: 'ENTITY',
        apparatusControls: [],
        sadisticDirectives: [],
        telemetryFeeds: [],
      },
    };
    const profileValidation = validateForgeDraft(draftWithAntagonistProfile);
    expect(profileValidation.valid).toBe(false);
    expect(profileValidation.errors['cast'].join(' ')).toContain('Antagonist "AM" is named in the antagonist profile');
  });

  it('applyBaselineToDraft backfills villain cast member from antagonist_profile candidate', () => {
    const rawMortalsDraft: ForgeDraft = {
      title: 'Hate Chamber',
      premise: 'Testing AM scenario.',
      startingVector: 'SOMATIC',
      startingTier: 'MANIFEST',
      deathContract: {
        metaphysics: 'mundane',
        deathMetaphysics: 'mundane',
        powerBudget: 'Cybernetic chamber constraints.',
        seatSuccession: {},
      },
      fearContract: {
        fearlessness: {},
        mortalityBelief: {},
        threatWeights: { life: 1.0, freedom: 1.0, identity: 1.0 },
        lambdaDecay: 0.35,
        residueRatio: 0.25,
        preyEnterThreshold: 0.70,
        preyExitThreshold: 0.40,
        somaticBands: { band1: 0.25, band2: 0.50, band3: 0.75, band4: 0.90 },
        releaseValves: [],
        villainGazeAuthorized: false,
        submitResponse: {},
      },
      cast: [
        {
          id: 'char-elena',
          name: 'Elena Mercer',
          role: 'Researcher',
          disposition: 'SURVIVOR',
          isEntity: false,
          seed: {
            where: 'DRAINAGE_CRYPT',
            doing: { mode: 'SUSPENDED' },
            condition: {},
            charge: { band: 'calm' },
            knows: [],
            wants: { kind: 'state', text: 'Survive' },
            bonds: [],
          },
        },
      ],
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        pursuitReviews: { 'char-elena': 'REVIEWED_NONE' },
        valueAnchors: [],
        characterPursuits: [],
      },
    };

    const analysis = {
      id: 'analysis-am',
      sourceRecord: {
        id: 'rec-am',
        kind: 'text' as const,
        fileName: 'am_story.txt',
        addedAt: new Date().toISOString(),
      },
      summary: 'AM summary',
      candidates: [
        {
          id: 'cand-antag-am',
          sourceId: 'rec-am',
          target: 'antagonist_profile' as const,
          proposedValue: {
            name: 'AM',
            kind: 'ENTITY',
            apparatusControls: [],
            sadisticDirectives: [],
            telemetryFeeds: [],
          },
          evidenceIds: ['ev-1'],
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
      ],
      unknowns: [],
      evidence: [
        {
          id: 'ev-1',
          sourceId: 'rec-am',
          quote: 'AM controls the complex.',
        },
      ],
    };

    const compiledDraft = projectAcceptedStagedCandidates(rawMortalsDraft, {
      [analysis.id]: analysis as unknown as ForgeSourceAnalysis,
    });
    expect(compiledDraft.cast).toHaveLength(2);
    expect(compiledDraft.cast?.some((c) => c.id === 'villain-am' && c.disposition === 'VILLAIN')).toBe(true);
  });

  it('throws ForgeCompilationError when compileForgeDraftOrThrow is called with invalid draft', () => {
    const brokenDraft = {
      ...baseValidDraft,
      cast: [],
    };
    expect(() => compileForgeDraftOrThrow(brokenDraft)).toThrow(ForgeCompilationError);
  });

  it('validates drafts with universal telemetry feeds (all, *, global) without unknown node errors', () => {
    const draftWithFeeds: ForgeDraft = {
      ...baseValidDraft,
      antagonistProfile: {
        kind: 'APPARATUS',
        name: 'The Central Overseer',
        apparatusControls: [
          {
            id: 'ctrl-1',
            name: 'Ventilation Damper',
            kind: 'MECHANICAL',
            affectedNodeIds: ['all'],
            availableActions: ['SEAL'],
            status: 'ONLINE',
          },
        ],
        telemetryFeeds: [
          {
            nodeId: 'all',
            feedType: 'OPTICAL_CAM',
            status: 'ONLINE',
            label: 'Overhead Surveillance Cam 1',
          },
          {
            nodeId: 'global',
            feedType: 'ACOUSTIC_PICKUP',
            status: 'ONLINE',
            label: 'Intercom Array',
          },
        ],
        sadisticDirectives: ['Observe subject deterioration'],
        preyCohort: [],
      },
    };

    const validation = validateForgeDraft(draftWithFeeds);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual({});
  });

  describe('§4c Villain-Protagonist Invariant Validation', () => {
    const vsiDraft: ForgeDraft = {
      ...baseValidDraft,
      villainProtagonist: true,
      cast: [
        {
          id: 'char-v',
          name: 'Patrick Bateman',
          role: 'Vice President',
          disposition: 'VILLAIN',
          isEntity: false,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'AUTOPSY_THEATRE' },
          seed: {
            where: 'AUTOPSY_THEATRE',
            doing: { mode: 'SUSPENDED' },
            condition: {},
            charge: { band: 'calm' },
            knows: [],
            wants: { kind: 'state', text: 'Maintain facade' },
            bonds: [],
          },
        },
        {
          id: 'char-s',
          name: 'Elena Mercer',
          role: 'Researcher',
          disposition: 'SURVIVOR',
          isEntity: false,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'DRAINAGE_CRYPT' },
          seed: {
            where: 'DRAINAGE_CRYPT',
            doing: { mode: 'SUSPENDED' },
            condition: {},
            charge: { band: 'calm' },
            knows: [],
            wants: { kind: 'state', text: 'Survive' },
            bonds: [],
          },
        },
        {
          id: 'char-i',
          name: 'Detective Donald Kimball',
          role: 'Investigator',
          disposition: 'SURVIVOR',
          isEntity: false,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'REFRIGERATION_VAULT' },
          seed: {
            where: 'REFRIGERATION_VAULT',
            doing: { mode: 'SUSPENDED' },
            condition: {},
            charge: { band: 'calm' },
            knows: [],
            wants: { kind: 'state', text: 'Investigate disappearance' },
            bonds: [],
          },
        },
      ],
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        pursuitReviews: {
          'char-v': 'REVIEWED_NONE',
          'char-s': 'REVIEWED_NONE',
          'char-i': 'REVIEWED_NONE',
        },
        valueAnchors: [],
        characterPursuits: [],
      },
    };

    it('passes §4c validation for V+S+I cast when villainProtagonist is true', () => {
      const result = validateForgeDraft(vsiDraft);
      expect(result.valid).toBe(true);
      expect(result.errors['cast']).toBeUndefined();
    });

    it('fails §4c validation when villainProtagonist is true but would-be protagonist is non-villain', () => {
      // S marked as user character
      const invalidDraft: ForgeDraft = {
        ...vsiDraft,
        cast: [
          {
            ...vsiDraft.cast![0],
            isUserCharacter: false,
          },
          {
            ...vsiDraft.cast![1],
            isUserCharacter: true,
            seed: {
              where: 'DRAINAGE_CRYPT',
              doing: { mode: 'SUSPENDED' },
              condition: {},
              charge: { band: 'calm' },
              knows: [],
              circumstance: 'Trapped in the crypt',
              inclination: 'Escape',
              bonds: [],
            },
          },
          vsiDraft.cast![2],
        ],
      };

      const result = validateForgeDraft(invalidDraft);
      expect(result.valid).toBe(false);
      expect(result.errors['cast']).toBeDefined();
      expect(result.errors['cast'].join(' ')).toContain(
        '§4c villain-protagonist is set, but "Elena Mercer" would take the protagonist seat and is not a villain. Mark the villain-protagonist in cast (disposition VILLAIN) or unset villainProtagonist.'
      );
    });

    it('passes validation when villainProtagonist is false (regression)', () => {
      const unsetDraft: ForgeDraft = {
        ...vsiDraft,
        villainProtagonist: false,
        cast: [
          vsiDraft.cast![0],
          {
            ...vsiDraft.cast![1],
            isUserCharacter: true,
            seed: {
              where: 'DRAINAGE_CRYPT',
              doing: { mode: 'SUSPENDED' },
              condition: {},
              charge: { band: 'calm' },
              knows: [],
              circumstance: 'Trapped in the crypt',
              inclination: 'Escape',
              bonds: [],
            },
          },
          vsiDraft.cast![2],
        ],
      };

      const result = validateForgeDraft(unsetDraft);
      expect(result.valid).toBe(true);
      expect(result.errors['cast']).toBeUndefined();
    });
  });

  describe('§11 Death Contract Validation', () => {
    it('fails validation when deathContract is missing', () => {
      const draftWithoutDeathContract = {
        ...baseValidDraft,
        deathContract: undefined,
      };

      const result = validateForgeDraft(draftWithoutDeathContract);
      expect(result.valid).toBe(false);
      expect(result.errors['deathContract']).toBeDefined();
      expect(result.errors['deathContract'][0]).toContain('Death contract is required');
    });

    it('fails validation when powerBudget is empty', () => {
      const draftWithEmptyBudget = {
        ...baseValidDraft,
        deathContract: {
          powerBudget: '',
          deathMetaphysics: 'mundane' as const,
          seatSuccession: { 'char-holt': 'recruit' as const },
        },
      };

      const result = validateForgeDraft(draftWithEmptyBudget);
      expect(result.valid).toBe(false);
      expect(result.errors['deathContract.powerBudget']).toBeDefined();
    });

    it('fails validation when a cohort scenario lacks seatSuccession', () => {
      const cohortDraftNoSuccession = {
        ...baseValidDraft,
        deathContract: {
          powerBudget: 'Unstoppable acoustic vibrations',
          deathMetaphysics: 'mundane' as const,
          seatSuccession: {},
        },
      };

      const result = validateForgeDraft(cohortDraftNoSuccession);
      expect(result.valid).toBe(false);
      expect(result.errors['deathContract.seatSuccession']).toBeDefined();
      expect(result.errors['deathContract.seatSuccession'][0]).toContain(
        'Cohort scenarios require authored seatSuccession policies'
      );
    });

    it('passes validation when cohort scenario provides valid seatSuccession', () => {
      const result = validateForgeDraft(baseValidDraft);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual({});
    });
  });

  describe('§13 Fear Contract Validation', () => {
    it('fails validation when fearContract is missing', () => {
      const draftWithoutFearContract = {
        ...baseValidDraft,
        fearContract: undefined,
      };

      const result = validateForgeDraft(draftWithoutFearContract);
      expect(result.valid).toBe(false);
      expect(result.errors['fearContract']).toBeDefined();
      expect(result.errors['fearContract'][0]).toContain('Fear contract is required for scenario compilation');
    });

    it('fails validation when preyExitThreshold >= preyEnterThreshold', () => {
      const invalidThresholdsDraft = {
        ...baseValidDraft,
        fearContract: {
          ...baseValidDraft.fearContract!,
          preyEnterThreshold: 0.50,
          preyExitThreshold: 0.60,
        },
      };

      const result = validateForgeDraft(invalidThresholdsDraft);
      expect(result.valid).toBe(false);
      expect(result.errors['fearContract.preyExitThreshold']).toBeDefined();
      expect(result.errors['fearContract.preyExitThreshold'][0]).toContain('preyExitThreshold must be strictly less than preyEnterThreshold');
    });

    it('fails validation when lambdaDecay is out of bounds', () => {
      const outOfBoundsDraft = {
        ...baseValidDraft,
        fearContract: {
          ...baseValidDraft.fearContract!,
          lambdaDecay: 1.5,
        },
      };

      const result = validateForgeDraft(outOfBoundsDraft);
      expect(result.valid).toBe(false);
      expect(result.errors['fearContract.lambdaDecay']).toBeDefined();
    });

    it('passes validation when scenario provides valid fearContract', () => {
      const result = validateForgeDraft(baseValidDraft);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual({});
    });
  });

  describe('§14 Per-Villain Antagonist Profiles (B2)', () => {
    it('compiles draft.villains onto blueprint and merges castSeedPersona into cast', () => {
      const draftWithVillains: ForgeDraft = {
        ...baseValidDraft,
        villains: [
          {
            villainId: 'char-entity-41',
            name: 'Entity-41',
            operationalProfile: {
              name: 'Entity-41',
              kind: 'ENTITY',
              apparatusControls: [],
              sadisticDirectives: ['distort transmissions'],
              telemetryFeeds: [],
            },
            castSeedPersona: {
              description: 'Vibrational mass of dead frequencies.',
              personality: 'Malicious tape-decay intelligence.',
              goals: 'Drown survivors in acoustic feedback.',
              traits: ['Acoustic Mimicry', 'Resonant Horror'],
            },
          },
        ],
      };

      const result = compileForgeDraft(draftWithVillains);
      expect(result.success).toBe(true);
      expect(result.blueprint).toBeDefined();
      expect(result.blueprint?.villains).toBeDefined();
      expect(result.blueprint?.villains).toHaveLength(1);
      expect(result.blueprint?.villains![0].villainId).toBe('char-entity-41');
      expect(result.blueprint?.villains![0].operationalProfile?.kind).toBe('ENTITY');

      // Check cast merge: cast member char-entity-41 should receive castSeedPersona fields
      const entity = result.blueprint?.cast.find((c) => c.id === 'char-entity-41');
      expect(entity).toBeDefined();
      expect(entity?.description).toBe('Vibrational mass of dead frequencies.');
      expect(entity?.personality).toBe('Malicious tape-decay intelligence.');
      expect(entity?.goals).toBe('Drown survivors in acoustic feedback.');
      expect(entity?.traits).toEqual(['Acoustic Mimicry', 'Resonant Horror']);
    });

    it('preserves legacy blueprints without villains on compile', () => {
      const result = compileForgeDraft(baseValidDraft);
      expect(result.success).toBe(true);
      expect(result.blueprint?.villains).toBeUndefined();
    });
  });

  describe('Dramatic Spine Validation in Forge Draft', () => {
    it('records a dramaticSpine.milestoneConditions[0].referenceId error when CLOCK_CRISIS milestone references an unknown clock id', () => {
      const draftWithInvalidSpine: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'milestone-1',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'CLOCK_CRISIS',
              referenceId: 'unknown-clock-id',
              description: 'When unknown clock reaches crisis',
              satisfied: false,
            },
          ],
          impendingClocks: [
            {
              id: 'clock-subzero',
              name: 'Subzero Chill',
              domain: 'ENVIRONMENTAL',
              currentLevel: 0,
              advanceMode: { mode: 'TIME', rate: 'SLOW', minutesPerPoint: 5 },
              crisisThreshold: 80,
              manifestationCues: [],
            },
          ],
        },
      };

      const validation = validateForgeDraft(draftWithInvalidSpine);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeDefined();
      expect(
        validation.errors['dramaticSpine.milestoneConditions[0].referenceId'][0]
      ).toContain('unknown clock ID');
    });

    it('records error when milestone targets EXPOSITION_BASELINE (never fire)', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-baseline',
              targetPhase: 'EXPOSITION_BASELINE',
              kind: 'AUTHORED_TRIGGER',
              referenceId: 'trigger-tag',
              description: 'Baseline trigger',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].targetPhase']).toBeDefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[0].targetPhase'][0]).toContain('never fire');
    });

    it('records error when AUTHORED_TRIGGER referenceId is an uncompilable regex', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-bad-regex',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'AUTHORED_TRIGGER',
              referenceId: '([unclosed',
              description: 'Broken regex trigger',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeDefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId'][0]).toContain('not a compilable regex');
    });

    it('records error when AUTHORED_TRIGGER referenceId is missing or empty', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-empty-trigger',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'AUTHORED_TRIGGER',
              referenceId: '   ',
              description: 'Empty trigger',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeDefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId'][0]).toContain('match-everything');
    });

    it('validates successfully when DISCOVERY milestone matches placed clue case-insensitively', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        topology: {
          ...baseValidDraft.topology,
          nodeDefinitions: [
            {
              ...baseValidDraft.topology.nodeDefinitions![0],
              clues: [{ id: 'c1', label: 'Second Ledger' }],
            },
            baseValidDraft.topology.nodeDefinitions![1],
            baseValidDraft.topology.nodeDefinitions![2],
          ],
        },
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-disc-match',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'DISCOVERY',
              referenceId: 'second ledger',
              description: 'Finding the ledger',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeUndefined();
      expect(validation.errors['topology.nodeDefinitions[0].clues[0].label']).toBeUndefined();
      expect(validation.valid).toBe(true);
    });

    it('records error when DISCOVERY milestone matches no placed clue label but placed clues exist', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        topology: {
          ...baseValidDraft.topology,
          nodeDefinitions: [
            {
              ...baseValidDraft.topology.nodeDefinitions![0],
              clues: [{ id: 'c1', label: 'Torn Photograph' }],
            },
            baseValidDraft.topology.nodeDefinitions![1],
            baseValidDraft.topology.nodeDefinitions![2],
          ],
        },
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-disc-nomatch',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'DISCOVERY',
              referenceId: 'second ledger',
              description: 'Finding the ledger',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeDefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId'][0]).toContain('matches no placed clue label');
    });

    it('records warning when DISCOVERY milestone has no placed clues in blueprint, preserving validity', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-disc-warn',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'DISCOVERY',
              referenceId: 'whispered confession',
              description: 'Emergent whispered confession',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeUndefined();
      expect(validation.warnings?.['dramaticSpine.milestoneConditions[0].referenceId']).toBeDefined();
      expect(validation.warnings?.['dramaticSpine.milestoneConditions[0].referenceId'][0]).toContain('blueprint defines no placed clues');
      expect(validation.valid).toBe(true);
    });

    it('records error when node definition carries placed clue referenced by no DISCOVERY milestone', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        topology: {
          ...baseValidDraft.topology,
          nodeDefinitions: [
            {
              ...baseValidDraft.topology.nodeDefinitions![0],
              clues: [{ id: 'c1', label: 'Rusty Key' }],
            },
            baseValidDraft.topology.nodeDefinitions![1],
            baseValidDraft.topology.nodeDefinitions![2],
          ],
        },
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['topology.nodeDefinitions[0].clues[0].label']).toBeDefined();
      expect(validation.errors['topology.nodeDefinitions[0].clues[0].label'][0]).toContain('never affect pacing');
    });

    it('records error when node definition carries placed clue and dramaticSpine is omitted', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        topology: {
          ...baseValidDraft.topology,
          nodeDefinitions: [
            {
              ...baseValidDraft.topology.nodeDefinitions![0],
              clues: [{ id: 'c1', label: 'Rusty Key' }],
            },
            baseValidDraft.topology.nodeDefinitions![1],
            baseValidDraft.topology.nodeDefinitions![2],
          ],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['topology.nodeDefinitions[0].clues[0].label']).toBeDefined();
      expect(validation.errors['topology.nodeDefinitions[0].clues[0].label'][0]).toContain('never affect pacing');
    });

    it('records error when CLOCK_CRISIS milestone has empty referenceId', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-clock-empty',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'CLOCK_CRISIS',
              referenceId: '',
              description: 'Empty clock reference',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeDefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId'][0]).toContain('CLOCK_CRISIS milestone requires a non-empty referenceId');
    });

    it('records error when two milestones share the same id', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'dup-id',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'AUTHORED_TRIGGER',
              referenceId: 'some-trigger',
              description: 'First milestone',
              satisfied: false,
            },
            {
              id: 'dup-id',
              targetPhase: 'COMPLICATION_ENCLOSURE',
              kind: 'AUTHORED_TRIGGER',
              referenceId: 'other-trigger',
              description: 'Second milestone sharing id',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].id']).toBeUndefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[1].id']).toBeDefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[1].id'][0]).toContain('Duplicate milestone id: "dup-id"');
    });

    it('records error when COMPOSURE_THRESHOLD milestone has empty referenceId', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-composure-empty',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'COMPOSURE_THRESHOLD',
              referenceId: '',
              description: 'Empty composure target',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeDefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId'][0]).toContain(
        'COMPOSURE_THRESHOLD milestone requires a non-empty referenceId'
      );
    });

    it('records error when DISCOVERY milestone has empty referenceId', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-disc-empty',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'DISCOVERY',
              referenceId: '   ',
              description: 'Empty discovery target',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeDefined();
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId'][0]).toContain(
        'DISCOVERY milestone requires a non-empty referenceId'
      );
    });

    it('handles null, non-object, and non-string referenceId in milestoneConditions safely without throwing', () => {
      const draft = {
        ...baseValidDraft,
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            null,
            {
              id: 'm-num-ref',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'AUTHORED_TRIGGER',
              referenceId: 12345 as unknown as string,
              description: 'Numeric referenceId',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      expect(() => validateForgeDraft(draft)).not.toThrow();
      const validation = validateForgeDraft(draft);
      expect(validation.valid).toBe(false);
      expect(validation.errors['dramaticSpine.milestoneConditions[1].referenceId']).toBeDefined();
    });

    it('normalizes internal whitespace for cross-referencing between clues and milestones', () => {
      const draft: ForgeDraft = {
        ...baseValidDraft,
        topology: {
          ...baseValidDraft.topology,
          nodeDefinitions: [
            {
              ...baseValidDraft.topology.nodeDefinitions![0],
              clues: [{ id: 'c1', label: '  Second    Ledger  ' }],
            },
            baseValidDraft.topology.nodeDefinitions![1],
            baseValidDraft.topology.nodeDefinitions![2],
          ],
        },
        dramaticSpine: {
          dramaticQuestions: ['Will anyone escape?'],
          pacingProfile: 'BALANCED_HORROR',
          milestoneConditions: [
            {
              id: 'm-disc-spacing',
              targetPhase: 'INCITING_RUPTURE',
              kind: 'DISCOVERY',
              referenceId: 'second   ledger',
              description: 'Finding the ledger with divergent whitespace',
              satisfied: false,
            },
          ],
          impendingClocks: [],
        },
      };

      const validation = validateForgeDraft(draft);
      expect(validation.errors['dramaticSpine.milestoneConditions[0].referenceId']).toBeUndefined();
      expect(validation.errors['topology.nodeDefinitions[0].clues[0].label']).toBeUndefined();
      expect(validation.valid).toBe(true);
    });
  });
});


