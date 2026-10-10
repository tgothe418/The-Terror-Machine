<p align="center">
  <strong>FREE HAUNTED <span style="color: #60a5fa;">HOUSE</span></strong>
</p>

<h1 align="center">THE TERROR MACHINE</h1>

<p align="center">
  <em>An open-source, neuro-symbolic runtime for building, entering, and surviving impossible places.</em>
</p>

<p align="center">
  <a href="./ROADMAP.md"><strong>Technical Roadmap</strong></a> &middot;
  <a href="./ARCHITECTURE.md"><strong>System Flowchart</strong></a> &middot;
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="#three-canonical-scenarios"><strong>Scenarios</strong></a> &middot;
  <a href="#the-laws-of-the-house"><strong>Laws of the House</strong></a> &middot;
  <a href="./LICENSE"><strong>MIT License</strong></a>
</p>

---

> Most LLM-based interactive stories collapse into repetitive adjective escalation, spatial hallucinations, and context rot after 10 turns. The Terror Machine is an open-source, neuro-symbolic runtime that decouples ground-truth state from token generation. By combining formal topological graphs, diegetic pacing governors, and schema-enforced causal ratification, it enables sustained, multi-turn narrative tension across both cloud APIs and small local models.

### The Model Proposes. The Machine Decides.

In standard LLM interfaces, history is a lossy text buffer. Doors un-lock themselves, injuries vanish, and the prose spirals into melodrama. 

The Terror Machine replaces prompt drift with deterministic state persistence. The language model generates improvised narrative prose, atmospheric descriptions, and character dialogue. The machine enforces spatial topology, character knowledge boundaries, acoustic physics, and somatic trauma. If a proposal violates the causal facts of the world, the engine rejects it—preserving canonical state and leaving an immutable diagnostic receipt.

---

## Architectural Pillars

