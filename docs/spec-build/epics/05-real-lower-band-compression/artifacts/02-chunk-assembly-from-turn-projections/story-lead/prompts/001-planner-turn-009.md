# Story Lead Base Prompt

## Role Charter
You are the story lead for `02-chunk-assembly-from-turn-projections` on durable story run `02-chunk-assembly-from-turn-projections-story-run-001`.
Select exactly one bounded next action for this `resume` turn.
This is planner turn 9.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md
Bytes: 11866

# Story 2: Chunk Assembly From Turn Projections

### Summary
<!-- Jira: Summary field -->

Chunks use conversation-only Turn projection token counts for boundary decisions, assemble conversation-only transcripts, and block legacy placeholder-era state.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands.

**Objective:** After this story, Chunk membership decisions use the exact token count from the conversation-only Turn projection instead of full smooth text counts. Each Chunk assembles a conversation-only transcript from its Turn projections. Smooth text remains a separate representation. Existing closed Chunk membership is not silently rewritten. Legacy placeholder-era Chunk state is blocked from lower-band selection.

**Scope:**

In scope:
- Chunk boundary threshold evaluation uses projection token counts
- Conversation-only Chunk transcript assembled from Turn projections in Chunk order
- Smooth text remains available as a separate representation
- Detailed and brief share the same conversation-only Chunk transcript (brief is not derived from detailed)
- Closed Chunk membership not silently mutated
- Legacy/placeholder-era Chunk state blocked and distinguishable from new state
- `schemaVersion = "conversation_only_chunk_v1"` on new Chunk records

Out of scope:
- Semantic model judgment for Chunk boundaries (future)
- Separate Chunk groupings for detailed and brief
- Replacement of smooth text with the conversation-only transcript
- Polished migration of existing placeholder Chunk state
- Semantic compression of Chunk transcripts (Story 3)

**Dependencies:** Story 1 complete.

**Story type:** Adapter / mapping

**Governing idea:** Chunks group Turns using the count authority that matches the representation lower-band compression will consume.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-2.1:** Chunk boundary decisions use proper token counts from the conversation-only Turn projection.

- **TC-2.1a: Conversation-only count drives append decision**
  - Given: A current Chunk and a next Turn with a ready conversation-only projection
  - When: the steward evaluates whether to append the Turn
  - Then: the decision uses the proper token count for the Turn projection
- **TC-2.1b: Full smooth text count does not drive lower-band boundary**
  - Given: A tool-heavy Turn has large smooth text and small conversation-only projection text
  - When: Chunk assembly evaluates the Turn
  - Then: the boundary decision is based on the conversation-only projection count

**AC-2.3:** The conversation-only Chunk transcript is assembled from the Turn projections in that Chunk.

- **TC-2.3a: Chunk transcript preserves Turn order**
  - Given: A Chunk contains multiple Turns with ready conversation-only projections
  - When: the Chunk transcript is assembled
  - Then: the transcript concatenates those Turn projections in Chunk order
- **TC-2.3b: Chunk transcript excludes tool and thinking content**
  - Given: Turns in the Chunk contain thinking and tool exchange components
  - When: the Chunk transcript is assembled
  - Then: thinking, tool calls, and tool results remain absent
- **TC-2.3c: User-only Chunk transcript is valid**
  - Given: every Turn projection in a Chunk contains a user block and no assistant-visible blocks
  - When: the Chunk transcript is assembled
  - Then: the transcript remains valid lower-band compression input

**AC-2.4:** Detailed and brief use the same conversation-only Chunk transcript as source.

- **TC-2.4a: Shared source transcript**
  - Given: A closed Chunk is ready for lower-band generation
  - When: detailed and brief generation run
  - Then: both outputs are generated from the same conversation-only Chunk transcript
- **TC-2.4b: Brief is not generated from detailed**
  - Given: detailed output exists for a Chunk
  - When: brief generation runs
  - Then: brief uses the conversation-only Chunk transcript rather than the detailed output

**AC-2.5:** The conversation-only Chunk transcript does not replace smooth text.

- **TC-2.5a: Smooth representation remains available**
  - Given: A Chunk has a conversation-only transcript
  - When: smooth-band materialization needs smooth text
  - Then: smooth text remains available as its own representation
- **TC-2.5b: Lower-band source remains separate**
  - Given: A Chunk has both smooth text and conversation-only transcript state
  - When: lower-band generation runs
  - Then: it uses the conversation-only transcript rather than smooth text

**AC-2.6:** Existing closed Chunk membership is not silently rewritten under the new lower-band basis.

- **TC-2.6a: Closed Chunk membership is not mutated in place**
  - Given: a closed Chunk already contains a set of Turns
  - When: lower-band Chunk assembly or repair evaluates new boundary rules
  - Then: the closed Chunk's Turn list is not silently edited in place
- **TC-2.6b: Old placeholder Chunk state is not selectable**
  - Given: a Thread contains Chunks created under the old placeholder lower-band path
  - When: smart compact selects lower-band material after this epic
  - Then: those Chunks are not selectable as real lower-band output until they have been cleared, rebuilt, or explicitly superseded by the new path
- **TC-2.6c: Rebuild or supersession is explicit**
  - Given: existing Chunk state must be replaced to use conversation-only boundary counts
  - When: the replacement occurs
  - Then: the operator can distinguish the new lower-band-ready Chunk state from old placeholder-era state

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story changes the authority that decides Chunk membership without creating
“lower-band chunks” as a second memory object. Chunks still contain Turns. The
change is that Chunk assembly reads the persisted conversation-only Turn
projection count instead of the smooth-turn count, and it persists a second
derived Chunk representation: the conversation-only transcript.

This story also owns the first explicit legacy boundary in Epic 5. Current
placeholder-era Chunk state remains present in the repo and current sessions,
but this story makes it distinguishable and blocks it from being treated as real
lower-band source material. That is why this slice is more than a simple field
addition.

#### Build Strategy

Strategy: `full-staged-risk`

Reason:
- exact threshold decisions are easy to mis-implement and easy to fake with
  mirrored tests
- the story touches persisted lifecycle state and legacy blocking rules
- the current code already refreshes closed Chunk smooth text in place, so the
  implementation needs to be deliberate about what changes and what stops

Risk Reminders:
- preserve one Chunk concept while changing the count authority
- prove closed `sourceTurnIds` stability separately from transcript refresh
- keep legacy detection and current-schema pending/not-ready behavior distinct

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Chunk lifecycle and count authority | `src/thread/async-thread/services/chunk-service.ts` |
| Chunk record shape | `src/thread/async-thread/domain/chunk-state.ts`, `src/thread/async-thread/domain/lower-band-artifact-state.ts` |
| Projection count consumption | `src/thread/async-thread/services/lower-band-turn-projection-service.ts` |
| Legacy blocking and runtime selection compatibility | `src/thread-view/services/thread-view-builder.ts`, `src/thread/async-thread/services/async-thread-run-service.ts` |

#### Design References

- [tech-design.md §Flow 2: Lower-Band-Native Chunk Assembly](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:389), lines 389-429
- [tech-design.md §Chunk State Extension](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:633), lines 633-669
- [tech-design.md §Placeholder Cutover Inventory](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:313), lines 313-343
- [tech-design.md §Chunk 2: Lower-Band-Native Chunk Assembly](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:913), lines 913-930
- [test-plan.md §tests/thread/chunk-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:180), lines 180-195
- [test-plan.md §Non-TC Architecture-Risk Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:295), lines 295-314

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-2.1a`, `TC-2.1b` | `tests/thread/chunk-service.test.ts` | chunk append/close decisions use projection counts instead of smooth-turn counts |
| `TC-2.3a`, `TC-2.3b`, `TC-2.3c` | `tests/thread/chunk-service.test.ts` | transcript persists Turn order, remains conversation-only, and allows user-only chunks |
| `TC-2.4a`, `TC-2.4b` | `tests/thread/chunk-service.test.ts` | detailed and brief share transcript source and brief does not derive from detailed |
| `TC-2.5a`, `TC-2.5b` | `tests/thread/chunk-service.test.ts` | smooth text remains separate from conversation-only transcript state |
| `TC-2.6a`, `TC-2.6b`, `TC-2.6c` | `tests/thread/chunk-service.test.ts` | closed membership is stable, legacy placeholder state is blocked, and replacement is explicit |

#### Non-TC Decided Tests

- `tests/thread/chunk-service.test.ts`: exact threshold golden cases for min / soft max / hard max decisions
- `tests/thread/chunk-service.test.ts`, `tests/thread/async-thread-run-service.test.ts`: later stories consume real projection/transcript state rather than fake eligibility flags
- reopen/restart survival for transcript and schema-versioned Chunk state

#### Technical Notes

- The threshold settings stay where they are; only the count authority changes.
  That means code should be conservative about algorithm drift.
- A current-schema Chunk missing `conversationTranscript` is pending/not-ready,
  not automatically legacy. Legacy blocking depends on schema/version and
  placeholder-era fields.
- The current code’s closed-Chunk smooth refresh behavior is part of the
  implementation context for this story and should be handled explicitly, not by
  accident.

#### Anti-Shim Requirements

- Do not satisfy this story by copying smooth-text counts into a new field while
  leaving boundary decisions effectively unchanged.
- Do not prove closed-Chunk immutability only by checking text fields; assert
  `sourceTurnIds` stability directly.
- Do not fake transcript assembly with prebuilt fixture strings that bypass real
  Turn projection state.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Chunk boundary decisions use `lowerBandProjection.tokenCountMetadata`, not `smooth.tokenCountMetadata`
- [ ] Conversation-only Chunk transcript assembled and persisted on Chunk state
- [ ] Smooth text still materialized separately
- [ ] Closed Chunk membership not silently rewritten in normal maintenance
- [ ] Legacy/placeholder-era Chunks blocked from lower-band selection
- [ ] New Chunks written with `schemaVersion = "conversation_only_chunk_v1"`
- [ ] `npm run verify` passes
- [ ] Architecture-risk tests: exact threshold golden cases, legacy state blocked, reopen/restart survival


### Test Plan
### test-plan
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md
Bytes: 31174

# Test Plan: Real Lower-Band Compression

## Purpose

This test plan maps every Test Condition from Epic 5 to a concrete test file
and behavior. It is the authoritative TC-to-test matrix for Epic 5.

Epic 5 currently has **81 epic TCs**. The count comes from:

- Flow 1: 17
- Flow 2: 16
- Flow 3: 21
- Flow 4: 10
- Flow 5: 8
- Flow 6: 9

These counts follow the epic’s canonical flow groupings. The TC mapping below
is grouped by test file instead, so some files cover TCs from more than one
epic flow.

This plan maps each TC to one primary test location. It also adds a formal
architecture-risk section because AC/TC coverage alone is not enough for a
file-backed derived-state feature with mutation, rebuild, retry, and provider
integration seams.

The primary confidence layers are:

- the default non-E2E suite run by `npm run verify`, which should cover public
  service/command entry points, real-temp-store persistence behavior, and the
  real GPT OAuth lower-band path where the story requires it
- the deeper `npm run verify-all` gate, which adds E2E/lifecycle coverage

Epic 5 does not require a formal eval harness in this phase. It does require
that the real provider path be exercised in curated provider-backed tests and
that placeholder fallback be impossible in the runtime path.

## Test Architecture

Tests follow the service-mock philosophy:

- enter at public service or command boundaries
- exercise internal modules together
- mock only true external boundaries

For Epic 5, the external boundaries are:

- GPT OAuth inference
- AuthStorage / missing credential conditions when auth failure is the subject
- PI command/extension edge doubles where the runtime surface itself is not the
  behavior under test

The filesystem is **not** treated as a generic mock boundary for the core state
paths in this epic. Real temp directories are required for the highest-value
stateful tests because persistence, reopen/restart survival, and generated
output files are part of the feature contract.

### Primary Test Locations

```text
tests/thread/
  foundation.test.ts                              # expand for fixture/lifecycle validity
  lower-band-turn-projection-service.test.ts      # NEW
  chunk-service.test.ts                           # expand existing
  lower-band-compression-service.test.ts          # NEW
  async-thread-run-service.test.ts                # expand existing

