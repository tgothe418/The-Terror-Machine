import * as fs from 'fs';
import * as path from 'path';
import http from 'http';
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createApp } from '../app';

const mockGenerateStructuredResponse = vi.fn();
vi.mock('../utils/aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/aiClient')>();
  return {
    ...actual,
    generateStructuredResponse: (...args: unknown[]) => mockGenerateStructuredResponse(...args),
  };
});
import {
  TurnRequestSchema,
  TurnResultSchema,
  EngineTurnContextSchema,
  TurnResponseSchema,
  RelationshipDeltaSchema,
} from '../schemas/engine';
import {
  validateDialogueBlocks,
  resolveDialogueSpeakerId,
  isRecognizedAmbientSpeaker,
  formatCastLedger,
  normalizeCastSkepticismDeltas,
  enforceNarrativeReconciliationBoundaries,
  finalizeTurnCausality,
  finalizeCanonicalConsequences,
  finalizeCharacterStance,
  finalizeCharacterRelationships,
  finalizeCharacterMemory,
} from './turn';
import { createCastInteractionReceipt } from '../../src/lib/castInteraction';
import { createIntentReceipt } from '../../src/lib/intentReceipt';
import { createNarrativeReconciliationReceipt } from '../../src/lib/narrativeReconciliation';
import { resolveExplicitCastTarget } from '../../src/lib/causalFeasibility';
import {
  createIntentBoundCastInteractionReceipt,
  getIntentBoundAddressedCharacterId,
} from '../../src/lib/intentConsequenceBridge';
import type { TurnResponse, TurnResult } from '../../src/types/engineContract';
import { geminiTurnResponseJsonSchema } from '../ai/geminiTurnJsonSchema';

const defaultTestHorrorGrammarReceipts = {
  fictionalTimeReceipt: {
    version: 1 as const,
    preState: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
    acceptedCost: 'MOMENT' as const,
    postState: { moment_revision: 1, scene_beat_revision: 0, extended_revision: 0, last_cost: 'MOMENT' as const },
  },
  castActivityReceipt: {
    version: 1 as const,
    presentOpportunities: [],
    offscreenOpportunities: [],
    boundedOutPursuitIds: [],
    dormantCount: 0,
    notDueCount: 0,
    ledgerSnapshot: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
    scheduleSnapshotRevision: 0,
  },
  pursuitScheduleReceipt: {
    version: 1 as const,
    preState: {},
    postState: {},
  },
  castActivityProposalReceipt: {
    version: 1 as const,
    outcome: 'NO_PROPOSAL' as const,
    reasonCode: 'NO_OPPORTUNITY_CHOSEN' as const,
    admittedManifestation: false,
    acceptedEventId: null,
    preState: [],
    postState: [],
  },
  situatedPressureReceipt: {
    version: 1 as const,
    outcome: 'NO_PROPOSAL' as const,
    reasonCode: 'NO_PRESSURE_CHOSEN' as const,
    admittedManifestation: false,
    acceptedThreadId: null,
    preState: [],
    postState: [],
  },
  valueStateReceipt: {
    version: 1 as const,
    preState: {},
    postState: {},
    decisions: [],
  },
  characterPursuitReceipt: {
    version: 1 as const,
    preState: {},
    postState: {},
    decisions: [],
  },
  characterDevelopmentReceipt: {
    version: 1 as const,
    preState: {},
    postState: {},
    decisions: [],
  },
  pressureThreadTransitionReceipt: {
    version: 1 as const,
    preState: [],
    postState: [],
    decisions: [],
  },
};

const defaultTestHorrorGrammarContext = {
  fictionalTime: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
  activityEligibility: {
    version: 1 as const,
    presentOpportunities: [],
    offscreenOpportunities: [],
    boundedOutPursuitIds: [],
    dormantCount: 0,
    notDueCount: 0,
    ledgerSnapshot: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
    scheduleSnapshotRevision: 0,
  },
  presentActorOpportunities: [],
  offscreenPursuitOpportunities: [],
  relevantValueAnchors: [],
  authorityInstruction: 'Standard authority',
  runtimeState: {
    fictionalTime: { moment_revision: 0, scene_beat_revision: 0, extended_revision: 0, last_cost: null },
    pursuitSchedule: {},
    recentActivityEvents: [],
    activePressureThreads: [],
    valueState: {},
    characterPursuits: {},
    characterDevelopment: {},
  },
  authoringBaseline: {
    valueBaselineReview: 'REVIEWED' as const,
    pursuitReviews: {},
    valueAnchors: [],
    characterPursuits: [],
  },
};

