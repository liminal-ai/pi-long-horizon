# Story Lead Base Prompt

## Role Charter
You are the story lead for `06-remove-placeholder-runtime-path` on durable story run `06-remove-placeholder-runtime-path-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 2.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/stories/06-remove-placeholder-runtime-path.md
Bytes: 9293

# Story 6: Remove Placeholder Runtime Path

### Summary
<!-- Jira: Summary field -->

Deterministic placeholder detailed/brief generation is removed from normal runtime behavior and tests no longer bless placeholder fallback.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands.

**Objective:** After this story, the deterministic placeholder generator is not reachable through normal smart compact or runtime selection. Old placeholder state is never treated as ready lower-band output. Tests that previously asserted deterministic placeholder lower-band generation are removed or rewritten to assert real lower-band behavior.

**Scope:**

In scope:
- Placeholder generator unreachable through normal compact/runtime path
- Placeholder-era output not emitted for selected lower bands
- Old placeholder state not treated as ready
- Tests that blessed placeholder behavior removed or rewritten
- No runtime compatibility shim preserved for placeholder output
- New code must not deepen imports into placeholder services
- E2E assertion, piggybacking on Story 5's PI runtime path, that generated rollout output contains no deterministic placeholder fallback

Out of scope:
- Removing placeholder code from the repo entirely (it may stay as dead code for reference until a cleanup pass)
- Polished migration of old sessions (operator clears them)
- Formal eval of the replacement output quality

**Dependencies:** Story 5 complete.

**Story type:** Packaging / cutover

**Governing idea:** Placeholder lower-band output is impossible to reach at runtime after cutover.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.4:** Smart compact does not use deterministic placeholder output as a runtime fallback.

- **TC-4.4a: Placeholder output is not emitted for selected lower bands**
  - Given: selected lower-band semantic output is missing or failed
  - When: smart compact prepares generated session output
  - Then: it does not emit deterministic placeholder detailed or brief text
- **TC-4.4b: Old placeholder state is not treated as ready**
  - Given: a Chunk has old deterministic placeholder lower-band data but no real semantic lower-band output
  - When: smart compact validates lower-band readiness
  - Then: the Chunk is not treated as ready for selected detailed or brief output

**AC-4.5:** Existing placeholder generation is removed from normal runtime behavior.

- **TC-4.5a: Placeholder generator is not reachable through normal compact**
  - Given: smart compact needs lower-band output
  - When: normal runtime behavior runs
  - Then: the deterministic placeholder generator is not invoked as a fallback
- **TC-4.5b: Placeholder tests are replaced**
  - Given: tests previously asserted deterministic placeholder lower-band generation
  - When: the epic's tests are reviewed
  - Then: those tests have been removed or rewritten to assert real lower-band behavior

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This is the runtime ownership cutover story. By the time it starts, the new
lower-band path should already be real enough that placeholders are no longer a
necessary compatibility bridge. The story does not need to delete all
placeholder-era code from the repo, but it does need to make runtime selection,
reporting, and tests behave as though placeholders are dead.

The shape here is important: legacy state may still be recognized so the system
can block or report it, but not to satisfy readiness. That distinction is what
prevents “temporary compatibility” from quietly becoming a second product path.

#### Build Strategy

Strategy: `simple-risk-reminders`

Reason:
- the conceptual center is strong: cut runtime selection away from placeholders
- most of the work is coordinated surface cleanup, not a new algorithm
- the risk is shim creep more than raw implementation complexity

Risk Reminders:
- remove placeholder validity from every consumer that can bless runtime
  readiness
- keep legacy-state inspection/reporting without letting it satisfy readiness
- rewrite tests so they fail if placeholder success behavior is still reachable

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Prepare/runtime lower-band selection | `src/thread/async-thread/services/async-thread-run-service.ts`, `src/commands/smart-compact.ts` |
| Runtime projection and materialization | `src/thread-view/services/thread-view-builder.ts`, `src/thread-view/services/thread-view-materializer.ts`, `src/thread-view/targets/pi/pi-thread-view-builder.ts` |
| Workbench/query/reporting cutover | `src/workbench/services/workbench-query-service.ts`, `src/workbench/services/workbench-search-service.ts`, `src/workbench/services/compaction-report-service.ts`, `src/workbench/services/active-rollout-inspection-service.ts` |
| PI command surface | `src/context-steward/pi/pi-extension.ts` |
| Placeholder-era tests and fixtures | `tests/commands/smart-compact.test.ts`, placeholder-focused thread/workbench fixtures and related tests |

#### Design References

- [tech-design.md §Placeholder Cutover Inventory](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:313), lines 313-343
- [tech-design.md §Architecture Decisions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:219), lines 227-237
- [tech-design.md §Chunk 6: Placeholder Runtime Path Removal And Legacy Blocking](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:986), lines 986-1001
- [test-plan.md §tests/commands/smart-compact.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:245), lines 245-252
- [test-plan.md §Non-TC Architecture-Risk Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:295), lines 295-314

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-4.4a`, `TC-4.4b` | `tests/commands/smart-compact.test.ts` | placeholder output is never emitted and old placeholder state never satisfies lower-band readiness |
| `TC-4.5a`, `TC-4.5b` | `tests/commands/smart-compact.test.ts` | placeholder generator is unreachable in runtime behavior and tests no longer depend on placeholder success |