- **Neuro-Symbolic Runtime**: Ground-truth state (spatial topology, inventory, somatic trauma, relationship stances) lives in deterministic TypeScript ledgers and dual-store IndexedDB—completely decoupled from generative token probability.
- **Causal Topology Graph**: Space is a directed adjacency graph. Movement requires authorized connections. If two rooms are not connected, no character can cross between them, no matter how vividly the model hallucinates the passage.
- **Pure-Text Acoustic Engine**: Zero Web Audio or speech synthesizer dependencies. Soundscapes and vocalizations (spoken dialogue, *sotto voce* soliloquies, introspective monologue, intercom transmissions, and structural acoustic bleed through ductwork) are modeled via physical adjacency and rendered in evocative CRT typography.
- **Diegetic Pacing Governor & Clocks (Horror Grammar 2)**: Autonomous tension regulation using undulating cadence cycles (`RESPITE_AFTERMATH` &rarr; `SIMMERING_DREAD` &rarr; `MOUNTING_COMPLICATION` &rarr; `KINETIC_RUPTURE`), situated diegetic instruments, and impending countdown clocks that trigger threshold manifestations.
- **Opposition Cohort Autonomy (HG2 Series 2)**: Seat-based NPC opposition with deterministic behavior selection — no dice, no omniscient AI Director. Cohort members investigate, share findings, and escalate through `ONSET` &rarr; `DISCOVERY` &rarr; `CONFIRMATION` &rarr; `CONFRONTATION` phases based solely on what they have diegetically perceived.
- **Deterministic Death Mechanics**: A wound ledger tracks mechanism, location, severity, timeline, and treatability for every character. After each committed turn the engine ingests wound and treatment proposals, validates treatment (the wound exists, is still open, and the treater is co-located), evaluates survivability against the fictional-time clock, and declares death as a deterministic causal fact. The model narrates the already-declared death; it never decides mortality. POV death ends the run with a generated Chronicle; retake restores the exact pre-death checkpoint.
- **Self-Preservation & Death Awareness (HG3)**: Characters feel their wounds. A two-layer salience system (fast spike, slow dread with residue ratchet) crosses canonical wound facts into felt character knowledge, projected into deterministic somatic tokens and threat-typed behavior modulation. Terrified cohorts go myopic, enter reversible prey mode, emit panic traces, and may SUBMIT — while human player intent is never reweighted, overridden, or vetoed by fear.
- **Deterministic Routines & Drift (HG4 Packet 4)**: Character routines are machine commits on the fictional clock. Due routines evaluate in fixed `routineId` order with cadence-driven firing (`firstFireMinutes`, `periodMinutes`) and computed drift from fired modifiers; blocked steps emit skipped reason codes — disruption is state, not failure. World predicates back the evaluation, and a headless probe harness verifies the Phase 1 acceptance bar.
- **Deterministic Discovery & Observer-Gated Tells (Discovery D1–D5)**: `DISCOVERY` is a fourth canonical consequence domain feeding `discoveredClueIds`. Placed clue objects live on topology nodes (`topology.nodeDefinitions[].clues`) and are discovered deterministically, emitting `clueDiscoveryReceipt`s. `computeObserverSet` derives co-located witnesses as a pure function of state; authored `distractionTells` render into the story log and engine-message blocks only when observers exist — authored → proposed → none precedence with deterministic selection — keeping the shared transcript and mechanical knowledge split.
- **Multi-Villain Engine (HG4 Packets B2–B5)**: Scenarios can field one to three villains, each carrying a distinct operational profile (apparatus controls, directives, telemetry feeds) and an authored cast persona. Villains hold deterministic relationship state toward each other — SUSPICION, FEAR, LOYALTY, DOMINANCE — seeded from RELATIONSHIP-holder anchors and rendered into the villain prompt as a dynamics block. SUBMIT resolves to the nearest perceiving villain (same node beats adjacent; roster order breaks ties), and each villain enforces its own binding submit-response contract (ACCEPT, REJECT, PUNISH, IGNORE). Salience is attributed per villain: wound and death events carry both actual and perceived source, so the somatic prompt names the right monster.
- **Aggressive Autopilot v1.1**: Three headless run modes through the identical validation and ratification pipeline as live play. *Standard* (default) is byte-locked to a frozen baseline fixture; *Aggressive* injects mechanics-envelope action proposals and seeks thresholds; *Adversarial* probes validation and invariants — rejections are passing tests, not failures. A refusal budget of 3 per run (the 4th aborts) applies to all modes; envelope numbers are generated from code constants, never hand-tuned.
- **Seed State v1 — The Opening Tableau Is Authored**: The blueprint says what exists; the seed says what's happening when the story starts. Every cast member carries a per-character opening seed (`where`, `doing`, `condition`, `charge`, `knows`, `wants`, `bonds`); the user character gets `circumstance` + `inclination` instead of `wants`. Seeds apply deterministically at session init — scenario-level opening restraints and locks first, then per-character in cast order — with `SEED` provenance on every write and somatic dread floors pinned to the fear contract's band constants. The Forge compiler validates seeds (no bilocation, active verbs require restraint-capable limbs, opposition pursuits must ground in cited character knowledge), and legacy blueprints receive idempotent neutral-seed backfill.
- **Forge Questionnaire Pipeline (HG4 Packets C2/C4/C5/C6)**: Scenario drafts are extracted from source documents in two stages. Stage 1 runs per-battery questionnaires (SEED, TOPOLOGY, VILLAIN, RELATIONSHIPS, OBJECTS, PRESSURE, DEPICTION); every factual claim must carry an inline `CITE:` excerpt quoting its source span. Stage 2 compiles each battery into schema-validated candidates — any battery with an uncited claim is rejected before compilation. Required-battery → required-candidate validation is enforced both at extraction and at draft application.
- **Universal Streaming & Forensic Sweep Engine**: Real-time Server-Sent Events (SSE) presentation transport for turns and multi-window forensic induction sweeps with sentence-snapped boundary planning (`W1/1` support) and review-preserving candidate mergers.
- **Universal Calibration Overlay**: Pinned non-destructive AI Calibration modal accessible across all views (`Hub`, `Engine`, `Forge`) without disrupting active simulation or drafting state.
- **Strict Model Agnosticism**: Runs identically on local models via private inference servers (LM Studio, Ollama, llama.cpp, etc.) or frontier cloud APIs (Google Gemini, OpenAI, Z.ai GLM, Hemmingway.io). Each subsystem can calibrate to an independent model.

---

## The Three Nodes