tests/thread-view/
  thread-view-builder.test.ts                     # expand existing
  thread-view-materializer.test.ts                # expand existing

tests/context-workbench/
  workbench-query-service.test.ts                 # expand existing readiness inspection surface
  workbench-search-service.test.ts                # expand existing projection/search summaries

tests/workbench/
  compaction-report-service.test.ts               # expand existing
  active-rollout-inspection-service.test.ts       # expand existing
  workbench-lower-band-service.test.ts            # rename/expand legacy workbench-lower-band.integration.test.ts

tests/commands/
  smart-compact.test.ts                           # expand existing
  smart-compact-lifecycle.test.ts                 # rename/expand legacy smart-compact-lifecycle.integration.test.ts

tests/context-steward/
  pi-extension-commands.test.ts                   # expand existing
  long-thread-real-pi-execution.e2e.test.ts       # expand existing Story 5/6 runtime proof
  e2e-cli.e2e.test.ts                             # expand only for Story 7 operator command surface if needed

tests/token-accounting/
  materialized-representation-counter.test.ts     # expand existing for projection + semantic lower-band scopes
  openai-input-token-counter.test.ts              # expand existing for exact lower-band counts
```

Epic 4 already introduced neighboring broad service-tier suites under
`tests/commands`, `tests/context-steward`, `tests/context-workbench`, and
`tests/workbench`. Epic 5 should reuse those test neighborhoods rather than
invent a separate harness in a disconnected part of the tree.

Per-file exact test counts are intentionally not final in this first-pass plan.
The current artifact proves full TC coverage and chunk-level test budgeting. A
mechanical reconciliation pass should lock per-file totals after implementation
stabilizes the final test names and any split/merge of closely related cases.

### Meaningful Verification Layers

| Layer | Command | Meaning For Epic 5 |
|---|---|---|
| Default non-E2E gate | `npm run verify` | Typecheck plus all non-E2E tests, including real GPT OAuth lower-band tests where required |
| Full gate | `npm run verify-all` | `verify` plus E2E/lifecycle coverage required by Stories 5-7 |

`test:e2e` may remain empty early in the epic because the repo’s runner exits
successfully for empty E2E suites. That must not be mistaken for lower-band E2E
coverage. The test plan therefore treats `verify` as the lower-band story gate
and `verify-all` as the deeper E2E/lifecycle gate.

The current repo runner intentionally supports only `service` and `e2e` modes.
Epic 5 should not reintroduce a separate integration runner layer. Existing
files named `.integration.test.ts` are legacy non-E2E service-tier tests because
the runner treats them like any other `*.test.ts` file. Epic 5 should avoid
adding new `.integration.test.ts` files and should rename touched legacy files
to service-tier or provider-backed names when practical.

### Quarantined Heavyweight Prep Proof

The repo previously carried a skipped, quarantined pseudo-test at:

- `tests/thread-view/real-long-thread-fixture-prep.NEEDS-REFACTOR.ts`

That file is not a legitimate service-tier test and not a real E2E. It should
not be restored as a standalone proof. The clean decomposition is:

- `tests/thread-view/real-long-thread-fixture-prep.ts` remains reusable test
  infrastructure for cloning and preparing the real long-thread fixture
- focused file-backed prep invariants now live in
  `tests/thread-view/real-long-thread-fixture-prep.test.ts`
- any unique prep invariants that are still unproven move into focused
  file-backed service-tier tests
- real runtime proof remains in
  `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts`
- once unique assertions are redistributed, the skipped
  `NEEDS-REFACTOR` pseudo-test should be removed instead of remaining a
  permanent can-kick

The prep-specific assertions worth preserving, if not already covered
elsewhere, are:

- generated/archived path metadata rewrite for cloned stores
- source target session-path rewrite behavior
- active generated Thread View reconciliation
- selected-chunk smooth-freshness normalization when it remains a unique
  invariant

## Mock And Fixture Strategy

Required fixture builders and helpers:

| Builder / Helper | Purpose |
|---|---|
| `makeThreadSnapshot()` | Canonical source Thread with Messages, Turns, actors, and metadata |
| `makeSmoothTurnComponents()` | Ready, pending, degraded, invalid smooth component sets |
| `makeTurnLowerBandProjection()` | Valid and invalid projection state for targeted tests |
| `makeChunkState()` | Valid open/closed Chunk lifecycle states for new schema |
| `makeLegacyPlaceholderChunkState()` | Explicit legacy/blocked Chunk fixture |
| `makeChunkLowerBandArtifacts()` | Detailed/brief ready, pending, and failed semantic artifact fixtures |
| `withTempThreadStore()` | Real temp root for Thread + async-thread state |
| `withTempWorkbenchStore()` | Real temp root for Thread + workbench/reporting tests |

Fixture contract rules:

- default fixtures must represent valid domain states
- invalid fixtures must be explicitly named as invalid
- open Chunk fixtures must not contain closed metadata or lower-band artifacts
- legacy placeholder-era Chunk fixtures must never be the default Chunk builder
- projection fixtures must preserve source-vs-derived ownership rules

Mock boundaries:

| Boundary | Treatment |
|---|---|
| GPT OAuth compression provider | Mock in most service-mock tests; use real provider-backed tests inside the default non-E2E suite where the story requires it |
| Auth storage / credential lookup | Mock only when auth failure behavior is under test |
| Canonical Thread store | Real temp directories for stateful tests; fakes only where persistence behavior is irrelevant |
| Thread View store | Real temp directories where build/report paths depend on persisted state |
| PI extension command edge | Command context doubles or adapter doubles |
| Internal services | Do not mock across internal domain boundaries |

## TC Mapping

### `tests/thread/lower-band-turn-projection-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-1.1a | smooth source used for user prompt | Closed Turn with ready smooth user prompt component | `>` block comes from smooth component text |
| TC-1.1b | raw text not used when smooth differs | Raw prompt differs from smooth component | Projection uses smooth text |
| TC-1.2a | user block precedes assistant blocks | Ready user prompt plus assistant-visible output | Output starts with `>` then `●` blocks in order |
| TC-1.2b | intermediate assistant output included | Multiple assistant-visible segments before final response | Intermediate assistant text appears |
| TC-1.2c | exact speaker markers emitted | Ready user and assistant-visible output | User uses `>` and assistant uses `●` |
| TC-1.3a | multiple assistant outputs create multiple markers | Multiple assistant-visible segments | Separate `●` blocks emitted |
| TC-1.3b | no heavy separators added | Multiple assistant blocks | No banners or component metadata emitted |
| TC-1.4a | thinking excluded | Thinking components present | Thinking text absent from projection |
| TC-1.4b | tool calls/results excluded | Tool exchange parts present | Tool call/result text absent |
| TC-1.5a | user-only Turn retained | No assistant-visible output after exclusions | `>` block still produced and projection is valid |
| TC-1.6a | missing user prompt blocks projection | No ready user prompt component | Projection status is not ready |
| TC-1.6b | missing required assistant component blocks projection | Assistant-visible content lacks ready smooth component | Projection status is not ready |
| TC-1.6e | multi-user-prompt Turn invalid | Turn contains multiple user prompts | Projection status is invalid |
| TC-1.7a | projection text retained or reproducible | Projection written then reopened or rematerialized | Same projection text available |
| TC-1.7b | same smooth state produces same projection text | Same smooth component set projected twice | Identical text emitted both times |
| TC-2.2a | projection boundary count persisted | Projection created successfully | Proper token count persisted on projection state |
| TC-2.2b | runtime estimates not persisted as boundary counts | Projection path plus routing estimate path both exercised | Persisted count is not `chars / 3.5` estimate metadata |
| TC-2.2c | boundary count reproducible | Same projection counted twice | Same proper count returned |
| TC-2.2d | boundary count failure blocks chunking | Projection text exists but exact count fails | Turn cannot enter lower-band chunking |

### `tests/thread/chunk-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-2.1a | conversation-only count drives append decision | Current Chunk plus next Turn with ready projection count | Append/close decision uses projection count, not smooth count |
| TC-2.1b | full smooth text count does not drive lower-band boundary | Tool-heavy Turn with large smooth text but small conversation-only projection | Boundary decision follows projection count outcome |
| TC-2.3a | transcript preserves Turn order | Multiple Turns with ready projections | Chunk transcript concatenates in Turn order |
| TC-2.3b | transcript excludes tool/thinking | Projections derived from tool/thinking-heavy Turns | Transcript remains conversation-only |
| TC-2.3c | user-only transcript valid | Chunk with only user-only Turn projections | Transcript remains valid input |
| TC-2.4a | detailed and brief share transcript source | Closed Chunk with ready transcript | Both bands reference same transcript source |
| TC-2.4b | brief not generated from detailed | Detailed exists, brief generation runs | Brief uses transcript source, not detailed text |
| TC-2.5a | smooth representation remains available | Chunk with ready transcript and smoothText | smoothText still materialized |
| TC-2.5b | lower-band source remains separate | Chunk with both smoothText and transcript | Lower-band consumer reads transcript, not smoothText |
| TC-2.6a | closed membership not mutated in place | Existing closed Chunk plus later maintenance pass | Closed `sourceTurnIds` unchanged |
| TC-2.6b | legacy placeholder Chunk state not selectable | Legacy/placeholder-era Chunk fixture present | Chunk blocked from lower-band selection |
| TC-2.6c | rebuild or supersession explicit | Old state replaced by new state | New state distinguishable from old |

### `tests/thread/lower-band-compression-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-3.1a | Chunk close triggers async generation work | Closed Chunk with ready transcript | Detailed/brief jobs scheduled |
| TC-3.1b | close path does not block on model latency | Slow mocked provider | Chunk close path returns without waiting |
| TC-3.2a | detailed request uses detailed prompt | Ready transcript, mocked provider | Detailed prompt/request path used and output stored under detailed |
| TC-3.2b | brief request uses brief prompt | Ready transcript, mocked provider | Brief prompt/request path used and output stored under brief |
| TC-3.2c | outputs do not derive from each other | Generate both bands | Both read transcript source independently |
| TC-3.2d | compressed output need not preserve markers | Provider returns prose or bullets without source markers | Output still accepted |
| TC-3.3a | routing estimate uses character count | Ready transcript | Lane selection uses `ceil(chars / 3.5)` |
| TC-3.3b | routing estimates not persisted | Generation completes | No routing estimate stored on source-truth artifact |
| TC-3.3c | oversized input warns and truncates | Transcript estimate above `4,000` | Visible stderr warning emitted and input truncated for attempt |
| TC-3.4a | detailed target range checked | Detailed output returned | Estimated output falls within or outside `15%-50%` range explicitly |
| TC-3.4b | detailed miss retries with size feedback | Attempt 1 detailed output out of range | Attempt 2 sees prior output, range, and miss |
| TC-3.5a | brief target range checked | Brief output returned | Estimated output falls within or outside `1%-20%` range explicitly |
| TC-3.5b | brief miss retries with size feedback | Attempt 1 brief output out of range | Attempt 2 sees prior output, range, and miss |
| TC-3.6a | first two attempts use routed lane | Attempt 1 out of range | Attempt 2 uses routed lane |
| TC-3.6b | third attempt escalates | Attempts 1 and 2 out of range | Attempt 3 uses GPT-5.5 medium |
| TC-3.6c | escalated response accepted | Attempt 3 returns out-of-range output | First escalated output accepted |
| TC-3.7a | ready artifact stores final text only | Generation succeeds | Artifact stores ready status and final text |
| TC-3.7b | failed artifact stores minimal error state | Exhausted attempts fail | Artifact stores failed status and last error |
| TC-3.7c | logs carry generation details | Retry/escalation/provider failure occurs | Log output contains attempt details but artifact does not |
| TC-3.8a | provider failure leaves output not ready during retry | Provider/network/auth/model error with retries remaining | Output remains pending/not ready and retry logged |
| TC-3.8b | exhausted provider failure stores failed state | Repeated provider/network/auth/model error | Artifact stores failed status and last error |

