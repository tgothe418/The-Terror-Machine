import { describe, it, expect } from 'vitest';
import { BlueprintSchema } from '../../types';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';
import { resolveSeatAvailabilities } from '../../lib/seatAvailability';
import { buildCharacterPresence } from '../../lib/castPresence';
import { DramaticSpineSchema } from '../../types/dramaturgy';
import { validateForgeDraft } from '../../lib/forgeCompiler';
import starlightMotel from './starlight_motel.json';

describe('Canonical Scenario Blueprint: The Starlight Motel (HG2 Fueled)', () => {
  it('validates cleanly against BlueprintSchema and normalizeBlueprint', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    expect(normalized.title).toBe('The Starlight Motel');
    const parsed = BlueprintSchema.parse(normalized);
    expect(parsed.id).toBe('blueprint-starlight-motel');
    expect(parsed.topology.nodeDefinitions).toHaveLength(7);
    expect(parsed.cast).toHaveLength(5);
    expect(parsed.depictionContract?.dramaticRegister).toContain('Grim roadside noir');
  });

  it('authors explicit role semantics across all cast members', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    const dispositions = normalized.cast.map((c) => c.disposition);
    expect(dispositions.filter((d: string) => d === 'SURVIVOR')).toHaveLength(3);
    expect(dispositions.filter((d: string) => d === 'VILLAIN')).toHaveLength(2);

    const tommy = normalized.cast.find((c) => c.id === 'char-tommy-beck');
    expect(tommy?.isUserCharacter).toBe(true);
    expect(tommy?.disposition).toBe('SURVIVOR');
    expect(tommy?.behaviorVector).toBe('CAUTIOUS');

    const frank = normalized.cast.find((c) => c.id === 'char-frank-mercer');
    expect(frank?.disposition).toBe('VILLAIN');
    expect(frank?.behaviorVector).toBe('PREDATORY');

    const paula = normalized.cast.find((c) => c.id === 'char-paula-mercer');
    expect(paula?.disposition).toBe('VILLAIN');
    expect(paula?.behaviorVector).toBe('PREDATORY');
  });

  it('carries voice dossiers and psychological stakes on every cast member', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    for (const member of normalized.cast) {
      expect(member.expressionProfile).toBeDefined();
      expect(member.expressionProfile?.expressionGuidance.length).toBeGreaterThan(0);
      expect(member.psychologicalStakes).toBeDefined();
      expect(member.psychologicalStakes?.breakingPointTrigger.length).toBeGreaterThan(0);
      expect(member.psychologicalStakes?.coreDesireOrNeed.length).toBeGreaterThan(0);
    }

    const frank = normalized.cast.find((c) => c.id === 'char-frank-mercer');
    expect(frank?.expressionProfile?.lexiconNotes).toContain('Friend');

    const paula = normalized.cast.find((c) => c.id === 'char-paula-mercer');
    expect(paula?.expressionProfile?.silenceGuidance).toContain('counting');
  });

  it('parses the dramatic spine with SLOW_BURN_DREAD and impending clocks', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    expect(normalized.dramaticSpine).toBeDefined();
    const spine = DramaticSpineSchema.parse(normalized.dramaticSpine);
    expect(spine.pacingProfile).toBe('SLOW_BURN_DREAD');
    expect(spine.thematicPremise).toContain('predator');
    expect(spine.dramaticQuestions).toHaveLength(3);
    expect(spine.milestoneConditions).toHaveLength(12);
    expect(spine.impendingClocks).toHaveLength(2);

    const dawnClock = spine.impendingClocks.find((c) => c.id === 'storm_dawn_reopening');
    expect(dawnClock).toBeDefined();
    expect(dawnClock?.domain).toBe('STRUCTURAL');
    expect(dawnClock?.advanceMode.mode).toBe('TIME');

    const frankClock = spine.impendingClocks.find((c) => c.id === 'frank_harvest_readiness');
    expect(frankClock).toBeDefined();
    expect(frankClock?.domain).toBe('BEHAVIORAL');
    expect(frankClock?.advanceMode.mode).toBe('EVENT');
  });

  it('populates reviewed HG1 valueAnchors and characterPursuits', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    expect(normalized.horrorGrammar).toBeDefined();
    expect(normalized.horrorGrammar?.valueBaselineReview).toBe('REVIEWED');
    expect(normalized.horrorGrammar?.valueAnchors).toHaveLength(3);
    expect(normalized.horrorGrammar?.characterPursuits).toHaveLength(4);

    for (const anchor of normalized.horrorGrammar?.valueAnchors || []) {
      expect(anchor.id.length).toBeGreaterThan(0);
      expect(anchor.label.length).toBeGreaterThan(0);
      expect(anchor.holder).toBeDefined();
      expect(anchor.provenance.kind).toBe('CREATOR_DEFINED');
    }

    for (const pursuit of normalized.horrorGrammar?.characterPursuits || []) {
      expect(pursuit.id.length).toBeGreaterThan(0);
      expect(pursuit.objective.length).toBeGreaterThan(0);
      expect(pursuit.castMemberId.length).toBeGreaterThan(0);
      expect(pursuit.status).toBe('ACTIVE');
    }

    expect(normalized.horrorGrammar?.pursuitReviews?.['char-frank-mercer']).toBe('REVIEWED');
    expect(normalized.horrorGrammar?.pursuitReviews?.['char-paula-mercer']).toBe('REVIEWED');
    expect(normalized.horrorGrammar?.pursuitReviews?.['char-tommy-beck']).toBe('REVIEWED_NONE');
  });

  it('resolves valid seats for Protagonist and Antagonist participation', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    const seats = resolveSeatAvailabilities(normalized);
    expect(seats.protagonist.available).toBe(true);
    expect(seats.antagonist.available).toBe(true);
    expect(seats.director.available).toBe(false);
  });

  it('binds two villains with apparatus controls and telemetry feeds into blueprint', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    expect(normalized.villains).toBeDefined();
    expect(normalized.villains).toHaveLength(2);
    expect(normalized.defaultVillainId).toBe('char-frank-mercer');

    const paulaVillain = normalized.villains?.find((v) => v.villainId === 'char-paula-mercer');
    expect(paulaVillain).toBeDefined();
    expect(paulaVillain?.operationalProfile?.apparatusControls).toHaveLength(3);
    expect(paulaVillain?.operationalProfile?.telemetryFeeds).toHaveLength(2);
    expect(paulaVillain?.operationalProfile?.preyCohort).toHaveLength(2);

    const frankVillain = normalized.villains?.find((v) => v.villainId === 'char-frank-mercer');
    expect(frankVillain).toBeDefined();
    expect(frankVillain?.operationalProfile?.apparatusControls).toHaveLength(3);
    expect(frankVillain?.operationalProfile?.telemetryFeeds).toHaveLength(2);
    expect(frankVillain?.operationalProfile?.preyCohort).toHaveLength(2);
  });

  it('builds initial character presences at correct starting nodes', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    const nodeIds: string[] = normalized.topology.nodes;
    const presences = buildCharacterPresence(
      normalized.cast,
      null,
      nodeIds,
      'room_6',
      'char-tommy-beck'
    );
    expect(presences['char-frank-mercer']?.nodeId).toBe('office');
    expect(presences['char-paula-mercer']?.nodeId).toBe('office');
    expect(presences['char-tommy-beck']?.nodeId).toBe('room_6');
    expect(presences['char-rosa-delgado']?.nodeId).toBe('room_7');
    expect(presences['char-eddie-marsh']?.nodeId).toBe('parking_lot');
  });

  it('restores the breezeway node and connections (Packet 15-C §1)', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    expect(normalized.topology.nodeDefinitions).toHaveLength(7);
    const nodeIds = normalized.topology.nodeDefinitions?.map((n) => n.id);
    expect(nodeIds).toContain('breezeway');
    expect(normalized.topology.nodes).toContain('breezeway');

    const breezewayConns = (normalized.topology.connections || []).filter(
      (c) => c.from === 'breezeway' || c.to === 'breezeway'
    );
    expect(breezewayConns).toHaveLength(3);
  });

  it('populates placed clues across every node with unique labels totaling 10 (Packet 15-C §2)', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    const nodeDefs = normalized.topology.nodeDefinitions || [];
    expect(nodeDefs).toHaveLength(7);

    const allClueLabels: string[] = [];
    for (const node of nodeDefs) {
      expect(node.clues).toBeDefined();
      expect(Array.isArray(node.clues)).toBe(true);
      expect(node.clues!.length).toBeGreaterThanOrEqual(1);
      expect(node.clues!.length).toBeLessThanOrEqual(3);
      for (const clue of node.clues!) {
        expect(clue.id.length).toBeGreaterThan(0);
        expect(clue.label.length).toBeGreaterThan(0);
        allClueLabels.push(clue.label);
      }
    }

    expect(allClueLabels).toHaveLength(10);
    const uniqueNormalized = new Set(
      allClueLabels.map((l) => l.trim().replace(/\s+/g, ' ').toLowerCase())
    );
    expect(uniqueNormalized.size).toBe(10);
  });

  it('guarantees bidirectional 1:1 match between DISCOVERY milestones and placed clues (Packet 15-C §3)', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    const nodeDefs = normalized.topology.nodeDefinitions || [];
    const placedClueLabels = new Set<string>();
    for (const node of nodeDefs) {
      for (const clue of node.clues || []) {
        placedClueLabels.add(clue.label.trim().replace(/\s+/g, ' ').toLowerCase());
      }
    }
    expect(placedClueLabels.size).toBe(10);

    const milestones = normalized.dramaticSpine?.milestoneConditions || [];
    const discoveryMilestones = milestones.filter((m) => m.kind === 'DISCOVERY');
    expect(discoveryMilestones).toHaveLength(10);

    const referencedClueLabels = new Map<string, number>();
    for (const milestone of discoveryMilestones) {
      expect(milestone.referenceId).toBeDefined();
      const normRef = milestone.referenceId!.trim().replace(/\s+/g, ' ').toLowerCase();
      // Every DISCOVERY milestone's referenceId matches a placed clue label
      expect(placedClueLabels.has(normRef)).toBe(true);
      referencedClueLabels.set(normRef, (referencedClueLabels.get(normRef) || 0) + 1);
    }

    // Every placed clue label is referenced by exactly one DISCOVERY milestone
    for (const label of placedClueLabels) {
      expect(referencedClueLabels.get(label)).toBe(1);
    }
  });

  it('defines exactly two non-empty distraction tells for every cast member (Packet 15-C §4)', () => {
    const normalized = normalizeBlueprint(starlightMotel);
    expect(normalized.cast).toHaveLength(5);
    for (const member of normalized.cast) {
      expect(member.distractionTells).toBeDefined();
      expect(Array.isArray(member.distractionTells)).toBe(true);
      expect(member.distractionTells).toHaveLength(2);
      for (const tell of member.distractionTells!) {
        expect(typeof tell).toBe('string');
        expect(tell.trim().length).toBeGreaterThan(0);
        expect(tell.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it('passes validateForgeDraft with zero errors (Packet 15-C §5)', () => {
    const result = validateForgeDraft(starlightMotel);
    expect(result.errors).toEqual({});
    expect(Object.keys(result.errors)).toHaveLength(0);
  });
});