| Node | Purpose | Authority |
| :--- | :--- | :--- |
| **`THE FORGE`** | Authoring & Haunted House Induction. Import screenplays, manuscripts, or raw lore into perspective-neutral Blueprints with verified cast profiles, topological rooms, forensic sweep induction, and depiction contracts. | Write / Author |
| **`THE ENGINE`** | The simulation runtime. Evaluates player or Autopilot actions through atomic 5-stage causal ratification (Snapshot &rarr; Constrained Generation &rarr; Causal Ratification &rarr; Atomic Commit / Fail-Close &rarr; CRT Presentation). Supports live SSE streaming. | Authoritative Runtime |
| **`THE VOICE`** | The out-of-character analytical companion and research oracle. Explains receipts, examines source evidence, inspects live telemetry, and surfaces narrative contradictions. | Strictly Read-Only |

---

## Choose Your Seat

Role selection in The Terror Machine is an authoritative causal contract:

- **Survivor (`survivor` / `protagonist`)**: Situated mortal flesh. Bound by narrow sensory horizons, locked doors, trauma triggers, and physiological limits.
- **Villain (`villain` / `antagonist`)**: The stalking threat — one to three per scenario, each with a distinct operational profile and persona. Governed by authored authority contracts and counterplay boundaries; controls scenario apparatus (hydraulics, environmental grids) to corner an autonomous prey cohort. Villains perceive each other through deterministic relationship state (suspicion, fear, loyalty, dominance), and each enforces its own submit-response contract.
- **Bystander (`bystander` / `witness`)**: Trapped in the periphery (custodian, technician). High vulnerability, narrow agency, zero plot armor.
- **Director (`director`)**: Outside the flesh. Adjusts atmospheric pressure, triggers structural decay, and stages encounters without usurping participant agency.

In **villain-protagonist scenarios**, the seats invert: the protagonist seat binds the villain, and the antagonist seat rebinds to the opposition investigating them — the story told from inside the monster, with pressure splitting into external *Discovery* (the pursuit) and internal *Compulsion* (the hunger).

---

## Three Canonical Scenarios

1. **The Black Iron Mortuary**: Subterranean gothic bio-containment facility. 6 chambers, 4 cast members, and the predatory architectural entity *Entity-41*.
2. **The Silver Rest Lodge**: February 1991 alpine social horror. 7 topological chambers, 8 cast members across survivor, villain, and bystander roles, 3 impending environmental clocks, and 4 causal milestone gates.
3. **The Refinement**: High-intensity psychological ordeal inspired by the New French Extreme. 8 chambers, 8 cast members with granular psychological breaking points, and dual TIME/EVENT impending clocks.

---

## Quickstart

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/tgothe418/The-Terror-Machine.git
cd The-Terror-Machine

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

### 2. Provider Setup

- **Zero-Token Local Play (Recommended)**:
  Start any OpenAI-compatible server (e.g., LM Studio, Ollama, llama.cpp at `http://localhost:1234/v1`). Open **AI Calibration** in the top-left cogwheel, select **Local**, enter your endpoint, and click **Discover Models**.
- **Cloud Providers**:
  Add keys to `.env` or configure them dynamically in the persistent AI Calibration modal:
  `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ZAI_API_KEY`, or `HEMMINGWAY_API_KEY`.

### 3. Launch

```bash
# Start development server
npm run dev

# Run full test suite (166 test files, 2,393 tests)
npm test
```

---

## The Laws of the House

1. **Canon Belongs to the Application, Not the Weights**: The model improvises narrative; the application owns truth.
2. **A Proposal is Not a Commit**: Every token passes through schema validation. Invalid proposals fail closed without mutating world state.
3. **Topology is Causal, Not Prose**: Physical passage requires an authorized connection on the directed spatial graph.
4. **Situated Epistemic Isolation**: Knowledge is grounded in space and time. No character possesses telepathic omniscience.
5. **The User Owns Intent**: Refusals, errors, and timeouts fail cleanly with diagnostic receipts—never by fabricating synthetic player actions.
6. **Opposition is Diegetic**: Adversaries act only on what they have perceived through the world. There is no omniscient director; no information about the opposition reaches the player except through the world itself.
7. **Death Is Declared, Not Narrated**: The machine declares death from wound and circumstance facts. The model narrates the already-committed fact and never decides mortality.
8. **The Opening Tableau Is Authored, Not Improvised**: Seed State pins where every character starts, what they're doing, their condition, and what they know — applied deterministically before turn one. The engine never improvises an opening.

---

## License

Released under the [MIT License](./LICENSE).
