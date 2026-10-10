# The Terror Machine — System Flowchart

How the machine fits together: the three nodes, the atomic turn, and the Forge pipeline.
Diagrams are [Mermaid](https://mermaid.js.org/) — GitHub renders them natively.

---

## 1. System overview — the three nodes

```mermaid
flowchart TB
    subgraph FORGE["THE FORGE — Authoring (write authority)"]
        SRC["Source material<br/>(screenplay, manuscript, lore)"]
        SWEEP["Forensic sweep<br/>(window planner, multi-lens induction)"]
        REVIEW["Candidate review<br/>(accept / reject / stage)"]
        DRAFT["Forge draft"]
        VALID["validateForgeDraft<br/>(villain-always, deathContract, fearContract,<br/>depiction contract, discovery spine audit)"]
        COMPILE["compileForgeDraft"]
        BP[("Blueprint<br/>(immutable JSON artifact)")]
        SRC --> SWEEP --> REVIEW --> DRAFT --> VALID --> COMPILE --> BP
    end

    subgraph ENGINE["THE ENGINE — Runtime (authoritative)"]
        CMD["Player / Autopilot command"]
        TURN["Atomic 5-stage turn lifecycle<br/>(see diagram 2)"]
        STATE[("Canonical state<br/>(Zustand + dual-store IndexedDB)")]
        CMD --> TURN --> STATE
    end

    subgraph VOICE["THE VOICE — Read-only companion"]
        Q["Questions, research,<br/>live telemetry"]
        A["Answers grounded in live state<br/>(never mutates canon)"]
        Q --> A
    end

    subgraph PROV["AI Calibration — provider switching"]
        MODELS["Gemini · OpenAI · Z.ai GLM<br/>Hemmingway · Local (LM Studio, Ollama, llama.cpp)"]
    end

    BP --> ENGINE
    STATE --> VOICE
    PROV --> FORGE
    PROV --> ENGINE
    PROV --> VOICE
```

**Reading it:** The Forge turns source material into an immutable Blueprint. The Engine runs the Blueprint — the model proposes, the machine decides, and canonical state persists across turns and reloads. The Voice reads that state to explain receipts and contradictions but can never change it. Every subsystem can point at a different provider through AI Calibration; the contracts stay identical.

---

## 2. The atomic turn — one command, one commit or fail-closed

```mermaid
flowchart TB
    CMD["Command in — human or Autopilot"]
    SNAP["1 · Snapshot — pre-turn checkpoint<br/>(retake-restorable)"]
    GEN["2 · Constrained generation — schema-projected JSON<br/>(the model proposes)"]
    RAT["3 · Causal ratification — topology, authority,<br/>HG1/HG2 validators, consequence domains (incl. DISCOVERY),<br/>wound & treatment proposals"]
    DEC{"Proposals valid?"}

    subgraph COMMIT["4 · Atomic commit — the Machine decides"]
        DEATH["Death pass — ingest wound facts,<br/>validate treatment, evaluate survivability,<br/>declareDeath on DEATH verdicts"]
        FEAR["Salience update — spike / dread,<br/>somatic tokens, prey-mode check"]
        COHORT["Cohort tick — deterministic<br/>behavior selection, no dice"]
        PACE["Pacing governor — cadence breath,<br/>impending clocks, milestone gates"]
        VOX["Vocalization & acoustic bleed<br/>(topology-gated)"]
        DEATH --> FEAR --> COHORT --> PACE --> VOX
    end

    FAILC["4b · Fail-closed — diagnostic receipt,<br/>zero state mutation"]
    CRT["5 · CRT presentation — SSE word-by-word streaming"]
    TERM{"POV dead?"}
    CHRON["Chronicle modal — commemorate the run,<br/>then retake or reset"]
    RETAKE["Retake — TURN_RETAKEN restores<br/>the exact pre-turn checkpoint"]

    CMD --> SNAP --> GEN --> RAT --> DEC
    DEC -->|yes| COMMIT --> CRT
    DEC -->|no| FAILC
    CRT --> TERM
    TERM -->|yes| CHRON --> RETAKE
    CRT -.->|"user invokes retake"| RETAKE
```

**Reading it:** Every turn is all-or-nothing. The machine snapshots first, so retake can always unwind to the exact pre-turn state. Generation is schema-constrained; ratification rejects anything that violates topology, authority, or causal law. The commit runs the deterministic subsystem passes in order — death, fear, cohort, pacing, voice — then the result streams to the CRT. If the POV character died, the run terminates into a Chronicle; death never seals the retake window.

---

## 3. The Forge pipeline — source material to immutable Blueprint

```mermaid
flowchart LR
    SRC["Source material"]
    INTAKE["Intake — parse & layout"]
    PLAN["Window planner —<br/>sentence-snapped windows"]
    SWEEP["Sweep orchestrator — multi-lens induction<br/>(topology · cast · atmosphere · unknowns)"]
    CAND["Candidates — evidence-backed,<br/>staged for review"]
    ARCH["Architect — ambiguity resolution<br/>(bounded Q&A with the author)"]
    DRAFT["Forge draft"]
    GATES{"validateForgeDraft"}
    COMP["compileForgeDraft"]
    ART[("Blueprint —<br/>immutable artifact")]

    SRC --> INTAKE --> PLAN --> SWEEP --> CAND --> ARCH --> DRAFT --> GATES
    GATES -->|pass| COMP --> ART
    GATES -->|fail| FIX["Author fixes the flagged gaps"]
    FIX --> DRAFT
```

**Compile gates** (all must pass — the compiler fails with a named error otherwise):

| Gate | Rule |
| :--- | :--- |
| Villain-always | Cast must contain at least one `VILLAIN` |
| `deathContract` | Required on every blueprint (`powerBudget` + `deathMetaphysics`; `seatSuccession` for cohort scenarios) |
| `fearContract` | Required on every blueprint (fearlessness, threat weights, somatic bands, submit responses, …) |
| Depiction contract | Strict contract shaping framing and directness |
| Topology closure | Spaces form a valid directed graph; movement needs authorized edges |
| Discovery spine audit | Milestone trigger regexes valid; trigger target phases are live; milestone IDs unique; every placed clue cross-referenced by a DISCOVERY milestone |

---

## Contracts the Engine enforces at runtime

Authored in the Forge, enforced by the machine — never the other way around:

- **`deathContract`** — the scenario's physics of dying: power budget, death metaphysics, per-seat succession.
- **`fearContract`** — the scenario's psychology of terror: fearlessness, mortality belief, threat weights, somatic bands, release valves, villain gaze authorization, submit responses.
- **Depiction contract** — how directly the scenario may be rendered; shapes framing, grants no causal authority.
- **Authority contracts** — what each entity is allowed to do; a thought-only antagonist gets no physical reach unless the contract grants it.
