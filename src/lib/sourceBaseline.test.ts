import { describe, it, expect } from 'vitest';
import {
  buildSourceAnalysisFromBlueprint,
  applyCandidateToDraft,
  validateCandidateEdit,
  rejectCandidate,
  setCandidateReviewDecisionPure,
  sortCandidatesForApplication,
  validateAndNormalizeDocumentAnalysis,
  isCompleteAuthoredDepictionContract,
  reconcileDraftTopologyAndCast,
  normalizeCastDisposition,
} from './sourceBaseline';
import {
  ForgeDraft,
  ForgeSourceCandidate,
  ForgeSourceRecord,
  ForgeSourceEvidence,
  ForgeSourceAnalysisSchema,
  ForgeCandidateApplicationStateSchema,
  AntagonistProfile,
  FearContract,
} from '../types/forge';
import { compileForgeDraft } from './forgeCompiler';
import { normalizeBlueprint } from './normalizeBlueprint';

const defaultTestFearContract: FearContract = {
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
};

describe('sourceBaseline pure functions', () => {
  const sampleBlueprint = {
    title: 'The Drowned Bell',
    globalPremise: 'A submerged cathedral rings under oceanic pressure.',
    setting: {
      location: 'Sub-Atlantic Trench Sector 4',
      atmosphere: 'Suffocating briny darkness',
      timePeriod: '1974 Cold War Deep-Sea Survey',
    },
    environmentalRules: ['Pressure breaches seal all bulkheads', 'Oxygen reserves drain at 2x rate during tremors'],
    topology: {
      nodes: ['BATHYSPHERE_DOCK', 'SUBMERGED_NAVE', 'BELL_TOWER'],
      connections: [],
    },
    cast: [
      {
        id: 'char-diver',
        name: 'Diver Mercer',
        role: 'PROTAGONIST',
        description: 'Lead deep-sea salvage engineer.',
        isEntity: false,
        expressionProfile: {
          communicationModes: ['spoken', 'mediated'],
          expressionGuidance: 'Strained, clipped radio comms through heavy breathing apparatus.',
          silenceGuidance: 'Silence indicates acoustic distortion or sudden pressure drop.',
        },
      },
      {
        id: 'char-bellkeeper',
        name: 'The Bellkeeper',
        role: 'ANTAGONIST',
        description: 'An ancient encrusted entity guarding the bronze carillon.',
        isEntity: true,
        expressionProfile: {
          communicationModes: ['nonverbal', 'mediated'],
          expressionGuidance: 'Low-frequency resonance vibrating through steel hulls.',
        },
      },
    ],
    depictionContract: {
      dramaticRegister: 'Nautical claustrophobic dread',
      directness: 'High tactile pressure and audio distortion',
      aftermath: 'Decompression sickness and psychological ruin',
      ambiguityHandling: 'Deep sea acoustic echoes remain unexplained',
      specialBoundaries: 'None',
    },
  };

  it('builds a valid ForgeSourceAnalysis from native blueprint without mutating any draft', () => {
    const sourceRecord: ForgeSourceRecord = {
      id: 'src-test-1',
      fileName: 'drowned_bell.json',
      mimeType: 'application/json',
      kind: 'native_blueprint',
      receivedAt: Date.now(),
      fileSizeBytes: 4096,
    };
    const analysis = buildSourceAnalysisFromBlueprint(sourceRecord, sampleBlueprint);
    expect(analysis.status).toBe('completed');
    expect(analysis.sourceRecord.fileName).toBe('drowned_bell.json');
    expect(analysis.sourceRecord.kind).toBe('native_blueprint');
    expect(analysis.evidence.length).toBeGreaterThan(0);
    expect(analysis.candidates.length).toBeGreaterThan(0);

    // Candidates should all default to accepted and staged
    analysis.candidates.forEach((cand) => {
      expect(cand.reviewDecision).toBe('accepted');
      expect(cand.applicationState).toBe('staged');
      expect(cand.classification).toBe('evidence');
      expect(cand.evidenceIds.length).toBeGreaterThan(0);
    });

    const titleCand = analysis.candidates.find((c) => c.target === 'scenario_title');
    expect(titleCand?.proposedValue).toBe('The Drowned Bell');

    const exprCands = analysis.candidates.filter((c) => c.target === 'cast_expression_guidance');
    expect(exprCands.length).toBe(2);
    expect(exprCands[0].proposedValue).toEqual({
      communicationModes: ['spoken', 'mediated'],
      expressionGuidance: 'Strained, clipped radio comms through heavy breathing apparatus.',
      silenceGuidance: 'Silence indicates acoustic distortion or sudden pressure drop.',
    });
  });

  it('preserves unrelated authored fields when applying an accepted candidate', () => {
    const initialDraft: ForgeDraft = {
      id: 'draft-123',
      title: 'Original Title',
      premise: 'Original Premise',
      globalPremise: 'Original Premise',
      setting: {
        location: 'Original Location',
        atmosphere: 'Original Atmosphere',
        timePeriod: 'Original Period',
      },
      environmentalRules: ['Rule 1'],
      deathContract: { metaphysics: 'mundane', powerBudget: 'Standard constraints.', seatSuccession: {} },
      fearContract: defaultTestFearContract,
      cast: [
        {
          id: 'char-existing',
          name: 'Existing Character',
          role: 'Subject',
          description: 'Authored description',
          isEntity: false,
        },
      ],
      perspectives: [],
      topology: { nodes: ['ROOM_A'], connections: [] },
      references: ['authored_ref.pdf'],
    };

    const candidate: ForgeSourceCandidate = {
      id: 'cand-title',
      sourceId: 'src-1',
      classification: 'evidence',
      target: 'scenario_title',
      label: 'Scenario Title',
      explanation: 'Extracted title',
      evidenceIds: ['ev-1'],
      proposedValue: 'The Drowned Bell',
      reviewDecision: 'accepted',
      applicationState: 'staged',
    };

    const result = applyCandidateToDraft(initialDraft, candidate, 'source.json');
    expect(result.success).toBe(true);
    if (!result.success) return;
    const updated = result.draft;

    // Title should update
    expect(updated.title).toBe('The Drowned Bell');
    expect(updated.identity?.title).toBe('The Drowned Bell');

    // Unrelated fields MUST remain untouched
    expect(updated.premise).toBe('Original Premise');
    expect(updated.setting?.location).toBe('Original Location');
    expect(updated.cast?.[0].name).toBe('Existing Character');
    expect(updated.topology?.nodes).toEqual(['ROOM_A']);

    // Source filename added once to references for provenance
    expect(updated.references).toContain('source.json');
    expect(updated.references).toContain('authored_ref.pdf');
  });

  it('deduplicates rules, topology nodes, and reference attribution', () => {
    const initialDraft: ForgeDraft = {
      id: 'draft-123',
      deathContract: { metaphysics: 'mundane', powerBudget: 'Standard constraints.', seatSuccession: {} },
      fearContract: defaultTestFearContract,
      environmentalRules: ['Pressure rule'],
      topology: { nodes: ['BATHYSPHERE_DOCK'], connections: [] },
      references: ['drowned_bell.json'],
    };

    const ruleCand: ForgeSourceCandidate = {
      id: 'c1',
      sourceId: 's1',
      classification: 'evidence',
      target: 'environmental_rule',
      label: 'Rule',
      explanation: 'rule',
      evidenceIds: [],
      proposedValue: 'Pressure rule',
      reviewDecision: 'accepted',
      applicationState: 'staged',
    };

    const nodeCand: ForgeSourceCandidate = {
      id: 'c2',
      sourceId: 's1',
      classification: 'evidence',
      target: 'initial_topology_node',
      label: 'Node',
      explanation: 'node',
      evidenceIds: [],
      proposedValue: 'BATHYSPHERE_DOCK',
      reviewDecision: 'accepted',
      applicationState: 'staged',
    };

    const res1 = applyCandidateToDraft(initialDraft, ruleCand, 'drowned_bell.json');
    expect(res1.success).toBe(true);
    if (!res1.success) return;
    expect(res1.draft.environmentalRules).toEqual(['Pressure rule']);
    expect(res1.draft.references).toEqual(['drowned_bell.json']);

    const res2 = applyCandidateToDraft(res1.draft, nodeCand, 'drowned_bell.json');
    expect(res2.success).toBe(true);
    if (!res2.success) return;
    expect(res2.draft.topology?.nodes).toEqual(['BATHYSPHERE_DOCK']);
  });

  it('applies cast expression guidance candidate to target cast member', () => {
    const initialDraft: ForgeDraft = {
      id: 'draft-123',
      deathContract: { metaphysics: 'mundane', powerBudget: 'Standard constraints.', seatSuccession: {} },
      fearContract: defaultTestFearContract,
      cast: [
        {
          id: 'char-diver',
          name: 'Diver Mercer',
          role: 'PROTAGONIST',
          description: 'Lead engineer.',
          isEntity: false,
        },
      ],
    };

    const exprCand: ForgeSourceCandidate = {
      id: 'c-expr',
      sourceId: 's1',
      classification: 'evidence',
      target: 'cast_expression_guidance',
      label: 'Expression',
      explanation: 'Guidance',
      evidenceIds: ['ev-expr'],
      proposedValue: {
        communicationModes: ['spoken', 'mediated'],
        expressionGuidance: 'Static-heavy radio comms.',
      },
      targetCastMemberId: 'char-diver',
      reviewDecision: 'accepted',
      applicationState: 'staged',
    };

    const result = applyCandidateToDraft(initialDraft, exprCand);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.draft.cast?.[0].expressionProfile).toEqual({
      communicationModes: ['spoken', 'mediated'],
      expressionGuidance: 'Static-heavy radio comms.',
    });
  });

  it('normalizes document analysis with validateAndNormalizeDocumentAnalysis', () => {
    const sourceRecord: ForgeSourceRecord = {
      id: 'src-doc-1',
      fileName: 'manifest.pdf',
      mimeType: 'application/pdf',
      kind: 'document',
      receivedAt: Date.now(),
      fileSizeBytes: 8192,
    };

    const rawAnalysis = {
      summary: 'Test summary',
      evidence: [
        { id: 'ev-1', category: 'setting', claim: 'Underwater research post' },
        { id: 'ev-dep', category: 'other', claim: 'Depiction parameters' },
      ],
      candidates: [
        {
          id: 'c1',
          classification: 'evidence',
          target: 'setting_location',
          label: 'Location',
          explanation: 'Found in document',
          evidenceIds: ['ev-1'],
          proposedValue: 'Sector 7 Facility',
        },
        {
          id: 'c-dep',
          classification: 'evidence',
          target: 'depiction_contract',
          label: 'Depiction Contract',
          explanation: 'Depiction parameters',
          evidenceIds: ['ev-dep'],
          proposedValue: {
            dramaticRegister: 'Dread',
            directness: 'High directness',
            aftermath: 'Severe consequences',
            ambiguityHandling: 'Uncertain boundaries',
          },
        },
      ],
      unknowns: [{ id: 'u1', category: 'cast', question: 'How many crew survived?' }],
    };

    const normalized = validateAndNormalizeDocumentAnalysis(rawAnalysis, sourceRecord);
    expect(normalized.id).toBe('src-doc-1-analysis');
    expect(normalized.sourceRecord.id).toBe('src-doc-1');
    expect(normalized.candidates.length).toBe(2);
    expect(normalized.candidates[0].reviewDecision).toBe('accepted');
    expect(normalized.candidates[0].applicationState).toBe('staged');
    expect(normalized.candidates[0].sourceId).toBe('src-doc-1');
  });

  it('round-trips approved expression guidance through compile, export, and normalization', () => {
    const draft: ForgeDraft = {
      id: 'draft-full',
      title: 'The Drowned Bell',
      premise: 'Submerged nightmare under pressure.',
      setting: {
        location: 'Deep Trench',
        atmosphere: 'Dark and wet',
        timePeriod: '1974',
      },
      startingVector: 'COGNITIVE',
      startingTier: 'LATENT',
      deathContract: { metaphysics: 'mundane', powerBudget: 'Pressure constraints.', seatSuccession: {} },
      fearContract: defaultTestFearContract,
      depictionContract: {
        dramaticRegister: 'Psychological Dread',
        directness: 'Implied and atmospheric',
        aftermath: 'Lingering somatic unease',
        ambiguityHandling: 'Unresolved existential threat',
        specialBoundaries: 'No torture',
      },
      cast: [
        {
          id: 'char-mercer',
          name: 'Diver Mercer',
          role: 'PROTAGONIST',
          description: 'Engineer',
          isUserCharacter: true,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'SUB_LEVEL_1' },
          expressionProfile: {
            communicationModes: ['spoken', 'mediated'],
            expressionGuidance: 'Clipped radio transmissions.',
            silenceGuidance: 'Loss of signal.',
          },
        },
        {
          id: 'char-bellkeeper',
          name: 'The Bellkeeper',
          role: 'ANTAGONIST',
          description: 'An ancient encrusted entity guarding the bronze carillon.',
          disposition: 'VILLAIN',
          behaviorVector: 'RELENTLESS',
          isEntity: true,
          isUserCharacter: false,
          presenceDisposition: { kind: 'NONLOCAL' },
        },
      ],
      userCharacterId: 'char-mercer',
      userOpeningAim: {
        castMemberId: 'char-mercer',
        disposition: 'NONE_DECLARED',
        aimText: '',
        reviewedAt: Date.now(),
      },
      topology: {
        startingNodeId: 'SUB_LEVEL_1',
        nodes: ['SUB_LEVEL_1'],
        connections: [],
      },
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED_NONE',
        pursuitReviews: {
          'char-mercer': 'REVIEWED_NONE',
          'char-bellkeeper': 'REVIEWED_NONE',
        },
        valueAnchors: [],
        characterPursuits: [],
      },
    };

    const compileRes = compileForgeDraft(draft);
    expect(compileRes.success).toBe(true);
    if (!compileRes.success) return;

    // Verify expression profile is present in compiled blueprint artifact
    const compiledCastMember = compileRes.blueprint.cast?.[0];
    expect(compiledCastMember?.expressionProfile).toEqual({
      communicationModes: ['spoken', 'mediated'],
      expressionGuidance: 'Clipped radio transmissions.',
      silenceGuidance: 'Loss of signal.',
    });

    // Verify roundtrip through JSON and normalization
    const jsonExport = compileRes.artifact.json;
    const reimported = JSON.parse(jsonExport);
    const normalized = normalizeBlueprint(reimported);
    expect(normalized.cast?.[0].expressionProfile).toEqual({
      communicationModes: ['spoken', 'mediated'],
      expressionGuidance: 'Clipped radio transmissions.',
      silenceGuidance: 'Loss of signal.',
    });
  });

  it('validates candidate edits, decisions, and rejection without draft mutation', () => {
    const cand: ForgeSourceCandidate = {
      id: 'c1',
      sourceId: 's1',
      classification: 'evidence',
      target: 'setting_location',
      label: 'Location',
      explanation: 'loc',
      evidenceIds: [],
      proposedValue: 'Original Place',
      reviewDecision: 'accepted',
      applicationState: 'staged',
    };

    const validEdit = validateCandidateEdit(cand, 'Edited Sub-Sea Trench');
    expect(validEdit.valid).toBe(true);
    expect(validEdit.updatedCandidate?.proposedValue).toBe('Edited Sub-Sea Trench');
    expect(validEdit.updatedCandidate?.reviewDecision).toBe('accepted');
    expect(validEdit.updatedCandidate?.applicationState).toBe('staged');

    const emptyEdit = validateCandidateEdit(cand, '   ');
    expect(emptyEdit.valid).toBe(false);

    const rejected = rejectCandidate(cand);
    expect(rejected.reviewDecision).toBe('rejected');
    expect(rejected.applicationState).toBe('staged');

    const restored = setCandidateReviewDecisionPure(rejected, 'accepted');
    expect(restored.reviewDecision).toBe('accepted');
    expect(restored.applicationState).toBe('staged');
  });

  it('sorts candidates deterministically by priority: cast_seed before expression guidance', () => {
    const candidates: ForgeSourceCandidate[] = [
      {
        id: 'c-expr',
        sourceId: 's1',
        classification: 'evidence',
        target: 'cast_expression_guidance',
        label: 'Expr',
        explanation: '',
        evidenceIds: [],
        proposedValue: { communicationModes: ['spoken'], expressionGuidance: 'test' },
        targetCastMemberId: 'char-1',
        reviewDecision: 'accepted',
        applicationState: 'staged',
      },
      {
        id: 'c-loc',
        sourceId: 's1',
        classification: 'evidence',
        target: 'setting_location',
        label: 'Loc',
        explanation: '',
        evidenceIds: [],
        proposedValue: 'Trench',
        reviewDecision: 'accepted',
        applicationState: 'staged',
      },
      {
        id: 'c-cast',
        sourceId: 's1',
        classification: 'evidence',
        target: 'cast_seed',
        label: 'Cast',
        explanation: '',
        evidenceIds: [],
        proposedValue: {
          id: 'char-1',
          name: 'Dr. Mercer',
          role: 'PROTAGONIST',
          description: '',
          personality: '',
          goals: '',
          traits: [],
          isUserCharacter: false,
          behaviorVector: 'ADAPTIVE',
          isEntity: false,
          disposition: 'SURVIVOR' as const,
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      },
    ];

    const sorted = sortCandidatesForApplication(candidates);
    expect(sorted.map((c) => c.target)).toEqual([
      'cast_seed',
      'setting_location',
      'cast_expression_guidance',
    ]);
  });

  describe('cast_seed candidate application', () => {
    it('applies a valid cast_seed candidate to the draft and subsequent blueprint compilation succeeds', () => {
      const initialDraft: ForgeDraft = {
        id: 'draft-test-cast',
        title: 'Facility Omega',
        premise: 'Deep ocean containment breach.',
        setting: {
          location: 'Sector 4',
          atmosphere: 'Humid',
          timePeriod: 'Present',
        },
        startingVector: 'COGNITIVE',
        startingTier: 'LATENT',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Ocean breach constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        depictionContract: {
          dramaticRegister: 'Claustrophobic Survival',
          directness: 'Visceral environmental cues',
          aftermath: 'Psychological trauma',
          ambiguityHandling: 'Unexplained signals',
          specialBoundaries: 'None',
        },
        cast: [],
        topology: {
          startingNodeId: 'ENGINE_ROOM',
          nodes: ['ENGINE_ROOM'],
          connections: [],
        },
        userCharacterId: 'char-corvus',
        userOpeningAim: {
          castMemberId: 'char-corvus',
          disposition: 'NONE_DECLARED',
          aimText: '',
          reviewedAt: Date.now(),
        },
        horrorGrammar: {
          valueBaselineReview: 'REVIEWED_NONE',
          pursuitReviews: {},
          valueAnchors: [],
          characterPursuits: [],
        },
      };

      const castCandidate: ForgeSourceCandidate = {
        id: 'cand-cast-1',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'cast_seed',
        label: 'Cast Member: Chief Engineer Corvus',
        explanation: 'Extracted from crew manifest.',
        evidenceIds: ['ev-1'],
        proposedValue: {
          id: 'char-corvus',
          name: 'Chief Engineer Corvus',
          role: 'PROTAGONIST',
          description: 'Systems specialist handling bulkhead repairs.',
          personality: 'Cautious and methodical.',
          goals: 'Restore primary life support.',
          traits: ['Engine Technician', 'Cold Under Pressure'],
          isUserCharacter: true,
          behaviorVector: 'ADAPTIVE',
          isEntity: false,
          disposition: 'SURVIVOR' as const,
          presenceDisposition: { kind: 'AT_NODE', nodeId: 'ENGINE_ROOM' },
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const applyRes = applyCandidateToDraft(initialDraft, castCandidate, 'manifest.json');
      expect(applyRes.success).toBe(true);
      if (!applyRes.success) return;
      expect(applyRes.draft.cast?.length).toBe(1);
      expect(applyRes.draft.cast?.[0].id).toBe('char-corvus');
      expect(applyRes.draft.cast?.[0].name).toBe('Chief Engineer Corvus');
      expect(applyRes.draft.cast?.[0].role).toBe('PROTAGONIST');
      expect(applyRes.draft.references).toContain('manifest.json');

      // Villain invariant: compilation requires at least one VILLAIN in cast
      const villainCandidate: ForgeSourceCandidate = {
        id: 'cand-cast-villain',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'cast_seed',
        label: 'Cast Member: The Breach Entity',
        explanation: 'Extracted from crew manifest.',
        evidenceIds: ['ev-1'],
        proposedValue: {
          id: 'char-breach-entity',
          name: 'The Breach Entity',
          role: 'Antagonist',
          description: 'Containment breach predator hunting Sector 4.',
          personality: 'Relentless and silent.',
          goals: 'Breach every bulkhead.',
          traits: ['Relentless', 'Silent'],
          disposition: 'VILLAIN',
          isUserCharacter: false,
          behaviorVector: 'RELENTLESS',
          isEntity: true,
          presenceDisposition: { kind: 'NONLOCAL' },
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const applyVillain = applyCandidateToDraft(applyRes.draft, villainCandidate, 'manifest.json');
      expect(applyVillain.success).toBe(true);
      if (!applyVillain.success) return;
      expect(applyVillain.draft.cast?.length).toBe(2);
      expect(applyVillain.draft.cast?.[1].disposition).toBe('VILLAIN');

      const compileRes = compileForgeDraft(applyVillain.draft);
      expect(compileRes.success).toBe(true);
    });

    it('updates an existing member when proposedValue shares the same stable id', () => {
      const initialDraft: ForgeDraft = {
        id: 'draft-test-update',
        title: 'Facility Omega',
        premise: 'Deep ocean containment breach.',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Ocean breach constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        cast: [
          {
            id: 'char-corvus',
            name: 'Corvus',
            role: 'Subject',
            description: 'Old description',
            behaviorVector: 'ADAPTIVE',
          },
        ],
      };

      const updateCandidate: ForgeSourceCandidate = {
        id: 'cand-cast-update',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'cast_seed',
        label: 'Cast Member: Chief Corvus',
        explanation: 'Updated telemetry profile.',
        evidenceIds: [],
        proposedValue: {
          id: 'char-corvus',
          name: 'Chief Engineer Corvus',
          role: 'PROTAGONIST',
          description: 'Refined systems lead description.',
          personality: 'Methodical',
          goals: 'Restore life support',
          traits: ['Technician'],
          isUserCharacter: false,
          behaviorVector: 'ADAPTIVE',
          isEntity: false,
          disposition: 'SURVIVOR' as const,
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const applyRes = applyCandidateToDraft(initialDraft, updateCandidate);
      expect(applyRes.success).toBe(true);
      if (!applyRes.success) return;
      expect(applyRes.draft.cast?.length).toBe(1);
      expect(applyRes.draft.cast?.[0].id).toBe('char-corvus');
      expect(applyRes.draft.cast?.[0].name).toBe('Chief Engineer Corvus');
      expect(applyRes.draft.cast?.[0].role).toBe('PROTAGONIST');
      expect(applyRes.draft.cast?.[0].description).toBe('Refined systems lead description.');
    });

    it('appends a new member when id is different even if names are identical', () => {
      const initialDraft: ForgeDraft = {
        id: 'draft-test-append',
        title: 'Facility Omega',
        premise: 'Deep ocean containment breach.',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Ocean breach constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        cast: [
          {
            id: 'char-corvus-1',
            name: 'Corvus',
            role: 'PROTAGONIST',
            behaviorVector: 'ADAPTIVE',
          },
        ],
      };

      const duplicateNameCandidate: ForgeSourceCandidate = {
        id: 'cand-cast-2',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'cast_seed',
        label: 'Cast Member: Corvus',
        explanation: 'Another entity with the same name.',
        evidenceIds: [],
        proposedValue: {
          id: 'char-corvus-clone-2',
          name: 'Corvus',
          role: 'ANTAGONIST',
          description: 'Synthetic mimic',
          personality: 'Uncanny',
          goals: 'Infiltrate the crew',
          traits: ['Mimic'],
          isUserCharacter: false,
          behaviorVector: 'INSURGENT',
          isEntity: true,
          disposition: 'VILLAIN' as const,
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const applyRes = applyCandidateToDraft(initialDraft, duplicateNameCandidate);
      expect(applyRes.success).toBe(true);
      if (!applyRes.success) return;
      expect(applyRes.draft.cast?.length).toBe(2);
      expect(applyRes.draft.cast?.[0].id).toBe('char-corvus-1');
      expect(applyRes.draft.cast?.[1].id).toBe('char-corvus-clone-2');
      expect(applyRes.draft.cast?.[1].role).toBe('ANTAGONIST');
    });

    it('rejects invalid candidate values without corrupting the draft', () => {
      const initialDraft: ForgeDraft = {
        id: 'draft-test-invalid',
        title: 'Facility Omega',
        premise: 'Deep ocean containment breach.',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Ocean breach constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        cast: [
          {
            id: 'char-corvus-1',
            name: 'Corvus',
            role: 'PROTAGONIST',
            behaviorVector: 'ADAPTIVE',
          },
        ],
      };

      const invalidCandidate = {
        id: 'cand-cast-bad',
        sourceId: 'src-1',
        classification: 'evidence' as const,
        target: 'cast_seed' as const,
        label: 'Invalid Cast',
        explanation: 'Malformed',
        evidenceIds: [],
        proposedValue: null,
        reviewDecision: 'accepted' as const,
        applicationState: 'staged' as const,
      } as unknown as ForgeSourceCandidate;

      const applyRes = applyCandidateToDraft(initialDraft, invalidCandidate);
      expect(applyRes.success).toBe(false);
      expect(applyRes.draft).toBe(initialDraft);
      expect(applyRes.draft.cast?.length).toBe(1);
    });
  });

  describe('validateAndNormalizeDocumentAnalysis partial extraction recovery', () => {
    it('retains valid entries and quarantines invalid candidates into validationIssues with completed_with_issues status', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-test-recovery-1',
        fileName: 'research_notes.txt',
        mimeType: 'text/plain',
        kind: 'document',
        receivedAt: Date.now(),
        fileSizeBytes: 1024,
      };

      const payload = {
        summary: 'Preliminary research on Submerged Station Sector 9.',
        evidence: [
          {
            id: 'ev-valid-1',
            category: 'setting',
            claim: 'The station is located in the Marianas Trench.',
            excerpt: 'Marianas Trench Station Sector 9.',
          },
          {
            id: 'ev-invalid-cat',
            category: 'unsupported_category_name',
            claim: 'Some claim with bad category.',
          },
          {
            id: 'ev-dep',
            category: 'other',
            claim: 'Depiction parameters',
          },
        ],
        candidates: [
          {
            id: 'cand-valid-loc',
            classification: 'evidence',
            target: 'setting_location',
            label: 'Setting Location',
            explanation: 'Extracted from research notes.',
            evidenceIds: ['ev-valid-1'],
            proposedValue: 'Marianas Trench Station Sector 9',
          },
          {
            id: 'cand-dep',
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Depiction Contract',
            explanation: 'Extracted depiction',
            evidenceIds: ['ev-dep'],
            proposedValue: {
              dramaticRegister: 'Claustrophobic ocean horror',
              directness: 'High tactile audio directness',
              aftermath: 'Severe decompression trauma',
              ambiguityHandling: 'Deep sea silence',
            },
          },
          {
            id: 'cand-invalid-expr',
            classification: 'evidence',
            target: 'cast_expression_guidance',
            targetCastMemberId: 'char-scientist-1',
            label: 'Scientist Expression',
            explanation: 'Has invalid communication mode.',
            evidenceIds: ['ev-valid-1'],
            proposedValue: {
              communicationModes: ['telepathic_projection'], // unsupported communication mode
              expressionGuidance: 'Project thoughts into minds.',
            },
          },
          {
            id: 'cand-invalid-target',
            classification: 'evidence',
            target: 'unknown_unsupported_target',
            label: 'Invalid Target Candidate',
            explanation: 'Invalid target type.',
            evidenceIds: [],
            proposedValue: 'some value',
          },
        ],
        unknowns: [
          {
            id: 'unk-valid-1',
            category: 'setting',
            question: 'What is the primary power source?',
          },
          {
            id: 'unk-invalid-cat',
            category: 'bad_unknown_cat',
            question: 'Invalid category unknown.',
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(payload, sourceRecord);
      expect(analysis.status).toBe('completed_with_issues');
      expect(analysis.evidence).toHaveLength(2);
      expect(analysis.unknowns).toHaveLength(1);
      expect(analysis.candidates).toHaveLength(2);
      expect(analysis.candidates[0].target).toBe('setting_location');
      expect(analysis.candidates[0].proposedValue).toBe('Marianas Trench Station Sector 9');

      expect(analysis.validationIssues).toHaveLength(2);
      expect(analysis.validationIssues[0].candidateIndex).toBe(3);
      expect(analysis.validationIssues[0].code).toBe('INVALID_ENUM');
      expect(analysis.validationIssues[0].disposition).toBe('QUARANTINED');

      expect(analysis.validationIssues[1].candidateIndex).toBe(4);
      expect(analysis.validationIssues[1].disposition).toBe('QUARANTINED');
    });

    it('document import normalizes provider user-character designation to false', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-test-cast-user-flag',
        fileName: 'cast_log.txt',
        mimeType: 'text/plain',
        kind: 'document',
        receivedAt: Date.now(),
      };

      const payload = {
        evidence: [
          {
            id: 'ev-cast-1',
            category: 'cast',
            claim: 'Dr. Evans is the lead biologist.',
          },
          {
            id: 'ev-dep-1',
            category: 'other',
            claim: 'Depiction parameters',
          },
        ],
        candidates: [
          {
            id: 'cand-cast-1',
            classification: 'evidence',
            target: 'cast_seed',
            label: 'Cast: Dr. Evans',
            explanation: 'Lead biologist.',
            evidenceIds: ['ev-cast-1'],
            proposedValue: {
              name: 'Dr. Evans',
              role: 'Biologist',
              isUserCharacter: true,
            },
          },
          {
            id: 'cand-dep-1',
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Depiction Contract',
            explanation: 'Source-backed depiction parameters.',
            evidenceIds: ['ev-dep-1'],
            proposedValue: {
              dramaticRegister: 'Psychological dread and tension',
              directness: 'Visceral direct sensory observations',
              aftermath: 'Irreversible psychological trauma',
              ambiguityHandling: 'Preserve epistemic gaps and ontological uncertainty',
              specialBoundaries: 'None',
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(payload, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.validationIssues).toHaveLength(0);
      expect(analysis.candidates).toHaveLength(2);
      const castCand = analysis.candidates.find((c) => c.target === 'cast_seed');
      const castVal = castCand?.proposedValue as { isUserCharacter: boolean; name: string };
      expect(castVal.isUserCharacter).toBe(false);
      expect(castVal.name).toBe('Dr. Evans');
    });

    it('document import requires exactly one complete evidence-linked depiction contract', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-dep-valid',
        fileName: 'scenario_source.txt',
        mimeType: 'text/plain',
        kind: 'document',
        receivedAt: Date.now(),
      };

      const payload = {
        evidence: [
          { id: 'ev-dep-1', category: 'other', claim: 'Depiction parameters' },
        ],
        candidates: [
          {
            id: 'cand-dep',
            target: 'depiction_contract',
            evidenceIds: ['ev-dep-1'],
            proposedValue: {
              dramaticRegister: 'Submersible clinical horror',
              directness: 'Brutal acoustic shockwaves',
              aftermath: 'Eardrum rupture and nitrogen narcosis',
              ambiguityHandling: 'Sonar signals remain untranslated',
              specialBoundaries: 'No physical escape',
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(payload, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.candidates).toHaveLength(1);
      expect(analysis.candidates[0].target).toBe('depiction_contract');
    });

    it('document import fails with bounded baseline error when depiction contract is absent', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-dep-missing',
        fileName: 'scenario_source.txt',
        mimeType: 'text/plain',
        kind: 'document',
        receivedAt: Date.now(),
      };

      const payload = {
        evidence: [
          { id: 'ev-loc', category: 'setting', claim: 'Deep seabed' },
        ],
        candidates: [
          {
            id: 'cand-loc',
            target: 'setting_location',
            evidenceIds: ['ev-loc'],
            proposedValue: 'Trench Core 9',
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(payload, sourceRecord);
      expect(analysis.status).toBe('error');
      expect(analysis.errorMessage).toContain('Extraction did not produce a complete source-backed Depiction Contract.');
    });

    it('document import fails when depiction contract is duplicated, malformed, or lacks evidence', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-dep-invalid',
        fileName: 'scenario_source.txt',
        mimeType: 'text/plain',
        kind: 'document',
        receivedAt: Date.now(),
      };

      // 1. Duplicate depiction contracts
      const dupPayload = {
        evidence: [{ id: 'ev-1', category: 'other', claim: 'Claim 1' }],
        candidates: [
          {
            id: 'cand-dep-1',
            target: 'depiction_contract',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Tone 1',
              directness: 'Directness 1',
              aftermath: 'Aftermath 1',
              ambiguityHandling: 'Ambiguity 1',
            },
          },
          {
            id: 'cand-dep-2',
            target: 'depiction_contract',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Tone 2',
              directness: 'Directness 2',
              aftermath: 'Aftermath 2',
              ambiguityHandling: 'Ambiguity 2',
            },
          },
        ],
      };
      const dupAnalysis = validateAndNormalizeDocumentAnalysis(dupPayload, sourceRecord);
      expect(dupAnalysis.status).toBe('error');
      expect(dupAnalysis.errorMessage).toContain('Extraction did not produce a complete source-backed Depiction Contract.');

      // 2. Depiction contract without evidence
      const noEvPayload = {
        evidence: [],
        candidates: [
          {
            id: 'cand-dep-1',
            target: 'depiction_contract',
            evidenceIds: [],
            proposedValue: {
              dramaticRegister: 'Tone 1',
              directness: 'Directness 1',
              aftermath: 'Aftermath 1',
              ambiguityHandling: 'Ambiguity 1',
            },
          },
        ],
      };
      const noEvAnalysis = validateAndNormalizeDocumentAnalysis(noEvPayload, sourceRecord);
      expect(noEvAnalysis.status).toBe('error');
      expect(noEvAnalysis.errorMessage).toContain('Extraction did not produce a complete source-backed Depiction Contract.');
    });

    it('normalizes unambiguous aliases during document analysis', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-test-aliases',
        fileName: 'station_log.txt',
        mimeType: 'text/plain',
        kind: 'document',
        receivedAt: Date.now(),
      };

      const payload = {
        evidence: [
          {
            id: 'ev-1',
            category: 'cast',
            claim: 'Mercer uses radio equipment.',
          },
          {
            id: 'ev-dep',
            category: 'other',
            claim: 'Depiction parameters',
          },
        ],
        candidates: [
          {
            id: 'cand-dep',
            classification: 'evidence',
            target: 'depiction_contract',
            evidenceIds: ['ev-dep'],
            proposedValue: {
              dramaticRegister: 'Cold industrial realism',
              directness: 'Direct sensory details',
              aftermath: 'Severe physical trauma',
              ambiguityHandling: 'Ontological silence',
              specialBoundaries: 'None',
            },
          },
          {
            id: 'cand-expr',
            classification: 'evidence',
            target: 'cast_expression_guidance',
            targetCastMemberId: 'char-mercer',
            label: 'Mercer Expression',
            explanation: 'Uses radio',
            evidenceIds: ['ev-1'],
            proposedValue: {
              communicationModes: ['verbal', 'radio'],
              expressionGuidance: 'Radio dialogue.',
            },
          },
          {
            id: 'cand-conn',
            classification: 'evidence',
            target: 'topology_connection',
            label: 'Station Corridor',
            explanation: 'Physical corridor',
            evidenceIds: ['ev-1'],
            proposedValue: {
              from: 'dock',
              to: 'airlock',
              kind: 'corridor',
              userInitiated: true,
            },
          },
          {
            id: 'cand-anchor',
            classification: 'evidence',
            target: 'value_anchor',
            label: 'Radio Tower',
            explanation: 'Important communication facility',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'va-tower',
              holder: { kind: 'location', nodeId: 'dock' },
              label: 'Radio Tower',
              description: 'Tower on the dock.',
              basisSummary: 'Essential comms.',
              provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-test-aliases', evidenceIds: ['ev-1'] },
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(payload, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.validationIssues).toHaveLength(0);
      expect(analysis.candidates).toHaveLength(4);

      const exprCand = analysis.candidates.find((c) => c.target === 'cast_expression_guidance');
      const exprVal = exprCand?.proposedValue as { communicationModes: string[] };
      expect(exprVal.communicationModes).toEqual(['spoken', 'mediated']);

      const connCand = analysis.candidates.find((c) => c.target === 'topology_connection');
      const connVal = connCand?.proposedValue as { kind: string };
      expect(connVal.kind).toBe('PHYSICAL');

      const anchorCand = analysis.candidates.find((c) => c.target === 'value_anchor');
      const anchorVal = anchorCand?.proposedValue as { holder: { kind: string; nodeId: string } };
      expect(anchorVal.holder).toEqual({ kind: 'PLACE', nodeId: 'dock' });
    });

    it('supplies stable fallback id for cast_seed without id and sets default reviewDecision and applicationState', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-test-cast-fallback',
        fileName: 'cast_log.txt',
        mimeType: 'text/plain',
        kind: 'document',
        receivedAt: Date.now(),
      };

      const payload = {
        evidence: [
          { id: 'ev-dep', category: 'other', claim: 'Depiction contract' },
        ],
        candidates: [
          {
            id: 'cand-dep',
            target: 'depiction_contract',
            evidenceIds: ['ev-dep'],
            proposedValue: {
              dramaticRegister: 'Psychological tension',
              directness: 'Close perspective',
              aftermath: 'Lingering fear',
              ambiguityHandling: 'Uncertain boundaries',
            },
          },
          {
            target: 'cast_seed',
            label: 'Station Engineer',
            explanation: 'Extracted character',
            proposedValue: {
              name: 'Engineer Mercer',
              role: 'PROTAGONIST',
              description: 'Chief maintenance specialist.',
              isUserCharacter: true,
              isEntity: false,
              behaviorVector: 'ADAPTIVE',
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(payload, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.candidates).toHaveLength(2);
      const castCand = analysis.candidates.find((c) => c.target === 'cast_seed');
      expect(castCand).toBeDefined();
      expect(castCand!.reviewDecision).toBe('accepted');
      const castMember = castCand!.proposedValue as { id: string; name: string };
      expect(castMember.id).toBe('src-test-cast-fallback-cast-1');
      expect(castMember.name).toBe('Engineer Mercer');
    });

    it('extracts and applies value_anchor and character_pursuit candidates correctly', () => {
      const initialDraft: ForgeDraft = {
        id: 'draft-hg-test',
        title: 'Bunker 11',
        premise: 'Underground fallout facility.',
        setting: { location: 'Bunker', atmosphere: 'Bleak', timePeriod: '1985' },
        startingVector: 'COGNITIVE',
        startingTier: 'LATENT',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Fallout constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        depictionContract: {
          dramaticRegister: 'Cold War Realism',
          directness: 'High directness',
          aftermath: 'Grim consequences',
          ambiguityHandling: 'Explicit uncertainty',
          specialBoundaries: 'None',
        },
        cast: [
          {
            id: 'char-guard',
            name: 'Officer Petrov',
            role: 'Sentinel',
            isUserCharacter: false,
            presenceDisposition: { kind: 'AT_NODE', nodeId: 'NODE_GATE' },
          },
          {
            id: 'char-commander',
            name: 'Commander Yuri',
            role: 'PROTAGONIST',
            isUserCharacter: true,
            presenceDisposition: { kind: 'AT_NODE', nodeId: 'NODE_GATE' },
          },
          {
            id: 'char-bunker-revenant',
            name: 'The Bunker Revenant',
            role: 'Antagonist',
            description: 'Irradiated revenant sealed in the lower levels of Bunker 11.',
            disposition: 'VILLAIN',
            behaviorVector: 'RELENTLESS',
            isEntity: true,
            isUserCharacter: false,
            presenceDisposition: { kind: 'NONLOCAL' },
          },
        ],
        userCharacterId: 'char-commander',
        userOpeningAim: {
          castMemberId: 'char-commander',
          disposition: 'NONE_DECLARED',
          aimText: '',
          reviewedAt: Date.now(),
        },
        topology: { startingNodeId: 'NODE_GATE', nodes: ['NODE_GATE'], connections: [] },
        horrorGrammar: {
          valueBaselineReview: 'UNREVIEWED',
          pursuitReviews: {
            'char-guard': 'UNREVIEWED',
            'char-commander': 'REVIEWED_NONE',
            'char-bunker-revenant': 'REVIEWED_NONE',
          },
          valueAnchors: [],
          characterPursuits: [],
        },
      };

      const anchorCandidate: ForgeSourceCandidate = {
        id: 'cand-val-1',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'value_anchor',
        label: 'Defense Perimeter',
        explanation: 'Extracted defense priority',
        evidenceIds: ['ev-1'],
        proposedValue: {
          id: 'val-perimeter',
          holder: { kind: 'PLACE', nodeId: 'NODE_GATE' },
          label: 'Defense Perimeter',
          description: 'Gate must remain locked',
          basisSummary: 'Standing orders',
          provenance: { kind: 'CREATOR_DEFINED' },
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const applyAnchorRes = applyCandidateToDraft(initialDraft, anchorCandidate);
      expect(applyAnchorRes.success).toBe(true);
      if (!applyAnchorRes.success) return;

      expect(applyAnchorRes.draft.horrorGrammar?.valueBaselineReview).toBe('REVIEWED');
      expect(applyAnchorRes.draft.horrorGrammar?.valueAnchors).toHaveLength(1);

      const pursuitCandidate: ForgeSourceCandidate = {
        id: 'cand-pursuit-1',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'character_pursuit',
        label: 'Guard the Gate',
        explanation: 'Active duty',
        evidenceIds: ['ev-2'],
        proposedValue: {
          id: 'pursuit-guard',
          castMemberId: 'char-guard',
          objective: 'Maintain perimeter watch',
          presentApproach: 'Patrolling gate entrance with rifle ready',
          locationNodeId: 'NODE_GATE',
          status: 'ACTIVE',
          reviewWindow: 'SCENE_BEAT',
          triggerReferences: [],
          basisSummary: 'Duty schedule',
          provenance: { kind: 'CREATOR_DEFINED' },
        },
        targetCastMemberId: 'char-guard',
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const applyPursuitRes = applyCandidateToDraft(applyAnchorRes.draft, pursuitCandidate);
      expect(applyPursuitRes.success).toBe(true);
      if (!applyPursuitRes.success) return;

      expect(applyPursuitRes.draft.horrorGrammar?.pursuitReviews['char-guard']).toBe('REVIEWED');
      expect(applyPursuitRes.draft.horrorGrammar?.characterPursuits).toHaveLength(1);

      const compileRes = compileForgeDraft(applyPursuitRes.draft);
      expect(compileRes.success).toBe(true);
    });

    it('normalizes, dependency-sorts, and applies topology_node, topology_connection, starting_node_selection, expandable_space_anchor, and cast_opening_placement', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-story-map',
        fileName: 'deep_trench_base.json',
        mimeType: 'application/json',
        kind: 'document',
        receivedAt: 1000,
      };

      const rawPayload = {
        summary: 'Deep trench underwater facility blueprint.',
        evidence: [
          { id: 'ev-1', category: 'topology', claim: 'Bridge and Airlock exist' },
        ],
        candidates: [
          {
            id: 'cand-dep-trench',
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Trench Depiction Contract',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Cosmic existential dread',
              directness: 'High directness',
              aftermath: 'Irreversible damage',
              ambiguityHandling: 'Deliberate void',
              specialBoundaries: 'None',
            },
          },
          {
            id: 'cand-node-bridge',
            classification: 'evidence',
            target: 'topology_node',
            label: 'Command Bridge',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'BRIDGE',
              label: 'Command Bridge',
              description: 'Central viewport overlooking trench.',
            },
          },
          {
            id: 'cand-node-airlock',
            classification: 'evidence',
            target: 'topology_node',
            label: 'Airlock B',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'AIRLOCK_B',
              label: 'Airlock B',
              description: 'Heavy hydraulic decompression portal.',
            },
          },
          {
            id: 'cand-edge-1',
            classification: 'evidence',
            target: 'topology_connection',
            label: 'Bridge to Airlock B',
            evidenceIds: ['ev-1'],
            proposedValue: {
              from: 'BRIDGE',
              to: 'AIRLOCK_B',
              kind: 'PHYSICAL',
              userInitiated: true,
            },
          },
          {
            id: 'cand-anchor-vent',
            classification: 'inference',
            target: 'expandable_space_anchor',
            label: 'Vent Shaft 3',
            evidenceIds: ['ev-1'],
            parentNodeId: 'BRIDGE',
            proposedValue: {
              id: 'vent-shaft-3',
              parentNodeId: 'BRIDGE',
              label: 'Ventilation Shaft 3',
              description: 'Narrow maintenance conduit branching from bridge.',
            },
          },
          {
            id: 'cand-cast-1',
            classification: 'evidence',
            target: 'cast_seed',
            label: 'Captain Haze',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'char-haze',
              name: 'Captain Haze',
              role: 'PROTAGONIST',
              isUserCharacter: true,
            },
          },
          {
            id: 'cand-cast-2',
            classification: 'evidence',
            target: 'cast_seed',
            label: 'Entity Echo',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'char-echo',
              name: 'The Trench Phantom',
              role: 'ANTAGONIST',
              isUserCharacter: false,
              isEntity: true,
            },
          },
          {
            id: 'cand-disp-haze',
            classification: 'evidence',
            target: 'cast_opening_placement',
            label: 'Haze at Bridge',
            targetCastMemberId: 'char-haze',
            evidenceIds: ['ev-1'],
            proposedValue: {
              kind: 'AT_NODE',
              nodeId: 'BRIDGE',
            },
          },
          {
            id: 'cand-disp-echo',
            classification: 'evidence',
            target: 'cast_opening_placement',
            label: 'Echo Nonlocal',
            targetCastMemberId: 'char-echo',
            evidenceIds: ['ev-1'],
            proposedValue: {
              kind: 'NONLOCAL',
            },
          },
        ],
        unknowns: [],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(rawPayload, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.candidates).toHaveLength(9);

      // Verify dependency sorting
      const sorted = sortCandidatesForApplication(analysis.candidates);
      const targets = sorted.map((c) => c.target);
      const firstPri2 = targets.findIndex((t) => t === 'topology_connection' || t === 'expandable_space_anchor');
      const lastPri1 = targets.map((t, idx) => ((t === 'cast_seed' || t === 'topology_node') ? idx : -1)).reduce((a, b) => Math.max(a, b), -1);
      expect(lastPri1).toBeLessThan(firstPri2);

      const firstPri3 = targets.findIndex((t) => t === 'cast_opening_placement');
      expect(firstPri2).toBeLessThan(firstPri3);

      // Apply in dependency sorted order onto an initial draft
      let workingDraft: ForgeDraft = {
        id: 'draft-story-test',
        title: 'Deep Trench Base',
        premise: 'Abyssal outpost under immense hydraulic pressure.',
        setting: { location: 'Trench Outpost', atmosphere: 'Cold', timePeriod: '1979' },
        startingVector: 'COGNITIVE',
        startingTier: 'LATENT',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Abyssal hydraulic constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        depictionContract: {
          dramaticRegister: 'Cosmic existential dread',
          directness: 'High directness',
          aftermath: 'Irreversible damage',
          ambiguityHandling: 'Deliberate void',
          specialBoundaries: 'None',
        },
        cast: [],
        topology: { nodes: [], nodeDefinitions: [], connections: [], anchors: [] },
      };

      for (const cand of sorted) {
        const res = applyCandidateToDraft(workingDraft, cand, sourceRecord.fileName);
        expect(res.success).toBe(true);
        if (res.success) {
          workingDraft = res.draft;
        }
      }

      // Assert draft state
      expect(workingDraft.topology?.nodes).toContain('BRIDGE');
      expect(workingDraft.topology?.nodes).toContain('AIRLOCK_B');
      expect(workingDraft.topology?.connections).toHaveLength(1);
      expect(workingDraft.topology?.anchors).toHaveLength(1);
      expect(workingDraft.topology?.anchors?.[0].id).toBe('vent-shaft-3');

      expect(workingDraft.cast).toHaveLength(2);
      const haze = workingDraft.cast?.find((c) => c.id === 'char-haze');
      expect(haze?.presenceDisposition).toEqual({
        kind: 'AT_NODE',
        nodeId: 'BRIDGE',
      });

      const echo = workingDraft.cast?.find((c) => c.id === 'char-echo');
      expect(echo?.presenceDisposition).toEqual({
        kind: 'NONLOCAL',
      });
    });

    it('fails candidate application atomically with explicit error when referencing missing node or cast member', () => {
      const draft: ForgeDraft = {
        id: 'draft-broken-ref',
        title: 'Outpost',
        cast: [{ id: 'char-mortal', name: 'Mortal Crew', isEntity: false }],
        topology: { nodes: ['ROOM_A'], connections: [] },
        deathContract: { metaphysics: 'mundane', powerBudget: 'Outpost constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
      };

      // 1. Connection with unknown destination node
      const badEdgeCand: ForgeSourceCandidate = {
        id: 'cand-bad-edge',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'topology_connection',
        label: 'Broken Edge',
        explanation: 'Points to non-existent node',
        evidenceIds: [],
        proposedValue: {
          from: 'ROOM_A',
          to: 'ROOM_NONEXISTENT',
          kind: 'PHYSICAL',
          userInitiated: true,
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };
      const edgeRes = applyCandidateToDraft(draft, badEdgeCand);
      expect(edgeRes.success).toBe(false);
      if (!edgeRes.success) {
        expect((edgeRes as { error: string }).error).toContain('ROOM_NONEXISTENT');
      }

      // 2. Opening placement with unknown node ID
      const badPlacementCand: ForgeSourceCandidate = {
        id: 'cand-bad-start',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'cast_opening_placement',
        targetCastMemberId: 'char-mortal',
        label: 'Broken Placement',
        explanation: 'Sets placement to non-existent node',
        evidenceIds: [],
        proposedValue: {
          kind: 'AT_NODE',
          nodeId: 'ROOM_VOID',
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };
      const placeRes = applyCandidateToDraft(draft, badPlacementCand);
      expect(placeRes.success).toBe(false);
      if (!placeRes.success) {
        expect((placeRes as { error: string }).error).toContain('ROOM_VOID');
      }

      // 3. Anchor with unknown parent node ID
      const badAnchorCand: ForgeSourceCandidate = {
        id: 'cand-bad-anchor',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'expandable_space_anchor',
        label: 'Broken Anchor',
        explanation: 'Attaches to non-existent node',
        evidenceIds: [],
        proposedValue: {
          id: 'anchor-orphan',
          parentNodeId: 'ROOM_GHOST',
          label: 'Orphan Anchor',
          description: 'No parent',
          statement: 'Orphan statement',
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };
      const anchorRes = applyCandidateToDraft(draft, badAnchorCand);
      expect(anchorRes.success).toBe(false);
      if (!anchorRes.success) {
        expect((anchorRes as { error: string }).error).toContain('ROOM_GHOST');
      }
    });

    it('source import creates only one rich topology node for a canonical node ID', () => {
      let draft: ForgeDraft = {
        id: 'draft-topo-test',
        title: 'Station',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Station constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        topology: { nodes: [], nodeDefinitions: [], connections: [] },
      };

      const nodeCand1: ForgeSourceCandidate = {
        id: 'cand-node-1',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'topology_node',
        label: 'Reactor Core',
        explanation: 'Reactor core node',
        evidenceIds: ['ev-1'],
        proposedValue: {
          id: 'CORE_ROOM',
          label: 'Reactor Core',
          description: 'Primary power station.',
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const nodeCand2: ForgeSourceCandidate = {
        id: 'cand-node-2',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'topology_node',
        label: 'Reactor Core (Refined)',
        explanation: 'Refined reactor core node',
        evidenceIds: ['ev-1'],
        proposedValue: {
          id: 'CORE_ROOM',
          label: 'Reactor Core Refined',
          description: 'Updated primary power station.',
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const res1 = applyCandidateToDraft(draft, nodeCand1);
      expect(res1.success).toBe(true);
      draft = (res1 as { success: true; draft: ForgeDraft }).draft;

      const res2 = applyCandidateToDraft(draft, nodeCand2);
      expect(res2.success).toBe(true);
      draft = (res2 as { success: true; draft: ForgeDraft }).draft;

      expect(draft.topology?.nodes).toEqual(['CORE_ROOM']);
      expect(draft.topology?.nodeDefinitions).toHaveLength(1);
      expect(draft.topology?.nodeDefinitions?.[0].label).toBe('Reactor Core Refined');
    });

    it('source import writes character placements but no topology startingNodeId', () => {
      const draft: ForgeDraft = {
        id: 'draft-place-test',
        title: 'Station',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Station constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        cast: [{ id: 'char-1', name: 'Officer', isEntity: false, isUserCharacter: false }],
        topology: { nodes: ['ROOM_A'], nodeDefinitions: [{ id: 'ROOM_A', label: 'Room A' }], connections: [] },
      };

      const placementCand: ForgeSourceCandidate = {
        id: 'cand-place-1',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'cast_opening_placement',
        targetCastMemberId: 'char-1',
        label: 'Officer Placement',
        explanation: 'Officer placement at Room A',
        evidenceIds: ['ev-1'],
        proposedValue: {
          kind: 'AT_NODE',
          nodeId: 'ROOM_A',
        },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      };

      const res = applyCandidateToDraft(draft, placementCand);
      expect(res.success).toBe(true);
      const updatedDraft = (res as { success: true; draft: ForgeDraft }).draft;
      expect(updatedDraft.cast?.[0].presenceDisposition).toEqual({ kind: 'AT_NODE', nodeId: 'ROOM_A' });
      expect(updatedDraft.topology?.startingNodeId).toBeUndefined();
    });

    it('native Blueprint import emits source-backed depiction contract and no global start candidate', () => {
      const nativeBlueprint = {
        identity: { title: 'Cold Dawn', thematicAnchor: 'Isolation' },
        premise: 'Isolated arctic observatory anomaly.',
        setting: { location: 'Station Ice-9', atmosphere: 'Freezing dread', timePeriod: '1982' },
        startingVector: 'SOMATIC',
        startingTier: 'GATEWAY',
        topology: {
          nodes: ['LAB'],
          nodeDefinitions: [{ id: 'LAB', label: 'Research Lab', description: 'Cold lab' }],
          connections: [],
        },
        cast: [
          {
            id: 'char-elena',
            name: 'Dr. Elena Rostova',
            role: 'Scientist',
            isUserCharacter: true,
            presenceDisposition: { kind: 'AT_NODE', nodeId: 'LAB' },
          },
        ],
        depictionContract: {
          dramaticRegister: 'Sub-zero psychological horror',
          directness: 'Sensory hypothermia and auditory hallucinations',
          aftermath: 'Severe frostbite and psychological breaks',
          ambiguityHandling: 'Radio static remains uninterpreted',
          specialBoundaries: 'None',
        },
      };

      const analysis = buildSourceAnalysisFromBlueprint(nativeBlueprint, 'cold_dawn.json');
      expect(analysis.status).toBe('completed');

      const depCand = analysis.candidates.find((c) => c.target === 'depiction_contract');
      expect(depCand).toBeDefined();
      expect(depCand?.proposedValue).toEqual({
        dramaticRegister: 'Sub-zero psychological horror',
        directness: 'Sensory hypothermia and auditory hallucinations',
        aftermath: 'Severe frostbite and psychological breaks',
        ambiguityHandling: 'Radio static remains uninterpreted',
        specialBoundaries: 'None',
      });

      const startCand = analysis.candidates.find((c) => c.target === 'starting_node_selection');
      expect(startCand).toBeUndefined();

      const userAimCand = analysis.candidates.find((c) => c.target === 'user_opening_aim_default');
      expect(userAimCand).toBeUndefined();

      const castCand = analysis.candidates.find((c) => c.target === 'cast_seed');
      expect((castCand?.proposedValue as { isUserCharacter: boolean }).isUserCharacter).toBe(false);
    });
  });

  describe('Packet 1D-1: Bounded Issue Ledger and Server Provenance Reconstruction', () => {
    const sourceRecord: ForgeSourceRecord = {
      id: 'src-bound-test',
      fileName: 'noisy_import.txt',
      mimeType: 'text/plain',
      kind: 'document',
      receivedAt: Date.now(),
    };

    const mockDepictionEvidence: ForgeSourceEvidence = {
      id: 'ev-dep-1',
      sourceId: 'src-bound-test',
      category: 'other',
      claim: 'Depiction contract basis',
    };

    const mockDepictionCandidate: ForgeSourceCandidate = {
      id: 'cand-dep-1',
      sourceId: 'src-bound-test',
      classification: 'evidence',
      target: 'depiction_contract',
      label: 'Depiction Contract',
      explanation: 'Extracted depiction contract',
      evidenceIds: ['ev-dep-1'],
      proposedValue: {
        dramaticRegister: 'Standard dread',
        directness: 'High directness',
        aftermath: 'Severe aftermath',
        ambiguityHandling: 'High uncertainty',
        specialBoundaries: '',
      },
      reviewDecision: 'accepted',
      applicationState: 'staged',
    };

    it('collects exactly 49 issues with 0 omitted issues', () => {
      const candidates: Array<{ id: string; target: string; proposedValue: unknown }> = Array.from({ length: 49 }, (_, i) => ({
        id: `bad-${i}`,
        target: 'setting_location',
        proposedValue: null, // missing proposedValue triggers quarantine
      }));
      candidates.push({
        id: 'valid-cand',
        target: 'setting_location' as const,
        proposedValue: 'The Abandoned Mine',
      });
      candidates.push(mockDepictionCandidate as unknown as { id: string; target: string; proposedValue: unknown });

      const analysis = validateAndNormalizeDocumentAnalysis({ candidates, evidence: [mockDepictionEvidence] }, sourceRecord);
      expect(analysis.status).toBe('completed_with_issues');
      expect(analysis.validationIssues).toHaveLength(49);
      expect(analysis.omittedValidationIssueCount).toBe(0);
      expect(analysis.candidates).toHaveLength(2);
    });

    it('collects exactly 50 issues with 0 omitted issues at MAX_VALIDATION_ISSUES boundary', () => {
      const candidates: Array<{ id: string; target: string; proposedValue: unknown }> = Array.from({ length: 50 }, (_, i) => ({
        id: `bad-${i}`,
        target: 'setting_location',
        proposedValue: null, // missing proposedValue triggers quarantine
      }));
      candidates.push({
        id: 'valid-cand',
        target: 'setting_location' as const,
        proposedValue: 'The Abandoned Mine',
      });
      candidates.push(mockDepictionCandidate as unknown as { id: string; target: string; proposedValue: unknown });

      const analysis = validateAndNormalizeDocumentAnalysis({ candidates, evidence: [mockDepictionEvidence] }, sourceRecord);
      expect(analysis.status).toBe('completed_with_issues');
      expect(analysis.validationIssues).toHaveLength(50);
      expect(analysis.omittedValidationIssueCount).toBe(0);
      expect(analysis.candidates).toHaveLength(2);
    });

    it('collects 50 issues and records 1 omitted issue when 51 malformed candidates exist', () => {
      const candidates: Array<{ id: string; target: string; proposedValue: unknown }> = Array.from({ length: 51 }, (_, i) => ({
        id: `bad-${i}`,
        target: 'setting_location',
        proposedValue: null, // missing proposedValue triggers quarantine
      }));
      candidates.push({
        id: 'valid-cand',
        target: 'setting_location' as const,
        proposedValue: 'The Abandoned Mine',
      });
      candidates.push(mockDepictionCandidate as unknown as { id: string; target: string; proposedValue: unknown });

      const analysis = validateAndNormalizeDocumentAnalysis({ candidates, evidence: [mockDepictionEvidence] }, sourceRecord);
      expect(analysis.status).toBe('completed_with_issues');
      expect(analysis.validationIssues).toHaveLength(50);
      expect(analysis.omittedValidationIssueCount).toBe(1);
      expect(analysis.candidates).toHaveLength(2);
    });

    it('handles noisy document with 80 malformed candidates without exceeding schema limits', () => {
      const candidates: Array<{ id: string; target: string; proposedValue: unknown }> = Array.from({ length: 80 }, (_, i) => ({
        id: `bad-${i}`,
        target: 'setting_location',
        proposedValue: null, // missing proposedValue triggers quarantine
      }));
      candidates.push({
        id: 'valid-cand',
        target: 'setting_location' as const,
        proposedValue: 'The Abandoned Mine',
      });
      candidates.push(mockDepictionCandidate as unknown as { id: string; target: string; proposedValue: unknown });

      const analysis = validateAndNormalizeDocumentAnalysis({ candidates, evidence: [mockDepictionEvidence] }, sourceRecord);
      expect(analysis.status).toBe('completed_with_issues');
      expect(analysis.validationIssues).toHaveLength(50);
      expect(analysis.omittedValidationIssueCount).toBe(30);
      expect(analysis.candidates).toHaveLength(2);
    });

    it('reconstructs server provenance authoritatively for value_anchor and character_pursuit', () => {
      const payload = {
        evidence: [
          {
            id: 'ev-1',
            category: 'setting',
            claim: 'Sanctuary contains the relic.',
          },
          mockDepictionEvidence,
        ],
        candidates: [
          mockDepictionCandidate,
          {
            id: 'cand-va',
            target: 'value_anchor',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'va-relic',
              holder: { kind: 'PLACE', nodeId: 'node-sanctuary' },
              label: 'The Ancient Relic',
              description: 'Sacred artifact',
              basisSummary: 'Protected artifact',
              provenance: { kind: 'UNTRUSTED_MODEL_AUTHOR', sourceId: 'fake-id', evidenceIds: ['fake-ev'] },
            },
          },
          {
            id: 'cand-va-no-ev',
            target: 'value_anchor',
            evidenceIds: [],
            proposedValue: {
              id: 'va-unsupported',
              holder: { kind: 'PLACE', nodeId: 'node-sanctuary' },
              label: 'Unsupported Value',
              description: 'No evidence',
              basisSummary: 'None',
            },
          },
          {
            id: 'cand-pursuit',
            target: 'character_pursuit',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'pursuit-1',
              castMemberId: 'char-priest',
              objective: 'Protect the relic',
              presentApproach: 'Barricade the door',
              status: 'active',
              urgency: 'high',
              reviewWindow: 'every_turn',
              provenance: { kind: 'UNTRUSTED_MODEL_AUTHOR', sourceId: 'fake-id' },
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(payload, sourceRecord);
      expect(analysis.status).toBe('completed_with_issues');
      expect(analysis.candidates).toHaveLength(3); // cand-dep-1, cand-va and cand-pursuit valid; cand-va-no-ev quarantined

      const vaCand = analysis.candidates.find((c) => c.target === 'value_anchor');
      expect(vaCand).toBeDefined();
      const vaValue = vaCand!.proposedValue as Record<string, unknown>;
      expect(vaValue.provenance).toEqual({
        kind: 'REVIEWED_SOURCE',
        sourceId: 'src-bound-test',
        evidenceIds: ['ev-1'],
      });

      const pCand = analysis.candidates.find((c) => c.target === 'character_pursuit');
      expect(pCand).toBeDefined();
      const pValue = pCand!.proposedValue as Record<string, unknown>;
      expect(pValue.provenance).toEqual({
        kind: 'REVIEWED_SOURCE',
        sourceId: 'src-bound-test',
        evidenceIds: ['ev-1'],
      });

      const quarantinedVa = analysis.validationIssues?.find((i) => i.candidateIndex === 3);
      expect(quarantinedVa).toBeDefined();
      expect(quarantinedVa!.disposition).toBe('QUARANTINED');
      expect(quarantinedVa!.fieldPath).toBe('evidenceIds');
    });

    it('accepts a server-normalized analysis containing depiction_contract', () => {
      expect(
        ForgeSourceAnalysisSchema.safeParse({
          id: 'src-analysis-dep-test',
          sourceRecord: {
            id: 'src-rec-dep',
            fileName: 'manifest.txt',
            mimeType: 'text/plain',
            kind: 'document',
            receivedAt: Date.now(),
            fileSizeBytes: 256,
          },
          summary: 'Document containing valid depiction contract candidate.',
          evidence: [
            {
              id: 'ev-1',
              sourceId: 'src-rec-dep',
              category: 'other',
              claim: 'Atmosphere and directness evidence',
            },
          ],
          candidates: [
            {
              id: 'cand-dep-1',
              sourceId: 'src-rec-dep',
              classification: 'evidence',
              target: 'depiction_contract',
              label: 'Depiction Contract',
              explanation: 'Extracted depiction contract',
              confidence: 0.9,
              evidenceIds: ['ev-1'],
              proposedValue: {
                dramaticRegister: 'Submersible dread',
                directness: 'High directness',
                aftermath: 'Severe trauma',
                ambiguityHandling: 'Uncertain boundaries',
                specialBoundaries: '',
              },
              reviewDecision: 'accepted',
              applicationState: 'staged',
            },
          ],
          unknowns: [],
          validationIssues: [],
          omittedValidationIssueCount: 0,
          status: 'completed',
        }).success
      ).toBe(true);
    });

    describe('Packet 07: Candidate Application State & Depiction Contract Preservation', () => {
      it('ForgeCandidateApplicationStateSchema parses staged, applied, and superseded', () => {
        expect(ForgeCandidateApplicationStateSchema.parse('staged')).toBe('staged');
        expect(ForgeCandidateApplicationStateSchema.parse('applied')).toBe('applied');
        expect(ForgeCandidateApplicationStateSchema.parse('superseded')).toBe('superseded');
        expect(() => ForgeCandidateApplicationStateSchema.parse('invalid')).toThrow();
      });

      it('isCompleteAuthoredDepictionContract accurately identifies complete vs incomplete contracts', () => {
        // Complete contract
        expect(
          isCompleteAuthoredDepictionContract({
            dramaticRegister: 'Submersible Dread',
            directness: 'High Directness',
            aftermath: 'Severe Trauma',
            ambiguityHandling: 'Uncertain boundaries',
          })
        ).toBe(true);

        // Null or undefined
        expect(isCompleteAuthoredDepictionContract(null)).toBe(false);
        expect(isCompleteAuthoredDepictionContract(undefined)).toBe(false);

        // Empty field
        expect(
          isCompleteAuthoredDepictionContract({
            dramaticRegister: 'Submersible Dread',
            directness: '',
            aftermath: 'Severe Trauma',
            ambiguityHandling: 'Uncertain boundaries',
          })
        ).toBe(false);

        // Placeholder/unknown values
        expect(
          isCompleteAuthoredDepictionContract({
            dramaticRegister: 'Submersible Dread',
            directness: 'unknown',
            aftermath: 'Severe Trauma',
            ambiguityHandling: 'Uncertain boundaries',
          })
        ).toBe(false);

        expect(
          isCompleteAuthoredDepictionContract({
            dramaticRegister: 'none',
            directness: 'High Directness',
            aftermath: 'Severe Trauma',
            ambiguityHandling: 'Uncertain boundaries',
          })
        ).toBe(false);

        expect(
          isCompleteAuthoredDepictionContract({
            dramaticRegister: 'Submersible Dread',
            directness: 'High Directness',
            aftermath: 'n/a',
            ambiguityHandling: 'Uncertain boundaries',
          })
        ).toBe(false);
      });

      it('validateCandidateEdit resets a superseded candidate to staged upon edit', () => {
        const supersededCand: ForgeSourceCandidate = {
          id: 'cand-dep-1',
          sourceId: 'src-1',
          classification: 'evidence',
          target: 'depiction_contract',
          label: 'Depiction Contract',
          explanation: 'Extracted depiction contract',
          evidenceIds: ['ev-1'],
          proposedValue: {
            dramaticRegister: 'Old Register',
            directness: 'Old Directness',
            aftermath: 'Old Aftermath',
            ambiguityHandling: 'Old Ambiguity',
            specialBoundaries: '',
          },
          reviewDecision: 'accepted',
          applicationState: 'superseded',
        };

        const result = validateCandidateEdit(supersededCand, {
          dramaticRegister: 'Edited Register',
          directness: 'Edited Directness',
          aftermath: 'Edited Aftermath',
          ambiguityHandling: 'Edited Ambiguity',
          specialBoundaries: '',
        });

        expect(result.valid).toBe(true);
        expect(result.updatedCandidate?.applicationState).toBe('staged');
        expect(result.updatedCandidate?.reviewDecision).toBe('accepted');
      });
    });
  });

  describe('Candidate Discriminator Recovery & Target Alias Normalization', () => {
    const sourceRecord: ForgeSourceRecord = {
      id: 'src-recovery-test',
      fileName: 'playground.txt',
      mimeType: 'text/plain',
      kind: 'document',
      receivedAt: Date.now(),
    };

    it('recovers candidate when target is missing but classification is cast_seed', () => {
      const rawAnalysis = {
        summary: 'Story with characters.',
        evidence: [
          { id: 'ev-1', category: 'setting', claim: 'A park' },
          { id: 'ev-2', category: 'identity', claim: 'Rock Stanley is large' },
        ],
        candidates: [
          {
            id: 'cand-1',
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Depiction Contract',
            explanation: 'Contract',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Dread',
              directness: 'High',
              aftermath: 'Severe',
              ambiguityHandling: 'Clues',
              specialBoundaries: '',
            },
          },
          {
            id: 'cand-5',
            classification: 'cast_seed',
            label: 'Rock Stanley',
            explanation: 'Gentle giant',
            evidenceIds: ['ev-2'],
            proposedValue: {
              name: 'Rock Stanley',
              role: 'Outcast',
              description: 'A large man',
              personality: 'Deeply insecure',
              goals: 'To survive',
              traits: ['Insecure', 'Submissive'],
              isEntity: false,
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(rawAnalysis, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.validationIssues).toHaveLength(0);

      const castCand = analysis.candidates.find((c) => c.label === 'Rock Stanley');
      expect(castCand).toBeDefined();
      expect(castCand?.target).toBe('cast_seed');
      expect(castCand?.classification).toBe('evidence');
      expect((castCand?.proposedValue as Record<string, unknown>).name).toBe('Rock Stanley');
    });

    it('maps target character alias to cast_seed and normalizes evidence or inference classification', () => {
      const rawAnalysis = {
        summary: 'Story with characters.',
        evidence: [
          { id: 'ev-1', category: 'setting', claim: 'A park' },
          { id: 'ev-2', category: 'identity', claim: 'Geraldine is wealthy' },
        ],
        candidates: [
          {
            id: 'cand-1',
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Depiction Contract',
            explanation: 'Contract',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Dread',
              directness: 'High',
              aftermath: 'Severe',
              ambiguityHandling: 'Clues',
              specialBoundaries: '',
            },
          },
          {
            id: 'cand-6',
            classification: 'evidence or inference',
            target: 'character',
            label: 'Geraldine Borden',
            explanation: 'Antagonist',
            evidenceIds: ['ev-2'],
            proposedValue: {
              name: 'Geraldine Borden',
              role: 'Antagonist',
              description: 'Wealthy matriarch',
              personality: 'Manipulative',
              goals: 'Maintain legacy',
              traits: ['Arrogant', 'Controlling'],
              isEntity: false,
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(rawAnalysis, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.validationIssues).toHaveLength(0);

      const charCand = analysis.candidates.find((c) => c.label === 'Geraldine Borden');
      expect(charCand).toBeDefined();
      expect(charCand?.target).toBe('cast_seed');
      expect(charCand?.classification).toBe('inference');
    });

    it('infers topology_node target from proposedValue shape when target is omitted', () => {
      const rawAnalysis = {
        summary: 'Story with nodes.',
        evidence: [{ id: 'ev-1', category: 'setting', claim: 'Playground park' }],
        candidates: [
          {
            id: 'cand-1',
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Depiction Contract',
            explanation: 'Contract',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Dread',
              directness: 'High',
              aftermath: 'Severe',
              ambiguityHandling: 'Clues',
              specialBoundaries: '',
            },
          },
          {
            id: 'cand-11',
            classification: 'topology_node',
            label: 'The Playground Park',
            explanation: 'Public park area',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'playground_park',
              label: 'The Playground Park',
              description: 'A public recreational space with modern equipment',
              visualTone: 'Weathered metal under pale skies',
              hazards: ['Splintered wood'],
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(rawAnalysis, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.validationIssues).toHaveLength(0);

      const nodeCand = analysis.candidates.find((c) => c.label === 'The Playground Park');
      expect(nodeCand).toBeDefined();
      expect(nodeCand?.target).toBe('topology_node');
      expect(nodeCand?.classification).toBe('evidence');
    });
  });

  describe('reconcileDraftTopologyAndCast', () => {
    it('auto-selects first topology node as startingNodeId when unassigned', () => {
      const draft: ForgeDraft = {
        title: 'Test Scenario',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Standard constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        topology: {
          nodes: ['node-estate', 'node-playground'],
          nodeDefinitions: [
            { id: 'node-estate', label: 'Borden Estate', description: '' },
            { id: 'node-playground', label: 'The Playground', description: '' },
          ],
          connections: [],
          anchors: [],
        },
      };

      const reconciled = reconcileDraftTopologyAndCast(draft);
      expect(reconciled.topology?.startingNodeId).toBe('node-estate');
    });

    it('preserves existing valid startingNodeId', () => {
      const draft: ForgeDraft = {
        title: 'Test Scenario',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Standard constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        topology: {
          startingNodeId: 'node-playground',
          nodes: ['node-estate', 'node-playground'],
          nodeDefinitions: [
            { id: 'node-estate', label: 'Borden Estate', description: '' },
            { id: 'node-playground', label: 'The Playground', description: '' },
          ],
          connections: [],
          anchors: [],
        },
      };

      const reconciled = reconcileDraftTopologyAndCast(draft);
      expect(reconciled.topology?.startingNodeId).toBe('node-playground');
    });

    it('reconciles unknown AT_NODE placement to OFFSTAGE', () => {
      const draft: ForgeDraft = {
        title: 'Test Scenario',
        deathContract: { metaphysics: 'mundane', powerBudget: 'Standard constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        topology: {
          nodes: ['borden-estate', 'playground-main'],
          nodeDefinitions: [
            { id: 'borden-estate', label: 'The Borden Estate', description: '' },
            { id: 'playground-main', label: 'The Playground', description: '' },
          ],
          connections: [],
          anchors: [],
        },
        cast: [
          {
            id: 'rock-stanley',
            name: 'Rock Stanley',
            description: 'A survivor.',
            presenceDisposition: { kind: 'AT_NODE', nodeId: 'borden-estate' },
          },
          {
            id: 'tom-grimley',
            name: 'Tom Grimley',
            description: 'A troubled father.',
            presenceDisposition: { kind: 'AT_NODE', nodeId: 'grimley-home' },
          },
          {
            id: 'cj',
            name: 'CJ',
            description: 'Escapist son.',
            presenceDisposition: { kind: 'AT_NODE', nodeId: 'matthews-home' },
          },
        ],
      };

      const reconciled = reconcileDraftTopologyAndCast(draft);

      // Known node placement is preserved
      expect(reconciled.cast?.[0].presenceDisposition).toEqual({
        kind: 'AT_NODE',
        nodeId: 'borden-estate',
      });

      // Unknown node placements are safely defaulted to OFFSTAGE
      expect(reconciled.cast?.[1].presenceDisposition).toEqual({
        kind: 'OFFSTAGE',
      });
      expect(reconciled.cast?.[2].presenceDisposition).toEqual({
        kind: 'OFFSTAGE',
      });
    });

    it('recovers stripped evidence IDs by linking to document baseline evidence', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-recovered',
        fileName: 'RecoveredDoc.pdf',
        mimeType: 'application/pdf',
        kind: 'document',
        receivedAt: Date.now(),
      };

      const rawAnalysis = {
        summary: 'A story of terror.',
        evidence: [
          {
            id: 'ev-valid-1',
            category: 'rule',
            claim: 'The gates are locked.',
          },
        ],
        candidates: [
          {
            id: 'cand-contract',
            target: 'depiction_contract',
            label: 'Depiction Contract',
            explanation: 'Contract',
            classification: 'evidence',
            evidenceIds: ['ev-valid-1'],
            proposedValue: {
              dramaticRegister: 'Gothic dread',
              directness: 'High directness',
              aftermath: 'Lingering fear',
              ambiguityHandling: 'Explicit physical evidence',
              specialBoundaries: '',
            },
          },
          {
            id: 'cand-char-bad-ev',
            target: 'cast_seed',
            label: 'Adolpho Fuchs',
            explanation: 'Doctor in narrative',
            classification: 'evidence',
            evidenceIds: ['ev-nonexistent-99'],
            proposedValue: {
              name: 'Adolpho Fuchs',
              role: 'Physician',
              description: 'An elderly doctor.',
              personality: 'Clinical and detached.',
              goals: 'Understand the biological anomalies.',
              traits: ['observant', 'stoic', 'elderly'],
              isEntity: false,
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(rawAnalysis, sourceRecord);
      expect(analysis.status).toBe('completed');
      expect(analysis.validationIssues).toHaveLength(0);

      const fuchs = analysis.candidates.find((c) => c.label === 'Adolpho Fuchs');
      expect(fuchs).toBeDefined();
      expect(fuchs?.evidenceIds).toEqual(['ev-valid-1']);
    });

    it('salvages root-level title, premise, and locations when omitted from candidates array', () => {
      const sourceRecord: ForgeSourceRecord = {
        id: 'src-salvage-1',
        fileName: 'mortuary_report.md',
        mimeType: 'text/markdown',
        kind: 'document',
        receivedAt: Date.now(),
        fileSizeBytes: 1024,
      };

      const rawAnalysis = {
        title: 'Black Iron Ridge Facility',
        premise: 'A cryogenic station under catastrophic containment failure.',
        locations: [
          { id: 'airlock', label: 'Decompression Airlock', description: 'Cylindrical steel chamber.' },
          { id: 'autopsy', label: 'Autopsy Suite', description: 'Stainless steel dissection tables.' },
        ],
        evidence: [{ id: 'ev-1', category: 'setting', claim: 'Facility description' }],
        candidates: [
          {
            id: 'cand-dep-1',
            target: 'depiction_contract',
            label: 'Contract',
            explanation: 'Dread tone',
            classification: 'evidence',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Forensic dread',
              directness: 'Clinical directness',
              aftermath: 'Hypothermia',
              ambiguityHandling: 'Explicit physical clues',
            },
          },
        ],
      };

      const analysis = validateAndNormalizeDocumentAnalysis(rawAnalysis, sourceRecord);
      expect(analysis.status).toBe('completed');
      const titleCand = analysis.candidates.find((c) => c.target === 'scenario_title');
      expect(titleCand).toBeDefined();
      expect(titleCand?.proposedValue).toBe('Black Iron Ridge Facility');

      const premiseCand = analysis.candidates.find((c) => c.target === 'premise');
      expect(premiseCand).toBeDefined();
      expect(premiseCand?.proposedValue).toBe('A cryogenic station under catastrophic containment failure.');

      const nodeCands = analysis.candidates.filter((c) => c.target === 'topology_node');
      expect(nodeCands).toHaveLength(2);
      expect((nodeCands[0].proposedValue as Record<string, unknown>).label).toBe('Decompression Airlock');
      expect((nodeCands[1].proposedValue as Record<string, unknown>).label).toBe('Autopsy Suite');
    });

    it('reconcileDraftTopologyAndCast synthesizes bidirectional sequential connections for unconnected nodes', () => {
      const draft: ForgeDraft = {
        id: 'draft-unconnected-1',
        title: 'The Outpost',
        identity: { title: 'The Outpost', version: '1.0', author: '', thematicAnchor: '' },
        premise: 'Cold outpost.',
        setting: { location: 'Outpost Delta', atmosphere: 'Frozen', timePeriod: 'Modern' },
        deathContract: { metaphysics: 'mundane', powerBudget: 'Cold physical environment.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        topology: {
          nodes: ['chamber_1', 'chamber_2', 'chamber_3'],
          nodeDefinitions: [
            { id: 'chamber_1', label: 'Airlock', description: 'Chilly airlock' },
            { id: 'chamber_2', label: 'Main Hall', description: 'Frozen mess hall' },
            { id: 'chamber_3', label: 'Generator', description: 'Humming turbine' },
          ],
          connections: [],
          anchors: [],
        },
      };

      const reconciled = reconcileDraftTopologyAndCast(draft);
      expect(reconciled.topology?.connections).toBeDefined();
      expect(reconciled.topology?.connections).toHaveLength(4); // 1->2, 2->1, 2->3, 3->2
      const edges = reconciled.topology?.connections || [];
      expect(edges[0]).toEqual({ from: 'chamber_1', to: 'chamber_2', kind: 'PHYSICAL', userInitiated: true });
      expect(edges[1]).toEqual({ from: 'chamber_2', to: 'chamber_1', kind: 'PHYSICAL', userInitiated: true });
      expect(edges[2]).toEqual({ from: 'chamber_2', to: 'chamber_3', kind: 'PHYSICAL', userInitiated: true });
      expect(edges[3]).toEqual({ from: 'chamber_3', to: 'chamber_2', kind: 'PHYSICAL', userInitiated: true });
    });

    it('applyCandidateToDraft applies antagonist_profile candidate into draft', () => {
      const draft: ForgeDraft = {
        id: 'draft-antagonist-1',
        title: 'The Machine Facility',
        identity: { title: 'The Machine Facility', version: '1.0', author: '', thematicAnchor: '' },
        premise: 'Autonomous system gone mad.',
        setting: { location: 'Core 4', atmosphere: 'Clinical', timePeriod: 'Future' },
        deathContract: { metaphysics: 'mundane', powerBudget: 'Drone physical constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
      };

      const cand: ForgeSourceCandidate = {
        id: 'cand-antag-1',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'antagonist_profile',
        label: 'The Automated Surgical Unit',
        explanation: 'Extracted drone overseer',
        evidenceIds: [],
        reviewDecision: 'accepted',
        applicationState: 'staged',
        proposedValue: {
          entityName: 'Unit 734',
          role: 'Autopsy Drone',
          apparatusControls: ['hydraulic arm', 'door locks'],
          sadisticDirectives: ['excise anomalies'],
          telemetryFeeds: ['vital pulse camera'],
          targetVictimIds: [],
        } as unknown as AntagonistProfile,
      };

      const res = applyCandidateToDraft(draft, cand);
      expect(res.success).toBe(true);
      expect(res.draft.antagonistProfile).toBeDefined();
      expect(res.draft.antagonistProfile?.name).toBe('Unit 734');
      expect(res.draft.antagonistProfile?.apparatusControls).toHaveLength(2);
      expect(res.draft.villains).toBeDefined();
      expect(res.draft.villains).toHaveLength(1);
      expect(res.draft.villains![0].villainId).toBe('villain-unit734');
    });

    it('antagonist_profile threads to roster with name-matched villainId and snapshots cast persona', () => {
      const draft: ForgeDraft = {
        id: 'draft-antagonist-roster',
        title: 'The Machine Facility',
        identity: { title: 'The Machine Facility', version: '1.0', author: '', thematicAnchor: '' },
        premise: 'Autonomous system gone mad.',
        setting: { location: 'Core 4', atmosphere: 'Clinical', timePeriod: 'Future' },
        deathContract: { metaphysics: 'mundane', powerBudget: 'Drone physical constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        cast: [
          {
            id: 'char-overseer',
            name: 'Unit 734',
            description: 'An autopsy drone with articulated titanium scalpels.',
            personality: 'Calculating and devoid of mercy.',
            goals: 'Excise anomalies.',
            traits: ['robotic', 'deadly'],
            isUserCharacter: false,
          },
        ],
      };

      const cand1: ForgeSourceCandidate = {
        id: 'cand-antag-1',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'antagonist_profile',
        label: 'Unit 734',
        explanation: 'Extracted drone overseer',
        evidenceIds: [],
        reviewDecision: 'accepted',
        applicationState: 'staged',
        proposedValue: {
          entityName: 'Unit 734',
          role: 'Autopsy Drone',
          apparatusControls: [],
          sadisticDirectives: ['excise anomalies'],
          telemetryFeeds: [],
        } as unknown as AntagonistProfile,
      };

      const res1 = applyCandidateToDraft(draft, cand1);
      expect(res1.success).toBe(true);
      expect(res1.draft.villains).toHaveLength(1);
      expect(res1.draft.villains![0].villainId).toBe('char-overseer');
      expect(res1.draft.villains![0].name).toBe('Unit 734');
      expect(res1.draft.villains![0].castSeedPersona).toEqual({
        description: 'An autopsy drone with articulated titanium scalpels.',
        personality: 'Calculating and devoid of mercy.',
        goals: 'Excise anomalies.',
        traits: ['robotic', 'deadly'],
      });
      expect(res1.draft.antagonistProfile?.name).toBe('Unit 734');

      // Second profile: singular antagonistProfile remains first profile, while second threads to roster
      const cand2: ForgeSourceCandidate = {
        id: 'cand-antag-2',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'antagonist_profile',
        label: 'Corridor Stalker',
        explanation: 'Secondary sentry drone',
        evidenceIds: [],
        reviewDecision: 'accepted',
        applicationState: 'staged',
        proposedValue: {
          entityName: 'Corridor Stalker',
          role: 'Sentry Drone',
          apparatusControls: [],
          sadisticDirectives: ['patrol sectors'],
          telemetryFeeds: [],
        } as unknown as AntagonistProfile,
      };

      const res2 = applyCandidateToDraft(res1.draft, cand2);
      expect(res2.success).toBe(true);
      expect(res2.draft.villains).toHaveLength(2);
      expect(res2.draft.villains![1].name).toBe('Corridor Stalker');
      expect(res2.draft.villains![1].villainId).toBe('villain-corridorstalker');
      // Singular remains the first applied
      expect(res2.draft.antagonistProfile?.name).toBe('Unit 734');

      // Duplicate villainId is rejected
      const candDuplicate: ForgeSourceCandidate = {
        id: 'cand-antag-dup',
        sourceId: 'src-1',
        classification: 'evidence',
        target: 'antagonist_profile',
        label: 'Unit 734 Duplicate',
        explanation: 'Duplicate entry',
        evidenceIds: [],
        reviewDecision: 'accepted',
        applicationState: 'staged',
        proposedValue: {
          entityName: 'Unit 734',
        } as unknown as AntagonistProfile,
      };

      const resDup = applyCandidateToDraft(res2.draft, candDuplicate);
      expect(resDup.success).toBe(false);
      if ('error' in resDup) {
        expect(resDup.error).toContain("Duplicate villain roster entry for 'char-overseer'.");
      }
    });

    it('reconcileDraftTopologyAndCast grounds antagonist telemetry feeds and apparatus controls to topology nodes', () => {
      const draft: ForgeDraft = {
        id: 'draft-antagonist-recon',
        title: 'The Subterranean Complex',
        identity: { title: 'The Subterranean Complex', version: '1.0', author: '', thematicAnchor: '' },
        premise: 'Dread in the deep.',
        setting: { location: 'Bunker', atmosphere: 'Cold', timePeriod: '1980' },
        deathContract: { metaphysics: 'mundane', powerBudget: 'Subterranean constraints.', seatSuccession: {} },
        fearContract: defaultTestFearContract,
        topology: {
          startingNodeId: 'room_alpha',
          nodes: ['room_alpha', 'room_beta'],
          nodeDefinitions: [
            { id: 'room_alpha', label: 'Room Alpha' },
            { id: 'room_beta', label: 'Room Beta' },
          ],
          connections: [],
          anchors: [],
        },
        antagonistProfile: {
          kind: 'APPARATUS',
          name: 'The Central Overseer',
          apparatusControls: [
            {
              id: 'ctrl-1',
              name: 'Blast Bulkheads',
              kind: 'MECHANICAL',
              affectedNodeIds: ['all', 'nonexistent_chamber'],
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
              nodeId: 'all',
              feedType: 'OPTICAL_CAM',
              status: 'ONLINE',
              label: 'Overhead Surveillance Cam 2',
            },
          ],
          sadisticDirectives: ['Contain all intruders'],
          preyCohort: [],
        },
      };

      const reconciled = reconcileDraftTopologyAndCast(draft);
      expect(reconciled.antagonistProfile).toBeDefined();
      const feeds = reconciled.antagonistProfile!.telemetryFeeds!;
      expect(feeds).toHaveLength(2);
      expect(feeds[0].nodeId).toBe('room_alpha');
      expect(feeds[1].nodeId).toBe('room_beta');

      const ctrl = reconciled.antagonistProfile!.apparatusControls![0];
      expect(ctrl.affectedNodeIds).toEqual(['all', 'room_alpha']);
    });
  });

  describe('normalizeCastDisposition and cast_seed disposition coercion', () => {
    it('coerces model-invented disposition aliases to contract enums', () => {
      expect(normalizeCastDisposition('HOSTILE', false)).toBe('VILLAIN');
      expect(normalizeCastDisposition('ANTAGONIST', false)).toBe('VILLAIN');
      expect(normalizeCastDisposition('villain', false)).toBe('VILLAIN');
      expect(normalizeCastDisposition('NEUTRAL', false)).toBe('BYSTANDER');
      expect(normalizeCastDisposition('PROTAGONIST', false)).toBe('SURVIVOR');
      expect(normalizeCastDisposition('UNKNOWN_AI', true)).toBe('VILLAIN');
      expect(normalizeCastDisposition('UNKNOWN_AI', false)).toBe('SURVIVOR');
    });

    it('coerces cast_seed candidate disposition during document analysis normalization', () => {
      const rawAnalysis = {
        summary: 'Containment scenario summary.',
        evidence: [{ id: 'ev-1', quote: 'AM was hostile.' }],
        candidates: [
          {
            target: 'cast_seed',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'cast-am',
              name: 'AM',
              role: 'Computer Overlord',
              disposition: 'HOSTILE',
              isEntity: true,
            },
          },
          {
            target: 'cast_seed',
            evidenceIds: ['ev-1'],
            proposedValue: {
              id: 'cast-survivor',
              name: 'Elena Mercer',
              role: 'Survivor',
              disposition: 'HERO',
              isEntity: false,
            },
          },
        ],
        unknowns: [],
      };

      const record: ForgeSourceRecord = {
        id: 'rec-am-doc',
        kind: 'document',
        fileName: 'am_doc.txt',
        mimeType: 'text/plain',
        receivedAt: Date.now(),
      };

      const normalized = validateAndNormalizeDocumentAnalysis(rawAnalysis, record);
      const castCandidates = normalized.candidates.filter((c) => c.target === 'cast_seed');
      expect(castCandidates).toHaveLength(2);

      const amCand = castCandidates.find(
        (c) => (c.proposedValue as { id?: string }).id === 'cast-am'
      );
      expect((amCand?.proposedValue as { disposition?: string })?.disposition).toBe('VILLAIN');

      const survivorCand = castCandidates.find(
        (c) => (c.proposedValue as { id?: string }).id === 'cast-survivor'
      );
      expect((survivorCand?.proposedValue as { disposition?: string })?.disposition).toBe('SURVIVOR');
    });
  });
});