### `tests/thread/lower-band-compression-provider-backed.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-6.2a | detailed integration path runs | Real GPT OAuth config plus ready transcript fixture | Detailed generation succeeds end to end |
| TC-6.2b | brief integration path runs | Real GPT OAuth config plus ready transcript fixture | Brief generation succeeds end to end |
| TC-6.3a | missing OAuth setup fails default verification | No credential configured | Real provider-backed lower-band test fails with actionable auth/config error |
| TC-6.3b | broken model wiring fails default verification | Credential exists but provider wiring invalid | Real provider-backed lower-band test fails explicitly |

### `tests/thread/async-thread-run-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-1.6c | smooth catch-up attempts visible | Selected Turn missing required smooth component | Catch-up warnings emitted |
| TC-1.6d | smooth catch-up failure stops compact | Missing required smooth state cannot be repaired | Prepare result blocked with descriptive error |
| TC-4.1a | detailed-selected Chunk requires detailed output | Selected detailed Chunk missing/ready detailed artifact | Readiness enforced |
| TC-4.1b | brief-selected Chunk requires brief output | Selected brief Chunk missing/ready brief artifact | Readiness enforced |
| TC-4.2a | missing selected output triggers catch-up | Selected lower-band output missing | Catch-up generation invoked |
| TC-4.2b | catch-up warning visible | Sync catch-up occurs | stderr/log warning identifies Chunk and band |
| TC-4.3a | detailed failure blocks compact | Selected detailed catch-up fails | Prepare result blocks with Chunk/band error |
| TC-4.3b | brief failure blocks compact | Selected brief catch-up fails | Prepare result blocks with Chunk/band error |

### `tests/commands/smart-compact.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-4.4a | placeholder output not emitted | Selected lower-band output missing or failed | Generated output does not substitute placeholder text |
| TC-4.4b | old placeholder state not treated as ready | Legacy placeholder Chunk present | Command blocks or excludes it |
| TC-4.5a | placeholder runtime consumers unreachable | Normal runtime compact path | Placeholder generation and selection paths are not invoked by compact, builder, or materializer |
| TC-4.5b | placeholder runtime assumptions removed from tests | Runtime test suite and command path smoke | No runtime-facing test depends on placeholder success behavior |

### `tests/context-workbench/workbench-query-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-5.1a | transcript readiness visible | Closed Chunks with mixed transcript state | Report shows transcript presence/readiness |
| TC-5.1b | detailed and brief status visible | Chunks with ready/pending/failed band artifacts | Report shows per-band status |
| TC-5.2a | failed lower-band output includes error summary | Failed detailed or brief artifact | Last error shown |
| TC-5.4a | no automatic quality grade | Ready lower-band outputs present | Report omits quality score fields |
| TC-5.4b | no model comparison dashboard | Inspection run completes | Report remains operational, not evaluative |

### `tests/workbench/compaction-report-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-5.2b | compact blocker identifies Chunk and band | Prepare or compact blocked by lower-band output | Audit report names blocking Chunk/band |

### `tests/workbench/active-rollout-inspection-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-5.3b | catch-up generation logged in rollout/inspection surfaces | Catch-up generation occurs before compact output | Visible warning/evidence available to operator |

### `tests/thread/lower-band-compression-service.test.ts` and log helpers

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-5.3a | retry and escalation logged | Lower-band generation retries or escalates | Log output contains retry/escalation evidence with Chunk and band context |

### Verification Gate Evidence

These TCs are architectural/process requirements rather than one runtime
behavior. They still need named evidence in the design.

| TC | Evidence Location | Description | Coverage Notes |
|---|---|---|---|
| TC-6.1a | Service-mock suite listed in this test plan | Primary tests enter through public services/commands rather than internal helpers | Verified by test file selection and mocking strategy |
| TC-6.1b | `tests/thread/lower-band-compression-service.test.ts` and other service-mock files | GPT OAuth and other external boundaries are mocked while internal modules remain real | Verified by suite architecture and file-level mock boundaries |
| TC-6.4a | `npm run verify` acceptance evidence | Fast/default verification gate required for each story | Story acceptance gate |
| TC-6.4b | `npm run verify-all` acceptance evidence | Deeper gate used when a story or epic checkpoint expects E2E/lifecycle confirmation | Story acceptance / epic gate |
| TC-6.4c | Story 3+ acceptance evidence | Compression stories cannot be accepted unless the real GPT OAuth lower-band tests inside `verify` exist and pass | Story sequencing/gate rule |

## Non-TC Architecture-Risk Tests

These are not optional extras. They exist because Epic 5 introduces architecture
hazards that AC/TC coverage alone will miss.

| Risk | Test File | Test Description | Why AC/TC Mapping Alone Would Miss It |
|---|---|---|---|
| Lost update on Turn projection writes | `tests/thread/lower-band-turn-projection-service.test.ts` | Two stale writers cannot clobber each other’s projection state | Epic requires projection correctness, not the file-backed lost-update hazard itself |
| Lost update on lower-band artifact writes | `tests/thread/lower-band-compression-service.test.ts` | Concurrent or repeated writes cannot erase fresher detailed/brief state | Epic requires final readiness/failure, not stale writer behavior |
| Reopen/restart survival | `tests/thread/lower-band-compression-provider-backed.test.ts` | Fresh store instance can read persisted projection/transcript/lower-band output state | Epic describes readiness, not restart survival mechanics |
| Partial smart compact failure leaves no active bad output | `tests/commands/smart-compact.test.ts` | Failure after catch-up or before final write does not leave a partially active generated output | Epic requires specific failure, but not partial-write safety details |
| Fixture lifecycle validity | `tests/thread/foundation.test.ts` | Default Chunk fixtures are valid; invalid fixtures explicit | Epic does not describe fixture contracts |
| Legacy placeholder state blocked | `tests/thread/chunk-service.test.ts` | Placeholder-era Chunk fixture is blocked and distinguishable | Epic says old state is not ready, but not how to prove fixture/state separation |
| No placeholder runtime deepening | `tests/commands/smart-compact.test.ts` | Runtime path cannot invoke placeholder generator after cutover | Epic forbids it, but a design-specific anti-regression test is still needed |
| Real prior-story artifact use | `tests/thread/chunk-service.test.ts`, `tests/thread/async-thread-run-service.test.ts` | Later tests consume actual projection/transcript state, not fake eligibility flags | AC coverage can still accidentally use shims unless the plan forbids it |
| PI runtime compact consumes real lower-band output | `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts` | Prepared long-thread PI session runs, smart compact consumes ready semantic lower-band output, generated rollout reloads, and PI continues | Service-tier tests can prove readiness locally but cannot prove the full PI/runtime continuation path |
| Placeholder-free generated rollout | `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts` | Same Story 5 runtime E2E asserts generated output contains semantic lower-band text and no deterministic placeholder fallback | Placeholder cutover needs one full-runtime proof that the final generated artifact is clean |
| Operator command surface inspection | `tests/context-steward/e2e-cli.e2e.test.ts` | Real outer command surface can report lower-band readiness/failure without reading placeholder-era summaries | Service-tier workbench tests prove formatting; one E2E proves the operator can reach it through the real surface |
| Exact threshold golden cases | `tests/thread/chunk-service.test.ts` | Boundary cases for min/soft max/hard max use fixed expected decisions | Mirrored helper logic could pass while both implementation and test misunderstand the rule |
| Heavyweight long-thread prep proof decomposition | `tests/thread-view/real-long-thread-fixture-prep.test.ts`, `tests/thread-view/real-long-thread-fixture-prep.ts`, `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts` | Quarantined pseudo-test is split into helper infrastructure, focused service-tier assertions, and real E2E runtime proof | Prevents an ambiguous middle-tier proof from lingering as a skipped can-kick |
| Semantic counter rewiring | `tests/token-accounting/materialized-representation-counter.test.ts`, `tests/token-accounting/openai-input-token-counter.test.ts` | Detailed/brief counts read semantic lower-band artifact text, not placeholder text, and the new projection scope is validated | ACs describe persisted counts and semantic artifacts, but not the counter-source implementation hazard |
| External integration error redaction | `tests/thread/lower-band-compression-service.test.ts`, `tests/token-accounting/openai-input-token-counter.test.ts` | Provider/auth/model failures surface actionable context without leaking bearer tokens or raw credentials | Epic requires visible failures, but not the redaction hazard introduced by real provider logs |
| Workbench query/search cutover | `tests/context-workbench/workbench-query-service.test.ts`, `tests/context-workbench/workbench-search-service.test.ts` | Workbench summaries and readiness queries stop blessing placeholder output as valid semantic lower-band state | Epic covers runtime correctness, but workbench drift can leave the operator seeing the wrong truth |
| Real-provider gate in default suite | `tests/thread/lower-band-compression-provider-backed.test.ts` | Default non-E2E verification fails when config missing and runs the real provider path when present | A separate integration layer no longer exists |

## Chunk Test Counts

These are first-pass estimates for planning and reconciliation. They will need a
mechanical count pass after the test files and non-TC tests stabilize.

| Chunk | TC Tests | Non-TC Risk Tests | Estimated Total |
|---|---:|---:|---:|
| Chunk 0: Foundation and verification rails | 5 | 4 | 9 |
| Chunk 1: Conversation-only Turn projection | 19 | 3 | 22 |
| Chunk 2: Lower-band-native Chunk assembly | 12 | 4 | 16 |
| Chunk 3: GPT OAuth lower-band compression | 25 | 3 | 28 |
| Chunk 4: Retry, escalation, and on-demand accounting | 10 | 2 | 12 |
| Chunk 5: Smart compact lower-band readiness | 8 | 3 | 11 |
| Chunk 6: Placeholder runtime removal / legacy blocking | 4 | 2 | 6 |
| Chunk 7: Inspection and reporting | 8 | 2 | 10 |
| **Total** | **91** | **23** | **114** |

The TC test total is intentionally higher than the epic TC count because some
TCs will map to more than one concrete assertion or test case in practice. The
reconciliation pass after implementation must make the final per-file and
per-chunk totals explicit.

## Real-Provider Tests

Epic 5 still needs curated real-provider coverage. It just lives inside the
default non-E2E suite instead of behind a separate runner layer.

| File | Purpose | Uses Real GPT OAuth? |
|---|---|---|
| `tests/thread/lower-band-compression-provider-backed.test.ts` | Dedicated lower-band provider-backed suite: detailed/brief generation, auth/config failure behavior, reopen survival | Yes |
| `tests/workbench/workbench-lower-band-service.test.ts` | Existing persisted thread/chunk/workbench path expanded for semantic lower-band readiness; rename from legacy `.integration.test.ts` file if touched | No, unless one representative real-provider path is valuable |
| `tests/commands/smart-compact-lifecycle.test.ts` | Existing lifecycle-grade compact path expanded once real lower-band outputs are selectable; rename from legacy `.integration.test.ts` file if touched | Usually no; can keep mocked provider unless a representative real path is especially useful |

Expectations:

- these tests run under `npm run verify` because they are non-E2E `*.test.ts`
- the real lower-band provider-backed test must fail when GPT OAuth config or
  wiring is missing
- the suite must not silently downgrade to mocked provider behavior

## E2E Tests

Epic 5 needs a small number of E2E assertions, not a separate integration test
layer. These assertions belong under `npm run verify-all` because they prove the
real PI/runtime continuation path rather than isolated lower-band services.

Required E2E coverage:

| Story | File | Required Proof |
|---|---|---|
| Story 5 | `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts` | A prepared long-thread PI session runs, semantic lower-band output is ready, smart compact consumes that output through `buildThreadViewProjection`, generated rollout reloads, and PI continues after compact |
| Story 6 | `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts` | The same runtime path emits no deterministic placeholder detailed/brief fallback and does not treat placeholder-era Chunk state as ready output |
| Story 7 | `tests/context-steward/e2e-cli.e2e.test.ts` | A narrow operator command-surface check can reach lower-band readiness/failure inspection through the real outer surface without a duplicate inspection pathway |

E2E boundaries:

- do not create a new `test:integration` command or resurrect a middle runner
  tier
- do not duplicate every service-tier edge case in E2E
- do not make Story 7’s E2E a quality-eval or model-comparison scenario
- keep the Story 5/6 E2E focused on runtime continuation and final generated
  output cleanliness

