# Cap-Semantics Conformance Table

This document specifies the authoritative cap semantics and overflow behaviors for all exported `MAX_*` and `*_LIMIT` constants across `src/lib` and `src/types` within the Terror Machine engine.

## Overview

The engine enforces state boundaries and input budgets through explicit cap constants. Overflow handling follows one of four deterministic behaviors:
- **`clamp`**: Values or collections exceeding the cap are clamped or sliced to the maximum allowed limit.
- **`reject`**: Inputs, proposals, or states exceeding the cap are rejected (e.g. throwing a Zod validation error or emitting a `REJECTED` decision outcome).
- **`truncate`**: String values exceeding the cap are truncated to the maximum allowed length via `slice` or preprocessor.
- **`ignore`**: Unreferenced or unconstrained constants whose overflow is not actively enforced (`Enforcement Site(s): none`).

At baseline audit, all 40 declarations (39 unique constant names across 14 files) are referenced and enforced; there are 0 orphaned constants.

## Conformance Table

| Constant Name | Declaration File | Value | Enforcement Site(s) | Overflow Behavior |
| --- | --- | --- | --- | --- |
| MAX_OFFSCREEN_PURSUITS_PER_TURN | src/lib/castActivityEligibility.ts | 2 | src/lib/castActivityEligibility.ts:309-310 | clamp |
| MAX_SKEPTICISM | src/lib/castContinuity.ts | 1 | src/lib/castContinuity.ts:25 | clamp |
| MAX_SKEPTICISM_DELTA | src/lib/castContinuity.ts | 0.15 | src/lib/castContinuity.ts:30-33 | clamp |
| MAX_DEVELOPMENT_FACTS_PER_CHARACTER | src/lib/characterDevelopment.ts | 6 | src/lib/characterDevelopment.ts:97 | reject |
| MAX_VALIDATION_ISSUES | src/lib/extractionContract.ts | 50 | src/lib/sourceBaseline.ts:821, 1448 | clamp |
| MAX_ISSUE_MESSAGE_LENGTH | src/lib/extractionContract.ts | 300 | src/lib/extractionContract.ts:894 | truncate |
| MAX_ISSUE_LABEL_LENGTH | src/lib/extractionContract.ts | 100 | src/lib/extractionContract.ts:885, 890 | truncate |
| MAX_ISSUE_FIELD_PATH_LENGTH | src/lib/extractionContract.ts | 200 | src/lib/extractionContract.ts:893 | truncate |
| MAX_ALLOWED_VALUES_COUNT | src/lib/extractionContract.ts | 20 | src/lib/extractionContract.ts:897 | clamp |
| REFERENCE_IMPORT_JSON_LIMIT | src/lib/referenceImportPolicy.ts | '28mb' | server/app.ts:40, server/routes/extractBlueprint.test.ts:60 | reject |
| MAX_HAUNTED_HOUSE_PREMISE_LENGTH | src/types/adLib.ts | 1000 | src/types/adLib.ts:18-20, 55-57, 73-75; src/components/engine/AdLibInductionModal.tsx:613, 628 | reject |
| MAX_CHARACTER_MEMORY_PROPOSALS | src/types/characterMemory.ts | 2 | src/types/characterMemory.ts:41 | reject |
| MAX_MEMORIES_PER_CHARACTER | src/types/characterMemory.ts | 24 | src/lib/characterMemory.ts:77, 252 | reject |
| MAX_CHARACTER_MEMORY_FACT_LENGTH | src/types/characterMemory.ts | 200 | src/types/characterMemory.ts:18, 33; src/lib/characterMemory.ts:62 | reject |
| MAX_CHARACTER_MEMORY_RATIONALE_LENGTH | src/types/characterMemory.ts | 240 | src/types/characterMemory.ts:36 | reject |
| MAX_RELATIONSHIP_CHANGES_PER_TURN | src/types/characterRelationships.ts | 2 | src/types/characterRelationships.ts:61 | reject |
| MAX_CHARACTER_RELATIONSHIPS | src/types/characterRelationships.ts | 48 | src/types/characterRelationships.ts:44; src/lib/characterRelationships.ts:57, 201 | reject |
| MAX_RELATIONSHIP_RATIONALE_LENGTH | src/types/characterRelationships.ts | 240 | src/types/characterRelationships.ts:52 | reject |
| MAX_STANCE_CHANGES_PER_TURN | src/types/characterStance.ts | 2 | src/types/characterStance.ts:44 | reject |
| MAX_STANCE_RATIONALE_LENGTH | src/types/characterStance.ts | 240 | src/types/characterStance.ts:39 | reject |
| MAX_CONSEQUENCE_MUTATIONS | src/types/consequence.ts | 4 | src/types/consequence.ts:61 | reject |
| MAX_INVENTORY_ITEMS | src/types/consequence.ts | 24 | src/types/consequence.ts:66; src/lib/canonicalConsequences.ts:37, 202 | reject |
| MAX_PLAYER_INJURIES | src/types/consequence.ts | 12 | src/types/consequence.ts:67; src/lib/canonicalConsequences.ts:54, 252 | reject |
| MAX_CONSEQUENCE_LABEL_LENGTH | src/types/consequence.ts | 120 | src/types/consequence.ts:23, 31, 47, 66, 67 | reject |
| MAX_CONSEQUENCE_RATIONALE_LENGTH | src/types/consequence.ts | 240 | src/types/consequence.ts:24, 32, 40, 48 | reject |
| MAX_VALIDATION_ISSUES | src/types/forge.ts | 50 | src/types/forge.ts:1188 | reject |
| MAX_RECENT_ACTIVITY_EVENTS | src/types/horrorGrammar.ts | 10 | src/lib/castActivity.ts:394; src/lib/buildEngineTurnContext.ts:624; src/types/horrorGrammar.ts:876 | clamp |
| MAX_ACTIVE_PRESSURE_THREADS | src/types/horrorGrammar.ts | 5 | src/lib/situatedPressure.ts:359; src/types/horrorGrammar.ts:877; src/lib/buildEngineTurnContext.ts:627 | reject |
| MAX_VALUE_STATE_CHANGES_PER_TURN | src/types/horrorGrammar.ts | 3 | src/types/horrorGrammar.ts:603 | reject |
| MAX_CHARACTER_PURSUIT_CHANGES_PER_TURN | src/types/horrorGrammar.ts | 2 | src/types/horrorGrammar.ts:695-697 | reject |
| MAX_CHARACTER_DEVELOPMENT_CHANGES_PER_TURN | src/types/horrorGrammar.ts | 2 | src/types/horrorGrammar.ts:783-785 | reject |
| MAX_PRESSURE_THREAD_TRANSITIONS_PER_TURN | src/types/horrorGrammar.ts | 2 | src/types/horrorGrammar.ts:837-839 | reject |
| MAX_AUTHORITY_LENGTH | src/types/participation.ts | 2500 | src/types/participation.ts:54, 60 | truncate |
| MAX_SEAT_ABILITY_LENGTH | src/types/participation.ts | 2500 | src/types/participation.ts:38, 39 | truncate |
| MAX_SEAT_LIMITATION_LENGTH | src/types/participation.ts | 2500 | src/types/participation.ts:42, 65 | truncate |
| MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH | src/types/participation.ts | 1000 | src/types/participation.ts:145; src/lib/seatAvailability.ts:319, 344, 355, 397 | truncate |
| MAX_WORLD_MEMORY_CANDIDATES | src/types/worldMemory.ts | 2 | src/types/worldMemory.ts:87; src/lib/worldMemory.ts:265 | reject |
| MAX_WORLD_MEMORY_ENTRIES | src/types/worldMemory.ts | 64 | src/types/worldMemory.ts:54; src/lib/worldMemory.ts:135, 373 | reject |
| MAX_WORLD_MEMORY_STATEMENT_LENGTH | src/types/worldMemory.ts | 240 | src/types/worldMemory.ts:28, 62; src/lib/worldMemory.ts:100 | reject |
| MAX_WORLD_MEMORY_RATIONALE_LENGTH | src/types/worldMemory.ts | 240 | src/types/worldMemory.ts:63 | reject |

