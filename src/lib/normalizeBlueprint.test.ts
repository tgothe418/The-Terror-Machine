import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { normalizeBlueprint } from './normalizeBlueprint';
import { Blueprint, BlueprintSchema } from '../types';

describe('normalizeBlueprint', () => {
  it('normalizes string-formatted topology connections', () => {
    const raw = {
      title: 'Haunted Mansion',
      globalPremise: 'Escape the manor.',
      topology: {
        nodes: ['FOYER', 'LIBRARY', 'CELLAR'],
        connections: ['FOYER -> LIBRARY', 'LIBRARY -> CELLAR'],
      },
    };

    const normalized: Blueprint = normalizeBlueprint(raw);
    const parsed = BlueprintSchema.parse(normalized);

    expect(parsed.title).toBe('Haunted Mansion');
    expect(parsed.premise).toBe('Escape the manor.');
    expect(parsed.topology.connections).toHaveLength(2);
    expect(parsed.topology.connections[0]).toEqual({
      from: 'FOYER',
      to: 'LIBRARY',
      kind: 'PHYSICAL',
      userInitiated: true,
      legacyUpgraded: true,
    });
    expect(parsed.topology.connections[0].from).toBe('FOYER');
    expect(parsed.topology.connections[0].to).toBe('LIBRARY');
    expect(parsed.topology.connections[0].kind).toBe('PHYSICAL');
    expect(parsed.topology.connections[0].userInitiated).toBe(true);
    expect(parsed.topology.connections[0].legacyUpgraded).toBe(true);
  });

  it('canonicalizes connection kind variations and infers default userInitiated based on canonical kind', () => {
    const raw = {
      identity: { title: 'Labyrinth' },
      topology: {
        nodes: ['A', 'B', 'C'],
        connections: [
          { from: 'A', to: 'B', kind: 'spatial' },
          { from: 'B', to: 'C', kind: 'narrative' },
          { from: 'C', to: 'A', kind: 'UNKNOWN_KIND' },
        ],
      },
    };

    const normalized: Blueprint = normalizeBlueprint(raw);
    const parsed = BlueprintSchema.parse(normalized);
    expect(parsed.topology.connections[0].kind).toBe('PHYSICAL');
    expect(parsed.topology.connections[0].userInitiated).toBe(true);
    expect(parsed.topology.connections[1].kind).toBe('FORCED_EVENT');
    expect(parsed.topology.connections[1].userInitiated).toBe(false);
    expect(parsed.topology.connections[2].kind).toBe('PHYSICAL');
    expect(parsed.topology.connections[2].userInitiated).toBe(true);
    expect(parsed.identity.title).toBe('Labyrinth');
  });

  it('preserves explicitly authored userInitiated boolean values regardless of kind', () => {
    const raw = {
      identity: { title: 'Explicit Intent' },
      topology: {
        nodes: ['N1', 'N2', 'N3'],
        connections: [
          { from: 'N1', to: 'N2', kind: 'PHYSICAL', userInitiated: false },
          { from: 'N2', to: 'N3', kind: 'FORCED_EVENT', userInitiated: true },
          { from: 'N3', to: 'N1', kind: 'MEMORY_RECONSTRUCTION', userInitiated: true },
        ],
      },
    };

    const normalized: Blueprint = normalizeBlueprint(raw);
    const parsed = BlueprintSchema.parse(normalized);
    expect(parsed.topology.connections[0].kind).toBe('PHYSICAL');
    expect(parsed.topology.connections[0].userInitiated).toBe(false);
    expect(parsed.topology.connections[1].kind).toBe('FORCED_EVENT');
    expect(parsed.topology.connections[1].userInitiated).toBe(true);
    expect(parsed.topology.connections[2].kind).toBe('MEMORY_RECONSTRUCTION');
    expect(parsed.topology.connections[2].userInitiated).toBe(true);
  });

  it('extracts protagonist ID from legacy perspectives structure', () => {
    const raw = {
      identity: { title: 'Test Scenario' },
      perspectives: [
        { role: 'WITNESS', subjectCharacterId: 'char_witness' },
        { role: 'PROTAGONIST', subjectCharacterId: 'char_protagonist' },
      ],
    };

    const normalized: Blueprint = normalizeBlueprint(raw);
    const parsed = BlueprintSchema.parse(normalized);
    expect(parsed.userCharacterId).toBe('char_protagonist');
  });

  it('fails safely through validation for non-object roots like null and arrays', () => {
    expect(() => normalizeBlueprint(null)).toThrow(ZodError);
    expect(() => normalizeBlueprint([])).toThrow(ZodError);
    expect(() => normalizeBlueprint('string-input')).toThrow(ZodError);
    expect(() => normalizeBlueprint(12345)).toThrow(ZodError);
  });

  it('rejects explicitly malformed non-boolean userInitiated values', () => {
    const raw = {
      identity: { title: 'Malformed Intent' },
      topology: {
        nodes: ['N1', 'N2'],
        connections: [{ from: 'N1', to: 'N2', kind: 'PHYSICAL', userInitiated: 'not-a-boolean' }],
      },
    };

    expect(() => normalizeBlueprint(raw)).toThrow(ZodError);
  });

  it('applies canonical schema defaults on legacy input with missing sections', () => {
    const raw = {
      title: 'Minimal Enclosure',
    };

    const result: Blueprint = normalizeBlueprint(raw);
    expect(result.identity.title).toBe('Minimal Enclosure');
    expect(result.identity.version).toBe('1.0');
    expect(result.setting.location).toBe('Unknown');
    expect(result.setting.timePeriod).toBe('Present');
    expect(result.contentScale).toBe(3);
    expect(result.cast).toHaveLength(1);
    expect(result.topology.nodes).toEqual([]);
    expect(result.topology.connections).toEqual([]);
  });

  describe('explicit malformed field rejection (ZodError)', () => {
    it.each([
      ['identity: 42', { identity: 42 }],
      ['identity: []', { identity: [] }],
      [
        'identity: { title: 42 } with valid top-level title',
        { title: 'Valid Title', identity: { title: 42 } },
      ],
      ['topology: "bad"', { topology: 'bad' }],
      ['topology: null', { topology: null }],
      ['topology: { connections: "bad" }', { topology: { connections: 'bad' } }],
      ['userCharacterId: 99', { userCharacterId: 99 }],
      ['title: 99', { title: 99 }],
      ['premise: { bad: true }', { premise: { bad: true } }],
      ['globalPremise: 99', { globalPremise: 99 }],
      [
        'connection kind: 42',
        { topology: { connections: [{ from: 'A', to: 'B', kind: 42, userInitiated: true }] } },
      ],
      [
        'connection kind: null',
        { topology: { connections: [{ from: 'A', to: 'B', kind: null, userInitiated: true }] } },
      ],
    ])('rejects explicitly malformed %s', (_, raw) => {
      expect(() => normalizeBlueprint(raw)).toThrow(ZodError);
    });
  });

  describe('undefined treated as missing with positive fallbacks', () => {
    it('falls back to valid top-level title when identity is undefined', () => {
      const raw = {
        title: 'Legacy Title',
        identity: undefined,
      };
      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.identity.title).toBe('Legacy Title');
      expect(result.title).toBe('Legacy Title');
    });

    it('falls back to valid identity.title when top-level title is undefined', () => {
      const raw = {
        identity: { title: 'Identity Title' },
        title: undefined,
      };
      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.identity.title).toBe('Identity Title');
      expect(result.title).toBe('Identity Title');
    });

    it('falls back to valid globalPremise when premise is undefined', () => {
      const raw = {
        globalPremise: 'Global Premise',
        premise: undefined,
      };
      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.premise).toBe('Global Premise');
    });

    it('falls back to valid premise when globalPremise is undefined', () => {
      const raw = {
        premise: 'Legacy Premise',
        globalPremise: undefined,
      };
      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.premise).toBe('Legacy Premise');
    });

    it('extracts legacy protagonist when userCharacterId is explicitly undefined', () => {
      const raw = {
        userCharacterId: undefined,
        perspectives: [
          { role: 'WITNESS', subjectCharacterId: 'char_witness' },
          { role: 'PROTAGONIST', subjectCharacterId: 'char_hero' },
        ],
      };
      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.userCharacterId).toBe('char_hero');
    });

    it('receives canonical topology defaults when topology is undefined', () => {
      const raw = {
        title: 'Undefined Topology Enclosure',
        topology: undefined,
      };
      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.topology.nodes).toEqual([]);
      expect(result.topology.connections).toEqual([]);
    });

    it('receives empty array when topology.connections is undefined', () => {
      const raw = {
        title: 'Undefined Connections Enclosure',
        topology: {
          nodes: ['ROOM_1'],
          connections: undefined,
        },
      };
      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.topology.nodes).toEqual(['ROOM_1']);
      expect(result.topology.connections).toEqual([]);
    });

    it('derives nodes array strictly from nodeDefinitions in rich topology without falling back startingNodeId to nodes[0]', () => {
      const raw = {
        title: 'Subglacial Research Base',
        premise: 'Permafrost core extraction.',
        topology: {
          nodeDefinitions: [
            { id: 'SURFACE_DOCK', label: 'Surface Dock', description: 'Wind-swept snow landing pad.' },
            { id: 'ICE_TUNNEL', label: 'Ice Tunnel', description: 'Narrow excavated corridor.' },
          ],
          // startingNodeId is omitted in rich topology
          connections: [{ from: 'SURFACE_DOCK', to: 'ICE_TUNNEL', kind: 'PHYSICAL' }],
        },
      };

      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.topology.nodes).toEqual(['SURFACE_DOCK', 'ICE_TUNNEL']);
      expect(result.topology.nodeDefinitions).toHaveLength(2);
      expect(result.topology.startingNodeId).toBeUndefined();
    });

    it('falls back startingNodeId to nodes[0] for legacy flat topology with no nodeDefinitions', () => {
      const raw = {
        title: 'Old Bunker',
        premise: 'Survival test.',
        topology: {
          nodes: ['BUNKER_ENTRY', 'AIRLOCK'],
          connections: [{ from: 'BUNKER_ENTRY', to: 'AIRLOCK', kind: 'PHYSICAL' }],
        },
      };

      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.topology.nodes).toEqual(['BUNKER_ENTRY', 'AIRLOCK']);
      expect(result.topology.startingNodeId).toBe('BUNKER_ENTRY');
    });

    it('synthesizes a default antagonistProfile with apparatus controls and prey cohort for legacy blueprints', () => {
      const raw = {
        title: 'Forgotten Facility',
        premise: 'Escape from containment.',
        topology: {
          nodes: ['LAB_A', 'LAB_B'],
          connections: [{ from: 'LAB_A', to: 'LAB_B', kind: 'PHYSICAL' }],
        },
        cast: [
          { id: 'c1', name: 'Survivor Anna', role: 'Engineer', isEntity: false },
          { id: 'c2', name: 'Autonomous Drone', role: 'Security Unit', isEntity: true },
        ],
      };

      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.antagonistProfile).toBeDefined();
      expect(result.antagonistProfile?.name).toBe('Autonomous Drone');
      expect(result.antagonistProfile?.apparatusControls.length).toBeGreaterThan(0);
      expect(result.antagonistProfile?.preyCohort).toHaveLength(1);
      expect(result.antagonistProfile?.preyCohort[0].name).toBe('Survivor Anna');
      expect(result.antagonistProfile?.telemetryFeeds).toHaveLength(2);
      expect(result.antagonistProfile?.sadisticDirectives.length).toBeGreaterThan(0);
    });

    it('preserves an explicitly authored antagonistProfile', () => {
      const raw = {
        title: 'Cyber Enclosure',
        premise: 'AM is watching.',
        topology: { nodes: ['CORE'], connections: [] },
        antagonistProfile: {
          kind: 'FORCE',
          name: 'Allied Mastercomputer',
          apparatusControls: [
            {
              id: 'elevator-crush',
              name: 'Gravitational Inversion Elevator',
              affectedNodeIds: ['CORE'],
              kind: 'HYDRAULICS',
              availableActions: ['INVERT_GRAVITY', 'CRUSH'],
              status: 'ONLINE',
            },
          ],
          preyCohort: [
            {
              id: 'p1',
              name: 'Gorrister',
              vulnerabilities: ['Suicidal Guilt'],
              psychologicalTriggers: ['Reminders of his wife'],
              breakingPoint: 'Complete despair',
              initialNodeId: 'CORE',
            },
          ],
          sadisticDirectives: ['Hate. Let me tell you how much I have come to hate you.'],
          telemetryFeeds: [
            {
              nodeId: 'CORE',
              feedType: 'OPTICAL_CAM',
              status: 'ONLINE',
              label: 'Omnipresent Eye',
            },
          ],
        },
      };

      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.antagonistProfile?.name).toBe('Allied Mastercomputer');
      expect(result.antagonistProfile?.kind).toBe('FORCE');
      expect(result.antagonistProfile?.apparatusControls[0].id).toBe('elevator-crush');
      expect(result.antagonistProfile?.preyCohort[0].name).toBe('Gorrister');
      expect(result.antagonistProfile?.sadisticDirectives[0]).toContain('Hate.');
    });
  });

  describe('nodeDefinitions with clues (Discovery series 2/6)', () => {
    it('normalizes node definitions carrying placed clues and trims clue labels', () => {
      const raw = {
        title: 'Clue Test Manor',
        premise: 'Find the clues.',
        topology: {
          nodes: ['STUDY', 'HALL'],
          nodeDefinitions: [
            {
              id: 'STUDY',
              label: 'The Study',
              clues: [
                { id: 'clue-cipher', label: '  Torn Cipher Fragment  ' },
                { id: 'clue-blood', label: 'Blood on the Blotter' },
              ],
            },
            {
              id: 'HALL',
              label: 'The Grand Hall',
            },
          ],
          connections: [],
        },
      };

      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.topology.nodeDefinitions).toHaveLength(2);
      expect(result.topology.nodeDefinitions[0].clues).toEqual([
        { id: 'clue-cipher', label: 'Torn Cipher Fragment' },
        { id: 'clue-blood', label: 'Blood on the Blotter' },
      ]);
      expect(result.topology.nodeDefinitions[1].clues).toBeUndefined();
    });

    it('validates node definitions without clues identically to prior behavior', () => {
      const raw = {
        title: 'Plain Manor',
        premise: 'No clues authored.',
        topology: {
          nodes: ['FOYER'],
          nodeDefinitions: [
            {
              id: 'FOYER',
              label: 'The Foyer',
            },
          ],
          connections: [],
        },
      };

      const result: Blueprint = normalizeBlueprint(raw);
      expect(result.topology.nodeDefinitions[0].clues).toBeUndefined();
      expect(result.topology.nodeDefinitions[0].id).toBe('FOYER');
      expect(result.topology.nodeDefinitions[0].label).toBe('The Foyer');
    });
  });
});