#### Non-TC Decided Tests

- `tests/commands/smart-compact.test.ts`: runtime path cannot invoke placeholder generator after cutover
- `tests/context-workbench/workbench-query-service.test.ts`, `tests/context-workbench/workbench-search-service.test.ts`: workbench summaries stop presenting placeholder output as valid semantic lower-band state
- `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts`: the Story 5 runtime continuation E2E also asserts generated rollout output contains semantic lower-band text and no deterministic placeholder detailed/brief fallback

#### Technical Notes

- This story is about runtime selection and reporting behavior, not necessarily
  full code deletion. Dead code cleanup can happen later if it stays unreachable.
- The workbench/query surfaces are part of the cutover, not a trailing cleanup.
- New code should not deepen imports into placeholder services even if existing
  placeholder code remains in the tree temporarily.
- The E2E requirement should extend the Story 5 PI runtime scenario. Do not add
  a separate full long-thread E2E solely for placeholder removal unless the
  shared runtime path cannot expose the assertion.

#### Anti-Shim Requirements

- Do not leave a hidden “just in case” placeholder fallback in compact, builder,
  materializer, or workbench paths.
- Do not preserve placeholder readiness in workbench/query output to make the
  operator experience look more complete.
- Do not count a story as done if the tests merely stop mentioning placeholders;
  they need to fail when placeholder success behavior is still reachable.
- Do not satisfy the E2E by checking only service-tier state; the final generated
  rollout artifact must be free of placeholder fallback text.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Placeholder generator not invoked by normal compact/builder/materializer path
- [ ] Placeholder-era output never emitted for selected lower bands
- [ ] Old placeholder state not treated as ready
- [ ] No runtime-facing test depends on placeholder success behavior
- [ ] No new code deepens imports into placeholder services
- [ ] Story 5 PI runtime E2E includes placeholder-free generated rollout assertion
- [ ] `npm run verify` passes
- [ ] `npm run verify-all` passes with the placeholder-free runtime assertion
- [ ] Architecture-risk test: runtime path cannot invoke placeholder generator after cutover


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
- planner_turn_index: 2
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-implement completed with outcome ready-for-verification and status ok.
- latest_response_kind: implementor-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/003-implementor.json
- older_response_count: 0
- caller_input_artifact_count: 0
- prior_self_note_count: 1
- latest_self_note: "First child operation should return concrete implementation evidence plus verification status before any self-review or acceptance decision."

## Response Trail
<current_response>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/003-implementor.json
bytes: 4119
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "f30854ac-8765-48bb-9ba5-b1466edb334f"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e397d-70dc-7881-9d9a-5582d6ec5d9e"
    continuation:
      provider: "codex"
      sessionId: "019e397d-70dc-7881-9d9a-5582d6ec5d9e"
      storyId: "06-remove-placeholder-runtime-path"
    outcome: "ready-for-verification"
    story:
      id: "06-remove-placeholder-runtime-path"
      title: "Story 6: Remove Placeholder Runtime Path"
    planSummary: "Cut the remaining placeholder-era runtime shim from async readiness, stopped workbench and PI rollout surfaces from blessing placeholder summaries as semantic output, removed the placeholder-generator success suite, and extended verification so generated rollout artifacts explicitly stay placeholder-free."
    changedFiles:
      -
        path: "src/thread/async-thread/services/async-thread-run-service.ts"
        reason: "Removed the placeholder-artifact freshness shim from normal readiness/token-repair flow so runtime no longer depends on placeholder services."
      -
        path: "src/workbench/services/workbench-query-service.ts"
        reason: "Switched chunk inspection to semantic lower-band artifacts and legacy blocking instead of surfacing placeholder summaries as ready output."
      -
        path: "src/thread-view/targets/pi/pi-thread-view-builder.ts"
        reason: "Stopped PI-target metadata from marking semantic lower-band summaries as placeholder-explicit output."
      -
        path: "tests/context-workbench/workbench-query-service.test.ts"
        reason: "Rewrote lower-band inspection expectations to assert semantic summaries for canonical chunks and blocked legacy placeholder chunks."
      -
        path: "tests/thread-view/pi-thread-view-builder.test.ts"
        reason: "Added coverage proving semantic lower-band PI output is not flagged as placeholder-explicit."
      -
        path: "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
        reason: "Extended the Story 5 runtime E2E to assert generated rollout files contain no deterministic placeholder fallback markers."
      -
        path: "tests/workbench/workbench-lower-band.integration.test.ts"
        reason: "Updated canonical lower-band readiness expectations to reflect real semantic artifact eligibility."
      -
        path: "tests/thread/placeholder-artifact-service.test.ts"
        reason: "Removed the placeholder-generator success suite so tests no longer bless the dead placeholder runtime path."
    tests:
      added:
