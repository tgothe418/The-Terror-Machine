import { expect, test, describe, beforeEach, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  forgeActions,
  getForgeState,
  useForgeState,
  useForgeStore,
  useForgeStoreInternal,
  DraftCastMember,
  DraftPerspective,
  sanitizeSourceAnalyses,
} from './useForgeStore';
import { TopologyEdge } from '../types';
import {
  DepictionContract,
  DepictionContractProposal,
  ForgeSourceAnalysis,
  type ForgeSourceCandidate,
  type ForgeSourceEvidence,
} from '../types/forge';
import { compileForgeDraft } from '../lib/forgeCompiler';
import { useAppStore } from './useAppStore';

describe('useForgeStore - draft state and actions', () => {
  beforeEach(() => {
    // Reset the store before each test run
    forgeActions.resetStore();
  });

  test('1. initializeDraft creates a draft with the existing vector/tier defaults and an ID', () => {
    forgeActions.initializeDraft();
    const state = getForgeState();

    expect(state.forgeDraft).not.toBeNull();
    expect(state.draftBlueprint).toBe(state.forgeDraft);
    expect(state.forgeDraft?.id).toBeDefined();
    expect(typeof state.forgeDraft?.id).toBe('string');
    expect(state.forgeDraft?.id?.length).toBeGreaterThan(0);
    expect(state.forgeDraft?.startingVector).toBe('COGNITIVE');
    expect(state.forgeDraft?.startingTier).toBe('LATENT');
    expect(state.forgeDraft?.title).toBe('');
    expect(state.forgeDraft?.premise).toBe('');
    expect(state.forgeDraft?.environmentalRules).toBe('');
  });

  test('2. updateDraft merges a typed patch without losing existing draft values', () => {
    forgeActions.initializeDraft();
    const initialDraft = getForgeState().forgeDraft!;

    forgeActions.updateDraft({
      title: 'The Submerged Complex',
      environmentalRules: 'Pressure increases by 1 ATM per floor',
      setting: {
        location: 'Deep Trench Station',
        atmosphere: 'High humidity',
        timePeriod: '2099',
      },
    });

    const updatedState = getForgeState();
    expect(updatedState.forgeDraft?.id).toBe(initialDraft.id);
    expect(updatedState.forgeDraft?.startingVector).toBe('COGNITIVE');
    expect(updatedState.forgeDraft?.startingTier).toBe('LATENT');
    expect(updatedState.forgeDraft?.title).toBe('The Submerged Complex');
    expect(updatedState.forgeDraft?.identity?.title).toBe('The Submerged Complex');
    expect(updatedState.forgeDraft?.setting?.location).toBe('Deep Trench Station');
    expect(updatedState.forgeDraft?.environmentalRules).toBe(
      'Pressure increases by 1 ATM per floor'
    );

    // Further patch preserves existing setting and rules
    forgeActions.updateDraft({
      globalPremise: 'The facility is leaking containment fluid',
      startingTier: 'MANIFEST',
    });

    const secondPatchState = getForgeState();
    expect(secondPatchState.forgeDraft?.title).toBe('The Submerged Complex');
    expect(secondPatchState.forgeDraft?.startingVector).toBe('COGNITIVE');
    expect(secondPatchState.forgeDraft?.startingTier).toBe('MANIFEST');
    expect(secondPatchState.forgeDraft?.setting?.location).toBe('Deep Trench Station');
    expect(secondPatchState.forgeDraft?.globalPremise).toBe(
      'The facility is leaking containment fluid'
    );
  });

  test('3. Updating nested cast or perspective data produces a new draft structure and does not mutate the prior state snapshot', () => {
    forgeActions.initializeDraft();
    const initialCast: DraftCastMember[] = [
      {
        id: 'c1',
        name: 'Lead Researcher',
        description: 'Station Scientific Lead',
        behaviorVector: 'ADAPTIVE',
      },
    ];
    const initialPerspectives: DraftPerspective[] = [
      {
        role: 'PROTAGONIST',
        framingDirective: 'First person claustrophobic',
        startingSemanticState: 'ISOLATED',
      },
    ];

    forgeActions.updateDraft({
      cast: initialCast,
      perspectives: initialPerspectives,
    });

    const snapshotBefore = getForgeState();
    const draftSnapshotBefore = snapshotBefore.forgeDraft!;
    const castSnapshotBefore = draftSnapshotBefore.cast!;
    const perspectiveSnapshotBefore = draftSnapshotBefore.perspectives!;

    // Perform immutable nested cast update
    const updatedCast = castSnapshotBefore.map((c) =>
      c.id === 'c1' ? { ...c, name: 'Senior Specialist', behaviorVector: 'PANIC' } : c
    );
    const updatedPerspectives = perspectiveSnapshotBefore.map((p) =>
      p.role === 'PROTAGONIST' ? { ...p, startingSemanticState: 'TRAPPED' } : p
    );

    forgeActions.updateDraft({
      cast: updatedCast,
      perspectives: updatedPerspectives,
    });

    const snapshotAfter = getForgeState();
    const draftSnapshotAfter = snapshotAfter.forgeDraft!;

    // Verify new state
    expect(draftSnapshotAfter.cast?.[0].name).toBe('Senior Specialist');
    expect(draftSnapshotAfter.cast?.[0].behaviorVector).toBe('PANIC');
    expect(draftSnapshotAfter.perspectives?.[0].startingSemanticState).toBe('TRAPPED');

    // Verify snapshotBefore was not mutated
    expect(castSnapshotBefore[0].name).toBe('Lead Researcher');
    expect(castSnapshotBefore[0].behaviorVector).toBe('ADAPTIVE');
    expect(perspectiveSnapshotBefore[0].startingSemanticState).toBe('ISOLATED');
    expect(draftSnapshotBefore).not.toBe(draftSnapshotAfter);
  });

  test('4. removeReference removes only the requested reference and leaves the other draft data intact', () => {
    forgeActions.initializeDraft();
    forgeActions.updateDraft({
      title: 'Facility Log Reference Test',
      startingVector: 'SOMATIC',
      startingTier: 'GATEWAY',
      references: ['manifest.pdf', 'security_briefing.txt', 'audio_log_04.md'],
    });

    forgeActions.removeReference('security_briefing.txt');

    const state = getForgeState();
    expect(state.forgeDraft?.references).toEqual(['manifest.pdf', 'audio_log_04.md']);
    expect(state.forgeDraft?.title).toBe('Facility Log Reference Test');
    expect(state.forgeDraft?.startingVector).toBe('SOMATIC');
    expect(state.forgeDraft?.startingTier).toBe('GATEWAY');

    // Removing a non-existent reference leaves array intact
    forgeActions.removeReference('non_existent.doc');
    expect(getForgeState().forgeDraft?.references).toEqual(['manifest.pdf', 'audio_log_04.md']);
  });

  test('5. A draft containing both a legacy string connection and a canonical TopologyEdge is retained as authoring state', () => {
    forgeActions.initializeDraft();

    const mixedConnections: Array<TopologyEdge | string> = [
      'Airlock -> Decontamination',
      {
        from: 'Decontamination',
        to: 'Bio-Lab',
        kind: 'PHYSICAL',
        authority: 'user',
        userInitiated: true,
        legacyUpgraded: true,
      },
    ];

    forgeActions.updateDraft({
      topology: {
        nodes: ['Airlock', 'Decontamination', 'Bio-Lab'],
        connections: mixedConnections,
      },
    });

    const state = getForgeState();
    expect(state.forgeDraft?.topology).toBeDefined();
    expect(state.forgeDraft?.topology?.nodes).toEqual([
      'Airlock',
      'Decontamination',
      'Bio-Lab',
    ]);
    expect(state.forgeDraft?.topology?.connections).toHaveLength(2);
    expect(state.forgeDraft?.topology?.connections?.[0]).toBe('Airlock -> Decontamination');
    expect(state.forgeDraft?.topology?.connections?.[1]).toEqual({
      from: 'Decontamination',
      to: 'Bio-Lab',
      kind: 'PHYSICAL',
      authority: 'user',
      userInitiated: true,
      legacyUpgraded: true,
    });
  });

  test('6. replaceDraft completely replaces the current draft with a clean deep clone', () => {
    forgeActions.initializeDraft();
    const externalDraft = {
      id: 'ext-draft-99',
      title: 'Imported Scenario',
      premise: 'Imported premise content',
      globalPremise: 'Imported premise content',
      startingVector: 'COSMIC' as const,
      startingTier: 'MANIFEST' as const,
      environmentalRules: 'Total silence',
      constraints: ['No artificial light'],
      contentScale: 5,
      contentLevelDescription: 'Extreme',
      identity: {
        title: 'Imported Scenario',
        version: '2.0',
        author: 'Unknown Author',
        thematicAnchor: 'Void',
      },
      setting: {
        location: 'Derelict Deep Space Array',
        atmosphere: 'Vacuum frost',
        timePeriod: '3022',
      },
      cast: [],
      perspectives: [],
      topology: { nodes: [], connections: [] },
      narrativeRules: {
        incitingIncident: '',
        phaseDirectives: {},
        currentTensionLevel: 'buildup',
        keyPlotElements: [],
      },
      references: [],
      characters: [],
      deathContract: {
        metaphysics: 'mundane' as const,
        deathMetaphysics: 'mundane' as const,
        powerBudget: 'Standard cosmic constraints.',
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

    forgeActions.replaceDraft(externalDraft);

    const state = getForgeState();
    expect(state.forgeDraft?.id).toBe('ext-draft-99');
    expect(state.forgeDraft?.title).toBe('Imported Scenario');
    expect(state.forgeDraft?.startingVector).toBe('COSMIC');
    expect(state.draftBlueprint).toEqual(state.forgeDraft);
  });

  test('7. Forge draft actions never mutate or reset App runtime state', () => {
    const appBefore = useAppStore.getState();

    forgeActions.initializeDraft();
    forgeActions.updateDraft({ title: 'New Scenario Draft' });
    forgeActions.resetStore();

    const appAfter = useAppStore.getState();

    expect(appAfter.sessionId).toBe(appBefore.sessionId);
    expect(appAfter.phase).toBe(appBefore.phase);
  });

  test('8. Legacy-compatible cast actions write directly to canonical forgeDraft and keep castLedger synchronized', () => {
    forgeActions.initializeDraft();

    // Add cast member via legacy action
    forgeActions.addCastMember({
      name: 'Dr. John Croft',
      role: 'PROTAGONIST',
      psychological_status: 'Hyper-vigilant and experiencing auditory anomalies.',
      starting_location: 'Sub-Level 3 Security Airlock',
      isEntity: false,
    });

    const stateAfterAdd = getForgeState();
    expect(stateAfterAdd.forgeDraft?.cast).toHaveLength(1);
    expect(stateAfterAdd.forgeDraft?.cast?.[0].name).toBe('Dr. John Croft');
    expect(stateAfterAdd.forgeDraft?.cast?.[0].role).toBe('PROTAGONIST');
    expect(stateAfterAdd.forgeDraft?.cast?.[0].isUserCharacter).toBe(true);
    expect(stateAfterAdd.forgeDraft?.cast?.[0].starting_location).toBe('Sub-Level 3 Security Airlock');

    // castLedger should match canonical draft
    expect(stateAfterAdd.castLedger).toHaveLength(1);
    expect(stateAfterAdd.castLedger[0].name).toBe('Dr. John Croft');
    expect(stateAfterAdd.castLedger[0].id).toBe(stateAfterAdd.forgeDraft?.cast?.[0].id);

    // Update cast member via legacy action
    const castId = stateAfterAdd.castLedger[0].id;
    forgeActions.updateCastMember(castId, {
      name: 'Dr. Jonathan Croft',
      psychological_status: 'Auditory hallucinations escalating rapidly.',
    });

    const stateAfterUpdate = getForgeState();
    expect(stateAfterUpdate.forgeDraft?.cast?.[0].name).toBe('Dr. Jonathan Croft');
    expect(stateAfterUpdate.forgeDraft?.cast?.[0].psychological_status).toBe(
      'Auditory hallucinations escalating rapidly.'
    );
    expect(stateAfterUpdate.castLedger[0].name).toBe('Dr. Jonathan Croft');

    // Remove cast member via legacy action
    forgeActions.removeCastMember(castId);
    const stateAfterRemove = getForgeState();
    expect(stateAfterRemove.forgeDraft?.cast).toHaveLength(0);
    expect(stateAfterRemove.castLedger).toHaveLength(0);
  });

  test('9. Legacy-compatible topology actions write directly to canonical forgeDraft and keep topology synchronized', () => {
    forgeActions.initializeDraft();

    // Add nodes via legacy action
    forgeActions.addSpatialNode('NODE_VAULT');
    forgeActions.addSpatialNode('NODE_CONTROL');

    const stateAfterNodes = getForgeState();
    expect(stateAfterNodes.forgeDraft?.topology?.nodes).toContain('NODE_VAULT');
    expect(stateAfterNodes.forgeDraft?.topology?.nodes).toContain('NODE_CONTROL');
    expect(stateAfterNodes.topology['NODE_VAULT']).toBeDefined();
    expect(stateAfterNodes.topology['NODE_CONTROL']).toBeDefined();

    // Toggle edge between nodes
    forgeActions.toggleSpatialEdge('NODE_VAULT', 'NODE_CONTROL');
    const stateAfterEdge = getForgeState();
    expect(stateAfterEdge.forgeDraft?.topology?.connections).toHaveLength(1);
    expect(stateAfterEdge.topology['NODE_VAULT']).toContain('NODE_CONTROL');
    expect(stateAfterEdge.topology['NODE_CONTROL']).toContain('NODE_VAULT');

    // Remove node cleans up connections in canonical draft and derived topology
    forgeActions.removeSpatialNode('NODE_CONTROL');
    const stateAfterRemoveNode = getForgeState();
    expect(stateAfterRemoveNode.forgeDraft?.topology?.nodes).not.toContain('NODE_CONTROL');
    expect(stateAfterRemoveNode.forgeDraft?.topology?.connections).toHaveLength(0);
    expect(stateAfterRemoveNode.topology['NODE_CONTROL']).toBeUndefined();
  });

  test('10. draftBlueprint remains strictly identical to forgeDraft with no separate authoring fork', () => {
    forgeActions.initializeDraft();
    forgeActions.updateDraft({ title: 'Single Authority Confirmation' });

    const state = getForgeState();
    expect(state.draftBlueprint).toBe(state.forgeDraft);
    expect(state.draftBlueprint?.title).toBe('Single Authority Confirmation');
  });

  test('11. registerSourceAnalysis registers analysis without mutating forgeDraft', () => {
    forgeActions.initializeDraft({ title: 'Untouched Title', premise: 'Untouched Premise' });
    const draftBefore = getForgeState().forgeDraft;

    const mockAnalysis = {
      id: 'analysis-1',
      sourceRecord: {
        id: 'src-1',
        fileName: 'imported.json',
        mimeType: 'application/json',
        kind: 'native_blueprint' as const,
        receivedAt: Date.now(),
      },
      summary: 'Imported test scenario',
      evidence: [
        {
          id: 'ev-1',
          sourceId: 'src-1',
          category: 'identity' as const,
          claim: 'Title is Overwrite Attempt',
        },
      ],
      candidates: [
        {
          id: 'cand-1',
          sourceId: 'src-1',
          classification: 'evidence' as const,
          target: 'scenario_title' as const,
          label: 'Scenario Title',
          explanation: 'Extracted title',
          evidenceIds: ['ev-1'],
          proposedValue: 'Overwrite Attempt',
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
      ],
      unknowns: [],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-1');

    const state = getForgeState();
    expect(state.sourceAnalyses['analysis-1']).toBeDefined();
    // Invariant 1: Uploading must never mutate or overwrite forgeDraft
    expect(state.forgeDraft?.title).toBe('Untouched Title');
    expect(state.forgeDraft?.premise).toBe('Untouched Premise');
    expect(state.forgeDraft).toEqual(draftBefore);
  });

  test('12. applyAcceptedCandidates is the canonical path updating forgeDraft atomically with provenance', () => {
    forgeActions.initializeDraft({ title: 'Initial Title' });
    const initialRevision = getForgeState().draftRevision || 0;

    const mockAnalysis = {
      id: 'analysis-2',
      sourceRecord: {
        id: 'src-2',
        fileName: 'story_notes.pdf',
        mimeType: 'application/pdf',
        kind: 'document' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [
        {
          id: 'cand-setting',
          sourceId: 'src-2',
          classification: 'evidence' as const,
          target: 'setting_location' as const,
          label: 'Location',
          explanation: 'Extracted setting',
          evidenceIds: [],
          proposedValue: 'The Sunken Crypt',
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
      ],
      unknowns: [],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-2');
    expect(getForgeState().forgeDraft?.setting?.location).toBe('');

    // Atomic apply of accepted candidates
    const result = forgeActions.applyAcceptedCandidates('analysis-2');
    expect(result.success).toBe(true);

    const stateAfterApply = getForgeState();
    expect(stateAfterApply.forgeDraft?.setting?.location).toBe('The Sunken Crypt');
    expect(stateAfterApply.forgeDraft?.references).toContain('story_notes.pdf');
    expect(stateAfterApply.draftRevision).toBe(initialRevision + 1);
    expect(stateAfterApply.sourceAnalyses['analysis-2'].candidates[0].reviewDecision).toBe('accepted');
    expect(stateAfterApply.sourceAnalyses['analysis-2'].candidates[0].applicationState).toBe('applied');

    // Removing analysis does NOT roll back accepted draft content
    forgeActions.removeSourceAnalysis('analysis-2');
    const stateAfterRemove = getForgeState();
    expect(stateAfterRemove.sourceAnalyses['analysis-2']).toBeUndefined();
    expect(stateAfterRemove.forgeDraft?.setting?.location).toBe('The Sunken Crypt');
    expect(stateAfterRemove.forgeDraft?.references).toContain('story_notes.pdf');
  });

  test('12b. A batch containing valid candidates plus one invalid candidate performs no mutations (atomic rollback)', () => {
    forgeActions.initializeDraft({ title: 'Initial Title' });
    const baselineDraft = JSON.parse(JSON.stringify(getForgeState().forgeDraft));
    const initialRevision = getForgeState().draftRevision || 0;

    const mockAnalysis = {
      id: 'analysis-batch-fail',
      sourceRecord: {
        id: 'src-batch-fail',
        fileName: 'batch_test.pdf',
        mimeType: 'application/pdf',
        kind: 'document' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [
        {
          id: 'cand-valid-title',
          sourceId: 'src-batch-fail',
          classification: 'evidence' as const,
          target: 'scenario_title' as const,
          label: 'Valid Title',
          explanation: 'Good title',
          evidenceIds: [],
          proposedValue: 'Valid Scenario Title',
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
        {
          id: 'cand-invalid-expr',
          sourceId: 'src-batch-fail',
          classification: 'inference' as const,
          target: 'cast_expression_guidance' as const,
          targetCastMemberId: 'non-existent-cast-member-id',
          label: 'Invalid Character Guidance',
          explanation: 'Target character does not exist',
          evidenceIds: [],
          proposedValue: {
            communicationModes: ['spoken' as const],
            expressionGuidance: 'Radio chatter',
          },
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
      ],
      unknowns: [],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-batch-fail');

    // Apply batch with invalid candidate
    const result = forgeActions.applyAcceptedCandidates('analysis-batch-fail');
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = (result as { success: false; errors: Record<string, string> }).errors;
      expect(errs['cand-invalid-expr']).toBeDefined();
      expect(errs['cand-invalid-expr']).toContain('not found in active draft');
    }

    const stateAfterFail = getForgeState();
    // 1. draftBlueprint / forgeDraft unchanged
    expect(stateAfterFail.forgeDraft).toEqual(baselineDraft);
    expect(stateAfterFail.draftBlueprint).toEqual(baselineDraft);
    // 2. draftRevision unchanged
    expect(stateAfterFail.draftRevision).toBe(initialRevision);
  });

  test('12c. A successful batch applies every accepted staged candidate exactly once and advances draftRevision once', () => {
    forgeActions.initializeDraft({ title: 'Initial Title' });
    const initialRevision = getForgeState().draftRevision || 0;

    const mockAnalysis = {
      id: 'analysis-batch-success',
      sourceRecord: {
        id: 'src-success',
        fileName: 'batch_success.json',
        mimeType: 'application/json',
        kind: 'native_blueprint' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [
        {
          id: 'cand-1-loc',
          sourceId: 'src-success',
          classification: 'evidence' as const,
          target: 'setting_location' as const,
          label: 'Location',
          explanation: 'Extracted setting',
          evidenceIds: [],
          proposedValue: 'Deep Ocean Rig',
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
        {
          id: 'cand-2-atmos',
          sourceId: 'src-success',
          classification: 'evidence' as const,
          target: 'setting_atmosphere' as const,
          label: 'Atmosphere',
          explanation: 'Extracted atmosphere',
          evidenceIds: [],
          proposedValue: 'Humid, metallic scent',
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
        {
          id: 'cand-3-cast',
          sourceId: 'src-success',
          classification: 'evidence' as const,
          target: 'cast_seed' as const,
          label: 'Cast Member',
          explanation: 'Extracted cast',
          evidenceIds: [],
          proposedValue: {
            id: 'char-batch-1',
            name: 'Engineer Hayes',
            role: 'PROTAGONIST',
            description: 'Lead Technician',
            personality: '',
            goals: '',
            traits: [],
            isUserCharacter: false,
            behaviorVector: 'ADAPTIVE',
            isEntity: false,
            disposition: 'SURVIVOR' as const,
          },
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
      ],
      unknowns: [],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-batch-success');

    const result = forgeActions.applyAcceptedCandidates('analysis-batch-success');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.appliedCandidateIds).toEqual(['cand-3-cast', 'cand-1-loc', 'cand-2-atmos']);
    }

    const state = getForgeState();
    expect(state.draftRevision).toBe(initialRevision + 1);
    expect(state.forgeDraft?.setting?.location).toBe('Deep Ocean Rig');
    expect(state.forgeDraft?.setting?.atmosphere).toBe('Humid, metallic scent');
    expect(state.forgeDraft?.cast?.find((c) => c.id === 'char-batch-1')).toBeDefined();
    expect(state.sourceAnalyses['analysis-batch-success'].candidates.every((c) => c.applicationState === 'applied')).toBe(true);
  });

  test('12d. Rejected candidates remain staged ledger entries and are not applied during applyAcceptedCandidates', () => {
    forgeActions.initializeDraft({ title: 'Initial Title' });
    const initialRevision = getForgeState().draftRevision || 0;

    const mockAnalysis = {
      id: 'analysis-reject-test',
      sourceRecord: {
        id: 'src-rej',
        fileName: 'reject_notes.txt',
        mimeType: 'text/plain',
        kind: 'document' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [
        {
          id: 'cand-keep',
          sourceId: 'src-rej',
          classification: 'evidence' as const,
          target: 'setting_location' as const,
          label: 'Location',
          explanation: 'Extracted location',
          evidenceIds: [],
          proposedValue: 'Kept Location',
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
        {
          id: 'cand-rejected',
          sourceId: 'src-rej',
          classification: 'evidence' as const,
          target: 'setting_atmosphere' as const,
          label: 'Atmosphere',
          explanation: 'Extracted atmosphere',
          evidenceIds: [],
          proposedValue: 'Unwanted Atmosphere',
          reviewDecision: 'rejected' as const,
          applicationState: 'staged' as const,
        },
      ],
      unknowns: [],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-reject-test');

    const result = forgeActions.applyAcceptedCandidates('analysis-reject-test');
    expect(result.success).toBe(true);

    const state = getForgeState();
    expect(state.draftRevision).toBe(initialRevision + 1);
    expect(state.forgeDraft?.setting?.location).toBe('Kept Location');
    // Rejected candidate was NOT applied
    expect(state.forgeDraft?.setting?.atmosphere).toBe('');

    const analysis = state.sourceAnalyses['analysis-reject-test'];
    const keptCand = analysis.candidates.find((c) => c.id === 'cand-keep')!;
    const rejectedCand = analysis.candidates.find((c) => c.id === 'cand-rejected')!;

    expect(keptCand.reviewDecision).toBe('accepted');
    expect(keptCand.applicationState).toBe('applied');

    // Rejected candidate remains staged ledger entry
    expect(rejectedCand.reviewDecision).toBe('rejected');
    expect(rejectedCand.applicationState).toBe('staged');
  });

  test('13. rejectCandidate and editPendingCandidate do not mutate forgeDraft', () => {
    forgeActions.initializeDraft({ title: 'Authored Title' });

    const mockAnalysis = {
      id: 'analysis-3',
      sourceRecord: {
        id: 'src-3',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        kind: 'document' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [
        {
          id: 'cand-premise',
          sourceId: 'src-3',
          classification: 'inference' as const,
          target: 'premise' as const,
          label: 'Premise',
          explanation: 'Inferred premise',
          evidenceIds: [],
          proposedValue: 'Inferred Premise text',
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
      ],
      unknowns: [],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-3');

    // Edit candidate proposal
    forgeActions.editPendingCandidate('analysis-3', 'cand-premise', 'Polished Inferred Premise');
    const stateAfterEdit = getForgeState();
    expect(stateAfterEdit.sourceAnalyses['analysis-3'].candidates[0].proposedValue).toBe(
      'Polished Inferred Premise'
    );
    expect(stateAfterEdit.forgeDraft?.premise).toBe('');

    // Reject candidate
    forgeActions.rejectCandidate('analysis-3', 'cand-premise');
    const stateAfterReject = getForgeState();
    expect(stateAfterReject.sourceAnalyses['analysis-3'].candidates[0].reviewDecision).toBe('rejected');
    expect(stateAfterReject.forgeDraft?.premise).toBe('');
    expect(stateAfterReject.forgeDraft?.title).toBe('Authored Title');
  });

  test('14. sanitizeSourceAnalyses normalizes dual-keyed entries into one canonical entry and discards malformed entries', () => {
    const validAnalysis = {
      id: 'analysis-canon-1',
      sourceRecord: {
        id: 'src-canon-1',
        fileName: 'canon.json',
        mimeType: 'application/json',
        kind: 'native_blueprint' as const,
        receivedAt: 1000,
      },
      evidence: [],
      candidates: [],
      unknowns: [],
      validationIssues: [],
      status: 'completed' as const,
    };

    const rawMap: Record<string, unknown> = {
      'src-canon-1': validAnalysis,
      'analysis-canon-1': validAnalysis,
      'malformed-entry': { invalid: 'shape' },
    };

    const sanitized = sanitizeSourceAnalyses(rawMap);
    expect(Object.keys(sanitized)).toEqual(['analysis-canon-1']);
    expect(sanitized['analysis-canon-1']).toEqual(validAnalysis);
  });

  test('15. Ambiguity lifecycle transitions cleanly through submit, follow-up, proposal, and acceptance', () => {
    forgeActions.initializeDraft({ title: 'Atmospheric Station' });

    const mockAnalysis = {
      id: 'analysis-ambiguity-test',
      sourceRecord: {
        id: 'src-amb-1',
        fileName: 'station_specs.pdf',
        mimeType: 'application/pdf',
        kind: 'document' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [],
      unknowns: [
        {
          id: 'unk-atmospheric-pressure',
          sourceId: 'src-amb-1',
          category: 'setting' as const,
          question: 'What is the atmospheric pressure inside Sector 4?',
          targetEffect: 'Clarifies whether helmets are required in Sector 4.',
          status: 'queued' as const,
          followUps: [],
        },
      ],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-ambiguity-test');

    // 1. Submit initial answer
    forgeActions.submitUnknownAnswer(
      'analysis-ambiguity-test',
      'unk-atmospheric-pressure',
      'The pressure is reduced to 0.4 atm following a coolant rupture.'
    );

    let state = getForgeState();
    let unk = state.sourceAnalyses['analysis-ambiguity-test'].unknowns[0];
    expect(unk.submittedAnswer).toBe('The pressure is reduced to 0.4 atm following a coolant rupture.');
    expect(unk.status).toBe('awaiting_response');

    // 2. Receive follow-up question
    forgeActions.receiveUnknownFollowUp(
      'analysis-ambiguity-test',
      'unk-atmospheric-pressure',
      'Does this require emergency re-breathers?'
    );

    state = getForgeState();
    unk = state.sourceAnalyses['analysis-ambiguity-test'].unknowns[0];
    expect(unk.followUps).toHaveLength(1);
    expect(unk.followUps[0].question).toBe('Does this require emergency re-breathers?');
    expect(unk.status).toBe('queued');

    // 3. Submit follow-up answer
    forgeActions.submitUnknownAnswer(
      'analysis-ambiguity-test',
      'unk-atmospheric-pressure',
      'Yes, emergency re-breathers are required.'
    );

    state = getForgeState();
    unk = state.sourceAnalyses['analysis-ambiguity-test'].unknowns[0];
    expect(unk.followUps[0].answer).toBe('Yes, emergency re-breathers are required.');
    expect(unk.status).toBe('awaiting_response');

    // 4. Receive resolution proposal
    forgeActions.receiveUnknownProposal(
      'analysis-ambiguity-test',
      'unk-atmospheric-pressure',
      {
        resolution: 'Sector 4 operates at 0.4 atm with toxic coolant fumes; re-breathers required.',
        targetEffect: 'Clarifies whether helmets are required in Sector 4.',
        draftPatch: {
          operations: [
            {
              target: 'setting_atmosphere',
              text: '0.4 atm low pressure with emergency re-breathers active.',
            },
          ],
        },
      }
    );

    state = getForgeState();
    unk = state.sourceAnalyses['analysis-ambiguity-test'].unknowns[0];
    expect(unk.status).toBe('awaiting_confirmation');
    expect(unk.resolutionProposal?.resolution).toContain('Sector 4 operates at 0.4 atm');

    // 5. Accept resolution
    const commitResult = forgeActions.acceptUnknownResolution(
      'analysis-ambiguity-test',
      'unk-atmospheric-pressure'
    );
    expect(commitResult.success).toBe(true);

    state = getForgeState();
    unk = state.sourceAnalyses['analysis-ambiguity-test'].unknowns[0];
    expect(unk.status).toBe('resolved');
    expect(state.forgeDraft?.setting?.atmosphere).toBe('0.4 atm low pressure with emergency re-breathers active.');
    expect(state.forgeDraft?.ambiguities).toHaveLength(1);
    const amb0 = state.forgeDraft?.ambiguities![0];
    if (amb0 && amb0.resolutionMode === 'USER_DEFINED') {
      expect(amb0.resolution).toContain('Sector 4 operates at 0.4 atm');
    } else {
      expect.unreachable();
    }
  });

  test('16. acceptUnknownResolution rolls back cleanly if draftPatch application fails', () => {
    forgeActions.initializeDraft({ title: 'Rollback Scenario', premise: 'Initial Premise' });

    const mockAnalysis = {
      id: 'analysis-rollback-test',
      sourceRecord: {
        id: 'src-roll-1',
        fileName: 'patch_fail.json',
        mimeType: 'application/json',
        kind: 'native_blueprint' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [],
      unknowns: [
        {
          id: 'unk-cast-invalid',
          sourceId: 'src-roll-1',
          category: 'cast' as const,
          question: 'What is the role of nonexistent cast member?',
          targetEffect: 'Mutates non-existent cast member.',
          status: 'awaiting_confirmation' as const,
          followUps: [],
          resolutionProposal: {
            resolution: 'Assign rogue personality.',
            targetEffect: 'Mutates non-existent cast member.',
            draftPatch: {
              operations: [
                {
                  target: 'cast_personality' as const,
                  castMemberId: 'nonexistent-cast-id',
                  text: 'Rogue personality.',
                },
              ],
            },
          },
        },
      ],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-rollback-test');

    const initialRevision = getForgeState().draftRevision;
    const initialPremise = getForgeState().forgeDraft?.premise;

    const commitResult = forgeActions.acceptUnknownResolution(
      'analysis-rollback-test',
      'unk-cast-invalid'
    );

    expect(commitResult.success).toBe(false);
    if (!commitResult.success && 'error' in commitResult) {
      expect((commitResult as { success: false; error: string }).error).toContain('nonexistent-cast-id');
    }

    const state = getForgeState();
    expect(state.sourceAnalyses['analysis-rollback-test']).toBeDefined();
    const unk = state.sourceAnalyses['analysis-rollback-test'].unknowns[0];

    // Status remains awaiting_confirmation
    expect(unk.status).toBe('awaiting_confirmation');
    expect(unk.lastError).toContain('nonexistent-cast-id');

    // Draft unchanged
    expect(state.draftRevision).toBe(initialRevision);
    expect(state.forgeDraft?.premise).toBe(initialPremise);
    expect(state.forgeDraft?.ambiguities || []).toHaveLength(0);
  });

  test('17. leaveUnknownUncertain marks unknown as CONTEXTUAL_DISCRETION without applying patch', () => {
    forgeActions.initializeDraft({ title: 'Uncertainty Scenario' });

    const mockAnalysis = {
      id: 'analysis-uncertain-test',
      sourceRecord: {
        id: 'src-unc-1',
        fileName: 'unknown_source.txt',
        mimeType: 'text/plain',
        kind: 'document' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [],
      unknowns: [
        {
          id: 'unk-uncertain-1',
          sourceId: 'src-unc-1',
          category: 'rule' as const,
          question: 'Is the power grid stable?',
          targetEffect: 'Determines blackout probability.',
          status: 'queued' as const,
          followUps: [],
        },
      ],
      status: 'completed' as const,
    };

    forgeActions.registerSourceAnalysis(mockAnalysis, 'mock-binding-uncertain-test');

    forgeActions.leaveUnknownUncertain(
      'analysis-uncertain-test',
      'unk-uncertain-1',
      'Leave power grid stability to Director AI during session.'
    );

    const state = getForgeState();
    const unk = state.sourceAnalyses['analysis-uncertain-test'].unknowns[0];
    expect(unk.status).toBe('contextual_discretion');
    expect(state.forgeDraft?.ambiguities).toHaveLength(1);
    const amb0 = state.forgeDraft?.ambiguities![0];
    if (amb0 && amb0.resolutionMode === 'CONTEXTUAL_DISCRETION') {
      expect(amb0.guidance).toBe(
        'Leave power grid stability to Director AI during session.'
      );
    } else {
      expect.unreachable();
    }
  });

  test('18. Depiction Contract Proposal validation and application works end-to-end', () => {
    forgeActions.initializeDraft({ title: 'Gothic Manor' });
    const initialRev = getForgeState().draftRevision;
    const initialBaselineRev = getForgeState().sourceBaselineRevision;

    const validProposal: DepictionContractProposal = {
      contract: {
        dramaticRegister: 'Psychological Horror',
        directness: 'Implied',
        aftermath: 'Lingering dread',
        ambiguityHandling: 'Unreliable narrator',
        specialBoundaries: 'No physical violence depiction.',
      },
      rationale: 'Elevates psychological dread.',
      sourceDraftRevision: initialRev,
      sourceBaselineRevision: initialBaselineRev,
      createdAt: Date.now(),
    };

    forgeActions.setPendingDepictionContractProposal(validProposal);
    expect(getForgeState().pendingDepictionContractProposal).toEqual(validProposal);

    const applyResult = forgeActions.applyPendingDepictionContractProposal();
    expect(applyResult.success).toBe(true);

    const stateAfter = getForgeState();
    expect(stateAfter.pendingDepictionContractProposal).toBeNull();
    expect(stateAfter.forgeDraft?.depictionContract).toEqual(validProposal.contract);
    expect(stateAfter.draftRevision).toBe(initialRev + 1);
  });

  test('19. Stale Depiction Contract Proposal rejection prevents applying out-of-date proposals', () => {
    forgeActions.initializeDraft({ title: 'Stale Check Scenario' });
    let state = getForgeState();

    forgeActions.setPendingDepictionContractProposal({
      contract: {
        dramaticRegister: 'Gothic Romance',
        directness: 'Subtle',
        aftermath: 'Quiet sorrow',
        ambiguityHandling: 'Poetic ambiguity',
        specialBoundaries: '',
      },
      rationale: 'Gothic tone.',
      sourceDraftRevision: state.draftRevision,
      sourceBaselineRevision: state.sourceBaselineRevision,
      createdAt: 1000,
    });

    // Mutate draft directly (advances draftRevision)
    forgeActions.updateDraft({ title: 'New Manor Incident' });
    expect(getForgeState().draftRevision).toBe(state.draftRevision + 1);

    // Apply should now fail with stale draft revision
    const staleDraftResult = forgeActions.applyPendingDepictionContractProposal();
    expect(staleDraftResult.success).toBe(false);
    if (!staleDraftResult.success) {
      expect((staleDraftResult as { success: false; error: string; stale?: boolean }).stale).toBe(true);
      expect((staleDraftResult as { success: false; error: string; stale?: boolean }).error).toContain('Proposal is stale');
    }

    // Pending proposal remains intact and draft depiction contract untouched
    state = getForgeState();
    expect(state.pendingDepictionContractProposal).not.toBeNull();
    expect(state.forgeDraft?.depictionContract?.dramaticRegister).not.toBe('Gothic Romance');

    // Update proposal to match current draftRevision, but leave sourceBaselineRevision stale
    forgeActions.setPendingDepictionContractProposal({
      contract: {
        dramaticRegister: 'Gothic Romance',
        directness: 'Subtle',
        aftermath: 'Quiet sorrow',
        ambiguityHandling: 'Poetic ambiguity',
        specialBoundaries: '',
      },
      rationale: 'Gothic tone updated.',
      sourceDraftRevision: state.draftRevision,
      sourceBaselineRevision: state.sourceBaselineRevision,
      createdAt: 2000,
    });

    // Advance sourceBaselineRevision by registering an analysis
    forgeActions.registerSourceAnalysis({
      id: 'analysis-stale-test',
      sourceRecord: {
        id: 'src-stale',
        fileName: 'intake.txt',
        mimeType: 'text/plain',
        kind: 'document',
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [],
      unknowns: [],
      status: 'completed',
    }, 'mock-binding-stale-test');

    // Apply should now fail with stale baseline revision
    const staleBaselineResult = forgeActions.applyPendingDepictionContractProposal();
    expect(staleBaselineResult.success).toBe(false);
    if (!staleBaselineResult.success) {
      expect((staleBaselineResult as { success: false; error: string; stale?: boolean }).stale).toBe(true);
      expect((staleBaselineResult as { success: false; error: string; stale?: boolean }).error).toContain('Proposal is stale');
    }

    state = getForgeState();
    expect(state.pendingDepictionContractProposal).not.toBeNull();
  });

  test('20. dismissPendingDepictionContractProposal and updateDepictionContractField work correctly', () => {
    forgeActions.initializeDraft();

    // Set proposal and dismiss it
    forgeActions.setPendingDepictionContractProposal({
      contract: {
        dramaticRegister: 'Sci-Fi Horror',
        directness: 'Explicit',
        aftermath: 'Terminal insanity',
        ambiguityHandling: 'None',
        specialBoundaries: '',
      },
      rationale: 'Test dismiss.',
      sourceDraftRevision: 1,
      sourceBaselineRevision: 1,
      createdAt: 1000,
    });

    expect(getForgeState().pendingDepictionContractProposal).not.toBeNull();
    forgeActions.dismissPendingDepictionContractProposal();
    expect(getForgeState().pendingDepictionContractProposal).toBeNull();

    // Directly update field
    const revBefore = getForgeState().draftRevision;
    forgeActions.updateDepictionContractField('dramaticRegister', 'Body Horror');
    const stateAfterFieldUpdate = getForgeState();

    expect(stateAfterFieldUpdate.draftRevision).toBe(revBefore + 1);
    expect(stateAfterFieldUpdate.forgeDraft?.depictionContract?.dramaticRegister).toBe('Body Horror');
    expect(stateAfterFieldUpdate.draftBlueprint?.depictionContract?.dramaticRegister).toBe('Body Horror');
  });

  test('21. Baseline mutations increment sourceBaselineRevision deterministically', () => {
    forgeActions.initializeDraft();
    expect(getForgeState().sourceBaselineRevision).toBe(1);

    // 1. Register source analysis
    forgeActions.registerSourceAnalysis({
      id: 'analysis-baseline-incr',
      sourceRecord: {
        id: 'src-incr',
        fileName: 'incr.json',
        mimeType: 'application/json',
        kind: 'native_blueprint',
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [
        {
          id: 'cand-incr-1',
          sourceId: 'src-incr',
          classification: 'evidence',
          target: 'setting_location',
          label: 'Location',
          explanation: 'Test',
          evidenceIds: [],
          proposedValue: 'Sector 7',
          reviewDecision: 'accepted',
          applicationState: 'staged',
        },
      ],
      unknowns: [
        {
          id: 'unk-incr-1',
          sourceId: 'analysis-baseline-incr',
          category: 'rule',
          question: 'What is the anomaly?',
          targetEffect: 'Clarifies threat',
          status: 'queued',
          followUps: [],
        },
      ],
      status: 'completed',
    }, 'mock-binding-incr');
    expect(getForgeState().sourceBaselineRevision).toBe(2);

    // 2. Reject candidate
    forgeActions.rejectCandidate('analysis-baseline-incr', 'cand-incr-1');
    expect(getForgeState().sourceBaselineRevision).toBe(3);

    // Redundant reject candidate is no-op
    forgeActions.rejectCandidate('analysis-baseline-incr', 'cand-incr-1');
    expect(getForgeState().sourceBaselineRevision).toBe(3);

    // 3. Edit candidate
    forgeActions.editPendingCandidate('analysis-baseline-incr', 'cand-incr-1', 'Sector 8');
    expect(getForgeState().sourceBaselineRevision).toBe(4);

    // 4. Submit unknown answer
    forgeActions.submitUnknownAnswer('analysis-baseline-incr', 'unk-incr-1', 'Electromagnetic pulse anomaly');
    expect(getForgeState().sourceBaselineRevision).toBe(5);

    // 5. Receive unknown proposal
    forgeActions.receiveUnknownProposal('analysis-baseline-incr', 'unk-incr-1', {
      resolution: 'Electromagnetic anomaly in Sector 8.',
      targetEffect: 'Clarifies threat.',
    });
    expect(getForgeState().sourceBaselineRevision).toBe(6);

    // 6. Accept unknown resolution
    forgeActions.acceptUnknownResolution('analysis-baseline-incr', 'unk-incr-1');
    expect(getForgeState().sourceBaselineRevision).toBe(7);

    // 7. Remove source analysis
    forgeActions.removeSourceAnalysis('analysis-baseline-incr');
    expect(getForgeState().sourceBaselineRevision).toBe(8);
  });

  test('tracks baseline revision and persists revision-bound proposals', () => {
    forgeActions.initializeDraft();
    expect(getForgeState().sourceBaselineRevision).toBe(1);
    expect(getForgeState().draftRevision).toBe(1);

    // --- 1. Incomplete Proposals Rejection (No Fabricated Defaults) ---
    // A. Proposal missing createdAt must be rejected
    // @ts-expect-error missing createdAt
    forgeActions.setPendingDepictionContractProposal({
      contract: {
        dramaticRegister: 'Cosmic Horror',
        directness: 'Direct',
        aftermath: 'Lethal',
        ambiguityHandling: 'Total',
        specialBoundaries: '',
      },
      rationale: 'Valid rationale.',
      sourceDraftRevision: 1,
      sourceBaselineRevision: 1,
    });
    expect(getForgeState().pendingDepictionContractProposal).toBeNull();

    // B. Proposal missing revisions must be rejected (no default to 1)
    // @ts-expect-error missing revisions
    forgeActions.setPendingDepictionContractProposal({
      contract: {
        dramaticRegister: 'Cosmic Horror',
        directness: 'Direct',
        aftermath: 'Lethal',
        ambiguityHandling: 'Total',
        specialBoundaries: '',
      },
      rationale: 'Valid rationale.',
      createdAt: 1000,
    });
    expect(getForgeState().pendingDepictionContractProposal).toBeNull();

    // C. Proposal missing specialBoundaries (5th field) must be rejected (no silent defaulting)
    forgeActions.setPendingDepictionContractProposal({
      contract: {
        dramaticRegister: 'Cosmic Horror',
        directness: 'Direct',
        aftermath: 'Lethal',
        ambiguityHandling: 'Total',
      } as unknown as DepictionContract,
      rationale: 'Valid rationale.',
      sourceDraftRevision: 1,
      sourceBaselineRevision: 1,
      createdAt: 1000,
    });
    expect(getForgeState().pendingDepictionContractProposal).toBeNull();

    // D. Proposal with empty contract strings must be rejected at runtime by Zod
    forgeActions.setPendingDepictionContractProposal({
      contract: {
        dramaticRegister: '',
        directness: '',
        aftermath: '',
        ambiguityHandling: '',
        specialBoundaries: '',
      },
      rationale: 'Valid rationale.',
      sourceDraftRevision: 1,
      sourceBaselineRevision: 1,
      createdAt: 1000,
    });
    expect(getForgeState().pendingDepictionContractProposal).toBeNull();

    // E. Proposal with empty rationale must be rejected at runtime by Zod
    forgeActions.setPendingDepictionContractProposal({
      contract: {
        dramaticRegister: 'Cosmic Horror',
        directness: 'Direct',
        aftermath: 'Lethal',
        ambiguityHandling: 'Total',
        specialBoundaries: '',
      },
      rationale: '   ',
      sourceDraftRevision: 1,
      sourceBaselineRevision: 1,
      createdAt: 1000,
    });
    expect(getForgeState().pendingDepictionContractProposal).toBeNull();

    // --- 2. Baseline Mutations & Semantic No-Op Equality Checks ---
    const initialAnalysis = {
      id: 'analysis-rev-test',
      sourceRecord: {
        id: 'src-rev',
        fileName: 'baseline_intake.json',
        mimeType: 'application/json',
        kind: 'native_blueprint' as const,
        receivedAt: Date.now(),
      },
      evidence: [],
      candidates: [
        {
          id: 'cand-rev-1',
          sourceId: 'src-rev',
          classification: 'evidence' as const,
          target: 'setting_location' as const,
          label: 'Location',
          explanation: 'Source location',
          evidenceIds: [],
          proposedValue: 'Perimeter Wall',
          reviewDecision: 'accepted' as const,
          applicationState: 'staged' as const,
        },
      ],
      unknowns: [
        {
          id: 'unk-rev-1',
          sourceId: 'analysis-rev-test',
          category: 'rule' as const,
          question: 'What is beyond the wall?',
          targetEffect: 'Clarifies world boundary.',
          status: 'queued' as const,
          followUps: [],
        },
      ],
      status: 'completed' as const,
    };

    // Register new analysis -> advances to 2
    forgeActions.registerSourceAnalysis(initialAnalysis, 'mock-binding-rev-test');
    expect(getForgeState().sourceBaselineRevision).toBe(2);

    // Register identical analysis -> NO-OP (remains 2)
    forgeActions.registerSourceAnalysis(initialAnalysis, 'mock-binding-rev-test');
    expect(getForgeState().sourceBaselineRevision).toBe(2);

    // Review decision change -> advances to 3
    forgeActions.setCandidateReviewDecision('analysis-rev-test', 'cand-rev-1', 'rejected');
    expect(getForgeState().sourceBaselineRevision).toBe(3);

    // Redundant review decision -> NO-OP (remains 3)
    forgeActions.setCandidateReviewDecision('analysis-rev-test', 'cand-rev-1', 'rejected');
    expect(getForgeState().sourceBaselineRevision).toBe(3);

    // Edit staged candidate with new value -> advances to 4
    forgeActions.editStagedCandidate('analysis-rev-test', 'cand-rev-1', 'Inner Courtyard');
    expect(getForgeState().sourceBaselineRevision).toBe(4);

    // Edit staged candidate with same value -> NO-OP (remains 4)
    forgeActions.editStagedCandidate('analysis-rev-test', 'cand-rev-1', 'Inner Courtyard');
    expect(getForgeState().sourceBaselineRevision).toBe(4);

    // Invalid candidate edit -> NO-OP (remains 4)
    forgeActions.editStagedCandidate('analysis-rev-test', 'cand-rev-1', '');
    expect(getForgeState().sourceBaselineRevision).toBe(4);

    // Accept candidate and apply it
    forgeActions.setCandidateReviewDecision('analysis-rev-test', 'cand-rev-1', 'accepted');
    expect(getForgeState().sourceBaselineRevision).toBe(5);
    forgeActions.applyAcceptedCandidates('analysis-rev-test');
    expect(getForgeState().sourceBaselineRevision).toBe(6);

    // Redundant review decision on already applied candidate -> NO-OP (remains 6)
    forgeActions.setCandidateReviewDecision('analysis-rev-test', 'cand-rev-1', 'accepted');
    expect(getForgeState().sourceBaselineRevision).toBe(6);

    // Submit unknown answer -> advances to 7
    forgeActions.submitUnknownAnswer(
      'analysis-rev-test',
      'unk-rev-1',
      'Radioactive wasteland beyond the wall.'
    );
    expect(getForgeState().sourceBaselineRevision).toBe(7);

    // Submit duplicate identical answer -> NO-OP (remains 7)
    forgeActions.submitUnknownAnswer(
      'analysis-rev-test',
      'unk-rev-1',
      'Radioactive wasteland beyond the wall.'
    );
    expect(getForgeState().sourceBaselineRevision).toBe(7);

    // Receive follow-up question -> advances to 8
    forgeActions.receiveUnknownFollowUp(
      'analysis-rev-test',
      'unk-rev-1',
      'Is there active radiation shielding?'
    );
    expect(getForgeState().sourceBaselineRevision).toBe(8);

    // Receive duplicate follow-up question -> NO-OP (remains 8)
    forgeActions.receiveUnknownFollowUp(
      'analysis-rev-test',
      'unk-rev-1',
      'Is there active radiation shielding?'
    );
    expect(getForgeState().sourceBaselineRevision).toBe(8);

    // Receive proposal -> advances to 9
    const proposalObj = {
      resolution: 'The wall shields against ambient gamma bursts.',
      targetEffect: 'Clarifies world boundary.',
    };
    forgeActions.receiveUnknownProposal('analysis-rev-test', 'unk-rev-1', proposalObj);
    expect(getForgeState().sourceBaselineRevision).toBe(9);

    // Receive identical proposal -> NO-OP (remains 9)
    forgeActions.receiveUnknownProposal('analysis-rev-test', 'unk-rev-1', proposalObj);
    expect(getForgeState().sourceBaselineRevision).toBe(9);

    // Edit proposal with identical values -> NO-OP (remains 9)
    forgeActions.editUnknownProposal(
      'analysis-rev-test',
      'unk-rev-1',
      'The wall shields against ambient gamma bursts.',
      'Clarifies world boundary.'
    );
    expect(getForgeState().sourceBaselineRevision).toBe(9);

    // Edit proposal with modified resolution -> advances to 10
    forgeActions.editUnknownProposal(
      'analysis-rev-test',
      'unk-rev-1',
      'The wall shields against ambient gamma bursts and particulate drift.',
      'Clarifies world boundary.'
    );
    expect(getForgeState().sourceBaselineRevision).toBe(10);

    // Set unknown error -> advances to 11
    forgeActions.setUnknownError('analysis-rev-test', 'unk-rev-1', 'Network timeout');
    expect(getForgeState().sourceBaselineRevision).toBe(11);

    // Set same error -> NO-OP (remains 11)
    forgeActions.setUnknownError('analysis-rev-test', 'unk-rev-1', 'Network timeout');
    expect(getForgeState().sourceBaselineRevision).toBe(11);

    // Retry unknown (clears error) -> advances to 12
    forgeActions.retryUnknown('analysis-rev-test', 'unk-rev-1');
    expect(getForgeState().sourceBaselineRevision).toBe(12);

    // Retry unknown when already queued with no error -> NO-OP (remains 12)
    forgeActions.retryUnknown('analysis-rev-test', 'unk-rev-1');
    expect(getForgeState().sourceBaselineRevision).toBe(12);

    // Accept unknown resolution -> advances sourceBaselineRevision to 13 and draftRevision
    const draftRevBeforeAccept = getForgeState().draftRevision;
    const acceptRes1 = forgeActions.acceptUnknownResolution('analysis-rev-test', 'unk-rev-1');
    expect(acceptRes1.success).toBe(true);
    expect(getForgeState().sourceBaselineRevision).toBe(13);
    expect(getForgeState().draftRevision).toBe(draftRevBeforeAccept + 1);

    // Repeating identical acceptUnknownResolution -> NO-OP (neither baseline nor draft revision advances)
    const draftRevAfterAccept = getForgeState().draftRevision;
    const acceptRes2 = forgeActions.acceptUnknownResolution('analysis-rev-test', 'unk-rev-1');
    expect(acceptRes2.success).toBe(true);
    expect(getForgeState().sourceBaselineRevision).toBe(13);
    expect(getForgeState().draftRevision).toBe(draftRevAfterAccept);

    // Leave unknown uncertain (contextual discretion) -> advances to 14
    forgeActions.leaveUnknownUncertain('analysis-rev-test', 'unk-rev-1', 'Keep boundary mysterious.');
    expect(getForgeState().sourceBaselineRevision).toBe(14);

    // Repeated contextual discretion with same guidance -> NO-OP (remains 14)
    forgeActions.leaveUnknownUncertain('analysis-rev-test', 'unk-rev-1', 'Keep boundary mysterious.');
    expect(getForgeState().sourceBaselineRevision).toBe(14);

    // --- 3. Proposal Lifecycle, Stale Protection, and Atomic Apply ---
    const currentDraftRev = getForgeState().draftRevision;
    const currentBaselineRev = getForgeState().sourceBaselineRevision;

    const validProposal = {
      contract: {
        dramaticRegister: 'Claustrophobic Dread',
        directness: 'Sensory fragment',
        aftermath: 'Psychological trauma',
        ambiguityHandling: 'Unexplained voids',
        specialBoundaries: 'Strictly avoid jump scares',
      },
      rationale: 'Elevates psychological isolation.',
      sourceDraftRevision: currentDraftRev,
      sourceBaselineRevision: currentBaselineRev,
      createdAt: 12345678,
    };

    forgeActions.setPendingDepictionContractProposal(validProposal);
    expect(getForgeState().pendingDepictionContractProposal).not.toBeNull();
    expect(
      getForgeState().pendingDepictionContractProposal?.contract.dramaticRegister
    ).toBe('Claustrophobic Dread');

    // Mutate baseline -> advances sourceBaselineRevision
    forgeActions.removeSourceAnalysis('analysis-rev-test');
    expect(getForgeState().sourceBaselineRevision).toBe(currentBaselineRev + 1);

    // Stale apply fails because baseline revision moved
    const staleBaselineRes = forgeActions.applyPendingDepictionContractProposal();
    expect(staleBaselineRes.success).toBe(false);
    if (!staleBaselineRes.success) {
      expect((staleBaselineRes as { success: false; error: string; stale?: boolean }).stale).toBe(true);
      expect((staleBaselineRes as { success: false; error: string; stale?: boolean }).error).toContain('Proposal is stale');
    }
    expect(getForgeState().forgeDraft?.depictionContract?.dramaticRegister).not.toBe(
      'Claustrophobic Dread'
    );
    expect(getForgeState().pendingDepictionContractProposal).not.toBeNull();

    // Re-anchor proposal to current revisions
    const freshDraftRev = getForgeState().draftRevision;
    const freshBaselineRev = getForgeState().sourceBaselineRevision;

    forgeActions.setPendingDepictionContractProposal({
      ...validProposal,
      sourceDraftRevision: freshDraftRev,
      sourceBaselineRevision: freshBaselineRev,
    });

    // Mutate draft directly -> advances draftRevision
    forgeActions.updateDraft({ title: 'Revision Test Title' });
    expect(getForgeState().draftRevision).toBe(freshDraftRev + 1);

    // Stale apply fails because draft revision moved
    const staleDraftRes = forgeActions.applyPendingDepictionContractProposal();
    expect(staleDraftRes.success).toBe(false);
    if (!staleDraftRes.success) {
      expect((staleDraftRes as { success: false; error: string; stale?: boolean }).stale).toBe(true);
      expect((staleDraftRes as { success: false; error: string; stale?: boolean }).error).toContain('Proposal is stale');
    }
    expect(getForgeState().forgeDraft?.depictionContract?.dramaticRegister).not.toBe(
      'Claustrophobic Dread'
    );
    expect(getForgeState().pendingDepictionContractProposal).not.toBeNull();

    // Valid Apply with matching revisions succeeds
    const matchingDraftRev = getForgeState().draftRevision;
    const matchingBaselineRev = getForgeState().sourceBaselineRevision;

    forgeActions.setPendingDepictionContractProposal({
      ...validProposal,
      sourceDraftRevision: matchingDraftRev,
      sourceBaselineRevision: matchingBaselineRev,
    });

    const applyRes = forgeActions.applyPendingDepictionContractProposal();
    expect(applyRes.success).toBe(true);
    expect(getForgeState().pendingDepictionContractProposal).toBeNull();
    expect(getForgeState().draftRevision).toBe(matchingDraftRev + 1);
    expect(getForgeState().sourceBaselineRevision).toBe(matchingBaselineRev);
    expect(getForgeState().forgeDraft?.depictionContract?.dramaticRegister).toBe(
      'Claustrophobic Dread'
    );
    expect(getForgeState().forgeDraft?.depictionContract?.directness).toBe('Sensory fragment');
    expect(getForgeState().forgeDraft?.depictionContract?.aftermath).toBe('Psychological trauma');
    expect(getForgeState().forgeDraft?.depictionContract?.ambiguityHandling).toBe(
      'Unexplained voids'
    );
    expect(getForgeState().forgeDraft?.depictionContract?.specialBoundaries).toBe(
      'Strictly avoid jump scares'
    );

    // --- 4. Persistence Migration and Rehydration Testing ---
    const persistOptions =
      useForgeState.persist?.getOptions?.() || useForgeStoreInternal.persist?.getOptions?.();
    const migrate = persistOptions?.migrate;
    expect(migrate).toBeDefined();

    if (migrate) {
      // A. Legacy persisted state without sourceBaselineRevision supplies revision 1
      const legacyStateNoRevision = {
        forgeDraft: { id: 'd1', title: 'Legacy' },
        draftRevision: 2,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const migratedNoRev = migrate(legacyStateNoRevision as any, 4) as any;
      expect(migratedNoRev.sourceBaselineRevision).toBe(1);

      // B. Legacy patch-only proposal is discarded during migration
      const legacyPatchProposalState = {
        forgeDraft: { id: 'd2', title: 'Legacy Patch' },
        draftRevision: 3,
        sourceBaselineRevision: 2,
        pendingDepictionContractProposal: {
          patch: { dramaticRegister: 'Old Patch Register' },
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const migratedLegacyPatch = migrate(legacyPatchProposalState as any, 4) as any;
      expect(migratedLegacyPatch.pendingDepictionContractProposal).toBeNull();

      // C. Incomplete proposal missing specialBoundaries (5th field) is discarded during migration
      const missingFieldProposalState = {
        forgeDraft: { id: 'd-inc', title: 'Incomplete' },
        draftRevision: 3,
        sourceBaselineRevision: 2,
        pendingDepictionContractProposal: {
          contract: {
            dramaticRegister: 'Cosmic',
            directness: 'Direct',
            aftermath: 'Lethal',
            ambiguityHandling: 'Total',
          },
          rationale: 'Missing specialBoundaries',
          sourceDraftRevision: 3,
          sourceBaselineRevision: 2,
          createdAt: 123456789,
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const migratedIncomplete = migrate(missingFieldProposalState as any, 4) as any;
      expect(migratedIncomplete.pendingDepictionContractProposal).toBeNull();

      // D. Valid complete proposal is retained during migration
      const completeProposalState = {
        forgeDraft: { id: 'd3', title: 'Valid Complete' },
        draftRevision: 4,
        sourceBaselineRevision: 5,
        pendingDepictionContractProposal: {
          contract: {
            dramaticRegister: 'Migrated Register',
            directness: 'Direct',
            aftermath: 'Lingering',
            ambiguityHandling: 'Full',
            specialBoundaries: '',
          },
          rationale: 'Complete proposal test.',
          sourceDraftRevision: 4,
          sourceBaselineRevision: 5,
          createdAt: 123456789,
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const migratedComplete = migrate(completeProposalState as any, 4) as any;
      expect(migratedComplete.pendingDepictionContractProposal).not.toBeNull();
      expect(migratedComplete.pendingDepictionContractProposal.contract.dramaticRegister).toBe(
        'Migrated Register'
      );
      expect(migratedComplete.pendingDepictionContractProposal.sourceDraftRevision).toBe(4);
      expect(migratedComplete.pendingDepictionContractProposal.sourceBaselineRevision).toBe(5);
      expect(migratedComplete.pendingDepictionContractProposal.createdAt).toBe(123456789);

      // E. Real onRehydrateStorage lifecycle execution
      const onRehydrate = persistOptions?.onRehydrateStorage;
      if (onRehydrate) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rehydratePostCallback = onRehydrate(getForgeState() as any);
        if (rehydratePostCallback) {
          // Rehydrating valid state preserves proposal
          const rehydratedValid = { ...completeProposalState };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rehydratePostCallback(rehydratedValid as any, undefined);
          expect(rehydratedValid.pendingDepictionContractProposal).not.toBeNull();

          // Rehydrating invalid proposal state clears proposal
          const rehydratedInvalid = { ...missingFieldProposalState };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rehydratePostCallback(rehydratedInvalid as any, undefined);
          expect(rehydratedInvalid.pendingDepictionContractProposal).toBeNull();
        }
      }
    }
  });

  describe('17. Negative bypass proofs: source data and unreviewed proposals cannot mutate draft', () => {
    beforeEach(() => {
      forgeActions.resetStore();
    });

    it('proves raw extraction and unreviewed candidates never mutate forgeDraft', () => {
      forgeActions.initializeDraft({ title: 'Baseline Scenario' });
      const initialDraft = JSON.parse(JSON.stringify(getForgeState().forgeDraft));
      const initialDraftRev = getForgeState().draftRevision;

      // Register an analysis with unreviewed staged candidates
      const analysis = {
        id: 'analysis-bypass-1',
        sourceRecord: {
          id: 'src-bypass-1',
          fileName: 'classified_brief.pdf',
          mimeType: 'application/pdf',
          kind: 'document' as const,
          receivedAt: Date.now(),
        },
        summary: 'Classified facility breach report.',
        evidence: [
          { id: 'ev-1', sourceId: 'src-bypass-1', category: 'setting' as const, claim: 'Facility is buried under permafrost.' },
        ],
        candidates: [
          {
            id: 'cand-bypass-1',
            sourceId: 'src-bypass-1',
            classification: 'evidence' as const,
            target: 'setting_location' as const,
            label: 'Sub-Zero Facility',
            proposedValue: 'Permafrost Bunker 9',
            explanation: 'Derived from brief',
            evidenceIds: ['ev-1'],
            reviewDecision: 'accepted' as const,
            applicationState: 'staged' as const,
          },
          {
            id: 'cand-bypass-2',
            sourceId: 'src-bypass-1',
            classification: 'evidence' as const,
            target: 'scenario_title' as const,
            label: 'Bunker 9 Outbreak',
            proposedValue: 'The Permafrost Incident',
            explanation: 'Derived from title',
            evidenceIds: ['ev-1'],
            reviewDecision: 'rejected' as const,
            applicationState: 'staged' as const,
          },
        ],
        unknowns: [
          {
            id: 'unk-bypass-1',
            sourceId: 'src-bypass-1',
            category: 'premise' as const,
            question: 'What triggered the breach?',
            targetEffect: 'Determines primary threat behavior.',
            status: 'queued' as const,
            followUps: [],
          },
        ],
        status: 'completed' as const,
      };

      forgeActions.registerSourceAnalysis(analysis, 'mock-binding-bypass-1');

      // Registration must NOT mutate draft or advance draftRevision
      expect(getForgeState().forgeDraft).toEqual(initialDraft);
      expect(getForgeState().draftRevision).toBe(initialDraftRev);

      // Setting candidate review decision to rejected leaves draft unchanged
      forgeActions.setCandidateReviewDecision('analysis-bypass-1', 'cand-bypass-1', 'rejected');
      expect(getForgeState().forgeDraft).toEqual(initialDraft);
      expect(getForgeState().draftRevision).toBe(initialDraftRev);

      // Applying accepted candidates on rejected batch performs ZERO draft mutations
      forgeActions.applyAcceptedCandidates('analysis-bypass-1');
      expect(getForgeState().forgeDraft).toEqual(initialDraft);
      expect(getForgeState().draftRevision).toBe(initialDraftRev);
    });

    it('proves unaccepted Architect proposals and unresolved unknowns perform zero draft mutations', () => {
      forgeActions.initializeDraft({ title: 'Baseline Scenario' });
      const initialDraft = JSON.parse(JSON.stringify(getForgeState().forgeDraft));
      const initialDraftRev = getForgeState().draftRevision;

      const analysis = {
        id: 'analysis-bypass-2',
        sourceRecord: {
          id: 'src-bypass-2',
          fileName: 'signals.txt',
          mimeType: 'text/plain',
          kind: 'document' as const,
          receivedAt: Date.now(),
        },
        summary: 'Signal interception log.',
        evidence: [],
        candidates: [],
        unknowns: [
          {
            id: 'unk-bypass-2',
            sourceId: 'src-bypass-2',
            category: 'premise' as const,
            question: 'Origin of signal?',
            targetEffect: 'Establishes cosmic origin.',
            status: 'queued' as const,
            followUps: [],
          },
        ],
        status: 'completed' as const,
      };

      forgeActions.registerSourceAnalysis(analysis, 'mock-binding-bypass-2');
      forgeActions.submitUnknownAnswer('analysis-bypass-2', 'unk-bypass-2', 'Deep cosmic beacon.');
      forgeActions.receiveUnknownProposal('analysis-bypass-2', 'unk-bypass-2', {
        resolution: 'The beacon originates from an extinct star system.',
        targetEffect: 'Sets cosmic scale.',
      });

      // Receiving a proposal does NOT mutate the draft
      expect(getForgeState().forgeDraft).toEqual(initialDraft);
      expect(getForgeState().draftRevision).toBe(initialDraftRev);
      expect(getForgeState().forgeDraft!.ambiguities).toEqual([]);

      // Leaving unknown uncertain records CONTEXTUAL_DISCRETION without mutating general draft fields
      forgeActions.leaveUnknownUncertain('analysis-bypass-2', 'unk-bypass-2', 'Investigate later');
      expect(getForgeState().forgeDraft!.title).toBe(initialDraft.title);
      expect(getForgeState().forgeDraft!.premise).toBe(initialDraft.premise);
      expect(getForgeState().forgeDraft!.ambiguities).toHaveLength(1);
      expect(getForgeState().forgeDraft!.ambiguities![0].resolutionMode).toBe('CONTEXTUAL_DISCRETION');
    });

    it('proves stale or unapplied depiction contract proposals perform zero draft mutations', () => {
      forgeActions.initializeDraft({ title: 'Baseline Scenario' });
      const initialContract = getForgeState().forgeDraft!.depictionContract;
      const initialDraftRev = getForgeState().draftRevision;

      // Staged proposal with mismatched revision
      const staleProposal = {
        contract: {
          dramaticRegister: 'Cosmic dread',
          directness: 'Oblique',
          aftermath: 'Dissolution',
          ambiguityHandling: 'Total void',
          specialBoundaries: 'No jump scares',
        },
        rationale: 'Stale rationale',
        sourceDraftRevision: initialDraftRev + 99, // mismatched
        sourceBaselineRevision: getForgeState().sourceBaselineRevision,
        createdAt: Date.now(),
      };

      forgeActions.setPendingDepictionContractProposal(staleProposal);
      expect(getForgeState().forgeDraft!.depictionContract).toEqual(initialContract);

      // Attempting to apply stale proposal fails closed with zero mutation
      const result = forgeActions.applyPendingDepictionContractProposal();
      expect(result.success).toBe(false);
      expect(getForgeState().forgeDraft!.depictionContract).toEqual(initialContract);
      expect(getForgeState().draftRevision).toBe(initialDraftRev);
    });

    it('proves addTopologyNode does not silently assign the first node as startingNodeId', () => {
      forgeActions.initializeDraft({ title: 'Sub-Level Outpost' });
      expect(getForgeState().forgeDraft?.topology?.startingNodeId).toBeUndefined();

      forgeActions.addTopologyNode({
        id: 'AIRLOCK_DECK',
        label: 'Airlock Deck',
        description: 'Atmospheric decompression chamber.',
      });

      const draft = getForgeState().forgeDraft;
      expect(draft?.topology?.nodeDefinitions).toHaveLength(1);
      expect(draft?.topology?.nodes).toEqual(['AIRLOCK_DECK']);
      // Must NOT silently become starting node
      expect(draft?.topology?.startingNodeId).toBeUndefined();
    });

    it('proves removeTopologyNode clears startingNodeId and startingNodeProvenance when active start is deleted', () => {
      forgeActions.initializeDraft({ title: 'Sub-Level Outpost' });

      forgeActions.addTopologyNode({
        id: 'NODE_A',
        label: 'Node A',
        description: 'First room.',
      });
      forgeActions.addTopologyNode({
        id: 'NODE_B',
        label: 'Node B',
        description: 'Second room.',
      });

      forgeActions.setStartingNode('NODE_A');
      expect(getForgeState().forgeDraft?.topology?.startingNodeId).toBe('NODE_A');

      forgeActions.removeTopologyNode('NODE_A');
      const draft = getForgeState().forgeDraft;
      expect(draft?.topology?.nodeDefinitions).toHaveLength(1);
      expect(draft?.topology?.startingNodeId).toBeUndefined();
      expect(draft?.topology?.startingNodeProvenance).toBeUndefined();
    });

    it('proves setStartingNode updates explicit start and coordinates user character placement', () => {
      forgeActions.initializeDraft({ title: 'Sub-Level Outpost' });

      forgeActions.addCastMember({
        id: 'char-hero',
        name: 'Hero',
        role: 'PROTAGONIST',
        isUserCharacter: true,
      });

      forgeActions.addTopologyNode({
        id: 'NODE_START',
        label: 'Start Room',
        description: 'Opening location.',
      });

      forgeActions.setStartingNode('NODE_START');
      const draft = getForgeState().forgeDraft;
      expect(draft?.topology?.startingNodeId).toBe('NODE_START');
      const hero = draft?.cast?.find((c) => c.id === 'char-hero');
      expect(hero?.presenceDisposition).toEqual({ kind: 'AT_NODE', nodeId: 'NODE_START' });
      expect(hero?.starting_location).toBe('NODE_START');
    });

    it('proves setUserCharacter does not fall back to ORIGIN or nodes[0] when startingNodeId is absent', () => {
      forgeActions.initializeDraft({
        title: 'No Start Scenario',
        topology: {
          nodes: ['SOME_NODE'],
          nodeDefinitions: [{ id: 'SOME_NODE', label: 'Some Node', description: 'Desc' }],
        },
      });

      forgeActions.addCastMember({
        id: 'char-cand',
        name: 'Candidate',
        role: 'Subject',
        isUserCharacter: false,
        presenceDisposition: { kind: 'OFFSTAGE' },
      });

      forgeActions.setUserCharacter('char-cand');
      const draft = getForgeState().forgeDraft;
      const userChar = draft?.cast?.find((c) => c.id === 'char-cand');
      expect(userChar?.isUserCharacter).toBe(true);
      expect(userChar?.presenceDisposition).toEqual({ kind: 'OFFSTAGE' });
      expect(userChar?.starting_location).toBe('');
    });
  });

  describe('Packet 1E-1: Atomic Imported Source Baseline Application', () => {
    it('successful document intake atomically applies accepted source baseline candidates', () => {
      forgeActions.initializeDraft({ title: 'Initial Draft' });

      const analysisId = 'src-atomic-1';
      const mockAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: {
          id: analysisId,
          fileName: 'station.txt',
          mimeType: 'text/plain',
          kind: 'document',
          receivedAt: Date.now(),
        },
        summary: 'Deep station summary',
        evidence: [{ id: 'ev-1', sourceId: analysisId, category: 'setting', claim: 'Station is deep in the abyss' }],
        candidates: [
          {
            id: 'cand-1',
            sourceId: analysisId,
            classification: 'evidence',
            target: 'setting_location',
            label: 'Location',
            explanation: 'Location',
            evidenceIds: ['ev-1'],
            proposedValue: 'Abyssal Trench Outpost',
            reviewDecision: 'accepted',
            applicationState: 'staged',
          },
          {
            id: 'cand-2',
            sourceId: analysisId,
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Depiction Contract',
            explanation: 'Tone',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Deep dread',
              directness: 'High tactile audio',
              aftermath: 'Severe trauma',
              ambiguityHandling: 'Uncertain boundaries',
              specialBoundaries: '',
            },
            reviewDecision: 'accepted',
            applicationState: 'staged',
          },
        ],
        unknowns: [],
        status: 'completed',
      };

      forgeActions.registerSourceAnalysis(mockAnalysis, 'binding-atomic-1');
      const result = forgeActions.applyImportedSourceBaseline(analysisId);
      expect(result.success).toBe(true);

      const state = getForgeState();
      expect(state.forgeDraft?.setting?.location).toBe('Abyssal Trench Outpost');
      expect(state.forgeDraft?.depictionContract?.dramaticRegister).toBe('Deep dread');
      expect(state.forgeDraft?.depictionContract?.directness).toBe('High tactile audio');

      // Candidate ledger must be updated to applied
      const updatedAnalysis = state.sourceAnalyses[analysisId];
      expect(updatedAnalysis.candidates[0].applicationState).toBe('applied');
      expect(updatedAnalysis.candidates[1].applicationState).toBe('applied');
    });

    it('failed automatic baseline application preserves the prior draft and revokes the new binding', () => {
      forgeActions.initializeDraft({ title: 'Unbroken Prior Draft' });
      const priorDraft = getForgeState().forgeDraft;

      const analysisId = 'src-fail-1';
      const badAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: {
          id: analysisId,
          fileName: 'broken.txt',
          mimeType: 'text/plain',
          kind: 'document',
          receivedAt: Date.now(),
        },
        summary: 'Broken summary',
        evidence: [],
        candidates: [
          {
            id: 'cand-broken-edge',
            sourceId: analysisId,
            classification: 'evidence',
            target: 'topology_connection',
            label: 'Bad Edge',
            explanation: 'Non-existent from node',
            evidenceIds: [],
            proposedValue: {
              from: 'GHOST_ROOM_1',
              to: 'GHOST_ROOM_2',
              kind: 'PHYSICAL',
              userInitiated: true,
            },
            reviewDecision: 'accepted',
            applicationState: 'staged',
          },
        ],
        unknowns: [],
        status: 'completed',
      };

      forgeActions.registerSourceAnalysis(badAnalysis, 'binding-bad-1');
      const result = forgeActions.applyImportedSourceBaseline(analysisId);
      expect(result.success).toBe(false);

      const state = getForgeState();
      // Draft restored to prior state
      expect(state.forgeDraft?.title).toBe(priorDraft?.title);
      expect(state.forgeDraft?.topology?.connections || []).toHaveLength(0);
    });

    it('complete authored depiction contract is preserved during a subsequent source import and through compilation', () => {
      forgeActions.initializeDraft({
        title: 'Authored Scenario',
        premise: 'Authored gothic dread premise.',
        globalPremise: 'Authored gothic dread premise.',
        identity: {
          title: 'Authored Scenario',
          version: '1.0',
          author: 'Author',
          thematicAnchor: 'Gothic terror',
        },
        startingVector: 'SOMATIC',
        startingTier: 'LATENT',
        setting: {
          location: 'Authored Castle',
          atmosphere: 'Dread',
          timePeriod: '1920',
        },
        topology: {
          nodes: ['NODE_1'],
          nodeDefinitions: [{ id: 'NODE_1', label: 'Great Hall', description: 'A vast stone hall with flickering tapestries.' }],
          connections: [],
        },
        cast: [
          {
            id: 'char-1',
            name: 'Investigator',
            role: 'PROTAGONIST',
            isEntity: false,
            isUserCharacter: false,
            presenceDisposition: { kind: 'AT_NODE', nodeId: 'NODE_1' },
          },
          {
            id: 'char-castle-wraith',
            name: 'The Castle Wraith',
            role: 'Antagonist',
            description: 'Spectral wraith haunting the halls of the authored castle.',
            disposition: 'VILLAIN',
            behaviorVector: 'RELENTLESS',
            isEntity: true,
            isUserCharacter: false,
            presenceDisposition: { kind: 'NONLOCAL' },
          },
        ],
        horrorGrammar: {
          valueBaselineReview: 'REVIEWED_NONE',
          pursuitReviews: {
            'char-1': 'REVIEWED_NONE',
            'char-castle-wraith': 'REVIEWED_NONE',
          },
          valueAnchors: [],
          characterPursuits: [],
        },
        depictionContract: {
          dramaticRegister: 'Authored Gothic Register',
          directness: 'Authored Visceral Directness',
          aftermath: 'Authored Psychological Aftermath',
          ambiguityHandling: 'Authored Ambiguity',
          specialBoundaries: 'Authored Boundaries',
        },
      });

      const analysisId = 'src-subsequent-1';
      const mockAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: {
          id: analysisId,
          fileName: 'imported.txt',
          mimeType: 'text/plain',
          kind: 'document',
          receivedAt: Date.now(),
        },
        summary: 'Imported summary',
        evidence: [{ id: 'ev-1', sourceId: analysisId, category: 'setting', claim: 'Imported claim' }],
        candidates: [
          {
            id: 'cand-dep-imported',
            sourceId: analysisId,
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Imported Depiction Contract',
            explanation: 'Imported tone',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Imported Tone',
              directness: 'Imported Directness',
              aftermath: 'Imported Aftermath',
              ambiguityHandling: 'Imported Ambiguity',
              specialBoundaries: '',
            },
            reviewDecision: 'accepted',
            applicationState: 'staged',
          },
          {
            id: 'cand-loc',
            sourceId: analysisId,
            classification: 'evidence',
            target: 'setting_location',
            label: 'Imported Location',
            explanation: 'Imported location',
            evidenceIds: ['ev-1'],
            proposedValue: 'Imported Castle',
            reviewDecision: 'accepted',
            applicationState: 'staged',
          },
        ],
        unknowns: [],
        status: 'completed',
      };

      forgeActions.registerSourceAnalysis(mockAnalysis, 'binding-subsequent');
      const result = forgeActions.applyImportedSourceBaseline(analysisId);
      expect(result.success).toBe(true);

      const state = getForgeState();
      // Authored depiction contract is preserved in draft
      expect(state.forgeDraft?.depictionContract?.dramaticRegister).toBe('Authored Gothic Register');
      expect(state.forgeDraft?.depictionContract?.directness).toBe('Authored Visceral Directness');
      // Other candidate is applied
      expect(state.forgeDraft?.setting?.location).toBe('Imported Castle');

      // Candidate disposition: depiction candidate is superseded, not applied or left staged
      const updatedCand = state.sourceAnalyses[analysisId].candidates.find(
        (c) => c.id === 'cand-dep-imported'
      );
      expect(updatedCand?.applicationState).toBe('superseded');
      expect(updatedCand?.reviewDecision).toBe('accepted');

      const locCand = state.sourceAnalyses[analysisId].candidates.find(
        (c) => c.id === 'cand-loc'
      );
      expect(locCand?.applicationState).toBe('applied');

      // COMPILATION BOUNDARY: compileDraft preserves authored depiction, does NOT replay superseded candidate
      const compileRes = compileForgeDraft(state.forgeDraft, {
        sourceAnalyses: state.sourceAnalyses,
      });
      expect(compileRes.success).toBe(true);
      if (compileRes.success) {
        expect(compileRes.blueprint.depictionContract.dramaticRegister).toBe('Authored Gothic Register');
        expect(compileRes.blueprint.depictionContract.directness).toBe('Authored Visceral Directness');
      }

      // IDEMPOTENCE: Re-running import does not change anything
      const repeatResult = forgeActions.applyImportedSourceBaseline(analysisId);
      expect(repeatResult.success).toBe(true);
      const stateAfterRepeat = getForgeState();
      expect(stateAfterRepeat.forgeDraft?.depictionContract?.dramaticRegister).toBe('Authored Gothic Register');
      const repeatCand = stateAfterRepeat.sourceAnalyses[analysisId].candidates.find(
        (c) => c.id === 'cand-dep-imported'
      );
      expect(repeatCand?.applicationState).toBe('superseded');

      // Re-compiling is also idempotent
      const recompileRes = compileForgeDraft(stateAfterRepeat.forgeDraft, {
        sourceAnalyses: stateAfterRepeat.sourceAnalyses,
      });
      expect(recompileRes.success).toBe(true);
      if (recompileRes.success) {
        expect(recompileRes.blueprint.depictionContract.dramaticRegister).toBe('Authored Gothic Register');
      }
    });

    it('partial authored depiction contract allows imported source defaults to apply', () => {
      forgeActions.initializeDraft({
        title: 'Partial Authored Scenario',
        depictionContract: {
          dramaticRegister: 'Authored Tone',
          directness: '', // Incomplete / empty field
          aftermath: 'unknown', // Invalid field
          ambiguityHandling: 'none', // Invalid field
        },
      });

      const analysisId = 'src-partial-1';
      const mockAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: {
          id: analysisId,
          fileName: 'imported.txt',
          mimeType: 'text/plain',
          kind: 'document',
          receivedAt: Date.now(),
        },
        summary: 'Imported summary',
        evidence: [{ id: 'ev-1', sourceId: analysisId, category: 'setting', claim: 'Imported claim' }],
        candidates: [
          {
            id: 'cand-dep-partial',
            sourceId: analysisId,
            classification: 'evidence',
            target: 'depiction_contract',
            label: 'Imported Depiction Contract',
            explanation: 'Imported tone',
            evidenceIds: ['ev-1'],
            proposedValue: {
              dramaticRegister: 'Imported Complete Dramatic Register',
              directness: 'Imported Complete Directness',
              aftermath: 'Imported Complete Aftermath',
              ambiguityHandling: 'Imported Complete Ambiguity',
              specialBoundaries: 'None',
            },
            reviewDecision: 'accepted',
            applicationState: 'staged',
          },
        ],
        unknowns: [],
        status: 'completed',
      };

      forgeActions.registerSourceAnalysis(mockAnalysis, 'binding-partial');
      const result = forgeActions.applyImportedSourceBaseline(analysisId);
      expect(result.success).toBe(true);

      const state = getForgeState();
      // Because authored depiction was incomplete, imported candidate applied
      expect(state.forgeDraft?.depictionContract?.dramaticRegister).toBe('Imported Complete Dramatic Register');
      expect(state.forgeDraft?.depictionContract?.directness).toBe('Imported Complete Directness');

      const cand = state.sourceAnalyses[analysisId].candidates.find(
        (c) => c.id === 'cand-dep-partial'
      );
      expect(cand?.applicationState).toBe('applied');
    });

    it('intentional later replacement through explicit authoring action updates draft and advances revision', () => {
      forgeActions.initializeDraft({
        title: 'Authored Scenario',
        depictionContract: {
          dramaticRegister: 'Authored Register',
          directness: 'Authored Directness',
          aftermath: 'Authored Aftermath',
          ambiguityHandling: 'Authored Ambiguity',
          specialBoundaries: '',
        },
      });

      const initRev = getForgeState().draftRevision || 1;
      forgeActions.updateDepictionContractField('dramaticRegister', 'Intentional Replacement Register');

      const state = getForgeState();
      expect(state.forgeDraft?.depictionContract?.dramaticRegister).toBe('Intentional Replacement Register');
      expect((state.draftRevision || 0)).toBeGreaterThan(initRev);
    });
  });

  describe('runDetailPass', () => {
    it('calls /api/extract-detail-pass and merges newly unearthed Pass 2 candidates into source analysis', async () => {
      forgeActions.initializeDraft({ title: 'Black Iron Mortuary' });
      const sourceId = 'src-test-detail-pass';
      const analysisId = 'analysis-test-detail-pass';

      const initialAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: {
          id: sourceId,
          fileName: 'incident_log.txt',
          mimeType: 'text/plain',
          kind: 'document',
          receivedAt: Date.now(),
        },
        summary: 'Primary incident report.',
        evidence: [
          {
            id: 'ev-1',
            sourceId,
            category: 'setting',
            claim: 'Sub-basement morgue',
          },
        ],
        candidates: [
          {
            id: 'cand-1',
            sourceId,
            classification: 'evidence',
            target: 'setting_location',
            label: 'Sub-Basement Morgue',
            explanation: 'Location from log',
            evidenceIds: ['ev-1'],
            proposedValue: 'Sub-Basement Morgue',
            reviewDecision: 'accepted',
            applicationState: 'staged',
          },
        ],
        unknowns: [],
        status: 'completed',
      };

      forgeActions.registerSourceAnalysis(initialAnalysis, 'mock-binding-dp');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          summary: 'Forensic pass found Orderly Thomas.',
          evidence: [
            {
              id: 'ev-p2-1',
              category: 'setting',
              claim: 'Orderly Thomas hiding in vents.',
            },
          ],
          candidates: [
            {
              id: 'cand-p2-1',
              sourceId,
              classification: 'evidence',
              target: 'topology_node',
              label: 'Ventilation Corridor',
              explanation: 'Secondary route',
              evidenceIds: ['ev-p2-1'],
              proposedValue: {
                id: 'ventilation_corridor',
                name: 'Ventilation Corridor',
                label: 'Ventilation Corridor',
              },
              extractionPass: 2,
              reviewDecision: 'accepted',
              applicationState: 'staged',
            },
          ],
          unknowns: [
            {
              id: 'unk-p2-1',
              category: 'spatial',
              question: 'Are vents accessible to the entity?',
              targetEffect: 'Refuge viability',
            },
          ],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const res = await forgeActions.runDetailPass(analysisId);
      expect(res.success).toBe(true);
      expect(res.newCandidateCount).toBe(1);

      const state = getForgeState();
      const updatedAnalysis = state.sourceAnalyses[analysisId];
      expect(updatedAnalysis.candidates).toHaveLength(2);
      expect(updatedAnalysis.candidates[0].id).toBe('cand-1');
      expect(updatedAnalysis.candidates[1].id).toBe('cand-p2-1');
      expect(updatedAnalysis.candidates[1].extractionPass).toBe(2);
      expect(updatedAnalysis.evidence).toHaveLength(2);
      expect(updatedAnalysis.unknowns).toHaveLength(1);
    });
  });

  describe('useForgeStore — mergeSweepCandidates review preservation', () => {
    it('preserves APPROVED review status upon candidate rediscovery', () => {
      const store = useForgeStore.getState();

      // Set initial reviewed candidate
      store.candidates = [{
        id: 'cand-1',
        targetType: 'CAST',
        normalizedKey: 'char-marcus-holt',
        reviewDecision: 'APPROVED',
        evidenceIds: ['ev-1'],
        occurrences: 1
      } as unknown as ForgeSourceCandidate];

      // Incoming duplicate candidate with new evidence
      store.mergeSweepCandidates!(
        [{
          id: 'cand-new',
          targetType: 'CAST',
          normalizedKey: 'char-marcus-holt',
          evidenceIds: ['ev-2']
        } as unknown as ForgeSourceCandidate],
        [{ id: 'ev-2', excerpt: 'Holt bars the door' } as unknown as ForgeSourceEvidence]
      );

      const merged = useForgeStore.getState().candidates.find((c) => (c as Record<string, unknown>).normalizedKey === 'char-marcus-holt') as Record<string, unknown> | undefined;
      expect(merged?.reviewDecision).toBe('APPROVED'); // Invariant: Not reset to STAGED
      expect(merged?.evidenceIds).toContain('ev-1');
      expect(merged?.evidenceIds).toContain('ev-2');
      expect(merged?.occurrences).toBe(2);
    });
  });

  describe('useForgeStore — runQuestionnaireExtraction', () => {
    it('returns error when sourceId does not exist', async () => {
      const res = await forgeActions.runQuestionnaireExtraction('non-existent-source');
      expect(res.success).toBe(false);
      expect(res.error).toContain('not found');
    });

    it('flattens nodes, connections, and seeds, dedupes by id, and sets questionnaireFailedBatteries', async () => {
      const analysisId = 'src-test-questionnaire';
      const existingCandidate: ForgeSourceCandidate = {
        id: 'CAND-EXISTING-1',
        sourceId: analysisId,
        classification: 'evidence',
        target: 'topology_node',
        label: 'Existing Chamber',
        explanation: 'Existing',
        evidenceIds: [],
        proposedValue: { id: 'room-1', label: 'Existing Chamber', name: 'Existing Chamber' },
        reviewDecision: 'accepted',
        applicationState: 'staged',
      } as ForgeSourceCandidate;

      const initialAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: {
          id: 'rec-1',
          fileName: 'station_log.txt',
          mimeType: 'text/plain',
          kind: 'document',
          receivedAt: Date.now(),
        },
        summary: 'Log of the underwater facility.',
        evidence: [
          {
            id: 'ev-1',
            sourceId: analysisId,
            category: 'setting',
            claim: 'Facility is underwater',
            excerpt: 'deep beneath the surface',
          },
        ],
        candidates: [existingCandidate],
        unknowns: [],
        status: 'completed',
      };

      forgeActions.registerSourceAnalysis(initialAnalysis, 'binding-q-1');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          stage1Responses: [],
          compiledCandidates: {
            topology: {
              nodes: [
                existingCandidate, // duplicate id, must be skipped
                {
                  id: 'TOPOLOGY-node-new',
                  sourceId: analysisId,
                  classification: 'evidence',
                  target: 'topology_node',
                  label: 'Sub Control',
                  explanation: 'Control room',
                  evidenceIds: ['ev-1'],
                  proposedValue: { id: 'room-sub', label: 'Sub Control', name: 'Sub Control' },
                  reviewDecision: 'accepted',
                  applicationState: 'staged',
                },
              ],
              connections: [
                {
                  id: 'TOPOLOGY-conn-new',
                  sourceId: analysisId,
                  classification: 'evidence',
                  target: 'topology_connection',
                  label: 'Corridor',
                  explanation: 'Watertight corridor',
                  evidenceIds: ['ev-1'],
                  proposedValue: { from: 'room-1', to: 'room-sub', kind: 'PHYSICAL', userInitiated: true },
                  reviewDecision: 'accepted',
                  applicationState: 'staged',
                },
              ],
            },
            seed: {
              seeds: [
                {
                  id: 'SEED-seed-new',
                  sourceId: analysisId,
                  classification: 'evidence',
                  target: 'cast_seed',
                  targetCastMemberId: 'Captain',
                  label: 'Captain opening state',
                  explanation: 'Captain is in Sub Control',
                  evidenceIds: ['ev-1'],
                  proposedValue: {
                    name: 'Captain',
                    isUserCharacter: false,
                    seed: {
                      where: 'Sub Control',
                      doing: { mode: 'ACTIVE' },
                      condition: {},
                      charge: { band: 'calm' },
                      knows: [],
                      bonds: [],
                    },
                  },
                  reviewDecision: 'accepted',
                  applicationState: 'staged',
                },
                // duplicate within the response itself
                {
                  id: 'SEED-seed-new',
                  sourceId: analysisId,
                  classification: 'evidence',
                  target: 'cast_seed',
                  targetCastMemberId: 'Captain',
                  label: 'Captain duplicate',
                  explanation: 'Duplicate entry',
                  evidenceIds: [],
                  proposedValue: {},
                },
              ],
            },
          },
          failedBatteries: ['UNKNOWN_FAMILY'],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const res = await forgeActions.runQuestionnaireExtraction(analysisId, ['TOPOLOGY', 'SEED']);
      expect(res.success).toBe(true);
      expect(res.newCandidateCount).toBe(3); // TOPOLOGY-node-new, TOPOLOGY-conn-new, SEED-seed-new

      // Verify request payload included families
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/extract-questionnaire',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            sourceText: 'Summary: Log of the underwater facility.\n\nClaim (setting): Facility is underwater\n\nExcerpt: "deep beneath the surface"',
            families: ['TOPOLOGY', 'SEED'],
          }),
        })
      );

      const state = getForgeState();
      const updatedAnalysis = state.sourceAnalyses[analysisId];
      expect(updatedAnalysis.candidates).toHaveLength(4); // 1 existing + 3 new
      expect(updatedAnalysis.candidates[0].id).toBe('CAND-EXISTING-1');
      expect(updatedAnalysis.candidates[1].id).toBe('TOPOLOGY-node-new');
      expect(updatedAnalysis.candidates[2].id).toBe('TOPOLOGY-conn-new');
      expect(updatedAnalysis.candidates[3].id).toBe('SEED-seed-new');
      expect(state.questionnaireFailedBatteries).toEqual(['UNKNOWN_FAMILY']);
    });

    it('flattens C2 candidates (expressionGuidance, profiles, anchors, rules, contract) and sets questionnaireElicitations', async () => {
      const analysisId = 'src-test-c2';
      const initialAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: {
          id: 'rec-c2',
          fileName: 'story.txt',
          mimeType: 'text/plain',
          kind: 'document',
          receivedAt: Date.now(),
        },
        summary: 'Story summary.',
        evidence: [],
        candidates: [],
        unknowns: [],
        status: 'completed',
      };

      forgeActions.registerSourceAnalysis(initialAnalysis, 'binding-c2-1');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          stage1Responses: [],
          compiledCandidates: {
            seed: {
              seeds: [{ id: 'SEED-1', sourceId: analysisId, target: 'cast_seed' }],
              expressionGuidance: [{ id: 'EXPR-1', sourceId: analysisId, target: 'cast_expression_guidance' }],
            },
            villain: {
              profiles: [{ id: 'VILLAIN-1', sourceId: analysisId, target: 'antagonist_profile' }],
            },
            relationships: {
              anchors: [{ id: 'ANCHOR-1', sourceId: analysisId, target: 'value_anchor' }],
            },
            pressure: {
              rules: [{ id: 'RULE-1', sourceId: analysisId, target: 'premise' }],
              elicitation: { powerBudget: 'High', unknowns: ['origin'] },
            },
            depiction: {
              contract: { id: 'CONTRACT-1', sourceId: analysisId, target: 'depiction_contract' },
            },
          },
          failedBatteries: [],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const res = await forgeActions.runQuestionnaireExtraction(analysisId);
      expect(res.success).toBe(true);
      expect(res.newCandidateCount).toBe(6);

      const state = getForgeState();
      const updatedAnalysis = state.sourceAnalyses[analysisId];
      expect(updatedAnalysis.candidates).toHaveLength(6);
      expect(updatedAnalysis.candidates.map((c) => c.id)).toEqual([
        'SEED-1',
        'EXPR-1',
        'VILLAIN-1',
        'ANCHOR-1',
        'RULE-1',
        'CONTRACT-1',
      ]);
      expect(state.questionnaireElicitations[analysisId]).toEqual({
        powerBudget: 'High',
        unknowns: ['origin'],
      });
    });

    it('ignores malformed contract when contract is an array', async () => {
      const analysisId = 'src-test-malformed-contract';
      const initialAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: {
          id: 'rec-malformed',
          fileName: 'story.txt',
          mimeType: 'text/plain',
          kind: 'document',
          receivedAt: Date.now(),
        },
        summary: 'Story summary.',
        evidence: [],
        candidates: [],
        unknowns: [],
        status: 'completed',
      };

      forgeActions.registerSourceAnalysis(initialAnalysis, 'binding-malformed-1');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          stage1Responses: [],
          compiledCandidates: {
            depiction: {
              contract: [{ id: 'MALFORMED-ARRAY' }],
            },
          },
          failedBatteries: [],
        }),
      });

      const res = await forgeActions.runQuestionnaireExtraction(analysisId);
      expect(res.success).toBe(true);
      expect(res.newCandidateCount).toBe(0);
      const state = getForgeState();
      expect(state.sourceAnalyses[analysisId].candidates).toHaveLength(0);
    });

    it('returns error when endpoint returns HTTP failure', async () => {
      const analysisId = 'src-test-fail';
      const initialAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: { id: 'rec-fail', fileName: 'fail.txt', mimeType: 'text/plain', kind: 'document', receivedAt: Date.now() },
        candidates: [],
        evidence: [],
        unknowns: [],
        status: 'completed',
      };
      forgeActions.registerSourceAnalysis(initialAnalysis, 'binding-fail-1');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: 'Extraction service error' }),
      }) as unknown as typeof fetch;

      const res = await forgeActions.runQuestionnaireExtraction(analysisId);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Extraction service error');
    });
  });

  describe('Packet C4 - Questionnaire Validation Integration', () => {
    it('stores questionnaireViolations from extract-questionnaire endpoint', async () => {
      const analysisId = 'src-test-violations';
      const initialAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: { id: 'rec-viol', fileName: 'viol.txt', mimeType: 'text/plain', kind: 'document', receivedAt: Date.now() },
        candidates: [],
        evidence: [],
        unknowns: [],
        status: 'completed',
      };
      forgeActions.registerSourceAnalysis(initialAnalysis, 'binding-viol-1');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          stage1Responses: [],
          compiledCandidates: {},
          failedBatteries: [],
          violations: [
            {
              family: 'TOPOLOGY',
              question: 'What are the bounded spaces in this location?',
              reason: 'required at least 1 topology_node candidate(s); compiled 0',
            },
          ],
        }),
      });

      const res = await forgeActions.runQuestionnaireExtraction(analysisId);
      expect(res.success).toBe(true);

      const state = getForgeState();
      expect(state.questionnaireViolations[analysisId]).toHaveLength(1);
      expect(state.questionnaireViolations[analysisId][0]).toEqual({
        family: 'TOPOLOGY',
        question: 'What are the bounded spaces in this location?',
        reason: 'required at least 1 topology_node candidate(s); compiled 0',
      });
    });

    it('blocks applyAcceptedCandidates and leaves draft untouched when violations exist', () => {
      forgeActions.initializeDraft({ title: 'Untouched Title' });
      const initialDraft = JSON.parse(JSON.stringify(getForgeState().forgeDraft));

      const analysisId = 'src-test-blocked';
      const mockAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: { id: 'rec-blk', fileName: 'blk.txt', mimeType: 'text/plain', kind: 'document', receivedAt: Date.now() },
        candidates: [
          {
            id: 'cand-blk-1',
            sourceId: analysisId,
            classification: 'evidence' as const,
            target: 'setting_location' as const,
            label: 'Location',
            explanation: 'Extracted setting',
            evidenceIds: [],
            proposedValue: 'Should Not Be Applied',
            reviewDecision: 'accepted' as const,
            applicationState: 'staged' as const,
          },
        ],
        evidence: [],
        unknowns: [],
        status: 'completed',
      };
      forgeActions.registerSourceAnalysis(mockAnalysis, 'binding-blk-1');

      // Set violations for this source
      useForgeStoreInternal.setState((state) => ({
        ...state,
        questionnaireViolations: {
          ...state.questionnaireViolations,
          [analysisId]: [
            {
              family: 'SEED',
              question: 'Who makes the worst thing in the story happen? Who suffers it?',
              reason: 'required at least 1 cast_seed candidate(s) with disposition VILLAIN (§4b); compiled 0',
            },
          ],
        },
      }));

      const res = forgeActions.applyAcceptedCandidates(analysisId);
      expect(res.success).toBe(false);
      if (!res.success) {
        const failRes = res as { success: false; errors: Record<string, string> };
        expect(failRes.errors[analysisId]).toContain('Questionnaire requirements unmet:');
        expect(failRes.errors[analysisId]).toContain('[SEED]');
        expect(failRes.errors[analysisId]).toContain('disposition VILLAIN (§4b)');
        expect(failRes.errors[analysisId]).toContain('Who makes the worst thing in the story happen? Who suffers it?');
      }

      // Draft must be completely untouched
      const stateAfter = getForgeState();
      expect(stateAfter.forgeDraft).toEqual(initialDraft);
      expect(stateAfter.sourceAnalyses[analysisId].candidates[0].applicationState).toBe('staged');
    });

    it('proceeds with applyAcceptedCandidates when questionnaireViolations is empty array', () => {
      forgeActions.initializeDraft({ title: 'Initial Title' });

      const analysisId = 'src-test-empty-viol';
      const mockAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: { id: 'rec-ok', fileName: 'ok.txt', mimeType: 'text/plain', kind: 'document', receivedAt: Date.now() },
        candidates: [
          {
            id: 'cand-ok-1',
            sourceId: analysisId,
            classification: 'evidence' as const,
            target: 'setting_location' as const,
            label: 'Location',
            explanation: 'Extracted setting',
            evidenceIds: [],
            proposedValue: 'Successfully Applied Location',
            reviewDecision: 'accepted' as const,
            applicationState: 'staged' as const,
          },
        ],
        evidence: [],
        unknowns: [],
        status: 'completed',
      };
      forgeActions.registerSourceAnalysis(mockAnalysis, 'binding-ok-1');

      useForgeStoreInternal.setState((state) => ({
        ...state,
        questionnaireViolations: {
          ...state.questionnaireViolations,
          [analysisId]: [],
        },
      }));

      const res = forgeActions.applyAcceptedCandidates(analysisId);
      expect(res.success).toBe(true);
      expect(getForgeState().forgeDraft?.setting?.location).toBe('Successfully Applied Location');
    });

    it('proceeds with applyAcceptedCandidates when source has no questionnaireViolations entry', () => {
      forgeActions.initializeDraft({ title: 'Initial Title' });

      const analysisId = 'src-test-no-questionnaire';
      const mockAnalysis: ForgeSourceAnalysis = {
        id: analysisId,
        sourceRecord: { id: 'rec-none', fileName: 'none.txt', mimeType: 'text/plain', kind: 'document', receivedAt: Date.now() },
        candidates: [
          {
            id: 'cand-none-1',
            sourceId: analysisId,
            classification: 'evidence' as const,
            target: 'setting_location' as const,
            label: 'Location',
            explanation: 'Extracted setting',
            evidenceIds: [],
            proposedValue: 'No Questionnaire Location',
            reviewDecision: 'accepted' as const,
            applicationState: 'staged' as const,
          },
        ],
        evidence: [],
        unknowns: [],
        status: 'completed',
      };
      forgeActions.registerSourceAnalysis(mockAnalysis, 'binding-none-1');

      // Do NOT set questionnaireViolations for analysisId (undefined)
      const res = forgeActions.applyAcceptedCandidates(analysisId);
      expect(res.success).toBe(true);
      expect(getForgeState().forgeDraft?.setting?.location).toBe('No Questionnaire Location');
    });
  });
});


