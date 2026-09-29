import { DEFAULT_FEAR_CONTRACT } from '../../src/types/fear';

export const MECHANICS_REFERENCE_MARKDOWN = `# The Terror Machine — Horror Grammar (HG2/HG3/HG4) Invariants Reference

This document codifies the deterministic mechanics, psychological invariants, and causal containment contracts governing The Terror Machine.

---

## 1. Core Philosophy: Machine Decides Shape, Model Decides Texture
- **Shape (Authoritative Mechanics):** Discrete wounds, survivability verdicts, spatial topology, somatic bands, cognitive dissonance, and causal consequences are strictly computed by the deterministic Machine. The LLM cannot mutate state or dictate outcomes directly.
- **Texture (Diegetic Narration):** The LLM receives structural constraints and somatic tokens, rendering sensory prose and atmospheric fidelity without leaking internal ledger counters, HUD numbers, or probabilities.
- **Strict Determinism:** Zero PRNG, zero seeded dice rolls, zero random timestamps. Identical state transitions yield identical mechanical results.

---

## 2. Fear Engine & Somatic Invariants
### 2.1 Two-Layer Salience: Fast Phasic Spike & Slow Ratcheting Dread
- **Fast Spike Layer:** Captures acute shock, sudden jumpscares, or localized trauma. Bounded in [0.0, 1.0].
- **${(DEFAULT_FEAR_CONTRACT.residueRatio * 100).toFixed(0)}% Residue Ratchet (${DEFAULT_FEAR_CONTRACT.residueRatio.toFixed(2)}):** When the phasic spike decays (decay rate: ${DEFAULT_FEAR_CONTRACT.lambdaDecay.toFixed(2)}), exactly **${(DEFAULT_FEAR_CONTRACT.residueRatio * 100).toFixed(0)}%** (ratio: ${DEFAULT_FEAR_CONTRACT.residueRatio.toFixed(2)}) of the decayed magnitude converts permanently into the tonic dread layer.
- **Tonic Dread Layer:** Monotonically ratchets throughout the ordeal, representing irreversible psychological attrition and lingering dread. Bounded in [0.0, 1.0].

### 2.2 Reversible Prey-Mode Hysteresis (${DEFAULT_FEAR_CONTRACT.preyEnterThreshold.toFixed(2)} / ${DEFAULT_FEAR_CONTRACT.preyExitThreshold.toFixed(2)})
- **Engagement Threshold:** When a character's combined fear-response intensity reaches or exceeds **${DEFAULT_FEAR_CONTRACT.preyEnterThreshold.toFixed(2)}**, the character enters \`PREY_MODE\`. Under prey mode, the behavioral verb consideration set collapses to reflexive survival options (\`FLEE\`, \`HIDE\`, \`FORTIFY\`, \`SUBMIT\`).
- **Disengagement Floor:** Prey mode exhibits strict hysteresis. It does **not** disengage when intensity falls below ${DEFAULT_FEAR_CONTRACT.preyEnterThreshold.toFixed(2)}. It requires intensity to drop below **${DEFAULT_FEAR_CONTRACT.preyExitThreshold.toFixed(2)}** before proactive, deliberative verbs can re-enter the executable consideration set.

### 2.3 Somatic Bands & Physiological Directives
Fear-response intensity maps deterministically to 5 closed Somatic Bands:
- **Band 0 (Baseline, < ${DEFAULT_FEAR_CONTRACT.somaticBands.band1.toFixed(2)}):** Equilibrium. No somatic tokens injected.
- **Band 1 (Heightened Arousal, ${DEFAULT_FEAR_CONTRACT.somaticBands.band1.toFixed(2)} - ${DEFAULT_FEAR_CONTRACT.somaticBands.band2.toFixed(2)}):** Mild autonomic arousal: \`TACHYCARDIA\`, \`PUPIL_DILATION\`, \`RAPID_BREATHING\`.
- **Band 2 (Acute Stress, ${DEFAULT_FEAR_CONTRACT.somaticBands.band2.toFixed(2)} - ${DEFAULT_FEAR_CONTRACT.somaticBands.band3.toFixed(2)}):** Sympathetic surge: \`HAND_TREMOR\`, \`COLD_SWEAT\`, \`PERIPHERAL_VASOCONSTRICTION\`.
- **Band 3 (Terror / Tunnel Vision, ${DEFAULT_FEAR_CONTRACT.somaticBands.band3.toFixed(2)} - ${DEFAULT_FEAR_CONTRACT.somaticBands.band4.toFixed(2)}):** Extreme shock: \`TUNNEL_VISION\`, \`AUDITORY_EXCLUSION\`, \`PILOMOTOR_ERECTION\`, \`DISSOCIATION\`. External world cues are degraded; acoustic scream traces are emitted.
- **Band 4 (Catatonic / Agonal Shock, >= ${DEFAULT_FEAR_CONTRACT.somaticBands.band4.toFixed(2)}):** Systemic shutdown: \`CATATONIA\`, \`HYPERVENTILATION\`, \`LOSS_OF_MOTOR_CONTROL\`, \`VOCAL_PARALYSIS\`.
Somatic floors: ${DEFAULT_FEAR_CONTRACT.somaticBands.band1.toFixed(2)} / ${DEFAULT_FEAR_CONTRACT.somaticBands.band2.toFixed(2)} / ${DEFAULT_FEAR_CONTRACT.somaticBands.band3.toFixed(2)} / ${DEFAULT_FEAR_CONTRACT.somaticBands.band4.toFixed(2)} (${DEFAULT_FEAR_CONTRACT.somaticBands.band1.toFixed(2)}/${DEFAULT_FEAR_CONTRACT.somaticBands.band2.toFixed(2)}/${DEFAULT_FEAR_CONTRACT.somaticBands.band3.toFixed(2)}/${DEFAULT_FEAR_CONTRACT.somaticBands.band4.toFixed(2)}).

### 2.4 Prose Fear Texture Directives (0.60 Threshold)
- **SPIKE Dominance (Spike Share >= 0.60):** Prose emphasizes sharp, visceral, localized trauma; sudden sensory interrupts; involuntary micro-movements.
- **DREAD Dominance (Spike Share <= 0.40):** Prose emphasizes heavy, atmospheric weight; time slows; fixation on mundane, threatening details.
- **BLENDED (0.40 < Spike Share < 0.60):** Dual textural directives combined without leaking numerical ratios.

---

## 3. The SUBMIT Contract (§5.4)
- **Two-Step Temporal Cadence:**
  - **Turn N (Initiation):** An overwhelmed character initiates \`SUBMIT\`. Stance immediately locks to \`SUBMITTED\`, and acoustic/social pleas are emitted.
  - **Turn N+1 (Evaluation):** The antagonist evaluates the plea against the authored submission response contract:
    - **Spatial Perception Check:** The antagonist must share the same node or an unobstructed adjacent node with open acoustic linkage. If unperceived, the stance persists without crash (\`UNPERCEIVED\`).
    - **Sovereignty Rule:** If the antagonist is a human player, an explicit choice prompt payload is presented (\`AWAITING_HUMAN_CHOICE\`).
    - **Autonomous Policy:** Autonomous NPC villains resolve deterministically to authored outcomes: \`ACCEPT\`, \`REJECT\`, \`PUNISH\`, or \`IGNORE\` (default: \`REJECT\`).

---

## 4. Deterministic Death Subsystem (§5, §15)
- **Single Choke Point:** Every death in The Terror Machine must pass through \`declareDeath()\`. Zero spontaneous or LLM-invented deaths.
- **Wound Severities:** Bounded to 4 closed ordinals: \`minor\`, \`serious\`, \`grave\`, \`unsurvivable\`.
- **Wound Fact Ledger:** Deterministic identifiers \`characterId:wSeq\`, recording mechanism, location, severity, deadline timeline, and treatability.
- **Survivability Evaluation:** Evaluated against fictional time elapsed, co-located first aid interventions, and available signal/witness circumstance facts.
- **Post-Mortem Transitions:**
  - Emits Corpse Evidence Node into spatial graph.
  - Triggers succession vulnerability window if the decedent held the cohort seat.
  - Injects cohort disruption shock (+0.3 skepticism, +0.5 cognitive dissonance).
  - Triggers witness trauma in living co-present cast members.

---

## 5. HG4 Physical Mechanics & World-Object Model
### 5.1 Restraint as a Mechanic
- **System Description:** Physical containment of characters and spatial locks tracked in \`RestraintLedger\`.
- **Restraint Levels:** \`UNRESTRAINED\`, \`WRISTS_BOUND_FRONT\`, \`WRISTS_BOUND_BEHIND\`, \`TIED_TO_FIXTURE\`, \`FULL_HOGTIE\`.
- **Thresholds & Invariants:**
  - Bound wrists restrict fine physical verbs (manipulation, tool use, key turning).
  - \`TIED_TO_FIXTURE\` and \`FULL_HOGTIE\` enforce complete locomotion impairment (\`LOCOMOTION_NORMAL\`, \`LOCOMOTION_RAPID\`) preventing node transitions.
  - Spatial lock states (\`EDGE\`, \`CONTAINER\`) require matching \`keyObjectId\` in possession to toggle.
- **Agent Testing Directive:** Test binding transitions, escape attempts, locomotion while bound, and lock bypass without key possession.

### 5.2 World-Object Containment & Reach
- **System Description:** Physical existence and accessibility of items across nodes, containers, and carriers in \`WorldObjectLedger\`.
- **Object Sizes:** \`LIGHT\`, \`STANDARD\`, \`HEAVY\`.
- **Calculus & Invariants:**
  - Strict hierarchical containment: \`NODE\`, \`CONTAINER\`, or \`CARRIER\`.
  - Reach rule: Objects within containers require the container to be in \`OPEN\` state to be in reach.
  - Cycle prevention: Objects cannot be placed inside themselves or nested within child containers.
  - Deterministic verbs: \`PICKUP\`, \`DROP\`, \`PLACE_IN\`, \`OPEN\`, \`CLOSE\`, \`UNLOCK\`.
- **Agent Testing Directive:** Attempt interacting with items in closed/locked containers, exceed carry limits, create containment loops, or reach objects across inaccessible nodes.

### 5.3 Attention as NPC State
- **System Description:** NPC-specific cognitive orientation and focus tracked via \`AttentionLedger\` with lapse durations and distractibility ratings.
- **Invariants & Gates:**
  - Invariant 6: Attention is strictly NPC state. Player characters never receive attention mutations.
  - Deterministic transitions: \`CAPTURE\` (focus on in-reach target), \`RELEASE\` (clears target), \`DISTRACT\` (initiates lapse timer).
  - Joint coverage gate: Unobserved player actions require captor attention to be averted or captor to be under an active lapse (\`isActionUnobserved\`).
- **Agent Testing Directive:** Engineer deliberate sensory distractions, exploit attention lapse timers, and attempt stealth actions under captor gaze vs distraction.

### 5.4 Routines, Cadence, and Deterministic Drift
- **System Description:** Fictional-clock scheduled NPC activities and patrol routes tracked in \`RoutineLedger\`.
- **Calculus & Invariants:**
  - Cadence: Defined by \`periodMinutes\`, \`firstFireMinutes\`, and \`phaseOffsetMinutes\`.
  - Machine commits: Routine ticks are machine-authoritative commits evaluated on turn transitions.
  - Deterministic drift: Computed via \`computeDrift\` based on co-location, restraint level, clock phase, and relationships.
  - Disruption handling: Physical restraint (\`RESTRAINT_BINDING\`) or impaired locomotion (\`CAPABILITY_IMPAIRED\`) skips physical movement while advancing step pointers.
  - Player seat immunity: Routines bound to player-controlled characters are skipped (\`PLAYER_SEAT\`).
- **Agent Testing Directive:** Intercept patrol schedules, bar physical pathways, exploit drift delays, and force routine disruptions.
`;
