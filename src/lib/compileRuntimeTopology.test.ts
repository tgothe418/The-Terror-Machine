import { describe, expect, it } from 'vitest';
import { compileRuntimeTopology } from './compileRuntimeTopology';

describe('compileRuntimeTopology', () => {
  it('compiles authored nodes and directional connections into SpatialNode[] graph', () => {
    const topology = {
      nodes: ['FOYER', 'LIBRARY', 'CELLAR'],
      connections: [
        {
          from: 'FOYER',
          to: 'LIBRARY',
          kind: 'PHYSICAL' as const,
          requires: ['BRASS_KEY'],
          userInitiated: true,
        },
        {
          from: 'LIBRARY',
          to: 'FOYER',
          kind: 'PHYSICAL' as const,
          userInitiated: true,
        },
        {
          from: 'LIBRARY',
          to: 'CELLAR',
          kind: 'FORCED_EVENT' as const,
          userInitiated: false,
        },
      ],
    };

    const result = compileRuntimeTopology({ topology });
    expect(result.startNodeId).toBe('FOYER');
    expect(result.spatialGraph).toHaveLength(3);

    const foyer = result.spatialGraph.find((n) => n.id === 'FOYER');
    expect(foyer).toBeDefined();
    expect(foyer?.connectedNodes).toEqual(['LIBRARY']);
    expect(foyer?.exits).toHaveLength(1);
    expect(foyer?.exits[0]).toEqual({
      targetNodeId: 'LIBRARY',
      description: 'LIBRARY',
      isOpen: true,
      kind: 'PHYSICAL',
      requires: ['BRASS_KEY'],
      userInitiated: true,
    });

    const library = result.spatialGraph.find((n) => n.id === 'LIBRARY');
    expect(library?.connectedNodes).toEqual(['FOYER', 'CELLAR']);
    expect(library?.exits).toHaveLength(2);
    expect(library?.exits[1].userInitiated).toBe(false);

    const cellar = result.spatialGraph.find((n) => n.id === 'CELLAR');
    expect(cellar?.connectedNodes).toEqual([]);
    expect(cellar?.exits).toEqual([]);
  });

  it('preserves authored labels and descriptions from nodeDefinitions and respects explicit startingNodeId', () => {
    const topology = {
      startingNodeId: 'CRYPTO_VAULT',
      nodes: ['ATRIUM', 'CRYPTO_VAULT'],
      nodeDefinitions: [
        {
          id: 'ATRIUM',
          label: 'Central Atrium',
          description: 'Soaring glass arches covered in frost.',
        },
        {
          id: 'CRYPTO_VAULT',
          label: 'Subterranean Vault',
          description: 'Heavy reinforced pressure doors and humming servers.',
        },
      ],
      connections: [
        {
          from: 'CRYPTO_VAULT',
          to: 'ATRIUM',
          kind: 'PHYSICAL' as const,
          userInitiated: true,
        },
      ],
      anchors: [
        {
          id: 'vault-vent',
          parentNodeId: 'CRYPTO_VAULT',
          label: 'Vault Vent Line',
          description: 'Secondary air duct.',
          statement: 'Not a runtime node yet',
        },
      ],
    };

    const result = compileRuntimeTopology({ topology });
    expect(result.startNodeId).toBe('CRYPTO_VAULT');
    expect(result.spatialGraph).toHaveLength(2);

    const vault = result.spatialGraph.find((n) => n.id === 'CRYPTO_VAULT');
    expect(vault?.name).toBe('Subterranean Vault');
    expect(vault?.description).toBe('Heavy reinforced pressure doors and humming servers.');
    expect(vault?.connectedNodes).toEqual(['ATRIUM']);
    expect(vault?.exits).toHaveLength(1);

    const atrium = result.spatialGraph.find((n) => n.id === 'ATRIUM');
    expect(atrium?.name).toBe('Central Atrium');
    expect(atrium?.description).toBe('Soaring glass arches covered in frost.');
    // Atrium has no outgoing connection, so zero exits (no implicit reverse edge)
    expect(atrium?.connectedNodes).toEqual([]);
    expect(atrium?.exits).toEqual([]);

    // Anchors must NOT appear in the spatial graph
    const anchorNode = result.spatialGraph.find((n) => n.id === 'vault-vent');
    expect(anchorNode).toBeUndefined();
  });

  it('generates a fallback origin node when topology is empty', () => {
    const result = compileRuntimeTopology({
      topology: { nodes: [], connections: [] },
      fallbackSetting: { location: 'The Attic Observatory', atmosphere: 'Dusty and quiet' },
    });

    expect(result.startNodeId).toBe('THE_ATTIC_OBSERVATORY');
    expect(result.spatialGraph).toHaveLength(1);
    expect(result.spatialGraph[0].id).toBe('THE_ATTIC_OBSERVATORY');
    expect(result.spatialGraph[0].name).toBe('The Attic Observatory');
    expect(result.spatialGraph[0].description).toBe('Dusty and quiet');
    expect(result.spatialGraph[0].exits).toEqual([]);
  });

  it('falls back to first node for rich authored topology when explicit startingNodeId is missing', () => {
    const result = compileRuntimeTopology({
      topology: {
        nodeDefinitions: [
          { id: 'ROOM_A', label: 'Room A', description: 'Desc A' },
          { id: 'ROOM_B', label: 'Room B', description: 'Desc B' },
        ],
        connections: [],
      },
    });
    expect(result.startNodeId).toBe('ROOM_A');
  });

  it('fails closed for rich authored topology when startingNodeId is an expandable space anchor', () => {
    expect(() =>
      compileRuntimeTopology({
        topology: {
          startingNodeId: 'anchor-vent',
          nodeDefinitions: [{ id: 'ROOM_A', label: 'Room A', description: 'Desc A' }],
          anchors: [
            { id: 'anchor-vent', parentNodeId: 'ROOM_A', label: 'Vent Line' },
          ],
          connections: [],
        },
      })
    ).toThrow('Starting node ID "anchor-vent" cannot be an expandable space anchor.');
  });

  it('fails closed for rich authored topology when startingNodeId is not in node definitions', () => {
    expect(() =>
      compileRuntimeTopology({
        topology: {
          startingNodeId: 'NONEXISTENT_NODE',
          nodeDefinitions: [{ id: 'ROOM_A', label: 'Room A', description: 'Desc A' }],
          connections: [],
        },
      })
    ).toThrow('Explicit startingNodeId "NONEXISTENT_NODE" not found in topology node definitions.');
  });

  it('allows first-node fallback exclusively for legacy flat topology compatibility', () => {
    const legacyResult = compileRuntimeTopology({
      topology: {
        nodes: ['LEGACY_ROOM_1', 'LEGACY_ROOM_2'],
        connections: [],
      },
    });

    expect(legacyResult.startNodeId).toBe('LEGACY_ROOM_1');
    expect(legacyResult.spatialGraph).toHaveLength(2);
  });

  it('fails closed when a rich topology node definition has empty description or label', () => {
    expect(() =>
      compileRuntimeTopology({
        topology: {
          startingNodeId: 'ROOM_A',
          nodeDefinitions: [
            { id: 'ROOM_A', label: 'Room A', description: '   ' },
          ],
          connections: [],
        },
      })
    ).toThrow('Rich topology node "ROOM_A" requires a complete definition with non-empty label and description.');
  });

  it('derives graph nodes strictly from nodeDefinitions in rich topology without unioning rogue raw strings', () => {
    const result = compileRuntimeTopology({
      topology: {
        startingNodeId: 'ROOM_A',
        nodes: ['ROOM_A', 'ROGUE_RAW_NODE'],
        nodeDefinitions: [
          { id: 'ROOM_A', label: 'Room A', description: 'Description of Room A' },
        ],
        connections: [],
      },
    });

    expect(result.spatialGraph).toHaveLength(1);
    expect(result.spatialGraph[0].id).toBe('ROOM_A');
    expect(result.spatialGraph.find((n) => n.id === 'ROGUE_RAW_NODE')).toBeUndefined();
  });

  it('tolerates clues on nodeDefinitions without affecting spatial graph compilation', () => {
    const result = compileRuntimeTopology({
      topology: {
        startingNodeId: 'LAB',
        nodeDefinitions: [
          {
            id: 'LAB',
            label: 'Chemistry Lab',
            description: 'Shattered beakers and chemical residue.',
            clues: [
              { id: 'clue-vial', label: 'Sulfuric acid vial' },
            ],
          },
        ],
        connections: [],
      },
    });

    expect(result.spatialGraph).toHaveLength(1);
    expect(result.spatialGraph[0].id).toBe('LAB');
    expect(result.spatialGraph[0].name).toBe('Chemistry Lab');
    expect(result.spatialGraph[0].description).toBe('Shattered beakers and chemical residue.');
  });
});
