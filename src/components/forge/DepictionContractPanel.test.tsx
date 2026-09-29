import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { DepictionContractPanel } from './DepictionContractPanel';
import { forgeActions, getForgeState } from '../../store/useForgeStore';
import {
  ForgeSourceAnalysis,
  DepictionContractProposal,
  BlueprintAmbiguityDecision,
  ForgeDraftCastMember,
} from '../../types/forge';

describe('DepictionContractPanel Component Lifecycle', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    forgeActions.resetStore();
    vi.restoreAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
      container = null;
      root = null;
    }
  });

  it('runs the Depiction Contract review lifecycle', async () => {
    // 1. Initial State: initialize draft with cast member and canonical ambiguity
    const canonicalAmbiguity: BlueprintAmbiguityDecision = {
      id: 'unk-hull-leak',
      category: 'rule',
      question: 'Does the hull breach leak seawater or memory fluid?',
      resolutionMode: 'CONTEXTUAL_DISCRETION',
      guidance: 'Preserve visceral fluid ambiguity.',
    };

    const initialCastMember: ForgeDraftCastMember = {
      id: 'char-oceanographer-1',
      name: 'Dr. Aris',
      description: 'Senior Benthic Oceanographer',
      role: 'Subject',
      personality: 'Obsessive and deteriorating',
      goals: 'Document acoustic telemetry',
      traits: ['Analytical', 'Paranoid'],
      isUserCharacter: true,
      behaviorVector: 'ADAPTIVE',
      isEntity: false,
      seed: {
        where: 'station_core',
        doing: { mode: 'SUSPENDED' },
        condition: {},
        charge: { band: 'calm' },
        knows: [],
        bonds: [],
        circumstance: 'Senior Benthic Oceanographer',
        inclination: 'Document acoustic telemetry',
      },
    };

    forgeActions.initializeDraft({
      title: 'Station Benthos',
      premise: 'Deep benthic research station under anomalous pressure.',
      cast: [initialCastMember],
      ambiguities: [canonicalAmbiguity],
    });

    // Register source with one accepted staged candidate and one object-valued applied candidate
    const stagedAnalysis: ForgeSourceAnalysis = {
      id: 'analysis-1',
      sourceRecord: {
        id: 'src-1',
        fileName: 'telemetry_log.json',
        mimeType: 'application/json',
        kind: 'native_blueprint',
        receivedAt: Date.now(),
      },
      summary: 'Hydrophone telemetry indicates anomalous depth reverberations.',
      evidence: [
        {
          id: 'ev-1',
          sourceId: 'src-1',
          category: 'setting',
          claim: 'Pulse recorded at 8000m.',
        },
      ],
      candidates: [
        {
          id: 'cand-1',
          sourceId: 'src-1',
          classification: 'evidence',
          target: 'setting_location',
          label: 'Setting Location',
          explanation: 'Mariana Trench depth sector',
          evidenceIds: ['ev-1'],
          proposedValue: 'Mariana Abyssal Plain',
          reviewDecision: 'accepted',
          applicationState: 'staged',
        },
        {
          id: 'cand-obj-1',
          sourceId: 'src-1',
          classification: 'inference',
          target: 'cast_expression_guidance',
          targetCastMemberId: 'char-oceanographer-1',
          label: 'Expression Guidance Object',
          explanation: 'Non-string structured candidate value',
          evidenceIds: ['ev-1'],
          proposedValue: {
            communicationModes: ['spoken'],
            expressionGuidance: 'Whispered acoustic repetition',
          },
          reviewDecision: 'accepted',
          applicationState: 'applied',
        },
      ],
      unknowns: [],
      status: 'completed',
    };

    forgeActions.registerSourceAnalysis(stagedAnalysis, 'mock-binding-staged');

    await act(async () => {
      root?.render(React.createElement(DepictionContractPanel));
    });

    // 2. Blocked Generation Verification
    const generateBtn = container?.querySelector('#depiction-generate-btn') as HTMLButtonElement;
    expect(generateBtn).toBeDefined();
    expect(generateBtn.disabled).toBe(true);

    const blockedNotice = container?.querySelector('#depiction-generation-blocked-notice');
    expect(blockedNotice).not.toBeNull();
    expect(blockedNotice?.textContent).toContain('accepted candidate "Setting Location" still staged');

    // 3. Resolve baseline prerequisite by applying the accepted candidate
    act(() => {
      forgeActions.applyAcceptedCandidates('analysis-1');
    });

    await act(async () => {
      root?.render(React.createElement(DepictionContractPanel));
    });

    expect(generateBtn.disabled).toBe(false);
    expect(container?.querySelector('#depiction-generation-blocked-notice')).toBeNull();

    // 4. Mock API response for valid generation
    const initialProposal: DepictionContractProposal = {
      contract: {
        dramaticRegister: 'Cold clinical detachment with somatic claustrophobia',
        directness: 'Oblique perceptual fragmentation before manifest threat',
        aftermath: 'Irreversible cognitive dissolution and auditory loops',
        ambiguityHandling: 'Deliberate ontological void; pressure anomalies unexplained',
        specialBoundaries: 'Strictly avoid supernatural saviors',
      },
      rationale: 'Derived from benthic acoustic logs and crew psych evals.',
      sourceDraftRevision: getForgeState().draftRevision || 1,
      sourceBaselineRevision: getForgeState().sourceBaselineRevision || 1,
      createdAt: Date.now(),
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'DEPICTION_CONTRACT_PROPOSAL',
        message: 'Synthesized parameters for benthos isolation.',
        proposal: initialProposal,
      }),
    });
    global.fetch = mockFetch;

    // 5. Generate proposal and verify request projection & staging without draft mutation
    await act(async () => {
      generateBtn.click();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchArgs = mockFetch.mock.calls[0];
    expect(fetchArgs[0]).toBe('/api/architect');
    const sentBody = JSON.parse(fetchArgs[1].body as string);
    expect(sentBody.kind).toBe('DEPICTION_CONTRACT_PROPOSAL');
    expect(sentBody.draftContext.title).toBe('Station Benthos');

    // Assert cast member reached the request
    expect(sentBody.draftContext.cast).toHaveLength(1);
    expect(sentBody.draftContext.cast[0].name).toBe('Dr. Aris');

    // Assert canonical ambiguity decision reached the request in exact valid shape
    expect(sentBody.draftContext.ambiguities).toHaveLength(1);
    expect(sentBody.draftContext.ambiguities[0]).toEqual({
      id: 'unk-hull-leak',
      category: 'rule',
      question: 'Does the hull breach leak seawater or memory fluid?',
      resolutionMode: 'CONTEXTUAL_DISCRETION',
      guidance: 'Preserve visceral fluid ambiguity.',
    });

    // Assert object-valued applied candidate was serialized to a bounded string
    const objFact = sentBody.baselineContext.appliedCandidateFacts.find(
      (f: { target: string }) => f.target === 'cast_expression_guidance'
    );
    expect(objFact).toBeDefined();
    expect(typeof objFact.value).toBe('string');
    expect(objFact.value).toBe(
      '{"communicationModes":["spoken"],"expressionGuidance":"Whispered acoustic repetition"}'
    );

    // Assert Generate button disappears while a proposal is staged
    expect(container?.querySelector('#depiction-generate-btn')).toBeNull();

    // Verify proposal banner is rendered with rationale
    const proposalBanner = container?.querySelector('#depiction-contract-proposal-banner');
    expect(proposalBanner).not.toBeNull();
    expect(proposalBanner?.textContent).toContain(
      'Derived from benthic acoustic logs and crew psych evals.'
    );

    // CRITICAL: Verify draft in store has NOT mutated yet
    expect(getForgeState().forgeDraft?.depictionContract?.dramaticRegister || '').toBe('');

    // 6. Stale Apply Disabled & Refresh Verification
    // Advance draft revision using updateDraft to make the staged proposal stale
    act(() => {
      forgeActions.updateDraft({ title: 'Station Benthos (Modified Sector)' });
    });

    await act(async () => {
      root?.render(React.createElement(DepictionContractPanel));
    });

    // Stale notice should be visible and Refresh button should appear
    expect(container?.querySelector('#depiction-contract-proposal-banner')?.textContent).toContain(
      'Stale Proposal'
    );
    const refreshBtn = container?.querySelector('#depiction-contract-refresh-btn') as HTMLButtonElement;
    expect(refreshBtn).not.toBeNull();
    expect(container?.querySelector('#depiction-contract-accept-btn')).toBeNull();

    // Mock refreshed proposal with updated sourceDraftRevision
    const refreshedProposal: DepictionContractProposal = {
      ...initialProposal,
      sourceDraftRevision: getForgeState().draftRevision || 1,
      sourceBaselineRevision: getForgeState().sourceBaselineRevision || 1,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        type: 'DEPICTION_CONTRACT_PROPOSAL',
        message: 'Refreshed proposal for modified sector.',
        proposal: refreshedProposal,
      }),
    });

    // Click Refresh
    await act(async () => {
      refreshBtn.click();
    });

    // Verify stale notice is cleared and Apply button appears
    expect(container?.querySelector('#depiction-contract-proposal-banner')?.textContent).not.toContain(
      'Stale Proposal'
    );
    const acceptBtn = container?.querySelector('#depiction-contract-accept-btn') as HTMLButtonElement;
    expect(acceptBtn).not.toBeNull();

    // 7. Valid Apply Verification
    await act(async () => {
      acceptBtn.click();
    });

    // Proposal banner should be dismissed
    expect(container?.querySelector('#depiction-contract-proposal-banner')).toBeNull();

    // Draft should now contain the applied depiction contract parameters
    const updatedDraft = getForgeState().forgeDraft;
    expect(updatedDraft?.depictionContract?.dramaticRegister).toBe(
      'Cold clinical detachment with somatic claustrophobia'
    );
    expect(updatedDraft?.depictionContract?.specialBoundaries).toBe(
      'Strictly avoid supernatural saviors'
    );

    // Export compliant badge should be visible
    expect(container?.textContent).toContain('Export Compliant');

    // 8. Dismiss Verification
    // Manually stage a new proposal
    act(() => {
      forgeActions.setPendingDepictionContractProposal({
        contract: {
          dramaticRegister: 'Temporary register',
          directness: 'Temporary directness',
          aftermath: 'Temporary aftermath',
          ambiguityHandling: 'Temporary ambiguity',
          specialBoundaries: '',
        },
        rationale: 'Temporary rationale to test dismiss',
        sourceDraftRevision: getForgeState().draftRevision || 1,
        sourceBaselineRevision: getForgeState().sourceBaselineRevision || 1,
        createdAt: Date.now(),
      });
    });

    await act(async () => {
      root?.render(React.createElement(DepictionContractPanel));
    });

    expect(container?.querySelector('#depiction-contract-proposal-banner')).not.toBeNull();
    const dismissBtn = container?.querySelector('#depiction-contract-dismiss-btn') as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();

    await act(async () => {
      dismissBtn.click();
    });

    expect(container?.querySelector('#depiction-contract-proposal-banner')).toBeNull();
    expect(getForgeState().pendingDepictionContractProposal).toBeNull();

    // 9. Manual Editor Textareas, Max Lengths, Character Counts & Invalid Values
    const dramaticTextarea = container?.querySelector(
      '#contract-dramatic-register'
    ) as HTMLTextAreaElement;
    const directnessTextarea = container?.querySelector(
      '#contract-directness'
    ) as HTMLTextAreaElement;
    const aftermathTextarea = container?.querySelector(
      '#contract-aftermath'
    ) as HTMLTextAreaElement;
    const ambiguityTextarea = container?.querySelector(
      '#contract-ambiguity'
    ) as HTMLTextAreaElement;
    const boundariesTextarea = container?.querySelector(
      '#contract-special-boundaries'
    ) as HTMLTextAreaElement;

    expect(dramaticTextarea).not.toBeNull();
    expect(directnessTextarea).not.toBeNull();
    expect(aftermathTextarea).not.toBeNull();
    expect(ambiguityTextarea).not.toBeNull();
    expect(boundariesTextarea).not.toBeNull();

    expect(dramaticTextarea.maxLength).toBe(1000);
    expect(directnessTextarea.maxLength).toBe(1000);
    expect(aftermathTextarea.maxLength).toBe(1000);
    expect(ambiguityTextarea.maxLength).toBe(1000);
    expect(boundariesTextarea.maxLength).toBe(1000);

    // Update dramaticRegister to exactly 5 characters and verify character count in DOM
    act(() => {
      forgeActions.updateDepictionContractField('dramaticRegister', 'Dread');
    });

    await act(async () => {
      root?.render(React.createElement(DepictionContractPanel));
    });

    expect(container?.textContent).toContain('5/1000');

    // Update dramaticRegister to manual placeholder "TBD" and assert Missing Requirements
    act(() => {
      forgeActions.updateDepictionContractField('dramaticRegister', 'TBD');
    });

    await act(async () => {
      root?.render(React.createElement(DepictionContractPanel));
    });

    expect(container?.textContent).toContain('Missing Requirements');
    expect(container?.textContent).not.toContain('Export Compliant');
  });
});
