import { describe, expect, it } from 'vitest';
import {
  buildEngineLogContent,
  generateTelemetryFilename,
  buildCanonicalStateDiff,
  buildChronicleProseContent,
  getEngineLogicData,
} from './download';
import { normalizeTurnFailureReceipt } from './turnResponseReader';
import type {
  RuntimeStateSnapshot,
  IntentReceipt,
  NarrativeReconciliationReceipt,
  CastInteractionReceipt,
  CastContinuityReceipt,
  CastPresenceReceipt,
  TransitionReceipt,
} from '../types';

const mockReceipt = {
  version: 1,
  scenarioTitle: 'The Cold Room',
  blueprintId: 'bp-101',
  selectedRole: 'protagonist',
  resolvedPlayerName: 'Field Operative',
  resolvedPlayerId: 'char-field-op',
  currentNodeId: 'VAULT_01',
  readableNodeLabel: 'Vault 01',
  activeVector: 'COGNITIVE',
  activeTier: 'LATENT',
  castCount: 3,
  worldRuleCount: 2,
  topologyNodeCount: 4,
  topologyConnectionCount: 3,
};

const messages = [
  {
    role: 'user',
    content: 'I test the latch.',
    timestamp: 1,
    userCharacterName: 'Field Operative',
  },
  {
    role: 'assistant',
    content: 'The latch refuses to move.',
    timestamp: 2,
    blocks: [{ type: 'prose', content: 'The latch refuses to move.' }],
    logic_state: {
      current_phase: 'LATENT',
      suggested_tension: 2,
      intent_classification: 'INSPECT',
      terminal_flags: [],
    },
    topologyDelta: { isExpansion: false },
    validation: { accepted: true },
    contextReceipt: mockReceipt,
  },
  {
    role: 'user',
    content: 'I inspect the eastern seam.',
    timestamp: 3,
    userCharacterName: 'Field Operative',
  },
];