[]
      modified:
        - "tests/context-workbench/workbench-query-service.test.ts"
        - "tests/thread-view/pi-thread-view-builder.test.ts"
        - "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
        - "tests/workbench/workbench-lower-band.integration.test.ts"
      removed:
        - "tests/thread/placeholder-artifact-service.test.ts"
      totalAfterStory: 502
      deltaFromPriorBaseline: -3
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
        - "Removed the remaining runtime import/update path that kept placeholder artifact provenance alive during async token-count repair."
        - "Workbench chunk reads now expose semantic lower-band summaries for canonical chunks and treat legacy placeholder chunks as blocked inspection state."
        - "Generated PI rollout assertions now prove placeholder markers are absent and metadata no longer labels semantic lower-band output as placeholder-explicit."
        - "Removed the placeholder-artifact success test suite so the test corpus no longer blesses deterministic placeholder generation as acceptable runtime behavior."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Hand the story to verification to review the cutover diffs and confirm the placeholder-free rollout assertions cover the intended runtime path end to end."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/003-implementor.json"
  startedAt: "2026-05-18T05:09:42.517Z"
  finishedAt: "2026-05-18T05:24:04.637Z"
```
</current_response>

<history_responses>
No older response entries are recorded yet.
</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/story-lead/001-current.json
Bytes: 1873

```yaml
storyRunId: "06-remove-placeholder-runtime-path-story-run-001"
storyId: "06-remove-placeholder-runtime-path"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-implement completed with outcome ready-for-verification and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/003-implementor.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e397d-70dc-7881-9d9a-5582d6ec5d9e"
    storyId: "06-remove-placeholder-runtime-path"
latestEventSequence: 5
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "No bounded child operation has run yet, and the story-local requirements are sufficient to begin the implementation pass. The smallest safe next step is to dispatch an implementor to cut over runtime behavior and tests away from deterministic placeholder fallback, then return evidence for review."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/003-implementor.json"
replayBoundary: null
updatedAt: "2026-05-18T05:24:04.646Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: First child operation should return concrete implementation evidence plus verification status before any self-review or acceptance decision.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-18T05:09:42.482Z; note="First child operation should return concrete implementation evidence plus verification status before any self-review or acceptance decision."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/story-lead/001-events.jsonl
Bytes: 2176

```yaml
-
  storyRunId: "06-remove-placeholder-runtime-path-story-run-001"
  sequence: 1
  timestamp: "2026-05-18T05:09:30.511Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "06-remove-placeholder-runtime-path-story-run-001"
  sequence: 2
  timestamp: "2026-05-18T05:09:42.460Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e397d-42eb-7e63-a5ed-91090e532c8e"
-
  storyRunId: "06-remove-placeholder-runtime-path-story-run-001"
  sequence: 3
  timestamp: "2026-05-18T05:09:42.481Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "First child operation should return concrete implementation evidence plus verification status before any self-review or acceptance decision."
-
  storyRunId: "06-remove-placeholder-runtime-path-story-run-001"
  sequence: 4
  timestamp: "2026-05-18T05:09:42.482Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "First child operation should return concrete implementation evidence plus verification status before any self-review or acceptance decision."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "06-remove-placeholder-runtime-path-story-run-001"
  sequence: 5
  timestamp: "2026-05-18T05:24:04.646Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/artifacts/06-remove-placeholder-runtime-path/003-implementor.json"
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
