import { describe, it, expect } from 'vitest';
import { BlueprintSchema } from '../../types';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';
import { resolveSeatAvailabilities } from '../../lib/seatAvailability';
import { buildCharacterPresence } from '../../lib/castPresence';
import { DramaticSpineSchema } from '../../types/dramaturgy';
import blackIronMortuary from './black_iron_mortuary.json';

describe('Canonical Scenario Blueprint: The Black Iron Mortuary (HG2 Fueled)', () => {
  it('validates cleanly against BlueprintSchema and normalizeBlueprint', () => {
    const normalized = normalizeBlueprint(blackIronMortuary);
    expect(normalized.title).toBe('The Black Iron Mortuary');
    const parsed = BlueprintSchema.parse(normalized);
    expect(parsed.id).toBe('blueprint-black-iron-mortuary');
    expect(parsed.topology.nodeDefinitions).toHaveLength(5);
    expect(parsed.cast).toHaveLength(3);
    expect(parsed.depictionContract?.dramaticRegister).toContain('Forensic visceral horror');
  });

  it('authors explicit role semantics across all cast members', () => {
    const normalized = normalizeBlueprint(blackIronMortuary);
    const dispositions = normalized.cast.map((c) => c.disposition);
    expect(dispositions.filter((d: string) => d === 'SURVIVOR')).toHaveLength(2);
    expect(dispositions.filter((d: string) => d === 'VILLAIN')).toHaveLength(1);
    
    const entity = normalized.cast.find((c) => c.id === 'char-entity-41');
    expect(entity?.isEntity).toBe(true);
    expect(entity?.disposition).toBe('VILLAIN');
    expect(entity?.behaviorVector).toBe('PREDATORY');
  });

  it('carries voice dossiers and psychological stakes on every cast member', () => {
    const normalized = normalizeBlueprint(blackIronMortuary);
    for (const member of normalized.cast) {
      expect(member.expressionProfile).toBeDefined();
      expect(member.expressionProfile?.expressionGuidance.length).toBeGreaterThan(0);
      expect(member.psychologicalStakes).toBeDefined();
      expect(member.psychologicalStakes?.breakingPointTrigger.length).toBeGreaterThan(0);
      expect(member.psychologicalStakes?.coreDesireOrNeed.length).toBeGreaterThan(0);
    }
    const entity = normalized.cast.find((c) => c.id === 'char-entity-41');
    expect(entity?.expressionProfile?.communicationModes).toContain('mediated');
    expect(entity?.expressionProfile?.lexiconNotes).toContain('Non-verbal');

    const ross = normalized.cast.find((c) => c.id === 'char-maren-ross');
    expect(ross?.psychologicalStakes?.liftConditions).toHaveLength(1);
    expect(ross?.psychologicalStakes?.liftConditions[0].kind).toBe('MEDICAL_STABILIZATION');
  });

  it('parses the dramatic spine with RELENTLESS_PURSUIT and impending clocks', () => {
    const normalized = normalizeBlueprint(blackIronMortuary);
    expect(normalized.dramaticSpine).toBeDefined();
    const spine = DramaticSpineSchema.parse(normalized.dramaticSpine);
    expect(spine.pacingProfile).toBe('RELENTLESS_PURSUIT');
    expect(spine.thematicPremise).toContain('apparatus');
    expect(spine.dramaticQuestions).toHaveLength(3);
    expect(spine.milestoneConditions).toHaveLength(4);
    expect(spine.impendingClocks).toHaveLength(2);

    const hydraulicClock = spine.impendingClocks.find((c) => c.id === 'bulkhead_hydraulic_decay');
    expect(hydraulicClock).toBeDefined();
    expect(hydraulicClock?.domain).toBe('STRUCTURAL');
    expect(hydraulicClock?.advanceMode.mode).toBe('TIME');
    expect(hydraulicClock?.diegeticInstrument).toContain('Bulkhead Pressure Gauge');

    const shockClock = spine.impendingClocks.find((c) => c.id === 'holt_somatic_shock');
    expect(shockClock).toBeDefined();
    expect(shockClock?.domain).toBe('SOMATIC');
    expect(shockClock?.advanceMode.mode).toBe('TIME');
    expect(shockClock?.diegeticInstrument).toContain('Forearm');
  });

  it('populates reviewed HG1 valueAnchors and characterPursuits', () => {
    const normalized = normalizeBlueprint(blackIronMortuary);
    expect(normalized.horrorGrammar).toBeDefined();
    expect(normalized.horrorGrammar?.valueBaselineReview).toBe('REVIEWED');
    expect(normalized.horrorGrammar?.valueAnchors).toHaveLength(4);
    expect(normalized.horrorGrammar?.characterPursuits).toHaveLength(3);

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

    expect(normalized.horrorGrammar?.pursuitReviews?.['char-maren-ross']).toBe('REVIEWED');
    expect(normalized.horrorGrammar?.pursuitReviews?.['char-marcus-holt']).toBe('REVIEWED');
    expect(normalized.horrorGrammar?.pursuitReviews?.['char-entity-41']).toBe('REVIEWED');
  });

  it('resolves valid seats for Protagonist, Antagonist, and Director participation', () => {
    const normalized = normalizeBlueprint(blackIronMortuary);
    const seats = resolveSeatAvailabilities(normalized);
    expect(seats.protagonist.available).toBe(true);
    expect(seats.antagonist.available).toBe(true);
    expect(seats.director.available).toBe(false);
    expect(seats.director.reason).toBe('Director mode is not yet built.');
  });

  it('binds Entity-41 apparatus controls and prey cohort into Antagonist participation context', async () => {
    const { buildActiveParticipationContext } = await import('../../lib/seatAvailability');
    const normalized = normalizeBlueprint(blackIronMortuary);
    expect(normalized.antagonistProfile).toBeDefined();
    expect(normalized.antagonistProfile?.name).toBe('Entity-41 (The Suture Apparatus)');
    expect(normalized.antagonistProfile?.apparatusControls).toHaveLength(4);
    expect(normalized.antagonistProfile?.preyCohort).toHaveLength(2);

    const context = buildActiveParticipationContext(normalized, 'antagonist');
    expect(context).not.toBeNull();
    expect(context?.mode).toBe('antagonist');
    expect(context?.authorityContract?.authority).toContain('Authorized to actuate facility apparatus');
    expect(context?.authorityContract?.limits).toContain('Preserve physiological viability');
    expect(context?.victimField?.kind).toBe('group');
    if (context?.victimField?.kind === 'group') {
      expect(context.victimField.members).toHaveLength(2);
      expect(context.victimField.members[0].name).toBe('Dr. Maren Ross');
      expect(context.victimField.members[1].name).toBe('Officer Marcus Holt');
    }
  });

  it('builds initial character presences at correct starting nodes', () => {
    const normalized = normalizeBlueprint(blackIronMortuary);
    const nodeIds: string[] = normalized.topology.nodes;
    const presences = buildCharacterPresence(
      normalized.cast,
      null,
      nodeIds,
      'autopsy_suite_b',
      'char-maren-ross'
    );
    expect(presences['char-maren-ross']?.nodeId).toBe('autopsy_suite_b');
    expect(presences['char-marcus-holt']?.nodeId).toBe('decompression_airlock');
    expect(presences['char-entity-41']?.nodeId).toBe('specimen_freezer');
  });
});