describe('Engine telemetry export', () => {
  it('renders Context Receipt exactly once at top of HTML export and user input labels', () => {
    const output = buildEngineLogContent(
      messages,
      'html',
      'engine-telemetry',
      undefined,
      new Date('2026-08-14T09:03:49.626Z')
    );

    expect(output).not.toBeNull();
    const html = output!.content;

    // Verify Context Receipt block is present exactly once
    expect(html.match(/class="context-receipt"/g)).toHaveLength(1);
    expect(html).toContain('[ CONTEXT RECEIPT // SCENARIO BINDING v1 ]');
    expect(html).toContain('The Cold Room');
    expect(html).toContain('Field Operative');
    expect(html).toContain('VAULT_01');

    // Verify user label
    expect(html).toContain('[ USER: Field Operative ]');

    // Verify user turns and logic panel
    expect(html.match(/<div class="user-input">/g)).toHaveLength(2);
    expect(html.match(/<details class="logic-panel">/g)).toHaveLength(1);
    expect(html).toContain(
      '[ TTM LOGIC // PHASE: LATENT // TENSION: 2 // INTENT: INSPECT // EXPANSION: FALSE ]'
    );
    expect(html).toContain('&quot;logic_state&quot;');
    expect(html).toContain('&quot;topologyDelta&quot;');
    expect(html).toContain('&quot;validation&quot;');

    const receiptPos = html.indexOf('class="context-receipt"');
    const firstInput = html.indexOf('&gt; I test the latch.');
    const narrative = html.indexOf('The latch refuses to move.');
    const logicPanel = html.indexOf('<details class="logic-panel">');
    const nextInput = html.indexOf('&gt; I inspect the eastern seam.');

    expect(receiptPos).toBeLessThan(firstInput);
    expect(firstInput).toBeLessThan(narrative);
    expect(narrative).toBeLessThan(logicPanel);
    expect(logicPanel).toBeLessThan(nextInput);
  });

  it('includes Context Receipt and structured decision records in Markdown exports', () => {
    const output = buildEngineLogContent(messages, 'md');

    expect(output).not.toBeNull();
    const md = output!.content;

    expect(md).toContain('### [ CONTEXT RECEIPT // SCENARIO BINDING v1 ]');
    expect(md).toContain('**Scenario:** The Cold Room (bp-101)');
    expect(md).toContain('**Bound Player:** Field Operative');
    expect(md).toContain('**[ USER: Field Operative ]**');
    expect(md).toContain('#### Intent & Pressure');
    expect(md).toContain('#### Intent Synergy');
    expect(md).toContain('#### Narrative Reconciliation');
    expect(md).toContain('#### Canonical State Diff');
    expect(md).toContain('#### Schema Repairs and Validation');
    expect(md).toContain('#### Raw Structured Payload');
    expect(md).toContain('"current_phase": "LATENT"');
    expect(md).toContain('"isExpansion": false');
  });

  it('includes turn receipt with pre/post snapshots in both HTML and Markdown telemetry exports', () => {
    const messagesWithSnapshots = [
      {
        role: 'user',
        content: 'Step through the archway',
        timestamp: 10,
        userCharacterName: 'Field Operative',
      },
      {
        role: 'assistant',
        content: 'The cold geometry shifts around you.',
        timestamp: 11,
        blocks: [{ type: 'prose', content: 'The cold geometry shifts around you.' }],
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 40,
        },
        turnReceipt: {
          turnNumber: 2,
          nodeBefore: 'VAULT_01',
          requestedTarget: 'VAULT_02',
          accepted: true,
          nodeAfter: 'VAULT_02',
          activeVector: 'COSMIC' as const,
          activeTier: 'MANIFEST' as const,
          tension: 40,
          preSnapshot: {
            version: 1 as const,
            turnCount: 1,
            currentNodeId: 'VAULT_01',
            activeVector: 'COGNITIVE' as const,
            activeTier: 'LATENT' as const,
            phase: 'LATENT',
            tension: 10,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeFlags: ['FLAG_OBSERVED'],
          },
          postSnapshot: {
            version: 1 as const,
            turnCount: 2,
            currentNodeId: 'VAULT_02',
            activeVector: 'COSMIC' as const,
            activeTier: 'MANIFEST' as const,
            phase: 'MANIFEST',
            tension: 40,
            coherence: 0.9,
            reconciliationRevision: 0,
            activeFlags: ['FLAG_OBSERVED', 'FLAG_ARCHWAY_CROSSED'],
          },
        },
      },
    ];

    const htmlOutput = buildEngineLogContent(messagesWithSnapshots, 'html', 'snapshot-test');
    expect(htmlOutput).not.toBeNull();
    const html = htmlOutput!.content;

    expect(html).toContain('&quot;turnReceipt&quot;');
    expect(html).toContain('&quot;preSnapshot&quot;');
    expect(html).toContain('&quot;postSnapshot&quot;');
    expect(html).toContain('&quot;activeVector&quot;: &quot;COSMIC&quot;');
    expect(html).toContain('&quot;FLAG_ARCHWAY_CROSSED&quot;');

    const mdOutput = buildEngineLogContent(messagesWithSnapshots, 'md', 'snapshot-test');
    expect(mdOutput).not.toBeNull();
    const md = mdOutput!.content;

    expect(md).toContain('"turnReceipt"');
    expect(md).toContain('"preSnapshot"');
    expect(md).toContain('"postSnapshot"');
    expect(md).toContain('"activeVector": "COSMIC"');
    expect(md).toContain('"activeTier": "MANIFEST"');
    expect(md).toContain('FLAG_ARCHWAY_CROSSED');
  });

  it('generates standardized structured telemetry export filenames', () => {
    const filenameHtml = generateTelemetryFilename(
      'The Drowned Bell',
      'antagonist-bellkeeper',
      new Date('2026-08-16T14:30:00Z'),
      'html'
    );
    expect(filenameHtml).toBe('the-drowned-bell_antagonist-bellkeeper_2026-08-16.html');

    const filenameMd = generateTelemetryFilename(
      'Submerged Echo Chamber',
      'protagonist',
      new Date('2026-08-16T00:00:00Z'),
      'md'
    );
    expect(filenameMd).toBe('submerged-echo-chamber_protagonist_2026-08-16.md');

    const fallback = generateTelemetryFilename(undefined, undefined, new Date('2026-08-16T00:00:00Z'));
    expect(fallback).toBe('scenario_session_2026-08-16.html');
  });

  it('includes castContinuityReceipt in Markdown and HTML exports and shows CAST CONTINUITY count in summary', () => {
    const messagesWithCastReceipt = [
      {
        role: 'user',
        content: 'Action text',
        timestamp: 10,
        userCharacterName: 'Player 1',
      },
      {
        role: 'assistant',
        content: 'Narrative response.',
        timestamp: 11,
        blocks: [{ type: 'prose', content: 'Narrative response.' }],
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 25,
        },
        turnReceipt: {
          turnNumber: 1,
          nodeBefore: 'NODE_1',
          requestedTarget: 'NODE_2',
          accepted: true,
          nodeAfter: 'NODE_2',
          activeVector: 'COGNITIVE' as const,
          activeTier: 'LATENT' as const,
          tension: 25,
          preSnapshot: {
            version: 1 as const,
            turnCount: 0,
            currentNodeId: 'NODE_1',
            activeVector: 'COGNITIVE' as const,
            activeTier: 'LATENT' as const,
            phase: 'LATENT',
            tension: 10,
            coherence: 1.0,
            reconciliationRevision: 0,
            activeFlags: [],
          },
          castContinuityReceipt: {
            version: 1 as const,
            state: {
              'char-1': { skepticism: 0.7 },
              'char-2': { skepticism: 0.4 },
            },
            acceptedDeltas: [
              { character_id: 'char-1', skepticism_delta: 0.1 },
            ],
          },
          castPresenceReceipt: {
            version: 1 as const,
            state: {
              'char-1': { nodeId: 'NODE_2' },
              'char-2': { nodeId: 'NODE_1' },
            },
          },
        },
      },
    ];

    const htmlOutput = buildEngineLogContent(messagesWithCastReceipt, 'html', 'continuity-test');
    expect(htmlOutput).not.toBeNull();
    const html = htmlOutput!.content;

    expect(html).toContain('CAST CONTINUITY: 2');
    expect(html).toContain('CAST PRESENCE: 2');
    expect(html).toContain('&quot;castContinuityReceipt&quot;');
    expect(html).toContain('&quot;castPresenceReceipt&quot;');
    expect(html).toContain('&quot;char-1&quot;');
    expect(html).toContain('&quot;char-2&quot;');
    expect(html).toContain('&quot;skepticism&quot;: 0.7');
    expect(html).toContain('&quot;skepticism_delta&quot;: 0.1');
    expect(html).toContain('&quot;nodeId&quot;: &quot;NODE_2&quot;');

    const mdOutput = buildEngineLogContent(messagesWithCastReceipt, 'md', 'continuity-test');
    expect(mdOutput).not.toBeNull();
    const md = mdOutput!.content;

    expect(md).toContain('"castContinuityReceipt"');
    expect(md).toContain('"castPresenceReceipt"');
    expect(md).toContain('"char-1"');
    expect(md).toContain('"char-2"');
    expect(md).toContain('"skepticism": 0.7');
    expect(md).toContain('"skepticism_delta": 0.1');
    expect(md).toContain('"nodeId": "NODE_2"');
  });

  it('does not display CAST CONTINUITY or CAST PRESENCE in HTML summary when receipts are not present', () => {
    const messagesWithoutReceipt = [
      {
        role: 'user',
        content: 'Action text',
        timestamp: 10,
      },
      {
        role: 'assistant',
        content: 'Narrative response.',
        timestamp: 11,
        blocks: [{ type: 'prose', content: 'Narrative response.' }],
        logic_state: {
          current_phase: 'MANIFEST',
        },
      },
    ];

    const htmlOutput = buildEngineLogContent(messagesWithoutReceipt, 'html', 'no-receipt-test');
    expect(htmlOutput).not.toBeNull();
    expect(htmlOutput!.content).not.toContain('CAST CONTINUITY');
    expect(htmlOutput!.content).not.toContain('CAST PRESENCE');
  });

  describe('buildCanonicalStateDiff helper', () => {
    it('returns diff unavailable when snapshots are missing', () => {
      expect(buildCanonicalStateDiff(undefined, undefined)).toEqual(['Canonical snapshot diff unavailable.']);
    });

    it('returns no changes message when snapshots are identical', () => {
      const snap: RuntimeStateSnapshot = {
        version: 1,
        turnCount: 1,
        currentNodeId: 'NODE_A',
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        phase: 'LATENT',
        tension: 10,
        coherence: 1.0,
        reconciliationRevision: 0,
        activeFlags: ['FLAG_1'],
      };
      expect(buildCanonicalStateDiff(snap, snap)).toEqual(['No canonical snapshot changes.']);
    });

    it('reports scalar mutations and added/removed activeFlags', () => {
      const pre: RuntimeStateSnapshot = {
        version: 1,
        turnCount: 1,
        currentNodeId: 'NODE_A',
        activeVector: 'COGNITIVE',
        activeTier: 'LATENT',
        phase: 'LATENT',
        tension: 10,
        coherence: 1.0,
        reconciliationRevision: 0,
        activeFlags: ['FLAG_OLD', 'FLAG_PERSIST'],
      };
      const post: RuntimeStateSnapshot = {
        version: 1,
        turnCount: 2,
        currentNodeId: 'NODE_B',
        activeVector: 'COSMIC',
        activeTier: 'MANIFEST',
        phase: 'MANIFEST',
        tension: 35,
        coherence: 0.85,
        reconciliationRevision: 1,
        activeFlags: ['FLAG_PERSIST', 'FLAG_NEW'],
      };

      const diff = buildCanonicalStateDiff(pre, post);
      expect(diff).toContain('TURN COUNT: 1 → 2');
      expect(diff).toContain('CURRENT NODE: NODE_A → NODE_B');
      expect(diff).toContain('ACTIVE VECTOR: COGNITIVE → COSMIC');
      expect(diff).toContain('ACTIVE TIER: LATENT → MANIFEST');
      expect(diff).toContain('PHASE: LATENT → MANIFEST');
      expect(diff).toContain('TENSION: 10 → 35');
      expect(diff).toContain('COHERENCE: 1 → 0.85');
      expect(diff).toContain('RECONCILIATION REVISION: 0 → 1');
      expect(diff).toContain('ACTIVE FLAGS ADDED: FLAG_NEW');
      expect(diff).toContain('ACTIVE FLAGS REMOVED: FLAG_OLD');
    });
  });

  it('renders IntentReceipt and NarrativeReconciliationReceipt in both HTML and Markdown exports (Phase 3G.1D)', () => {
    const preSnapshot: RuntimeStateSnapshot = {
      version: 1,
      turnCount: 2,
      currentNodeId: 'NODE_CHAMBER',
      activeVector: 'COGNITIVE',
      activeTier: 'LATENT',
      phase: 'LATENT',
      tension: 20,
      coherence: 1.0,
      reconciliationRevision: 0,
      activeFlags: ['FLAG_OBSERVED', 'FLAG_OLD'],
    };

    const postSnapshot: RuntimeStateSnapshot = {
      version: 1,
      turnCount: 3,
      currentNodeId: 'NODE_ALTAR',
      activeVector: 'COGNITIVE',
      activeTier: 'MANIFEST',
      phase: 'MANIFEST',
      tension: 30,
      coherence: 0.9,
      reconciliationRevision: 1,
      activeFlags: ['FLAG_OBSERVED', 'FLAG_ADDED'],
    };

    const intentReceipt: IntentReceipt = {
      version: 1,
      action_kind: 'MOVE',
      action_subtype: 'FLEE',
      pressure_direction: 'DE_ESCALATE',
      dramatic_tactic: 'FLIGHT',
      intent_synergy: 'SUCCESS',
    };

    const narrativeReconciliationReceipt: NarrativeReconciliationReceipt = {
      version: 1,
      mode: 'EXPERIENTIAL_REANCHORED',
      feasibility: 'IMPOSSIBLE',
      reason_code: 'PHYSICAL_LIMIT',
      fictional_time_cost: 'MOMENT',
      authority_alignment: 'NOT_APPLICABLE',
      memory_echo_candidate: 'Echo <marker> & residue',
      revision_increment: 1,
    };

    const castInteractionReceipt: CastInteractionReceipt = {
      version: 1,
      addressedCharacterId: 'char-target',
      respondingCharacterId: 'char-target',
      outcome: 'RESPONDED',
    };

    const castContinuityReceipt: CastContinuityReceipt = {
      version: 1,
      state: {
        'char-target': { skepticism: 0.8 },
      },
      acceptedDeltas: [
        { character_id: 'char-target', skepticism_delta: 0.1 },
      ],
    };

    const castPresenceReceipt: CastPresenceReceipt = {
      version: 1,
      state: {
        'char-target': { nodeId: 'NODE_ALTAR' },
      },
    };

    const topLevelTransitionReceipt: TransitionReceipt = {
      requestedNodeId: 'NODE_ALTAR',
      accepted: true,
      fromNodeId: 'NODE_CHAMBER',
      toNodeId: 'NODE_ALTAR',
      reason: 'Path opened',
    };

    const messagesWith3G1DReceipts = [
      {
        role: 'user',
        content: 'I flee toward the altar.',
        timestamp: 100,
        userCharacterName: 'Investigator',
      },
      {
        role: 'assistant',
        content: 'The stone steps blur as you flee.',
        timestamp: 101,
        blocks: [{ type: 'prose', content: 'The stone steps blur as you flee.' }],
        logic_state: {
          current_phase: 'MANIFEST',
          suggested_tension: 30,
        },
        transitionReceipt: topLevelTransitionReceipt,
        turnReceipt: {
          turnNumber: 3,
          nodeBefore: 'NODE_CHAMBER',
          requestedTarget: 'NODE_ALTAR',
          accepted: true,
          nodeAfter: 'NODE_ALTAR',
          activeVector: 'COGNITIVE' as const,
          activeTier: 'MANIFEST' as const,
          tension: 30,
          preSnapshot,
          postSnapshot,
          intentReceipt,
          narrativeReconciliationReceipt,
          castInteractionReceipt,
          castContinuityReceipt,
          castPresenceReceipt,
        },
        validation: {
          accepted: true,
          rejected_fields: ['bad_field'],
          repair_notes: ['Repaired bad_field default'],
        },
        failureReceipt: {
          code: 'ERR_ESCAPE_FAILED',
          status: 500,
          contentType: 'application/json',
          message: 'Failure <marker> & reason',
        },
      },
    ];

    const htmlOutput = buildEngineLogContent(messagesWith3G1DReceipts, 'html', '3g1d-test');
    expect(htmlOutput).not.toBeNull();
    const html = htmlOutput!.content;

    // 1. Order of 8 labels in HTML
    const htmlLabels = [
      'Intent &amp; Pressure',
      'Intent Synergy',
      'Narrative Reconciliation',
      'Canonical State Diff',
      'Cast Presence &amp; Interaction',
      'Continuity / Memory Candidates',
      'Schema Repairs and Validation',
      'Raw Structured Payload',
    ];
    let lastHtmlIndex = -1;
    for (const label of htmlLabels) {
      const idx = html.indexOf(label);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(lastHtmlIndex);
      lastHtmlIndex = idx;
    }

    // 2. Summary receipt-first tokens
    expect(html).toContain('INTENT: MOVE/FLEE');
    expect(html).toContain('PRESSURE: DE_ESCALATE');
    expect(html).toContain('SYNERGY: SUCCESS');
    expect(html).toContain('RECONCILIATION: EXPERIENTIAL_REANCHORED');

    // 3. Escaped memory candidate and failure message
    expect(html).toContain('Echo &lt;marker&gt; &amp; residue');
    expect(html).toContain('Failure &lt;marker&gt; &amp; reason');

    // 4. Raw payload nested <details class="raw-payload-panel"> with real <pre><code>
    expect(html).toContain('<details class="raw-payload-panel">');
    expect(html).toContain('<summary class="speaker-label speaker-engine">Raw Structured Payload</summary>');
    expect(html).toMatch(/<pre><code>[\s\S]*<\/code><\/pre>/);

    // 5. Does not contain <pre class="logic-content">
    expect(html).not.toContain('<pre class="logic-content">');

    // Section field contents in HTML
    expect(html).toContain('<li><strong>Action Kind:</strong> MOVE</li>');
    expect(html).toContain('<li><strong>Action Subtype:</strong> FLEE</li>');
    expect(html).toContain('<li><strong>Pressure Direction:</strong> DE_ESCALATE</li>');
    expect(html).toContain('<li><strong>Dramatic Tactic:</strong> FLIGHT</li>');
    expect(html).toContain('<li><strong>Synergy:</strong> SUCCESS</li>');
    expect(html).toContain('Intent–state coherence; not action outcome.');
    expect(html).toContain('<li><strong>Mode:</strong> EXPERIENTIAL_REANCHORED</li>');
    expect(html).toContain('<li><strong>Feasibility:</strong> IMPOSSIBLE</li>');
    expect(html).toContain('<li><strong>Reason Code:</strong> PHYSICAL_LIMIT</li>');
    expect(html).toContain('<li><strong>Fictional Time Cost:</strong> MOMENT</li>');
    expect(html).toContain('<li><strong>Authority Alignment:</strong> NOT_APPLICABLE</li>');
    expect(html).toContain('<li>CURRENT NODE: NODE_CHAMBER → NODE_ALTAR</li>');
    expect(html).toContain('<li>ACTIVE FLAGS ADDED: FLAG_ADDED</li>');
    expect(html).toContain('<li>ACTIVE FLAGS REMOVED: FLAG_OLD</li>');
    expect(html).toContain('<li><strong>Outcome:</strong> RESPONDED</li>');
    expect(html).toContain('<li><strong>Addressed Character ID:</strong> char-target</li>');
    expect(html).toContain('<li><strong>Responding Character ID:</strong> char-target</li>');
    expect(html).toContain('<li><strong>Rejected Fields:</strong> bad_field</li>');
    expect(html).toContain('<li><strong>Repair Notes:</strong> Repaired bad_field default</li>');

    // Markdown tests
    const mdOutput = buildEngineLogContent(messagesWith3G1DReceipts, 'md', '3g1d-test');
    expect(mdOutput).not.toBeNull();
    const md = mdOutput!.content;

    // Order of 8 labels in Markdown
    const mdLabels = [
      '#### Intent & Pressure',
      '#### Intent Synergy',
      '#### Narrative Reconciliation',
      '#### Canonical State Diff',
      '#### Cast Presence & Interaction',
      '#### Continuity / Memory Candidates',
      '#### Schema Repairs and Validation',
      '#### Raw Structured Payload',
    ];
    let lastMdIndex = -1;
    for (const label of mdLabels) {
      const idx = md.indexOf(label);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(lastMdIndex);
      lastMdIndex = idx;
    }

    expect(md).toContain('Intent–state coherence; not action outcome.');
    expect(md).toContain('- CURRENT NODE: NODE_CHAMBER → NODE_ALTAR');
    expect(md).toContain('- ACTIVE FLAGS ADDED: FLAG_ADDED');
    expect(md).toContain('- ACTIVE FLAGS REMOVED: FLAG_OLD');
    expect(md).toContain('- **Memory Echo Candidate:** Echo <marker> & residue');

    const rawSectionIndex = md.indexOf('#### Raw Structured Payload');
    const jsonFenceIndex = md.indexOf('```json', rawSectionIndex);
    expect(rawSectionIndex).toBeGreaterThan(-1);
    expect(jsonFenceIndex).toBeGreaterThan(rawSectionIndex);

    expect(md).toContain('- **Action Kind:** MOVE');
    expect(md).toContain('- **Action Subtype:** FLEE');
    expect(md).toContain('- **Pressure Direction:** DE_ESCALATE');
    expect(md).toContain('- **Dramatic Tactic:** FLIGHT');
    expect(md).toContain('- **Synergy:** SUCCESS');
    expect(md).toContain('- **Mode:** EXPERIENTIAL_REANCHORED');
    expect(md).toContain('- **Feasibility:** IMPOSSIBLE');
    expect(md).toContain('- **Reason Code:** PHYSICAL_LIMIT');
  });

  describe('absence and historical telemetry behavior', () => {
    it('produces INTENT: OBSERVE and does not produce INTENT: OBSERVE/ when action_subtype is null', () => {
      const nullSubtypeMsg = [
        {
          role: 'user',
          content: 'Look around',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'You see shadows.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'You see shadows.' }],
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'N1',
            requestedTarget: null,
            accepted: false,
            nodeAfter: 'N1',
            activeVector: 'COGNITIVE' as const,
            activeTier: 'LATENT' as const,
            tension: 10,
            preSnapshot: {
              version: 1 as const,
              turnCount: 0,
              currentNodeId: 'N1',
              activeVector: 'COGNITIVE' as const,
              activeTier: 'LATENT' as const,
              phase: 'LATENT',
              tension: 10,
              coherence: 1.0,
              reconciliationRevision: 0,
              activeFlags: [],
            },
            intentReceipt: {
              version: 1 as const,
              action_kind: 'OBSERVE' as const,
              action_subtype: null,
              pressure_direction: 'MAINTAIN' as const,
              dramatic_tactic: 'NONE' as const,
              intent_synergy: 'SUCCESS' as const,
            },
          },
        },
      ];

      const html = buildEngineLogContent(nullSubtypeMsg, 'html')!.content;
      expect(html).toContain('INTENT: OBSERVE');
      expect(html).not.toContain('INTENT: OBSERVE/');
    });

    it('produces historical INTENT summary for legacy message with no intentReceipt but with logic_state.intent_classification', () => {
      const legacyMsg = [
        {
          role: 'user',
          content: 'I search the drawer.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'The drawer is empty.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'The drawer is empty.' }],
          logic_state: {
            current_phase: 'LATENT',
            intent_classification: 'INSPECT',
          },
        },
      ];

      const html = buildEngineLogContent(legacyMsg, 'html')!.content;
      expect(html).toContain('INTENT: INSPECT');
    });

    it('renders receipt-specific fields as Not recorded and does not fabricate default receipt values when receipts are absent', () => {
      const emptyReceiptsMsg = [
        {
          role: 'user',
          content: 'Wait here.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Time passes.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Time passes.' }],
          logic_state: {
            current_phase: 'LATENT',
          },
        },
      ];

      const html = buildEngineLogContent(emptyReceiptsMsg, 'html')!.content;
      const md = buildEngineLogContent(emptyReceiptsMsg, 'md')!.content;

      // In HTML
      expect(html).toContain('<li><strong>Action Kind:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Action Subtype:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Pressure Direction:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Dramatic Tactic:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Synergy:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Mode:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Feasibility:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Reason Code:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Fictional Time Cost:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Authority Alignment:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Transition:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Active Presence Count:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Outcome:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Addressed Character ID:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Responding Character ID:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Tracked Characters:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Accepted Deltas Count:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Memory Echo Candidate:</strong> Not recorded</li>');
      expect(html).toContain('<li><strong>Accepted:</strong> Not recorded</li>');

      // In MD
      expect(md).toContain('- **Action Kind:** Not recorded');
      expect(md).toContain('- **Synergy:** Not recorded');
      expect(md).toContain('- **Mode:** Not recorded');
      expect(md).toContain('- **Transition:** Not recorded');
      expect(md).toContain('- **Active Presence Count:** Not recorded');
      expect(md).toContain('- **Tracked Characters:** Not recorded');
      expect(md).toContain('- **Memory Echo Candidate:** Not recorded');
    });

    it('renders Transition: Not recorded and does not synthesize pseudo transition when message has turnReceipt but no actual top-level transitionReceipt', () => {
      const msgWithTurnReceiptOnly = [
        {
          role: 'user',
          content: 'Open the gate.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'The gate creaks open.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'The gate creaks open.' }],
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'COURTYARD',
            requestedTarget: 'GARDEN',
            accepted: true,
            nodeAfter: 'GARDEN',
            reason: 'Gate unlocked',
            activeVector: 'COGNITIVE' as const,
            activeTier: 'LATENT' as const,
            tension: 10,
            preSnapshot: {
              version: 1 as const,
              turnCount: 0,
              currentNodeId: 'COURTYARD',
              activeVector: 'COGNITIVE' as const,
              activeTier: 'LATENT' as const,
              phase: 'LATENT',
              tension: 10,
              coherence: 1.0,
              reconciliationRevision: 0,
              activeFlags: [],
            },
          },
        },
      ];

      const html = buildEngineLogContent(msgWithTurnReceiptOnly, 'html')!.content;
      const md = buildEngineLogContent(msgWithTurnReceiptOnly, 'md')!.content;

      expect(html).toContain('<li><strong>Transition:</strong> Not recorded</li>');
      expect(html).not.toContain('<strong>Requested Node:</strong>');
      expect(html).not.toContain('<strong>From Node:</strong>');
      expect(html).not.toContain('<strong>To Node:</strong>');

      expect(md).toContain('- **Transition:** Not recorded');
      expect(md).not.toContain('- **Requested Node:**');
      expect(md).not.toContain('- **From Node:**');
      expect(md).not.toContain('- **To Node:**');
    });

    it('renders Canonical Consequences in correct order and format for HTML and Markdown', () => {
      const messagesWithConsequences = [
        {
          role: 'user',
          content: 'Pry open the lockbox.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'You pry the box open, cutting your thumb.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'You pry the box open, cutting your thumb.' }],
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'WORKSHOP',
            requestedTarget: 'WORKSHOP',
            accepted: true,
            nodeAfter: 'WORKSHOP',
            activeVector: 'SOMATIC' as const,
            activeTier: 'LATENT' as const,
            tension: 25,
            preSnapshot: {
              version: 1 as const,
              turnCount: 0,
              currentNodeId: 'WORKSHOP',
              activeVector: 'SOMATIC' as const,
              activeTier: 'LATENT' as const,
              phase: 'LATENT',
              tension: 20,
              coherence: 1.0,
              reconciliationRevision: 0,
              activeFlags: [],
            },
            canonicalConsequenceReceipt: {
              decisions: [
                {
                  mutation: {
                    domain: 'INVENTORY' as const,
                    operation: 'ACQUIRE' as const,
                    value: 'Iron & Brass Key <V1>',
                    rationale: 'Retrieved from "safe" box',
                  },
                  outcome: 'ACCEPTED' as const,
                  reason: 'Valid item retrieval',
                },
                {
                  mutation: {
                    domain: 'INVENTORY' as const,
                    operation: 'LOSE' as const,
                    value: 'Rusty Lockpick',
                    rationale: 'Snapped during tension',
                  },
                  outcome: 'ACCEPTED' as const,
                  reason: 'Tool exhausted',
                },
                {
                  mutation: {
                    domain: 'INJURY' as const,
                    operation: 'SUSTAIN' as const,
                    value: 'Lacerated Thumb',
                    rationale: 'Slipped blade',
                  },
                  outcome: 'ACCEPTED' as const,
                  reason: 'Direct minor trauma',
                },
                {
                  mutation: {
                    domain: 'PSYCHOLOGY' as const,
                    operation: 'SHIFT' as const,
                    value: 'JITTERY',
                    rationale: 'Sharp sudden pain',
                  },
                  outcome: 'ACCEPTED' as const,
                  reason: 'Physical stress reflex',
                },
              ],
              patch: {
                inventory_added: ['Iron & Brass Key <V1>'],
                inventory_removed: ['Rusty Lockpick'],
                injuries_added: ['Lacerated Thumb'],
                injuries_removed: [],
                psychological_status_change: {
                  before: 'CALM',
                  after: 'JITTERY',
                },
              },
              post_state: {
                inventory: ['Iron & Brass Key <V1>'],
                player_injuries: ['Lacerated Thumb'],
                psychological_status: 'JITTERY',
              },
            },
          },
        },
      ];

      const html = buildEngineLogContent(messagesWithConsequences, 'html')!.content;
      const md = buildEngineLogContent(messagesWithConsequences, 'md')!.content;

      // HTML assertions
      expect(html).toContain('<h4>Canonical Consequences</h4>');
      expect(html).toContain('<strong>Decision [INVENTORY / ACQUIRE]:</strong> Iron &amp; Brass Key &lt;V1&gt; | Outcome: ACCEPTED (Reason: Valid item retrieval) — <em>Retrieved from &quot;safe&quot; box</em>');
      expect(html).toContain('<strong>Decision [INVENTORY / LOSE]:</strong> Rusty Lockpick | Outcome: ACCEPTED (Reason: Tool exhausted) — <em>Snapped during tension</em>');
      expect(html).toContain('<strong>Decision [INJURY / SUSTAIN]:</strong> Lacerated Thumb | Outcome: ACCEPTED (Reason: Direct minor trauma) — <em>Slipped blade</em>');
      expect(html).toContain('<strong>Decision [PSYCHOLOGY / SHIFT]:</strong> JITTERY | Outcome: ACCEPTED (Reason: Physical stress reflex) — <em>Sharp sudden pain</em>');
      expect(html).toContain('<strong>Inventory Added:</strong> Iron &amp; Brass Key &lt;V1&gt;');
      expect(html).toContain('<strong>Inventory Removed:</strong> Rusty Lockpick');
      expect(html).toContain('<strong>Injuries Added:</strong> Lacerated Thumb');
      expect(html).toContain('<strong>Psychological Status:</strong> CALM → JITTERY');

      // HTML section ordering: Narrative Reconciliation -> Canonical Consequences -> Canonical State Diff
      const narrIndexHtml = html.indexOf('<h4>Narrative Reconciliation</h4>');
      const conseqIndexHtml = html.indexOf('<h4>Canonical Consequences</h4>');
      const diffIndexHtml = html.indexOf('<h4>Canonical State Diff</h4>');
      expect(narrIndexHtml).toBeGreaterThan(-1);
      expect(conseqIndexHtml).toBeGreaterThan(narrIndexHtml);
      expect(diffIndexHtml).toBeGreaterThan(conseqIndexHtml);

      // Markdown assertions
      expect(md).toContain('#### Canonical Consequences');
      expect(md).toContain('- **Decision [INVENTORY / ACQUIRE]:** Iron & Brass Key <V1> | Outcome: ACCEPTED (Reason: Valid item retrieval) — *Retrieved from "safe" box*');
      expect(md).toContain('- **Decision [INVENTORY / LOSE]:** Rusty Lockpick | Outcome: ACCEPTED (Reason: Tool exhausted) — *Snapped during tension*');
      expect(md).toContain('- **Decision [INJURY / SUSTAIN]:** Lacerated Thumb | Outcome: ACCEPTED (Reason: Direct minor trauma) — *Slipped blade*');
      expect(md).toContain('- **Decision [PSYCHOLOGY / SHIFT]:** JITTERY | Outcome: ACCEPTED (Reason: Physical stress reflex) — *Sharp sudden pain*');
      expect(md).toContain('- **Inventory Added:** Iron & Brass Key <V1>');
      expect(md).toContain('- **Inventory Removed:** Rusty Lockpick');
      expect(md).toContain('- **Injuries Added:** Lacerated Thumb');
      expect(md).toContain('- **Psychological Status:** CALM → JITTERY');

      // Markdown section ordering
      const narrIndexMd = md.indexOf('#### Narrative Reconciliation');
      const conseqIndexMd = md.indexOf('#### Canonical Consequences');
      const diffIndexMd = md.indexOf('#### Canonical State Diff');
      expect(narrIndexMd).toBeGreaterThan(-1);
      expect(conseqIndexMd).toBeGreaterThan(narrIndexMd);
      expect(diffIndexMd).toBeGreaterThan(conseqIndexMd);
    });

    it('renders "No canonical consequence changes" when consequence receipt has no mutations', () => {
      const messagesEmptyConsequences = [
        {
          role: 'user',
          content: 'Look around quietly.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Nothing has changed.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Nothing has changed.' }],
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'ROOM',
            requestedTarget: 'ROOM',
            accepted: true,
            nodeAfter: 'ROOM',
            activeVector: 'COGNITIVE' as const,
            activeTier: 'LATENT' as const,
            tension: 5,
            preSnapshot: {
              version: 1 as const,
              turnCount: 0,
              currentNodeId: 'ROOM',
              activeVector: 'COGNITIVE' as const,
              activeTier: 'LATENT' as const,
              phase: 'LATENT',
              tension: 5,
              coherence: 1.0,
              reconciliationRevision: 0,
              activeFlags: [],
            },
            canonicalConsequenceReceipt: {
              decisions: [],
              patch: {
                inventory_added: [],
                inventory_removed: [],
                injuries_added: [],
                injuries_removed: [],
                psychological_status_change: null,
              },
              post_state: {
                inventory: [],
                player_injuries: [],
                psychological_status: 'CALM',
              },
            },
          },
        },
      ];

      const html = buildEngineLogContent(messagesEmptyConsequences, 'html')!.content;
      const md = buildEngineLogContent(messagesEmptyConsequences, 'md')!.content;

      expect(html).toContain('<li>No canonical consequence changes</li>');
      expect(md).toContain('- No canonical consequence changes');
    });

    it('renders "Consequences: Not recorded" when canonicalConsequenceReceipt is absent', () => {
      const messagesNoConsequenceReceipt = [
        {
          role: 'user',
          content: 'Hello',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Hello',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Hello' }],
          logic_state: {
            current_phase: 'LATENT',
          },
        },
      ];

      const html = buildEngineLogContent(messagesNoConsequenceReceipt, 'html')!.content;
      const md = buildEngineLogContent(messagesNoConsequenceReceipt, 'md')!.content;

      expect(html).toContain('<li><strong>Consequences:</strong> Not recorded</li>');
      expect(md).toContain('- **Consequences:** Not recorded');
    });

    it('renders Character Stance decisions with before/after state in HTML and Markdown', () => {
      const messagesWithStance = [
        {
          role: 'user',
          content: 'I speak with Nurse Finch.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Finch glances at you guardedly.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Finch glances at you guardedly.' }],
          logic_state: {
            current_phase: 'LATENT',
            characterStanceReceipt: {
              version: 1,
              pre_state: {
                'char-finch': { focus: 'PLAYER', stance: 'OPEN' },
              },
              post_state: {
                'char-finch': { focus: 'PLAYER', stance: 'GUARDED' },
              },
              decisions: [
                {
                  proposal: {
                    character_id: 'char-finch',
                    focus: 'PLAYER',
                    stance: 'GUARDED',
                    rationale: 'Finch steps back cautiously',
                  },
                  outcome: 'APPLIED',
                  reason: 'APPLIED',
                  before: { focus: 'PLAYER', stance: 'OPEN' },
                  after: { focus: 'PLAYER', stance: 'GUARDED' },
                },
              ],
            },
          },
        },
      ];

      const html = buildEngineLogContent(messagesWithStance, 'html')!.content;
      const md = buildEngineLogContent(messagesWithStance, 'md')!.content;

      expect(html).toContain('<h4>Character Stance</h4>');
      expect(html).toContain('Decision [char-finch]:');
      expect(html).toContain('PLAYER / GUARDED');
      expect(html).toContain('Outcome: APPLIED (Reason: APPLIED)');
      expect(html).toContain('Before: PLAYER/OPEN → After: PLAYER/GUARDED');
      expect(html).toContain('Finch steps back cautiously');

      expect(md).toContain('#### Character Stance');
      expect(md).toContain('- **Decision [char-finch]:** PLAYER / GUARDED | Outcome: APPLIED (Reason: APPLIED) | Before: PLAYER/OPEN → After: PLAYER/GUARDED — *Finch steps back cautiously*');
    });

    it('renders "No character stance changes" when stance receipt has no applied changes', () => {
      const messagesEmptyStance = [
        {
          role: 'user',
          content: 'I wait in silence.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Silence lingers.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Silence lingers.' }],
          logic_state: {
            current_phase: 'LATENT',
            characterStanceReceipt: {
              version: 1,
              pre_state: {},
              post_state: {},
              decisions: [],
            },
          },
        },
      ];

      const html = buildEngineLogContent(messagesEmptyStance, 'html')!.content;
      const md = buildEngineLogContent(messagesEmptyStance, 'md')!.content;

      expect(html).toContain('<li>No character stance changes</li>');
      expect(md).toContain('- No character stance changes');
    });

    it('renders Character Relationships decisions with before/after state in HTML and Markdown', () => {
      const messagesWithRelationships = [
        {
          role: 'user',
          content: 'I offer my rations to Finch.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Finch takes the biscuit with a nod.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Finch takes the biscuit with a nod.' }],
          logic_state: {
            current_phase: 'LATENT',
            characterRelationshipReceipt: {
              version: 1,
              pre_state: [],
              post_state: [
                {
                  source_character_id: 'char-finch',
                  target_character_id: 'char-player',
                  kind: 'TRUST',
                  intensity: 1,
                },
              ],
              decisions: [
                {
                  proposal: {
                    source_character_id: 'char-finch',
                    target_character_id: 'char-player',
                    kind: 'TRUST',
                    delta: 1,
                    rationale: 'Shared sustenance builds initial confidence',
                  },
                  outcome: 'APPLIED',
                  reason: 'APPLIED',
                  before: null,
                  after: {
                    source_character_id: 'char-finch',
                    target_character_id: 'char-player',
                    kind: 'TRUST',
                    intensity: 1,
                  },
                },
              ],
            },
          },
        },
      ];

      const html = buildEngineLogContent(messagesWithRelationships, 'html')!.content;
      const md = buildEngineLogContent(messagesWithRelationships, 'md')!.content;

      expect(html).toContain('<h4>Character Relationships</h4>');
      expect(html).toContain('Decision [char-finch -&gt; char-player / TRUST (+1)]:');
      expect(html).toContain('Outcome: APPLIED (Reason: APPLIED)');
      expect(html).toContain('Before: UNSET → After: 1');
      expect(html).toContain('Shared sustenance builds initial confidence');

      expect(md).toContain('#### Character Relationships');
      expect(md).toContain('- **Decision [char-finch -> char-player / TRUST (+1)]:** Outcome: APPLIED (Reason: APPLIED) | Before: UNSET → After: 1 — *Shared sustenance builds initial confidence*');
    });

    it('renders "No character relationship changes" when relationship receipt has no applied changes', () => {
      const messagesEmptyRelationships = [
        {
          role: 'user',
          content: 'I wait in silence.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Silence lingers.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Silence lingers.' }],
          logic_state: {
            current_phase: 'LATENT',
            characterRelationshipReceipt: {
              version: 1,
              pre_state: [],
              post_state: [],
              decisions: [],
            },
          },
        },
      ];

      const html = buildEngineLogContent(messagesEmptyRelationships, 'html')!.content;
      const md = buildEngineLogContent(messagesEmptyRelationships, 'md')!.content;

      expect(html).toContain('<li>No character relationship changes</li>');
      expect(md).toContain('- No character relationship changes');
    });

    it('renders Character Memory decisions and rationale in HTML and Markdown telemetry', () => {
      const messagesWithMemory = [
        {
          role: 'user',
          content: 'I show Finch the keycard.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Finch notices the security card.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Finch notices the security card.' }],
          characterMemoryReceipt: {
            version: 1,
            pre_state: {},
            post_state: {
              'char-finch': [
                {
                  id: 'mem-1',
                  fact: 'Player possesses maintenance keycard',
                  source: 'OBSERVED',
                  certainty: 'KNOWN',
                  acquired_turn: 2,
                },
              ],
            },
            decisions: [
              {
                candidate: {
                  character_id: 'char-finch',
                  fact: 'Player possesses maintenance keycard',
                  source: 'OBSERVED',
                  certainty: 'KNOWN',
                  rationale: 'Finch directly watched the player brandish the card',
                },
                outcome: 'APPLIED',
                reason: 'APPLIED',
                entry: {
                  id: 'mem-1',
                  fact: 'Player possesses maintenance keycard',
                  source: 'OBSERVED',
                  certainty: 'KNOWN',
                  acquired_turn: 2,
                },
              },
            ],
          },
        },
      ];

      const html = buildEngineLogContent(messagesWithMemory, 'html')!.content;
      const md = buildEngineLogContent(messagesWithMemory, 'md')!.content;

      expect(html).toContain('<h4>Character Memory</h4>');
      expect(html).toContain('Decision [char-finch / OBSERVED / KNOWN]:');
      expect(html).toContain('&quot;Player possesses maintenance keycard&quot;');
      expect(html).toContain('Outcome: APPLIED (Reason: APPLIED)');
      expect(html).toContain('Finch directly watched the player brandish the card');

      expect(md).toContain('#### Character Memory');
      expect(md).toContain('- **Decision [char-finch / OBSERVED / KNOWN]:** "Player possesses maintenance keycard" | Outcome: APPLIED (Reason: APPLIED) — *Finch directly watched the player brandish the card*');
    });

    it('renders "No character memory changes" when memory receipt has no applied changes', () => {
      const messagesEmptyMemory = [
        {
          role: 'user',
          content: 'I wait in silence.',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: 'Silence lingers.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'Silence lingers.' }],
          logic_state: {
            current_phase: 'LATENT',
            characterMemoryReceipt: {
              version: 1,
              pre_state: {},
              post_state: {},
              decisions: [],
            },
          },
        },
      ];

      const html = buildEngineLogContent(messagesEmptyMemory, 'html')!.content;
      const md = buildEngineLogContent(messagesEmptyMemory, 'md')!.content;

      expect(html).toContain('<li>No character memory changes</li>');
      expect(md).toContain('- No character memory changes');
    });

    it('renders rejected model-contract paths without exposing model output', () => {
      const messagesWithContractFailure = [
        {
          role: 'user',
          content: 'I ask the technician about the seals.',
          timestamp: 1,
          userCharacterName: 'Field Operative',
        },
        {
          role: 'assistant',
          content: 'The turn service returned an unexpected response. The session state was not changed.',
          timestamp: 2,
          failureReceipt: {
            code: 'MODEL_CONTRACT_MISMATCH',
            status: 502,
            contentType: 'application/json',
            message: 'Model output violated schema contract',
            diagnostics: {
              kind: 'SCHEMA_VALIDATION',
              issues: [
                { path: 'character_relationship_proposal.changes.0.delta', code: 'invalid_type' },
                { path: 'consequence_proposal.mutations.0.operation', code: 'invalid_enum_value' },
              ],
            },
          },
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'NODE_01',
            requestedTarget: null,
            accepted: false,
            nodeAfter: 'NODE_01',
            activeVector: 'COGNITIVE' as const,
            activeTier: 'LATENT' as const,
            tension: 10,
            preSnapshot: {
              version: 1 as const,
              turnCount: 1,
              currentNodeId: 'NODE_01',
              activeVector: 'COGNITIVE' as const,
              activeTier: 'LATENT' as const,
              phase: 'LATENT',
              tension: 10,
              coherence: 1.0,
              reconciliationRevision: 0,
              activeFlags: [],
            },
            postSnapshot: {
              version: 1 as const,
              turnCount: 1,
              currentNodeId: 'NODE_01',
              activeVector: 'COGNITIVE' as const,
              activeTier: 'LATENT' as const,
              phase: 'LATENT',
              tension: 10,
              coherence: 1.0,
              reconciliationRevision: 0,
              activeFlags: [],
            },
          },
        },
      ];

      const htmlOutput = buildEngineLogContent(messagesWithContractFailure, 'html', 'failure-telemetry');
      expect(htmlOutput).not.toBeNull();
      const html = htmlOutput!.content;

      // 1. Diagnostic Kind and Rejected Paths appear in HTML and MD
      expect(html).toContain('<strong>Diagnostic Kind:</strong> SCHEMA_VALIDATION');
      expect(html).toContain(
        '<strong>Rejected Paths:</strong> character_relationship_proposal.changes.0.delta, consequence_proposal.mutations.0.operation'
      );

      const mdOutput = buildEngineLogContent(messagesWithContractFailure, 'md', 'failure-telemetry');
      expect(mdOutput).not.toBeNull();
      const md = mdOutput!.content;

      expect(md).toContain('- **Diagnostic Kind:** SCHEMA_VALIDATION');
      expect(md).toContain(
        '- **Rejected Paths:** character_relationship_proposal.changes.0.delta, consequence_proposal.mutations.0.operation'
      );

      // 2. Diagnostic text is HTML-escaped
      const messageWithSpecialCharsInDiag = [
        {
          role: 'assistant',
          content: 'Failure',
          timestamp: 2,
          failureReceipt: {
            code: 'MODEL_CONTRACT_MISMATCH',
            status: 502,
            contentType: 'application/json',
            message: 'Model output violated schema contract',
            diagnostics: {
              kind: 'SCHEMA_VALIDATION',
              issues: [{ path: 'proposal.field[0] & other', code: 'invalid_type' }],
            },
          },
        },
      ];
      const htmlEscaped = buildEngineLogContent(messageWithSpecialCharsInDiag, 'html')!.content;
      expect(htmlEscaped).toContain('proposal.field[0] &amp; other');

      // 3. Rejected response text, prompts, and arbitrary server details do not appear
      expect(html).not.toContain('stack trace');
      expect(html).not.toContain('aiStudioSecret');
      expect(md).not.toContain('stack trace');
      expect(md).not.toContain('aiStudioSecret');

      // 4. Pre/post state diff remains unchanged on failure
      expect(html).toContain('No canonical snapshot changes');
      expect(md).toContain('No canonical snapshot changes');

      // 5. Successful-turn export output is unaffected
      const successMessages = [
        {
          role: 'assistant',
          content: 'You walk forward.',
          timestamp: 2,
          blocks: [{ type: 'prose', content: 'You walk forward.' }],
          logic_state: {
            current_phase: 'MANIFEST',
            suggested_tension: 25,
          },
          validation: {
            accepted: true,
            rejected_fields: [],
            repair_notes: [],
          },
        },
      ];
      const successHtml = buildEngineLogContent(successMessages, 'html')!.content;
      expect(successHtml).toContain('<strong>Accepted:</strong> true');
      expect(successHtml).not.toContain('Diagnostic Kind');
      expect(successHtml).not.toContain('Rejected Paths');
    });

    it('proves normalized failure receipts in structured JSON, Markdown, and HTML exports contain zero unsafe sentinels', () => {
      const CODE_SENTINEL = 'https://malicious.internal.api/key?secret=123';
      const MESSAGE_SENTINEL = 'DATABASE_PASSWORD=secret_password_here';
      const CONTENT_TYPE_SENTINEL = 'text/html; charset=utf-8; <script>evil()</script>';
      const PATH_SENTINEL = 'https://api.internal/v1/auth/tokens?user=root';
      const DIAG_CODE_SENTINEL = 'UNKNOWN_LEAKED_INTERNAL_ERROR_STACK_TRACE_HERE';
      const NESTED_SENTINEL = 'INTERNAL_AUTH_BEARER_TOKEN_99999';

      const rawUnsafeError = {
        code: CODE_SENTINEL,
        message: MESSAGE_SENTINEL,
        error: MESSAGE_SENTINEL,
        status: 999999,
        contentType: CONTENT_TYPE_SENTINEL,
        unknown_nested_secret: NESTED_SENTINEL,
        diagnostics: {
          kind: 'SCHEMA_VALIDATION',
          issues: [
            { path: PATH_SENTINEL, code: 'invalid_type' },
            { path: 'valid.path.field', code: DIAG_CODE_SENTINEL },
            { path: 'valid.path[0]', code: 'invalid_type' },
          ],
          extra_secret: NESTED_SENTINEL,
        },
      };

      const normalizedReceipt = normalizeTurnFailureReceipt(rawUnsafeError);

      const failedMessages = [
        {
          role: 'user' as const,
          content: 'I attempt an action that causes provider failure',
          timestamp: 1,
        },
        {
          role: 'assistant' as const,
          content: '[ENGINE FAILURE // UNKNOWN_ERROR]\nThe turn service returned an unexpected response. The session state was not changed.',
          timestamp: 2,
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'ORIGIN',
            requestedTarget: null,
            accepted: false,
            reason: 'Turn failed',
            nodeAfter: 'ORIGIN',
            activeVector: 'COGNITIVE' as const,
            activeTier: 'LATENT' as const,
            tension: 0,
            failureReceipt: normalizedReceipt,
          },
        },
      ];

      const jsonExport = JSON.stringify(failedMessages, null, 2);
      const mdExport = buildEngineLogContent(failedMessages, 'md')!.content;
      const htmlExport = buildEngineLogContent(failedMessages, 'html')!.content;

      const exports = [jsonExport, mdExport, htmlExport];

      for (const content of exports) {
        expect(content).not.toContain(CODE_SENTINEL);
        expect(content).not.toContain(MESSAGE_SENTINEL);
        expect(content).not.toContain('evil()');
        expect(content).not.toContain(PATH_SENTINEL);
        expect(content).not.toContain(DIAG_CODE_SENTINEL);
        expect(content).not.toContain(NESTED_SENTINEL);
      }

      // Valid diagnostic survives
      expect(jsonExport).toContain('valid.path[0]');
      expect(mdExport).toContain('valid.path[0]');
      expect(htmlExport).toContain('valid.path[0]');
    });

    it('exports Horror Grammar 1 typed forensics and preserves rejected evidence containment', () => {
      const REJECTED_ACT_SENTINEL = 'SENTINEL_ACT_REJECTED_987654321';
      const REJECTED_PRESS_SENTINEL = 'SENTINEL_PRESS_REJECTED_123456789';
      const SECRET_PROMPT_SENTINEL = 'SYSTEM_PROMPT_SUPER_SECRET_KEY';

      const hgForensics = {
        version: 1 as const,
        turnNumber: 1,
        preFictionalTime: {
          moment_revision: 1,
          scene_beat_revision: 0,
          extended_revision: 0,
          last_cost: null,
        },
        postFictionalTime: {
          moment_revision: 2,
          scene_beat_revision: 0,
          extended_revision: 0,
          last_cost: 'MOMENT' as const,
        },
        presentOpportunityIds: ['opp-present-char-npc1'],
        selectedOffscreenPursuitIds: ['pursuit-offscreen-npc2'],
        boundedOutPursuitIds: [],
        dormantCount: 0,
        notDueCount: 0,
        activityEvidence: {
          disposition: 'REJECTED' as const,
          reasonCode: 'LOCAL_TRACE_CANNOT_USE_DIALOGUE',
          admittedToNarrative: false,
          proposalId: 'prop-act-01',
          castMemberId: 'char-npc1',
          locationNodeId: 'VAULT_01',
          perceptionPath: 'LOCAL_TRACE' as const,
          activitySummary: 'Taps on pipes',
          authorityReferences: ['opp-present-char-npc1'],
          manifestationBlock: {
            type: 'dialogue' as const,
            speaker: 'Mercer',
            content: REJECTED_ACT_SENTINEL,
          },
          acceptedEventId: null,
        },
        pressureEvidence: {
          disposition: 'REJECTED' as const,
          reasonCode: 'INVALID_VALUE_ANCHOR_REFERENCE',
          admittedToNarrative: false,
          proposalId: 'prop-press-01',
          valueAnchorId: 'val-nonexistent',
          sourceReference: 'ACTIVITY',
          operator: 'EXPOSE' as const,
          affectedDimension: 'SAFETY' as const,
          adverseProspect: 'Oxygen fails',
          authorityReferences: [],
          manifestationBlock: {
            type: 'prose' as const,
            content: REJECTED_PRESS_SENTINEL,
          },
          acceptedThreadId: null,
        },
        causalDecisions: {
          valueDecisions: [],
          pursuitDecisions: [],
          developmentDecisions: [],
          pressureTransitions: [],
        },
        composedNarrativeBlockCount: 1,
      };

      const messagesWithForensics = [
        {
          role: 'user' as const,
          content: 'I search the wall for an access port.',
          timestamp: 10,
          userCharacterName: 'Field Operative',
        },
        {
          role: 'assistant' as const,
          content: 'You discover a rusted conduit.',
          timestamp: 11,
          blocks: [{ type: 'prose' as const, content: 'You discover a rusted conduit.' }],
          turnReceipt: {
            turnNumber: 1,
            nodeBefore: 'VAULT_01',
            requestedTarget: null,
            accepted: true,
            nodeAfter: 'VAULT_01',
            activeVector: 'COGNITIVE' as const,
            activeTier: 'LATENT' as const,
            tension: 10,
            horrorGrammarForensics: hgForensics,
          },
        },
      ];

      const rawJson = JSON.stringify(messagesWithForensics, null, 2);
      const mdExport = buildEngineLogContent(messagesWithForensics, 'md')!.content;
      const htmlExport = buildEngineLogContent(messagesWithForensics, 'html')!.content;

      // Raw JSON contains the typed record
      expect(rawJson).toContain(REJECTED_ACT_SENTINEL);
      expect(rawJson).toContain(REJECTED_PRESS_SENTINEL);
      expect(rawJson).not.toContain(SECRET_PROMPT_SENTINEL);

      // Markdown export contains forensics section and labels rejected blocks
      expect(mdExport).toContain('#### Horror Grammar 1 Forensics');
      expect(mdExport).toContain('REJECTED — NONCANONICAL');
      expect(mdExport).toContain(REJECTED_ACT_SENTINEL);
      expect(mdExport).toContain(REJECTED_PRESS_SENTINEL);
      expect(mdExport).not.toContain(SECRET_PROMPT_SENTINEL);

      // HTML export contains forensics section, labels, and properly escaped blocks
      expect(htmlExport).toContain('<h4>Horror Grammar 1 Forensics</h4>');
      expect(htmlExport).toContain('REJECTED — NONCANONICAL');
      expect(htmlExport).toContain(REJECTED_ACT_SENTINEL);
      expect(htmlExport).toContain(REJECTED_PRESS_SENTINEL);
      expect(htmlExport).not.toContain(SECRET_PROMPT_SENTINEL);
    });

    it('exports Dramaturgical Pacing & Causal Clocks (HG2) telemetry in markdown and HTML formats', () => {
      const dramaticTurnReceipt = {
        macroPhase: 'ESCALATING_VISE',
        pacingCadence: 'RATCHET_TENSION',
        phaseTransition: {
          fromPhase: 'MIDPOINT_CRISIS',
          toPhase: 'ESCALATING_VISE',
          gateMilestoneId: 'milestone-containment-breach',
          triggeredBy: 'CAUSAL_GATE',
        },
        clockAdvances: [
          {
            clockId: 'clock-containment',
            newLevel: 75,
            cause: 'Advanced +25 points via matching consequence events',
          },
        ],
        composureDeltas: [
          {
            characterId: 'char-park',
            oldComposure: 60,
            newComposure: 45,
            delta: -15,
            cause: 'Somatic/psychological trauma impact (-15)',
          },
        ],
        breakingPointRefusals: [
          {
            characterId: 'char-park',
            reason: 'Refuses to enter the chamber after witnessing the core bleed',
          },
        ],
        fictionalTimeMarker: 'MOMENT:2_BEAT:1',
      };

      const messages = [
        {
          role: 'user',
          content: 'I push open the pressurized hatch.',
          timestamp: 100,
        },
        {
          role: 'assistant',
          content: 'The airlock wheezes shut behind you.',
          timestamp: 200,
          dramaticTurnReceipt,
          turnReceipt: {
            turnNumber: 1,
            dramaticTurnReceipt,
          },
        },
      ];

      const mdExport = buildEngineLogContent(messages, 'md')!.content;
      const htmlExport = buildEngineLogContent(messages, 'html')!.content;

      // Markdown verification
      expect(mdExport).toContain('#### Dramaturgical Pacing & Causal Clocks (HG2)');
      expect(mdExport).toContain('**Macro-Phase:** ESCALATING_VISE');
      expect(mdExport).toContain('**Cadence:** RATCHET_TENSION');
      expect(mdExport).toContain('MIDPOINT_CRISIS → ESCALATING_VISE');
      expect(mdExport).toContain('milestone-containment-breach');
      expect(mdExport).toContain('[clock-containment]: Level 75');
      expect(mdExport).toContain('char-park: 60 → 45 (-15)');
      expect(mdExport).toContain('Refuses to enter the chamber after witnessing the core bleed');

      // HTML verification
      expect(htmlExport).toContain('<h4>Dramaturgical Pacing &amp; Causal Clocks (HG2)</h4>');
      expect(htmlExport).toContain('Macro-Phase:</strong> ESCALATING_VISE');
      expect(htmlExport).toContain('Cadence:</strong> RATCHET_TENSION');
      expect(htmlExport).toContain('MIDPOINT_CRISIS → ESCALATING_VISE');
      expect(htmlExport).toContain('milestone-containment-breach');
      expect(htmlExport).toContain('[clock-containment]: Level 75');
      expect(htmlExport).toContain('char-park: 60 → 45 (-15)');
      expect(htmlExport).toContain('Refuses to enter the chamber after witnessing the core bleed');
    });
  });

  describe('buildChronicleProseContent', () => {
    it('returns null for empty messages array', () => {
      expect(buildChronicleProseContent([])).toBeNull();
    });

    it('builds pure literary novella markdown stripped of debug receipts and hashes', () => {
      const chronicleMessages = [
        {
          role: 'user',
          content: '[USER_ACTION: I pry open the rusted hatch.]',
          userCharacterName: 'Dr. Maren Ross',
        },
        {
          role: 'assistant',
          blocks: [
            { type: 'engine_thoughts', content: 'Evaluating tension...' },
            { type: 'prose', content: 'The iron groan reverberates down the shaft.' },
            { type: 'dialogue', speaker: 'Marcus Holt', content: '"Careful with that latch."' },
            { type: 'internal_monologue', speaker: 'Dr. Maren Ross', content: 'My fingers are trembling.' },
            { type: 'soliloquy', speaker: 'Marcus Holt', content: 'Not like this...' },
            { type: 'system_voice', content: 'The cold deepens.' },
          ],
          logic_state: {
            current_phase: 'KINETIC_RUPTURE',
          },
          contextReceipt: mockReceipt,
        },
      ];

      const blueprint = {
        identity: { title: 'The Black Iron Mortuary' },
        setting: { location: 'Sub-Basement 7' },
      };

      const result = buildChronicleProseContent(chronicleMessages, blueprint);
      expect(result).not.toBeNull();
      const content = result!.content;

      // Clean title & setting
      expect(content).toContain('# The Black Iron Mortuary');
      expect(content).toContain('*Sub-Basement 7*');
      expect(content).toContain('Chronicle inscribed:');

      // Clean literary prose & dialogue formatting
      expect(content).toContain('> **Dr. Maren Ross** — *I pry open the rusted hatch.*');
      expect(content).toContain('The iron groan reverberates down the shaft.');
      expect(content).toContain('**Marcus Holt**:\n"Careful with that latch."');
      expect(content).toContain('*Dr. Maren Ross considers:*\n*My fingers are trembling.*');
      expect(content).toContain('*Marcus Holt mutters softly:*\n"Not like this..."');
      expect(content).toContain('> *The cold deepens.*');

      // Zero engine thoughts or technical receipts
      expect(content).not.toContain('Evaluating tension...');
      expect(content).not.toContain('KINETIC_RUPTURE');
      expect(content).not.toContain('CONTEXT RECEIPT');
      expect(content).not.toContain('METRIC LOG');

      // Clean filename
      expect(result!.filename).toMatch(/^the-black-iron-mortuary_chronicle_\d{4}-\d{2}-\d{2}\.md$/);
    });
  });

  describe('getEngineLogicData harvesting', () => {
    it('harvests clueDiscoveryReceipt when present in message', () => {
      const receipt = [
        {
          clueId: 'clue-cipher',
          clueLabel: 'Torn Cipher Fragment',
          nodeId: 'STUDY',
          characterId: 'char-investigator',
          actionKind: 'OBSERVE',
        },
      ];
      const message = {
        clueDiscoveryReceipt: receipt,
      };

      const logicData = getEngineLogicData(message);
      expect(logicData).not.toBeNull();
      expect(logicData?.clueDiscoveryReceipt).toEqual(receipt);
    });

    it('does not include clueDiscoveryReceipt when omitted from message', () => {
      const message = {
        logic_state: { phase: 'LATENT' },
      };

      const logicData = getEngineLogicData(message);
      expect(logicData).not.toBeNull();
      expect(logicData?.clueDiscoveryReceipt).toBeUndefined();
    });
  });
});