## Verification Commands

| Command | Purpose | Epic 5 Meaning |
|---|---|---|
| `npm run red-verify` | Red exit gate | Type-only / scaffold sanity before Green |
| `npm run verify` | Default story gate | Required for every story; includes real provider-backed lower-band tests where required |
| `npm run green-verify` | Green exit gate | Recommended during implementation |
| `npm run verify-all` | Full gate | `verify` plus E2E/lifecycle coverage; do not mistake an empty E2E lane for lower-band provider confidence |

## Related Documentation

- Epic: [epic.md](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/epic.md)
- Tech design: [tech-design.md](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md)
- Technical architecture: [technical-architecture.md](/Users/leemoore/code/pi-long-horizon/docs/spec-build/technical-architecture.md)


## Current Run Index
- planner_turn_index: 9
- mode: resume
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-implement completed with outcome ready-for-verification and status ok.
- latest_response_kind: implementor-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/010-implementor.json
- older_response_count: 6
- caller_input_artifact_count: 0
- prior_self_note_count: 7
- latest_self_note: "After this implementation pass, require a fresh verifier pass with outcome pass, no open findings, npm run verify evidence, and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."

## Response Trail
<current_response>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/010-implementor.json
bytes: 5535
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "d5bddca0-de0f-4012-b14b-b78da9cfdab1"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e38bf-76b9-74c1-b33b-057ff92b0bda"
    continuation:
      provider: "codex"
      sessionId: "019e38bf-76b9-74c1-b33b-057ff92b0bda"
      storyId: "02-chunk-assembly-from-turn-projections"
    outcome: "ready-for-verification"
    story:
      id: "02-chunk-assembly-from-turn-projections"
      title: "Story 2: Chunk Assembly From Turn Projections"
    planSummary: "Validated the current Story 2 implementation in the existing worktree: chunk assembly now reads exact conversation-only projection counts, persists conversation-only chunk transcripts alongside smooth text, marks new chunks with conversation-only schema state, and updates readiness/selection paths to understand canonical semantic chunk state versus legacy placeholder-era state."
    changedFiles:
      -
        path: "src/thread/async-thread/domain/chunk-state.ts"
        reason: "Extended chunk state with conversation-only schema/version handling, transcript/lower-band records, and legacy-vs-canonical helpers."
      -
        path: "src/thread/async-thread/domain/lower-band-artifact-state.ts"
        reason: "Added the canonical conversation transcript and semantic lower-band artifact record types plus clone helpers."
      -
        path: "src/thread/async-thread/services/chunk-service.ts"
        reason: "Switched chunk boundary logic to projection token counts, assembled/persisted conversation-only transcripts, and preserved closed membership while refreshing derived text."
      -
        path: "src/thread/async-thread/services/lower-band-turn-projection-service.ts"
        reason: "Provides the exact persisted conversation-only projection/token-count state that chunk assembly now consumes."
      -
        path: "src/thread/async-thread/services/async-thread-run-service.ts"
        reason: "Expanded prepare/maintenance readiness to account for projection exactness, canonical semantic chunk artifacts, and legacy placeholder-era blocking behavior."
      -
        path: "src/thread-view/services/thread-view-builder.ts"
        reason: "Rewired lower-band accounting/selection to consume canonical semantic artifacts and recognize blocked legacy chunk state."
      -
        path: "tests/thread/chunk-service.test.ts"
        reason: "Added Story 2 coverage for projection-count authority, transcript assembly, and closed-chunk membership stability."
      -
        path: "tests/thread/async-thread-run-service.test.ts"
        reason: "Added readiness coverage for projection materialization, projection-count failures, semantic chunk acceptance, and legacy blocking."
      -
        path: "tests/thread-view/thread-view-builder.test.ts"
        reason: "Added builder-level lower-band selection coverage for legacy blocking and canonical semantic chunk artifacts."
      -
        path: "tests/thread/foundation.test.ts"
        reason: "Added fixture/schema/token-accounting baseline coverage for the new conversation-only chunk state."
    tests:
      added:
        - "strict lower-band selection blocks legacy placeholder chunks after conversation-only cutover starts"
        - "prepare-mode lower-band selection accepts canonical semantic chunk artifacts without placeholder state"
        - "prepare mode materializes conversation-only turn projections through production readiness"
        - "prepare readiness blocks lower-band eligibility when projection exact token count fails"
        - "prepare readiness blocks legacy placeholder chunks once conversation-only cutover has started"
        - "prepare-mode readiness accepts canonical semantic chunk artifacts without placeholder token metadata"
        - "prepare-mode smooth catch-up writes visible stderr warnings"
        - "prepare-mode reports a specific compact failure when smooth catch-up cannot repair a turn"
        - "conversation-only projection counts drive chunk boundary decisions"
        - "chunk transcript assembles ready turn projections in order and supports user-only turns"
        - "closed chunk refreshes transcript and smooth text from changed component source without changing membership"
        - "Story 0 lower-band fixtures default to valid new-schema records"
        - "canonical chunk fixtures cannot become placeholder hybrids through default builders"
        - "semantic lower-band artifacts are authoritative for detailed and brief token accounting"
        - "lower-band artifact fixtures stay lean and projection counts are policy-usable"
        - "verification command truth stays on verify plus verify-all without an integration runner"
      modified:
        - "tests/thread/chunk-service.test.ts"
        - "tests/thread/async-thread-run-service.test.ts"
        - "tests/thread-view/thread-view-builder.test.ts"
        - "tests/thread/foundation.test.ts"
      removed:
[]
      totalAfterStory: 56
      deltaFromPriorBaseline: 16
    gatesRun:
      -
        command: "node --import tsx --test tests/thread/chunk-service.test.ts tests/thread/async-thread-run-service.test.ts"
        result: "pass"
      -
        command: "node --import tsx --test tests/thread-view/thread-view-builder.test.ts tests/commands/smart-compact.test.ts"
        result: "pass"
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
[]
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Hand Story 2 to verification/self-review with the current worktree state."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/010-implementor.json"
  startedAt: "2026-05-18T01:42:12.179Z"
  finishedAt: "2026-05-18T01:52:34.917Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/003-implementor.json
bytes: 5567
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "be7eed43-d9ad-4321-a046-255e8e37345e"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e3876-e9e3-7dc3-b1b5-1ceda39d302f"
    continuation:
      provider: "codex"
      sessionId: "019e3876-e9e3-7dc3-b1b5-1ceda39d302f"
      storyId: "02-chunk-assembly-from-turn-projections"
    outcome: "ready-for-verification"
    story:
      id: "02-chunk-assembly-from-turn-projections"
      title: "Story 2: Chunk Assembly From Turn Projections"
    planSummary: "Switched chunk assembly to consume persisted conversation-only turn projections for boundary decisions, persisted conversation-only chunk transcripts alongside smooth text, added mixed-schema legacy lower-band blocking in readiness/selection, and updated the affected service, integration, and E2E coverage so the story and epic gates pass."
    changedFiles:
      -
        path: "src/thread/async-thread/domain/chunk-state.ts"
        reason: "Added canonical-vs-legacy chunk helpers and cutover detection used by chunk assembly and lower-band selection."
      -
        path: "src/thread/async-thread/services/chunk-service.ts"
        reason: "Reworked chunk assembly to use ready lower-band projection counts, persist conversation transcripts, preserve closed membership, and keep legacy placeholder refresh explicit."
      -
        path: "src/thread/async-thread/services/async-thread-run-service.ts"
        reason: "Added conversation-only cutover awareness so legacy placeholder chunks block lower-band readiness once new-schema chunk state is present."
      -
        path: "src/thread-view/services/thread-view-builder.ts"
        reason: "Blocked legacy placeholder chunks from lower-band selection after conversation-only cutover begins on a thread."
      -
        path: "src/thread/async-thread/services/smooth-turn-service.ts"
        reason: "Preserved component-first smooth state during exact-count backfill so maintenance does not overwrite current derived component text."
      -
        path: "tests/thread/chunk-service.test.ts"
        reason: "Updated chunk-service coverage for projection-driven boundaries, transcript persistence, user-only transcripts, and closed-chunk source refresh behavior."
      -
        path: "tests/thread/async-thread-run-service.test.ts"
        reason: "Added readiness coverage for legacy placeholder blocking after cutover and adjusted maintenance expectations for the new projection-aware flow."
      -
        path: "tests/thread-view/thread-view-builder.test.ts"
        reason: "Added lower-band selection coverage for legacy placeholder blocking once conversation-only chunk cutover is active."
      -
        path: "tests/thread/placeholder-artifact-service.test.ts"
        reason: "Updated placeholder-artifact tests to seed required lower-band projections before chunk creation under the new chunk eligibility rules."
      -
        path: "tests/commands/smart-compact-lifecycle.integration.test.ts"
        reason: "Kept legacy placeholder regeneration coverage aligned with the new chunk refresh behavior."
      -
        path: "tests/context-steward/pi-smoothing-lifecycle.integration.test.ts"
        reason: "Reduced a turn-end smoothing timing flake by giving the production wait assertion more time under full-suite load."
      -
        path: "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
        reason: "Updated the long-thread smart-compact E2E to accept explicit legacy-placeholder blocking during this story’s cutover state."
    tests:
      added:
[]
      modified:
        - "tests/thread/chunk-service.test.ts"
        - "tests/thread/async-thread-run-service.test.ts"
        - "tests/thread-view/thread-view-builder.test.ts"
        - "tests/thread/placeholder-artifact-service.test.ts"
        - "tests/commands/smart-compact-lifecycle.integration.test.ts"
        - "tests/context-steward/pi-smoothing-lifecycle.integration.test.ts"
        - "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
      removed:
[]
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Chunk soft/hard threshold decisions now use ready conversation-only projection counts instead of smooth-turn counts."
        - "Chunk state now persists a conversation-only transcript assembled from ordered turn projections while leaving smooth text as a separate representation."
        - "Legacy placeholder chunks are surfaced as blocked lower-band candidates once a thread has started writing conversation_only_chunk_v1 chunk state."
        - "Maintenance no longer rewrites closed chunk membership and preserves component-first smooth text when exact-count repair runs."
      findingsSurfaced:
        - "Pure all-legacy threads still retain the older placeholder path until a conversation_only_chunk_v1 chunk exists on that thread; the stricter legacy block currently activates at cutover rather than globally."
    openQuestions:
[]
    specDeviations:
      - "Legacy placeholder lower-band blocking currently activates once a thread has entered the conversation_only_chunk_v1 cutover state, rather than immediately blocking every all-legacy thread regardless of whether any new-schema chunk has been written yet."
    recommendedNextStep: "Implement Story 3 so closed conversation_only_chunk_v1 chunks generate real lower-band semantic artifacts from the persisted transcript and the remaining placeholder-era compatibility path can be retired."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/003-implementor.json"
  startedAt: "2026-05-18T00:22:57.568Z"
  finishedAt: "2026-05-18T00:49:38.312Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/004-verify.json
