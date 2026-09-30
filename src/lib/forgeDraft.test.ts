import { describe, expect, it } from 'vitest';
import {
  validateForgeDraft,
  compileForgeDraft,
  compileForgeDraftOrThrow,
  ForgeCompilationError,
} from './forgeCompiler';
import {
  prepareBlueprintExport,
  compileBlueprintDraft,
} from './compileBlueprintDraft';
import { ForgeDraft, ForgeDraftSchema } from '../types/forge';
import { BlueprintSchema } from '../types';
import { useAppStore } from '../store/useAppStore';

describe('Phase 3D-1: Forge Draft Contract, Review Validation, and Compiler Boundary', () => {
  it('1. allows an incomplete draft during authoring without failing schema parsing', () => {
    const rawIncompleteDraft = {
      title: 'Work In Progress',
      startingVector: 'SOMATIC' as const,
      startingTier: 'GATEWAY' as const,
      deathContract: {
        powerBudget: 'Standard mortal and physical constraints.',
        deathMetaphysics: 'mundane' as const,
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
    };

    const parsed = ForgeDraftSchema.safeParse(rawIncompleteDraft);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBe('Work In Progress');
      expect(parsed.data.startingVector).toBe('SOMATIC');
      expect(parsed.data.startingTier).toBe('GATEWAY');
      expect(parsed.data.cast).toEqual([]);
      expect(parsed.data.setting?.location).toBe('');
      expect(parsed.data.deathContract).toBeDefined();
      expect(parsed.data.fearContract).toBeDefined();
    }
  });

  it('2. fails review compilation for incomplete drafts with structured field-addressable errors without fabricating facts', () => {
    const incompleteDraft: Partial<ForgeDraft> = {
      title: '', // Missing title
      premise: '', // Missing premise
      setting: { location: '' }, // Missing location
      cast: [], // Missing cast
    };

    const validation = validateForgeDraft(incompleteDraft);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveProperty('identity.title');
    expect(validation.errors).toHaveProperty('premise');
    expect(validation.errors).toHaveProperty('setting.location');
    expect(validation.errors).toHaveProperty('cast');

    const result = compileForgeDraft(incompleteDraft);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toHaveProperty('identity.title');
      expect(result.errors['identity.title'][0]).toContain('required');
      expect(result.errors['setting.location'][0]).toContain('required');
      expect(result.errors['cast'][0]).toContain('required');
    }

    expect(() => compileForgeDraftOrThrow(incompleteDraft)).toThrow(ForgeCompilationError);
  });

  it('3. rejects placeholder values (like Unknown) as author-supplied facts during review validation', () => {
    const placeholderDraft: Partial<ForgeDraft> = {
      identity: { title: 'Unknown Enclosure' },
      premise: 'Valid authored premise.',
      setting: { location: 'Unknown' },
      cast: [
        {
          id: 'c1',
          name: 'Unknown',
          role: 'Subject',
          description: '',
          personality: '',
          goals: '',
          traits: [],
          isUserCharacter: false,
          behaviorVector: 'ADAPTIVE',
          isEntity: false,
        },
      ],
    };

    const validation = validateForgeDraft(placeholderDraft);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveProperty('identity.title');
    expect(validation.errors).toHaveProperty('setting.location');
    expect(validation.errors).toHaveProperty('cast[0].name');
  });

  it('4. compiles a complete, valid authored draft into canonical Blueprint and review artifact', () => {
    const validDraft: ForgeDraft = {
      id: 'draft-obsidian-01',
      title: 'Obsidian Sub-Level 4',
      premise: 'Survive containment breach in deep bedrock laboratory.',
      globalPremise: 'Survive containment breach in deep bedrock laboratory.',
      startingVector: 'SOMATIC',
      startingTier: 'GATEWAY',
      environmentalRules: 'Atmosphere vents sulfur every 300 seconds.',
      constraints: ['No unassisted voice transmission through bulkheads'],
      contentScale: 4,
      contentLevelDescription: 'Visceral Tension',
      identity: {
        title: 'Obsidian Sub-Level 4',
        version: '1.0',
        author: 'Dr. Aris Calder',
        thematicAnchor: 'Biological decay and isolation',
      },
      setting: {
        location: 'Bedrock Research Facility',
        atmosphere: 'High-pressure mist, echoing coolant pumps',
        timePeriod: '1984',
      },
      deathContract: {
        metaphysics: 'mundane',
        deathMetaphysics: 'mundane',
        powerBudget: 'Biological decay and containment specimens.',
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
      depictionContract: {
        dramaticRegister: 'Clinical dread',
        directness: 'Visceral mechanics',
        aftermath: 'Irreversible consequences',
        ambiguityHandling: 'Preserve epistemic gaps',
        specialBoundaries: 'Strict containment adherence',
      },
      cast: [
        {
          id: 'c-aris',
          name: 'Dr. Aris',
          role: 'Lead Biochemist',
          description: 'Obsessive researcher clutching specimen logs.',
          behaviorVector: 'ADAPTIVE',
          isEntity: false,
          isUserCharacter: true,
          traits: ['Cautious', 'Observant'],
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'AIRLOCK_01' },
        },
        {
          id: 'c-husk',
          name: 'The Husk',
          role: 'Antagonist',
          description: 'Reanimated containment specimen stalking the sub-level.',
          disposition: 'VILLAIN',
          behaviorVector: 'RELENTLESS',
          isEntity: true,
          isUserCharacter: false,
          traits: ['Relentless', 'Silent'],
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'SUB_LAB_B' },
        },
      ],
      userCharacterId: 'c-aris',
      userOpeningAim: {
        castMemberId: 'c-aris',
        disposition: 'NONE_DECLARED',
        aimText: '',
        reviewedAt: Date.now(),
      },
      perspectives: [
        {
          role: 'PROTAGONIST',
          framingDirective: 'Somatic claustrophobia',
          startingSemanticState: 'ISOLATED',
        },
      ],
      topology: {
        startingNodeId: 'AIRLOCK_01',
        nodes: ['AIRLOCK_01', 'SUB_LAB_B', 'DECON_CHAMBER'],
        connections: [
          'AIRLOCK_01 -> SUB_LAB_B',
          {
            from: 'SUB_LAB_B',
            to: 'DECON_CHAMBER',
            kind: 'PHYSICAL',
            userInitiated: true,
            legacyUpgraded: true,
            authority: 'user',
          },
        ],
      },
      references: ['containment_protocol.md', 'incident_log.txt'],
      narrativeRules: {
        incitingIncident: 'Primary coolant valve ruptures.',
        phaseDirectives: {
          buildup: 'Escalate ambient seismic vibrations.',
        },
        currentTensionLevel: 'buildup',
        keyPlotElements: ['Restore auxiliary power'],
      },
      characters: [],
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        pursuitReviews: { 'c-aris': 'REVIEWED_NONE', 'c-husk': 'REVIEWED_NONE' },
        valueAnchors: [],
        characterPursuits: [],
      },
    };

    const result = compileForgeDraft(validDraft);
    expect(result.success).toBe(true);

    if (result.success) {
      const { artifact, blueprint } = result;

      // Accepted by canonical BlueprintSchema
      const validatedSchema = BlueprintSchema.parse(blueprint);
      expect(validatedSchema.identity.title).toBe('Obsidian Sub-Level 4');
      expect(validatedSchema.setting.location).toBe('Bedrock Research Facility');
      expect(validatedSchema.cast).toHaveLength(2);
      expect(validatedSchema.cast[0].name).toBe('Dr. Aris');

      // Canonical connection normalization check
      expect(blueprint.topology.connections).toEqual([
        {
          from: 'AIRLOCK_01',
          to: 'SUB_LAB_B',
          kind: 'PHYSICAL',
          userInitiated: true,
          legacyUpgraded: true,
        },
        {
          from: 'SUB_LAB_B',
          to: 'DECON_CHAMBER',
          kind: 'PHYSICAL',
          userInitiated: true,
          legacyUpgraded: true,
          authority: 'user',
        },
      ]);

      // Artifact integrity
      expect(artifact.sourceDraftId).toBe('draft-obsidian-01');
      expect(artifact.fileName).toBe(
        'containment_protocol_md_incident_log_txt_obsidian_sub_level_4.json'
      );
      expect(typeof artifact.compiledAt).toBe('number');
      expect(JSON.parse(artifact.json)).toEqual(blueprint);
    }
  });

  it('5. compilation creates a review artifact without mutating App store runtime state', () => {
    const appBefore = useAppStore.getState();

    const validDraft: ForgeDraft = {
      id: 'draft-isolation-02',
      title: 'Cryo Station Epsilon',
      premise: 'Restore orbital stabilization before thermal venting.',
      startingVector: 'COGNITIVE',
      startingTier: 'LATENT',
      identity: {
        title: 'Cryo Station Epsilon',
        version: '1.0',
      },
      setting: {
        location: 'Orbital Station',
      },
      deathContract: {
        metaphysics: 'mundane',
        deathMetaphysics: 'mundane',
        powerBudget: 'Orbital vacuum and venting.',
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
      depictionContract: {
        dramaticRegister: 'Hard sci-fi dread',
        directness: 'Unflinching mechanical failures',
        aftermath: 'Hypoxia and vacuum exposure irreversible',
        ambiguityHandling: 'Computer telemetry remains fragmented',
      },
      cast: [
        {
          id: 'c1',
          name: 'Chief Engineer Kael',
          role: 'Engineer',
          behaviorVector: 'ADAPTIVE',
          isEntity: false,
          isUserCharacter: true,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'STATION_CORE' },
        },
        {
          id: 'c2',
          name: 'The Venting Intelligence',
          role: 'Antagonist',
          description: 'Rogue station system venting atmosphere to isolate the crew.',
          disposition: 'VILLAIN',
          behaviorVector: 'RELENTLESS',
          isEntity: true,
          isUserCharacter: false,
          presenceDisposition: { kind: 'NONLOCAL' },
        },
      ],
      userCharacterId: 'c1',
      userOpeningAim: {
        castMemberId: 'c1',
        disposition: 'NONE_DECLARED',
        aimText: '',
        reviewedAt: Date.now(),
      },
      perspectives: [],
      topology: { startingNodeId: 'STATION_CORE', nodes: ['STATION_CORE'], connections: [] },
      references: [],
      narrativeRules: {
        incitingIncident: '',
        phaseDirectives: {},
        currentTensionLevel: 'buildup',
        keyPlotElements: [],
      },
      characters: [],
      constraints: [],
      contentScale: 3,
      contentLevelDescription: 'Standard',
      environmentalRules: '',
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        pursuitReviews: { c1: 'REVIEWED_NONE', c2: 'REVIEWED_NONE' },
        valueAnchors: [],
        characterPursuits: [],
      },
    };

    const artifact = prepareBlueprintExport(validDraft, { draftRevision: 1, sourceBaselineRevision: 1 });
    expect(artifact.blueprint.identity.title).toBe('Cryo Station Epsilon');

    const appAfter = useAppStore.getState();

    // Verify Engine session and App runtime state are completely unchanged
    expect(appAfter.sessionId).toBe(appBefore.sessionId);
    expect(appAfter.turnCount).toBe(appBefore.turnCount);
    expect(appAfter.participationContext).toBe(appBefore.participationContext);
    expect(appAfter.currentNodeId).toBe(appBefore.currentNodeId);
    expect(appAfter.phase).toBe(appBefore.phase);
  });

  it('6. compileBlueprintDraft remains backward compatible as a loose transformer while prepareBlueprintExport enforces review validation', () => {
    const partialRaw = {
      title: 'Legacy Draft',
      globalPremise: 'Old premise structure',
    };

    // compileBlueprintDraft transforms into standard Blueprint with schema defaults
    const looseCompiled = compileBlueprintDraft(partialRaw);
    expect(looseCompiled.identity.title).toBe('Legacy Draft');
    expect(looseCompiled.premise).toBe('Old premise structure');

    // prepareBlueprintExport enforces strict authoring validation (missing location & cast)
    expect(() =>
      prepareBlueprintExport(partialRaw, { draftRevision: 1, sourceBaselineRevision: 1 })
    ).toThrow(ForgeCompilationError);
  });

  it('7. validates topology endpoints, startingNodeId, expandable anchors, and cast opening placement', () => {
    const invalidTopologyDraft: ForgeDraft = {
      id: 'draft-invalid-topo',
      title: 'Test Facility',
      premise: 'Valid premise statement for validation test.',
      setting: { location: 'Underground Facility', atmosphere: 'Dark', timePeriod: '1999' },
      startingVector: 'SOMATIC',
      startingTier: 'GATEWAY',
      deathContract: {
        metaphysics: 'mundane',
        deathMetaphysics: 'mundane',
        powerBudget: 'Facility physical constraints.',
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
      depictionContract: {
        dramaticRegister: 'Visceral',
        directness: 'High directness',
        aftermath: 'Grave aftermath',
        ambiguityHandling: 'Explicit uncertainty',
        specialBoundaries: 'None',
      },
      cast: [
        {
          id: 'char-1',
          name: 'Tech Specialist',
          role: 'Technician',
          isEntity: false,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'NODE_UNKNOWN_ROOM' },
        },
        {
          id: 'char-2',
          name: 'Dr. Mara',
          role: 'Researcher',
          isEntity: false,
          // Missing presenceDisposition and starting_location
        },
      ],
      topology: {
        startingNodeId: 'INVALID_START_NODE',
        nodes: ['NODE_A', 'NODE_B'],
        connections: [
          { from: 'NODE_A', to: 'NON_EXISTENT_TARGET', kind: 'PHYSICAL', userInitiated: true },
        ],
        anchors: [
          {
            id: 'anchor-bad',
            parentNodeId: 'NON_EXISTENT_PARENT',
            label: 'Floating Anchor',
            description: 'Nowhere',
          },
        ],
      },
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        pursuitReviews: {
          'char-1': 'REVIEWED_NONE',
          'char-2': 'REVIEWED_NONE',
        },
        valueAnchors: [],
        characterPursuits: [],
      },
    };

    const validation = validateForgeDraft(invalidTopologyDraft);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveProperty('topology.startingNodeId');
    expect(validation.errors).toHaveProperty('topology.connections[0].to');
    expect(validation.errors).toHaveProperty('topology.anchors[0].parentNodeId');
    expect(validation.errors).toHaveProperty('cast[0].presenceDisposition');
    expect(validation.errors).toHaveProperty('cast[1].presenceDisposition');
  });

  it('rejects blank clock IDs in dramaticSpine.impendingClocks during review validation', () => {
    const blankClockDraft = {
      cast: [],
      dramaticSpine: {
        impendingClocks: [
          {
            id: '',
            name: 'The Rime',
            domain: 'ENVIRONMENTAL',
            advanceMode: { mode: 'TIME', rate: 'SLOW', minutesPerPoint: 10 },
          },
          {
            id: '   ',
            name: 'The Thaw',
            domain: 'ENVIRONMENTAL',
            advanceMode: { mode: 'TIME', rate: 'SLOW', minutesPerPoint: 10 },
          },
        ],
      },
    };

    const validation = validateForgeDraft(blankClockDraft);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveProperty('dramaticSpine.impendingClocks[0].id');
    expect(validation.errors['dramaticSpine.impendingClocks[0].id']).toEqual([
      'Clock ID must be a non-empty string',
    ]);
    expect(validation.errors).toHaveProperty('dramaticSpine.impendingClocks[1].id');
    expect(validation.errors['dramaticSpine.impendingClocks[1].id']).toEqual([
      'Clock ID must be a non-empty string',
    ]);
  });
});
