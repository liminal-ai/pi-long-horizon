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

- service-mock tests over public service or command entry points
- real-temp-store tests for persistence/reopen behavior where filesystem is part
  of the product contract
- full integration tests over the real GPT OAuth lower-band path

Epic 5 does not require a formal eval harness in this phase. It does require
that the real provider path be exercised in curated integration tests and that
placeholder fallback be impossible in the runtime path.

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
  foundation.test.ts
  lower-band-turn-projection-service.test.ts
  chunk-service.test.ts
  lower-band-compression-service.test.ts
  lower-band-compression.integration.test.ts
  async-thread-run-service.test.ts

tests/thread-view/
  thread-view-builder.test.ts

tests/workbench/
  lower-band-inspection-service.test.ts
  compaction-report-service.test.ts
  active-rollout-inspection-service.test.ts

tests/context-steward/
  pi-extension-commands.test.ts

tests/commands/
  smart-compact.test.ts
```

Per-file exact test counts are intentionally not final in this first-pass plan.
The current artifact proves full TC coverage and chunk-level test budgeting. A
mechanical reconciliation pass should lock per-file totals after implementation
stabilizes the final test names and any split/merge of closely related cases.

### Meaningful Verification Layers

| Layer | Command | Meaning For Epic 5 |
|---|---|---|
| Fast/default | `npm run verify` | Typecheck plus service-mock suite over public entry points |
| Real integration | `npm run test:integration` | Real GPT OAuth detailed/brief path with local auth/network/model expectations |
| Full gate | `npm run verify-all` | `verify` + integration + optional E2E suite; for Epic 5, lower-band confidence comes primarily from `verify` + `test:integration` |

`test:e2e` may remain empty early in the epic because the repo’s runner exits
successfully for empty E2E suites. That must not be mistaken for lower-band E2E
coverage. The test plan therefore treats `test:integration` as the real story
acceptance integration gate.

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
| GPT OAuth compression provider | Mock in service-mock tests; real in `.integration.test.ts` |
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

### `tests/thread/lower-band-compression.integration.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-6.2a | detailed integration path runs | Real GPT OAuth config plus ready transcript fixture | Detailed generation succeeds end to end |
| TC-6.2b | brief integration path runs | Real GPT OAuth config plus ready transcript fixture | Brief generation succeeds end to end |
| TC-6.3a | missing OAuth setup fails integration gate | No credential configured | Integration test fails with actionable auth/config error |
| TC-6.3b | broken model wiring fails integration gate | Credential exists but provider wiring invalid | Integration test fails explicitly |

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

### `tests/workbench/lower-band-inspection-service.test.ts`

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
| TC-6.4b | `npm run test:integration` acceptance evidence | Real integration gate required for Story 3 and every later story | Story acceptance gate |
| TC-6.4c | Story 3+ acceptance evidence | Compression stories cannot be accepted until the real GPT OAuth integration gate exists and passes | Story sequencing/gate rule |

## Non-TC Architecture-Risk Tests

These are not optional extras. They exist because Epic 5 introduces architecture
hazards that AC/TC coverage alone will miss.

| Risk | Test File | Test Description | Why AC/TC Mapping Alone Would Miss It |
|---|---|---|---|
| Lost update on Turn projection writes | `tests/thread/lower-band-turn-projection-service.test.ts` | Two stale writers cannot clobber each other’s projection state | Epic requires projection correctness, not the file-backed lost-update hazard itself |
| Lost update on lower-band artifact writes | `tests/thread/lower-band-compression-service.test.ts` | Concurrent or repeated writes cannot erase fresher detailed/brief state | Epic requires final readiness/failure, not stale writer behavior |
| Reopen/restart survival | `tests/thread/lower-band-compression.integration.test.ts` | Fresh store instance can read persisted projection/transcript/lower-band output state | Epic describes readiness, not restart survival mechanics |
| Partial smart compact failure leaves no active bad output | `tests/commands/smart-compact.test.ts` | Failure after catch-up or before final write does not leave a partially active generated output | Epic requires specific failure, but not partial-write safety details |
| Fixture lifecycle validity | `tests/thread/foundation.test.ts` | Default Chunk fixtures are valid; invalid fixtures explicit | Epic does not describe fixture contracts |
| Legacy placeholder state blocked | `tests/thread/chunk-service.test.ts` | Placeholder-era Chunk fixture is blocked and distinguishable | Epic says old state is not ready, but not how to prove fixture/state separation |
| No placeholder runtime deepening | `tests/commands/smart-compact.test.ts` | Runtime path cannot invoke placeholder generator after cutover | Epic forbids it, but a design-specific anti-regression test is still needed |
| Real prior-story artifact use | `tests/thread/chunk-service.test.ts`, `tests/thread/async-thread-run-service.test.ts` | Later tests consume actual projection/transcript state, not fake eligibility flags | AC coverage can still accidentally use shims unless the plan forbids it |
| Exact threshold golden cases | `tests/thread/chunk-service.test.ts` | Boundary cases for min/soft max/hard max use fixed expected decisions | Mirrored helper logic could pass while both implementation and test misunderstand the rule |
| Meaningful integration gate | `tests/thread/lower-band-compression.integration.test.ts` | Integration suite fails when config missing and runs real provider path when present | `verify-all` could otherwise sound stronger than it is |

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

## Integration Tests

Epic 5’s integration suite should stay curated and real.

| File | Purpose | Uses Real GPT OAuth? |
|---|---|---|
| `tests/thread/lower-band-compression.integration.test.ts` | Detailed/brief generation against the real provider path, auth/config failure behavior, reopen survival | Yes |
| `tests/workbench/workbench-lower-band.integration.test.ts` | Lower-band-ready state reflected through persisted thread/chunk/workbench path | No, unless useful for one representative path |

Integration expectations:

- run through `npm run test:integration`
- fail when no integration tests exist
- fail when GPT OAuth config/wiring is missing for the real lower-band provider test
- do not silently downgrade to mocked provider behavior

## E2E Tests

Epic 5 does not require a new E2E suite in the first pass. The repo’s `test:e2e`
script may therefore remain empty early in the epic. That is acceptable only if
we do not over-read `verify-all` as lower-band E2E confidence.

If a later pass adds an E2E test, the most valuable candidate is:

- operator-triggered smart compact through the PI extension command surface with
  lower-band-ready semantic outputs and generated-session rewrite proof

## Verification Commands

| Command | Purpose | Epic 5 Meaning |
|---|---|---|
| `npm run red-verify` | Red exit gate | Type-only / scaffold sanity before Green |
| `npm run verify` | Fast/default story gate | Required for every story |
| `npm run green-verify` | Green exit gate | Recommended during implementation |
| `npm run test:integration` | Real lower-band integration gate | Required for Story 3 and every later story |
| `npm run verify-all` | Full gate | Used for later epic-level or pre-release confidence; do not treat empty E2E as lower-band coverage |

## Related Documentation

- Epic: [epic.md](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/epic.md)
- Tech design: [tech-design.md](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md)
- Technical architecture: [technical-architecture.md](/Users/leemoore/code/pi-long-horizon/docs/spec-build/technical-architecture.md)