describe('Turn schemas validation', () => {
  describe('EngineTurnContextSchema', () => {
    it('validates and supplies defaults for an engine turn context', () => {
      const parsed = EngineTurnContextSchema.parse({
        scenario: {
          title: 'The Blackwood Sanatorium',
          premise: 'A derelict wing where shadows detach.',
          worldRules: ['Shadows cannot cross running water.'],
          setting: {
            location: 'East Wing Ward',
            atmosphere: 'Damp and suffocating',
            timePeriod: '1924'
          }
        },
        player: {
          role: 'protagonist',
          name: 'Arthur Pendelton',
          description: 'A retired archivist.'
        },
        cast: [
          {
            id: 'char-1',
            name: 'Nurse Finch',
            role: 'Custodian',
            description: 'Night shift custodian.',
            personality: 'Guarded and obsessive about door seals.',
            goals: 'Ensure no corridor breaches occur before dawn.',
            traits: ['Methodical', 'Paranoid'],
            isEntity: false
          }
        ],
        topology: {
          currentNodeId: 'WARD_01',
          readableNodeLabel: 'Ward 01',
          allowedOutgoingExits: [
            {
              from: 'WARD_01',
              to: 'CORRIDOR_02',
              kind: 'PHYSICAL',
              userInitiated: true
            }
          ]
        },
        runtime: {
          phase: 'LATENT',
          tension: 2,
          coherence: 1.0,
          reconciliationRevision: 0,
          activeVector: 'COGNITIVE',
          activeTier: 'LATENT'
        }
      });

      expect(parsed.version).toBe(1);
      expect(parsed.scenario.title).toBe('The Blackwood Sanatorium');
      expect(parsed.player.name).toBe('Arthur Pendelton');
      expect(parsed.cast).toHaveLength(1);
      expect(parsed.cast[0].personality).toBe('Guarded and obsessive about door seals.');
      expect(parsed.cast[0].goals).toBe('Ensure no corridor breaches occur before dawn.');
      expect(parsed.cast[0].traits).toEqual(['Methodical', 'Paranoid']);
      expect(parsed.topology.allowedOutgoingExits).toHaveLength(1);
    });
  });

  describe('TurnRequestSchema', () => {
    it('validates a well-formed turn request payload including EngineTurnContext', () => {
      const validPayload = {
        userAction: 'I check the locked wooden door for keyholes.',
        recentHistory: 'You stand in a dimly lit hallway.',
        systemDirective: 'Keep prose clinical and tension moderate.',
        isExpansionExpected: false,
        stateContext: {
          currentNodeId: 'ROOM_01',
          currentPhase: 'LATENT',
          tensionLevel: 2,
          reconciliationRevision: 0,
        },
        context: {
          version: 1,
          scenario: {
            title: 'Cellar Vault',
            premise: 'Subterranean isolation.',
            worldRules: ['No flame may ignite.'],
            setting: { location: 'Sub-level 3', atmosphere: 'Cold', timePeriod: '1970' },
            startingVector: 'SOMATIC',
            startingTier: 'GATEWAY',
            incitingIncident: 'The hatch locked.',
            pacingDirective: 'Slow burn.',
            keyPlotElements: ['The rusted valve']
          },
          player: {
            role: 'protagonist',
            name: 'Dr. Evans',
            description: 'Geologist',
            isEntity: false
          },
          cast: [],
          topology: {
            currentNodeId: 'ROOM_01',
            readableNodeLabel: 'Room 01',
            allowedOutgoingExits: []
          },
          runtime: {
            phase: 'LATENT',
            tension: 2,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeVector: 'SOMATIC',
            activeTier: 'GATEWAY'
          }
        }
      };

      const parsed = TurnRequestSchema.parse(validPayload);
      expect(parsed.userAction).toBe('I check the locked wooden door for keyholes.');
      expect(parsed.stateContext.currentNodeId).toBe('ROOM_01');
      expect(parsed.stateContext.tensionLevel).toBe(2);
      expect(parsed.isExpansionExpected).toBe(false);
      expect(parsed.context.scenario.title).toBe('Cellar Vault');
      expect(parsed.context.player.name).toBe('Dr. Evans');
    });

    it('rejects an empty user action', () => {
      const invalidPayload = {
        userAction: '',
        recentHistory: 'Hallway...',
        systemDirective: 'Directive...',
        isExpansionExpected: false,
        stateContext: {
          currentNodeId: 'ROOM_01',
          currentPhase: 'LATENT',
          tensionLevel: 2,
          reconciliationRevision: 0,
        },
        context: {
          version: 1,
          scenario: { title: 'Test', premise: '', worldRules: [], setting: { location: 'L', atmosphere: '', timePeriod: '' }, startingVector: 'COGNITIVE', startingTier: 'LATENT', incitingIncident: '', pacingDirective: '', keyPlotElements: [] },
          player: { role: 'protagonist', name: 'P', description: '', isEntity: false },
          cast: [],
          topology: { currentNodeId: 'ROOM_01', readableNodeLabel: 'Room 01', allowedOutgoingExits: [] },
          runtime: { phase: 'LATENT', tension: 0, coherence: 1.0, reconciliationRevision: 0, activeVector: 'COGNITIVE', activeTier: 'LATENT' }
        }
      };

      expect(() => TurnRequestSchema.parse(invalidPayload)).toThrow();
    });

    it('rejects missing state context', () => {
      const invalidPayload = {
        userAction: 'Walk forward',
        recentHistory: 'Hallway...',
        systemDirective: 'Directive...',
        isExpansionExpected: false,
      };

      expect(() => TurnRequestSchema.parse(invalidPayload)).toThrow();
    });
  });

  describe('TurnResultSchema and TurnResponseSchema', () => {
    describe('geminiTurnResponseJsonSchema provider contract', () => {
      it('includes character_stance_proposal in schema properties and required fields', () => {
        expect(geminiTurnResponseJsonSchema.properties).toHaveProperty('character_stance_proposal');
        expect(geminiTurnResponseJsonSchema.required).toContain('character_stance_proposal');
      });

      it('includes character_relationship_proposal in schema properties and required fields', () => {
        expect(geminiTurnResponseJsonSchema.properties).toHaveProperty('character_relationship_proposal');
        expect(geminiTurnResponseJsonSchema.required).toContain('character_relationship_proposal');
      });

      it('includes character_memory_proposal in schema properties and required fields', () => {
        expect(geminiTurnResponseJsonSchema.properties).toHaveProperty('character_memory_proposal');
        expect(geminiTurnResponseJsonSchema.required).toContain('character_memory_proposal');
      });

      it('declares world_memory_proposal provider contract correctly with bounded candidates and fields', () => {
        expect(geminiTurnResponseJsonSchema.properties).toHaveProperty('world_memory_proposal');
        expect(geminiTurnResponseJsonSchema.required).toContain('world_memory_proposal');

        const worldMemoryProp = geminiTurnResponseJsonSchema.properties?.world_memory_proposal;
        expect(worldMemoryProp).toBeDefined();
        expect(worldMemoryProp?.properties).toBeDefined();

        const candidatesProp = worldMemoryProp?.properties?.candidates;
        expect(candidatesProp).toBeDefined();
        expect(candidatesProp?.type).toBe('array');

        const candidateItems = candidatesProp?.items;
        expect(candidateItems).toBeDefined();
        expect(candidateItems?.properties?.scope?.enum).toEqual(['GLOBAL', 'NODE']);
      });

      it('declares character_relationship_proposal delta as an integer range with minimum -1 and maximum 1', () => {
        const deltaSchema =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (geminiTurnResponseJsonSchema.properties.character_relationship_proposal as any).properties.changes.items.properties.delta;

        expect(deltaSchema.type).toBe('integer');
        expect(deltaSchema.minimum).toBe(-1);
        expect(deltaSchema.maximum).toBe(1);
      });

      it('ensures every member of every enum array inside geminiTurnResponseJsonSchema is a string', () => {
        function collectEnumArrays(
          node: unknown,
          currentPath = '$'
        ): Array<{ path: string; values: unknown[] }> {
          const collected: Array<{ path: string; values: unknown[] }> = [];
          if (!node || typeof node !== 'object') {
            return collected;
          }

          if (Array.isArray(node)) {
            node.forEach((element, index) => {
              collected.push(...collectEnumArrays(element, `${currentPath}[${index}]`));
            });
            return collected;
          }

          const record = node as Record<string, unknown>;
          if ('enum' in record && Array.isArray(record.enum)) {
            collected.push({ path: `${currentPath}.enum`, values: record.enum });
          }

          for (const [key, value] of Object.entries(record)) {
            collected.push(...collectEnumArrays(value, `${currentPath}.${key}`));
          }

          return collected;
        }

        const enumArrays = collectEnumArrays(geminiTurnResponseJsonSchema);
        expect(enumArrays.length).toBeGreaterThan(0);

        for (const { path: enumPath, values } of enumArrays) {
          expect(values.length).toBeGreaterThan(0);
          for (const item of values) {
            expect(
              typeof item,
              `Enum member at ${enumPath} must be a JavaScript string, but was ${typeof item} (${JSON.stringify(item)})`
            ).toBe('string');
          }
        }
      });
    });

    const validIntentProposal = {
      action_kind: 'INVESTIGATE' as const,
      action_subtype: null,
      pressure_direction: 'MAINTAIN' as const,
      dramatic_tactic: 'NONE' as const,
      intent_synergy: 'N/A' as const,
    };

    const validReconciliationProposal = {
      mode: 'CANONICAL' as const,
      feasibility: 'SUPPORTED' as const,
      reason_code: 'NONE' as const,
      fictional_time_cost: 'MOMENT' as const,
      authority_alignment: 'NOT_APPLICABLE' as const,
      memory_echo_candidate: null,
    };

    const validConsequenceProposal = {
      mutations: [],
    };

    const validCharacterStanceProposal = {
      changes: [],
    };

    const validCharacterRelationshipProposal = {
      changes: [],
    };

    const validCharacterMemoryProposal = {
      candidates: [],
    };

    const validWorldMemoryProposal = {
      candidates: [],
    };

    const validCastActivityProposal = {
      kind: 'NONE' as const,
      reason: 'NO_OPPORTUNITY_CHOSEN' as const,
    };

    const validSituatedPressureProposal = {
      kind: 'NONE' as const,
      reason: 'NO_PRESSURE_CHOSEN' as const,
    };

    const validValueStateProposal = {
      changes: [],
    };

    const validCharacterPursuitProposal = {
      changes: [],
    };

    const validCharacterDevelopmentProposal = {
      changes: [],
    };

    const validPressureTransitionProposal = {
      transitions: [],
    };

    const defaultHG1Proposals = {
      cast_activity_proposal: validCastActivityProposal,
      situated_pressure_proposal: validSituatedPressureProposal,
      value_state_proposal: validValueStateProposal,
      character_pursuit_proposal: validCharacterPursuitProposal,
      character_development_proposal: validCharacterDevelopmentProposal,
      pressure_transition_proposal: validPressureTransitionProposal,
    };

    it('validates a well-formed turn result frame with proposals', () => {
      const validResult = {
        narrative_blocks: [
          {
            type: 'prose',
            content: 'The keyhole is plugged with dried wax.',
          },
          {
            type: 'environmental_description',
            content: 'The air smells faintly of sulfur.',
          },
        ],
        intent_proposal: validIntentProposal,
        reconciliation_proposal: validReconciliationProposal,
        consequence_proposal: validConsequenceProposal,
        character_stance_proposal: validCharacterStanceProposal,
        character_relationship_proposal: validCharacterRelationshipProposal,
        character_memory_proposal: validCharacterMemoryProposal,
        world_memory_proposal: validWorldMemoryProposal,
        ...defaultHG1Proposals,
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 3,
          terminal_flags: [],
          cast_deltas: [
            {
              character_id: 'char_1',
              skepticism_delta: -0.1,
            },
          ],
        },
        topologyDelta: {
          isExpansion: true,
          newNodeDef: {
            id: 'ROOM_02',
            geometry: 'Narrow passage',
            hazards: ['toxic_spores'],
            exitVectors: [
              {
                direction: 'NORTH',
                targetNodeId: 'ROOM_01',
              },
            ],
          },
        },
      };

      const parsed = TurnResultSchema.parse(validResult);
      expect(parsed.narrative_blocks).toHaveLength(2);
      expect(parsed.narrative_blocks[0].type).toBe('prose');
      expect(parsed.intent_proposal.action_kind).toBe('INVESTIGATE');
      expect(parsed.reconciliation_proposal.mode).toBe('CANONICAL');
      expect(parsed.consequence_proposal.mutations).toHaveLength(0);
      expect(parsed.character_stance_proposal.changes).toHaveLength(0);
      expect(parsed.character_relationship_proposal.changes).toHaveLength(0);
      expect(parsed.character_memory_proposal.candidates).toHaveLength(0);
      expect(parsed.world_memory_proposal.candidates).toHaveLength(0);
      expect(parsed.logic_state.suggested_tension).toBe(3);
      expect(parsed.topologyDelta?.isExpansion).toBe(true);
      expect(parsed.topologyDelta?.newNodeDef?.id).toBe('ROOM_02');
    });

    it('rejects missing intent_proposal or reconciliation_proposal or consequence_proposal or character_stance_proposal or character_relationship_proposal or character_memory_proposal or world_memory_proposal', () => {
      const baseResult = {
        narrative_blocks: [{ type: 'prose', content: 'Observation.' }],
        ...defaultHG1Proposals,
        logic_state: {},
      };

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
        })
      ).toThrow();

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          intent_proposal: validIntentProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
        })
      ).toThrow();

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
        })
      ).toThrow();

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
        })
      ).toThrow();

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
        })
      ).toThrow();

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          world_memory_proposal: validWorldMemoryProposal,
        })
      ).toThrow();

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          character_memory_proposal: validCharacterMemoryProposal,
        })
      ).toThrow();
    });

    it('rejects invalid enum values in proposals', () => {
      const baseResult = {
        narrative_blocks: [{ type: 'prose', content: 'Observation.' }],
        logic_state: {},
        consequence_proposal: validConsequenceProposal,
        character_stance_proposal: validCharacterStanceProposal,
        character_relationship_proposal: validCharacterRelationshipProposal,
        character_memory_proposal: validCharacterMemoryProposal,
        world_memory_proposal: validWorldMemoryProposal,
        ...defaultHG1Proposals,
      };

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          intent_proposal: {
            ...validIntentProposal,
            action_kind: 'INVALID_ACTION',
          },
          reconciliation_proposal: validReconciliationProposal,
        })
      ).toThrow();

      expect(() =>
        TurnResultSchema.parse({
          ...baseResult,
          intent_proposal: validIntentProposal,
          reconciliation_proposal: {
            ...validReconciliationProposal,
            mode: 'INVALID_MODE',
          },
        })
      ).toThrow();
    });

    it('rejects more than 3 narrative blocks', () => {
      const invalidResult = {
        narrative_blocks: [
          { type: 'prose', content: 'Block 1' },
          { type: 'prose', content: 'Block 2' },
          { type: 'prose', content: 'Block 3' },
          { type: 'prose', content: 'Block 4' },
        ],
        intent_proposal: validIntentProposal,
        reconciliation_proposal: validReconciliationProposal,
        consequence_proposal: validConsequenceProposal,
        character_stance_proposal: validCharacterStanceProposal,
        character_relationship_proposal: validCharacterRelationshipProposal,
        character_memory_proposal: validCharacterMemoryProposal,
        world_memory_proposal: validWorldMemoryProposal,
        ...defaultHG1Proposals,
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 1,
          terminal_flags: [],
        },
      };

      expect(() => TurnResultSchema.parse(invalidResult)).toThrow();
    });

    it('rejects an unknown narrative block type', () => {
      expect(() =>
        TurnResultSchema.parse({
          narrative_blocks: [{ type: 'invented_type', content: 'Not a valid block.' }],
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
          ...defaultHG1Proposals,
          logic_state: {},
        })
      ).toThrow();
    });

    it('rejects non-string narrative content', () => {
      expect(() =>
        TurnResultSchema.parse({
          narrative_blocks: [{ type: 'prose', content: 42 }],
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
          ...defaultHG1Proposals,
          logic_state: {},
        })
      ).toThrow();
    });

    it('rejects an invalid topology expansion flag rather than coercing it', () => {
      expect(() =>
        TurnResultSchema.parse({
          narrative_blocks: [{ type: 'prose', content: 'The corridor remains still.' }],
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: validCharacterRelationshipProposal,
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
          ...defaultHG1Proposals,
          logic_state: {},
          topologyDelta: { isExpansion: 'false' },
        })
      ).toThrow();
    });

    it('validates TurnResponseSchema and confirms proposal keys are omitted from required schema', () => {
      const responseEnvelope = {
        narrative_blocks: [{ type: 'prose', content: 'Neutral observation.' }],
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 1,
          requested_transition: null,
          terminal_flags: [],
          cast_deltas: [],
        },
        intentReceipt: createIntentReceipt(validIntentProposal),
        narrativeReconciliationReceipt: createNarrativeReconciliationReceipt(
          validReconciliationProposal,
          'protagonist'
        ),
        canonicalConsequenceReceipt: {
          version: 1,
          pre_state: {
            inventory: [],
            player_injuries: [],
            psychological_status: 'STABLE',
          },
          post_state: {
            inventory: [],
            player_injuries: [],
            psychological_status: 'STABLE',
          },
          patch: {
            inventory_added: [],
            inventory_removed: [],
            injuries_added: [],
            injuries_removed: [],
            psychological_status_change: null,
          },
          decisions: [],
        },
        characterStanceReceipt: {
          version: 1,
          pre_state: {},
          post_state: {},
          decisions: [],
        },
        characterRelationshipReceipt: {
          version: 1,
          pre_state: [],
          post_state: [],
          decisions: [],
        },
        characterMemoryReceipt: {
          version: 1,
          pre_state: {},
          post_state: {},
          decisions: [],
        },
        worldMemoryReceipt: {
          version: 1,
          pre_state: [],
          post_state: [],
          decisions: [],
        },
        ...defaultTestHorrorGrammarReceipts,
      };

      const parsed = TurnResponseSchema.parse(responseEnvelope);
      expect(parsed.intentReceipt?.action_kind).toBe('INVESTIGATE');
      expect(parsed.narrativeReconciliationReceipt?.mode).toBe('CANONICAL');
      expect(parsed.canonicalConsequenceReceipt?.version).toBe(1);
      expect(parsed.characterStanceReceipt?.version).toBe(1);
      expect(parsed.characterRelationshipReceipt?.version).toBe(1);
      expect(parsed.characterMemoryReceipt?.version).toBe(1);
      expect(parsed.worldMemoryReceipt?.version).toBe(1);
      expect((parsed as Record<string, unknown>).intent_proposal).toBeUndefined();
      expect((parsed as Record<string, unknown>).reconciliation_proposal).toBeUndefined();
      expect((parsed as Record<string, unknown>).consequence_proposal).toBeUndefined();
      expect((parsed as Record<string, unknown>).character_stance_proposal).toBeUndefined();
      expect((parsed as Record<string, unknown>).character_relationship_proposal).toBeUndefined();
      expect((parsed as Record<string, unknown>).character_memory_proposal).toBeUndefined();
      expect((parsed as Record<string, unknown>).world_memory_proposal).toBeUndefined();
    });

    describe('RelationshipDelta canonical boundary validation', () => {
      it('accepts numeric delta -1 and 1', () => {
        expect(RelationshipDeltaSchema.parse(-1)).toBe(-1);
        expect(RelationshipDeltaSchema.parse(1)).toBe(1);

        const validResultNeg = {
          narrative_blocks: [{ type: 'prose', content: 'Observation.' }],
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: {
            changes: [
              {
                source_character_id: 'char_1',
                target_character_id: 'char_player',
                kind: 'TRUST',
                delta: -1,
                rationale: 'Faltered under pressure.',
              },
            ],
          },
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
          ...defaultHG1Proposals,
          logic_state: {
            current_phase: 'LATENT',
            suggested_tension: 1,
            terminal_flags: [],
          },
        };
        const parsedNeg = TurnResultSchema.parse(validResultNeg);
        expect(parsedNeg.character_relationship_proposal.changes[0].delta).toBe(-1);

        const validResultPos = {
          ...validResultNeg,
          character_relationship_proposal: {
            changes: [
              {
                source_character_id: 'char_1',
                target_character_id: 'char_player',
                kind: 'TRUST',
                delta: 1,
                rationale: 'Stood firm together.',
              },
            ],
          },
        };
        const parsedPos = TurnResultSchema.parse(validResultPos);
        expect(parsedPos.character_relationship_proposal.changes[0].delta).toBe(1);
      });

      it('rejects delta 0', () => {
        expect(() => RelationshipDeltaSchema.parse(0)).toThrow();

        const invalidResultZero = {
          narrative_blocks: [{ type: 'prose', content: 'Observation.' }],
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: {
            changes: [
              {
                source_character_id: 'char_1',
                target_character_id: 'char_player',
                kind: 'TRUST',
                delta: 0,
                rationale: 'Zero change is disallowed.',
              },
            ],
          },
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
          ...defaultHG1Proposals,
          logic_state: {
            current_phase: 'LATENT',
            suggested_tension: 1,
            terminal_flags: [],
          },
        };
        expect(() => TurnResultSchema.parse(invalidResultZero)).toThrow();
      });

      it('rejects string delta "-1" and "1"', () => {
        expect(() => RelationshipDeltaSchema.parse('-1')).toThrow();
        expect(() => RelationshipDeltaSchema.parse('1')).toThrow();

        const invalidResultStringNeg = {
          narrative_blocks: [{ type: 'prose', content: 'Observation.' }],
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: {
            changes: [
              {
                source_character_id: 'char_1',
                target_character_id: 'char_player',
                kind: 'TRUST',
                delta: '-1',
                rationale: 'String negative delta.',
              },
            ],
          },
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
          ...defaultHG1Proposals,
          logic_state: {
            current_phase: 'LATENT',
            suggested_tension: 1,
            terminal_flags: [],
          },
        };
        expect(() => TurnResultSchema.parse(invalidResultStringNeg)).toThrow();

        const invalidResultStringPos = {
          narrative_blocks: [{ type: 'prose', content: 'Observation.' }],
          intent_proposal: validIntentProposal,
          reconciliation_proposal: validReconciliationProposal,
          consequence_proposal: validConsequenceProposal,
          character_stance_proposal: validCharacterStanceProposal,
          character_relationship_proposal: {
            changes: [
              {
                source_character_id: 'char_1',
                target_character_id: 'char_player',
                kind: 'TRUST',
                delta: '1',
                rationale: 'String positive delta.',
              },
            ],
          },
          character_memory_proposal: validCharacterMemoryProposal,
          world_memory_proposal: validWorldMemoryProposal,
          ...defaultHG1Proposals,
          logic_state: {
            current_phase: 'LATENT',
            suggested_tension: 1,
            terminal_flags: [],
          },
        };
        expect(() => TurnResultSchema.parse(invalidResultStringPos)).toThrow();
      });
    });
  });

  describe('enforceNarrativeReconciliationBoundaries', () => {
    const baseModelResult = {
      narrative_blocks: [
        {
          type: 'prose' as const,
          content: 'A sudden burst of unreal light appears.',
          medium: 'direct' as const,
          delivery: 'spoken' as const,
          target: 'addressed' as const,
        },
      ],
      intent_proposal: {
        action_kind: 'MOVE' as const,
        action_subtype: null,
        pressure_direction: 'MAINTAIN' as const,
        dramatic_tactic: 'NONE' as const,
        intent_synergy: 'N/A' as const,
      },
      reconciliation_proposal: {
        mode: 'EXPERIENTIAL_REANCHORED' as const,
        feasibility: 'IMPOSSIBLE' as const,
        reason_code: 'PHYSICAL_LIMIT' as const,
        fictional_time_cost: 'MOMENT' as const,
        authority_alignment: 'NOT_APPLICABLE' as const,
        memory_echo_candidate: 'Unreal light flash.',
      },
      consequence_proposal: {
        mutations: [],
      },
      character_stance_proposal: {
        changes: [],
      },
      character_relationship_proposal: {
        changes: [],
      },
      character_memory_proposal: {
        candidates: [],
      },
      world_memory_proposal: {
        candidates: [],
      },
      cast_activity_proposal: {
        kind: 'NONE' as const,
        reason: 'NO_OPPORTUNITY_CHOSEN',
      },
      situated_pressure_proposal: {
        kind: 'NONE' as const,
        reason: 'NO_PRESSURE_CHOSEN',
      },
      value_state_proposal: {
        changes: [],
      },
      character_pursuit_proposal: {
        changes: [],
      },
      character_development_proposal: {
        changes: [],
      },
      pressure_transition_proposal: {
        transitions: [],
      },
      logic_state: {
        current_phase: 'LATENT',
        suggested_tension: 4,
        requested_transition: 'IMPOSSIBLE_ROOM',
        terminal_flags: ['FLAG_A'],
        cast_arrivals: [],
        cast_departures: [],
        cast_deltas: [{ character_id: 'char_1', skepticism_delta: 0.1 }],
        cast_ledger: [],
      },
      topologyDelta: {
        isExpansion: true,
        newNodeDef: {
          id: 'IMPOSSIBLE_ROOM',
          geometry: 'Chamber',
          hazards: [],
          exitVectors: [],
        },
      },
    };

    it('suppresses transition, expansion, and cast deltas for EXPERIENTIAL_REANCHORED mode', () => {
      const bounded = enforceNarrativeReconciliationBoundaries(baseModelResult);

      expect(bounded.logic_state.requested_transition).toBeNull();
      expect(bounded.logic_state.cast_deltas).toEqual([]);
      expect(bounded.topologyDelta).toEqual({ isExpansion: false, newNodeDef: null });

      // Preserves narrative, phase, tension, terminal flags, and proposals
      expect(bounded.narrative_blocks).toEqual(baseModelResult.narrative_blocks);
      expect(bounded.logic_state.current_phase).toBe('LATENT');
      expect(bounded.logic_state.suggested_tension).toBe(4);
      expect(bounded.logic_state.terminal_flags).toEqual(['FLAG_A']);
      expect(bounded.intent_proposal).toEqual(baseModelResult.intent_proposal);
      expect(bounded.reconciliation_proposal).toEqual(baseModelResult.reconciliation_proposal);
    });

    it('does not alter CANONICAL or MIXED results', () => {
      const canonicalResult = {
        ...baseModelResult,
        reconciliation_proposal: {
          ...baseModelResult.reconciliation_proposal,
          mode: 'CANONICAL' as const,
        },
      };

      const boundedCanonical = enforceNarrativeReconciliationBoundaries(canonicalResult);
      expect(boundedCanonical.logic_state.requested_transition).toBe('IMPOSSIBLE_ROOM');
      expect(boundedCanonical.logic_state.cast_deltas).toHaveLength(1);
      expect(boundedCanonical.topologyDelta?.isExpansion).toBe(true);

      const mixedResult = {
        ...baseModelResult,
        reconciliation_proposal: {
          ...baseModelResult.reconciliation_proposal,
          mode: 'MIXED' as const,
        },
      };

      const boundedMixed = enforceNarrativeReconciliationBoundaries(mixedResult);
      expect(boundedMixed.logic_state.requested_transition).toBe('IMPOSSIBLE_ROOM');
      expect(boundedMixed.logic_state.cast_deltas).toHaveLength(1);
      expect(boundedMixed.topologyDelta?.isExpansion).toBe(true);
    });

    it('normalizes authority alignment for antagonist vs non-antagonist roles', () => {
      const antagonistProposal = {
        mode: 'CANONICAL' as const,
        feasibility: 'SUPPORTED' as const,
        reason_code: 'NONE' as const,
        fictional_time_cost: 'MOMENT' as const,
        authority_alignment: 'WITHIN_CONTRACT' as const,
        memory_echo_candidate: null,
      };

      const nonAntagonistReceipt = createNarrativeReconciliationReceipt(
        antagonistProposal,
        'protagonist'
      );
      expect(nonAntagonistReceipt.authority_alignment).toBe('NOT_APPLICABLE');

      const antagonistReceipt = createNarrativeReconciliationReceipt(
        antagonistProposal,
        'antagonist'
      );
      expect(antagonistReceipt.authority_alignment).toBe('WITHIN_CONTRACT');
    });
  });

  describe('validateDialogueBlocks and resolveExplicitAddressedSpeakerId', () => {
    const context = EngineTurnContextSchema.parse({
      scenario: {
        title: 'Relay Outpost',
        premise: 'Isolated transmission tower.',
        worldRules: ['Atmospheric interference.'],
        setting: { location: 'Control Room', atmosphere: 'Cold', timePeriod: '1984' },
      },
      player: {
        role: 'protagonist',
        characterId: 'char-aria',
        name: 'Aria Bell',
        description: 'Protagonist operator.',
        isEntity: false,
      },
      cast: [
        {
          id: 'char-aria',
          name: 'Aria Bell',
          role: 'Protagonist',
          description: 'Lead operator.',
          isUserCharacter: true,
          isEntity: false,
          expressionProfile: {
            communicationModes: ['spoken'],
            expressionGuidance: 'Direct tone.',
          },
        },
        {
          id: 'char-jules',
          name: 'Jules Mercer',
          role: 'Technician',
          description: 'Relay technician.',
          isUserCharacter: false,
          isEntity: false,
          expressionProfile: {
            communicationModes: ['spoken', 'mediated'],
            expressionGuidance: 'Speaks rapidly.',
          },
        },
        {
          id: 'char-marcus',
          name: 'Dr. Marcus Sterling',
          role: 'Scientist',
          description: 'Station researcher.',
          isUserCharacter: false,
          isEntity: false,
          expressionProfile: {
            communicationModes: ['spoken'],
            expressionGuidance: 'Measured and analytical.',
          },
        },
        {
          id: 'char-signal',
          name: 'The Signal',
          role: 'Entity',
          description: 'An anomalous static frequency.',
          isUserCharacter: false,
          isEntity: true,
          expressionProfile: {
            communicationModes: ['nonverbal'],
            expressionGuidance: 'Pulsing interference.',
          },
        },
      ],
      topology: {
        currentNodeId: 'RELAY_ROOM',
        readableNodeLabel: 'Relay Room',
        allowedOutgoingExits: [],
      },
      runtime: {
        phase: 'LATENT',
        tension: 0,
        coherence: 1.0,
        reconciliationRevision: 0,
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
      },
    });

    describe('getIntentBoundAddressedCharacterId with resolveExplicitCastTarget', () => {
      const commReceipt = createIntentReceipt({
        action_kind: 'COMMUNICATE',
        action_subtype: null,
        pressure_direction: 'MAINTAIN',
        dramatic_tactic: 'NONE',
        intent_synergy: 'N/A',
      });

      it('resolves an action with exactly one eligible full authored name to that member ID', () => {
        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget(
              'I turn to Jules Mercer and ask if the relay is stable.',
              context
            )
          )
        ).toBe('char-jules');

        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget(
              'I request an analysis from Dr. Marcus Sterling on the readings.',
              context
            )
          )
        ).toBe('char-marcus');
      });

      it('matches full authored names regardless of punctuation and case', () => {
        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget(
              'Hey, "jules mercer"... can you hear that frequency?!',
              context
            )
          )
        ).toBe('char-jules');

        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget(
              'DR. MARCUS STERLING: check the oscilloscope right now!',
              context
            )
          )
        ).toBe('char-marcus');
      });

      it('resolves to null when two or more eligible names appear in the action', () => {
        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget(
              'I look between Jules Mercer and Dr. Marcus Sterling for an explanation.',
              context
            )
          )
        ).toBeNull();
      });

      it('resolves to null when naming a member whose isPresent is false', () => {
        const contextWithRemote = EngineTurnContextSchema.parse({
          ...context,
          cast: context.cast.map((c) =>
            c.id === 'char-jules' ? { ...c, isPresent: false } : c
          ),
        });

        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget(
              'I shout to Jules Mercer across the intercom.',
              contextWithRemote
            )
          )
        ).toBeNull();
      });

      it('resolves to null when naming only a nonverbal-only member', () => {
        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget(
              'I tune the radio dial toward The Signal to analyze its cadence.',
              context
            )
          )
        ).toBeNull();
      });

      it('resolves to null when no eligible full name is addressed', () => {
        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget('I check the dials on the mainframe.', context)
          )
        ).toBeNull();

        // Partial name only - should not infer
        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget('I ask Jules if the breaker tripped.', context)
          )
        ).toBeNull();

        // Player character addressed - should not match non-player target
        expect(
          getIntentBoundAddressedCharacterId(
            commReceipt,
            resolveExplicitCastTarget('Aria Bell inspects her own reflection.', context)
          )
        ).toBeNull();
      });
    });

    it('validates dialogue blocks correctly against authorized cast and constraints', () => {
      expect(validateDialogueBlocks(
        [{ type: 'dialogue', speaker: 'Jules Mercer' }],
        context
      )).toBeNull();

      expect(validateDialogueBlocks(
        [{ type: 'dialogue', speaker: 'Dr. Marcus Sterling' }],
        context
      )).toBeNull();

      expect(validateDialogueBlocks(
        [{ type: 'dialogue', speaker: 'A Stranger' }],
        context
      )).toContain('authorized cast');

      expect(validateDialogueBlocks(
        [{ type: 'dialogue', speaker: 'Aria Bell' }],
        context
      )).toContain('player-controlled');

      expect(validateDialogueBlocks(
        [{ type: 'dialogue', speaker: 'The Signal' }],
        context
      )).toContain('lacks spoken or mediated');

      const contextWithRemote = EngineTurnContextSchema.parse({
        ...context,
        cast: context.cast.map((c) =>
          c.id === 'char-jules' ? { ...c, isPresent: false } : c
        ),
      });

      const remoteBlock: { type: string; speaker: string; medium?: string } = { type: 'dialogue', speaker: 'Jules Mercer' };
      expect(validateDialogueBlocks(
        [remoteBlock],
        contextWithRemote
      )).toBeNull();
      expect(remoteBlock.type).toBe('transmission');
      expect(remoteBlock.medium).toBe('acoustic_bleed');

      expect(validateDialogueBlocks(
        [
          { type: 'dialogue', speaker: 'Jules Mercer' },
          { type: 'dialogue', speaker: 'Jules Mercer' },
        ],
        context
      )).toContain('at most one');

      // Speaker ID matching and normalization
      const idBlock = { type: 'dialogue', speaker: 'char-jules' };
      expect(validateDialogueBlocks([idBlock], context)).toBeNull();
      expect(idBlock.speaker).toBe('Jules Mercer');
    });

    it('supports multi-turn remote dialogue continuity across turns via recentHistory lookback', () => {
      const contextWithRemoteJules = EngineTurnContextSchema.parse({
        ...context,
        cast: context.cast.map((c) =>
          c.id === 'char-jules' ? { ...c, isPresent: false } : c
        ),
      });

      // Turn 1: User calls on phone -> Jules is absent but remote action keyword matches
      expect(
        validateDialogueBlocks(
          [{ type: 'dialogue', speaker: 'Jules Mercer' }],
          contextWithRemoteJules,
          null,
          'I call Jules on my cellular phone.'
        )
      ).toBeNull();

      // Turn 2: User says "Can you hear me?" (no phone keyword, Jules absent, but recentHistory has active call)
      const historyWithCall = [
        { role: 'user' as const, content: 'I call Jules on my cellular phone.' },
        { role: 'assistant' as const, content: 'Static hisses across the line. Jules answers.' },
      ];
      expect(
        validateDialogueBlocks(
          [{ type: 'dialogue', speaker: 'Jules Mercer' }],
          contextWithRemoteJules,
          null,
          'Can you hear me? Are you still on the line?',
          historyWithCall
        )
      ).toBeNull();

      // Turn 3: User hangs up -> channel is closed, Jules speech auto-resolves to acoustic bleed transmission rather than 502 error
      const hungUpBlock: { type: string; speaker: string; medium?: string } = { type: 'dialogue', speaker: 'Jules Mercer' };
      expect(
        validateDialogueBlocks(
          [hungUpBlock],
          contextWithRemoteJules,
          null,
          'I hang up the phone and pocket it.',
          historyWithCall
        )
      ).toBeNull();
      expect(hungUpBlock.type).toBe('transmission');
      expect(hungUpBlock.medium).toBe('acoustic_bleed');
    });

    it('validates ambient speakers and rejects unauthorized arbitrary characters', () => {
      expect(isRecognizedAmbientSpeaker('Waiter')).toBe(true);
      expect(isRecognizedAmbientSpeaker('Cab Driver')).toBe(true);
      expect(isRecognizedAmbientSpeaker('Dr. Montgomery')).toBe(false);

      // Ambient speakers succeed
      expect(
        validateDialogueBlocks(
          [{ type: 'dialogue', speaker: 'Waiter' }],
          context
        )
      ).toBeNull();

      expect(
        validateDialogueBlocks(
          [{ type: 'dialogue', speaker: 'Cab Driver' }],
          context
        )
      ).toBeNull();

      // Non-cast arbitrary character fails
      expect(
        validateDialogueBlocks(
          [{ type: 'dialogue', speaker: 'Dr. Montgomery' }],
          context
        )
      ).toBe('Dialogue speaker "Dr. Montgomery" is not in the authorized cast.');

      // resolveDialogueSpeakerId safely resolves ambient speaker to null
      expect(
        resolveDialogueSpeakerId(
          [{ type: 'dialogue', speaker: 'Waiter' }],
          context
        )
      ).toBeNull();
    });

    it('allows dialogue on arrival turn when cast member arrives via arrivedCastIds', () => {
      const contextWithAbsentJules = EngineTurnContextSchema.parse({
        ...context,
        cast: context.cast.map((c) =>
          c.id === 'char-jules' ? { ...c, isPresent: false } : c
        ),
      });

      // Without arrival: auto-remediates to acoustic bleed transmission rather than failing
      const absentBlock: { type: string; speaker: string; medium?: string } = { type: 'dialogue', speaker: 'Jules Mercer' };
      expect(
        validateDialogueBlocks(
          [absentBlock],
          contextWithAbsentJules,
          null,
          'I wait in the foyer.'
        )
      ).toBeNull();
      expect(absentBlock.type).toBe('transmission');
      expect(absentBlock.medium).toBe('acoustic_bleed');

      // With arrivedCastIds including char-jules: succeeds!
      const arrivedCastIds = new Set(['char-jules']);
      expect(
        validateDialogueBlocks(
          [{ type: 'dialogue', speaker: 'Jules Mercer' }],
          contextWithAbsentJules,
          null,
          'I wait in the foyer.',
          undefined,
          arrivedCastIds
        )
      ).toBeNull();
    });

    it('preserves cast expression profile through EngineTurnContextSchema.parse', () => {
      const castWithProfile = [
        {
          id: 'char-jules',
          name: 'Jules Mercer',
          role: 'Technician',
          expressionProfile: {
            communicationModes: ['spoken', 'mediated'] as const,
            expressionGuidance: 'Terse sentences.',
            silenceGuidance: 'Silence means checking instruments.',
          },
        },
      ];
      const parsed = EngineTurnContextSchema.parse({
        scenario: {
          title: 'Test',
          setting: {
            location: 'Relay Room',
            atmosphere: '',
            timePeriod: 'Present',
          },
        },
        player: { role: 'protagonist', name: 'Aria' },
        cast: castWithProfile,
        topology: { currentNodeId: 'ROOM_1', readableNodeLabel: 'Room 1' },
        runtime: {},
      });
      expect(parsed.cast[0].expressionProfile).toEqual({
        communicationModes: ['spoken', 'mediated'],
        expressionGuidance: 'Terse sentences.',
        silenceGuidance: 'Silence means checking instruments.',
      });
    });
  });

  describe('formatCastLedger', () => {
    it('formats authored behavior and expression profile when present and gracefully handles empty behavioral fields and missing profiles', () => {
      const contextWithAuthored = EngineTurnContextSchema.parse({
        scenario: {
          title: 'Deep Research Station',
          setting: {
            location: 'Sub-Level 4',
            atmosphere: 'Pressurized humming',
            timePeriod: '2088',
          },
        },
        player: {
          role: 'protagonist',
          name: 'Elena Rostova',
        },
        cast: [
          {
            id: 'char-jules',
            name: 'Jules Mercer',
            role: 'Technician',
            description: 'Avionics and radio technician.',
            personality: 'Taciturn and anxious under pressure.',
            goals: 'Restore primary relay power without alerting the entity.',
            traits: ['Analytical', 'Pragmatic', 'Jittery'],
            isEntity: false,
            expressionProfile: {
              communicationModes: ['spoken', 'mediated'],
              expressionGuidance: 'Terse, fragmented telemetry reports.',
              silenceGuidance: 'Long pauses mean manual re-wiring.',
            },
          },
          {
            id: 'char-sentry',
            name: 'Automated Sentry',
            role: 'Defense Grid',
            description: 'Hardwired ceiling turret.',
            personality: '',
            goals: '',
            traits: [],
            isEntity: true,
          },
        ],
        topology: {
          currentNodeId: 'SUB_04',
          readableNodeLabel: 'Sub-Level 04',
        },
        runtime: {},
      });

      const formatted = formatCastLedger(contextWithAuthored);

      // Assert member with all three authored behavioral fields and expression profile
      expect(formatted).toContain('• Jules Mercer (ID: char-jules, Role: Technician, Entity: FALSE, Skepticism: 0.50, Presence: HERE): Avionics and radio technician.');
      expect(formatted).toContain('Personality: Taciturn and anxious under pressure.');
      expect(formatted).toContain('Goals: Restore primary relay power without alerting the entity.');
      expect(formatted).toContain('Traits: Analytical, Pragmatic, Jittery.');
      expect(formatted).toContain('Communication modes: spoken, mediated.');
      expect(formatted).toContain('Expression guidance: Terse, fragmented telemetry reports.');
      expect(formatted).toContain('Silence guidance: Long pauses mean manual re-wiring.');

      // Assert member with empty behavioral fields
      expect(formatted).toContain('• Automated Sentry (ID: char-sentry, Role: Defense Grid, Entity: TRUE, Skepticism: 0.50, Presence: HERE): Hardwired ceiling turret.');
      expect(formatted).toContain('Communication modes: spoken (legacy compatibility; no additional expression guidance).');

      // Ensure empty member line does NOT contain "Personality:", "Goals:", or "Traits:"
      const sentryLine = formatted.split('\n').find((l) => l.includes('Automated Sentry'));
      expect(sentryLine).toBeDefined();
      expect(sentryLine).not.toContain('Personality:');
      expect(sentryLine).not.toContain('Goals:');
      expect(sentryLine).not.toContain('Traits:');
    });

    it('formats Presence: ELSEWHERE when isPresent is false', () => {
      const contextWithRemote = EngineTurnContextSchema.parse({
        scenario: {
          title: 'Deep Research Station',
          setting: {
            location: 'Sub-Level 4',
            atmosphere: '',
            timePeriod: '',
          },
        },
        player: {
          role: 'protagonist',
          name: 'Elena Rostova',
        },
        cast: [
          {
            id: 'char-remote',
            name: 'Remote Observer',
            role: 'Witness',
            description: 'Monitoring from surface station.',
            isPresent: false,
          },
        ],
        topology: {
          currentNodeId: 'SUB_04',
          readableNodeLabel: 'Sub-Level 04',
        },
        runtime: {},
      });

      const formatted = formatCastLedger(contextWithRemote);
      expect(formatted).toContain('• Remote Observer (ID: char-remote, Role: Witness, Entity: FALSE, Skepticism: 0.50, Presence: ELSEWHERE): Monitoring from surface station.');
    });

    it('returns solitary subject when cast is empty', () => {
      const emptyContext = EngineTurnContextSchema.parse({
        scenario: {
          title: 'Empty Void',
          setting: {
            location: 'Void',
            atmosphere: '',
            timePeriod: '',
          },
        },
        player: { role: 'protagonist', name: 'Alone' },
        cast: [],
        topology: { currentNodeId: 'VOID', readableNodeLabel: 'Void' },
        runtime: {},
      });
      expect(formatCastLedger(emptyContext)).toBe('• Solitary subject.');
    });
  });

  describe('normalizeCastSkepticismDeltas', () => {
    const testContext = EngineTurnContextSchema.parse({
      scenario: {
        title: 'Facility',
        setting: { location: 'Lab', atmosphere: '', timePeriod: '' },
      },
      player: {
        role: 'protagonist',
        characterId: 'char-player',
        name: 'Player',
      },
      cast: [
        {
          id: 'char-player',
          name: 'Player',
          isUserCharacter: true,
        },
        {
          id: 'char-npc1',
          name: 'NPC 1',
          skepticism: 0.7,
        },
        {
          id: 'char-npc2',
          name: 'NPC 2',
          skepticism: 0.4,
        },
      ],
      topology: {
        currentNodeId: 'LAB',
        readableNodeLabel: 'Lab',
      },
      runtime: {},
    });

    it('normalizes valid deltas and clamps magnitude to [-0.15, 0.15]', () => {
      const result = normalizeCastSkepticismDeltas(
        [
          { character_id: 'char-npc1', skepticism_delta: 0.1 },
          { character_id: 'char-npc2', skepticism_delta: -0.5 }, // clamped to -0.15
        ],
        testContext
      );

      expect(result).toEqual([
        { character_id: 'char-npc1', skepticism_delta: 0.1 },
        { character_id: 'char-npc2', skepticism_delta: -0.15 },
      ]);
    });

    it('discards deltas for player character, unknown IDs, duplicates, and zero deltas', () => {
      const result = normalizeCastSkepticismDeltas(
        [
          { character_id: 'char-player', skepticism_delta: -0.1 }, // player: discard
          { character_id: 'unknown-npc', skepticism_delta: 0.05 }, // unknown: discard
          { character_id: 'char-npc1', skepticism_delta: 0.12 }, // valid
          { character_id: 'char-npc1', skepticism_delta: -0.05 }, // duplicate: discard
          { character_id: 'char-npc2', skepticism_delta: 0 }, // zero delta: discard
        ],
        testContext
      );

      expect(result).toEqual([
        { character_id: 'char-npc1', skepticism_delta: 0.12 },
      ]);
    });
  });

  describe('resolveDialogueSpeakerId', () => {
    const testContext = EngineTurnContextSchema.parse({
      scenario: {
        title: 'Facility',
        setting: { location: 'Node-1', atmosphere: '', timePeriod: '' },
      },
      player: {
        role: 'protagonist',
        characterId: 'char-p',
        name: 'Subject P',
      },
      cast: [
        {
          id: 'char-a',
          name: 'Operative A',
          isUserCharacter: false,
        },
        {
          id: 'char-b',
          name: 'Operative B',
          isUserCharacter: false,
        },
      ],
      topology: {
        currentNodeId: 'NODE_01',
        readableNodeLabel: 'Node 01',
      },
      runtime: {},
    });

    it('resolves dialogue speaker name to corresponding authorized cast member ID, not raw speaker text', () => {
      const blocks = [
        { type: 'prose', content: 'Observation recorded.' },
        { type: 'dialogue', speaker: 'Operative A', content: 'Status normal.' },
      ];

      const resolvedId = resolveDialogueSpeakerId(blocks, testContext);
      expect(resolvedId).toBe('char-a');
      expect(resolvedId).not.toBe('Operative A');
    });

    it('resolves dialogue speaker when speaker is provided as character ID', () => {
      const blocks = [
        { type: 'prose', content: 'Observation recorded.' },
        { type: 'dialogue', speaker: 'char-a', content: 'Status normal.' },
      ];

      const resolvedId = resolveDialogueSpeakerId(blocks, testContext);
      expect(resolvedId).toBe('char-a');
    });

    it('returns null when no dialogue block is present', () => {
      const blocks = [
        { type: 'prose', content: 'Only ambient prose.' },
        { type: 'environmental_description', content: 'Humming frequency.' },
      ];

      expect(resolveDialogueSpeakerId(blocks, testContext)).toBeNull();
    });

    it('returns null when dialogue speaker is missing or does not match authorized cast', () => {
      expect(
        resolveDialogueSpeakerId(
          [{ type: 'dialogue', speaker: '', content: '...' }],
          testContext
        )
      ).toBeNull();

      expect(
        resolveDialogueSpeakerId(
          [{ type: 'dialogue', speaker: 'Unknown Subject', content: '...' }],
          testContext
        )
      ).toBeNull();
    });

    it('returns null when multiple dialogue blocks exist', () => {
      const blocks = [
        { type: 'dialogue', speaker: 'Operative A', content: 'First line.' },
        { type: 'dialogue', speaker: 'Operative A', content: 'Second line.' },
      ];

      expect(resolveDialogueSpeakerId(blocks, testContext)).toBeNull();
    });
  });

  describe('Server response cast interaction receipt derivation', () => {
    const testContext = EngineTurnContextSchema.parse({
      scenario: {
        title: 'Enclosure',
        setting: { location: 'Node-1', atmosphere: '', timePeriod: '' },
      },
      player: {
        role: 'protagonist',
        characterId: 'char-p',
        name: 'Player',
      },
      cast: [
        {
          id: 'char-a',
          name: 'Operative A',
          isPresent: true,
          expressionProfile: { communicationModes: ['spoken'], expressionGuidance: 'Terse' },
        },
        {
          id: 'char-b',
          name: 'Operative B',
          isPresent: true,
          expressionProfile: { communicationModes: ['spoken'], expressionGuidance: 'Direct' },
        },
      ],
      topology: {
        currentNodeId: 'NODE_01',
        readableNodeLabel: 'Node 01',
      },
      runtime: {},
    });

    it('derives RESPONDED receipt with cast IDs for valid addressed reply', () => {
      const userAction = 'I speak to Operative A about telemetry.';
      const castTarget = resolveExplicitCastTarget(userAction, testContext);
      const intentReceipt = createIntentReceipt({
        action_kind: 'COMMUNICATE',
        action_subtype: null,
        pressure_direction: 'MAINTAIN',
        dramatic_tactic: 'NONE',
        intent_synergy: 'N/A',
      });
      const addressedId = getIntentBoundAddressedCharacterId(intentReceipt, castTarget);
      expect(addressedId).toBe('char-a');

      const narrativeBlocks = [
        { type: 'dialogue', speaker: 'Operative A', content: 'Telemetry verified.' },
      ];

      const respondingId = resolveDialogueSpeakerId(narrativeBlocks, testContext);
      expect(respondingId).toBe('char-a');

      const receipt = createIntentBoundCastInteractionReceipt({
        intentReceipt,
        castTarget,
        respondingCharacterId: respondingId,
      });

      expect(receipt).toEqual({
        version: 1,
        addressedCharacterId: 'char-a',
        respondingCharacterId: 'char-a',
        outcome: 'RESPONDED',
      });

      // Verify TurnResponseSchema parses the response with receipt
      const validatedEnvelope = TurnResponseSchema.parse({
        narrative_blocks: narrativeBlocks,
        logic_state: {},
        castInteractionReceipt: receipt,
        canonicalConsequenceReceipt: {
          version: 1,
          pre_state: {
            inventory: [],
            player_injuries: [],
            psychological_status: 'STABLE',
          },
          post_state: {
            inventory: [],
            player_injuries: [],
            psychological_status: 'STABLE',
          },
          patch: {
            inventory_added: [],
            inventory_removed: [],
            injuries_added: [],
            injuries_removed: [],
            psychological_status_change: null,
          },
          decisions: [],
        },
        characterStanceReceipt: {
          version: 1,
          pre_state: {},
          post_state: {},
          decisions: [],
        },
        characterRelationshipReceipt: {
          version: 1,
          pre_state: [],
          post_state: [],
          decisions: [],
        },
        characterMemoryReceipt: {
          version: 1,
          pre_state: {},
          post_state: {},
          decisions: [],
        },
        worldMemoryReceipt: {
          version: 1,
          pre_state: [],
          post_state: [],
          decisions: [],
        },
        ...defaultTestHorrorGrammarReceipts,
      });

      expect(validatedEnvelope.castInteractionReceipt?.outcome).toBe('RESPONDED');
      expect(validatedEnvelope.castInteractionReceipt?.addressedCharacterId).toBe('char-a');
      expect(validatedEnvelope.castInteractionReceipt?.respondingCharacterId).toBe('char-a');
    });

    it('derives ADDRESS_UNANSWERED receipt for addressed turn with no dialogue', () => {
      const userAction = 'I ask Operative A for confirmation.';
      const castTarget = resolveExplicitCastTarget(userAction, testContext);
      const intentReceipt = createIntentReceipt({
        action_kind: 'COMMUNICATE',
        action_subtype: null,
        pressure_direction: 'MAINTAIN',
        dramatic_tactic: 'NONE',
        intent_synergy: 'N/A',
      });
      const addressedId = getIntentBoundAddressedCharacterId(intentReceipt, castTarget);
      expect(addressedId).toBe('char-a');

      const narrativeBlocks = [
        { type: 'prose', content: 'Operative A remains silent, observing the monitor.' },
      ];

      const respondingId = resolveDialogueSpeakerId(narrativeBlocks, testContext);
      expect(respondingId).toBeNull();

      const receipt = createIntentBoundCastInteractionReceipt({
        intentReceipt,
        castTarget,
        respondingCharacterId: respondingId,
      });

      expect(receipt).toEqual({
        version: 1,
        addressedCharacterId: 'char-a',
        respondingCharacterId: null,
        outcome: 'ADDRESS_UNANSWERED',
      });
    });

    it('derives UNSOLICITED_DIALOGUE receipt for valid unaddressed dialogue turn', () => {
      const userAction = 'I check the console interface.';
      const castTarget = resolveExplicitCastTarget(userAction, testContext);
      const intentReceipt = createIntentReceipt({
        action_kind: 'MANIPULATE',
        action_subtype: null,
        pressure_direction: 'MAINTAIN',
        dramatic_tactic: 'NONE',
        intent_synergy: 'N/A',
      });
      const addressedId = getIntentBoundAddressedCharacterId(intentReceipt, castTarget);
      expect(addressedId).toBeNull();

      const narrativeBlocks = [
        { type: 'dialogue', speaker: 'Operative B', content: 'Grid power fluctuating.' },
      ];

      const respondingId = resolveDialogueSpeakerId(narrativeBlocks, testContext);
      expect(respondingId).toBe('char-b');

      const receipt = createIntentBoundCastInteractionReceipt({
        intentReceipt,
        castTarget,
        respondingCharacterId: respondingId,
      });

      expect(receipt).toEqual({
        version: 1,
        addressedCharacterId: null,
        respondingCharacterId: 'char-b',
        outcome: 'UNSOLICITED_DIALOGUE',
      });
    });

    it('derives MISMATCH receipt when addressed and responding characters are distinct', () => {
      const receipt = createCastInteractionReceipt({
        addressedCharacterId: 'char-a',
        respondingCharacterId: 'char-b',
      });

      expect(receipt).toEqual({
        version: 1,
        addressedCharacterId: 'char-a',
        respondingCharacterId: 'char-b',
        outcome: 'MISMATCH',
      });
    });

    it('derives NONE receipt when neither addressed nor responding dialogue is present', () => {
      const receipt = createCastInteractionReceipt({
        addressedCharacterId: null,
        respondingCharacterId: null,
      });

      expect(receipt).toEqual({
        version: 1,
        addressedCharacterId: null,
        respondingCharacterId: null,
        outcome: 'NONE',
      });
    });
  });

  describe('Phase 3G.2B: Causal Feasibility Integration (finalizeTurnCausality)', () => {
    const baseContext = EngineTurnContextSchema.parse({
      scenario: {
        title: 'Sector 7 Facility',
        premise: 'Contained environmental research compound.',
        worldRules: ['Air filtration requires active power.'],
        setting: { location: 'Control Hub', atmosphere: 'Sterile', timePeriod: '2094' },
      },
      player: {
        role: 'protagonist',
        characterId: 'char-player',
        name: 'Operative Cole',
        description: 'Lead surveyor',
      },
      cast: [
        {
          id: 'char-player',
          name: 'Operative Cole',
          role: 'Surveyor',
          isUserCharacter: true,
        },
        {
          id: 'char-elena',
          name: 'Dr. Elena Rhodes',
          role: 'Analyst',
          isPresent: true,
          skepticism: 0.8,
          expressionProfile: {
            communicationModes: ['spoken', 'mediated'],
            expressionGuidance: 'Precise and methodical.',
          },
        },
        {
          id: 'char-remote',
          name: 'Supervisor Ward',
          role: 'Coordinator',
          isPresent: false,
          skepticism: 0.5,
          expressionProfile: {
            communicationModes: ['spoken'],
            expressionGuidance: 'Remote coordination instructions.',
          },
        },
        {
          id: 'char-probe',
          name: 'Autonomous Probe',
          role: 'Sensor Drone',
          isPresent: true,
          skepticism: 0.5,
          expressionProfile: {
            communicationModes: ['nonverbal'],
            expressionGuidance: 'Mechanical sensor sweeps and light indicators.',
          },
        },
      ],
      topology: {
        currentNodeId: 'CONTROL_HUB',
        readableNodeLabel: 'Control Hub',
        allowedOutgoingExits: [
          {
            from: 'CONTROL_HUB',
            to: 'AIRLOCK_01',
            kind: 'PHYSICAL',
            userInitiated: true,
          },
        ],
      },
      runtime: {
        phase: 'LATENT',
        tension: 1,
        coherence: 1.0,
        reconciliationRevision: 0,
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
      },
    });

    const defaultHG1Proposals = {
      cast_activity_proposal: {
        kind: 'NONE' as const,
        reason: 'NO_OPPORTUNITY_CHOSEN' as const,
      },
      situated_pressure_proposal: {
        kind: 'NONE' as const,
        reason: 'NO_PRESSURE_CHOSEN' as const,
      },
      value_state_proposal: {
        changes: [],
      },
      character_pursuit_proposal: {
        changes: [],
      },
      character_development_proposal: {
        changes: [],
      },
      pressure_transition_proposal: {
        transitions: [],
      },
    };

    it('handles invalid move despite optimistic model metadata (Case 1)', () => {
      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [
          { type: 'prose', content: 'You sprint through a non-existent breach into Sector Zero.' },
        ],
        intent_proposal: {
          action_kind: 'MOVE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 3,
          requested_transition: 'UNCONNECTED_SECTOR_ZERO',
          terminal_flags: [],
          cast_deltas: [{ character_id: 'char-elena', skepticism_delta: -0.1 }],
        },
        topologyDelta: {
          isExpansion: true,
          newNodeDef: {
            id: 'UNCONNECTED_SECTOR_ZERO',
            geometry: 'Chamber',
            hazards: [],
            exitVectors: [],
          },
        },
      });

      const userAction = 'I run into Sector Zero.';
      const output = finalizeTurnCausality({
        result: modelResult,
        userAction,
        context: baseContext,
      });

      // Assert causal feasibility result
      expect(output.causal.feasibility).toBe('CONSTRAINED');
      expect(output.causal.reason_code).toBe('TOPOLOGY_LIMIT');
      expect(output.causal.suppressStructuralDeltas).toBe(false);

      // Assert narrative reconciliation receipt
      expect(output.narrativeReconciliationReceipt.feasibility).toBe('CONSTRAINED');
      expect(output.narrativeReconciliationReceipt.reason_code).toBe('TOPOLOGY_LIMIT');
      expect(output.narrativeReconciliationReceipt.mode).toBe('CANONICAL');
      expect(output.narrativeReconciliationReceipt.revision_increment).toBe(0);

      // Assert structural suppression does not occur
      expect(output.boundedResult.logic_state.requested_transition).toBe('UNCONNECTED_SECTOR_ZERO');
      expect(output.boundedResult.logic_state.cast_deltas).toEqual([{ character_id: 'char-elena', skepticism_delta: -0.1 }]);
      expect(output.boundedResult.topologyDelta).toEqual({ isExpansion: false, newNodeDef: null });

      // Assert narrative blocks preserved
      expect(output.boundedResult.narrative_blocks).toEqual(modelResult.narrative_blocks);

      // Assert final transition is not accepted
      expect(output.transitionReceipt.accepted).toBe(false);
      expect(output.transitionReceipt.requestedNodeId).toBe('UNCONNECTED_SECTOR_ZERO');
    });

    it('handles accepted mapped move (Case 2)', () => {
      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [
          { type: 'prose', content: 'You cycle through the primary airlock hatch.' },
        ],
        intent_proposal: {
          action_kind: 'MOVE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 2,
          requested_transition: 'AIRLOCK_01',
          terminal_flags: [],
          cast_deltas: [{ character_id: 'char-elena', skepticism_delta: 0.05 }],
        },
        topologyDelta: { isExpansion: false, newNodeDef: null },
      });

      const userAction = 'I proceed to Airlock 01.';
      const output = finalizeTurnCausality({
        result: modelResult,
        userAction,
        context: baseContext,
      });

      // Assert causal feasibility and receipt
      expect(output.causal.feasibility).toBe('SUPPORTED');
      expect(output.causal.reason_code).toBe('NONE');
      expect(output.causal.suppressStructuralDeltas).toBe(false);
      expect(output.narrativeReconciliationReceipt.feasibility).toBe('SUPPORTED');
      expect(output.narrativeReconciliationReceipt.reason_code).toBe('NONE');
      expect(output.narrativeReconciliationReceipt.mode).toBe('CANONICAL');
      expect(output.narrativeReconciliationReceipt.revision_increment).toBe(0);

      // Assert transition remains accepted
      expect(output.transitionReceipt.accepted).toBe(true);
      expect(output.transitionReceipt.toNodeId).toBe('AIRLOCK_01');
      expect(output.boundedResult.logic_state.requested_transition).toBe('AIRLOCK_01');
    });

    it('handles communication to an absent exact target (Case 3)', () => {
      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [
          { type: 'prose', content: 'You speak into the empty control room calling for Ward.' },
        ],
        intent_proposal: {
          action_kind: 'COMMUNICATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 2,
          requested_transition: null,
          terminal_flags: [],
          cast_deltas: [{ character_id: 'char-elena', skepticism_delta: 0.1 }],
        },
        topologyDelta: {
          isExpansion: true,
          newNodeDef: { id: 'EXTRA_ROOM', geometry: 'Chamber', hazards: [], exitVectors: [] },
        },
      });

      const userAction = 'I ask Supervisor Ward for clearance.';
      const output = finalizeTurnCausality({
        result: modelResult,
        userAction,
        context: baseContext,
      });

      expect(output.castTarget.status).toBe('ABSENT');
      expect(output.causal.feasibility).toBe('IMPOSSIBLE');
      expect(output.causal.reason_code).toBe('CAST_PRESENCE_LIMIT');
      expect(output.causal.suppressStructuralDeltas).toBe(true);
      expect(output.narrativeReconciliationReceipt.feasibility).toBe('IMPOSSIBLE');
      expect(output.narrativeReconciliationReceipt.reason_code).toBe('CAST_PRESENCE_LIMIT');
      expect(output.narrativeReconciliationReceipt.mode).toBe('EXPERIENTIAL_REANCHORED');

      // Assert structural deltas suppressed while prose remains
      expect(output.boundedResult.logic_state.cast_deltas).toEqual([]);
      expect(output.boundedResult.topologyDelta).toEqual({ isExpansion: false, newNodeDef: null });
      expect(output.boundedResult.narrative_blocks).toEqual(modelResult.narrative_blocks);
    });

    it('handles communication to an ineligible nonverbal exact target (Case 3 variant)', () => {
      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [
          { type: 'prose', content: 'You talk to the sensor drone.' },
        ],
        intent_proposal: {
          action_kind: 'COMMUNICATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 1,
          requested_transition: null,
          terminal_flags: [],
          cast_deltas: [],
        },
      });

      const userAction = 'I ask Autonomous Probe for a status report.';
      const output = finalizeTurnCausality({
        result: modelResult,
        userAction,
        context: baseContext,
      });

      expect(output.castTarget.status).toBe('INELIGIBLE');
      expect(output.causal.feasibility).toBe('IMPOSSIBLE');
      expect(output.causal.reason_code).toBe('CAST_PRESENCE_LIMIT');
      expect(output.causal.suppressStructuralDeltas).toBe(true);
    });

    it('evaluates insufficient server evidence as UNCLEAR / NONE without forced suppression (Case 4)', () => {
      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [
          { type: 'prose', content: 'You attempt to bypass the pneumatic valve linkage.' },
        ],
        intent_proposal: {
          action_kind: 'MANIPULATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 2,
          requested_transition: null,
          terminal_flags: [],
          cast_deltas: [{ character_id: 'char-elena', skepticism_delta: 0.05 }],
        },
      });

      const userAction = 'I force the pneumatic valve lever.';
      const output = finalizeTurnCausality({
        result: modelResult,
        userAction,
        context: baseContext,
      });

      // Feasibility becomes UNCLEAR / NONE
      expect(output.causal.feasibility).toBe('UNCLEAR');
      expect(output.causal.reason_code).toBe('NONE');
      expect(output.causal.suppressStructuralDeltas).toBe(false);

      expect(output.narrativeReconciliationReceipt.feasibility).toBe('UNCLEAR');
      expect(output.narrativeReconciliationReceipt.reason_code).toBe('NONE');
      expect(output.narrativeReconciliationReceipt.mode).toBe('CANONICAL');

      // Does not gain structural suppression merely because evidence is unknown
      expect(output.boundedResult.logic_state.cast_deltas).toHaveLength(1);
    });

    it('normalizes authority alignment for non-antagonist and antagonist roles (Case 5)', () => {
      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [{ type: 'prose', content: 'Observation.' }],
        intent_proposal: {
          action_kind: 'INVESTIGATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'WITHIN_CONTRACT',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {},
      });

      // 1. Non-antagonist: role is protagonist -> NOT_APPLICABLE
      const nonAntagonistOutput = finalizeTurnCausality({
        result: modelResult,
        userAction: 'I inspect the gauges.',
        context: baseContext,
      });
      expect(nonAntagonistOutput.causal.authority_alignment).toBe('NOT_APPLICABLE');
      expect(nonAntagonistOutput.narrativeReconciliationReceipt.authority_alignment).toBe(
        'NOT_APPLICABLE'
      );

      // 2. Antagonist with complete contract: preserves WITHIN_CONTRACT
      const antagonistContext = EngineTurnContextSchema.parse({
        ...baseContext,
        player: {
          role: 'antagonist',
          characterId: 'char-antagonist',
          name: 'The Facility AI',
          description: 'Hostile mainframe',
        },
        participationContext: {
          mode: 'antagonist',
          seat: { kind: 'force', name: 'The Facility AI' },
          initialGoal: 'Subdue occupants',
          boundedFacts: ['All cameras are functional.'],
          authorityContract: {
            authority: 'Can control facility lighting and door seals.',
            limits: 'Cannot mutate physical bulkheads directly.',
          },
          victimField: {
            kind: 'group',
            collectiveDesignation: 'Survivors',
            members: [],
          },
        },
      });

      const antagonistOutput = finalizeTurnCausality({
        result: modelResult,
        userAction: 'I observe the survivors from the ceiling monitors.',
        context: antagonistContext,
      });
      expect(antagonistOutput.causal.authority_alignment).toBe('WITHIN_CONTRACT');
      expect(antagonistOutput.narrativeReconciliationReceipt.authority_alignment).toBe('WITHIN_CONTRACT');

      // 3. Antagonist without contract: normalized to EXCEEDS_CONTRACT
      const antagonistNoContractContext = EngineTurnContextSchema.parse({
        ...baseContext,
        player: {
          role: 'antagonist',
          characterId: 'char-antagonist',
          name: 'The Facility AI',
          description: 'Hostile mainframe',
        },
      });

      const antagonistNoContractOutput = finalizeTurnCausality({
        result: modelResult,
        userAction: 'I observe the survivors.',
        context: antagonistNoContractContext,
      });
      expect(antagonistNoContractOutput.causal.feasibility).toBe('IMPOSSIBLE');
      expect(antagonistNoContractOutput.causal.reason_code).toBe('AUTHORITY_LIMIT');
      expect(antagonistNoContractOutput.causal.authority_alignment).toBe('EXCEEDS_CONTRACT');
      expect(antagonistNoContractOutput.narrativeReconciliationReceipt.authority_alignment).toBe('EXCEEDS_CONTRACT');
    });

    it('suppresses structural deltas for Director MOVE and MANIPULATE while retaining prose', () => {
      const directorContext = EngineTurnContextSchema.parse({
        ...baseContext,
        player: {
          role: 'director',
          name: 'Director',
          description: 'Framing narrative',
        },
      });

      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [
          { type: 'prose', content: 'The camera cuts to the airlock corridor.' },
        ],
        intent_proposal: {
          action_kind: 'MOVE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {
          requested_transition: 'AIRLOCK_01',
          cast_deltas: [{ character_id: 'char-elena', skepticism_delta: 0.1 }],
        },
        topologyDelta: {
          isExpansion: true,
          newNodeDef: { id: 'NEW_ZONE', geometry: 'Corridor', hazards: [], exitVectors: [] },
        },
      });

      const output = finalizeTurnCausality({
        result: modelResult,
        userAction: 'Cut to the airlock corridor.',
        context: directorContext,
      });

      expect(output.causal.feasibility).toBe('CONSTRAINED');
      expect(output.causal.reason_code).toBe('AUTHORITY_LIMIT');
      expect(output.causal.suppressStructuralDeltas).toBe(true);
      expect(output.narrativeReconciliationReceipt.mode).toBe('EXPERIENTIAL_REANCHORED');

      expect(output.boundedResult.logic_state.requested_transition).toBeNull();
      expect(output.boundedResult.logic_state.cast_deltas).toEqual([]);
      expect(output.boundedResult.topologyDelta).toEqual({ isExpansion: false, newNodeDef: null });
      expect(output.boundedResult.narrative_blocks).toEqual(modelResult.narrative_blocks);
      expect(output.transitionReceipt.accepted).toBe(false);
    });

    it('suppresses structural deltas for Witness active actions while retaining prose', () => {
      const witnessContext = EngineTurnContextSchema.parse({
        ...baseContext,
        player: {
          role: 'witness',
          name: 'Witness',
          description: 'Observer in shadows',
        },
      });

      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [
          { type: 'prose', content: 'You try to turn the lever but remain merely a phantom observer.' },
        ],
        intent_proposal: {
          action_kind: 'MANIPULATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {
          cast_deltas: [{ character_id: 'char-elena', skepticism_delta: 0.1 }],
        },
      });

      const output = finalizeTurnCausality({
        result: modelResult,
        userAction: 'I pull the lever.',
        context: witnessContext,
      });

      expect(output.causal.feasibility).toBe('CONSTRAINED');
      expect(output.causal.reason_code).toBe('AUTHORITY_LIMIT');
      expect(output.causal.suppressStructuralDeltas).toBe(true);
      expect(output.narrativeReconciliationReceipt.mode).toBe('EXPERIENTIAL_REANCHORED');

      expect(output.boundedResult.logic_state.cast_deltas).toEqual([]);
      expect(output.boundedResult.narrative_blocks).toEqual(modelResult.narrative_blocks);
    });

    it('ensures final TurnResponseSchema output omits proposal keys (Case 6)', () => {
      const modelResult = TurnResultSchema.parse({
        narrative_blocks: [{ type: 'prose', content: 'Telemetry updated.' }],
        intent_proposal: {
          action_kind: 'SYSTEM',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        ...defaultHG1Proposals,
        logic_state: {},
      });

      const {
        boundedResult,
        intentReceipt,
        narrativeReconciliationReceipt,
        transitionReceipt,
      } = finalizeTurnCausality({
        result: modelResult,
        userAction: 'SYSTEM_INIT',
        context: baseContext,
      });

      const responseEnvelope: Record<string, unknown> = {
        narrative_blocks: boundedResult.narrative_blocks,
        logic_state: boundedResult.logic_state,
        topologyDelta: boundedResult.topologyDelta,
        transitionReceipt,
        intentReceipt,
        narrativeReconciliationReceipt,
        canonicalConsequenceReceipt: {
          version: 1,
          pre_state: {
            inventory: [],
            player_injuries: [],
            psychological_status: 'STABLE',
          },
          post_state: {
            inventory: [],
            player_injuries: [],
            psychological_status: 'STABLE',
          },
          patch: {
            inventory_added: [],
            inventory_removed: [],
            injuries_added: [],
            injuries_removed: [],
            psychological_status_change: null,
          },
          decisions: [],
        },
        characterStanceReceipt: {
          version: 1,
          pre_state: {},
          post_state: {},
          decisions: [],
        },
        characterRelationshipReceipt: {
          version: 1,
          pre_state: [],
          post_state: [],
          decisions: [],
        },
        characterMemoryReceipt: {
          version: 1,
          pre_state: {},
          post_state: {},
          decisions: [],
        },
        worldMemoryReceipt: {
          version: 1,
          pre_state: [],
          post_state: [],
          decisions: [],
        },
        ...defaultTestHorrorGrammarReceipts,
      };

      const validated = TurnResponseSchema.parse(responseEnvelope);
      expect(validated.intentReceipt).toBeDefined();
      expect(validated.narrativeReconciliationReceipt).toBeDefined();
      expect(validated.canonicalConsequenceReceipt).toBeDefined();
      expect(validated.characterMemoryReceipt).toBeDefined();
      expect((validated as Record<string, unknown>).intent_proposal).toBeUndefined();
      expect((validated as Record<string, unknown>).reconciliation_proposal).toBeUndefined();
      expect((validated as Record<string, unknown>).consequence_proposal).toBeUndefined();
      expect((validated as Record<string, unknown>).character_memory_proposal).toBeUndefined();
      expect((validated as Record<string, unknown>).world_memory_proposal).toBeUndefined();
    });

    it('verifies the route file contains one and only one generateStructuredResponse invocation (Case 8)', () => {
      const turnRoutePath = path.resolve(__dirname, 'turn.ts');
      const turnRouteCode = fs.readFileSync(turnRoutePath, 'utf-8');

      // Match all function call occurrences of generateStructuredResponse(
      const matches = turnRouteCode.match(/generateStructuredResponse\s*\(/g);
      expect(matches).not.toBeNull();
      expect(matches?.length).toBe(1);
    });

    describe('Phase 3G.4 Intent Consequence Bridge Integration', () => {
      it('rejects requested transition and preserves current node for non-MOVE proposals', () => {
        const modelResult = TurnResultSchema.parse({
          narrative_blocks: [
            { type: 'prose', content: 'You examine the doorway to Airlock 01.' },
          ],
          intent_proposal: {
            action_kind: 'INVESTIGATE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          },
          reconciliation_proposal: {
            mode: 'CANONICAL',
            feasibility: 'SUPPORTED',
            reason_code: 'NONE',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'NOT_APPLICABLE',
            memory_echo_candidate: null,
          },
          consequence_proposal: {
            mutations: [],
          },
          character_stance_proposal: {
            changes: [],
          },
          character_relationship_proposal: {
            changes: [],
          },
          character_memory_proposal: {
            candidates: [],
          },
          world_memory_proposal: {
            candidates: [],
          },
          ...defaultHG1Proposals,
          logic_state: {
            requested_transition: 'AIRLOCK_01',
          },
        });

        // 1. Natural language mixed action ratifies and accepts transition
        const mixedOutput = finalizeTurnCausality({
          result: modelResult,
          userAction: 'I inspect the doorway to Airlock 01 and step inside.',
          context: baseContext,
        });

        expect(mixedOutput.boundedResult.logic_state.requested_transition).toBe('AIRLOCK_01');
        expect(mixedOutput.transitionReceipt.accepted).toBe(true);
        expect(mixedOutput.transitionReceipt.toNodeId).toBe('AIRLOCK_01');

        // 2. Synthetic non-movement command suppresses transition proposal
        const syntheticOutput = finalizeTurnCausality({
          result: modelResult,
          userAction: 'SYSTEM_INIT',
          context: baseContext,
        });

        expect(syntheticOutput.boundedResult.logic_state.requested_transition).toBeNull();
        expect(syntheticOutput.transitionReceipt.accepted).toBe(false);
        expect(syntheticOutput.transitionReceipt.requestedNodeId).toBeNull();
      });

      it('accepts requested transition for a valid MOVE proposal to a connected exit', () => {
        const modelResult = TurnResultSchema.parse({
          narrative_blocks: [
            { type: 'prose', content: 'You step through the hatch into Airlock 01.' },
          ],
          intent_proposal: {
            action_kind: 'MOVE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          },
          reconciliation_proposal: {
            mode: 'CANONICAL',
            feasibility: 'SUPPORTED',
            reason_code: 'NONE',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'NOT_APPLICABLE',
            memory_echo_candidate: null,
          },
          consequence_proposal: {
            mutations: [],
          },
          character_stance_proposal: {
            changes: [],
          },
          character_relationship_proposal: {
            changes: [],
          },
          character_memory_proposal: {
            candidates: [],
          },
          world_memory_proposal: {
            candidates: [],
          },
          ...defaultHG1Proposals,
          logic_state: {
            requested_transition: 'AIRLOCK_01',
          },
        });

        const output = finalizeTurnCausality({
          result: modelResult,
          userAction: 'I move through the hatch to Airlock 01.',
          context: baseContext,
        });

        expect(output.boundedResult.logic_state.requested_transition).toBe('AIRLOCK_01');
        expect(output.transitionReceipt.accepted).toBe(true);
        expect(output.transitionReceipt.toNodeId).toBe('AIRLOCK_01');
      });

      it('derives NONE outcome when a MANIPULATE action names a cast member without dialogue', () => {
        const userAction = 'I push past Dr. Elena Rhodes to grab the fire extinguisher.';
        const castTarget = resolveExplicitCastTarget(userAction, baseContext);
        expect(castTarget.status).toBe('PRESENT_ELIGIBLE');
        expect(castTarget.characterId).toBe('char-elena');

        const intentReceipt = createIntentReceipt({
          action_kind: 'MANIPULATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        });

        const addressedId = getIntentBoundAddressedCharacterId(intentReceipt, castTarget);
        expect(addressedId).toBeNull();

        const interactionReceipt = createIntentBoundCastInteractionReceipt({
          intentReceipt,
          castTarget,
          respondingCharacterId: null,
        });

        expect(interactionReceipt).toEqual({
          version: 1,
          addressedCharacterId: null,
          respondingCharacterId: null,
          outcome: 'NONE',
        });
      });

      it('derives UNSOLICITED_DIALOGUE outcome when a MANIPULATE action naming a cast member receives spontaneous dialogue', () => {
        const userAction = 'I push past Dr. Elena Rhodes to grab the fire extinguisher.';
        const castTarget = resolveExplicitCastTarget(userAction, baseContext);
        const intentReceipt = createIntentReceipt({
          action_kind: 'MANIPULATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        });

        const addressedId = getIntentBoundAddressedCharacterId(intentReceipt, castTarget);
        expect(addressedId).toBeNull();

        const interactionReceipt = createIntentBoundCastInteractionReceipt({
          intentReceipt,
          castTarget,
          respondingCharacterId: 'char-elena',
        });

        expect(interactionReceipt).toEqual({
          version: 1,
          addressedCharacterId: null,
          respondingCharacterId: 'char-elena',
          outcome: 'UNSOLICITED_DIALOGUE',
        });
      });

      it('retains green addressed dialogue behavior for COMMUNICATE actions to present eligible targets', () => {
        const userAction = 'I ask Dr. Elena Rhodes what she discovered.';
        const castTarget = resolveExplicitCastTarget(userAction, baseContext);
        const intentReceipt = createIntentReceipt({
          action_kind: 'COMMUNICATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        });

        const addressedId = getIntentBoundAddressedCharacterId(intentReceipt, castTarget);
        expect(addressedId).toBe('char-elena');

        const interactionReceipt = createIntentBoundCastInteractionReceipt({
          intentReceipt,
          castTarget,
          respondingCharacterId: 'char-elena',
        });

        expect(interactionReceipt).toEqual({
          version: 1,
          addressedCharacterId: 'char-elena',
          respondingCharacterId: 'char-elena',
          outcome: 'RESPONDED',
        });
      });

      describe('Phase 3G.4R Intent-Bound Topology Expansion Remediation', () => {
        const mockProposedExpansion = {
          isExpansion: true,
          exitDirection: 'EAST',
          newNodeDef: {
            id: 'EXPANDED_VAULT_02',
            geometry: 'Reinforced Sub-basement',
            hazards: ['electrified_flooring'],
            exitVectors: [
              {
                direction: 'WEST',
                targetNodeId: 'LAB_01',
              },
            ],
          },
        };

        it('suppresses proposed topology expansion when intent is INVESTIGATE even if isExpansionExpected is true', () => {
          const modelResult = TurnResultSchema.parse({
            narrative_blocks: [
              { type: 'prose', content: 'You shine your flashlight into the dark breach.' },
            ],
            intent_proposal: {
              action_kind: 'INVESTIGATE',
              action_subtype: null,
              pressure_direction: 'MAINTAIN',
              dramatic_tactic: 'NONE',
              intent_synergy: 'N/A',
            },
            reconciliation_proposal: {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            consequence_proposal: {
              mutations: [],
            },
            character_stance_proposal: {
              changes: [],
            },
            character_relationship_proposal: {
              changes: [],
            },
            character_memory_proposal: {
              candidates: [],
            },
            world_memory_proposal: {
              candidates: [],
            },
            ...defaultHG1Proposals,
            logic_state: {},
            topologyDelta: mockProposedExpansion,
          });

          // INVESTIGATE with isExpansionExpected: true for protagonist preserves expansion
          const output = finalizeTurnCausality({
            result: modelResult,
            userAction: 'I peer into the dark breach to inspect the machinery.',
            context: baseContext,
            isExpansionExpected: true,
          });

          expect(output.intentReceipt.action_kind).toBe('INVESTIGATE');
          expect(output.boundedResult.topologyDelta).toEqual(mockProposedExpansion);
          expect(output.boundedResult.topologyDelta.isExpansion).toBe(true);
          expect(output.boundedResult.topologyDelta.newNodeDef?.id).toBe('EXPANDED_VAULT_02');
        });

        it('preserves proposed topology expansion when intent is OBSERVE and isExpansionExpected is true', () => {
          const modelResult = TurnResultSchema.parse({
            narrative_blocks: [
              { type: 'prose', content: 'You scan the perimeter of the unmapped boundary.' },
            ],
            intent_proposal: {
              action_kind: 'OBSERVE',
              action_subtype: null,
              pressure_direction: 'MAINTAIN',
              dramatic_tactic: 'NONE',
              intent_synergy: 'N/A',
            },
            reconciliation_proposal: {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            consequence_proposal: {
              mutations: [],
            },
            character_stance_proposal: {
              changes: [],
            },
            character_relationship_proposal: {
              changes: [],
            },
            character_memory_proposal: {
              candidates: [],
            },
            world_memory_proposal: {
              candidates: [],
            },
            ...defaultHG1Proposals,
            logic_state: {},
            topologyDelta: mockProposedExpansion,
          });

          const output = finalizeTurnCausality({
            result: modelResult,
            userAction: 'I watch the shadows shifting in the breach.',
            context: baseContext,
            isExpansionExpected: true,
          });

          expect(output.intentReceipt.action_kind).toBe('OBSERVE');
          expect(output.boundedResult.topologyDelta).toEqual(mockProposedExpansion);
          expect(output.boundedResult.topologyDelta.isExpansion).toBe(true);
        });

        it('preserves proposed topology expansion when intent is COMMUNICATE and isExpansionExpected is true', () => {
          const modelResult = TurnResultSchema.parse({
            narrative_blocks: [
              { type: 'prose', content: 'You shout through the opening.' },
            ],
            intent_proposal: {
              action_kind: 'COMMUNICATE',
              action_subtype: null,
              pressure_direction: 'MAINTAIN',
              dramatic_tactic: 'NONE',
              intent_synergy: 'N/A',
            },
            reconciliation_proposal: {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            consequence_proposal: {
              mutations: [],
            },
            character_stance_proposal: {
              changes: [],
            },
            character_relationship_proposal: {
              changes: [],
            },
            character_memory_proposal: {
              candidates: [],
            },
            world_memory_proposal: {
              candidates: [],
            },
            ...defaultHG1Proposals,
            logic_state: {},
            topologyDelta: mockProposedExpansion,
          });

          const output = finalizeTurnCausality({
            result: modelResult,
            userAction: 'I yell into the dark opening as I step inside.',
            context: baseContext,
            isExpansionExpected: true,
          });

          expect(output.intentReceipt.action_kind).toBe('COMMUNICATE');
          expect(output.boundedResult.topologyDelta).toEqual(mockProposedExpansion);
          expect(output.boundedResult.topologyDelta.isExpansion).toBe(true);
        });

        it('preserves proposed topology expansion when intent is MOVE and isExpansionExpected is true', () => {
          const modelResult = TurnResultSchema.parse({
            narrative_blocks: [
              { type: 'prose', content: 'You cross the breach into the reinforced sub-basement.' },
            ],
            intent_proposal: {
              action_kind: 'MOVE',
              action_subtype: null,
              pressure_direction: 'MAINTAIN',
              dramatic_tactic: 'NONE',
              intent_synergy: 'N/A',
            },
            reconciliation_proposal: {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            consequence_proposal: {
              mutations: [],
            },
            character_stance_proposal: {
              changes: [],
            },
            character_relationship_proposal: {
              changes: [],
            },
            character_memory_proposal: {
              candidates: [],
            },
            world_memory_proposal: {
              candidates: [],
            },
            ...defaultHG1Proposals,
            logic_state: {},
            topologyDelta: mockProposedExpansion,
          });

          const output = finalizeTurnCausality({
            result: modelResult,
            userAction: 'I crawl through the breach into the sub-basement.',
            context: baseContext,
            isExpansionExpected: true,
          });

          expect(output.intentReceipt.action_kind).toBe('MOVE');
          expect(output.boundedResult.topologyDelta).toEqual(mockProposedExpansion);
          expect(output.boundedResult.topologyDelta.isExpansion).toBe(true);
          expect(output.boundedResult.topologyDelta.newNodeDef?.id).toBe('EXPANDED_VAULT_02');
        });

        it('suppresses proposed topology expansion when isExpansionExpected is false even for MOVE actions', () => {
          const modelResult = TurnResultSchema.parse({
            narrative_blocks: [
              { type: 'prose', content: 'You move towards the sealed bulkhead.' },
            ],
            intent_proposal: {
              action_kind: 'MOVE',
              action_subtype: null,
              pressure_direction: 'MAINTAIN',
              dramatic_tactic: 'NONE',
              intent_synergy: 'N/A',
            },
            reconciliation_proposal: {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            consequence_proposal: {
              mutations: [],
            },
            character_stance_proposal: {
              changes: [],
            },
            character_relationship_proposal: {
              changes: [],
            },
            character_memory_proposal: {
              candidates: [],
            },
            world_memory_proposal: {
              candidates: [],
            },
            ...defaultHG1Proposals,
            logic_state: {},
            topologyDelta: mockProposedExpansion,
          });

          const output = finalizeTurnCausality({
            result: modelResult,
            userAction: 'I step forward.',
            context: baseContext,
            isExpansionExpected: false,
          });

          expect(output.intentReceipt.action_kind).toBe('MOVE');
          expect(output.boundedResult.topologyDelta).toEqual({
            isExpansion: false,
            newNodeDef: null,
          });
        });

        it('maintains structural suppression when EXPERIENTIAL_REANCHORED mode is active', () => {
          // A witness mortal trying to manifest an impossible teleporting expansion across reality
          const witnessContext = EngineTurnContextSchema.parse({
            ...baseContext,
            player: {
              role: 'witness',
              name: 'Observer Mark',
              description: 'Passive witness',
              isEntity: false,
            },
          });

          const modelResult = TurnResultSchema.parse({
            narrative_blocks: [
              { type: 'prose', content: 'You imagine a new corridor tearing into reality.' },
            ],
            intent_proposal: {
              action_kind: 'MOVE',
              action_subtype: null,
              pressure_direction: 'MAINTAIN',
              dramatic_tactic: 'NONE',
              intent_synergy: 'N/A',
            },
            reconciliation_proposal: {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            consequence_proposal: {
              mutations: [],
            },
            character_stance_proposal: {
              changes: [],
            },
            character_relationship_proposal: {
              changes: [],
            },
            character_memory_proposal: {
              candidates: [],
            },
            world_memory_proposal: {
              candidates: [],
            },
            ...defaultHG1Proposals,
            logic_state: {},
            topologyDelta: mockProposedExpansion,
          });

          const output = finalizeTurnCausality({
            result: modelResult,
            userAction: 'I teleport through the unmapped dimensional rift.',
            context: witnessContext,
            isExpansionExpected: true,
          });

          expect(output.causal.suppressStructuralDeltas).toBe(true);
          expect(output.narrativeReconciliationReceipt.mode).toBe('EXPERIENTIAL_REANCHORED');
          expect(output.boundedResult.topologyDelta).toEqual({
            isExpansion: false,
            newNodeDef: null,
          });
        });

        it('route-level regression: final TurnResponse payload enforces threshold-bound topology expansion authorization', () => {
          const investigateModelResult = TurnResultSchema.parse({
            narrative_blocks: [
              { type: 'prose', content: 'You examine the glowing symbols around the portal.' },
            ],
            intent_proposal: {
              action_kind: 'INVESTIGATE',
              action_subtype: null,
              pressure_direction: 'MAINTAIN',
              dramatic_tactic: 'NONE',
              intent_synergy: 'N/A',
            },
            reconciliation_proposal: {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            consequence_proposal: {
              mutations: [],
            },
            character_stance_proposal: {
              changes: [],
            },
            character_relationship_proposal: {
              changes: [],
            },
            character_memory_proposal: {
              candidates: [],
            },
            world_memory_proposal: {
              candidates: [],
            },
            ...defaultHG1Proposals,
            logic_state: {},
            topologyDelta: mockProposedExpansion,
          });

          const investigateCausality = finalizeTurnCausality({
            result: investigateModelResult,
            userAction: 'I examine the portal symbols.',
            context: baseContext,
            isExpansionExpected: true,
          });

          // Simulate turn route response assembly
          const investigateResponse: TurnResponse = {
            narrative_blocks: investigateCausality.boundedResult.narrative_blocks,
            logic_state: investigateCausality.boundedResult.logic_state,
            topologyDelta: investigateCausality.boundedResult.topologyDelta,
            transitionReceipt: investigateCausality.transitionReceipt,
            castInteractionReceipt: createIntentBoundCastInteractionReceipt({
              intentReceipt: investigateCausality.intentReceipt,
              castTarget: investigateCausality.castTarget,
              respondingCharacterId: null,
            }),
            intentReceipt: investigateCausality.intentReceipt,
            narrativeReconciliationReceipt: investigateCausality.narrativeReconciliationReceipt,
            canonicalConsequenceReceipt: {
              version: 1,
              pre_state: {
                inventory: [],
                player_injuries: [],
                psychological_status: 'STABLE',
              },
              post_state: {
                inventory: [],
                player_injuries: [],
                psychological_status: 'STABLE',
              },
              patch: {
                inventory_added: [],
                inventory_removed: [],
                injuries_added: [],
                injuries_removed: [],
                psychological_status_change: null,
              },
              decisions: [],
            },
            characterStanceReceipt: {
              version: 1,
              pre_state: {},
              post_state: {},
              decisions: [],
            },
            characterRelationshipReceipt: {
              version: 1,
              pre_state: [],
              post_state: [],
              decisions: [],
            },
            characterMemoryReceipt: {
              version: 1,
              pre_state: {},
              post_state: {},
              decisions: [],
            },
            worldMemoryReceipt: {
              version: 1,
              pre_state: [],
              post_state: [],
              decisions: [],
            },
            ...defaultTestHorrorGrammarReceipts,
          };

          const parsedInvestigateResponse = TurnResponseSchema.parse(investigateResponse);
          expect(parsedInvestigateResponse.intentReceipt.action_kind).toBe('INVESTIGATE');
          expect(parsedInvestigateResponse.topologyDelta).toEqual(mockProposedExpansion);
          expect(parsedInvestigateResponse.topologyDelta.isExpansion).toBe(true);

          // Case B: User moves across threshold with isExpansionExpected=true and valid model expansion.
          const moveModelResult = TurnResultSchema.parse({
            narrative_blocks: [
              { type: 'prose', content: 'You step through the archway into the vault.' },
            ],
            intent_proposal: {
              action_kind: 'MOVE',
              action_subtype: null,
              pressure_direction: 'MAINTAIN',
              dramatic_tactic: 'NONE',
              intent_synergy: 'N/A',
            },
            reconciliation_proposal: {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            consequence_proposal: {
              mutations: [],
            },
            character_stance_proposal: {
              changes: [],
            },
            character_relationship_proposal: {
              changes: [],
            },
            character_memory_proposal: {
              candidates: [],
            },
            world_memory_proposal: {
              candidates: [],
            },
            ...defaultHG1Proposals,
            logic_state: {},
            topologyDelta: mockProposedExpansion,
          });

          const moveCausality = finalizeTurnCausality({
            result: moveModelResult,
            userAction: 'I step through the archway into the unknown room.',
            context: baseContext,
            isExpansionExpected: true,
          });

          const moveResponse: TurnResponse = {
            narrative_blocks: moveCausality.boundedResult.narrative_blocks,
            logic_state: moveCausality.boundedResult.logic_state,
            topologyDelta: moveCausality.boundedResult.topologyDelta,
            transitionReceipt: moveCausality.transitionReceipt,
            castInteractionReceipt: createIntentBoundCastInteractionReceipt({
              intentReceipt: moveCausality.intentReceipt,
              castTarget: moveCausality.castTarget,
              respondingCharacterId: null,
            }),
            intentReceipt: moveCausality.intentReceipt,
            narrativeReconciliationReceipt: moveCausality.narrativeReconciliationReceipt,
            canonicalConsequenceReceipt: {
              version: 1,
              pre_state: {
                inventory: [],
                player_injuries: [],
                psychological_status: 'STABLE',
              },
              post_state: {
                inventory: [],
                player_injuries: [],
                psychological_status: 'STABLE',
              },
              patch: {
                inventory_added: [],
                inventory_removed: [],
                injuries_added: [],
                injuries_removed: [],
                psychological_status_change: null,
              },
              decisions: [],
            },
            characterStanceReceipt: {
              version: 1,
              pre_state: {},
              post_state: {},
              decisions: [],
            },
            characterRelationshipReceipt: {
              version: 1,
              pre_state: [],
              post_state: [],
              decisions: [],
            },
            characterMemoryReceipt: {
              version: 1,
              pre_state: {},
              post_state: {},
              decisions: [],
            },
            worldMemoryReceipt: {
              version: 1,
              pre_state: [],
              post_state: [],
              decisions: [],
            },
            ...defaultTestHorrorGrammarReceipts,
          };

          const parsedMoveResponse = TurnResponseSchema.parse(moveResponse);
          expect(parsedMoveResponse.intentReceipt.action_kind).toBe('MOVE');
          expect(parsedMoveResponse.topologyDelta?.isExpansion).toBe(true);
          expect(parsedMoveResponse.topologyDelta?.newNodeDef?.id).toBe('EXPANDED_VAULT_02');
        });
      });
    });

    describe('Phase 3H.1B: Canonical Consequences Integration (finalizeCanonicalConsequences)', () => {
      const baseConsequenceState = {
        inventory: ['flashlight'],
        player_injuries: ['bruised_ribs'],
        psychological_status: 'UNEASY' as const,
      };

      const baseConsequenceContext = EngineTurnContextSchema.parse({
        ...baseContext,
        consequenceState: baseConsequenceState,
      });

      it('accepts valid inventory ADD mutation when intent is MANIPULATE', () => {
        const receipt = finalizeCanonicalConsequences({
          proposal: {
            mutations: [
              {
                domain: 'INVENTORY',
                operation: 'ADD',
                value: 'iron_key',
                rationale: 'Picks up iron key from locker',
              },
            ],
          },
          intentReceipt: createIntentReceipt({
            action_kind: 'MANIPULATE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          }),
          narrativeReconciliationReceipt: createNarrativeReconciliationReceipt(
            {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            'protagonist'
          ),
          context: baseConsequenceContext,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('APPLIED');
        expect(receipt.patch.inventory_added).toEqual(['iron_key']);
        expect(receipt.post_state.inventory).toEqual(['flashlight', 'iron_key']);
      });

      it('rejects inventory mutation when intent is not MANIPULATE', () => {
        const receipt = finalizeCanonicalConsequences({
          proposal: {
            mutations: [
              {
                domain: 'INVENTORY',
                operation: 'ADD',
                value: 'iron_key',
                rationale: 'Picks up iron key from locker',
              },
            ],
          },
          intentReceipt: createIntentReceipt({
            action_kind: 'OBSERVE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          }),
          narrativeReconciliationReceipt: createNarrativeReconciliationReceipt(
            {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            'protagonist'
          ),
          context: baseConsequenceContext,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');
        expect(receipt.post_state.inventory).toEqual(['flashlight']);
      });

      it('accepts injury ADD mutation for physical intents (MOVE/MANIPULATE)', () => {
        const receipt = finalizeCanonicalConsequences({
          proposal: {
            mutations: [
              {
                domain: 'PLAYER_INJURY',
                operation: 'ADD',
                value: 'sprained_ankle',
                rationale: 'Stumbles over twisted floor grating',
              },
            ],
          },
          intentReceipt: createIntentReceipt({
            action_kind: 'MOVE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          }),
          narrativeReconciliationReceipt: createNarrativeReconciliationReceipt(
            {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            'protagonist'
          ),
          context: baseConsequenceContext,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('APPLIED');
        expect(receipt.patch.injuries_added).toEqual(['sprained_ankle']);
        expect(receipt.post_state.player_injuries).toEqual(['bruised_ribs', 'sprained_ankle']);
      });

      it('rejects injury mutation for non-physical intent like COMMUNICATE', () => {
        const receipt = finalizeCanonicalConsequences({
          proposal: {
            mutations: [
              {
                domain: 'PLAYER_INJURY',
                operation: 'ADD',
                value: 'sprained_ankle',
                rationale: 'Sprains ankle while talking',
              },
            ],
          },
          intentReceipt: createIntentReceipt({
            action_kind: 'COMMUNICATE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          }),
          narrativeReconciliationReceipt: createNarrativeReconciliationReceipt(
            {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            'protagonist'
          ),
          context: baseConsequenceContext,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('ACTION_NOT_AUTHORIZED');
        expect(receipt.post_state.player_injuries).toEqual(['bruised_ribs']);
      });

      it('accepts valid psychological_status SET mutation', () => {
        const receipt = finalizeCanonicalConsequences({
          proposal: {
            mutations: [
              {
                domain: 'PSYCHOLOGICAL_STATUS',
                operation: 'SET',
                value: 'PANICKED',
                rationale: 'Sees grotesque aberration on security monitor',
              },
            ],
          },
          intentReceipt: createIntentReceipt({
            action_kind: 'INVESTIGATE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          }),
          narrativeReconciliationReceipt: createNarrativeReconciliationReceipt(
            {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            'protagonist'
          ),
          context: baseConsequenceContext,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('APPLIED');
        expect(receipt.patch.psychological_status_change).toEqual({
          before: 'UNEASY',
          after: 'PANICKED',
        });
        expect(receipt.post_state.psychological_status).toBe('PANICKED');
      });

      it('rejects all consequence mutations when reconciliation mode is EXPERIENTIAL_REANCHORED', () => {
        const receipt = finalizeCanonicalConsequences({
          proposal: {
            mutations: [
              {
                domain: 'INVENTORY',
                operation: 'ADD',
                value: 'ghost_token',
                rationale: 'Conjures ghost item in hallucinatory state',
              },
            ],
          },
          intentReceipt: createIntentReceipt({
            action_kind: 'MANIPULATE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          }),
          narrativeReconciliationReceipt: createNarrativeReconciliationReceipt(
            {
              mode: 'EXPERIENTIAL_REANCHORED',
              feasibility: 'IMPOSSIBLE',
              reason_code: 'PHYSICAL_LIMIT',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            'protagonist'
          ),
          context: baseConsequenceContext,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');
        expect(receipt.post_state).toEqual(baseConsequenceState);
      });

      it('rejects player consequence mutations for non-protagonist roles (Director / Witness)', () => {
        const witnessContext = EngineTurnContextSchema.parse({
          ...baseConsequenceContext,
          player: {
            role: 'witness',
            name: 'Witness',
            description: 'Observer in shadows',
          },
        });

        const receipt = finalizeCanonicalConsequences({
          proposal: {
            mutations: [
              {
                domain: 'INVENTORY',
                operation: 'ADD',
                value: 'iron_key',
                rationale: 'Picks up iron key',
              },
            ],
          },
          intentReceipt: createIntentReceipt({
            action_kind: 'MANIPULATE',
            action_subtype: null,
            pressure_direction: 'MAINTAIN',
            dramatic_tactic: 'NONE',
            intent_synergy: 'N/A',
          }),
          narrativeReconciliationReceipt: createNarrativeReconciliationReceipt(
            {
              mode: 'CANONICAL',
              feasibility: 'SUPPORTED',
              reason_code: 'NONE',
              fictional_time_cost: 'MOMENT',
              authority_alignment: 'NOT_APPLICABLE',
              memory_echo_candidate: null,
            },
            'witness'
          ),
          context: witnessContext,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('ROLE_NOT_AUTHORIZED');
      });
    });

    describe('finalizeCharacterStance', () => {
      const baseStanceContext = EngineTurnContextSchema.parse({
        ...baseContext,
        cast: [
          {
            id: 'char-npc1',
            name: 'Nurse Finch',
            role: 'Custodian',
            description: 'Orderly',
            isUserCharacter: false,
            isPresent: true,
            stance: { focus: 'PLAYER', stance: 'OPEN' },
          },
          {
            id: 'char-npc2',
            name: 'Doctor Gray',
            role: 'Antagonist',
            description: 'Chief Doctor',
            isUserCharacter: false,
            isPresent: false,
            stance: null,
          },
          {
            id: 'char-player',
            name: 'Arthur',
            role: 'Protagonist',
            description: 'Investigator',
            isUserCharacter: true,
            isPresent: true,
            stance: null,
          },
        ],
      });

      const validStanceIntent = createIntentReceipt({
        action_kind: 'COMMUNICATE',
        action_subtype: null,
        pressure_direction: 'MAINTAIN',
        dramatic_tactic: 'NONE',
        intent_synergy: 'N/A',
      });

      const validStanceReconciliation = createNarrativeReconciliationReceipt(
        {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        'protagonist'
      );

      const validInteractionReceipt = createCastInteractionReceipt({
        addressedCharacterId: 'char-npc1',
        respondingCharacterId: 'char-npc1',
      });

      it('applies well-formed valid stance change to eligible present cast member', () => {
        const receipt = finalizeCharacterStance({
          proposal: {
            changes: [
              {
                character_id: 'char-npc1',
                focus: 'PLAYER',
                stance: 'GUARDED',
                rationale: 'Finch steps back cautiously',
              },
            ],
          },
          context: baseStanceContext,
          intentReceipt: validStanceIntent,
          narrativeReconciliationReceipt: validStanceReconciliation,
          castInteractionReceipt: validInteractionReceipt,
        });

        expect(receipt.version).toBe(1);
        expect(receipt.pre_state['char-npc1']).toEqual({ focus: 'PLAYER', stance: 'OPEN' });
        expect(receipt.post_state['char-npc1']).toEqual({ focus: 'PLAYER', stance: 'GUARDED' });
        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('APPLIED');
        expect(receipt.decisions[0].reason).toBe('APPLIED');
      });

      it('rejects changes targeting absent characters or user characters', () => {
        const receipt = finalizeCharacterStance({
          proposal: {
            changes: [
              {
                character_id: 'char-npc2', // absent
                focus: 'SITUATION',
                stance: 'AFRAID',
                rationale: 'Fear',
              },
              {
                character_id: 'char-player', // user character
                focus: 'PLAYER',
                stance: 'RESISTANT',
                rationale: 'Resistance',
              },
            ],
          },
          context: baseStanceContext,
          intentReceipt: validStanceIntent,
          narrativeReconciliationReceipt: validStanceReconciliation,
          castInteractionReceipt: validInteractionReceipt,
        });

        expect(receipt.decisions).toHaveLength(2);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('CHARACTER_ABSENT');
        expect(receipt.decisions[1].outcome).toBe('REJECTED');
        expect(receipt.decisions[1].reason).toBe('PLAYER_CHARACTER');
        expect(receipt.post_state).toEqual(receipt.pre_state);
      });

      it('rejects changes when narrative reconciliation is suppressed', () => {
        const suppressedReconciliation = createNarrativeReconciliationReceipt(
          {
            mode: 'EXPERIENTIAL_REANCHORED',
            feasibility: 'IMPOSSIBLE',
            reason_code: 'PHYSICAL_LIMIT',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'NOT_APPLICABLE',
            memory_echo_candidate: null,
          },
          'protagonist'
        );

        const receipt = finalizeCharacterStance({
          proposal: {
            changes: [
              {
                character_id: 'char-npc1',
                focus: 'PLAYER',
                stance: 'HOSTILE',
                rationale: 'Hostile turn',
              },
            ],
          },
          context: baseStanceContext,
          intentReceipt: validStanceIntent,
          narrativeReconciliationReceipt: suppressedReconciliation,
          castInteractionReceipt: validInteractionReceipt,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');
        expect(receipt.post_state).toEqual(receipt.pre_state);
      });
    });

    describe('finalizeCharacterMemory', () => {
      const baseMemContext = EngineTurnContextSchema.parse({
        ...baseContext,
        player: {
          role: 'protagonist',
          characterId: 'char-player',
          name: 'Arthur',
          description: 'Investigator',
        },
        cast: [
          {
            id: 'char-npc1',
            name: 'Nurse Finch',
            role: 'Custodian',
            description: 'Orderly',
            isUserCharacter: false,
            isPresent: true,
            memory: [
              {
                id: 'cm_001',
                fact: 'Door seals were tested at 0400 hours.',
                certainty: 'KNOWN',
                source: 'OBSERVED',
                acquired_turn: 1,
              },
            ],
          },
          {
            id: 'char-npc2',
            name: 'Doctor Gray',
            role: 'Antagonist',
            description: 'Chief Doctor',
            isUserCharacter: false,
            isPresent: false,
            memory: [],
          },
          {
            id: 'char-player',
            name: 'Arthur',
            role: 'Protagonist',
            description: 'Investigator',
            isUserCharacter: true,
            isPresent: true,
            memory: [],
          },
        ],
        runtime: {
          turnNumber: 3,
        },
        memoryState: {
          'char-npc1': [
            {
              id: 'cm_001',
              fact: 'Door seals were tested at 0400 hours.',
              certainty: 'KNOWN',
              source: 'OBSERVED',
              acquired_turn: 1,
            },
          ],
        },
      });

      const validMemIntent = createIntentReceipt({
        action_kind: 'COMMUNICATE',
        action_subtype: null,
        pressure_direction: 'MAINTAIN',
        dramatic_tactic: 'NONE',
        intent_synergy: 'N/A',
      });

      const validMemReconciliation = createNarrativeReconciliationReceipt(
        {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        'protagonist'
      );

      const validMemInteractionReceipt = createCastInteractionReceipt({
        addressedCharacterId: 'char-npc1',
        respondingCharacterId: 'char-npc1',
      });

      it('commits valid new fact candidate to target character ledger', () => {
        const receipt = finalizeCharacterMemory({
          proposal: {
            candidates: [
              {
                character_id: 'char-npc1',
                fact: 'Sub-level 3 power grid was rerouted.',
                certainty: 'KNOWN',
                source: 'TOLD',
                rationale: 'Arthur explained the power rerouting directly to Finch',
              },
            ],
          },
          context: baseMemContext,
          intentReceipt: validMemIntent,
          narrativeReconciliationReceipt: validMemReconciliation,
          castInteractionReceipt: validMemInteractionReceipt,
        });

        expect(receipt.version).toBe(1);
        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('APPLIED');
        expect(receipt.decisions[0].reason).toBe('APPLIED');
        expect(receipt.post_state['char-npc1']).toHaveLength(2);
        expect(receipt.post_state['char-npc1'][1].fact).toBe('Sub-level 3 power grid was rerouted.');
        expect(receipt.post_state['char-npc1'][1].acquired_turn).toBe(3);
      });

      it('rejects candidate with INVALID_TARGET for absent or player character', () => {
        const receipt = finalizeCharacterMemory({
          proposal: {
            candidates: [
              {
                character_id: 'char-npc2', // absent
                fact: 'Heard a whisper in the dark.',
                certainty: 'BELIEVED',
                source: 'OBSERVED',
                rationale: 'Whisper observed',
              },
              {
                character_id: 'char-player', // player character
                fact: 'I remember the code.',
                certainty: 'KNOWN',
                source: 'OBSERVED',
                rationale: 'Player remembering code',
              },
            ],
          },
          context: baseMemContext,
          intentReceipt: validMemIntent,
          narrativeReconciliationReceipt: validMemReconciliation,
          castInteractionReceipt: validMemInteractionReceipt,
        });

        expect(receipt.decisions).toHaveLength(2);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('CHARACTER_ABSENT');
        expect(receipt.decisions[1].outcome).toBe('REJECTED');
        expect(receipt.decisions[1].reason).toBe('PLAYER_CHARACTER');
        expect(receipt.post_state).toEqual(receipt.pre_state);
      });

      it('rejects candidate when narrative reconciliation is suppressed', () => {
        const suppressedReconciliation = createNarrativeReconciliationReceipt(
          {
            mode: 'EXPERIENTIAL_REANCHORED',
            feasibility: 'IMPOSSIBLE',
            reason_code: 'PHYSICAL_LIMIT',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'NOT_APPLICABLE',
            memory_echo_candidate: null,
          },
          'protagonist'
        );

        const receipt = finalizeCharacterMemory({
          proposal: {
            candidates: [
              {
                character_id: 'char-npc1',
                fact: 'Saw shadows morphing into winged beasts.',
                certainty: 'KNOWN',
                source: 'OBSERVED',
                rationale: 'Hallucinatory observation',
              },
            ],
          },
          context: baseMemContext,
          intentReceipt: validMemIntent,
          narrativeReconciliationReceipt: suppressedReconciliation,
          castInteractionReceipt: validMemInteractionReceipt,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');
        expect(receipt.post_state).toEqual(receipt.pre_state);
      });
    });

    describe('finalizeCharacterRelationships', () => {
      const baseRelContext = EngineTurnContextSchema.parse({
        ...baseContext,
        player: {
          role: 'protagonist',
          characterId: 'char-player',
          name: 'Arthur',
          description: 'Investigator',
        },
        cast: [
          {
            id: 'char-npc1',
            name: 'Nurse Finch',
            role: 'Custodian',
            description: 'Orderly',
            isUserCharacter: false,
            isPresent: true,
            stance: { focus: 'PLAYER', stance: 'OPEN' },
          },
          {
            id: 'char-npc2',
            name: 'Doctor Gray',
            role: 'Antagonist',
            description: 'Chief Doctor',
            isUserCharacter: false,
            isPresent: false,
            stance: null,
          },
          {
            id: 'char-player',
            name: 'Arthur',
            role: 'Protagonist',
            description: 'Investigator',
            isUserCharacter: true,
            isPresent: true,
            stance: null,
          },
        ],
        relationshipState: [
          {
            source_character_id: 'char-npc1',
            target_character_id: 'char-player',
            kind: 'TRUST',
            intensity: 1,
          },
        ],
      });

      const validRelIntent = createIntentReceipt({
        action_kind: 'COMMUNICATE',
        action_subtype: null,
        pressure_direction: 'MAINTAIN',
        dramatic_tactic: 'NONE',
        intent_synergy: 'N/A',
      });

      const validRelReconciliation = createNarrativeReconciliationReceipt(
        {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        'protagonist'
      );

      const validRelInteractionReceipt = createCastInteractionReceipt({
        addressedCharacterId: 'char-npc1',
        respondingCharacterId: 'char-npc1',
      });

      it('applies well-formed valid relationship change', () => {
        const receipt = finalizeCharacterRelationships({
          proposal: {
            changes: [
              {
                source_character_id: 'char-npc1',
                target_character_id: 'char-player',
                kind: 'TRUST',
                delta: 1,
                rationale: 'Deepened trust through assistance',
              },
            ],
          },
          context: baseRelContext,
          intentReceipt: validRelIntent,
          narrativeReconciliationReceipt: validRelReconciliation,
          castInteractionReceipt: validRelInteractionReceipt,
        });

        expect(receipt.version).toBe(1);
        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('APPLIED');
        expect(receipt.decisions[0].reason).toBe('APPLIED');

        const postRel = receipt.post_state.find(
          (r) => r.source_character_id === 'char-npc1' && r.target_character_id === 'char-player' && r.kind === 'TRUST'
        );
        expect(postRel).toBeDefined();
        expect(postRel?.intensity).toBe(2);
      });

      it('rejects self-referential relationship or unknown character targets', () => {
        const receipt = finalizeCharacterRelationships({
          proposal: {
            changes: [
              {
                source_character_id: 'char-npc1',
                target_character_id: 'char-npc1',
                kind: 'TRUST',
                delta: 1,
                rationale: 'Self-referential',
              },
              {
                source_character_id: 'char-npc1',
                target_character_id: 'unknown-ghost',
                kind: 'TRUST',
                delta: 1,
                rationale: 'Unknown character',
              },
            ],
          },
          context: baseRelContext,
          intentReceipt: validRelIntent,
          narrativeReconciliationReceipt: validRelReconciliation,
          castInteractionReceipt: validRelInteractionReceipt,
        });

        expect(receipt.decisions).toHaveLength(2);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('SELF_RELATIONSHIP');
        expect(receipt.decisions[1].outcome).toBe('REJECTED');
        expect(receipt.decisions[1].reason).toBe('PLAYER_NOT_INVOLVED');
      });

      it('rejects relationship changes when narrative reconciliation is suppressed', () => {
        const suppressedReconciliation = createNarrativeReconciliationReceipt(
          {
            mode: 'EXPERIENTIAL_REANCHORED',
            feasibility: 'IMPOSSIBLE',
            reason_code: 'PHYSICAL_LIMIT',
            fictional_time_cost: 'MOMENT',
            authority_alignment: 'NOT_APPLICABLE',
            memory_echo_candidate: null,
          },
          'protagonist'
        );

        const receipt = finalizeCharacterRelationships({
          proposal: {
            changes: [
              {
                source_character_id: 'char-npc1',
                target_character_id: 'char-player',
                kind: 'TRUST',
                delta: -1,
                rationale: 'Hallucinatory betrayal',
              },
            ],
          },
          context: baseRelContext,
          intentReceipt: validRelIntent,
          narrativeReconciliationReceipt: suppressedReconciliation,
          castInteractionReceipt: validRelInteractionReceipt,
        });

        expect(receipt.decisions).toHaveLength(1);
        expect(receipt.decisions[0].outcome).toBe('REJECTED');
        expect(receipt.decisions[0].reason).toBe('RECONCILIATION_SUPPRESSED');
        expect(receipt.post_state).toEqual(receipt.pre_state);
      });
    });
  });

  describe('Route-level integration: /api/turn character memory prompt rendering and isolation', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
      const app = await createApp({ enableSpaFallback: false });
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            baseUrl = `http://127.0.0.1:${addr.port}`;
          }
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => {
        if (server) {
          server.close((err) => (err ? reject(err) : resolve()));
        } else {
          resolve();
        }
      });
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('proves /api/turn prompt contains only situated per-character memory with duplicate-name isolation and no extra model calls', async () => {
      const validMockTurnResult: TurnResult = {
        narrative_blocks: [
          {
            type: 'prose',
            content: 'You observe both researchers named Dr. Evans remaining focused on their console readings.',
            medium: 'direct',
            delivery: 'spoken',
            target: 'addressed',
          },
        ],
        intent_proposal: {
          action_kind: 'INVESTIGATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        cast_activity_proposal: {
          kind: 'NONE',
          reason: 'NO_OPPORTUNITY_CHOSEN',
        },
        situated_pressure_proposal: {
          kind: 'NONE',
          reason: 'NO_PRESSURE_CHOSEN',
        },
        value_state_proposal: {
          changes: [],
        },
        character_pursuit_proposal: {
          changes: [],
        },
        character_development_proposal: {
          changes: [],
        },
        pressure_transition_proposal: {
          transitions: [],
        },
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 1,
          requested_transition: null,
          terminal_flags: [],
          cast_arrivals: [],
          cast_departures: [],
          cast_deltas: [],
          cast_ledger: [],
        },
        topologyDelta: {
          isExpansion: false,
          newNodeDef: null,
        },
      };

      mockGenerateStructuredResponse.mockResolvedValueOnce(validMockTurnResult);

      const turnPayload = {
        userAction: 'I observe the two researchers in the laboratory.',
        recentHistory: 'The humming terminal displays diagnostic readouts.',
        systemDirective:
          'SYSTEM_DIRECTIVE_CANARY: Keep prose clinical and objective.',
        isExpansionExpected: false,
        stateContext: {
          currentNodeId: 'LAB_01',
          currentPhase: 'LATENT',
          tensionLevel: 1,
          reconciliationRevision: 0,
        },
        context: {
          version: 1,
          scenario: {
            title: 'Sub-level Isolation',
            premise: 'Two researchers working under identical credentials.',
            worldRules: ['All communication across chambers is logged.'],
            setting: {
              location: 'Laboratory 01',
              atmosphere: 'Cold and sterile',
              timePeriod: '1982',
            },
            startingVector: 'COGNITIVE',
            startingTier: 'LATENT',
            incitingIncident: 'The automated isolation doors sealed.',
            pacingDirective: 'Slow burn.',
            keyPlotElements: ['The primary observation terminal'],
          },
          player: {
            role: 'protagonist',
            characterId: 'char-player',
            name: 'Arthur',
            description: 'Lead Investigator',
            isEntity: false,
          },
          cast: [
            {
              id: 'char-player',
              name: 'Arthur',
              role: 'Protagonist',
              description: 'Lead Investigator',
              isUserCharacter: true,
              isPresent: true,
              memory: [
                {
                  id: 'cm_player',
                  fact: 'PLAYER_MEMORY_MUST_NOT_RENDER',
                  certainty: 'KNOWN',
                  source: 'OBSERVED',
                  acquired_turn: 1,
                },
              ],
            },
            {
              id: 'char-a',
              name: 'Dr. Evans',
              role: 'Scientist',
              description: 'First Researcher',
              isUserCharacter: false,
              isPresent: true,
              memory: [
                {
                  id: 'cm_a',
                  fact: 'PRESENT_A_MEMORY_ONLY',
                  certainty: 'KNOWN',
                  source: 'OBSERVED',
                  acquired_turn: 1,
                },
              ],
            },
            {
              id: 'char-b',
              name: 'Dr. Evans',
              role: 'Scientist',
              description: 'Second Researcher',
              isUserCharacter: false,
              isPresent: true,
              memory: [
                {
                  id: 'cm_b',
                  fact: 'PRESENT_B_MEMORY_ONLY',
                  certainty: 'KNOWN',
                  source: 'OBSERVED',
                  acquired_turn: 1,
                },
              ],
            },
            {
              id: 'char-absent',
              name: 'Warden Absent',
              role: 'Warden',
              description: 'Absent Facility Warden',
              isUserCharacter: false,
              isPresent: false,
              memory: [
                {
                  id: 'cm_absent',
                  fact: 'ABSENT_MEMORY_MUST_NOT_RENDER',
                  certainty: 'KNOWN',
                  source: 'OBSERVED',
                  acquired_turn: 1,
                },
              ],
            },
          ],
          topology: {
            currentNodeId: 'LAB_01',
            readableNodeLabel: 'Laboratory 01',
            allowedOutgoingExits: [],
          },
          runtime: {
            turnNumber: 2,
            phase: 'LATENT',
            tension: 1,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
          },
          memoryState: {
            'char-unrelated': [
              {
                id: 'cm_top_unrelated',
                fact: 'TOP_LEVEL_MEMORY_MUST_NOT_RENDER',
                certainty: 'KNOWN',
                source: 'OBSERVED',
                acquired_turn: 1,
              },
            ],
          },
          horrorGrammar: defaultTestHorrorGrammarContext,
        },
      };

      const response = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(turnPayload),
      });

      expect(response.status).toBe(200);
      const jsonResponse = (await response.json()) as TurnResponse;

      // 1. Assert normal valid response shape
      expect(jsonResponse.narrative_blocks).toHaveLength(1);
      expect(jsonResponse.narrative_blocks[0].content).toContain('Dr. Evans');
      expect(jsonResponse.intentReceipt.action_kind).toBe('INVESTIGATE');
      expect(jsonResponse.narrativeReconciliationReceipt.mode).toBe('CANONICAL');
      expect(jsonResponse.characterMemoryReceipt.version).toBe(1);
      expect(jsonResponse.characterMemoryReceipt.decisions).toHaveLength(0);
      expect(jsonResponse.worldMemoryReceipt.version).toBe(1);
      expect(jsonResponse.worldMemoryReceipt.decisions).toHaveLength(0);

      // 2. Assert generateStructuredResponse was called exactly once
      expect(mockGenerateStructuredResponse).toHaveBeenCalledTimes(1);

      // 3. Capture the exact first argument passed to generateStructuredResponse
      const capturedPrompt = mockGenerateStructuredResponse.mock.calls[0][0] as string;

      // 4. Assert contract presence and inclusion of present eligible records
      expect(capturedPrompt).toContain('[SYSTEM DIRECTIVE]');
      expect(capturedPrompt).toContain(
        'SYSTEM_DIRECTIVE_CANARY: Keep prose clinical and objective.'
      );
      expect(capturedPrompt).toContain('[NARRATIVE OUTPUT BOUNDARY]');
      expect(capturedPrompt).toContain('Emit no more than 3 total narrative_blocks.');
      expect(capturedPrompt).toContain('[CHARACTER MEMORY CONTRACT]');
      expect(capturedPrompt).toContain('Dr. Evans (ID: char-a)');
      expect(capturedPrompt).toContain('PRESENT_A_MEMORY_ONLY');
      expect(capturedPrompt).toContain('Dr. Evans (ID: char-b)');
      expect(capturedPrompt).toContain('PRESENT_B_MEMORY_ONLY');

      // 5. Assert exclusion of player, absent, and top-level sentinels
      expect(capturedPrompt).not.toContain('PLAYER_MEMORY_MUST_NOT_RENDER');
      expect(capturedPrompt).not.toContain('ABSENT_MEMORY_MUST_NOT_RENDER');
      expect(capturedPrompt).not.toContain('TOP_LEVEL_MEMORY_MUST_NOT_RENDER');

      // 6. Prove duplicate-name records remain isolated using exact ID-based section boundaries
      const memoryContractIndex = capturedPrompt.indexOf('[CHARACTER MEMORY CONTRACT]');
      expect(memoryContractIndex).toBeGreaterThan(-1);

      const consequenceContractIndex = capturedPrompt.indexOf(
        '[CANONICAL CONSEQUENCE CONTRACT]',
        memoryContractIndex
      );
      expect(consequenceContractIndex).toBeGreaterThan(memoryContractIndex);

      const characterMemorySection = capturedPrompt.slice(
        memoryContractIndex,
        consequenceContractIndex
      );

      const memoriesHeaderIndex = characterMemorySection.indexOf('Current Memories by Character:');
      expect(memoriesHeaderIndex).toBeGreaterThan(-1);

      const charAHeader = '• Dr. Evans (ID: char-a)';
      const charBHeader = '• Dr. Evans (ID: char-b)';
      const charAIndex = characterMemorySection.indexOf(charAHeader, memoriesHeaderIndex);
      const charBIndex = characterMemorySection.indexOf(charBHeader, memoriesHeaderIndex);

      expect(charAIndex).toBeGreaterThan(-1);
      expect(charBIndex).toBeGreaterThan(charAIndex);

      // Block A: begins at Dr. Evans (ID: char-a) up to Dr. Evans (ID: char-b)
      const blockA = characterMemorySection.slice(charAIndex, charBIndex);
      expect(blockA).toContain('PRESENT_A_MEMORY_ONLY');
      expect(blockA).not.toContain('PRESENT_B_MEMORY_ONLY');

      // Block B: begins at Dr. Evans (ID: char-b) up to the proposal directives / end of memory list
      const endOfMemoriesIndex = characterMemorySection.indexOf(
        '\n- character_memory_proposal.candidates',
        charBIndex
      );
      const blockB = characterMemorySection.slice(
        charBIndex,
        endOfMemoriesIndex !== -1 ? endOfMemoriesIndex : undefined
      );
      expect(blockB).toContain('PRESENT_B_MEMORY_ONLY');
      expect(blockB).not.toContain('PRESENT_A_MEMORY_ONLY');
    });

    it('proves /api/turn with an explicit non-first player character formats playable perspective, isolates cast memory, and invokes model with bound identity', async () => {
      const validMockTurnResult: TurnResult = {
        narrative_blocks: [
          {
            type: 'prose',
            content: 'You examine the diagnostic array.',
            medium: 'direct',
            delivery: 'spoken',
            target: 'addressed',
          },
        ],
        intent_proposal: {
          action_kind: 'INVESTIGATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: {
          mutations: [],
        },
        character_stance_proposal: {
          changes: [],
        },
        character_relationship_proposal: {
          changes: [],
        },
        character_memory_proposal: {
          candidates: [],
        },
        world_memory_proposal: {
          candidates: [],
        },
        cast_activity_proposal: {
          kind: 'NONE',
          reason: 'NO_OPPORTUNITY_CHOSEN',
        },
        situated_pressure_proposal: {
          kind: 'NONE',
          reason: 'NO_PRESSURE_CHOSEN',
        },
        value_state_proposal: {
          changes: [],
        },
        character_pursuit_proposal: {
          changes: [],
        },
        character_development_proposal: {
          changes: [],
        },
        pressure_transition_proposal: {
          transitions: [],
        },
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 1,
          requested_transition: null,
          terminal_flags: [],
          cast_arrivals: [],
          cast_departures: [],
          cast_deltas: [],
          cast_ledger: [],
        },
        topologyDelta: {
          isExpansion: false,
          newNodeDef: null,
        },
      };

      mockGenerateStructuredResponse.mockResolvedValueOnce(validMockTurnResult);

      const turnPayload = {
        userAction: 'I check the primary terminal interface.',
        recentHistory: 'The facility hums with quiet power.',
        systemDirective: 'Keep prose clinical.',
        isExpansionExpected: false,
        stateContext: {
          currentNodeId: 'CHAMBER_01',
          currentPhase: 'LATENT',
          tensionLevel: 1,
          reconciliationRevision: 0,
        },
        context: {
          version: 1,
          scenario: {
            title: 'Generic Enclosure',
            premise: 'A generic test facility.',
            worldRules: ['Rules are strictly enforced.'],
            setting: {
              location: 'Chamber 01',
              atmosphere: 'Sterile',
              timePeriod: 'Present',
            },
            startingVector: 'COGNITIVE',
            startingTier: 'LATENT',
            incitingIncident: 'System boot.',
            pacingDirective: 'Controlled.',
            keyPlotElements: ['The primary console'],
          },
          player: {
            role: 'protagonist',
            characterId: 'char-2',
            name: 'Mortal Two',
            description: 'Second generic mortal subject.',
            isEntity: false,
          },
          cast: [
            {
              id: 'char-1',
              name: 'Mortal One',
              role: 'Specialist',
              description: 'First generic mortal subject.',
              personality: 'Cautious',
              goals: 'Survive',
              traits: ['Observant'],
              isEntity: false,
              isUserCharacter: false,
              isPresent: true,
              memory: [
                {
                  id: 'cm_mortal_1',
                  fact: 'NON_PLAYER_PRESENT_MEMORY',
                  certainty: 'KNOWN',
                  source: 'OBSERVED',
                  acquired_turn: 1,
                },
              ],
            },
            {
              id: 'char-2',
              name: 'Mortal Two',
              role: 'Operator',
              description: 'Second generic mortal subject.',
              personality: 'Pragmatic',
              goals: 'Repair systems',
              traits: ['Analytical'],
              isEntity: false,
              isUserCharacter: true,
              isPresent: true,
              memory: [
                {
                  id: 'cm_mortal_2',
                  fact: 'PLAYER_CHARACTER_MEMORY_DO_NOT_RENDER',
                  certainty: 'KNOWN',
                  source: 'OBSERVED',
                  acquired_turn: 1,
                },
              ],
            },
          ],
          topology: {
            currentNodeId: 'CHAMBER_01',
            readableNodeLabel: 'Chamber 01',
            allowedOutgoingExits: [],
          },
          runtime: {
            turnNumber: 1,
            phase: 'LATENT',
            tension: 1,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
          },
          horrorGrammar: defaultTestHorrorGrammarContext,
        },
      };

      const response = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(turnPayload),
      });

      expect(response.status).toBe(200);
      const jsonResponse = (await response.json()) as TurnResponse;

      // 1. Assert normal valid response shape
      expect(jsonResponse.narrative_blocks).toHaveLength(1);
      expect(jsonResponse.narrative_blocks[0].content).toContain('diagnostic array');
      expect(jsonResponse.intentReceipt.action_kind).toBe('INVESTIGATE');

      // 2. Assert model was invoked once with formatted prompt
      expect(mockGenerateStructuredResponse).toHaveBeenCalledTimes(1);
      const capturedPrompt = mockGenerateStructuredResponse.mock.calls[0][0] as string;

      // 3. Assert prompt names the non-first character as playable perspective
      expect(capturedPrompt).toContain('[PLAYABLE PERSPECTIVE]');
      expect(capturedPrompt).toContain('Character: Mortal Two (ID: char-2) - Second generic mortal subject.');

      // 4. Assert non-player character memory is rendered while player-character memory is excluded
      expect(capturedPrompt).toContain('NON_PLAYER_PRESENT_MEMORY');
      expect(capturedPrompt).not.toContain('PLAYER_CHARACTER_MEMORY_DO_NOT_RENDER');
    });

    it('returns bounded diagnostics when a concise human turn violates the model contract', async () => {
      const baseTurnPayload = {
        userAction: 'Where is the emergency conduit?',
        recentHistory: 'You stand before the bulkhead.',
        systemDirective: 'Keep prose clinical.',
        isExpansionExpected: false,
        stateContext: {
          currentNodeId: 'CHAMBER_01',
          currentPhase: 'LATENT',
          tensionLevel: 1,
          reconciliationRevision: 0,
        },
        context: {
          version: 1,
          scenario: {
            title: 'Diagnostic Test Enclosure',
            premise: 'Testing failure contract boundaries.',
            worldRules: [],
            setting: { location: 'Chamber 01', atmosphere: 'Cold', timePeriod: 'Present' },
            startingVector: 'COGNITIVE',
            startingTier: 'LATENT',
            incitingIncident: 'Init.',
            pacingDirective: 'Direct.',
            keyPlotElements: [],
          },
          player: {
            role: 'protagonist',
            characterId: 'char-1',
            name: 'Subject One',
            description: 'Test subject',
            isEntity: false,
          },
          cast: [
            {
              id: 'char-1',
              name: 'Subject One',
              role: 'Protagonist',
              description: '',
              isUserCharacter: true,
              isPresent: true,
            },
            {
              id: 'char-2',
              name: 'Technician Mercer',
              role: 'Custodian',
              description: 'Station tech',
              isUserCharacter: false,
              isPresent: true,
            },
          ],
          topology: {
            currentNodeId: 'CHAMBER_01',
            readableNodeLabel: 'Chamber 01',
            allowedOutgoingExits: [],
          },
          runtime: {
            turnNumber: 1,
            phase: 'LATENT',
            tension: 1,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
          },
          horrorGrammar: defaultTestHorrorGrammarContext,
        },
      };

      // 1. Valid Turn Path: Concise human dialogue is placed in prompt unchanged and follows normal route
      const validResult: TurnResult = {
        narrative_blocks: [
          {
            type: 'dialogue',
            speaker: 'Technician Mercer',
            content: 'Behind the secondary panel.',
            medium: 'direct',
            delivery: 'spoken',
            target: 'addressed',
          },
          {
            type: 'prose',
            content: 'He points toward the rusted wall access.',
            medium: 'direct',
            delivery: 'spoken',
            target: 'addressed',
          },
        ],
        intent_proposal: {
          action_kind: 'COMMUNICATE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'EXPOSURE',
          intent_synergy: 'SUCCESS',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'WITHIN_CONTRACT',
          memory_echo_candidate: null,
        },
        consequence_proposal: { mutations: [] },
        character_stance_proposal: { changes: [] },
        character_relationship_proposal: { changes: [] },
        character_memory_proposal: { candidates: [] },
        world_memory_proposal: { candidates: [] },
        cast_activity_proposal: { kind: 'NONE', reason: 'NO_OPPORTUNITY_CHOSEN' },
        situated_pressure_proposal: { kind: 'NONE', reason: 'NO_PRESSURE_CHOSEN' },
        value_state_proposal: { changes: [] },
        character_pursuit_proposal: { changes: [] },
        character_development_proposal: { changes: [] },
        pressure_transition_proposal: { transitions: [] },
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 20,
          requested_transition: null,
          terminal_flags: [],
          cast_arrivals: [],
          cast_departures: [],
          cast_deltas: [],
          cast_ledger: [],
        },
        topologyDelta: { isExpansion: false, newNodeDef: null },
      };

      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockResolvedValueOnce(validResult);

      const validResponse = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseTurnPayload),
      });

      expect(validResponse.status).toBe(200);
      expect(mockGenerateStructuredResponse).toHaveBeenCalledTimes(1);
      const promptCall = mockGenerateStructuredResponse.mock.calls[0][0] as string;
      expect(promptCall).toContain('[USER ACTION]: Where is the emergency conduit?');

      // 2. Zod Schema Failure Path: returns 502 with MODEL_CONTRACT_MISMATCH and bounded path/code diagnostics
      const dummySchema = (await import('zod')).z.object({
        consequence_proposal: (await import('zod')).z.object({
          mutations: (await import('zod')).z.array(
            (await import('zod')).z.object({ value: (await import('zod')).z.string() })
          ),
        }),
        narrative_blocks: (await import('zod')).z.array((await import('zod')).z.any()).max(2),
      });

      const parseAttempt = dummySchema.safeParse({
        consequence_proposal: {
          mutations: [{ value: 123 as unknown as string }],
        },
        narrative_blocks: [1, 2, 3],
      });
      const zodError = parseAttempt.error!;

      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockRejectedValueOnce(zodError);

      const zodFailResponse = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseTurnPayload),
      });

      expect(zodFailResponse.status).toBe(502);
      const zodFailJson = (await zodFailResponse.json()) as Record<string, unknown>;
      expect(zodFailJson.code).toBe('MODEL_CONTRACT_MISMATCH');
      expect(zodFailJson.error).toBe('Model output violated schema contract');
      expect(zodFailJson.details).toBeUndefined(); // Raw details omitted to avoid leaking model output

      const zodDiag = zodFailJson.diagnostics as {
        kind: string;
        issues: Array<{ path: string; code: string }>;
      };
      expect(zodDiag).toBeDefined();
      expect(zodDiag.kind).toBe('SCHEMA_VALIDATION');
      expect(zodDiag.issues).toHaveLength(2);
      expect(zodDiag.issues[0]).toEqual({
        path: 'consequence_proposal.mutations.0.value',
        code: 'invalid_type',
      });
      expect(zodDiag.issues[1]).toEqual({
        path: 'narrative_blocks',
        code: 'too_big',
      });

      // 3. JSON Parse Failure Path: returns 502 with JSON_PARSE diagnostic
      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON'));

      const parseFailResponse = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseTurnPayload),
      });

      expect(parseFailResponse.status).toBe(502);
      const parseFailJson = (await parseFailResponse.json()) as Record<string, unknown>;
      expect(parseFailJson.code).toBe('MODEL_CONTRACT_MISMATCH');
      const parseDiag = parseFailJson.diagnostics as {
        kind: string;
        issues: Array<{ path: string; code: string }>;
      };
      expect(parseDiag.kind).toBe('JSON_PARSE');
      expect(parseDiag.issues).toEqual([{ path: '$', code: 'invalid_json' }]);

      // 4. Dialogue Contract Failure Path: returns 502 with DIALOGUE_CONTRACT diagnostic
      const dialogueViolationResult: TurnResult = {
        ...validResult,
        narrative_blocks: [
          {
            type: 'dialogue',
            speaker: 'Ghost Persona',
            content: 'I am not in the cast.',
            medium: 'direct',
            delivery: 'spoken',
            target: 'addressed',
          },
        ],
      };

      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockResolvedValueOnce(dialogueViolationResult);

      const dialogueFailResponse = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseTurnPayload),
      });

      expect(dialogueFailResponse.status).toBe(502);
      const dialogueFailJson = (await dialogueFailResponse.json()) as Record<string, unknown>;
      expect(dialogueFailJson.code).toBe('MODEL_CONTRACT_MISMATCH');
      expect(dialogueFailJson.error).toBe('Model output violated dialogue contract');
      const dialogueDiag = dialogueFailJson.diagnostics as {
        kind: string;
        issues: Array<{ path: string; code: string }>;
      };
      expect(dialogueDiag.kind).toBe('DIALOGUE_CONTRACT');
      expect(dialogueDiag.issues).toEqual([
        { path: 'narrative_blocks', code: 'dialogue_contract_violation' },
      ]);
      // 5. Provider Failure Path: returns 502 with PROVIDER_FAILURE and generic error message (never leaks raw exception, URLs, or credentials)
      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockRejectedValueOnce(
        new Error('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5:generateContent?key=AIzaSyD-Secret123: 503 Service Unavailable')
      );

      const providerFailResponse = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseTurnPayload),
      });

      expect(providerFailResponse.status).toBe(502);
      const providerFailJson = (await providerFailResponse.json()) as Record<string, unknown>;
      expect(providerFailJson.code).toBe('PROVIDER_FAILURE');
      expect(providerFailJson.error).toBe('AI provider turn generation failed');
      expect(providerFailJson.message).toBeUndefined();
      expect(JSON.stringify(providerFailJson)).not.toContain('generativelanguage.googleapis.com');
      expect(JSON.stringify(providerFailJson)).not.toContain('AIzaSyD-Secret123');
      expect(JSON.stringify(providerFailJson)).not.toContain('503 Service Unavailable');

      // 6. Provider Refusal Path: returns 502 with PROVIDER_REFUSAL and safe generic message
      const { ProviderRefusalError, EmptyProviderResponseError } = await import('../utils/aiClient');
      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockRejectedValueOnce(
        new ProviderRefusalError('SAFETY')
      );

      const refusalResponse = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseTurnPayload),
      });

      expect(refusalResponse.status).toBe(502);
      const refusalJson = (await refusalResponse.json()) as Record<string, unknown>;
      expect(refusalJson.code).toBe('PROVIDER_REFUSAL');
      expect(refusalJson.error).toBe('AI provider declined turn generation');
      expect(JSON.stringify(refusalJson)).not.toContain('SAFETY');
      expect(JSON.stringify(refusalJson)).not.toContain('http');

      // 7. Empty Provider Response Path: returns 502 with PROVIDER_FAILURE (not MODEL_CONTRACT_MISMATCH)
      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockRejectedValueOnce(
        new EmptyProviderResponseError()
      );

      const emptyResponse = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseTurnPayload),
      });

      expect(emptyResponse.status).toBe(502);
      const emptyJson = (await emptyResponse.json()) as Record<string, unknown>;
      expect(emptyJson.code).toBe('PROVIDER_FAILURE');
      expect(emptyJson.code).not.toBe('MODEL_CONTRACT_MISMATCH');
    });

    it('Packet 1C-5: renders PLAYER STARTING ORIENTATION and suppresses Initial Core Goal when openingAimDisposition is present', async () => {
      let capturedPrompt = '';
      const dummyValidResult: TurnResult = {
        narrative_blocks: [
          {
            type: 'prose',
            content: 'Elena stays motionless, surveying the bulkhead.',
            medium: 'direct',
            delivery: 'spoken',
            target: 'addressed',
          },
        ],
        intent_proposal: {
          action_kind: 'OBSERVE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'EXPOSURE',
          intent_synergy: 'SUCCESS',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'WITHIN_CONTRACT',
          memory_echo_candidate: null,
        },
        consequence_proposal: { mutations: [] },
        character_stance_proposal: { changes: [] },
        character_relationship_proposal: { changes: [] },
        character_memory_proposal: { candidates: [] },
        world_memory_proposal: { candidates: [] },
        cast_activity_proposal: { kind: 'NONE', reason: 'NO_OPPORTUNITY_CHOSEN' },
        situated_pressure_proposal: { kind: 'NONE', reason: 'NO_PRESSURE_CHOSEN' },
        value_state_proposal: { changes: [] },
        character_pursuit_proposal: { changes: [] },
        character_development_proposal: { changes: [] },
        pressure_transition_proposal: { transitions: [] },
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 20,
          requested_transition: null,
          terminal_flags: [],
          cast_arrivals: [],
          cast_departures: [],
          cast_deltas: [],
          cast_ledger: [],
        },
        topologyDelta: { isExpansion: false, newNodeDef: null },
      };

      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockImplementation((prompt: string) => {
        capturedPrompt = prompt;
        return Promise.resolve(dummyValidResult);
      });

      const baseTurnPayload = {
        userAction: 'Where is the emergency conduit?',
        recentHistory: 'You stand before the bulkhead.',
        systemDirective: 'Keep prose clinical.',
        isExpansionExpected: false,
        stateContext: {
          currentNodeId: 'CHAMBER_01',
          currentPhase: 'LATENT',
          tensionLevel: 1,
          reconciliationRevision: 0,
        },
        context: {
          version: 1,
          scenario: {
            title: 'Diagnostic Test Enclosure',
            premise: 'Testing failure contract boundaries.',
            worldRules: [],
            setting: { location: 'Chamber 01', atmosphere: 'Cold', timePeriod: 'Present' },
            startingVector: 'COGNITIVE',
            startingTier: 'LATENT',
            incitingIncident: 'Init.',
            pacingDirective: 'Direct.',
            keyPlotElements: [],
          },
          player: {
            role: 'protagonist',
            characterId: 'char-1',
            name: 'Subject One',
            description: 'Test subject',
            isEntity: false,
          },
          cast: [
            {
              id: 'char-1',
              name: 'Subject One',
              role: 'Protagonist',
              description: '',
              isUserCharacter: true,
              isPresent: true,
            },
          ],
          topology: {
            currentNodeId: 'CHAMBER_01',
            readableNodeLabel: 'Chamber 01',
            allowedOutgoingExits: [],
          },
          runtime: {
            turnNumber: 1,
            phase: 'LATENT',
            tension: 1,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
          },
          horrorGrammar: defaultTestHorrorGrammarContext,
        },
      };

      // 1. ACCEPTED_REFERENCE test
      const payloadWithAcceptedAim = {
        ...baseTurnPayload,
        context: {
          ...baseTurnPayload.context,
          player: {
            ...baseTurnPayload.context.player,
            openingAim: 'Investigate acoustic vibrations in Trench 4.',
            openingAimDisposition: 'ACCEPTED_REFERENCE',
            sovereigntyInstruction:
              'This opening aim represents historical starting orientation only. The user retains complete sovereignty over whether, when, and how to pursue it. The Engine must never assert unchosen user actions, internal decisions, or mandatory quests based on this aim.',
          },
        },
      };

      const res1 = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadWithAcceptedAim),
      });
      expect(res1.status).toBe(200);
      expect(capturedPrompt).toContain('[PLAYER STARTING ORIENTATION]');
      expect(capturedPrompt).toContain('Investigate acoustic vibrations in Trench 4.');
      expect(capturedPrompt).toContain('sovereignty');
      // Must NOT contain the legacy Initial Core Goal line in participationSection
      expect(capturedPrompt).not.toContain('Initial Core Goal:');

      // 2. NONE_DECLARED test
      const payloadWithNoneDeclared = {
        ...baseTurnPayload,
        context: {
          ...baseTurnPayload.context,
          player: {
            ...baseTurnPayload.context.player,
            openingAim: undefined,
            openingAimDisposition: 'NONE_DECLARED',
            sovereigntyInstruction:
              'No opening aim was declared for this character. The Engine must never infer, fabricate, or supply an unchosen starting goal or quest.',
          },
        },
      };

      const res2 = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadWithNoneDeclared),
      });
      expect(res2.status).toBe(200);
      expect(capturedPrompt).toContain('[PLAYER STARTING ORIENTATION]');
      expect(capturedPrompt).toContain('None declared. Note:');
      expect(capturedPrompt).toContain('never infer, fabricate, or supply');
      expect(capturedPrompt).not.toContain('Initial Core Goal:');
    });

    it('injects OPENING SCENE ESTABLISHMENT DIRECTIVE on SYSTEM_INIT with scene, cast, perspective, and anti-in-media-res mandates', async () => {
      let capturedPrompt = '';
      const dummyValidResult = {
        narrative_blocks: [
          { type: 'prose', content: 'The Whitehall Jaunting facility is sterile and cold.' },
          { type: 'dialogue', speaker: 'Ricky Oates', content: 'Dad, how much longer until we jaunt?' },
        ],
        intent_proposal: {
          action_kind: 'SYSTEM',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'NONE',
          intent_synergy: 'N/A',
        },
        reconciliation_proposal: {
          mode: 'NOT_REQUIRED',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'NONE',
          authority_alignment: 'NOT_APPLICABLE',
          memory_echo_candidate: null,
        },
        consequence_proposal: { mutations: [] },
        character_stance_proposal: { changes: [] },
        character_relationship_proposal: { changes: [] },
        character_memory_proposal: { candidates: [] },
        world_memory_proposal: { candidates: [] },
        cast_activity_proposal: { kind: 'NONE', reason: 'NO_OPPORTUNITY_CHOSEN' },
        situated_pressure_proposal: { kind: 'NONE', reason: 'NO_PRESSURE_CHOSEN' },
        value_state_proposal: { changes: [] },
        character_pursuit_proposal: { changes: [] },
        character_development_proposal: { changes: [] },
        pressure_transition_proposal: { transitions: [] },
        logic_state: {
          current_phase: 'LATENT',
          suggested_tension: 0,
          requested_transition: null,
          terminal_flags: [],
          cast_deltas: [],
          cast_ledger: [],
        },
        topologyDelta: { isExpansion: false, newNodeDef: null },
      };

      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockImplementation((prompt: string) => {
        capturedPrompt = prompt;
        return Promise.resolve(dummyValidResult);
      });

      const systemInitPayload = {
        userAction: 'SYSTEM_INIT',
        recentHistory: '',
        systemDirective: 'Keep prose clinical and atmospheric.',
        isExpansionExpected: false,
        stateContext: {
          currentNodeId: 'WHITEHALL_LOUNGE',
          currentPhase: 'LATENT',
          tensionLevel: 0,
          reconciliationRevision: 0,
        },
        context: {
          version: 1,
          scenario: {
            title: 'The Jaunt',
            premise: 'A family prepares for teleportation to Mars.',
            worldRules: ['One must be asleep during the Jaunt.'],
            setting: {
              location: 'Whitehall Jaunting Facility',
              atmosphere: 'Antiseptic dread and low machinery hum',
              timePeriod: '24th Century',
            },
            startingVector: 'COGNITIVE',
            startingTier: 'LATENT',
            incitingIncident: 'The flight attendant prepares the sleeping gas.',
            pacingDirective: 'Slow burn psychological dread.',
            keyPlotElements: ['The Jaunt portal', 'The masks'],
          },
          player: {
            role: 'survivor',
            characterId: 'char-mark',
            name: 'Mark Oates',
            description: 'Father traveling with his family',
            isEntity: false,
          },
          cast: [
            {
              id: 'char-mark',
              name: 'Mark Oates',
              role: 'Survivor',
              description: 'Father',
              isUserCharacter: true,
              isPresent: true,
            },
            {
              id: 'char-ricky',
              name: 'Ricky Oates',
              role: 'Prey',
              description: 'Inquisitive 12-year-old son',
              isUserCharacter: false,
              isPresent: true,
            },
            {
              id: 'char-marilena',
              name: 'Marilena Oates',
              role: 'Survivor',
              description: 'Nervous mother',
              isUserCharacter: false,
              isPresent: true,
            },
          ],
          topology: {
            currentNodeId: 'WHITEHALL_LOUNGE',
            readableNodeLabel: 'Departure Lounge B',
            allowedOutgoingExits: [],
          },
          runtime: {
            turnNumber: 0,
            phase: 'LATENT',
            tension: 0,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeVector: 'COGNITIVE',
            activeTier: 'LATENT',
          },
          horrorGrammar: defaultTestHorrorGrammarContext,
        },
      };

      const res = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(systemInitPayload),
      });

      expect(res.status).toBe(200);
      expect(capturedPrompt).toContain('[OPENING SCENE ESTABLISHMENT DIRECTIVE - SYSTEM_INIT]');
      expect(capturedPrompt).toContain('SET THE SCENE & SENSORY TONE:');
      expect(capturedPrompt).toContain('Departure Lounge B');
      expect(capturedPrompt).toContain('Whitehall Jaunting Facility');
      expect(capturedPrompt).toContain('DEFINE THE PLAYABLE PERSPECTIVE:');
      expect(capturedPrompt).toContain('ESTABLISH PRESENT CAST MEMBERS & OPENING DIALOGUE:');
      expect(capturedPrompt).toContain('Ricky Oates');
      expect(capturedPrompt).toContain('Marilena Oates');
      expect(capturedPrompt).toContain('AVOID "IN MEDIA RES" CHAOS:');
      expect(capturedPrompt).toContain('DIALOGUE EXPECTATION & LIVING VOICES:');
      expect(capturedPrompt).toContain('LIVING DRAMATIZATION:');
    });

    it('renders VILLAIN DYNAMICS block in villain/antagonist prompt when 2+ villains and relationships exist, and omits when single villain', async () => {
      let capturedPrompt = '';
      const dummyVillainResult = {
        narrative_blocks: [
          {
            type: 'prose',
            content: 'The facility stays silent.',
            medium: 'direct',
            delivery: 'spoken',
            target: 'addressed',
          },
        ],
        intent_proposal: {
          action_kind: 'OBSERVE',
          action_subtype: null,
          pressure_direction: 'MAINTAIN',
          dramatic_tactic: 'EXPOSURE',
          intent_synergy: 'SUCCESS',
        },
        reconciliation_proposal: {
          mode: 'CANONICAL',
          feasibility: 'SUPPORTED',
          reason_code: 'NONE',
          fictional_time_cost: 'MOMENT',
          authority_alignment: 'WITHIN_CONTRACT',
          memory_echo_candidate: null,
        },
        consequence_proposal: { mutations: [] },
        character_stance_proposal: { changes: [] },
        character_relationship_proposal: { changes: [] },
        character_memory_proposal: { candidates: [] },
        world_memory_proposal: { candidates: [] },
        cast_activity_proposal: { kind: 'NONE', reason: 'NO_OPPORTUNITY_CHOSEN' },
        situated_pressure_proposal: { kind: 'NONE', reason: 'NO_PRESSURE_CHOSEN' },
        value_state_proposal: { changes: [] },
        character_pursuit_proposal: { changes: [] },
        character_development_proposal: { changes: [] },
        pressure_transition_proposal: { transitions: [] },
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 20,
          requested_transition: null,
          terminal_flags: [],
          cast_arrivals: [],
          cast_departures: [],
          cast_deltas: [],
        },
      };

      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockImplementation((prompt: string) => {
        capturedPrompt = prompt;
        return Promise.resolve(dummyVillainResult);
      });

      const multiVillainPayload = {
        userAction: 'I observe the facility from the shadows.',
        recentHistory: 'The facility is dark.',
        systemDirective: 'Keep prose clinical.',
        isExpansionExpected: false,
        stateContext: {
          currentNodeId: 'WARD_A',
          currentPhase: 'MANIFEST',
          tensionLevel: 2,
          reconciliationRevision: 0,
        },
        context: {
          version: 1,
          scenario: {
            title: 'Containment Sector 4',
            premise: 'Multiple predators stalk the quarantined sector.',
            worldRules: ['No lights active.'],
            setting: {
              location: 'Quarantine Ward',
              atmosphere: 'Freezing, dark, and damp.',
              timePeriod: 'Present',
            },
            startingVector: 'SOMATIC',
            startingTier: 'MANIFEST',
            incitingIncident: 'Breach containment initiated.',
            pacingDirective: 'Cold predation.',
            keyPlotElements: ['The lockdown keycard'],
          },
          player: {
            role: 'villain',
            characterId: 'char-v1',
            name: 'The Stalker',
            description: 'Predatory killer.',
            isEntity: false,
          },
          cast: [
            {
              id: 'char-v1',
              name: 'The Stalker',
              role: 'Villain',
              description: 'Predatory stalker.',
              personality: 'Cold',
              goals: 'Hunt',
              traits: ['Dangerous'],
              isUserCharacter: true,
              isEntity: false,
              skepticism: 0,
              isPresent: true,
              stance: null,
              memory: [],
            },
            {
              id: 'char-v2',
              name: 'The Overseer',
              role: 'Antagonist',
              description: 'Facility warden.',
              personality: 'Authoritarian',
              goals: 'Control',
              traits: ['Calculating'],
              isUserCharacter: false,
              isEntity: true,
              skepticism: 0,
              isPresent: true,
              stance: null,
              memory: [],
            },
            {
              id: 'char-s1',
              name: 'Survivor Jane',
              role: 'Protagonist',
              description: 'Target subject.',
              personality: 'Afraid',
              goals: 'Escape',
              traits: ['Resourceful'],
              isUserCharacter: false,
              isEntity: false,
              skepticism: 0.5,
              isPresent: true,
              stance: null,
              memory: [],
            },
          ],
          topology: {
            currentNodeId: 'WARD_A',
            readableNodeLabel: 'Ward A',
            allowedOutgoingExits: [],
          },
          runtime: {
            turnNumber: 1,
            phase: 'MANIFEST',
            tension: 2,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeVector: 'SOMATIC',
            activeTier: 'MANIFEST',
            activeFlags: [],
          },
          horrorGrammar: defaultTestHorrorGrammarContext,
          participationContext: {
            mode: 'villain',
            seat: { kind: 'villain', name: 'The Stalker' },
            initialGoal: 'Isolate target',
            boundedFacts: ['Power grid offline.'],
            victimField: {
              kind: 'individual',
              name: 'Survivor Jane',
              description: 'Trapped survivor.',
            },
          },
          relationshipState: [
            {
              source_character_id: 'char-v1',
              target_character_id: 'char-v2',
              kind: 'SUSPICION',
              intensity: 2,
            },
          ],
        },
      };

      const res = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(multiVillainPayload),
      });

      expect(res.status).toBe(200);
      expect(capturedPrompt).toContain('VILLAIN DYNAMICS (rival predators in play):');
      expect(capturedPrompt).toContain('• The Stalker -> The Overseer: SUSPICION (2) — distrusts; verifies before acting');

      // Now single villain: char-v2 becomes Scientist (not a villain)
      capturedPrompt = '';
      mockGenerateStructuredResponse.mockReset();
      mockGenerateStructuredResponse.mockImplementation((prompt: string) => {
        capturedPrompt = prompt;
        return Promise.resolve(dummyVillainResult);
      });
      const singleVillainPayload = {
        ...multiVillainPayload,
        context: {
          ...multiVillainPayload.context,
          cast: [
            multiVillainPayload.context.cast[0],
            {
              ...multiVillainPayload.context.cast[1],
              role: 'Scientist',
              isEntity: false,
            },
            multiVillainPayload.context.cast[2],
          ],
        },
      };

      const resSingle = await fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(singleVillainPayload),
      });

      expect(resSingle.status).toBe(200);
      expect(capturedPrompt).not.toContain('VILLAIN DYNAMICS');
    });
  });
});