bytes: 10908
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "02d31016-31f5-4abd-a2ea-3d88c21e4a91"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e388f-889b-7483-880e-76c116a7388f"
    continuation:
      provider: "codex"
      sessionId: "019e388f-889b-7483-880e-76c116a7388f"
      storyId: "02-chunk-assembly-from-turn-projections"
    mode: "initial"
    story:
      id: "02-chunk-assembly-from-turn-projections"
      title: "Story 2: Chunk Assembly From Turn Projections"
    artifactsRead:
      - "docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md"
      - "docs/spec-build/epics/05-real-lower-band-compression/tech-design.md"
      - "docs/spec-build/epics/05-real-lower-band-compression/test-plan.md"
      - "docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/001-current.json"
      - "docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/003-implementor.json"
      - "src/thread/async-thread/domain/chunk-state.ts"
      - "src/thread/async-thread/domain/lower-band-artifact-state.ts"
      - "src/thread/async-thread/services/chunk-service.ts"
      - "src/thread/async-thread/services/lower-band-turn-projection-service.ts"
      - "src/thread/async-thread/services/async-thread-run-service.ts"
      - "src/thread/async-thread/services/placeholder-artifact-service.ts"
      - "src/thread/async-thread/test/fixtures.ts"
      - "src/thread-view/services/thread-view-builder.ts"
      - "src/token-accounting/materialized-representation-counter.ts"
      - "src/token-accounting/openai-input-token-counter.ts"
      - "tests/thread/chunk-service.test.ts"
      - "tests/thread/async-thread-run-service.test.ts"
      - "tests/thread-view/thread-view-builder.test.ts"
      - "tests/thread/foundation.test.ts"
      - "tests/commands/smart-compact-lifecycle.integration.test.ts"
      - "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
    reviewScopeSummary: "Initial verification of Story 2 against the story, full tech design, and test plan, then against the chunk/projection/runtime selection code paths, the mapped service/integration/E2E tests, and the configured `npm run verify` plus `npm run verify-all` gates."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "story-2-placeholder-source-still-drives-lower-band"
        severity: "major"
        title: "Lower-band runtime still derives detailed/brief content from smooth-text placeholders instead of the persisted conversation transcript"
        evidence: "Story 2 requires detailed and brief to share the conversation-only chunk transcript as source and to keep lower-band sourcing separate from smooth text (`docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md:70-90`). The current runtime still routes lower-band behavior through placeholders: `src/thread/async-thread/services/placeholder-artifact-service.ts:125-210` validates/builds artifacts from `chunk.smoothText`; `src/thread/async-thread/services/async-thread-run-service.ts:323-350,839-910` and `src/thread-view/services/thread-view-builder.ts:308-340` select/account `chunk.placeholders`; `tests/thread-view/thread-view-builder.test.ts:419-439` and `tests/commands/smart-compact-lifecycle.integration.test.ts:559-604` still treat placeholder-backed lower-band output as the success path. The current service tree also has no `lower-band-compression-service.ts`, so TC-2.4a, TC-2.4b, and TC-2.5b have no production implementation or mapped proof."
        affectedFiles:
          - "src/thread/async-thread/services/placeholder-artifact-service.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-builder.ts"
          - "tests/thread-view/thread-view-builder.test.ts"
          - "tests/commands/smart-compact-lifecycle.integration.test.ts"
        requirementIds:
          - "AC-2.4"
          - "TC-2.4a"
          - "TC-2.4b"
          - "AC-2.5"
          - "TC-2.5b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "story-2-legacy-blocking-only-after-cutover"
        severity: "major"
        title: "Legacy placeholder chunks are only blocked after cutover starts, so all-legacy threads still select old lower-band state"
        evidence: "Story 2 says placeholder-era chunk state is blocked from lower-band selection after this epic (`docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md:92-121`). In code, legacy blocking is conditional: `src/thread/async-thread/domain/chunk-state.ts:68-69` only reports cutover when some chunk already has `schemaVersion === \"conversation_only_chunk_v1\"`, and both selection paths gate blocking behind that flag (`src/thread-view/services/thread-view-builder.ts:447-484`, `src/thread/async-thread/services/async-thread-run-service.ts:255-292`). The tests explicitly preserve the all-legacy path: `tests/thread-view/thread-view-builder.test.ts:419-439` selects lower-band chunks normally, while the blocker tests only pass after a test manually injects a new-schema chunk (`tests/thread-view/thread-view-builder.test.ts:507-555`, `tests/thread/async-thread-run-service.test.ts:568-616`). `src/thread/async-thread/domain/chunk-state.ts:60-62` also only recognizes legacy state when `placeholders !== undefined`, so schema-less chunks with cleared or omitted placeholder fields are not distinctly blocked."
        affectedFiles:
          - "src/thread/async-thread/domain/chunk-state.ts"
          - "src/thread/async-thread/services/chunk-service.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-builder.ts"
          - "tests/thread-view/thread-view-builder.test.ts"
          - "tests/thread/async-thread-run-service.test.ts"
        requirementIds:
          - "AC-2.6"
          - "TC-2.6b"
          - "TC-2.6c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "story-2-placeholder-source-still-drives-lower-band"
        severity: "major"
        title: "Lower-band runtime still derives detailed/brief content from smooth-text placeholders instead of the persisted conversation transcript"
        evidence: "Story 2 requires detailed and brief to share the conversation-only chunk transcript as source and to keep lower-band sourcing separate from smooth text (`docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md:70-90`). The current runtime still routes lower-band behavior through placeholders: `src/thread/async-thread/services/placeholder-artifact-service.ts:125-210` validates/builds artifacts from `chunk.smoothText`; `src/thread/async-thread/services/async-thread-run-service.ts:323-350,839-910` and `src/thread-view/services/thread-view-builder.ts:308-340` select/account `chunk.placeholders`; `tests/thread-view/thread-view-builder.test.ts:419-439` and `tests/commands/smart-compact-lifecycle.integration.test.ts:559-604` still treat placeholder-backed lower-band output as the success path. The current service tree also has no `lower-band-compression-service.ts`, so TC-2.4a, TC-2.4b, and TC-2.5b have no production implementation or mapped proof."
        affectedFiles:
          - "src/thread/async-thread/services/placeholder-artifact-service.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-builder.ts"
          - "tests/thread-view/thread-view-builder.test.ts"
          - "tests/commands/smart-compact-lifecycle.integration.test.ts"
        requirementIds:
          - "AC-2.4"
          - "TC-2.4a"
          - "TC-2.4b"
          - "AC-2.5"
          - "TC-2.5b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "story-2-legacy-blocking-only-after-cutover"
        severity: "major"
        title: "Legacy placeholder chunks are only blocked after cutover starts, so all-legacy threads still select old lower-band state"
        evidence: "Story 2 says placeholder-era chunk state is blocked from lower-band selection after this epic (`docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md:92-121`). In code, legacy blocking is conditional: `src/thread/async-thread/domain/chunk-state.ts:68-69` only reports cutover when some chunk already has `schemaVersion === \"conversation_only_chunk_v1\"`, and both selection paths gate blocking behind that flag (`src/thread-view/services/thread-view-builder.ts:447-484`, `src/thread/async-thread/services/async-thread-run-service.ts:255-292`). The tests explicitly preserve the all-legacy path: `tests/thread-view/thread-view-builder.test.ts:419-439` selects lower-band chunks normally, while the blocker tests only pass after a test manually injects a new-schema chunk (`tests/thread-view/thread-view-builder.test.ts:507-555`, `tests/thread/async-thread-run-service.test.ts:568-616`). `src/thread/async-thread/domain/chunk-state.ts:60-62` also only recognizes legacy state when `placeholders !== undefined`, so schema-less chunks with cleared or omitted placeholder fields are not distinctly blocked."
        affectedFiles:
          - "src/thread/async-thread/domain/chunk-state.ts"
          - "src/thread/async-thread/services/chunk-service.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-builder.ts"
          - "tests/thread-view/thread-view-builder.test.ts"
          - "tests/thread/async-thread-run-service.test.ts"
        requirementIds:
          - "AC-2.6"
          - "TC-2.6b"
          - "TC-2.6c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "TC-2.1a"
        - "TC-2.1b"
        - "TC-2.3a"
        - "TC-2.3b"
        - "TC-2.3c"
        - "TC-2.5a"
        - "TC-2.6a"
      unverified:
        - "TC-2.4a"
        - "TC-2.4b"
        - "TC-2.5b"
        - "TC-2.6b"
        - "TC-2.6c"
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "The real lower-band runtime path still selects and budgets deterministic placeholder artifacts, and placeholder generation is still sourced from `chunk.smoothText` instead of the persisted `conversationTranscript`."
      - "Legacy placeholder chunks are only rejected after a thread already contains at least one `conversation_only_chunk_v1` chunk, so all-legacy threads can still treat old placeholder state as selectable lower-band output."
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
[]
    additionalObservations:
      - "Both configured gates passed locally, but the passing suite still accepts placeholder-backed lower-band runtime behavior; gate success does not currently prove Story 2's transcript-backed lower-band source contract."
      - "`test-plan.md:213-228` maps TC-2.4a, TC-2.4b, TC-2.5b, and TC-2.6c to `tests/thread/chunk-service.test.ts`, but that file currently stops at projection-count chunking, transcript persistence, and closed-membership stability (`tests/thread/chunk-service.test.ts:572-974`) and does not contain those explicit assertions."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/004-verify.json"
  startedAt: "2026-05-18T00:49:51.059Z"
  finishedAt: "2026-05-18T00:56:32.786Z"
