import { describe, it, expect } from 'vitest';
import { BlueprintSchema } from '../../types';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';
import { resolveSeatAvailabilities } from '../../lib/seatAvailability';
import { buildCharacterPresence } from '../../lib/castPresence';
import { DramaticSpineSchema } from '../../types/dramaturgy';
import type { ParticipationMode } from '../../types/participation';
import theRefinement from './the_refinement.json';

describe('Bespoke Test Blueprint: The Refinement', () => {
  it('validates cleanly against BlueprintSchema and normalizeBlueprint', () => {
    const normalized = normalizeBlueprint(theRefinement);
    expect(normalized.title).toBe('The Refinement');
    const parsed = BlueprintSchema.parse(normalized);
    expect(parsed.id).toBe('blueprint-the-refinement');
    expect(parsed.topology.nodeDefinitions).toHaveLength(8);
    expect(parsed.cast).toHaveLength(8);
    expect(parsed.depictionContract?.dramaticRegister).toContain('New French Extreme');
  });

  it('authors the full role semantics: two villains, five survivors, one bystander', () => {
    const normalized = normalizeBlueprint(theRefinement);
    const dispositions = normalized.cast.map((c) => c.disposition);
    expect(dispositions.filter((d: string) => d === 'VILLAIN')).toHaveLength(2);
    expect(dispositions.filter((d: string) => d === 'SURVIVOR')).toHaveLength(5);
    expect(dispositions.filter((d: string) => d === 'BYSTANDER')).toHaveLength(1);
  });

  it('carries voice dossiers and psychological stakes on every cast member', () => {
    const normalized = normalizeBlueprint(theRefinement);
    for (const member of normalized.cast) {
      expect(member.expressionProfile).toBeDefined();
      expect(member.expressionProfile?.expressionGuidance.length).toBeGreaterThan(0);
      expect(member.psychologicalStakes).toBeDefined();
      expect(member.psychologicalStakes?.breakingPointTrigger.length).toBeGreaterThan(0);
    }
    const villain = normalized.cast.find((c) => c.id === 'char-aleksander-morel');
    expect(villain?.expressionProfile?.camouflageLeakGuidance).toContain('operational');
  });

  it('applies contentScale 5 and extreme content descriptor', () => {
    const normalized = normalizeBlueprint(theRefinement);
    const parsed = BlueprintSchema.parse(normalized);
    expect(parsed.contentScale).toBe(5);
    expect(parsed.contentLevelDescription).toContain('Extreme');
  });

  it('parses the dramatic spine with clocks across TIME and EVENT modes', () => {
    const normalized = normalizeBlueprint(theRefinement);
    const spine = DramaticSpineSchema.parse(normalized.dramaticSpine);
    const modes = spine.impendingClocks.map((c) => c.advanceMode.mode);
    expect(modes).toContain('TIME');
    expect(modes).toContain('EVENT');
    expect(spine.milestoneConditions).toHaveLength(4);
    expect(spine.milestoneConditions.map((m) => m.kind)).toEqual([
      'DISCOVERY',
      'AUTHORED_TRIGGER',
      'AUTHORED_TRIGGER',
      'AUTHORED_TRIGGER',
    ]);
    const sessionClock = spine.impendingClocks.find((c) => c.id === 'session_countdown');
    expect(sessionClock?.diegeticInstrument).toContain('Session Clock');
    expect(sessionClock?.instrumentNodeId).toBe('session_room');
    const groupClock = spine.impendingClocks.find((c) => c.id === 'group_coherence');
    expect(groupClock?.domain).toBe('BEHAVIORAL');
  });

  it('resolves valid seats for all three participation roles', () => {
    const normalized = normalizeBlueprint(theRefinement);
    const seats = resolveSeatAvailabilities(normalized);
    expect(seats.protagonist.available).toBe(true);
    expect(seats.antagonist.available).toBe(true);
    expect(seats.director.available).toBe(false);
    expect(seats.director.reason).toBe('Director mode is not yet built.');
  });

  it('resolves co-present cast (HERE) at every authored placement node', () => {
    const normalized = normalizeBlueprint(theRefinement);
    const nodeIds: string[] = normalized.topology.nodes;

    const presenceAt = (nodeId: string): string[] => {
      const presence = buildCharacterPresence(
        normalized.cast,
        null,
        nodeIds,
        nodeId,
        null
      );
      return Object.entries(presence)
        .filter(([, p]) => (p as { nodeId: string }).nodeId === nodeId)
        .map(([id]) => id);
    };

    // Villain anchor: Director in his office
    expect(presenceAt('director_office')).toContain('char-aleksander-morel');
    // Staff anchor: Curator in the processing corridor
    expect(presenceAt('processing_corridor')).toContain('char-curator-havel');
    // Cell Block A: three captives
    expect(presenceAt('cell_block_a')).toEqual(
      expect.arrayContaining([
        'char-sable-voss',
        'char-theo-marchetti',
        'char-louisa-fenn',
      ])
    );
    // Cell Block B: two captives
    expect(presenceAt('cell_block_b')).toEqual(
      expect.arrayContaining(['char-rue-decatur', 'char-piotr-zasada'])
    );
    // Observer Lounge: Birkenfeld
    expect(presenceAt('observer_lounge')).toContain('char-observer-birkenfeld');

    // Every placed cast member is HERE somewhere
    const somewhereHere = nodeIds.flatMap((nodeId) => presenceAt(nodeId));
    for (const member of normalized.cast) {
      if (member.presenceDisposition?.kind !== 'OFFSTAGE') {
        expect(
          somewhereHere,
          `${member.id} must be present at its authored node`
        ).toContain(member.id);
      }
    }
  });

  it('constructs valid participation contexts and victim fields that pass TurnRequest validation for all roles', async () => {
    const { buildActiveParticipationContext } = await import('../../lib/seatAvailability');
    const { ParticipationContextSchema } = await import('../../types/participation');
    const normalized = normalizeBlueprint(theRefinement);
    const roles: readonly ParticipationMode[] = ['protagonist', 'antagonist', 'director', 'survivor', 'villain'] as const;

    for (const role of roles) {
      const participationContext = buildActiveParticipationContext(normalized, role);
      const parsedContext = ParticipationContextSchema.safeParse(participationContext);
      expect(parsedContext.success, `Role ${role} participationContext must be valid: ${JSON.stringify(parsedContext.error?.issues)}`).toBe(true);
    }
  });
});
