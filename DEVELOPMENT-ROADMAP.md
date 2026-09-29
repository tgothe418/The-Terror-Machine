# The Terror Machine — Development Roadmap

This is the project's engineering ledger: the current baseline, known non-acceptances, sequencing rules, and the evidence required before work is called complete.

It is intentionally more exact than the [Technical (Public) Roadmap](./ROADMAP.md). It does not promise dates.

## Status language

- **Landed** — present on the live line and protected by the relevant verification boundary.
- **Live, under review** — implemented behavior is available, but combined inspection or acceptance evidence remains incomplete.
- **Sequenced** — designed work with an explicit dependency order; it is not yet accepted implementation.
- **Planned** — a direction that should not be mistaken for a current contract.

A focused test proves its named behavior. It does not, by itself, close an integrated feature, a production type gate, or a human-facing contract.

## Live code baseline reviewed for this ledger

- Current live line reviewed: [ab4e31d](https://github.com/tgothe418/The-Terror-Machine/commit/ab4e31d) (Seed State v1 — opening tableau as first-class state).
- The branch was clean and synced when reviewed. The status below is based on live code inspection, focused proofs, broad gates, and recent smoke telemetry; a packet's completion report is not accepted evidence by itself.

## Current baseline

### Landed

- Atomic turn pipeline: snapshot, model generation, ratification, one commit or fail-closed result, retake, and telemetry.
- Canonical topology and intent-bound expansion at an unmapped boundary.
- Role-aware participation for Protagonist, Antagonist, and Director, including explicit authority and limits for antagonist play.
- Blueprint and Haunted House / Ad-Lib Induction paths converging on shared Engine contracts.
- Canonical consequences, cast presence and continuity, stance, relationships, and bounded character memory.
- Phase 3H.5C World Memory: deterministic identity, bounded global/current-node prompt projection, required proposal and receipt contracts, fail-closed validation, canonical commit, and export evidence.
- Forge source review through the accepted Packet 02A–07 corrective sequence.
- Forge Packet 1E-1 — Source-Backed Default Import and Map Closure: valid reference imports now apply a complete source-backed baseline atomically, populate rich topology and per-character opening placement, and export perspective-neutral Blueprints without a required global starting node or permanent User character.
- Engine Corrective Packet 08 — Human Turn Contract Reliability: the provider response schema is aligned to the application contract; concise creator-written input remains exact and shares the one-generation, ratification path with Autopilot; bounded mismatch diagnostics survive failure receipts and Markdown/HTML telemetry; creator acceptance is complete.
- Horror Grammar 0 — Provider-Refusal Containment Correction: provider block metadata is classified before parsing; empty/refused responses fail closed; synthetic player-action fallbacks are removed; Autopilot halts on failed generation or non-commit; human input and canonical state remain recoverable.
- HG1 Provider Contract Closure (Packets 1-10, 1-10A, and 1-10B): the provider receives the supported structured-output schema, required HG1 envelopes remain required at ingress, causal references fail closed, and provider/runtime failures cannot become player input or canonical state.
- Local and Vite preview runtime admission: Express owns `/api`, the SPA fallback excludes API routes, and backend failures remain structured JSON failures instead of HTML masquerading as a successful turn.
- Phase 3H.5D Explicit Player-Character Binding: Exact character selection, perspective-neutral Blueprint export, entry placement, and dual-store persistence are verified across the entire lifecycle.
- Astra Critical Corrections Series (Packets 01–12, Milestones 1–5): Closed the master integration gate across the complete client → server → client turn lifecycle:
  - *Milestone 1 (Authoring & Perspective Invariants):* Packet 01 (Forge export readiness & strict Depiction Contract enforcement), Packet 02 (Perspective selection, perspective-neutral Blueprint export, and zero fictional time advancement on `SYSTEM_INIT`).
  - *Milestone 2 (Turn Lifecycle & Boundary Enforcement):* Packet 03 (Turn context isolation & consecutive turn continuity), Packet 04 (Pursuit evolution & grounded activity), Packet 05 (Situated pressure & response-window gated progression).
  - *Milestone 3 (Autopilot & Failure Containment):* Packet 06 (Autopilot & human ratification parity), Packet 07 (Provider refusal & OOC check-in fail-closed containment with zero canonical mutation).
  - *Milestone 4 (Persistence, Recovery & Telemetry):* Packet 08 (Durable dual-store IndexedDB persistence with monotonic write tracking), Packet 09 (Retake rollback across all HG1 ledgers and stores), Packet 10 (Diagnostic telemetry & forensic export segregation).
  - *Milestone 5 (Behavioral Connections & Integrated Acceptance):* Packet 11 (Offscreen runtime pursuit projection & event-driven trigger consumption/reactivation), Packet 12 (Master 9-step deterministic integration proof suite in `src/lib/integratedAcceptance.test.ts`).
- Runtime provider switching across all subsystems through AI Calibration: Engine, Forge, Voice, and Autopilot can each be switched between Gemini, OpenAI, Z.ai (GLM), and local OpenAI-compatible inference servers. Provider and model selection persists to `.env`.
- Z.ai (GLM) provider integration: `server/ai/zaiPolicy.ts` (approved model list with fallback chain, thinking-mode mapping per purpose, general/coding endpoint variant) and `server/utils/zaiClient.ts` (keyed OpenAI-compatible transport). GLM structured turns use documented JSON mode with the response schema embedded at the provider boundary; the authoritative Zod contract remains the ingress validator, and refusals, empty responses, and malformed JSON fail closed into the standard turn-failure path. The API key is entered in AI Calibration, stays server-side, and persists to `.env`.
- Local AI provider integration: any OpenAI-compatible local endpoint (LM Studio, llama.cpp, Ollama, or equivalent) can serve as a provider. The machine discovers loaded models at the configured server URL. Per-subsystem local model assignment allows the Engine, Autopilot, Voice, and Forge to each target a different local model.
- OpenAI Responses API integration for The Voice: approved model list, API key management, and provider-refusal containment. Default Voice model: GPT-5.6 Luna.
- Gemini Free Tier support with resilient backoff, automatic model fallback on rate limits, and AI Calibration for runtime tier and model selection.
- Hardened Forge extraction and candidate normalization pipeline: robust handling of malformed or truncated provider responses during source extraction.
- Voice provider policy (`server/ai/voiceProviderPolicy.ts`): runtime provider state, per-subsystem model getters/setters, and environment-backed defaults for `VOICE_AI_PROVIDER`, `LOCAL_AI_BASE_URL`, and `LOCAL_AI_MODEL`.
- Engine model policy (`server/ai/modelPolicy.ts`): approved Gemini model list, tier management, engine provider switching, purpose-driven thinking-level policies, and automatic fallback on provider errors.
- AI Calibration UI modal: runtime provider switching, model selection, API key entry, local server URL and model discovery, per-subsystem model assignment, and provider connectivity testing.
- Opening Scene Establishment & Anti-In-Media-Res Invariants: `SYSTEM_INIT` (Turn 0) prompt directive mandating physical setting architecture, sensory lighting/acoustics/scent, player embodiment and posture, and an initial companion spoken line before any crisis erupts.
- Comprehensive Vocalization & Dialogue Subsystem: Dedicated domain model (`src/types/vocalization.ts`) and pipeline (`src/lib/vocalizationEngine.ts`) supporting spoken dialogue, internal monologue (introspective thought), muttered soliloquies (`sotto voce`), radio/intercom transmissions, and acoustic bleed through observation ports and ductwork.
- Pure-Text Acoustic Soundscape Refinement (Zero Audio Hardware/Synthesizer Dependency): Strictly non-audio literary soundscapes utilizing CRT typography, typographic squelch markers (`> [CHIRP] ... [STATIC]`), shrouded obsidian acoustic bleed styling with chamber provenance (`[ ACOUSTIC BLEED // Name (via node) ]`), and em-dash broken delivery for interrupted speech (`interrupted: true`).
- Fail-Closed Topological Adjacency & Epistemic Boundaries: Adjudicates offstage acoustic sources against adjacent nodes in the spatial graph, auto-remediating single adjacent links and enforcing one-directional epistemic constraints for overheard speech (distant speakers cannot address the player directly or react to unseen actions).
- Per-Character Somatic Isolation: Strictly segregates player consequenceState (`context.consequenceState.psychological_status`) from companion NPC status. Companions never inherit player trauma, panic, or hypothermia.
- Authored Camouflage Leaks: Injects scenario-agnostic guidance for when character composure fractures under climax or critical tension.
- Interactive Forge Voice & Acoustic Dossiers: Authoring character expression profiles directly in `CastManager.tsx` with free-text cadence & rhythm notes, vocal tells, voice tone, lexicon notes, silence directives, and scenario-agnostic camouflage leak guidance. Verified by net-new compiler tests (`src/lib/forgeCompiler.test.ts`).
- Engine Contract Lockstep & Provider Schema Projection: Parity between Forge authoring (`CharacterExpressionProfileSchema`) and `EngineTurnContext` (`EngineCharacterExpressionProfileSchema`) Zod schemas, with runtime provider JSON schema projection of `interrupted` and `acousticSourceNodeId`.
- Robust Typographic Quote Parsing: Causal feasibility parser supporting straight (`" '`) and curly (`“ ” ‘ ’`) quotes, contraction guards (`don't`, `it's`, `we'll`), speech verb detection, and $\ge 2$-word constraints in `extractConversationalUtterance`.
- Auditory Topology & Physical Bleed Resolution: Automatically detects co-presence, active telephone/radio lines across multi-turn history, and acoustic architectural links (observation windows, airlocks, vents), auto-remediating off-stage speech through physical mediums instead of throwing 502 contract errors.
- Conditioned Opening Turn Directives & Critical Engine Failure Elimination: If companions are present, require living companion speech; if the player is solitary, explicitly forbid room dialogue and permit internal monologue or muttered soliloquy. Player speech attributions on Turn 0 are automatically normalized to soliloquy or prose (for nonverbal entities like Entity-41), completely eradicating solitary-start 502 contract mismatches.
- Dynamic Center Stage Typography: Overhauled narrative presentation in `Runtime.tsx` with distinct visual framing: Introspection (indigo italic with `[ INTROSPECTION // Name ]`), Soliloquy (dashed amber with `[ MUTTERED SOTTO VOCE // Name ]`), Intercom/Bleed (CRT cyan with `[ INTERCOM / ACOUSTIC BLEED // Name ]`), and Spoken Dialogue (candle-amber with `[ DIALOGUE // Name ]`).
- Dual-tier dialogue validation and speaker normalization: Automatic speaker ID-to-name mapping (`char-ricky` -> `Ricky Oates`), duplicate speaker prefix stripping in content, and recognized ambient extra whitelisting.
- 1440p Ultrawide (`3440×1440`) Occult Scrying Workstation Overhaul: Persistent 4-pane layout across `Runtime.tsx` featuring 2.5× scaled interactive SVG `MapSketch` with Fog-of-War discoverability, high-density text `MortalLedger` tracking active vessels and companion cohorts (zero portrait avatars), and live-docked `The Historian`.
- Causal Traversal & Spatial Boundary Hardening: Unaccepted transitions resolve as `CONSTRAINED / TOPOLOGY_LIMIT` without falsely triggering perceptual fracture hallucination loops. Dynamic cast arrivals and departures (`cast_arrivals`, `cast_departures` in `logic_state`).
- Forge Extraction Target Alias Expansion: `CANDIDATE_TARGET_ALIAS_MAP` in `src/lib/extractionContract.ts` maps `unknowns`, `misc`, `notes`, `lore`, `world_rule`, and `environmental` directly to canonical rules, preventing spurious candidate quarantine.
- Four 20-Turn Multi-Role Local Playtest Battery: Headless simulation harness (`scripts/run_four_20turn_battery.ts`) verifying 80/80 total turns on local Gemma 4 26B QAT across Protagonist, Antagonist, Villain, and Survivor seats with automated fidelity, quality, and accuracy scoring, and critical error skip/abort handling.
- Horror Grammar 2 (HG2) Series 1 — Pacing Governor, Clocks & Character Stakes: Landed and verified across all engines, routes, stores, UI surfaces, and test suites. Autonomous seat-aware pacing mandates (`src/lib/pacingGovernor.ts`), undulating cadence breath (`RESPITE_AFTERMATH`, `SIMMERING_DREAD`, `MOUNTING_COMPLICATION`, `KINETIC_RUPTURE`), impending environmental clocks with threshold manifestation cues, D2 situated diegetic instrument readouts, D3 obstructive breaking points with deterministic lift conditions, and D1 causal macro-phase milestone gates.
- Client-Loop Ratification & State Whitelist: Passed `dramaturgyState`, `cast_arrivals`, `cast_departures`, and `current_node_id` through the client ratification pipeline, ensuring macro-phase, cadence, and presence state persist through live browser turn loops.
- The Silver Rest Lodge Canonical Interaction Scenario: Dedicated alpine social-horror blueprint (`src/data/blueprints/silver_rest_lodge.json`, Feb 1991) with 7 rooms, 8 cast members across survivor, villain, and bystander roles, 3 impending clocks with situated diegetic instruments, 4 causal milestone gates, and full subsystem test coverage (`src/data/blueprints/silver_rest_lodge.test.ts`).
- 40-Turn HG2 Headless Benchmark Batteries: Validated 80/80 turns on local Gemma 4 26B QAT across dual-role configurations (Survivor & Villain) for both *The Black Iron Mortuary* (`scripts/run_hg2_40turn_benchmark.ts`) and *The Silver Rest Lodge* (`scripts/run_silver_rest_40turn_benchmark.ts`), verifying Retake idempotence, causal gating, and zero floating gauges.
- Forge Villain-Always Invariant (`0840859`, `a745ea7`): `validateForgeDraft` fails compilation when the cast contains no `VILLAIN`; extraction dual-extracts named/speaking antagonists as both cast villain (`isEntity`) and antagonist profile; repair flow appends cast, preserves any existing villain, and strips bogus provenance.
- Villain-Protagonist Model (`9031f06`, `0003346`): `villainProtagonist` scenarios bind the villain to the protagonist seat and rebind the antagonist seat to the opposition/investigator figure; pressure inverts into Discovery (external, investigation-as-pursuit) and Compulsion (internal, self-sourced) families; Forge coerces invented dispositions and deterministically backfills a villain from the antagonist profile.
- Forge Lint Sweep (`131a75a`): resolved 59 `no-explicit-any` + 3 unused-variable errors across Forge files.
- HG2 Series 2 Initial Core Boundary (`b98df71`): canonical cohort state (`src/types/cohort.ts`), cognition/evidence ingestion (`cohortCognition.ts`), membership lifecycle (`cohortBehaviors.ts`), bounded fictional-time ticks and deterministic two-layer behavior selection (`cohortEngine.ts`), `INVESTIGATE` + `SHARE` verbs with topology-gated sharing, player-perceivable traces separated from ingestible evidence, hidden internal receipts, reducer integration, and full retake restoration. Verified against 8 review amendments; 7 emergence fixtures in `src/lib/cohort.emergence.test.ts`.
- Cohort Fixture Mock Correction (`b1f97fe`): test-only correction of the `ScenarioBlueprint` mock shape in the emergence fixture (narrative fields moved under `narrativeRules`, required `contentScale`/`contentLevelDescription` added); zero runtime effect.
- Death Mechanics Implementation Packet (`e9b36fd`): wound ledger with timeline/severity/treatability invariants, survivability evaluation against the fictional-time clock, `declareDeath` with causal receipts and corpse evidence, sacrifice command parser (`[SACRIFICE victim:<characterId>]`), POV-death Chronicle generation and retake restoration, four emergence fixtures; plus the Forge local-model token-budget repair (JSON-mode calls omit `reasoning_effort`, 16,384 default caps, one clamped retry on truncation) and the AI-slop name blocklist wired into extraction prompts.
- Death Mechanics Live Wiring Follow-up (`21a332e`): `processTurnDeathPass` wired into the reducer's `TURN_COMMITTED` event — wound fact ingestion, treatment validation (wound exists, still open, treater co-located), sacrifice execution, per-character survivability evaluation, `declareDeath` application, POV termination to `TERMINATED` with Chronicle modal presentation; `deathContract` required on all Forge blueprints with compile-time failure (`powerBudget` + `deathMetaphysics` always, `seatSuccession` for cohort scenarios); legacy backfill annotation in `normalizeBlueprint`.
- Post-Reset Stabilization & Modernization Architecture (Stages 1–5):
  - *Stage 1 (Universal Provider Roster Validation & Concurrency):* `CastNormalizationContext` exported; fail-closed roster normalization across Gemini, OpenAI, Claude, Local, and Z.ai; per-request `turnContract` instances in `server/routes/turn.ts` eliminating concurrency leaks.
  - *Stage 2 (Voice Telemetry Injection & Runtime UX):* `VoiceTelemetrySchema` in `server/schemas/index.ts`; live simulation telemetry injection (`[LIVE SIMULATION TELEMETRY - ORACLE OF RECORDS]`) in `server/routes/voice.ts`; `TheVoice.tsx` telemetric grounding; role category protection on map selection.
  - *Stage 3 (Greenfield SSE Transport & Turn Streaming):* High-performance `server/utils/sse.ts` (`SseStream` class with monotonic IDs, 15s heartbeats, and client disconnect handling); `POST /turn-stream` and `POST /stream` in `server/routes/turn.ts`; ephemeral presentation-only streaming in `src/services/geminiService.ts` and `src/components/engine/Runtime.tsx`.
  - *Stage 4 (Unified Forensic Sweep Engine & Review Preservation):* Sentence-snapped window planner (`server/ai/windowPlanner.ts`, `W1/1` support); sweep orchestrator with job ledger (`server/ai/sweepOrchestrator.ts`); server-side source retention with pinned job IDs in `server/routes/forge.ts`; non-breaking schemas (`SweepProvenanceSchema`, `SweepJobRequestSchema`); review-preserving store merge (`mergeSweepCandidates`); live SSE progress rendering in Forge `ScenarioBaselinePanel.tsx`.
  - *Stage 5 (Universal Navigation Shell & Parameterized Proof Runs):* Pinned top-left global calibration cogwheel in `src/App.tsx` opening `AiCalibrationModal` as a non-destructive overlay across all views; header clearance in Forge and Runtime; parameterized benchmark script (`scripts/run_hg2_40turn_benchmark.ts` with `--turns=N`, `--scenario=ID`, `--seat=ROLE`); 20-turn and 40-turn proof runs passing 100% of quantitative criteria.
- Horror Grammar 3 (HG3) — Self-Preservation & Death Awareness (Stages 1–3):
  - *Stage 1 (Salience Dynamics & Decay Engine):* Character-level salience ledger tracking `spike`, `dread`, and `threatType` (`life` | `freedom` | `identity`); exponential decay with residue retention; threat-vector weight scaling; prey-mode trigger with hysteresis; 4-band somatic state derivation with deterministic physiological tokens (`[SOMATIC STATE: ...]`); distorted external observations for terrified POV characters with strict internal felt-wound severity preservation.
  - *Stage 2 (Cohort Behavior Engine Integration & Emergence):* Fear-salience integration in cohort behavior scoring (`scoreCandidateBehavior`); threat-specific behavior reweighting (`FLEE`, `HIDE`, `SUBMIT`, `CONCEAL`, `DENY`); fearlessness dampening; narrative release valves; submit/capitulation execution under Band 4 terror; monotonic retake restoration.
  - *Stage 3 (Authoring, Forge & Integration):* Mandatory `fearContract: FearContractSchema` on `ForgeDraftSchema` / `ForgeDraft` with compile-time validation (`validateForgeDraft` §13); legacy backfill in `normalizeBlueprint`; default initialization in `useForgeStore`; extraction prompts in `extractionContract.ts` and `architect.ts` eliciting fearlessness, threat weights, release valves, villain gaze authority, and submit responses; Autopilot somatic state and felt wound knowledge injection in `server/routes/chat.ts`; Player Sovereignty unit test suite verifying human player actions are never overridden or reweighted by fear salience at Band 4 while somatic tokens are emitted to narration.
- Horror Grammar 4 (HG4) — Packet 4: Routines, Drift & Phase 1 Acceptance (`2a97868`):
  - *Deterministic routine evaluation (`src/lib/routineMechanics.ts`):* `dueRoutines` filters by fictional time against cadence (`firstFireMinutes`, `periodMinutes`), sorted by `routineId`; `evaluateRoutineTick` computes drift via `computeDrift` (modifier-adjusted minutes added to the next fire time) and emits blocked steps with skipped reason codes — disruption is state, not failure.
  - *World predicates (`src/lib/worldPredicates.ts`):* backing predicates for routine evaluation conditions.
  - *Headless probe harness (`src/lib/headlessProbe.ts`):* provider-free verification of the Phase 1 acceptance bar (A1).
- Aggressive Autopilot v1.1 (`22edc70`, `b05e9f9`):
  - *Three headless modes* through the identical validation and ratification pipeline as live play: Standard (default, byte-locked to a frozen baseline fixture), Aggressive (mechanics-envelope injection + threshold-seeking probes), Adversarial (probes validation and invariants; rejections are passing tests; loops until 3 consecutive non-committed turns).
  - *Refusal budget:* 3 per run across all modes; the 4th aborts. Adversarial report contract conformance: `characterName` plus top-level `refusals`.
  - *Envelope numbers generated from code constants* — never hand-tuned; Director-vs-engine probing explicitly out of scope.
  - *Acceptance status:* two manual checks remain open — a 10-turn Aggressive-vs-Standard comparison, and an Adversarial run from a non-Director seat.
- Seed State v1 — Opening Tableau as First-Class State (`ab4e31d`):
  - *Schemas (`src/types/forge.ts`):* `CharacterSeedSchema` (`where`, `doing`, `condition`, `charge`, `knows`, `wants`, `bonds`) with cross-field gating — user characters require `circumstance` + `inclination` and forbid `wants`; NPCs require `wants` and forbid `circumstance`/`inclination`. Scenario-level `openingState` on blueprint and draft.
  - *Application (`src/lib/seedApplication.ts`):* pure `applySeedToState` wired into `initializeSession` — opening-state world ledgers first, then per-character in cast order (`where` → `wants`/`circumstance`+`inclination` → `condition` → `charge` → `knows`/`bonds` → `doing`); `SEED` provenance on every write; dread floors pinned to `somaticBands` contract constants; Director-gated mid-run re-seeding; retake snapshots capture the new ledgers.
  - *Validation (`src/lib/seedValidation.ts`):* wired into `validateForgeDraft` — seed-vs-blueprint reference checks, no-bilocation and restraint-capable verb checks, Law 6 grounding (opposition pursuit citations must resolve to the character's own knowledge; hard error for opposition seats).
  - *Backfill:* idempotent `scripts/backfill-seeds.ts` for canon blueprints plus neutral-seed synthesis in `normalizeBlueprint`; the S1 neutrality invariant is test-enforced.
- The current live line passes 158 / 158 Vitest test suites (2,060 passing tests), 0 TypeScript errors, 0 ESLint errors/warnings, and clean git status.

### Live, under review / Sequenced next boundaries

- Experiential Play Review (top sequenced package): live human interactive play in the browser to exercise vocalization, presence tracking, fog-of-war, and HG2 macro-phase and cadence progression across real human sessions.
- Inherited Gate Debt Cleanup Packet: **resolved** — the inherited 78 `tsc` / 177 `eslint` debt items are gone; the live line reports 0 TypeScript errors and 0 ESLint warnings (verified at `ab4e31d`). Remaining hygiene scope (legacy test fixtures, store predicates, draft baseline reconciliation) stays sequenced as isolated cleanup without blending into feature work.
- Universal warning and intervention window prior to permanent or fatal loss (explicitly deferred from the Astra Critical Corrections series).
- Voice read-only context expansion across separate drafts, sessions, and research (deferred).
- Telemetry drawer visual polish and dedicated prose-only export option (deferred).
- Horror Grammar 2: Packet Series 2 — Opposition Cohort Autonomy & Reaction Cycles (initial core boundary landed; remaining verbs and tuning sequenced).
- Z.ai Live Provider Verification (pending funded API key).

## Horror Grammar 1 construction ledger

The Horror Grammar 1 series is fully landed, integrated, and verified on the live line. Its purpose is to let the Blueprint provide values, pursuits, fictional time, and narrative pressure so non-User characters can continue pursuing their own concerns without turning the Engine into a visible stat system. The User supplies actions; the Engine may commit only causally supported changes.

| Packet | Construction boundary | Current disposition |
|---|---|---|
| **1-1 — Forge value and pursuit foundations** | Value and pursuit types, provenance, Blueprint authoring, and proposal foundations. | **Landed and verified.** |
| **1-2 — Fictional time and cast activity selection** | Fictional-time ledger, activity scheduling, and bounded offscreen opportunity selection. | **Landed and verified.** |
| **1-3 — Validated non-User initiative and situated pressure** | Initiative and pressure ratifiers plus isolated narrative composition. | **Landed and verified.** |
| **1-4 — Causal value, pursuit, and character evolution** | Value state, pursuit overlays, development, and pressure-thread lifecycle structures. | **Landed and verified.** |
| **1-5 — Forensic telemetry and integration gate** | Forensic/export scaffolding and integration tests. | **Landed and verified.** |
| **1-10 through 1-10B — Provider and route admission** | Exact HG1 provider envelopes, causal-reference validation, Gemini structured-output compatibility, and API failure containment. | **Landed and verified.** |
| **Astra 01 through 12 — Master Integration Gate** | End-to-end multi-turn continuity, authority gating, forensic segregation, Retake rollback, durable persistence, and Autopilot parity. | **Landed and verified** (`src/lib/integratedAcceptance.test.ts`). |

### Critical integration closure — COMPLETED AND CLOSED

1. **State threading:** Extended Engine turn context and route contract with bounded HG1 state, initialized from Blueprint, and published post-state without empty fallbacks. *(Verified in Packets 03 & 12)*.
2. **Authority and perception:** Exact Blueprint authority, perception channel, speaker, and location grounding adjudicated before canon admission. *(Verified in Packets 03, 05 & 12)*.
3. **Forensic boundary:** Typed, bounded forensic record in Runtime review surface and exports, preserving rejected proposal evidence only in labeled section while keeping secrets and provider internals segregated. *(Verified in Packets 10 & 12)*.
4. **Integration proof:** Master 9-step integration proof suite (`src/lib/integratedAcceptance.test.ts`) verifies two consecutive turns, empty turns, rejected proposals, provider refusals, OOC check-ins, Retake, durable reload, and session supersession. *(Verified in Packet 12)*.

Horror Grammar 2 Series 1 (Pacing, Clocks & Character Stakes) is landed. Horror Grammar 2 Series 2 (Opposition Cohort Autonomy & Reaction Cycles) has its initial core boundary landed (`b98df71`); the remaining 13 verbs and playtest tuning are sequenced next. No grammar packet beyond the Series 2 boundary should be treated as active implementation until explicitly sequenced.

## Deferred, non-blocking observations

These are recorded for later audit once the critical integration closure is working. They do not hold the larger creative direction unless a live trace demonstrates canonical corruption, loss of User agency, stranded recovery, or unsafe provider/internal leakage.

- Reconcile opportunity-selection wording between Blueprint baseline activity and runtime overlays after state threading is complete.
- Review turn and revision display identifiers for any off-by-one presentation without changing canonical identity.
- Tighten free-form reason codes, bounded array limits, and enum/provenance wording where real traces show that the current contracts are too loose.
- **Forge Intake Progress Bar & Stage Flow Smoothing (QOL):** During document intake, the progress bar currently advances rapidly through client-side parsing/layout estimation (~90%) and then plateaus while waiting for backend LLM inference and structured candidate generation (the final 10%). Update `FileDropzone.tsx` to clearly separate intake stages: (1) Reference Ingestion & Text Extraction (0–30%), (2) Model Inference & Deep Scenario Extraction (30–85% with dynamic asymptotic pacing based on selected model/provider latency), and (3) Candidate Synthesis & Graph Resolution (85–100%), keeping user visibility accurate throughout long inference windows.
- **Subagent Routine Optimization & Specialist Swarm (Priority for Next Update):** Formalize the local subagent routine for complex authoring, verification, and regression tasks: (1) *Specialist Swarm Architecture* (partitioning monolithic extraction tasks into atomic topology, cast, and antagonist micro-payloads to minimize latency and token bloat), (2) *Worker-Critic Auto-Healing* (pairing local workers with an automated discrepancy evaluator that invokes `/api/resolve-discrepancies`), (3) *Streaming Telemetry & Heartbeat Updates* (emitting live stage events to eliminate UI stalls), and (4) *Automated Prompt CI Suites* (preserving `scripts/benchmark_forge_extraction.ts` as a permanent prompt regression harness).
- Expand broader multi-turn fixtures and CI coverage after the real boundary proofs exist; helper-only coverage is not a substitute for that proof, but its absence is not itself a reason to stop construction.
- Polish forensic drawer presentation and export labeling after the typed forensic record is in the correct place.

## Accepted Forge corrective sequence

The source-to-Blueprint handoff is now one reviewable chain rather than a set of loosely connected features. Packet 1E-1 closes the normal default-import path: valid, evidence-backed source analysis can produce a complete, perspective-neutral, exportable Blueprint without requiring a permanent global start or player character. Unsupported or ambiguous source material remains an explicit authoring gap.

| Packet | Accepted boundary |
|---|---|
| **02A — Candidate Decisions** | Candidate decisions remain exactly accepted or rejected and do not mutate the draft directly. |
| **02B — Architect Response Isolation** | Malformed or identity-mismatched ambiguity responses fail closed before conversation or lifecycle state is recorded. |
| **02C — Retake Identity** | Retake checkpoints require exact, non-empty session and Blueprint identity. |
| **03A — Architect Server Protocol** | Ambiguity resolution uses strict, bounded, identity-bound request and response contracts without fabricated fallback prose. |
| **03B — Resolution Transaction** | An accepted resolution and its schema-backed Blueprint patch commit together or leave prior state untouched. |
| **04A — Baseline Revision and Proposal State** | The persisted Source Baseline revision is distinct from the draft revision, and complete proposals cannot apply after either source changes. |
| **04B — Depiction Generation Protocol** | The Architect produces scenario-specific Depiction Contract proposals from validated, bounded Forge context; malformed output fails visibly. |
| **04C — Depiction Panel Lifecycle** | The creator can generate, review, apply, dismiss, refresh, and manually edit a source-grounded proposal. |
| **05 — Evidence Drawer** | Candidate evidence remains available through a focused in-application review surface. |
| **06A — Export Artifact** | Export compilation produces one deeply immutable artifact carrying the supplied draft and Source Baseline revisions. |
| **06B — Export Review Snapshot** | Opening Export Review captures one artifact; Copy and Download use its exact bytes; revision changes require refresh. |
| **07 — Stabilization** | Sequence-related type and fixture integrations were repaired; the full test suite, lint, and production build passed. |
| **1E-1 — Source-Backed Default Import and Map Closure** | Accepted source candidates apply atomically, including Depiction Contract, rich topology, and per-character opening placement; export remains perspective-neutral and schema-valid. |

The post-07 mount correction ensures that the normal closed-to-open Export Review path actually creates the first snapshot rather than initializing while hidden.

## Accepted Engine corrective sequence

| Packet | Accepted boundary |
|---|---|
| **08 — Human Turn Contract Reliability** | The provider schema now projects the authoritative application response contract more faithfully. Concise creator input is preserved verbatim and follows the same one-generation, fail-closed route as Autopilot. Safe schema-failure paths and codes survive the failure receipt and Markdown/HTML telemetry. Focused tests, scoped lint, a scoped-clean TypeScript result, production build, and creator live smoke acceptance are recorded. |
| **Horror Grammar 0 — Provider-Refusal Containment Correction** | Provider refusal and empty-response metadata are classified before parsing; route failures omit synthetic action input; Autopilot stops on failed generation or non-commit; human input is recoverable and canonical state remains unchanged. |
| **1-10 — HG1 Provider Contract Restoration** | The complete HG1 proposal envelope is required at provider ingress; omission, refusal, and empty responses fail closed instead of manufacturing neutral state. |
| **1-10A — HG1 Exact Provider Closure** | Canonical enum and causal-reference constraints are projected exactly, valid causes are fail-closed, and bounded prompt projections carry the HG1 context used by ratifiers. |
| **1-10B — Gemini Structured-Output Compatibility and Live Turn Admission** | Gemini receives the supported JSON-schema transport shape, the authoritative Zod contract remains the ingress validator, and the production turn route preserves structured failure semantics. |

## Accepted Astra Critical Corrections Sequence (Packets 01–12 across Milestones 1–5)

The 12-packet Astra Critical Corrections series resolves the integration gate across the complete client → server → client turn lifecycle and is fully verified on the live line:

| Packet | Accepted boundary |
|---|---|
| **01 (M1) — Forge Baseline & Export Contract** | Forge export readiness enforces strict Depiction Contracts, schema validation, and perspective neutrality. |
| **02 (M1) — Perspective Invariants & Campaign Entry** | Perspective-neutral Blueprint compilation, arbitrary player character selection, zero fictional time cost on `SYSTEM_INIT`, and opening narrative block continuity. |
| **03 (M2) — Multi-Turn Continuity & State Threading** | Consecutive turn state threading without reset or fallback loss across fictional time, cast activity, and situated pressure. |
| **04 (M2) — Empty-Turn & Idle Persistence** | World memory and canonical condition persistence across empty turns, silence, and neutral observation actions. |
| **05 (M2) — Offscreen Pursuit & Situated Pressure Execution** | Offscreen opportunity generation, pursuit advancement, and response-window gated pressure ratification. |
| **06 (M3) — Autopilot Ratification Parity** | Autopilot action generation shares exact production ratification pipeline, state schemas, and fail-closed validation. |
| **07 (M3) — Failure Containment & Fictional Frame Integrity** | Provider refusal and malformed responses fail closed with zero state mutation; OOC AI narrator check-ins are cleanly rejected from canonical narrative. |
| **08 (M4) — Dual-Store Monotonic Persistence** | Monotonic sequence tracking in IndexedDB and Zustand dual-store synchronization across browser reloads. |
| **09 (M4) — Retake Rollback of HG1 State** | Retake cleanly unwinds all HG1 ledgers, fictional time, and activity events back to exact pre-turn checkpoint. |
| **10 (M4) — Forensic Telemetry Segregation** | Technical diagnostics and rejected proposals isolated in labeled forensic export sections, preserving clean playable story blocks. |
| **11 (M5) — HG1 Behavioral Connections** | Event-driven pursuit triggering, trigger consumption on neutral turns, bounded-out persistence, and runtime pursuit projection. |
| **12 (M5) — Integrated Acceptance & Master Stabilization** | Master 9-step deterministic integration proof suite (`src/lib/integratedAcceptance.test.ts`), experiential review cases for Justin, and broad quality gates closure. |

## Next work packages

The Horror Grammar 1 integration gate, explicit Player-Character Binding, Autopilot ratification parity, durable dual-store persistence, and runtime provider switching are fully closed and verified. Future implementation proceeds along the following sequenced packages:

### 1. Multi-scenario experiential play review and edge hardening

Before opening new feature cycles, play the stabilized machine across varied scenarios with Justin, assessing:
- Grounded human horror at high physical pressure.
- Authored supernatural horror within defined Authority Contracts.
- Deliberate uncertainty and uncollapsed epistemic ambiguity.
- Reassurance, lying, and refuge dialogue without system-error replacements.
- Out-of-character check-in containment vs. ambiguous in-world psychological prose.
- Protagonist and antagonist player sovereignty and response-window gating.
- Provider-switching behavior under real session conditions across Gemini, OpenAI, and local models.

Address the failures, rough edges, and UX observations these real sessions reveal.

### 2. Enforce authored participation and treatment at the Engine boundary

The Engine must use accepted Blueprint contracts while retaining deterministic ownership of causality and canon.

Acceptance requires:

- authority adjudication before prose generation and before any canonical consequence, character state, or durable memory commits;
- a thought-, perception-, or motivation-only antagonist never receiving ratified direct physical reach unless its Authority Contract expressly grants it;
- the Depiction Contract shaping framing and directness without granting causal authority;
- a structured treatment receipt recording direct depiction, abstraction/aftermath, or a refusal to render;
- provider refusal represented as a distinct Engine event, never as player input;
- tests for authority denial, permitted direct depiction, scenario-authored abstraction, provider refusal, retake, and unchanged canonical state on a blocked result.

Provider-level non-negotiable constraints remain external to the Blueprint contract. They must be represented honestly without pretending the player authored the refusal.

### 3. Complete provider-neutral Engine and Forge paths

The Voice already operates across all three provider types. The Engine and Forge have provider-switching infrastructure and local model assignment in place. Completing provider-neutral operation requires:

- verifying structured-output negotiation and ingress validation across Gemini, OpenAI, and local models on the live turn path;
- confirming Forge extraction and candidate normalization function correctly across providers without provider-specific exceptions in application code;
- ensuring provider-specific behavior (format negotiation, backoff, fallback) is fully contained at the provider boundary.

### 4. Universal warning and intervention window (Deferred Boundary)

Design and integrate an explicit warning/intervention window before irreversible consequence or terminal loss occurs. (Preserved as explicitly deferred from the Astra Critical Corrections series).

### 5. Voice context enhancements (Deferred Boundary)

Keep Voice observations read-only and separate from simulation canon. Add evidence-labelled context, snapshot/export parity, and clear handling for Forge drafts, Engine sessions, outside research, and ordinary project conversation. (Preserved as explicitly deferred from the Astra series).

### 6. Telemetry polish and dedicated prose-only export (Deferred Boundary)

Refine Runtime diagnostic drawer presentation, add dedicated prose-only export formats alongside technical forensic telemetry, and expand multi-scenario integration fixtures.

### 7. Multi-Blueprint campaign continuity

Extend character and World Memory through campaign handoff between authored Blueprints with scoped, inspectable transfer. Campaign handoff must remain explicit rather than becoming an implicit global ledger.

### 8. Horror Grammar 2: Packet Series 1 — Pacing, Clocks & Character Stakes (Landed)

Series 1 is fully landed and verified on the live line: undulating tension cadence (The Breath), impending environmental clocks with threshold-keyed manifestation cues, character psychological stakes with deterministic lift conditions, and causal macro-phase milestones. The vocalization subsystem's live play review is folded into HG2's experiential verification.

### 9. Horror Grammar 2: Packet Series 2 — Opposition Cohort Autonomy & Reaction Cycles (Active Implementation)

Series 2 has been re-sequenced by owner decision around a new seed: the opposition as a living, investigating cohort — every cohort action explainable from what the acting character knew, no Director verbs, no dice.

- **Landed (initial core boundary, `b98df71`):** canonical cohort state, cognition/evidence ingestion, membership lifecycle, bounded fictional-time ticks, deterministic two-layer behavior selection, `INVESTIGATE` + `SHARE` verbs, traces/receipts, reducer integration, retake restoration.
- **Sequenced next:** the remaining 13 verbs of the 15-verb behavior matrix (each with per-verb executable contracts), playtest tuning of selection weights / fatigue / phase thresholds / tick bounds, and deeper coordination and suspicion dynamics.

*Note*: The earlier Series 2 framing (revelation staging, thematic lore unpeeling, tension-decay dynamics) is superseded; those remain open research areas, not the active packet.

## Construction environment

Active construction and local verification have moved from Google AI Studio to Antigravity. The machine supports Gemini, OpenAI, and local OpenAI-compatible inference servers as runtime providers. Gemini remains the default; provider neutrality is an active engineering direction.

The construction environment and the application provider are separate concerns. Future provider work must preserve the same Engine contracts rather than smuggling provider-specific behavior into canon.

## Engineering rules that do not bend

- Blueprint data is input, never a hidden runtime instruction. Production code and implementation packets remain scenario-agnostic.
- The model proposes; deterministic application code decides what becomes true.
- Failed validation preserves canonical state and emits useful evidence.
- No numeric pressure gauges in ordinary play (diegetic instruments excepted per D2).
- No phase transition without a causal, authored milestone.
- Required schemas become stricter. Stale fixtures are repaired at their source.
- Broad type escapes, suppression comments, permissive defaults, and fallback receipts are not ordinary gate-repair tools. Any unavoidable test-only bridge must remain isolated and justified.
- When a contract crosses a UI or route boundary, tests must exercise that real boundary; helper-only tests are insufficient.
- Human review remains part of acceptance for generated Blueprints, exported telemetry, and changes affecting player identity or authorial intent.
- A Depiction Contract may shape framing and directness. It cannot grant causal authority or override provider-level constraints.

## Verification discipline

### Bounded construction packets

For a narrow implementation sequence:

1. name one observable boundary and its focused proof;
2. complete the implementation before running that proof;
3. permit only a tightly bounded corrective rerun;
4. lint the scoped files;
5. stop and report unrelated failures instead of absorbing them into the packet.

Do not run the full suite, global TypeScript check, full lint, and production build after every micro-packet unless that packet explicitly owns a broad integration gate. Broad checks belong at planned stabilization points, where their failures can be classified coherently.

### Broad stabilization

At the end of a corrective sequence, run the declared project gates in order:

- complete Vitest suite;
- TypeScript check;
- full lint;
- production build;
- diff check.

A passing focused test does not erase a failing production type gate. A passing broad gate does not prove the requested behavior exists. Both kinds of evidence are required at the appropriate stage, and inherited failures remain visible until repaired.

## Relationship to the public technical roadmap

The [Technical (Public) Roadmap](./ROADMAP.md) explains the machine's direction for a technically curious visitor. This document records exact sequencing, acceptance evidence, and open debt. Update both when current behavior or the active work boundary materially changes.