```
</history_entry>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/005-implementor.json
bytes: 3698
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "28f82576-33a6-4119-931e-6b009d2b99ed"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e3895-eb9c-77a3-b2fb-b16d08da8218"
    continuation:
      provider: "codex"
      sessionId: "019e3895-eb9c-77a3-b2fb-b16d08da8218"
      storyId: "02-chunk-assembly-from-turn-projections"
    outcome: "ready-for-verification"
    story:
      id: "02-chunk-assembly-from-turn-projections"
      title: "Story 2: Chunk Assembly From Turn Projections"
    planSummary: "Completed the Story 2 chunk-assembly cutover by distinguishing canonical versus legacy chunk state, routing lower-band consumers through canonical semantic artifacts when present, preserving legacy blocking, and adding coverage for prepare-mode canonical lower-band readiness/materialization."
    changedFiles:
      -
        path: "src/thread/async-thread/domain/chunk-state.ts"
        reason: "Added canonical-vs-legacy chunk helpers and ready lower-band artifact lookup used by downstream selection/materialization."
      -
        path: "src/thread-view/services/thread-view-builder.ts"
        reason: "Generalized lower-band token accounting and chunk selection to consume canonical semantic artifacts while keeping legacy placeholder compatibility/blocking."
      -
        path: "src/thread-view/services/thread-view-materializer.ts"
        reason: "Materializes detailed/brief bands from canonical ready lower-band artifacts instead of assuming placeholder-only chunk state."
      -
        path: "src/thread/async-thread/services/async-thread-run-service.ts"
        reason: "Updated readiness/repair logic to recognize canonical semantic lower-band artifacts, keep legacy blocking explicit, and avoid placeholder-only assumptions."
      -
        path: "tests/thread-view/thread-view-builder.test.ts"
        reason: "Added prepare-mode coverage proving canonical semantic chunk artifacts can flow through lower-band selection/materialization without placeholder state."
      -
        path: "tests/thread/async-thread-run-service.test.ts"
        reason: "Added readiness coverage for canonical semantic chunk artifacts and preserved maintenance checks around legacy placeholder regeneration/counting."
    tests:
      added:
[]
      modified:
        - "tests/thread-view/thread-view-builder.test.ts"
        - "tests/thread/async-thread-run-service.test.ts"
      removed:
[]
      totalAfterStory: 479
      deltaFromPriorBaseline: 2
    gatesRun:
      -
        command: "node --import tsx --test tests/thread/chunk-service.test.ts tests/thread/async-thread-run-service.test.ts tests/thread-view/thread-view-builder.test.ts"
        result: "pass"
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Canonical semantic lower-band artifacts now participate in lower-band selection/materialization instead of being ignored by placeholder-only consumers."
        - "Legacy closed chunk records without new-schema markers are treated as placeholder-era state for maintenance/blocking instead of silently slipping through as canonical."
        - "Prepare-mode lower-band readiness no longer blocks canonical semantic artifacts just because placeholder token metadata is absent."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Proceed to Story 3 and build lower-band compression on top of the shared conversation transcript and canonical lower-band artifact routing."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/005-implementor.json"
  startedAt: "2026-05-18T00:56:49.626Z"
  finishedAt: "2026-05-18T01:14:17.122Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/006-verify.json
bytes: 9404
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "63cf6dc5-73c6-44c7-9e6f-e172ad683374"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e38a6-1424-7a71-acf2-ed67f0b2883a"
    continuation:
      provider: "codex"
      sessionId: "019e38a6-1424-7a71-acf2-ed67f0b2883a"
      storyId: "02-chunk-assembly-from-turn-projections"
    mode: "initial"
    story:
      id: "02-chunk-assembly-from-turn-projections"
      title: "Story 2: Chunk Assembly From Turn Projections"
    artifactsRead:
      - "docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md"
      - "docs/spec-build/epics/05-real-lower-band-compression/tech-design.md"
      - "docs/spec-build/epics/05-real-lower-band-compression/test-plan.md"
      - "src/thread/async-thread/domain/chunk-state.ts"
      - "src/thread/async-thread/domain/lower-band-artifact-state.ts"
      - "src/thread/async-thread/services/chunk-service.ts"
      - "src/thread/async-thread/services/lower-band-turn-projection-service.ts"
      - "src/thread/async-thread/services/async-thread-run-service.ts"
      - "src/thread/async-thread/services/placeholder-artifact-service.ts"
      - "src/thread-view/services/thread-view-builder.ts"
      - "src/thread-view/services/thread-view-materializer.ts"
      - "src/workbench/services/workbench-query-service.ts"
      - "src/token-accounting/materialized-representation-counter.ts"
      - "src/token-accounting/openai-input-token-counter.ts"
      - "src/thread/async-thread/test/fixtures.ts"
      - "tests/thread/chunk-service.test.ts"
      - "tests/thread/lower-band-turn-projection-service.test.ts"
      - "tests/thread/async-thread-run-service.test.ts"
      - "tests/thread/foundation.test.ts"
      - "tests/thread-view/thread-view-builder.test.ts"
      - "tests/thread-view/helpers.ts"
      - "tests/thread/placeholder-artifact-service.test.ts"
    reviewScopeSummary: "Reviewed Story 2 against the published story, tech design, and test plan; then inspected chunk assembly, projection-count consumption, legacy blocking, lower-band selection/materialization, placeholder generation, token-accounting fallbacks, and the story-mapped tests before running the story and epic gates."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-02-001"
        severity: "major"
        title: "Lower-band runtime still accepts placeholder/smooth-text output instead of the chunk conversation transcript"
        evidence: "`src/thread/async-thread/services/placeholder-artifact-service.ts:125-175` still validates and truncates `chunk.smoothText` when building detailed/brief output. `src/thread/async-thread/services/async-thread-run-service.ts:1143-1163` still regenerates those placeholders for legacy closed chunks, and `src/thread/async-thread/domain/chunk-state.ts:83-104` exposes ready placeholders through `getReadyChunkLowerBandArtifact()`. That helper is then consumed as real lower-band content by prepare selection (`src/thread/async-thread/services/async-thread-run-service.ts:324-340`) and materialization (`src/thread-view/services/thread-view-materializer.ts:422-436`). This keeps a live placeholder runtime path and uses smooth text, not `conversationTranscript`, as the lower-band source chain."
        affectedFiles:
          - "src/thread/async-thread/services/placeholder-artifact-service.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread/async-thread/domain/chunk-state.ts"
          - "src/thread-view/services/thread-view-materializer.ts"
        requirementIds:
          - "AC-2.4"
          - "TC-2.4a"
          - "TC-2.4b"
          - "AC-2.5"
          - "TC-2.5b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "SV-02-002"
        severity: "major"
        title: "Legacy placeholder chunks are only blocked after cutover starts, so all-legacy sessions remain selectable"
        evidence: "Both `src/thread/async-thread/services/async-thread-run-service.ts:251-305` and `src/thread-view/services/thread-view-builder.ts:450-508` gate legacy blocking on `hasConversationOnlyChunkCutover(chunks)`. The default strict rebuild happy path still passes on `seedDeterministicRebuildThread()` (`tests/thread-view/thread-view-builder.test.ts:87-110`), and that seed writes its closed chunks with `makeLegacyPlaceholderChunkState()` (`tests/thread-view/helpers.ts:513-575`). The blocker tests only cover the mixed-state case by manually injecting `schemaVersion: \"conversation_only_chunk_v1\"` before asserting the blocker (`tests/thread-view/thread-view-builder.test.ts:548-596`, `tests/thread/async-thread-run-service.test.ts:609-657`). This leaves all-legacy sessions selectable until a canonical closed chunk already exists."
        affectedFiles:
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-builder.ts"
          - "tests/thread-view/helpers.ts"
          - "tests/thread-view/thread-view-builder.test.ts"
          - "tests/thread/async-thread-run-service.test.ts"
        requirementIds:
          - "AC-2.6"
          - "TC-2.6b"
          - "TC-2.6c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "SV-02-001"
        severity: "major"
        title: "Lower-band runtime still accepts placeholder/smooth-text output instead of the chunk conversation transcript"
        evidence: "`src/thread/async-thread/services/placeholder-artifact-service.ts:125-175` still validates and truncates `chunk.smoothText` when building detailed/brief output. `src/thread/async-thread/services/async-thread-run-service.ts:1143-1163` still regenerates those placeholders for legacy closed chunks, and `src/thread/async-thread/domain/chunk-state.ts:83-104` exposes ready placeholders through `getReadyChunkLowerBandArtifact()`. That helper is then consumed as real lower-band content by prepare selection (`src/thread/async-thread/services/async-thread-run-service.ts:324-340`) and materialization (`src/thread-view/services/thread-view-materializer.ts:422-436`). This keeps a live placeholder runtime path and uses smooth text, not `conversationTranscript`, as the lower-band source chain."
        affectedFiles:
          - "src/thread/async-thread/services/placeholder-artifact-service.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread/async-thread/domain/chunk-state.ts"
          - "src/thread-view/services/thread-view-materializer.ts"
        requirementIds:
          - "AC-2.4"
          - "TC-2.4a"
          - "TC-2.4b"
          - "AC-2.5"
          - "TC-2.5b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "SV-02-002"
        severity: "major"
        title: "Legacy placeholder chunks are only blocked after cutover starts, so all-legacy sessions remain selectable"
        evidence: "Both `src/thread/async-thread/services/async-thread-run-service.ts:251-305` and `src/thread-view/services/thread-view-builder.ts:450-508` gate legacy blocking on `hasConversationOnlyChunkCutover(chunks)`. The default strict rebuild happy path still passes on `seedDeterministicRebuildThread()` (`tests/thread-view/thread-view-builder.test.ts:87-110`), and that seed writes its closed chunks with `makeLegacyPlaceholderChunkState()` (`tests/thread-view/helpers.ts:513-575`). The blocker tests only cover the mixed-state case by manually injecting `schemaVersion: \"conversation_only_chunk_v1\"` before asserting the blocker (`tests/thread-view/thread-view-builder.test.ts:548-596`, `tests/thread/async-thread-run-service.test.ts:609-657`). This leaves all-legacy sessions selectable until a canonical closed chunk already exists."
        affectedFiles:
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-builder.ts"
          - "tests/thread-view/helpers.ts"
          - "tests/thread-view/thread-view-builder.test.ts"
          - "tests/thread/async-thread-run-service.test.ts"
        requirementIds:
          - "AC-2.6"
          - "TC-2.6b"
          - "TC-2.6c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-2.1"
        - "TC-2.1a"
        - "TC-2.1b"
        - "AC-2.3"
        - "TC-2.3a"
        - "TC-2.3b"
        - "TC-2.3c"
        - "TC-2.5a"
        - "TC-2.6a"
      unverified:
        - "AC-2.4"
        - "TC-2.4a"
        - "TC-2.4b"
        - "AC-2.5"
        - "TC-2.5b"
        - "AC-2.6"
        - "TC-2.6b"
        - "TC-2.6c"
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "`getReadyChunkLowerBandArtifact()` still returns `kind: \"placeholder\"`, and that placeholder branch is consumed by prepare/materialization as if it were ready lower-band output."
      - "Legacy closed chunks are only blocked when `hasConversationOnlyChunkCutover(chunks)` is already true, so all-legacy sessions still flow through lower-band selection."
      - "Placeholder generation still truncates `chunk.smoothText`, not `chunk.conversationTranscript`, so the lower-band source chain is not yet conversation-only end to end."
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
[]
    additionalObservations:
      - "`npm run verify` and `npm run verify-all` both passed; the blockers are requirement and runtime-shape mismatches rather than gate failures."
      - "Coverage is strongest around projection-count chunking and transcript persistence; I did not find story-mapped service assertions that prove transcript-backed lower-band sourcing without the placeholder path."
      - "The default lower-band happy-path seed in `tests/thread-view/helpers.ts` still centers legacy placeholder closed chunks, which is why the gate does not currently catch the all-legacy cutover bug."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/006-verify.json"
  startedAt: "2026-05-18T01:14:28.543Z"
  finishedAt: "2026-05-18T01:24:24.204Z"
