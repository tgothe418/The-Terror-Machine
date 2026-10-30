import { describe, it, expect } from 'vitest';
import {
  CAMPAIGN_CARRYOVER_WHITELIST,
  CampaignCarryoverWhitelistSchema,
  createCampaignCarryoverWhitelist,
  DEFAULT_CAMPAIGN_CARRYOVER_WHITELIST_FLAGS,
  CampaignValueAnchorContinuitySchema,
  CampaignCharacterBondSchema,
  CampaignCharacterContinuitySchema,
  CampaignTransitionReceiptSchema,
  CampaignCarryoverFieldEntrySchema,
  CampaignCarryoverReceiptSchema,
} from './campaignContinuity';
import * as campaignContinuityModule from './campaignContinuity';

describe('Campaign Continuity Schemas (Item 17.1)', () => {
  describe('CampaignCarryoverWhitelistSchema & createCampaignCarryoverWhitelist', () => {
    it('parses a fully specified valid carryover whitelist', () => {
      const valid = {
        survivingCharacterIds: ['char-elena', 'char-marcus'],
        carryPsychologicalScars: true,
        carryValueShifts: true,
        carryRelationshipBonds: true,
        carryPhysicalImpairments: true,
      };

      const parsed = CampaignCarryoverWhitelistSchema.parse(valid);
      expect(parsed).toEqual(valid);
    });

    it('creates a valid whitelist with default flags via createCampaignCarryoverWhitelist helper', () => {
      expect(DEFAULT_CAMPAIGN_CARRYOVER_WHITELIST_FLAGS).toEqual({
        carryPsychologicalScars: true,
        carryValueShifts: true,
        carryRelationshipBonds: true,
        carryPhysicalImpairments: true,
      });

      const whitelist = createCampaignCarryoverWhitelist(['char-sarah']);
      expect(whitelist.survivingCharacterIds).toEqual(['char-sarah']);
      expect(whitelist.carryPsychologicalScars).toBe(true);
      expect(whitelist.carryValueShifts).toBe(true);
      expect(whitelist.carryRelationshipBonds).toBe(true);
      expect(whitelist.carryPhysicalImpairments).toBe(true);
    });

    it('allows overriding specific carryover flags in createCampaignCarryoverWhitelist', () => {
      const whitelist = createCampaignCarryoverWhitelist(['char-sarah'], {
        carryRelationshipBonds: false,
      });
      expect(whitelist.carryRelationshipBonds).toBe(false);
      expect(whitelist.carryPsychologicalScars).toBe(true);
    });

    it('STRICTLY rejects scenario-specific nodes, room objects, or scripted state (HG2 Epistemic Containment)', () => {
      const leakingPayload = {
        survivingCharacterIds: ['char-elena'],
        carryPsychologicalScars: true,
        carryValueShifts: true,
        carryRelationshipBonds: true,
        carryPhysicalImpairments: true,
        // Scenario leaking fields:
        carryWorldObjects: true,
        carryTopologyNodes: ['node-room-101'],
        carryScriptedEvents: true,
      };

      expect(() => CampaignCarryoverWhitelistSchema.parse(leakingPayload)).toThrow(
        /Unrecognized key/i
      );
    });

    it('rejects duplicate character IDs in survivingCharacterIds', () => {
      const duplicateIds = {
        survivingCharacterIds: ['char-elena', 'char-elena'],
        carryPsychologicalScars: true,
        carryValueShifts: true,
        carryRelationshipBonds: true,
        carryPhysicalImpairments: true,
      };

      expect(() => CampaignCarryoverWhitelistSchema.parse(duplicateIds)).toThrow(
        /unique IDs with no duplicates/i
      );
    });

    it('rejects empty string or whitespace-only character IDs', () => {
      const emptyId = {
        survivingCharacterIds: ['   '],
        carryPsychologicalScars: true,
        carryValueShifts: true,
        carryRelationshipBonds: true,
        carryPhysicalImpairments: true,
      };

      expect(() => CampaignCarryoverWhitelistSchema.parse(emptyId)).toThrow();
    });

    it('rejects non-boolean flag values', () => {
      const invalidTypes = {
        survivingCharacterIds: ['char-elena'],
        carryPsychologicalScars: 'yes',
        carryValueShifts: 1,
        carryRelationshipBonds: null,
        carryPhysicalImpairments: true,
      };

      expect(() => CampaignCarryoverWhitelistSchema.parse(invalidTypes)).toThrow();
    });
  });

  describe('CampaignValueAnchorContinuitySchema', () => {
    it('parses valid value anchor continuity records', () => {
      const anchorMinimal = {
        anchorId: 'val-loyalty',
        condition: 'THREATENED',
      };
      const parsedMinimal = CampaignValueAnchorContinuitySchema.parse(anchorMinimal);
      expect(parsedMinimal.anchorId).toBe('val-loyalty');
      expect(parsedMinimal.condition).toBe('THREATENED');
      expect(parsedMinimal.lifecycle).toBe('ACTIVE');
      expect(parsedMinimal.currentFormNote).toBeNull();

      const anchorFull = {
        anchorId: 'val-truth',
        condition: 'COMPROMISED',
        lifecycle: 'ACTIVE',
        currentFormNote: 'Forced to lie to protect the ward',
        lastCauseReference: 'SCENE_TRANSITION',
        lastChangedTurn: 8,
        note: 'Carried into act 2',
      };
      const parsedFull = CampaignValueAnchorContinuitySchema.parse(anchorFull);
      expect(parsedFull.lastChangedTurn).toBe(8);
      expect(parsedFull.currentFormNote).toBe('Forced to lie to protect the ward');
    });

    it('rejects invalid value condition values', () => {
      expect(() =>
        CampaignValueAnchorContinuitySchema.parse({
          anchorId: 'val-1',
          condition: 'UNBREAKABLE',
        })
      ).toThrow();
    });

    it('rejects empty anchor IDs and extra unknown fields', () => {
      expect(() =>
        CampaignValueAnchorContinuitySchema.parse({
          anchorId: '',
          condition: 'ESTABLISHED',
        })
      ).toThrow();

      expect(() =>
        CampaignValueAnchorContinuitySchema.parse({
          anchorId: 'val-1',
          condition: 'ESTABLISHED',
          extraRoomField: 'leak',
        })
      ).toThrow(/Unrecognized key/i);
    });
  });

  describe('CampaignCharacterBondSchema', () => {
    it('parses canonical targetCharacterId bonds', () => {
      const bond = {
        targetCharacterId: 'char-marcus',
        kind: 'TRUST',
        intensity: 3,
        note: 'Stood back-to-back in the basement',
      };
      const parsed = CampaignCharacterBondSchema.parse(bond);
      expect(parsed.targetCharacterId).toBe('char-marcus');
      expect(parsed.intensity).toBe(3);
    });

    it('preprocesses alternative naming conventions (target_character_id or characterId)', () => {
      const bond1 = CampaignCharacterBondSchema.parse({
        target_character_id: 'char-marcus',
        stance: 'trust',
      });
      expect(bond1.targetCharacterId).toBe('char-marcus');

      const bond2 = CampaignCharacterBondSchema.parse({
        characterId: 'char-marcus',
        kind: 'FEAR',
        intensity: 2,
      });
      expect(bond2.targetCharacterId).toBe('char-marcus');
    });

    it('rejects bonds with empty or missing target IDs', () => {
      expect(() =>
        CampaignCharacterBondSchema.parse({
          kind: 'TRUST',
        })
      ).toThrow();
    });
  });

  describe('CampaignCharacterContinuitySchema', () => {
    const validCharacterContinuity = {
      characterId: 'char-elena',
      composure: 65,
      scars: ['Nerve damage in left palm', 'Recurring acoustic dread in tight corridors'],
      impairedCapabilities: ['GRIP_FINE', 'VOCAL_WHISPER'],
      valueAnchors: [
        {
          anchorId: 'val-safety',
          condition: 'THREATENED',
          lifecycle: 'ACTIVE',
        },
      ],
      bonds: [
        {
          targetCharacterId: 'char-marcus',
          kind: 'TRUST',
          intensity: 2,
        },
      ],
    };

    it('parses a complete valid character continuity record', () => {
      const parsed = CampaignCharacterContinuitySchema.parse(validCharacterContinuity);
      expect(parsed.characterId).toBe('char-elena');
      expect(parsed.composure).toBe(65);
      expect(parsed.scars).toHaveLength(2);
      expect(parsed.impairedCapabilities).toEqual(['GRIP_FINE', 'VOCAL_WHISPER']);
      expect(parsed.valueAnchors[0].anchorId).toBe('val-safety');
      expect(parsed.bonds[0].targetCharacterId).toBe('char-marcus');
    });

    it('accepts boundary composure values 0 and 100', () => {
      const zero = CampaignCharacterContinuitySchema.parse({
        ...validCharacterContinuity,
        composure: 0,
      });
      expect(zero.composure).toBe(0);

      const hundred = CampaignCharacterContinuitySchema.parse({
        ...validCharacterContinuity,
        composure: 100,
      });
      expect(hundred.composure).toBe(100);
    });

    it('rejects negative or out-of-bounds composure values', () => {
      expect(() =>
        CampaignCharacterContinuitySchema.parse({
          ...validCharacterContinuity,
          composure: -1,
        })
      ).toThrow(/non-negative/i);

      expect(() =>
        CampaignCharacterContinuitySchema.parse({
          ...validCharacterContinuity,
          composure: 101,
        })
      ).toThrow(/cannot exceed 100/i);

      expect(() =>
        CampaignCharacterContinuitySchema.parse({
          ...validCharacterContinuity,
          composure: NaN,
        })
      ).toThrow();
    });

    it('rejects invalid PhysicalCapability strings', () => {
      expect(() =>
        CampaignCharacterContinuitySchema.parse({
          ...validCharacterContinuity,
          impairedCapabilities: ['NIGHT_VISION'],
        })
      ).toThrow();
    });

    it('allows all six valid PhysicalCapability variants', () => {
      const allCapabilities = [
        'GRIP_FINE',
        'GRIP_COARSE',
        'LOCOMOTION_RAPID',
        'LOCOMOTION_NORMAL',
        'VOCAL_FULL',
        'VOCAL_WHISPER',
      ];
      const parsed = CampaignCharacterContinuitySchema.parse({
        ...validCharacterContinuity,
        impairedCapabilities: allCapabilities,
      });
      expect(parsed.impairedCapabilities).toEqual(allCapabilities);
    });

    it('rejects empty strings for characterId and scars', () => {
      expect(() =>
        CampaignCharacterContinuitySchema.parse({
          ...validCharacterContinuity,
          characterId: '  ',
        })
      ).toThrow();

      expect(() =>
        CampaignCharacterContinuitySchema.parse({
          ...validCharacterContinuity,
          scars: [''],
        })
      ).toThrow();
    });

    it('rejects extraneous keys to preserve schema integrity', () => {
      expect(() =>
        CampaignCharacterContinuitySchema.parse({
          ...validCharacterContinuity,
          unauthorizedField: 'intruder',
        })
      ).toThrow(/Unrecognized key/i);
    });
  });

  describe('CampaignTransitionReceiptSchema', () => {
    const validReceipt = {
      receiptId: 'receipt-trans-act1-act2-001',
      sourceScenarioId: 'scenario-starlight-motel',
      targetBlueprintId: 'blueprint-fog-basin',
      transitionTurn: 14,
      carriedCharacters: [
        {
          characterId: 'char-elena',
          composure: 40,
          scars: ['Severed tendon scar'],
          impairedCapabilities: ['GRIP_FINE'],
          valueAnchors: [{ anchorId: 'val-escape', condition: 'TRANSFORMED' }],
          bonds: [{ targetCharacterId: 'char-marcus', kind: 'DEPENDENCE', intensity: 3 }],
        },
        {
          characterId: 'char-marcus',
          composure: 55,
          scars: ['Chemical burn on shoulder'],
          impairedCapabilities: ['VOCAL_FULL'],
          valueAnchors: [{ anchorId: 'val-duty', condition: 'THREATENED' }],
          bonds: [{ targetCharacterId: 'char-elena', kind: 'DEPENDENCE', intensity: 3 }],
        },
      ],
      prunedStateKeys: [
        'locationTopology',
        'worldObjectLedger',
        'situatedPressureLedger',
        'routineSchedules',
        'placedClues',
      ],
      timestamp: 'turn-14-campaign-act-boundary',
    };

    it('parses a complete, deterministic transition receipt', () => {
      const parsed = CampaignTransitionReceiptSchema.parse(validReceipt);
      expect(parsed.receiptId).toBe('receipt-trans-act1-act2-001');
      expect(parsed.transitionTurn).toBe(14);
      expect(parsed.carriedCharacters).toHaveLength(2);
      expect(parsed.prunedStateKeys).toContain('locationTopology');
    });

    it('rejects duplicate character entries in carriedCharacters', () => {
      const duplicateReceipt = {
        ...validReceipt,
        carriedCharacters: [
          validReceipt.carriedCharacters[0],
          validReceipt.carriedCharacters[0], // Duplicate characterId 'char-elena'
        ],
      };

      expect(() => CampaignTransitionReceiptSchema.parse(duplicateReceipt)).toThrow(
        /unique characterIds/i
      );
    });

    it('rejects negative or floating point transitionTurn numbers', () => {
      expect(() =>
        CampaignTransitionReceiptSchema.parse({
          ...validReceipt,
          transitionTurn: -1,
        })
      ).toThrow();

      expect(() =>
        CampaignTransitionReceiptSchema.parse({
          ...validReceipt,
          transitionTurn: 2.5,
        })
      ).toThrow();
    });

    it('rejects empty string identifiers', () => {
      expect(() =>
        CampaignTransitionReceiptSchema.parse({
          ...validReceipt,
          receiptId: '   ',
        })
      ).toThrow();

      expect(() =>
        CampaignTransitionReceiptSchema.parse({
          ...validReceipt,
          sourceScenarioId: '',
        })
      ).toThrow();

      expect(() =>
        CampaignTransitionReceiptSchema.parse({
          ...validReceipt,
          targetBlueprintId: '',
        })
      ).toThrow();

      expect(() =>
        CampaignTransitionReceiptSchema.parse({
          ...validReceipt,
          timestamp: '',
        })
      ).toThrow();
    });

    it('rejects unknown extraneous fields', () => {
      expect(() =>
        CampaignTransitionReceiptSchema.parse({
          ...validReceipt,
          extraneousField: 'bad',
        })
      ).toThrow(/Unrecognized key/i);
    });
  });

  describe('CampaignCarryoverFieldEntrySchema & CampaignCarryoverReceiptSchema', () => {
    it('parses field entries correctly', () => {
      const entry = {
        fieldPath: 'gameState.value_state_ledger.val-hope',
        sourceValue: { condition: 'THREATENED', turn: 10 },
        carriedValue: { condition: 'THREATENED', turn: 10 },
        notes: 'Carried forward',
      };
      const parsed = CampaignCarryoverFieldEntrySchema.parse(entry);
      expect(parsed.fieldPath).toBe('gameState.value_state_ledger.val-hope');
      expect(parsed.notes).toBe('Carried forward');
    });

    it('parses a full carryover receipt with carriedFields and resetFields', () => {
      const carryoverReceipt = {
        receiptId: 'co-receipt-001',
        fromBlueprintTitle: 'The Starlight Motel',
        toBlueprintTitle: 'Blackwood Asylum',
        transitionTurnNumber: 15,
        carriedFields: [
          {
            fieldPath: 'survivor.char-elena.scars',
            sourceValue: ['Wrist scar'],
            carriedValue: ['Wrist scar'],
          },
        ],
        resetFields: ['locationTopology', 'placedClues'],
        survivorCharacterIds: ['char-elena'],
        timestamp: 'turn-15-transition',
      };
      const parsed = CampaignCarryoverReceiptSchema.parse(carryoverReceipt);
      expect(parsed.receiptId).toBe('co-receipt-001');
      expect(parsed.fromBlueprintTitle).toBe('The Starlight Motel');
      expect(parsed.toBlueprintTitle).toBe('Blackwood Asylum');
      expect(parsed.carriedFields).toHaveLength(1);
      expect(parsed.resetFields).toEqual(['locationTopology', 'placedClues']);
    });
  });

  describe('Constant Hygiene & Cap Semantics Invariant', () => {
    it('verifies CAMPAIGN_CARRYOVER_WHITELIST contains survivors, valueStateLedger, and campaignActHistory', () => {
      expect(CAMPAIGN_CARRYOVER_WHITELIST).toContain('survivors');
      expect(CAMPAIGN_CARRYOVER_WHITELIST).toContain('valueStateLedger');
      expect(CAMPAIGN_CARRYOVER_WHITELIST).toContain('campaignActHistory');
    });

    it('ensures NO exported constant starts with MAX_ or ends with _LIMIT to prevent cap-semantics drift', () => {
      const exportedKeys = Object.keys(campaignContinuityModule);
      const capLikeConstants = exportedKeys.filter(
        (key) => key.startsWith('MAX_') || key.endsWith('_LIMIT')
      );
      expect(capLikeConstants).toEqual([]);
    });
  });
});
