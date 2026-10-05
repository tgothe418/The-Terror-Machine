import { describe, it, expect } from 'vitest';
import { BlueprintSchema } from '../../types';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';
import { resolveSeatAvailabilities } from '../../lib/seatAvailability';
import { buildCharacterPresence } from '../../lib/castPresence';
import { DramaticSpineSchema } from '../../types/dramaturgy';
import silverRestLodge from './silver_rest_lodge.json';

describe('Bespoke Test Blueprint: The Silver Rest Lodge', () => {
  it('validates cleanly against BlueprintSchema and normalizeBlueprint', () => {
    const normalized = normalizeBlueprint(silverRestLodge);
    expect(normalized.title).toBe('The Silver Rest Lodge');
    const parsed = BlueprintSchema.parse(normalized);
    expect(parsed.id).toBe('blueprint-silver-rest-lodge');
    expect(parsed.topology.nodeDefinitions).toHaveLength(7);
    expect(parsed.cast).toHaveLength(8);
    expect(parsed.depictionContract?.dramaticRegister).toContain('polite company');
  });

  it('authors the full role semantics: villain, survivors, and bystanders', () => {
    const normalized = normalizeBlueprint(silverRestLodge);
    const dispositions = normalized.cast.map((c) => c.disposition);
    expect(dispositions.filter((d: string) => d === 'VILLAIN')).toHaveLength(1);
    expect(dispositions.filter((d: string) => d === 'SURVIVOR')).toHaveLength(5);
    expect(dispositions.filter((d: string) => d === 'BYSTANDER')).toHaveLength(2);
  });

  it('carries voice dossiers and psychological stakes on every cast member', () => {
    const normalized = normalizeBlueprint(silverRestLodge);
    for (const member of normalized.cast) {
      expect(member.expressionProfile).toBeDefined();
      expect(member.expressionProfile?.expressionGuidance.length).toBeGreaterThan(0);
      expect(member.psychologicalStakes).toBeDefined();
      expect(member.psychologicalStakes?.breakingPointTrigger.length).toBeGreaterThan(0);
    }
    const villain = normalized.cast.find((c) => c.disposition === 'VILLAIN');
    expect(villain?.expressionProfile?.camouflageLeakGuidance).toContain('climax');
  });

  it('parses the dramatic spine with both clock advance modes and all milestone kinds', () => {
    const normalized = normalizeBlueprint(silverRestLodge);
    const spine = DramaticSpineSchema.parse(normalized.dramaticSpine);
    expect(spine.impendingClocks.map((c) => c.advanceMode.mode)).toEqual([
      'TIME',
      'EVENT',
      'TIME',
    ]);
    expect(spine.milestoneConditions.map((m) => m.kind)).toEqual([
      'DISCOVERY',
      'CLOCK_CRISIS',
      'COMPOSURE_THRESHOLD',
      'AUTHORED_TRIGGER',
    ]);
    const boiler = spine.impendingClocks.find((c) => c.id === 'boiler_failure');
    expect(boiler?.diegeticInstrument).toContain('Boiler Gauge');
    expect(boiler?.instrumentNodeId).toBe('boiler_room');
  });

  it('resolves valid seats for all three participation roles', () => {
    const normalized = normalizeBlueprint(silverRestLodge);
    const seats = resolveSeatAvailabilities(normalized);
    expect(seats.protagonist.available).toBe(true);
    expect(seats.antagonist.available).toBe(true);
    expect(seats.director.available).toBe(false);
    expect(seats.director.reason).toBe('Director mode is not yet built.');
  });

  it('resolves co-present cast (HERE) at every authored placement node', () => {
    // Regression guard for the invisible-co-present defect: placements must
    // resolve against topology node ids so presence marks cast as HERE.
    const normalized = normalizeBlueprint(silverRestLodge);
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

    expect(presenceAt('grand_lobby')).toEqual(
      expect.arrayContaining(['char-nadia-okafor', 'char-laurent-moreau'])
    );
    expect(presenceAt('dining_hall')).toContain('char-elias-vann');
    expect(presenceAt('kitchen')).toEqual(
      expect.arrayContaining(['char-marta-kowalczyk', 'char-deniz-aydin'])
    );
    expect(presenceAt('generator_shed')).toContain('char-tomas-reyes');
    expect(presenceAt('upper_corridor')).toContain('char-priya-anand');
    expect(presenceAt('wine_cellar')).toEqual([]);

    // Every placed cast member is HERE somewhere; only the OFFSTAGE officer is not.
    const somewhereHere = nodeIds.flatMap((nodeId) => presenceAt(nodeId));
    expect(somewhereHere).not.toContain('char-wren-addler');
    for (const member of normalized.cast) {
      if (member.presenceDisposition?.kind !== 'OFFSTAGE') {
        expect(
          somewhereHere,
          `${member.id} must be present at its authored node`
        ).toContain(member.id);
      }
    }
  });
});