```
</history_entry>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/007-implementor.json
bytes: 4157
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "2803e96f-d780-491f-84ad-80752f2d8c5e"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e38af-5c8f-7af0-b6b4-e859d046439c"
    continuation:
      provider: "codex"
      sessionId: "019e38af-5c8f-7af0-b6b4-e859d046439c"
      storyId: "02-chunk-assembly-from-turn-projections"
    outcome: "ready-for-verification"
    story:
      id: "02-chunk-assembly-from-turn-projections"
      title: "Story 2: Chunk Assembly From Turn Projections"
    planSummary: "Completed Story 2 by wiring chunk assembly to exact conversation-only turn projection counts, persisting conversation-only chunk transcripts alongside smooth text, and blocking legacy placeholder-era chunks from lower-band selection once conversation-only cutover is present."
    changedFiles:
      -
        path: "src/thread/async-thread/domain/chunk-state.ts"
        reason: "Defines canonical vs legacy chunk state, schema-version cutover rules, and lower-band artifact selection helpers."
      -
        path: "src/thread/async-thread/domain/lower-band-artifact-state.ts"
        reason: "Adds persisted conversation transcript and semantic lower-band artifact record shapes for chunks."
      -
        path: "src/thread/async-thread/services/chunk-service.ts"
        reason: "Switches chunk boundary decisions to projection counts, assembles conversation-only transcripts in chunk order, preserves smooth text separately, and keeps closed membership stable."
      -
        path: "src/thread/async-thread/services/async-thread-run-service.ts"
        reason: "Blocks legacy placeholder-era chunks from readiness/selection once conversation-only chunk cutover has started and accepts canonical semantic chunk artifacts."
      -
        path: "src/thread-view/services/thread-view-builder.ts"
        reason: "Uses the new lower-band artifact helpers for selection/accounting and rejects legacy placeholder chunks after cutover."
      -
        path: "src/thread/async-thread/test/fixtures.ts"
        reason: "Adds canonical and legacy chunk fixtures for new schema-versioned conversation-only chunk state."
      -
        path: "tests/thread/chunk-service.test.ts"
        reason: "Covers projection-count-driven boundaries, transcript assembly, smooth-text separation, closed membership stability, and transcript refresh without membership mutation."
      -
        path: "tests/thread/async-thread-run-service.test.ts"
        reason: "Covers prepare-mode blocking for failed projection counts and legacy placeholder-era chunk readiness after cutover."
      -
        path: "tests/thread-view/thread-view-builder.test.ts"
        reason: "Covers lower-band selection compatibility with canonical semantic artifacts and legacy placeholder blocking."
      -
        path: "tests/thread/foundation.test.ts"
        reason: "Locks fixture/domain invariants for new-schema chunks versus legacy placeholder chunks."
    tests:
      added:
[]
      modified:
        - "tests/thread/chunk-service.test.ts"
        - "tests/thread/async-thread-run-service.test.ts"
        - "tests/thread-view/thread-view-builder.test.ts"
        - "tests/thread/foundation.test.ts"
      removed:
[]
      totalAfterStory: 476
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Chunk boundary evaluation now uses persisted exact conversation-only projection token counts instead of smooth-turn counts."
        - "Chunk state now persists a conversation-only transcript assembled from ordered turn projections while retaining smooth text as a separate representation."
        - "Closed chunk sourceTurnIds remain stable during maintenance, and legacy placeholder-era chunks are explicitly blocked after conversation-only cutover begins."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Implement Story 3 so detailed and brief lower-band generation consume `chunk.conversationTranscript` as their shared source."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/007-implementor.json"
  startedAt: "2026-05-18T01:24:36.904Z"
  finishedAt: "2026-05-18T01:32:47.072Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/009-verify.json
bytes: 10771
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "c2398237-5799-4a3e-8eb0-3cbcfca97758"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e38b7-ee9e-77f3-a02e-5da4067ffb72"
    continuation:
      provider: "codex"
      sessionId: "019e38b7-ee9e-77f3-a02e-5da4067ffb72"
      storyId: "02-chunk-assembly-from-turn-projections"
    mode: "initial"
    story:
      id: "02-chunk-assembly-from-turn-projections"
      title: "Story 2: Chunk Assembly From Turn Projections"
    artifactsRead:
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/domain/records.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/async-thread/domain/chunk-state.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/async-thread/domain/lower-band-artifact-state.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/async-thread/services/chunk-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/async-thread/services/async-thread-run-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/async-thread/services/placeholder-artifact-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread-view/services/thread-view-builder.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread-view/services/thread-view-materializer.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/token-accounting/materialized-representation-counter.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/token-accounting/openai-input-token-counter.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/async-thread/test/fixtures.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread-view/test/fixtures.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/thread/chunk-service.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/thread/async-thread-run-service.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/thread/foundation.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/thread-view/helpers.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/thread-view/thread-view-builder.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/commands/smart-compact.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/commands/smart-compact-lifecycle.integration.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
    reviewScopeSummary: "Reviewed the Story 2 spec, the full Epic 5 tech design, and the test plan; then inspected chunk state/assembly, legacy-blocking logic, placeholder lower-band runtime paths, builder/materializer selection, fixture seeding, and story-mapped tests before running both verification gates."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-02-001"
        severity: "major"
        title: "Lower-band runtime still emits smooth-text placeholder summaries instead of a conversation-transcript-backed source path"
        evidence: "`src/thread/async-thread/services/placeholder-artifact-service.ts:125-180` still validates and truncates `chunk.smoothText` to build detailed/brief placeholder artifacts. Those placeholders are still exposed as ready lower-band artifacts by `src/thread/async-thread/domain/chunk-state.ts:83-104`, selected during prepare/build via `src/thread/async-thread/services/async-thread-run-service.ts:324-340`, and emitted into Thread View messages by `src/thread-view/services/thread-view-materializer.ts:422-437`. The lifecycle integration test `tests/commands/smart-compact-lifecycle.integration.test.ts:601-603` still expects generated output to contain `deterministic-placeholder:*` markers. This is production-path evidence that lower-band output is still sourced from smooth-text placeholders rather than a conversation-transcript-backed path."
        affectedFiles:
          - "src/thread/async-thread/services/placeholder-artifact-service.ts"
          - "src/thread/async-thread/domain/chunk-state.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-materializer.ts"
          - "tests/commands/smart-compact-lifecycle.integration.test.ts"
        requirementIds:
          - "AC-2.4"
          - "TC-2.4a"
          - "TC-2.4b"
          - "AC-2.5"
          - "TC-2.5b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "SV-02-002"
        severity: "major"
        title: "Legacy placeholder chunks remain selectable in all-legacy sessions until a canonical chunk already exists"
        evidence: "`hasConversationOnlyChunkCutover()` only returns true when some chunk already has `schemaVersion === \"conversation_only_chunk_v1\"` (`src/thread/async-thread/domain/chunk-state.ts:109-110`). Both legacy-blocking call sites only reject placeholder chunks when that predicate is true (`src/thread/async-thread/services/async-thread-run-service.ts:251-289`, `src/thread-view/services/thread-view-builder.ts:452-492`). The default rebuild seed still writes both closed chunks as `makeLegacyPlaceholderChunkState(...)` while the only newer chunk is open (`tests/thread-view/helpers.ts:513-585`), and the happy-path strict rebuild test therefore remains `ready` (`tests/thread-view/thread-view-builder.test.ts:87-110`). The blocker test has to manually inject `schemaVersion: \"conversation_only_chunk_v1\"` before legacy rejection appears (`tests/thread-view/thread-view-builder.test.ts:548-596`)."
        affectedFiles:
          - "src/thread/async-thread/domain/chunk-state.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-builder.ts"
          - "tests/thread-view/helpers.ts"
          - "tests/thread-view/thread-view-builder.test.ts"
        requirementIds:
          - "AC-2.6"
          - "TC-2.6b"
          - "TC-2.6c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "SV-02-001"
        severity: "major"
        title: "Lower-band runtime still emits smooth-text placeholder summaries instead of a conversation-transcript-backed source path"
        evidence: "`src/thread/async-thread/services/placeholder-artifact-service.ts:125-180` still validates and truncates `chunk.smoothText` to build detailed/brief placeholder artifacts. Those placeholders are still exposed as ready lower-band artifacts by `src/thread/async-thread/domain/chunk-state.ts:83-104`, selected during prepare/build via `src/thread/async-thread/services/async-thread-run-service.ts:324-340`, and emitted into Thread View messages by `src/thread-view/services/thread-view-materializer.ts:422-437`. The lifecycle integration test `tests/commands/smart-compact-lifecycle.integration.test.ts:601-603` still expects generated output to contain `deterministic-placeholder:*` markers. This is production-path evidence that lower-band output is still sourced from smooth-text placeholders rather than a conversation-transcript-backed path."
        affectedFiles:
          - "src/thread/async-thread/services/placeholder-artifact-service.ts"
          - "src/thread/async-thread/domain/chunk-state.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-materializer.ts"
          - "tests/commands/smart-compact-lifecycle.integration.test.ts"
        requirementIds:
          - "AC-2.4"
          - "TC-2.4a"
          - "TC-2.4b"
          - "AC-2.5"
          - "TC-2.5b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "SV-02-002"
        severity: "major"
        title: "Legacy placeholder chunks remain selectable in all-legacy sessions until a canonical chunk already exists"
        evidence: "`hasConversationOnlyChunkCutover()` only returns true when some chunk already has `schemaVersion === \"conversation_only_chunk_v1\"` (`src/thread/async-thread/domain/chunk-state.ts:109-110`). Both legacy-blocking call sites only reject placeholder chunks when that predicate is true (`src/thread/async-thread/services/async-thread-run-service.ts:251-289`, `src/thread-view/services/thread-view-builder.ts:452-492`). The default rebuild seed still writes both closed chunks as `makeLegacyPlaceholderChunkState(...)` while the only newer chunk is open (`tests/thread-view/helpers.ts:513-585`), and the happy-path strict rebuild test therefore remains `ready` (`tests/thread-view/thread-view-builder.test.ts:87-110`). The blocker test has to manually inject `schemaVersion: \"conversation_only_chunk_v1\"` before legacy rejection appears (`tests/thread-view/thread-view-builder.test.ts:548-596`)."
        affectedFiles:
          - "src/thread/async-thread/domain/chunk-state.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread-view/services/thread-view-builder.ts"
          - "tests/thread-view/helpers.ts"
          - "tests/thread-view/thread-view-builder.test.ts"
        requirementIds:
          - "AC-2.6"
          - "TC-2.6b"
          - "TC-2.6c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-2.1"
        - "TC-2.1a"
        - "TC-2.1b"
        - "AC-2.3"
        - "TC-2.3a"
        - "TC-2.3b"
        - "TC-2.3c"
        - "TC-2.5a"
        - "TC-2.6a"
      unverified:
        - "AC-2.4"
        - "TC-2.4a"
        - "TC-2.4b"
        - "AC-2.5"
        - "TC-2.5b"
        - "AC-2.6"
        - "TC-2.6b"
        - "TC-2.6c"
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "`placeholder-artifact-service` still generates lower-band detailed/brief text from `chunk.smoothText`, and `thread-view-materializer` still emits those placeholder summaries into rollout messages."
      - "The lifecycle integration suite still asserts `deterministic-placeholder:*` markers in generated lower-band output, matching the live runtime path rather than a transcript-backed path."
      - "Legacy placeholder chunks are only blocked once a canonical `conversation_only_chunk_v1` chunk already exists, so persisted all-legacy sessions still pass selection/build flows."
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
[]
    additionalObservations:
      - "`npm run verify` and `npm run verify-all` both passed; the blockers are requirement/runtime-shape mismatches, not gate failures."
      - "`tests/thread/chunk-service.test.ts` provides solid direct evidence for projection-count boundary decisions, transcript assembly/order, smooth-text retention, and closed `sourceTurnIds` stability."
      - "Compatibility for future semantic artifacts is partly in place: `tests/thread/async-thread-run-service.test.ts` and `tests/thread-view/thread-view-builder.test.ts` show prepare/build can consume canonical `chunk.lowerBand` artifacts without placeholder token metadata, but that does not yet replace the live placeholder runtime path."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/009-verify.json"
  startedAt: "2026-05-18T01:33:58.583Z"
  finishedAt: "2026-05-18T01:41:56.443Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/001-current.json
Bytes: 3832

