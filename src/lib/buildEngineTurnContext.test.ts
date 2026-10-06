import { describe, expect, it, vi } from 'vitest';
import { buildEngineTurnContext, buildContextReceipt } from './buildEngineTurnContext';
import { deriveCharacterMemoryId } from './characterMemory';
import { SpatialNode, CastActivityEvent, SituatedPressureThread } from '../types';

describe('buildEngineTurnContext & buildContextReceipt', () => {
  const mockBlueprint = {
    id: 'bp-sanatorium-99',
    title: 'The Blackwood Sanatorium',
    premise: 'An abandoned hospital that recalibrates geometry.',
    environmentalRules: [
      'Clocks run backwards near mirrors.',
      'Shadows cannot detach in darkness.',
    ],
    setting: {
      location: 'Ward 4B',
      atmosphere: 'Sterile ammonia smell',
      timePeriod: '1932',
    },
    startingVector: 'SOMATIC',
    startingTier: 'MANIFEST',
    incitingIncident: 'The exit stairs vanished.',
    pacingDirectives: 'Accelerate delirium upon inspection.',
    keyPlotElements: ['The rusted syringe', 'The ledger of wardens'],
    cast: [
      {
        id: 'char-clara',
        name: 'Nurse Clara Reed',
        role: 'Protagonist',
        description: 'Night shift nurse.',
        personality: 'Methodical and protective under acute duress.',
        goals: 'Locate the missing ward records and escort patients to safety.',
        traits: ['Clinical', 'Vigilant', 'Insomniac'],
        isUserCharacter: true,
        isEntity: false,
        expressionProfile: {
          communicationModes: ['spoken'],
          expressionGuidance: 'Speaks with clipped clinical precision.',
          silenceGuidance: 'Hesitates when asked about the basement.',
        },
      },
      {
        id: 'char-warden',
        name: 'The Quiet Warden',
        role: 'Antagonist',
        description: 'Faceless entity in surgeon coat.',
        personality: 'Relentless, patient, and surgically detached.',
        goals: 'Contain the quarantine breach and sever external communication.',
        traits: ['Implacable', 'Observant'],
        isUserCharacter: false,
        isEntity: true,
        expressionProfile: {
          communicationModes: ['mediated'],
          expressionGuidance: 'Uses short transmissions through the ward intercom.',
          silenceGuidance: 'A closed channel is not consent or absence.',
        },
      },
      {
        id: 'char-orderly',
        name: 'Orderly Thomas',
        role: 'Custodian',
        description: 'Night orderly.',
        isUserCharacter: false,
        isEntity: false,
      },
    ],
    topology: {
      nodes: ['WARD_4B', 'STAIRWELL', 'OPERATING_THEATRE'],
      connections: [
        {
          from: 'WARD_4B',
          to: 'STAIRWELL',
          kind: 'PHYSICAL',
          requires: ['WARD_KEY'],
          userInitiated: true,
        },
      ],
    },
  };

  it('builds a complete authoritative EngineTurnContext for the protagonist', () => {
    const context = buildEngineTurnContext({
      blueprint: mockBlueprint,
      selectedRole: 'protagonist',
      runtimeState: {
        currentNodeId: 'WARD_4B',
        phase: 'MANIFEST',
        tension: 5,
        coherence: 0.7,
        reconciliationRevision: 1,
        activeVector: 'SOMATIC',
        activeTier: 'MANIFEST',
      },
    });

    expect(context.version).toBe(1);
    expect(context.scenario.title).toBe('The Blackwood Sanatorium');
    expect(context.scenario.worldRules).toEqual([
      'Clocks run backwards near mirrors.',
      'Shadows cannot detach in darkness.',
    ]);
    expect(context.player.role).toBe('protagonist');
    expect(context.player.name).toBe('Nurse Clara Reed');
    expect(context.player.characterId).toBe('char-clara');
    expect(context.player.isEntity).toBe(false);

    // Cast roster includes ALL cast (including antagonist)
    expect(context.cast).toHaveLength(3);
    expect(context.cast.find((c) => c.name === 'The Quiet Warden')).toBeDefined();

    const clara = context.cast.find((member) => member.id === 'char-clara');
    expect(clara?.isUserCharacter).toBe(true);
    expect(clara?.personality).toBe('Methodical and protective under acute duress.');
    expect(clara?.goals).toBe('Locate the missing ward records and escort patients to safety.');
    expect(clara?.traits).toEqual(['Clinical', 'Vigilant', 'Insomniac']);

    const warden = context.cast.find((member) => member.id === 'char-warden');
    expect(warden?.personality).toBe('Relentless, patient, and surgically detached.');
    expect(warden?.goals).toBe('Contain the quarantine breach and sever external communication.');
    expect(warden?.traits).toEqual(['Implacable', 'Observant']);
    expect(warden?.expressionProfile).toEqual({
      communicationModes: ['mediated'],
      expressionGuidance: 'Uses short transmissions through the ward intercom.',
      silenceGuidance: 'A closed channel is not consent or absence.',
    });

    const orderly = context.cast.find((member) => member.id === 'char-orderly');
    expect(orderly?.personality).toBe('');
    expect(orderly?.goals).toBe('');
    expect(orderly?.traits).toEqual([]);
    expect(orderly?.skepticism).toBe(0.5);

    // Topology boundaries
    expect(context.topology.currentNodeId).toBe('WARD_4B');
    expect(context.topology.allowedOutgoingExits).toHaveLength(1);
    expect(context.topology.allowedOutgoingExits[0].to).toBe('STAIRWELL');
    expect(context.topology.allowedOutgoingExits[0].requires).toEqual(['WARD_KEY']);

    // Runtime conditions
    expect(context.runtime.phase).toBe('MANIFEST');
    expect(context.runtime.tension).toBe(5);
    expect(context.runtime.coherence).toBe(0.7);
    expect(context.runtime.activeVector).toBe('SOMATIC');
  });

  it('binds antagonist perspective correctly', () => {
    const context = buildEngineTurnContext({
      blueprint: mockBlueprint,
      selectedRole: 'antagonist',
      runtimeState: {
        currentNodeId: 'WARD_4B',
      },
    });

    expect(context.player.role).toBe('antagonist');
    expect(context.player.name).toBe('The Quiet Warden');
    expect(context.player.characterId).toBe('char-warden');
    expect(context.player.isEntity).toBe(true);
  });

  it('builds a ContextReceipt accurately from context and blueprint', () => {
    const context = buildEngineTurnContext({
      blueprint: mockBlueprint,
      selectedRole: 'protagonist',
      runtimeState: { currentNodeId: 'WARD_4B' },
    });
    const receipt = buildContextReceipt(context, mockBlueprint);

    expect(receipt.version).toBe(1);
    expect(receipt.scenarioTitle).toBe('The Blackwood Sanatorium');
    expect(receipt.blueprintId).toBe('bp-sanatorium-99');
    expect(receipt.selectedRole).toBe('protagonist');
    expect(receipt.resolvedPlayerName).toBe('Nurse Clara Reed');
    expect(receipt.castCount).toBe(3);
    expect(receipt.worldRuleCount).toBe(2);
    expect(receipt.topologyNodeCount).toBe(3);
    expect(receipt.topologyConnectionCount).toBe(1);
  });

  it('maps resolved character continuity onto cast members', () => {
    const blueprintWithVulnerability = {
      ...mockBlueprint,
      cast: [
        {
          id: 'char-1',
          name: 'Alice',
          vulnerabilityBase: { skepticism: 0.35 },
        },
        {
          id: 'char-2',
          name: 'Bob',
          vulnerabilityBase: { skepticism: 0.4 },
        },
      ],
    };

    const context = buildEngineTurnContext({
      blueprint: blueprintWithVulnerability,
      characterContinuity: {
        'char-1': { skepticism: 0.85 },
      },
    });

    const alice = context.cast.find((c) => c.id === 'char-1');
    const bob = context.cast.find((c) => c.id === 'char-2');

    // Alice prefers persisted (0.85) over vulnerabilityBase (0.35)
    expect(alice?.skepticism).toBe(0.85);
    // Bob falls back to vulnerabilityBase (0.4)
    expect(bob?.skepticism).toBe(0.4);
  });

  it('falls back to DEFAULT_SKEPTICISM for legacy blueprints with no continuity or vulnerability', () => {
    const legacyBlueprint = {
      title: 'Legacy',
      cast: [{ id: 'char-legacy', name: 'Old Ghost' }],
    };

    const context = buildEngineTurnContext({
      blueprint: legacyBlueprint,
    });

    const ghost = context.cast.find((c) => c.id === 'char-legacy');
    expect(ghost?.skepticism).toBe(0.5);
  });

  it('resolves isPresent based on player binding, characterPresence, and starting_location', () => {
    const blueprint = {
      ...mockBlueprint,
      topology: {
        nodes: ['WARD_4B', 'STAIRWELL', 'OPERATING_THEATRE'],
      },
      cast: [
        {
          id: 'char-clara',
          name: 'Nurse Clara Reed',
          isUserCharacter: true,
          starting_location: 'OPERATING_THEATRE',
        },
        {
          id: 'char-warden',
          name: 'The Quiet Warden',
          starting_location: 'STAIRWELL',
        },
        {
          id: 'char-orderly',
          name: 'Orderly Thomas',
          starting_location: 'OPERATING_THEATRE',
        },
      ],
    };

    const context = buildEngineTurnContext({
      blueprint,
      selectedRole: 'protagonist',
      characterPresence: {
        'char-orderly': { nodeId: 'WARD_4B' }, // Overrides starting_location
      },
      runtimeState: {
        currentNodeId: 'WARD_4B',
      },
    });

    const clara = context.cast.find((c) => c.id === 'char-clara');
    const warden = context.cast.find((c) => c.id === 'char-warden');
    const orderly = context.cast.find((c) => c.id === 'char-orderly');

    // Player character is always at currentNodeId (WARD_4B)
    expect(clara?.isPresent).toBe(true);
    // Warden is at STAIRWELL (starting_location), not WARD_4B
    expect(warden?.isPresent).toBe(false);
    // Orderly is at WARD_4B (persisted), matching currentNodeId
    expect(orderly?.isPresent).toBe(true);
  });

  it('rejects authored or persisted locations absent from a populated runtime graph', () => {
    const blueprint = {
      ...mockBlueprint,
      topology: {
        nodes: ['BLUEPRINT_OLD_VAULT', 'BLUEPRINT_ATTIC'],
      },
      cast: [
        {
          id: 'char-player',
          name: 'Player Investgator',
          isUserCharacter: true,
          starting_location: 'BLUEPRINT_OLD_VAULT',
        },
        {
          id: 'char-companion',
          name: 'Companion Scholar',
          starting_location: 'BLUEPRINT_OLD_VAULT', // Authored in blueprint node that is absent from runtime graph
        },
        {
          id: 'char-ghost',
          name: 'Haunting Spirit',
          starting_location: 'RUNTIME_NODE_CHAMBER',
        },
      ],
    };

    // Populated runtime graph with nodes: ['RUNTIME_NODE_CHAMBER', 'RUNTIME_NODE_HALLWAY']
    const spatialGraph: SpatialNode[] = [
      {
        id: 'RUNTIME_NODE_CHAMBER',
        type: 'physical',
        name: 'Chamber',
        description: 'A stone chamber.',
        sensoryProfile: [],
        exits: [],
        environmentalHazards: [],
        linkedCharacters: [],
        structuralAnomalies: [],
      },
      {
        id: 'RUNTIME_NODE_HALLWAY',
        type: 'physical',
        name: 'Hallway',
        description: 'A narrow hallway.',
        sensoryProfile: [],
        exits: [],
        environmentalHazards: [],
        linkedCharacters: [],
        structuralAnomalies: [],
      },
    ];

    const context = buildEngineTurnContext({
      blueprint,
      selectedRole: 'protagonist',
      spatialGraph,
      characterPresence: {
        'char-companion': { nodeId: 'BLUEPRINT_OLD_VAULT' }, // Persisted to a stale Blueprint-only node
      },
      runtimeState: {
        currentNodeId: 'RUNTIME_NODE_CHAMBER',
      },
    });

    const player = context.cast.find((c) => c.id === 'char-player');
    const companion = context.cast.find((c) => c.id === 'char-companion');
    const ghost = context.cast.find((c) => c.id === 'char-ghost');

    // Player character remains present at the actual current runtime node
    expect(player?.isPresent).toBe(true);

    // Companion's stale location (BLUEPRINT_OLD_VAULT) is absent from runtime graph and rejected;
    // buildCharacterPresence falls back to currentNodeId ('RUNTIME_NODE_CHAMBER') for invalid node
    expect(companion?.isPresent).toBe(true);

    // Haunting spirit at RUNTIME_NODE_CHAMBER is at current node
    expect(ghost?.isPresent).toBe(true);
  });

  it('proves runtime graph authority over blueprint topology and blueprint fallback when no runtime graph exists', () => {
    const blueprint = {
      ...mockBlueprint,
      topology: {
        nodes: ['BP_NODE_A', 'BP_NODE_B'],
      },
      cast: [
        {
          id: 'char-protagonist',
          name: 'Protagonist',
          isUserCharacter: true,
          starting_location: 'BP_NODE_A',
        },
        {
          id: 'char-npc1',
          name: 'NPC 1',
          starting_location: 'BP_NODE_B', // Valid in blueprint, invalid in runtime graph
        },
        {
          id: 'char-npc2',
          name: 'NPC 2',
          starting_location: 'RUNTIME_NODE_2',
        },
      ],
    };

    // Case 1: Populated runtime graph provided -> runtime graph is authoritative
    const runtimeContext = buildEngineTurnContext({
      blueprint,
      selectedRole: 'protagonist',
      spatialGraph: [
        {
          id: 'RUNTIME_NODE_1',
          type: 'physical',
          name: 'Runtime Node 1',
          description: 'First node.',
          sensoryProfile: [],
          exits: [],
          environmentalHazards: [],
          linkedCharacters: [],
          structuralAnomalies: [],
        },
        {
          id: 'RUNTIME_NODE_2',
          type: 'physical',
          name: 'Runtime Node 2',
          description: 'Second node.',
          sensoryProfile: [],
          exits: [],
          environmentalHazards: [],
          linkedCharacters: [],
          structuralAnomalies: [],
        },
      ],
      runtimeState: {
        currentNodeId: 'RUNTIME_NODE_1',
      },
    });

    const runtimeProtagonist = runtimeContext.cast.find((c) => c.id === 'char-protagonist');
    const runtimeNpc1 = runtimeContext.cast.find((c) => c.id === 'char-npc1');
    const runtimeNpc2 = runtimeContext.cast.find((c) => c.id === 'char-npc2');

    // Player remains present at actual current runtime node
    expect(runtimeProtagonist?.isPresent).toBe(true);
    // NPC 1's starting_location 'BP_NODE_B' is rejected because runtime graph is authoritative and does not contain 'BP_NODE_B'
    // Fallback in buildCharacterPresence makes presenceNodeId = currentNodeId ('RUNTIME_NODE_1')
    expect(runtimeNpc1?.isPresent).toBe(true);
    // NPC 2's starting_location 'RUNTIME_NODE_2' is valid in runtime graph, so it resolves to 'RUNTIME_NODE_2' (not current node RUNTIME_NODE_1)
    expect(runtimeNpc2?.isPresent).toBe(false);

    // Case 2: No runtime graph provided -> Blueprint topology remains the fallback source
    const fallbackContext = buildEngineTurnContext({
      blueprint,
      selectedRole: 'protagonist',
      spatialGraph: undefined,
      runtimeState: {
        currentNodeId: 'BP_NODE_A',
      },
    });

    const fallbackProtagonist = fallbackContext.cast.find((c) => c.id === 'char-protagonist');
    const fallbackNpc1 = fallbackContext.cast.find((c) => c.id === 'char-npc1');
    const fallbackNpc2 = fallbackContext.cast.find((c) => c.id === 'char-npc2');

    // Player remains present at actual current runtime node
    expect(fallbackProtagonist?.isPresent).toBe(true);
    // NPC 1's starting_location 'BP_NODE_B' is valid in blueprint topology (not current node BP_NODE_A)
    expect(fallbackNpc1?.isPresent).toBe(false);
    // NPC 2's starting_location 'RUNTIME_NODE_2' is NOT in blueprint topology, so it falls back to BP_NODE_A
    expect(fallbackNpc2?.isPresent).toBe(true);
  });

  describe('consequenceState pre-state integration (Phase 3H.1B)', () => {
    it('defaults consequenceState to empty inventory, empty player_injuries, and STABLE when omitted or null', () => {
      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
      });

      expect(context.consequenceState).toEqual({
        inventory: [],
        player_injuries: [],
        psychological_status: 'STABLE',
      });
    });

    it('normalizes, deduplicates, and caps consequenceState pre-state from authoritative input', () => {
      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
        consequenceState: {
          inventory: ['  Rusted Key  ', 'rusted key', 'Flashlight'],
          player_injuries: [' lacerated arm ', 'LACERATED ARM', 'Broken Rib'],
          psychological_status: 'distressed',
        },
      });

      expect(context.consequenceState).toEqual({
        inventory: ['Rusted Key', 'Flashlight'],
        player_injuries: ['lacerated arm', 'Broken Rib'],
        psychological_status: 'DISTRESSED',
      });
    });

    it('performs a deep copy of consequenceState so external mutation has no effect', () => {
      const rawInventory = ['Brass Key', 'Bandage'];
      const rawInjuries = ['Sprained Ankle'];
      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
        consequenceState: {
          inventory: rawInventory,
          player_injuries: rawInjuries,
          psychological_status: 'PANICKED',
        },
      });

      rawInventory.push('Unauthorized Mutation');
      rawInjuries.push('Unauthorized Fracture');

      expect(context.consequenceState.inventory).toEqual(['Brass Key', 'Bandage']);
      expect(context.consequenceState.player_injuries).toEqual(['Sprained Ankle']);
    });
  });

  describe('characterStance context integration (Phase 3H.2B)', () => {
    it('defaults cast member stance to null when characterStance is omitted, null, or empty', () => {
      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
      });

      expect(context.version).toBe(1);
      for (const member of context.cast) {
        expect(member.stance).toBeNull();
      }
    });

    it('binds exact per-character stance and leaves other cast members null', () => {
      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
        characterStance: {
          'char-warden': { focus: 'PLAYER', stance: 'HOSTILE' },
        },
      });

      const clara = context.cast.find((c) => c.id === 'char-clara');
      const warden = context.cast.find((c) => c.id === 'char-warden');
      const orderly = context.cast.find((c) => c.id === 'char-orderly');

      expect(clara?.stance).toBeNull();
      expect(orderly?.stance).toBeNull();
      expect(warden?.stance).toEqual({
        focus: 'PLAYER',
        stance: 'HOSTILE',
      });
    });

    it('does not expose stance for unknown character IDs or derive from personality/skepticism', () => {
      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
        characterStance: {
          'char-ghost': { focus: 'SITUATION', stance: 'AFRAID' },
        },
      });

      for (const member of context.cast) {
        expect(member.stance).toBeNull();
      }
    });
  });

  describe('characterRelationships and characterMemory context integration (Phase 3H.3B and 3H.4B)', () => {
    it('defaults relationshipState and memoryState when omitted', () => {
      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
      });

      expect(context.relationshipState).toEqual([]);
      expect(context.memoryState).toEqual({});
      for (const member of context.cast) {
        expect(member.memory).toEqual([]);
      }
    });

    it('situates character memory projection onto exact cast records and isolates by ID', () => {
      const blueprintWithDuplicates = {
        ...mockBlueprint,
        cast: [
          {
            id: 'char-a',
            name: 'Dr. Evans',
            role: 'Protagonist',
            isUserCharacter: true,
          },
          {
            id: 'char-b',
            name: 'Dr. Evans', // identical display name
            role: 'Subject',
            isUserCharacter: false,
          },
          {
            id: 'char-absent',
            name: 'Warden Absent',
            role: 'Antagonist',
            isUserCharacter: false,
          },
        ],
      };

      const mockMemory = Object.freeze({
        'char-a': Object.freeze([
          Object.freeze({
            id: 'mem-a',
            fact: 'Evans remembers the basement key code.',
            source: 'OBSERVED' as const,
            certainty: 'KNOWN' as const,
            acquired_turn: 0,
          }),
        ]),
        'char-b': Object.freeze([
          Object.freeze({
            id: 'mem-b',
            fact: 'The duplicate doctor heard footsteps.',
            source: 'TOLD' as const,
            certainty: 'BELIEVED' as const,
            acquired_turn: 1,
          }),
        ]),
        'char-absent': Object.freeze([
          Object.freeze({
            id: 'mem-absent',
            fact: 'The absent warden tracks the containment protocol.',
            source: 'OBSERVED' as const,
            certainty: 'KNOWN' as const,
            acquired_turn: 2,
          }),
        ]),
      });

      const context = buildEngineTurnContext({
        blueprint: blueprintWithDuplicates,
        characterMemory: mockMemory,
        characterPresence: {
          'char-a': { nodeId: 'WARD_4B' },
          'char-b': { nodeId: 'WARD_4B' },
          'char-absent': { nodeId: 'STAIRWELL' }, // absent from current node
        },
        runtimeState: { currentNodeId: 'WARD_4B' },
      });

      // 1. memoryState ledger is preserved
      expect(context.memoryState).toBeDefined();
      expect(context.memoryState['char-a']).toHaveLength(1);
      expect(context.memoryState['char-b']).toHaveLength(1);
      expect(context.memoryState['char-absent']).toHaveLength(1);

      // 2. memory for char-a appears only on char-a
      const charA = context.cast.find((c) => c.id === 'char-a');
      expect(charA?.memory).toHaveLength(1);
      expect(charA?.memory[0].id).toBe(deriveCharacterMemoryId('char-a', 'Evans remembers the basement key code.'));
      expect(charA?.memory[0].fact).toBe('Evans remembers the basement key code.');

      // 3. Two characters with same display name remain isolated by ID
      const charB = context.cast.find((c) => c.id === 'char-b');
      expect(charB?.memory).toHaveLength(1);
      expect(charB?.memory[0].id).toBe(deriveCharacterMemoryId('char-b', 'The duplicate doctor heard footsteps.'));
      expect(charB?.memory[0].fact).toBe('The duplicate doctor heard footsteps.');

      // 4. Absent character retains its own context memory projection
      const charAbsent = context.cast.find((c) => c.id === 'char-absent');
      expect(charAbsent?.isPresent).toBe(false);
      expect(charAbsent?.memory).toHaveLength(1);
      expect(charAbsent?.memory[0].id).toBe(deriveCharacterMemoryId('char-absent', 'The absent warden tracks the containment protocol.'));

      // 5. Returned arrays and entries are fresh copies (deep-freeze remains safe)
      expect(charA?.memory).not.toBe(mockMemory['char-a']);
      expect(charA?.memory[0]).not.toBe(mockMemory['char-a'][0]);
      charA!.memory.push({
        id: 'mem-mutated',
        fact: 'Mutated copy',
        source: 'OBSERVED',
        certainty: 'KNOWN',
        acquired_turn: 3,
      });
      expect(mockMemory['char-a']).toHaveLength(1);
    });

    it('passes through relationshipState and memoryState when provided', () => {
      const mockRel = [
        {
          source_character_id: 'char-warden',
          target_character_id: 'char-clara',
          kind: 'HOSTILITY' as const,
          intensity: 2 as const,
        },
      ];
      const mockMem = {
        'char-warden': [
          {
            id: 'mem-1',
            fact: 'Clara attempted to open the basement door',
            source: 'OBSERVED' as const,
            certainty: 'KNOWN' as const,
            acquired_turn: 1,
          },
        ],
      };

      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
        characterRelationships: mockRel,
        characterMemory: mockMem,
      });

      expect(context.relationshipState).toEqual(mockRel);
      expect(context.memoryState['char-warden']).toHaveLength(1);
      expect(context.memoryState['char-warden'][0].fact).toBe('Clara attempted to open the basement door');
      expect(context.memoryState['char-warden'][0].source).toBe('OBSERVED');
      expect(context.memoryState['char-warden'][0].certainty).toBe('KNOWN');
      expect(context.memoryState['char-warden'][0].acquired_turn).toBe(1);
    });

    it('seeds villain-villain relationships from value anchors, giving precedence to explicit runtime state', () => {
      const multiVillainBlueprint = {
        ...mockBlueprint,
        cast: [
          ...mockBlueprint.cast,
          {
            id: 'char-second-warden',
            name: 'Deputy Overseer',
            role: 'Antagonist',
            description: 'Secondary antagonist.',
            personality: 'Observant',
            goals: 'Assist in containment.',
            traits: ['Cruel'],
            isUserCharacter: false,
            isEntity: true,
          },
        ],
        horrorGrammar: {
          valueAnchors: [
            {
              id: 'anc-rivals',
              holder: {
                kind: 'RELATIONSHIP',
                castMemberIds: ['char-warden', 'char-second-warden'],
              },
              label: 'Paranoid pact',
              description: 'Mutual suspicion and distrust.',
              basisSummary: 'Wary predators.',
              provenance: { kind: 'REVIEWED_SOURCE', sourceId: 'src-1', evidenceIds: ['ev-1'] },
            },
          ],
        },
      };

      // 1. Initial seed with no explicit relationships
      const initialCtx = buildEngineTurnContext({
        blueprint: multiVillainBlueprint,
        selectedRole: 'protagonist',
      });

      expect(initialCtx.relationshipState).toContainEqual({
        source_character_id: 'char-warden',
        target_character_id: 'char-second-warden',
        kind: 'SUSPICION',
        intensity: 2,
      });

      // 2. Precedence: explicit runtime relationship overrides seed
      const runtimeOverride = [
        {
          source_character_id: 'char-warden',
          target_character_id: 'char-second-warden',
          kind: 'SUSPICION' as const,
          intensity: 3 as const,
        },
      ];

      const overriddenCtx = buildEngineTurnContext({
        blueprint: multiVillainBlueprint,
        selectedRole: 'protagonist',
        runtimeState: {
          characterRelationships: runtimeOverride,
        },
      });

      expect(overriddenCtx.relationshipState).toContainEqual({
        source_character_id: 'char-warden',
        target_character_id: 'char-second-warden',
        kind: 'SUSPICION',
        intensity: 3,
      });
      // Ensure only 1 record exists for this tuple
      const matching = overriddenCtx.relationshipState.filter(
        (r) =>
          r.source_character_id === 'char-warden' &&
          r.target_character_id === 'char-second-warden' &&
          r.kind === 'SUSPICION'
      );
      expect(matching).toHaveLength(1);
    });

    it('populates runtime.turnNumber from runtimeState.turnCount accurately for 0, 1, and nonzero turns', () => {
      const ctx0 = buildEngineTurnContext({
        blueprint: mockBlueprint,
        runtimeState: { turnCount: 0 },
      });
      expect(ctx0.runtime.turnNumber).toBe(0);

      const ctx1 = buildEngineTurnContext({
        blueprint: mockBlueprint,
        runtimeState: { turnCount: 1 },
      });
      expect(ctx1.runtime.turnNumber).toBe(1);

      const ctx7 = buildEngineTurnContext({
        blueprint: mockBlueprint,
        runtimeState: { turnCount: 7 },
      });
      expect(ctx7.runtime.turnNumber).toBe(7);

      const ctxDefault = buildEngineTurnContext({
        blueprint: mockBlueprint,
        runtimeState: {},
      });
      expect(ctxDefault.runtime.turnNumber).toBe(0);
    });

    it('ignores stray legacy runtimeState.characterMemory and only uses explicit characterMemory option', () => {
      const strayLegacy = {
        'char-warden': [
          {
            id: 'legacy-mem',
            fact: 'Stray legacy fact',
            source: 'OBSERVED' as const,
            certainty: 'KNOWN' as const,
            acquired_turn: 1,
          },
        ],
      };

      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        runtimeState: {
          ...({ characterMemory: strayLegacy } as unknown as Record<string, unknown>),
        },
      });

      expect(context.memoryState).toEqual({});
      expect(context.memoryState['char-warden']).toBeUndefined();
    });

    it('binds explicit selectedCharacterId authoritatively and aligns cast isUserCharacter flags', () => {
      const blueprintWithOrderly = {
        ...mockBlueprint,
        userCharacterId: 'char-orderly',
        cast: mockBlueprint.cast.map((c) => ({
          ...c,
          isUserCharacter: c.id === 'char-orderly',
        })),
      };

      const context = buildEngineTurnContext({
        blueprint: blueprintWithOrderly,
        selectedRole: 'protagonist',
        selectedCharacterId: 'char-orderly',
        runtimeState: {
          currentNodeId: 'WARD_4B',
        },
      });

      expect(context.player.role).toBe('protagonist');
      expect(context.player.characterId).toBe('char-orderly');
      expect(context.player.name).toBe('Orderly Thomas');

      const clara = context.cast.find((c) => c.id === 'char-clara');
      const orderly = context.cast.find((c) => c.id === 'char-orderly');

      expect(orderly?.isUserCharacter).toBe(true);
      expect(clara?.isUserCharacter).toBe(false);
    });

    it('proves failure receipts and unsafe sentinels are completely excluded from built prompt context', () => {
      const CODE_SENTINEL = 'https://malicious.internal.api/key?secret=123';
      const MESSAGE_SENTINEL = 'DATABASE_PASSWORD=secret_password_here';

      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        selectedRole: 'protagonist',
        selectedCharacterId: 'char-clara',
        runtimeState: {
          currentNodeId: 'WARD_4B',
          // Pass failure metadata attempting to leak into turn context
          ...({
            lastFailure: {
              code: CODE_SENTINEL,
              message: MESSAGE_SENTINEL,
            },
          } as unknown as Record<string, unknown>),
        },
      });

      const serialized = JSON.stringify(context);
      expect(serialized).not.toContain(CODE_SENTINEL);
      expect(serialized).not.toContain(MESSAGE_SENTINEL);
    });

    it('builds horror grammar turn context with bounded opportunities and authority instruction', () => {
      const bpWithHorrorGrammar = {
        ...mockBlueprint,
        horrorGrammar: {
          valueBaselineReview: 'REVIEWED',
          pursuitReviews: {
            'char-warden': 'REVIEWED',
            'char-orderly': 'REVIEWED',
          },
          valueAnchors: [
            {
              id: 'val-ward',
              holder: { kind: 'PLACE', nodeId: 'WARD_4B' },
              label: 'Ward 4B Integrity',
              description: 'The physical stability of the ward',
              basisSummary: 'Hospital blueprints',
              provenance: { kind: 'CREATOR_DEFINED' },
            },
            {
              id: 'val-warden-duty',
              holder: { kind: 'CHARACTER', castMemberId: 'char-warden' },
              label: 'Warden Containment Protocol',
              description: 'Enforce quarantine at all costs',
              basisSummary: 'Surgical duty',
              provenance: { kind: 'CREATOR_DEFINED' },
            },
          ],
          characterPursuits: [
            {
              id: 'pursuit-warden',
              castMemberId: 'char-warden',
              objective: 'Contain quarantine breach',
              presentApproach: 'Patrolling surgical corridor',
              locationNodeId: 'OPERATING_THEATRE',
              status: 'ACTIVE',
              reviewWindow: 'MOMENT',
              triggerReferences: [],
              basisSummary: 'Quarantine directive',
              provenance: { kind: 'CREATOR_DEFINED' },
            },
            {
              id: 'pursuit-orderly',
              castMemberId: 'char-orderly',
              objective: 'Find key ring',
              presentApproach: 'Searching nurse station drawers',
              locationNodeId: 'WARD_4B',
              status: 'ACTIVE',
              reviewWindow: 'MOMENT',
              triggerReferences: [],
              basisSummary: 'Shift responsibility',
              provenance: { kind: 'CREATOR_DEFINED' },
            },
          ],
        },
      };

      const context = buildEngineTurnContext({
        blueprint: bpWithHorrorGrammar,
        selectedRole: 'protagonist',
        selectedCharacterId: 'char-clara',
        characterPresence: {
          'char-clara': { nodeId: 'WARD_4B' },
          'char-orderly': { nodeId: 'WARD_4B' },
          'char-warden': { nodeId: 'OPERATING_THEATRE' },
        },
        runtimeState: {
          currentNodeId: 'WARD_4B',
        },
      });

      expect(context.horrorGrammar).toBeDefined();
      expect(context.horrorGrammar?.fictionalTime).toEqual({
        moment_revision: 0,
        scene_beat_revision: 0,
        extended_revision: 0,
        last_cost: null,
      });
      // Orderly is present at WARD_4B
      expect(context.horrorGrammar?.presentActorOpportunities).toHaveLength(1);
      expect(context.horrorGrammar?.presentActorOpportunities[0].castMemberId).toBe('char-orderly');
      expect(context.horrorGrammar?.presentActorOpportunities[0].opportunityKind).toBe('PRESENT');

      // User Clara is NEVER in opportunity pool
      const claraInPool = [
        ...(context.horrorGrammar?.presentActorOpportunities || []),
        ...(context.horrorGrammar?.offscreenPursuitOpportunities || []),
      ].some((o) => o.castMemberId === 'char-clara');
      expect(claraInPool).toBe(false);

      expect(context.horrorGrammar?.authorityInstruction).toContain(
        'Only non-User characters listed under presentActorOpportunities and offscreenPursuitOpportunities are eligible'
      );

      // Packet 1-6 Proof 1: Fresh reviewed blueprint creates complete HG1 snapshot & baseline
      expect(context.horrorGrammar?.runtimeState).toBeDefined();
      expect(context.horrorGrammar?.runtimeState.fictionalTime).toEqual({
        moment_revision: 0,
        scene_beat_revision: 0,
        extended_revision: 0,
        last_cost: null,
      });
      expect(context.horrorGrammar?.runtimeState.pursuitSchedule).toEqual({});
      expect(context.horrorGrammar?.runtimeState.recentActivityEvents).toEqual([]);
      expect(context.horrorGrammar?.runtimeState.activePressureThreads).toEqual([]);
      expect(context.horrorGrammar?.runtimeState.valueState).toHaveProperty('val-ward');
      expect(context.horrorGrammar?.runtimeState.characterPursuits).toHaveProperty('pursuit-warden');
      expect(context.horrorGrammar?.runtimeState.characterDevelopment).toEqual({});

      expect(context.horrorGrammar?.authoringBaseline).toEqual({
        valueBaselineReview: 'REVIEWED',
        pursuitReviews: {
          'char-warden': 'REVIEWED',
          'char-orderly': 'REVIEWED',
        },
        valueAnchors: bpWithHorrorGrammar.horrorGrammar.valueAnchors,
        characterPursuits: bpWithHorrorGrammar.horrorGrammar.characterPursuits,
      });
    });

    it('retains supplied nonempty HG1 ledgers byte-for-byte in runtimeState snapshot', () => {
      const sentinelValueLedger = {
        'val-custom': {
          anchorId: 'val-custom',
          lifecycle: 'ACTIVE' as const,
          condition: 'THREATENED' as const,
          currentFormNote: 'Cracked foundation',
          lastCauseReference: 'EVT-PREV-01',
          lastChangedTurn: 2,
        },
      };
      const sentinelPursuitLedger = {
        'pursuit-custom': {
          pursuitId: 'pursuit-custom',
          castMemberId: 'char-orderly',
          currentObjective: 'Barricade door',
          currentApproach: 'Using steel cart',
          currentLocationNodeId: 'WARD_4B',
          status: 'ACTIVE' as const,
          progressSummary: 'Halfway barricaded',
          lastCauseReference: 'ACT-01',
          lastActivityTurn: 1,
          lastChangedTurn: 1,
          reviewWindow: 'MOMENT' as const,
        },
      };
      const sentinelActivityEvents: CastActivityEvent[] = [
        {
          id: 'act-evt-sentinel-01',
          castMemberId: 'char-orderly',
          pursuitId: 'pursuit-custom',
          activitySummary: 'Orderly Thomas slams the bolt in place.',
          locationNodeId: 'WARD_4B',
          perceptionPath: 'DIRECT',
          committedTurn: 1,
          authorityReferences: [],
          wasManifested: true,
        },
      ];
      const sentinelPressureThreads: SituatedPressureThread[] = [
        {
          id: 'prs-thread-sentinel-01',
          valueAnchorId: 'val-custom',
          holder: { kind: 'PLACE', nodeId: 'WARD_4B' },
          operator: 'CONSTRAIN_ACCESS',
          affectedDimension: 'SAFETY',
          adverseProspect: 'Door seal fails under pressure',
          manifestationSummary: null,
          persistenceTarget: 'PRESSURE_THREAD',
          status: 'OPEN',
          createdTurn: 1,
          lastChangedTurn: 1,
          sourceReference: 'act-evt-sentinel-01',
          authorityReferences: [],
        },
      ];
      const sentinelDevelopmentLedger = {
        'char-orderly': [
          {
            id: 'dev-fact-01',
            castMemberId: 'char-orderly',
            dimension: 'BELIEF' as const,
            statement: 'Believes the wardens have abandoned them.',
            lifecycle: 'ACTIVE' as const,
            establishedTurn: 1,
            lastChangedTurn: 1,
            causeReference: 'act-evt-sentinel-01',
          },
        ],
      };

      const context = buildEngineTurnContext({
        blueprint: mockBlueprint,
        valueStateLedger: sentinelValueLedger,
        characterPursuitLedger: sentinelPursuitLedger,
        activityEvents: sentinelActivityEvents,
        pressureThreads: sentinelPressureThreads,
        characterDevelopmentLedger: sentinelDevelopmentLedger,
        runtimeState: {
          currentNodeId: 'WARD_4B',
          turnCount: 2,
        },
      });

      expect(context.horrorGrammar?.runtimeState.valueState).toEqual(sentinelValueLedger);
      expect(context.horrorGrammar?.runtimeState.characterPursuits).toEqual(sentinelPursuitLedger);
      expect(context.horrorGrammar?.runtimeState.recentActivityEvents).toEqual(sentinelActivityEvents);
      expect(context.horrorGrammar?.runtimeState.activePressureThreads).toEqual(sentinelPressureThreads);
      expect(context.horrorGrammar?.runtimeState.characterDevelopment).toEqual(sentinelDevelopmentLedger);
    });
  });

  describe('Voice Dossier Contract Lockstep (Phase 3E / Amendment 1)', () => {
    it('preserves all voice dossier fields when compiling Blueprint cast into EngineTurnContext without Zod stripping', () => {
      const blueprintWithDossiers = {
        ...mockBlueprint,
        cast: [
          {
            ...mockBlueprint.cast[0],
            expressionProfile: {
              communicationModes: ['spoken'] as const,
              expressionGuidance: 'Speaks with clipped clinical precision.',
              silenceGuidance: 'Hesitates when asked about the basement.',
              cadenceNotes: 'Rapid staccato cadence; clips ends of sentences.',
              voiceTone: 'Cold, cultured, and unhurried.',
              vocalTells: ['Clears throat before answering', 'Drops volume when cornered'],
              lexiconNotes: 'Uses Wall Street financial jargon and Latin anatomical terminology.',
              camouflageLeakGuidance: 'When composure fractures, pleasantries give way to dismemberment vocabulary.',
            },
          },
        ],
      };

      const context = buildEngineTurnContext({
        blueprint: blueprintWithDossiers,
        selectedRole: 'protagonist',
        runtimeState: {
          currentNodeId: 'WARD_4B',
        },
      });

      const clara = context.cast.find((c) => c.id === 'char-clara');
      expect(clara).toBeDefined();
      expect(clara?.expressionProfile).toEqual({
        communicationModes: ['spoken'],
        expressionGuidance: 'Speaks with clipped clinical precision.',
        silenceGuidance: 'Hesitates when asked about the basement.',
        cadenceNotes: 'Rapid staccato cadence; clips ends of sentences.',
        voiceTone: 'Cold, cultured, and unhurried.',
        vocalTells: ['Clears throat before answering', 'Drops volume when cornered'],
        lexiconNotes: 'Uses Wall Street financial jargon and Latin anatomical terminology.',
        camouflageLeakGuidance: 'When composure fractures, pleasantries give way to dismemberment vocabulary.',
      });
    });
  });

  describe('R1: Dramaturgy Runtime State Hydration Enforcement', () => {
    const spineBlueprint = { ...mockBlueprint, dramaticSpine: { thematicPremise: 'Repair test spine' } };

    it('repairs schema-invalid persisted dramaturgy state to authored defaults', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const context = buildEngineTurnContext({
          blueprint: spineBlueprint,
          selectedRole: 'protagonist',
          dramaturgyRuntimeState: {
            currentMacroPhase: 'EXPOSITION_BASELINE',
            // Phantom value emitted by the pre-repair governor (R1 regression).
            activePacingCadence: 'MOUNTING_PRESSURE',
            consecutiveTurnsInCadence: 0,
            impendingClocks: {},
            characterStakes: {},
            milestones: [],
            receiptHistory: [],
          },
          runtimeState: {
            currentNodeId: 'WARD_4B',
          },
        });

        expect(context.dramaturgyRuntimeState).toBeDefined();
        expect(context.dramaturgyRuntimeState?.activePacingCadence).toBe('SIMMERING_DREAD');
        expect(context.dramaturgyRuntimeState?.currentMacroPhase).toBe('EXPOSITION_BASELINE');
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[DRAMATURGY HYDRATION REPAIR]'),
          expect.any(String)
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('passes schema-valid persisted dramaturgy state through untouched', () => {
      const context = buildEngineTurnContext({
        blueprint: spineBlueprint,
        selectedRole: 'protagonist',
        dramaturgyRuntimeState: {
          currentMacroPhase: 'COMPLICATION_ENCLOSURE',
          activePacingCadence: 'KINETIC_RUPTURE',
          consecutiveTurnsInCadence: 2,
          impendingClocks: {},
          characterStakes: {},
          milestones: [],
          receiptHistory: [],
        },
        runtimeState: {
          currentNodeId: 'WARD_4B',
        },
      });

      expect(context.dramaturgyRuntimeState?.activePacingCadence).toBe('KINETIC_RUPTURE');
      expect(context.dramaturgyRuntimeState?.currentMacroPhase).toBe('COMPLICATION_ENCLOSURE');
      expect(context.dramaturgyRuntimeState?.consecutiveTurnsInCadence).toBe(2);
    });
  });

  describe('nodeClues in engine turn context (Discovery series 2/6)', () => {
    it('populates topology.nodeClues containing only nodes that define clues', () => {
      const clueBlueprint = {
        ...mockBlueprint,
        topology: {
          nodes: ['WARD_4B', 'BASEMENT', 'ROOF'],
          connections: [],
          nodeDefinitions: [
            {
              id: 'WARD_4B',
              label: 'Ward 4B',
              clues: [
                { id: 'clue-1', label: 'Torn Patient Chart' },
                { id: 'clue-2', label: 'Empty Syringe Vial' },
              ],
            },
            {
              id: 'BASEMENT',
              label: 'Furnace Basement',
              clues: [
                { id: 'clue-3', label: 'Burned Logbook' },
              ],
            },
            {
              id: 'ROOF',
              label: 'Hospital Roof',
            },
          ],
        },
      };

      const context = buildEngineTurnContext({
        blueprint: clueBlueprint,
        selectedRole: 'protagonist',
      });

      expect(context.topology.nodeClues).toBeDefined();
      expect(context.topology.nodeClues).toEqual({
        WARD_4B: [
          { id: 'clue-1', label: 'Torn Patient Chart' },
          { id: 'clue-2', label: 'Empty Syringe Vial' },
        ],
        BASEMENT: [
          { id: 'clue-3', label: 'Burned Logbook' },
        ],
      });
      expect(context.topology.nodeClues).not.toHaveProperty('ROOF');
    });

    it('omits topology.nodeClues entirely when no clues are authored on any nodes', () => {
      const plainBlueprint = {
        ...mockBlueprint,
        topology: {
          nodes: ['WARD_4B'],
          connections: [],
          nodeDefinitions: [
            {
              id: 'WARD_4B',
              label: 'Ward 4B',
            },
          ],
        },
      };

      const context = buildEngineTurnContext({
        blueprint: plainBlueprint,
        selectedRole: 'protagonist',
      });

      expect(context.topology.nodeClues).toBeUndefined();
    });
  });
});