## Constant Semantics Details

1. **`MAX_OFFSCREEN_PURSUITS_PER_TURN` (2)**: In `selectCastActivityEligibility`, candidate offscreen pursuits are ranked and sliced to at most 2 entries (`dueCandidates.slice(0, MAX_OFFSCREEN_PURSUITS_PER_TURN)`). Additional due candidates are preserved in `boundedOutPursuitIds` on the eligibility receipt (`clamp`).
2. **`MAX_SKEPTICISM` (1)**: Upper bound for character skepticism, clamped in `clampSkepticism` via `Math.min(MAX_SKEPTICISM, ...)` (`clamp`).
3. **`MAX_SKEPTICISM_DELTA` (0.15)**: Per-turn skepticism delta limit, clamped in `clampSkepticismDelta` via `Math.min(MAX_SKEPTICISM_DELTA, Math.max(-MAX_SKEPTICISM_DELTA, value))` (`clamp`).
4. **`MAX_DEVELOPMENT_FACTS_PER_CHARACTER` (6)**: In `resolveCharacterDevelopment`, when active facts reach 6, establishing an additional fact is rejected with `outcome: 'REJECTED'` and `reasonCode: 'MAX_FACTS_PER_CHARACTER_REACHED'` (`reject`).
5. **`MAX_VALIDATION_ISSUES` (`src/lib/extractionContract.ts`, 50)**: In `sourceBaseline.ts`, issues collection stops pushing once 50 issues are collected, and the final output array is clamped via `.slice(0, MAX_VALIDATION_ISSUES)` (`clamp`).
6. **`MAX_ISSUE_MESSAGE_LENGTH` (300)**: In `buildCandidateValidationIssue`, error messages are truncated to 300 characters via `.slice(0, MAX_ISSUE_MESSAGE_LENGTH)` (`truncate`).
7. **`MAX_ISSUE_LABEL_LENGTH` (100)**: In `buildCandidateValidationIssue`, target and label strings are truncated to 100 characters via `.slice(0, MAX_ISSUE_LABEL_LENGTH)` (`truncate`).
8. **`MAX_ISSUE_FIELD_PATH_LENGTH` (200)**: In `buildCandidateValidationIssue`, fieldPath strings are truncated to 200 characters via `.slice(0, MAX_ISSUE_FIELD_PATH_LENGTH)` (`truncate`).
9. **`MAX_ALLOWED_VALUES_COUNT` (20)**: In `buildCandidateValidationIssue`, allowedValues arrays are sliced to at most 20 elements via `.slice(0, MAX_ALLOWED_VALUES_COUNT)` (`clamp`).
10. **`REFERENCE_IMPORT_JSON_LIMIT` ('28mb')**: In Express server configuration, `express.json({ limit: REFERENCE_IMPORT_JSON_LIMIT })` rejects incoming request bodies larger than 28MB with HTTP 413 (`reject`).
11. **`MAX_HAUNTED_HOUSE_PREMISE_LENGTH` (1000)**: Zod schema validation enforces string length at most 1,000 characters; longer inputs fail schema validation (`reject`).
12. **`MAX_CHARACTER_MEMORY_PROPOSALS` (2)**: Zod schema rejects memory proposals with more than 2 candidate proposals (`reject`).
13. **`MAX_MEMORIES_PER_CHARACTER` (24)**: Memory proposals for a character who already has 24 memories are rejected with `outcome: 'REJECTED'` and `reason: 'STATE_LIMIT'` (`reject`). Pre-state sanitizer drops excess entries.
14. **`MAX_CHARACTER_MEMORY_FACT_LENGTH` (200)**: Zod schema rejects facts longer than 200 characters; sanitizer drops facts exceeding limit (`reject`).
15. **`MAX_CHARACTER_MEMORY_RATIONALE_LENGTH` (240)**: Zod schema rejects proposals with rationale longer than 240 characters (`reject`).
16. **`MAX_RELATIONSHIP_CHANGES_PER_TURN` (2)**: Zod schema rejects proposals with more than 2 relationship changes per turn (`reject`).
17. **`MAX_CHARACTER_RELATIONSHIPS` (48)**: Zod schema rejects relationship ledgers with more than 48 entries; resolver rejects new relationship formation exceeding cap with `STATE_LIMIT` (`reject`).
18. **`MAX_RELATIONSHIP_RATIONALE_LENGTH` (240)**: Zod schema rejects relationship changes with rationale longer than 240 characters (`reject`).
19. **`MAX_STANCE_CHANGES_PER_TURN` (2)**: Zod schema rejects stance proposals with more than 2 changes per turn (`reject`).
20. **`MAX_STANCE_RATIONALE_LENGTH` (240)**: Zod schema rejects stance change proposals with rationale longer than 240 characters (`reject`).
21. **`MAX_CONSEQUENCE_MUTATIONS` (4)**: Zod schema rejects consequence proposals with more than 4 mutations (`reject`).
22. **`MAX_INVENTORY_ITEMS` (24)**: Zod schema rejects inventory arrays exceeding 24 items; consequence resolver rejects additions exceeding cap with `STATE_LIMIT` (`reject`).
23. **`MAX_PLAYER_INJURIES` (12)**: Zod schema rejects player injury arrays exceeding 12 items; consequence resolver rejects additions exceeding cap with `STATE_LIMIT` (`reject`).
24. **`MAX_CONSEQUENCE_LABEL_LENGTH` (120)**: Zod schema rejects consequence mutation values exceeding 120 characters (`reject`).
25. **`MAX_CONSEQUENCE_RATIONALE_LENGTH` (240)**: Zod schema rejects consequence mutation rationales exceeding 240 characters (`reject`).
26. **`MAX_VALIDATION_ISSUES` (`src/types/forge.ts`, 50)**: Zod schema rejects `validationIssues` arrays exceeding 50 entries (`reject`).
27. **`MAX_RECENT_ACTIVITY_EVENTS` (10)**: Runtime history slices to keep only the latest 10 events via `.slice(-MAX_RECENT_ACTIVITY_EVENTS)` (`clamp`). Zod schema validates max 10.
28. **`MAX_ACTIVE_PRESSURE_THREADS` (5)**: In `resolveSituatedPressureProposal`, requests to open new pressure threads when 5 threads are already active are rejected with `outcome: 'REJECTED'` and `reasonCode: 'MAX_PRESSURE_THREADS_REACHED'` (`reject`).
29. **`MAX_VALUE_STATE_CHANGES_PER_TURN` (3)**: Zod schema rejects value state proposals with more than 3 changes (`reject`).
30. **`MAX_CHARACTER_PURSUIT_CHANGES_PER_TURN` (2)**: Zod schema rejects character pursuit proposals with more than 2 changes (`reject`).
31. **`MAX_CHARACTER_DEVELOPMENT_CHANGES_PER_TURN` (2)**: Zod schema rejects character development proposals with more than 2 changes (`reject`).
32. **`MAX_PRESSURE_THREAD_TRANSITIONS_PER_TURN` (2)**: Zod schema rejects pressure thread transition proposals with more than 2 transitions (`reject`).
33. **`MAX_AUTHORITY_LENGTH` (2500)**: Preprocessor truncates authority descriptions exceeding 2,500 characters via `val.trim().slice(0, MAX_AUTHORITY_LENGTH)` (`truncate`).
34. **`MAX_SEAT_ABILITY_LENGTH` (2500)**: Preprocessor truncates seat ability descriptions exceeding 2,500 characters via `val.trim().slice(0, MAX_SEAT_ABILITY_LENGTH)` (`truncate`).
35. **`MAX_SEAT_LIMITATION_LENGTH` (2500)**: Preprocessor truncates limitation descriptions exceeding 2,500 characters via `val.trim().slice(0, MAX_SEAT_LIMITATION_LENGTH)` (`truncate`).
36. **`MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH` (1000)**: Descriptions bound to participation seats are truncated to 1,000 characters via `.slice(0, MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH)` (`truncate`).
37. **`MAX_WORLD_MEMORY_CANDIDATES` (2)**: Zod schema rejects world memory proposals with more than 2 candidates (`reject`).
38. **`MAX_WORLD_MEMORY_ENTRIES` (64)**: Zod schema rejects world memory ledgers exceeding 64 entries; resolver rejects new additions with `STATE_LIMIT` when full (`reject`).
39. **`MAX_WORLD_MEMORY_STATEMENT_LENGTH` (240)**: Zod schema rejects world memory statements longer than 240 characters (`reject`).
40. **`MAX_WORLD_MEMORY_RATIONALE_LENGTH` (240)**: Zod schema rejects world memory candidate rationales longer than 240 characters (`reject`).