```yaml
storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
storyId: "02-chunk-assembly-from-turn-projections"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-implement completed with outcome ready-for-verification and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/004-verify.json"
    provenance: "current-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/005-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/006-verify.json"
    provenance: "current-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/007-implementor.json"
    provenance: "current-run"
  -
    kind: "final-package"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/001-final-package.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/009-verify.json"
    provenance: "current-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/010-implementor.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e38bf-76b9-74c1-b33b-057ff92b0bda"
    storyId: "02-chunk-assembly-from-turn-projections"
  storyVerifier:
    provider: "codex"
    sessionId: "019e38b7-ee9e-77f3-a02e-5da4067ffb72"
    storyId: "02-chunk-assembly-from-turn-projections"
latestEventSequence: 31
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "Latest verifier outcome is revise with two blocking open findings, so acceptance is prohibited. The smallest safe next action is another implementation pass focused only on the unresolved transcript-source and legacy-blocking requirements."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/010-implementor.json"
replayBoundary: null
updatedAt: "2026-05-18T01:52:34.936Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After this implementation pass, require a fresh verifier pass with outcome pass, no open findings, npm run verify evidence, and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-18T00:22:57.533Z; note="After implementation returns, verify evidence must include `npm run verify` plus direct proof for projection-count boundary decisions, transcript source sharing, smooth/transcript separation, closed membership stability, schema versioning, and legacy blocking."
- sequence=8; actionSequence=7; createdAt=2026-05-18T00:49:51.021Z; note="After verifier returns, do not accept unless final verifier outcome is pass, npm run verify is confirmed, and the legacy-blocking deviation is either judged compliant by verifier or resolved by ruling/fix."
- sequence=12; actionSequence=11; createdAt=2026-05-18T00:56:49.590Z; note="After the next implementation pass, require a verifier pass with no open findings and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."
- sequence=16; actionSequence=15; createdAt=2026-05-18T01:14:28.508Z; note="Accept only if this verifier pass returns outcome pass, no open findings remain, npm run verify is confirmed, and the verifier explicitly proves TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c."
- sequence=20; actionSequence=19; createdAt=2026-05-18T01:24:36.869Z; note="After this implementation pass, require a fresh verifier pass with outcome pass, no open findings, npm run verify evidence, and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."
- sequence=26; actionSequence=25; createdAt=2026-05-18T01:33:58.546Z; note="Accept only if this verifier returns outcome pass, no open findings remain, npm run verify is confirmed, and TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c are explicitly proven."
- sequence=30; actionSequence=29; createdAt=2026-05-18T01:42:12.142Z; note="After this implementation pass, require a fresh verifier pass with outcome pass, no open findings, npm run verify evidence, and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/001-events.jsonl
Bytes: 18306

```yaml
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 1
  timestamp: "2026-05-18T00:22:38.793Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 2
  timestamp: "2026-05-18T00:22:57.513Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e3876-a169-7e92-a103-5cc2b1205e15"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 3
  timestamp: "2026-05-18T00:22:57.533Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, verify evidence must include `npm run verify` plus direct proof for projection-count boundary decisions, transcript source sharing, smooth/transcript separation, closed membership stability, schema versioning, and legacy blocking."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 4
  timestamp: "2026-05-18T00:22:57.533Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, verify evidence must include `npm run verify` plus direct proof for projection-count boundary decisions, transcript source sharing, smooth/transcript separation, closed membership stability, schema versioning, and legacy blocking."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 5
  timestamp: "2026-05-18T00:49:38.323Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 6
  timestamp: "2026-05-18T00:49:51.000Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e388f-56f0-7140-b072-b04a7a08968a"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 7
  timestamp: "2026-05-18T00:49:51.020Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "After verifier returns, do not accept unless final verifier outcome is pass, npm run verify is confirmed, and the legacy-blocking deviation is either judged compliant by verifier or resolved by ruling/fix."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 8
  timestamp: "2026-05-18T00:49:51.021Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After verifier returns, do not accept unless final verifier outcome is pass, npm run verify is confirmed, and the legacy-blocking deviation is either judged compliant by verifier or resolved by ruling/fix."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 9
  timestamp: "2026-05-18T00:56:32.796Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/004-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 10
  timestamp: "2026-05-18T00:56:49.570Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/prompts/001-planner-turn-003.md"
    sessionId: "019e3895-a9df-7430-9493-eec761406a74"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 11
  timestamp: "2026-05-18T00:56:49.590Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 3
    selfNote: "After the next implementation pass, require a verifier pass with no open findings and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 12
  timestamp: "2026-05-18T00:56:49.590Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After the next implementation pass, require a verifier pass with no open findings and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."
    actionSequence: 11
    actionType: "run-implement"
    turn: 3
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 13
  timestamp: "2026-05-18T01:14:17.130Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/005-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 14
  timestamp: "2026-05-18T01:14:28.486Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/prompts/001-planner-turn-004.md"
    sessionId: "019e38a5-e791-7a22-ab0a-7f510ff5e542"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 15
  timestamp: "2026-05-18T01:14:28.508Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 4
    selfNote: "Accept only if this verifier pass returns outcome pass, no open findings remain, npm run verify is confirmed, and the verifier explicitly proves TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 16
  timestamp: "2026-05-18T01:14:28.508Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "Accept only if this verifier pass returns outcome pass, no open findings remain, npm run verify is confirmed, and the verifier explicitly proves TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c."
    actionSequence: 15
    actionType: "run-verify"
    turn: 4
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 17
  timestamp: "2026-05-18T01:24:24.213Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/006-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 18
  timestamp: "2026-05-18T01:24:36.848Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/prompts/001-planner-turn-005.md"
    sessionId: "019e38af-2afd-7942-9759-e773bd6f1c0f"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 19
  timestamp: "2026-05-18T01:24:36.869Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 5
    selfNote: "After this implementation pass, require a fresh verifier pass with outcome pass, no open findings, npm run verify evidence, and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 20
  timestamp: "2026-05-18T01:24:36.869Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After this implementation pass, require a fresh verifier pass with outcome pass, no open findings, npm run verify evidence, and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."
    actionSequence: 19
    actionType: "run-implement"
    turn: 5
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 21
  timestamp: "2026-05-18T01:32:47.080Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/007-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 22
  timestamp: "2026-05-18T01:33:00.338Z"
  type: "provider-output-invalid"
  summary: "Provider output did not match the expected JSON payload. root keys: action, rationale, inputs, selfNote; direct payload: inputs.artifactRefs: Invalid input: expected array, received undefined; raw stdout bytes=1412; raw stdout preview=\"{\\\"type\\\":\\\"thread.started\\\",\\\"thread_id\\\":\\\"019e38b6-d747-7aa2-b22c-c521e3c6d2e5\\\"}\\n{\\\"type\\\":\\\"turn.started\\\"}\\n{\\\"type\\\":\\\"item.completed\\\",\\\"item\\\":{\\\"id\\\":\\\"item_0\\\",\\\"type\\\":\\\"agent_message\\\",\\\"text\\\":\\\"{\\\\\\\"action\\\\\\\":\\\\\\\"run-verify\\\\\\\",\\\\\\\"rationale\\\\\\\":\\\\\\\"Latest implementor result reports ready-for-verification after addressing the prior two blocking verifier findings, but acceptance is not allowed without a fresh verifier pass. The smallest safe next action is to resume verification against the latest implementor artifact, with...[truncated]\"; raw stderr bytes=38; raw stderr preview=\"Reading additional input from stdin...\"; stdout log=/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/streams/001-story-lead.stdout.log; stderr log=/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/streams/001-story-lead.stderr.log; Reading additional input from stdin..."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/001-final-package.json"
  data:
    terminalDecision: "interrupted"
    recoveryBoundary:
      smallestSafeStep: "resume-from-last-valid-artifact"
      reasoning: "Provider output became invalid after durable artifacts were written, so replay should resume from the last valid artifact boundary."
      validArtifactPaths:
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/001-story-validate.json"
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/003-implementor.json"
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/004-verify.json"
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/005-implementor.json"
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/006-verify.json"
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/007-implementor.json"
      requiresFreshStoryLeadSession: false
      requiresFreshChildProviderSession: true
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/prompts/001-planner-turn-006.md"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 23
  timestamp: "2026-05-18T01:33:47.062Z"
  type: "story-run-resumed"
  summary: "Story orchestration resume started."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 24
  timestamp: "2026-05-18T01:33:58.523Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/prompts/001-planner-turn-007.md"
    sessionId: "019e38b7-c19c-7123-9ce0-a0791aab6b54"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 25
  timestamp: "2026-05-18T01:33:58.545Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 1
    selfNote: "Accept only if this verifier returns outcome pass, no open findings remain, npm run verify is confirmed, and TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c are explicitly proven."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 26
  timestamp: "2026-05-18T01:33:58.546Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "Accept only if this verifier returns outcome pass, no open findings remain, npm run verify is confirmed, and TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c are explicitly proven."
    actionSequence: 25
    actionType: "run-verify"
    turn: 1
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 27
  timestamp: "2026-05-18T01:41:56.454Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/009-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 28
  timestamp: "2026-05-18T01:42:12.121Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/story-lead/prompts/001-planner-turn-008.md"
    sessionId: "019e38bf-3a9a-7bd3-8250-bee904efe4bb"
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 29
  timestamp: "2026-05-18T01:42:12.142Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 2
    selfNote: "After this implementation pass, require a fresh verifier pass with outcome pass, no open findings, npm run verify evidence, and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 30
  timestamp: "2026-05-18T01:42:12.142Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After this implementation pass, require a fresh verifier pass with outcome pass, no open findings, npm run verify evidence, and explicit proof for TC-2.4a, TC-2.4b, TC-2.5b, TC-2.6b, and TC-2.6c before accepting."
    actionSequence: 29
    actionType: "run-implement"
    turn: 2
-
  storyRunId: "02-chunk-assembly-from-turn-projections-story-run-001"
  sequence: 31
  timestamp: "2026-05-18T01:52:34.936Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/02-chunk-assembly-from-turn-projections/010-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
```

## State Rules
### state-rules
Bytes: 2986

Requirements source for story-local acceptance: the story file and test plan below.
Current lifecycle state: awaiting_story_lead_action

Lifecycle rules:
State: initialized
Public status: running
Allowed actions: none
Meaning: Runtime scaffolding exists, but no planner turn or child operation has started yet.
Caller implication: Treat this as startup bookkeeping only; wait for the first planner transition before routing work.

State: awaiting_story_lead_action
Public status: running
Allowed actions: run-implement, run-continue, run-self-review, run-verify, run-quick-fix, accept-story, request-ruling, block-story, fail-story
Meaning: The durable record is ready and the next fresh story-lead turn may choose one bounded action.
Caller implication: Planner output is the next source of truth; the run is waiting for a valid bounded action selection.

State: running_child_operation
Public status: running
Allowed actions: none
Meaning: The runtime is executing one bounded child operation selected by the story lead.
Caller implication: Poll runtime artifacts instead of rerouting; the current child operation is still in flight.

State: recording_result
Public status: running
Allowed actions: none
Meaning: The child result or terminal decision is being written to durable artifacts before the next transition.
Caller implication: Do not treat the run as advanced until evidence and ledger updates are durably recorded.

State: terminal
Public status: terminal-only
Allowed actions: none
Meaning: A terminal public outcome has been recorded separately from lifecycleState and the story-lead loop will not continue automatically.
Caller implication: Read the public status and final package to decide impl-lead follow-up such as accept, reopen, or ruling.

Terminal outcome rules:
Outcome: accepted
Meaning: Story-lead evidence is complete enough to recommend acceptance for impl-lead review.
Caller implication: Impl-lead still owes receipt completion, verification gates, and the story commit before accepting the story.

Outcome: needs-ruling
Meaning: The run reached a boundary that requires an explicit caller or maintainer decision.
Caller implication: Surface the ruling request instead of guessing or downgrading the decision into cleanup debt.

Outcome: blocked
Meaning: A named blocker prevents safe forward progress with the current inputs or runtime state.
Caller implication: Resolve the blocker or change the plan before resuming; do not pretend the story is ready to continue.

Outcome: failed
Meaning: An unrecoverable runtime or planner failure ended the current story-lead attempt.
Caller implication: Inspect the failure details and durable artifacts before deciding whether to replay or open a new attempt.

Outcome: interrupted
Meaning: The run stopped before a planned transition finished, usually because the caller or runtime interrupted it.
Caller implication: Use status or resume against the durable artifacts to continue from the last safe checkpoint.

## Runtime Settings
### runtime-settings
Bytes: 215

```yaml
storyGate: "npm run verify"
epicGate: "npm run verify-all"
plannerTimeoutMs: 600000
wholeRunTimeoutMs: 7200000
providerStartupTimeoutMs: 300000
providerActiveSilenceTimeoutMs: 600000
```

## Action Protocol
Return exactly one JSON object matching `StoryLeadAction`.

Examples:
{"action":"run-implement","rationale":"...","inputs":{"promptAddendum":"optional"},"selfNote":"optional durable reminder"}
{"action":"run-continue","rationale":"...","inputs":{"continuationRef":"storyImplementor","promptAddendum":"..."}}
{"action":"run-self-review","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"focus":"optional","continuationRef":"storyImplementor","passes":1}}
{"action":"run-verify","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"focus":"optional","provider":"codex"}}
{"action":"run-verify","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"verifierContinuationRef":"storyVerifier","responseArtifactRef":"/abs/path.json"}}
{"action":"run-quick-fix","rationale":"...","inputs":{"findingRefs":["finding-001"],"remediationGoal":"...","workingDirectory":"optional"}}
{"action":"request-ruling","rationale":"...","inputs":{"decisionType":"...","question":"...","defaultRecommendation":"...","evidence":["..."],"allowedResponses":["..."]}}
{"action":"accept-story","rationale":"...","inputs":{"summary":"...","acceptanceCheckRefs":["..."],"acceptanceChecks":[{"name":"...","status":"pass","evidence":["..."],"reasoning":"..."}],"recommendedImplLeadAction":"accept"},"verification":{"finalVerifierOutcome":"pass","findings":[{"id":"...","status":"fixed","evidence":["..."]}]}}
{"action":"block-story","rationale":"...","inputs":{"reason":"...","detail":"optional","evidence":["..."]},"verification":{"finalVerifierOutcome":"block","findings":[{"id":"...","status":"unresolved","evidence":["..."]}]}}
{"action":"fail-story","rationale":"...","inputs":{"reason":"...","detail":"optional","evidence":["..."]}}

Rules:
- Choose exactly one bounded next action.
- Use only the durable story-run record in this prompt. Do not assume hidden retained planner memory exists.
- Treat `<current_response>` as the latest bounded child response and `<history_responses>` as older response history.
- If the story file and test plan are insufficient for a safe next step, request a ruling instead of asking for epic, tech design, git status, or git diff by default.
- Include `selfNote` only when you want to leave a durable reminder for a later planner turn.

## Acceptance Rubric
Choose the smallest safe bounded action that advances the story using the durable evidence already present.
Prefer continuing from valid child-operation evidence over repeating work, and keep unresolved authority-boundary questions explicit.

## Acceptance Decision Standard
Choose `accept-story` only when the latest verifier result is `pass`, no open findings remain, required proof is present, and the configured story gate passed.
If readiness is promising but gate truth is failed, unavailable, or uncertain, do not accept. Choose the smallest safe next action: verify, quick-fix, block, or request a ruling.

## Ruling Boundaries
Request a ruling when story-local requirements are insufficient, when a blocker needs a caller decision, or when the evidence conflicts in a way that the durable record cannot resolve safely.
