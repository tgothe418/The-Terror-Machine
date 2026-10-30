import { describe, expect, it } from 'vitest';
import {
  resolveSituatedPressure,
  resolvePressureThreadTransitions,
} from './situatedPressure';
import { normalizeBlueprint } from './normalizeBlueprint';
import type { EngineTurnContext, Blueprint } from '../types';
import type {
  SituatedPressureProposal,
  CastActivityReceipt,
  SituatedPressureThread,
} from '../types/horrorGrammar';

describe('Situated Pressure Ratifier (Packet 1-3)', () => {
  const createMockBlueprint = (): Blueprint =>
    normalizeBlueprint({
      id: 'bp-1',
      identity: {
        title: 'Facility Omega',
        version: '1.0',
        author: 'Test',
        thematicAnchor: 'Containment',
      },
      title: 'Facility Omega',
      globalPremise: 'Underground lab complex',
      premise: 'Underground lab complex',
      setting: {
        location: 'Sub-Level',
        atmosphere: 'Sterile',
        timePeriod: '1999',
      },
      startingVector: 'COGNITIVE',
      startingTier: 'LATENT',
      environmentalRules: ['Power fluctuations breach containment.'],
      constraints: [],
      contentScale: 2,
      contentLevelDescription: 'Standard',
      cast: [
        {
          id: 'char-tech',
          name: 'Technician Mercer',
          description: 'Tech',
          role: 'Engineer',
          personality: 'Anxious',
          goals: 'Fix power',
          traits: ['Technical'],
          isUserCharacter: false,
          behaviorVector: 'COGNITIVE',
          isEntity: false,
          starting_location: 'NODE_CONTROL',
        },
      ],
      topology: {
        nodes: ['NODE_CONTROL'],
        connections: [],
      },
      horrorGrammar: {
        valueBaselineReview: 'REVIEWED',
        pursuitReviews: {
          'char-tech': 'REVIEWED',
        },
        valueAnchors: [
          {
            id: 'val-reactor-core',
            holder: { kind: 'PLACE', nodeId: 'NODE_CONTROL' },
            label: 'Primary Reactor Core',
            description: 'Sub-critical cooling state prevents meltdown',
            basisSummary: 'Facility power engineering',
            provenance: { kind: 'CREATOR_DEFINED' },
          },
        ],
        characterPursuits: [],
      },
    }) as Blueprint;

  const createMockContext = (bp: Blueprint): EngineTurnContext => ({
    version: 1,
    scenario: {
      id: bp.id,
      title: bp.title,
      premise: bp.premise,
      worldRules: ['Power fluctuations breach containment.'],
      setting: bp.setting,
      startingVector: 'COGNITIVE',
      startingTier: 'LATENT',
      incitingIncident: '',
      pacingDirective: '',
      keyPlotElements: [],
    },
    player: {
      role: 'protagonist',
      characterId: 'char-user',
      name: 'Officer Ray',
      description: 'Security officer',
      isEntity: false,
    },
    cast: [
      {
        id: 'char-tech',
        name: 'Technician Mercer',
        role: 'Engineer',
        description: 'Tech',
        personality: 'Anxious',
        goals: 'Fix power',
        traits: ['Technical'],
        isEntity: false,
        isUserCharacter: false,
        skepticism: 0.5,
        isPresent: true,
        stance: null,
        memory: [],
      },
    ],
    topology: {
      currentNodeId: 'NODE_CONTROL',
      readableNodeLabel: 'Control Room',
      allowedOutgoingExits: [],
    },
    runtime: {
      phase: 'LATENT',
      tension: 15,
      coherence: 1.0,
      reconciliationRevision: 0,
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      activeFlags: [],
      turnNumber: 2,
    },
    consequenceState: {
      inventory: [],
      player_injuries: [],
      psychological_status: 'STABLE',
    },
    relationshipState: [],
    memoryState: {},
    worldMemory: [],
    horrorGrammar: {
      fictionalTime: {
        moment_revision: 2,
        scene_beat_revision: 1,
        extended_revision: 0,
        last_cost: 'MOMENT',
      },
      activityEligibility: {
        version: 1,
        presentOpportunities: [],
        offscreenOpportunities: [],
        boundedOutPursuitIds: [],
        dormantCount: 0,
        notDueCount: 0,
        ledgerSnapshot: {
          moment_revision: 2,
          scene_beat_revision: 1,
          extended_revision: 0,
          last_cost: 'MOMENT',
        },
        scheduleSnapshotRevision: 2,
      },
      presentActorOpportunities: [],
      offscreenPursuitOpportunities: [],
      relevantValueAnchors: bp.horrorGrammar!.valueAnchors,
      authorityInstruction: 'Standard authority',
      runtimeState: {
        fictionalTime: {
          moment_revision: 2,
          scene_beat_revision: 1,
          extended_revision: 0,
          last_cost: 'MOMENT',
        },
        pursuitSchedule: {},
        recentActivityEvents: [],
        activePressureThreads: [],
        valueState: {},
        characterPursuits: {},
        characterDevelopment: {},
      },
      authoringBaseline: {
        valueBaselineReview: 'REVIEWED',
        pursuitReviews: {},
        valueAnchors: bp.horrorGrammar!.valueAnchors,
        characterPursuits: [],
      },
      evidenceRegistry: [],
    },
  });

  it('accepts NONE proposal cleanly without state mutation', () => {
    const bp = createMockBlueprint();
    const context = createMockContext(bp);

    const proposal: SituatedPressureProposal = {
      kind: 'NONE',
      reason: 'PRESSURE_NOT_CALLED_FOR',
    };

    const receipt = resolveSituatedPressure({
      proposal,
      currentContext: context,
      preThreads: [],
      currentTurn: 2,
      blueprint: bp,
    });

    expect(receipt.outcome).toBe('NO_PROPOSAL');
    expect(receipt.reasonCode).toBe('PRESSURE_NOT_CALLED_FOR');
    expect(receipt.admittedManifestation).toBe(false);
    expect(receipt.postState).toEqual([]);
  });

  it('rejects proposal referencing nonexistent Value Anchor ID', () => {
    const bp = createMockBlueprint();
    const context = createMockContext(bp);

    const proposal: SituatedPressureProposal = {
      kind: 'PRESSURE',
      proposalId: 'prop-press-1',
      valueAnchorId: 'val-unregistered-item',
      sourceReference: 'CONDITION_BREACH',
      operator: 'EXPOSE',
      affectedDimension: 'SAFETY',
      adverseProspect: 'Breach threatens unknown item',
      authorityReferences: ['RULE_1'],
      persistenceTarget: 'PRESSURE_THREAD',
      responseWindowOpen: true,
      manifestationBlock: {
        type: 'prose',
        content: 'Alarm sounds.',
      },
    };

    const receipt = resolveSituatedPressure({
      proposal,
      currentContext: context,
      preThreads: [],
      currentTurn: 2,
      blueprint: bp,
    });

    expect(receipt.outcome).toBe('REJECTED');
    expect(receipt.reasonCode).toBe('VALUE_ANCHOR_NOT_FOUND');
    expect(receipt.admittedManifestation).toBe(false);
  });

  it('rejects proposal with sourceReference ACTIVITY when activity was not accepted', () => {
    const bp = createMockBlueprint();
    const context = createMockContext(bp);

    const proposal: SituatedPressureProposal = {
      kind: 'PRESSURE',
      proposalId: 'prop-press-2',
      valueAnchorId: 'val-reactor-core',
      sourceReference: 'ACTIVITY',
      operator: 'DEGRADE_CAPABILITY',
      affectedDimension: 'CAPABILITY',
      adverseProspect: 'Coolant pumps losing pressure',
      authorityReferences: ['CONSOLE_FEED'],
      persistenceTarget: 'PRESSURE_THREAD',
      responseWindowOpen: true,
      manifestationBlock: {
        type: 'prose',
        content: 'Coolant alarm screams.',
      },
    };

    const rejectedActivityReceipt: CastActivityReceipt = {
      version: 1,
      outcome: 'REJECTED',
      reasonCode: 'MISMATCHED_PURSUIT_ID',
      preState: [],
      postState: [],
      admittedManifestation: false,
      acceptedEventId: null,
    };

    const receipt = resolveSituatedPressure({
      proposal,
      activityReceipt: rejectedActivityReceipt,
      currentContext: context,
      preThreads: [],
      currentTurn: 2,
      blueprint: bp,
    });

    expect(receipt.outcome).toBe('REJECTED');
    expect(receipt.reasonCode).toBe('ACTIVITY_SOURCE_NOT_ACCEPTED');
  });

  it('rejects proposal when responseWindowOpen is false', () => {
    const bp = createMockBlueprint();
    const context = createMockContext(bp);

    const proposal: SituatedPressureProposal = {
      kind: 'PRESSURE',
      proposalId: 'prop-press-closed',
      valueAnchorId: 'val-reactor-core',
      sourceReference: 'POWER_DROP',
      operator: 'IMPOSE_COST',
      affectedDimension: 'TIME',
      adverseProspect: 'Immediate meltdown completed with no escape window',
      authorityReferences: ['RULE_1'],
      persistenceTarget: 'PRESSURE_THREAD',
      responseWindowOpen: false, // Closed response window
      manifestationBlock: {
        type: 'prose',
        content: 'The core explodes instantly.',
      },
    };

    const receipt = resolveSituatedPressure({
      proposal,
      currentContext: context,
      preThreads: [],
      currentTurn: 2,
      blueprint: bp,
    });

    expect(receipt.outcome).toBe('REJECTED');
    expect(receipt.reasonCode).toBe('RESPONSE_WINDOW_CLOSED');
  });

  it('ratifies valid pressure proposal and copies holder directly from accepted blueprint anchor', () => {
    const bp = createMockBlueprint();
    const context = createMockContext(bp);

    const proposal: SituatedPressureProposal = {
      kind: 'PRESSURE',
      proposalId: 'prop-press-valid',
      valueAnchorId: 'val-reactor-core',
      sourceReference: 'ACTIVITY',
      operator: 'CONSTRAIN_ACCESS',
      affectedDimension: 'ACCESS',
      adverseProspect: 'Primary coolant valve is jammed shut behind expanding steam',
      authorityReferences: ['rule-1'],
      persistenceTarget: 'PRESSURE_THREAD',
      responseWindowOpen: true,
      manifestationBlock: {
        type: 'prose',
        content: 'Superheated steam hisses from the primary coolant junction, blocking the manual override wheel.',
      },
    };

    const acceptedActivityReceipt: CastActivityReceipt = {
      version: 1,
      outcome: 'ACCEPTED',
      reasonCode: 'ACTIVITY_RATIFIED',
      preState: [],
      postState: [],
      admittedManifestation: true,
      acceptedEventId: 'evt-1',
    };

    const receipt = resolveSituatedPressure({
      proposal,
      activityReceipt: acceptedActivityReceipt,
      currentContext: context,
      preThreads: [],
      currentTurn: 2,
      blueprint: bp,
    });

    expect(receipt.outcome).toBe('ACCEPTED');
    expect(receipt.reasonCode).toBe('PRESSURE_RATIFIED');
    expect(receipt.admittedManifestation).toBe(true);
    expect(receipt.postState).toHaveLength(1);

    const thread = receipt.postState[0];
    expect(thread.valueAnchorId).toBe('val-reactor-core');
    expect(thread.holder).toEqual({ kind: 'PLACE', nodeId: 'NODE_CONTROL' });
    expect(thread.status).toBe('OPEN');
    expect(thread.operator).toBe('CONSTRAIN_ACCESS');
    expect(thread.createdTurn).toBe(2);
  });

  describe('Pressure Thread Lifecycle Transitions (Packet 1-4)', () => {
    it('applies RESOLVED transition citing accepted consequence or action', () => {
      const preThread: SituatedPressureThread = {
        id: 'thr-1-val-core',
        valueAnchorId: 'val-reactor-core',
        holder: { kind: 'PLACE', nodeId: 'NODE_CONTROL' },
        sourceReference: 'BASELINE',
        operator: 'CONSTRAIN_ACCESS',
        affectedDimension: 'ACCESS',
        adverseProspect: 'Steam blocking valve',
        manifestationSummary: null,
        status: 'OPEN',
        createdTurn: 1,
        lastChangedTurn: 1,
        persistenceTarget: 'PRESSURE_THREAD',
        authorityReferences: [],
      };

      const receipt = resolvePressureThreadTransitions({
        proposal: {
          transitions: [
            {
              threadId: 'thr-1-val-core',
              proposedStatus: 'RESOLVED',
              causeReference: 'USER_ACTION',
              rationale: 'Player turned the emergency shutoff release.',
            },
          ],
        },
        preThreads: [preThread],
        currentTurn: 2,
        validCauses: ['USER_ACTION'],
      });

      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.postState[0].status).toBe('RESOLVED');
      expect(receipt.postState[0].lastChangedTurn).toBe(2);
    });

    it('applies TRANSFORMED transition creating new replacement thread atomically', () => {
      const preThread: SituatedPressureThread = {
        id: 'thr-1-val-core',
        valueAnchorId: 'val-reactor-core',
        holder: { kind: 'PLACE', nodeId: 'NODE_CONTROL' },
        sourceReference: 'BASELINE',
        operator: 'CONSTRAIN_ACCESS',
        affectedDimension: 'ACCESS',
        adverseProspect: 'Steam blocking valve',
        manifestationSummary: null,
        status: 'OPEN',
        createdTurn: 1,
        lastChangedTurn: 1,
        persistenceTarget: 'PRESSURE_THREAD',
        authorityReferences: [],
      };

      const receipt = resolvePressureThreadTransitions({
        proposal: {
          transitions: [
            {
              threadId: 'thr-1-val-core',
              proposedStatus: 'TRANSFORMED',
              causeReference: 'act-2-pipe-burst',
              replacementAdverseProspect: 'The entire corridor is flooding with boiling brine.',
              rationale: 'Valve cracked open, causing structural pipe rupture.',
            },
          ],
        },
        preThreads: [preThread],
        currentTurn: 2,
        validCauses: ['act-2-pipe-burst'],
      });

      expect(receipt.decisions[0].outcome).toBe('APPLIED');
      expect(receipt.postState).toHaveLength(2);
      expect(receipt.postState[0].status).toBe('TRANSFORMED');
      expect(receipt.postState[1].status).toBe('OPEN');
      expect(receipt.postState[1].adverseProspect).toBe(
        'The entire corridor is flooding with boiling brine.'
      );
    });
  });

  it('rejects environmental/condition pressure attempting dialogue manifestation', () => {
    const bp = createMockBlueprint();
    const context = createMockContext(bp);

    const proposal: SituatedPressureProposal = {
      kind: 'PRESSURE',
      proposalId: 'prop-env-dialogue',
      valueAnchorId: 'val-reactor-core',
      sourceReference: 'rule-1',
      operator: 'CONSTRAIN_ACCESS',
      affectedDimension: 'ACCESS',
      adverseProspect: 'Steam floods corridor',
      authorityReferences: ['rule-1'],
      persistenceTarget: 'PRESSURE_THREAD',
      responseWindowOpen: true,
      manifestationBlock: {
        type: 'dialogue',
        speaker: 'Technician Mercer',
        content: 'The steam is too hot!',
      },
    };

    const receipt = resolveSituatedPressure({
      proposal,
      currentContext: context,
      preThreads: [],
      currentTurn: 2,
      blueprint: bp,
    });

    expect(receipt.outcome).toBe('REJECTED');
    expect(receipt.reasonCode).toBe('ENVIRONMENTAL_PRESSURE_CANNOT_USE_DIALOGUE');
  });

  it('rejects pressure proposal with arbitrary ungrounded sourceReference', () => {
    const bp = createMockBlueprint();
    const context = createMockContext(bp);
    context.horrorGrammar = {
      ...context.horrorGrammar!,
      evidenceRegistry: [
        {
          id: 'rule-1',
          category: 'SCENARIO_RULE',
          ownerRef: bp.id,
          description: 'Power fluctuations breach containment.',
        },
      ],
    };

    const proposal: SituatedPressureProposal = {
      kind: 'PRESSURE',
      proposalId: 'prop-ungrounded-source',
      valueAnchorId: 'val-reactor-core',
      sourceReference: 'invented_hallucinated_source_tag',
      operator: 'CONSTRAIN_ACCESS',
      affectedDimension: 'ACCESS',
      adverseProspect: 'Steam floods corridor',
      authorityReferences: ['rule-1'],
      persistenceTarget: 'PRESSURE_THREAD',
      responseWindowOpen: true,
      manifestationBlock: {
        type: 'prose',
        content: 'Steam hisses violently.',
      },
    };

    const receipt = resolveSituatedPressure({
      proposal,
      currentContext: context,
      preThreads: [],
      currentTurn: 2,
      blueprint: bp,
    });

    expect(receipt.outcome).toBe('REJECTED');
    expect(receipt.reasonCode).toBe('INVALID_SOURCE_REFERENCE');
  });

  describe('Packet 06: Exact Authority & Source References in Situated Pressure', () => {
    it('rejects pressure citing nonexistent rule in authorityReferences with INVALID_AUTHORITY_REFERENCE', () => {
      const bp = createMockBlueprint();
      const context = createMockContext(bp);

      const proposal: SituatedPressureProposal = {
        kind: 'PRESSURE',
        proposalId: 'prop-press-fake-rule',
        valueAnchorId: 'val-reactor-core',
        sourceReference: 'BASELINE',
        operator: 'CONSTRAIN_ACCESS',
        affectedDimension: 'ACCESS',
        adverseProspect: 'Coolant line pressure drop',
        authorityReferences: ['rule-does-not-exist-in-this-scenario'],
        persistenceTarget: 'PRESSURE_THREAD',
        responseWindowOpen: true,
        manifestationBlock: null,
      };

      const receipt = resolveSituatedPressure({
        proposal,
        currentContext: context,
        preThreads: [],
        currentTurn: 2,
        blueprint: bp,
      });

      expect(receipt.outcome).toBe('REJECTED');
      expect(receipt.reasonCode).toBe('INVALID_AUTHORITY_REFERENCE');
    });

    it('rejects pressure citing nonexistent rule in sourceReference with INVALID_SOURCE_REFERENCE', () => {
      const bp = createMockBlueprint();
      const context = createMockContext(bp);

      const proposal: SituatedPressureProposal = {
        kind: 'PRESSURE',
        proposalId: 'prop-press-fake-source-rule',
        valueAnchorId: 'val-reactor-core',
        sourceReference: 'rule-does-not-exist-in-this-scenario',
        operator: 'CONSTRAIN_ACCESS',
        affectedDimension: 'ACCESS',
        adverseProspect: 'Coolant line pressure drop',
        authorityReferences: ['rule-1'],
        persistenceTarget: 'PRESSURE_THREAD',
        responseWindowOpen: true,
        manifestationBlock: null,
      };

      const receipt = resolveSituatedPressure({
        proposal,
        currentContext: context,
        preThreads: [],
        currentTurn: 2,
        blueprint: bp,
      });

      expect(receipt.outcome).toBe('REJECTED');
      expect(receipt.reasonCode).toBe('INVALID_SOURCE_REFERENCE');
    });

    it('rejects environmental pressure citing character opportunity with UNAUTHORIZED_PRESSURE_CLAIM', () => {
      const bp = createMockBlueprint();
      const context = createMockContext(bp);
      context.horrorGrammar = {
        ...context.horrorGrammar!,
        evidenceRegistry: [
          {
            id: 'opp-present-char-tech',
            category: 'OPPORTUNITY',
            ownerRef: 'char-tech',
            description: 'Engineering opportunity for Mercer',
          },
        ],
      };

      const proposal: SituatedPressureProposal = {
        kind: 'PRESSURE',
        proposalId: 'prop-press-unauthorized-opp',
        valueAnchorId: 'val-reactor-core',
        sourceReference: 'BASELINE',
        operator: 'CONSTRAIN_ACCESS',
        affectedDimension: 'ACCESS',
        adverseProspect: 'Pumps fail due to environmental strain',
        authorityReferences: ['opp-present-char-tech'], // tech opportunity cited for non-tech environmental pressure
        persistenceTarget: 'PRESSURE_THREAD',
        responseWindowOpen: true,
        manifestationBlock: {
          type: 'prose',
          content: 'The coolant hiss rises sharply.',
        },
      };

      const receipt = resolveSituatedPressure({
        proposal,
        currentContext: context,
        preThreads: [],
        currentTurn: 2,
        blueprint: bp,
      });

      expect(receipt.outcome).toBe('REJECTED');
      expect(receipt.reasonCode).toBe('UNAUTHORIZED_PRESSURE_CLAIM');
    });

    it('ratifies pressure derived from accepted same-turn activity, but rejects otherwise-identical pressure when activity is rejected', () => {
      const bp = createMockBlueprint();
      const context = createMockContext(bp);

      const makePressureProposal = (): SituatedPressureProposal => ({
        kind: 'PRESSURE',
        proposalId: 'prop-pressure-consequent',
        valueAnchorId: 'val-reactor-core',
        sourceReference: 'ACTIVITY',
        operator: 'DEGRADE_CAPABILITY',
        affectedDimension: 'CAPABILITY',
        adverseProspect: 'Primary cooling loop impaired by technician maintenance error',
        authorityReferences: ['rule-1'],
        persistenceTarget: 'PRESSURE_THREAD',
        responseWindowOpen: true,
        manifestationBlock: {
          type: 'prose',
          content: 'Steam sprays outward as the pipe fractures under stress.',
        },
      });

      // Case A: Activity accepted earlier this turn
      const acceptedActivityReceipt: CastActivityReceipt = {
        version: 1,
        outcome: 'ACCEPTED',
        reasonCode: 'ACTIVITY_RATIFIED',
        preState: [],
        postState: [],
        admittedManifestation: true,
        acceptedEventId: 'evt-2-char-tech',
      };

      const acceptedPressureReceipt = resolveSituatedPressure({
        proposal: makePressureProposal(),
        activityReceipt: acceptedActivityReceipt,
        currentContext: context,
        preThreads: [],
        currentTurn: 2,
        blueprint: bp,
      });

      expect(acceptedPressureReceipt.outcome).toBe('ACCEPTED');
      expect(acceptedPressureReceipt.reasonCode).toBe('PRESSURE_RATIFIED');
      expect(acceptedPressureReceipt.acceptedThreadId).toBe('prop-pressure-consequent');
      expect(acceptedPressureReceipt.postState).toHaveLength(1);
      expect(acceptedPressureReceipt.postState[0].sourceReference).toBe('evt-2-char-tech');

      // Case B: Activity rejected earlier this turn
      const rejectedActivityReceipt: CastActivityReceipt = {
        version: 1,
        outcome: 'REJECTED',
        reasonCode: 'USER_CHARACTER_CANNOT_BE_ACTIVITY_ACTOR',
        preState: [],
        postState: [],
        admittedManifestation: false,
        acceptedEventId: null,
      };

      const rejectedPressureReceipt = resolveSituatedPressure({
        proposal: makePressureProposal(),
        activityReceipt: rejectedActivityReceipt,
        currentContext: context,
        preThreads: [],
        currentTurn: 2,
        blueprint: bp,
      });

      expect(rejectedPressureReceipt.outcome).toBe('REJECTED');
      expect(rejectedPressureReceipt.reasonCode).toBe('ACTIVITY_SOURCE_NOT_ACCEPTED');
      expect(rejectedPressureReceipt.acceptedThreadId).toBeNull();
      expect(rejectedPressureReceipt.postState).toEqual([]);
    });

    it('rejects fabricated prefixes like rule-999 or thr-fake that do not exist in canonical sources', () => {
      const bp = createMockBlueprint();
      const context = createMockContext(bp);

      for (const fakeRef of ['rule-999', 'thr-invented-thread', 'act-fabricated-event']) {
        const proposal: SituatedPressureProposal = {
          kind: 'PRESSURE',
          proposalId: `prop-${fakeRef}`,
          valueAnchorId: 'val-reactor-core',
          sourceReference: fakeRef,
          operator: 'CONSTRAIN_ACCESS',
          affectedDimension: 'ACCESS',
          adverseProspect: 'Pumps fail.',
          authorityReferences: ['rule-1'],
          persistenceTarget: 'PRESSURE_THREAD',
          responseWindowOpen: true,
          manifestationBlock: null,
        };

        const receipt = resolveSituatedPressure({
          proposal,
          currentContext: context,
          preThreads: [],
          currentTurn: 2,
          blueprint: bp,
        });

        expect(receipt.outcome).toBe('REJECTED');
        expect(receipt.reasonCode).toBe('INVALID_SOURCE_REFERENCE');
      }
    });

    describe('Villain-Protagonist Pressure Ratification', () => {
      it('accepts self-sourced pressure with operator INTERNAL and sourceReference SELF when villainProtagonist is true', () => {
        const bp = createMockBlueprint();
        bp.villainProtagonist = true;
        const context = createMockContext(bp);
        context.villainProtagonist = true;

        const proposal: SituatedPressureProposal = {
          kind: 'PRESSURE',
          proposalId: 'prop-self-compulsion',
          valueAnchorId: 'val-reactor-core',
          sourceReference: 'SELF',
          operator: 'INTERNAL',
          affectedDimension: 'IDENTITY',
          adverseProspect: 'Predatory urges overcome rational discipline.',
          authorityReferences: ['SELF'],
          persistenceTarget: 'PRESSURE_THREAD',
          responseWindowOpen: true,
          manifestationBlock: null,
        };

        const receipt = resolveSituatedPressure({
          proposal,
          currentContext: context,
          preThreads: [],
          currentTurn: 3,
          blueprint: bp,
        });

        expect(receipt.outcome).toBe('ACCEPTED');
        expect(receipt.reasonCode).toBe('SELF_SOURCED_PRESSURE');
        expect(receipt.acceptedThreadId).toBe('prop-self-compulsion');
        expect(receipt.postState).toHaveLength(1);
        expect(receipt.postState[0].sourceReference).toBe('SELF');
        expect(receipt.postState[0].operator).toBe('INTERNAL');
      });

      it('accepts self-sourced pressure with sourceReference matching characterId when villainProtagonist is true', () => {
        const bp = createMockBlueprint();
        bp.villainProtagonist = true;
        const context = createMockContext(bp);
        context.villainProtagonist = true;

        const proposal: SituatedPressureProposal = {
          kind: 'PRESSURE',
          proposalId: 'prop-char-compulsion',
          valueAnchorId: 'val-reactor-core',
          sourceReference: context.player.characterId,
          operator: 'INTERNAL',
          affectedDimension: 'IDENTITY',
          adverseProspect: 'Urge to breach containment escalates.',
          authorityReferences: [context.player.characterId],
          persistenceTarget: 'PRESSURE_THREAD',
          responseWindowOpen: true,
          manifestationBlock: null,
        };

        const receipt = resolveSituatedPressure({
          proposal,
          currentContext: context,
          preThreads: [],
          currentTurn: 3,
          blueprint: bp,
        });

        expect(receipt.outcome).toBe('ACCEPTED');
        expect(receipt.reasonCode).toBe('SELF_SOURCED_PRESSURE');
        expect(receipt.acceptedThreadId).toBe('prop-char-compulsion');
        expect(receipt.postState[0].sourceReference).toBe(context.player.characterId);
      });

      it('rejects self-sourced pressure when villainProtagonist is false or unset', () => {
        const bp = createMockBlueprint();
        bp.villainProtagonist = false;
        const context = createMockContext(bp);
        context.villainProtagonist = false;

        const proposal: SituatedPressureProposal = {
          kind: 'PRESSURE',
          proposalId: 'prop-unauth-self',
          valueAnchorId: 'val-reactor-core',
          sourceReference: 'SELF',
          operator: 'INTERNAL',
          affectedDimension: 'IDENTITY',
          adverseProspect: 'Urge escalates.',
          authorityReferences: [],
          persistenceTarget: 'PRESSURE_THREAD',
          responseWindowOpen: true,
          manifestationBlock: null,
        };

        const receipt = resolveSituatedPressure({
          proposal,
          currentContext: context,
          preThreads: [],
          currentTurn: 3,
          blueprint: bp,
        });

        expect(receipt.outcome).toBe('REJECTED');
        expect(receipt.reasonCode).toBe('UNAUTHORIZED_PRESSURE_CLAIM');
        expect(receipt.acceptedThreadId).toBeNull();
      });

      it('rejects characterId self-sourced pressure when villainProtagonist is false or unset', () => {
        const bp = createMockBlueprint();
        delete bp.villainProtagonist;
        const context = createMockContext(bp);
        delete context.villainProtagonist;

        const proposal: SituatedPressureProposal = {
          kind: 'PRESSURE',
          proposalId: 'prop-unauth-char',
          valueAnchorId: 'val-reactor-core',
          sourceReference: context.player.characterId,
          operator: 'INTERNAL',
          affectedDimension: 'IDENTITY',
          adverseProspect: 'Urge escalates.',
          authorityReferences: [],
          persistenceTarget: 'PRESSURE_THREAD',
          responseWindowOpen: true,
          manifestationBlock: null,
        };

        const receipt = resolveSituatedPressure({
          proposal,
          currentContext: context,
          preThreads: [],
          currentTurn: 3,
          blueprint: bp,
        });

        expect(receipt.outcome).toBe('REJECTED');
        expect(receipt.reasonCode).toBe('UNAUTHORIZED_PRESSURE_CLAIM');
        expect(receipt.acceptedThreadId).toBeNull();
      });
    });
  });

  describe('boundedOutChangeIds on pressure receipts', () => {
    describe('resolvePressureThreadTransitions', () => {
      it('returns empty array when transitions count is within cap', () => {
        const receipt = resolvePressureThreadTransitions({
          proposal: {
            transitions: [
              {
                threadId: 'thr-1',
                proposedStatus: 'RESOLVED',
                causeReference: 'cause-1',
                rationale: 'Valid transition',
              },
            ],
          },
          preThreads: [
            {
              id: 'thr-1',
              valueAnchorId: 'val-reactor-core',
              holder: { kind: 'PLACE', nodeId: 'NODE_CONTROL' },
              sourceReference: 'BASELINE',
              operator: 'CONSTRAIN_ACCESS',
              affectedDimension: 'ACCESS',
              adverseProspect: 'Steam blocking valve',
              manifestationSummary: null,
              status: 'OPEN',
              createdTurn: 1,
              lastChangedTurn: 1,
              persistenceTarget: 'PRESSURE_THREAD',
              authorityReferences: [],
            },
          ],
          currentTurn: 2,
          validCauses: ['cause-1'],
        });

        expect(receipt.boundedOutChangeIds).toEqual([]);
      });

      it('submits cap + 2 transitions and records exact dropped IDs into boundedOutChangeIds', () => {
        const receipt = resolvePressureThreadTransitions({
          proposal: {
            transitions: [
              {
                threadId: 'thr-1',
                proposedStatus: 'RESOLVED',
                causeReference: 'cause-1',
                rationale: 'Transition 1',
              },
              {
                threadId: 'thr-2',
                proposedStatus: 'RESOLVED',
                causeReference: 'cause-1',
                rationale: 'Transition 2',
              },
              {
                threadId: 'thr-3',
                proposedStatus: 'RESOLVED',
                causeReference: 'cause-1',
                rationale: 'Transition 3 (dropped)',
              },
              {
                threadId: 'thr-4',
                proposedStatus: 'RESOLVED',
                causeReference: 'cause-1',
                rationale: 'Transition 4 (dropped)',
              },
            ],
          },
          preThreads: [],
          currentTurn: 2,
          validCauses: ['cause-1'],
        });

        expect(receipt.boundedOutChangeIds).toHaveLength(2);
        expect(receipt.boundedOutChangeIds).toEqual(['thr-3', 'thr-4']);
      });
    });

    describe('resolveSituatedPressure', () => {
      it('returns empty array when proposal is accepted within thread cap', () => {
        const bp = createMockBlueprint();
        const context = createMockContext(bp);
        const proposal: SituatedPressureProposal = {
          kind: 'PRESSURE',
          proposalId: 'prop-press-within-cap',
          valueAnchorId: 'val-reactor-core',
          sourceReference: 'ACTIVITY',
          operator: 'CONSTRAIN_ACCESS',
          affectedDimension: 'ACCESS',
          adverseProspect: 'Valve blocked by steam',
          authorityReferences: [],
          persistenceTarget: 'PRESSURE_THREAD',
          responseWindowOpen: true,
          manifestationBlock: null,
        };
        const acceptedActivityReceipt: CastActivityReceipt = {
          version: 1,
          outcome: 'ACCEPTED',
          reasonCode: 'ACTIVITY_RATIFIED',
          preState: [],
          postState: [],
          admittedManifestation: false,
          acceptedEventId: 'evt-1',
        };

        const receipt = resolveSituatedPressure({
          proposal,
          activityReceipt: acceptedActivityReceipt,
          currentContext: context,
          preThreads: [],
          currentTurn: 2,
          blueprint: bp,
        });

        expect(receipt.outcome).toBe('ACCEPTED');
        expect(receipt.boundedOutChangeIds).toEqual([]);
      });

      it('records dropped proposal ID into boundedOutChangeIds when MAX_PRESSURE_THREADS_REACHED is triggered', () => {
        const bp = createMockBlueprint();
        const context = createMockContext(bp);
        const preThreads: SituatedPressureThread[] = [1, 2, 3, 4, 5].map((i) => ({
          id: `thr-open-${i}`,
          valueAnchorId: `val-anchor-${i}`,
          holder: { kind: 'PLACE', nodeId: 'NODE_CONTROL' },
          sourceReference: 'BASELINE',
          operator: 'CONSTRAIN_ACCESS',
          affectedDimension: 'ACCESS',
          adverseProspect: `Threat ${i}`,
          manifestationSummary: null,
          status: 'OPEN',
          createdTurn: 1,
          lastChangedTurn: 1,
          persistenceTarget: 'PRESSURE_THREAD',
          authorityReferences: [],
        }));

        const proposal: SituatedPressureProposal = {
          kind: 'PRESSURE',
          proposalId: 'prop-press-overflow-1',
          valueAnchorId: 'val-reactor-core',
          sourceReference: 'ACTIVITY',
          operator: 'CONSTRAIN_ACCESS',
          affectedDimension: 'ACCESS',
          adverseProspect: 'New pressure beyond capacity',
          authorityReferences: [],
          persistenceTarget: 'PRESSURE_THREAD',
          responseWindowOpen: true,
          manifestationBlock: null,
        };
        const acceptedActivityReceipt: CastActivityReceipt = {
          version: 1,
          outcome: 'ACCEPTED',
          reasonCode: 'ACTIVITY_RATIFIED',
          preState: [],
          postState: [],
          admittedManifestation: false,
          acceptedEventId: 'evt-1',
        };

        const receipt = resolveSituatedPressure({
          proposal,
          activityReceipt: acceptedActivityReceipt,
          currentContext: context,
          preThreads,
          currentTurn: 2,
          blueprint: bp,
        });

        expect(receipt.outcome).toBe('REJECTED');
        expect(receipt.reasonCode).toBe('MAX_PRESSURE_THREADS_REACHED');
        expect(receipt.boundedOutChangeIds).toHaveLength(1);
        expect(receipt.boundedOutChangeIds).toEqual(['prop-press-overflow-1']);
      });

      it('prefers proposal.id if present when recording dropped ID on MAX_PRESSURE_THREADS_REACHED', () => {
        const bp = createMockBlueprint();
        const context = createMockContext(bp);
        const preThreads: SituatedPressureThread[] = [1, 2, 3, 4, 5].map((i) => ({
          id: `thr-open-${i}`,
          valueAnchorId: `val-anchor-${i}`,
          holder: { kind: 'PLACE', nodeId: 'NODE_CONTROL' },
          sourceReference: 'BASELINE',
          operator: 'CONSTRAIN_ACCESS',
          affectedDimension: 'ACCESS',
          adverseProspect: `Threat ${i}`,
          manifestationSummary: null,
          status: 'OPEN',
          createdTurn: 1,
          lastChangedTurn: 1,
          persistenceTarget: 'PRESSURE_THREAD',
          authorityReferences: [],
        }));

        const proposal = {
          kind: 'PRESSURE' as const,
          id: 'prop-id-field-1',
          proposalId: 'prop-press-fallback',
          valueAnchorId: 'val-reactor-core',
          sourceReference: 'ACTIVITY',
          operator: 'CONSTRAIN_ACCESS' as const,
          affectedDimension: 'ACCESS' as const,
          adverseProspect: 'New pressure beyond capacity',
          authorityReferences: [],
          persistenceTarget: 'PRESSURE_THREAD' as const,
          responseWindowOpen: true,
          manifestationBlock: null,
        };
        const acceptedActivityReceipt: CastActivityReceipt = {
          version: 1,
          outcome: 'ACCEPTED',
          reasonCode: 'ACTIVITY_RATIFIED',
          preState: [],
          postState: [],
          admittedManifestation: false,
          acceptedEventId: 'evt-1',
        };

        const receipt = resolveSituatedPressure({
          proposal: proposal as unknown as SituatedPressureProposal,
          activityReceipt: acceptedActivityReceipt,
          currentContext: context,
          preThreads,
          currentTurn: 2,
          blueprint: bp,
        });

        expect(receipt.outcome).toBe('REJECTED');
        expect(receipt.reasonCode).toBe('MAX_PRESSURE_THREADS_REACHED');
        expect(receipt.boundedOutChangeIds).toEqual(['prop-id-field-1']);
      });
    });
  });
});
