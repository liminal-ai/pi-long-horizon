# Test Plan: Context Workbench

## Purpose

This test plan maps every Test Condition from Epic 2 to a concrete test file and behavior. It is the authoritative TC-to-test matrix for Context Workbench implementation. The tech design index explains architecture and interfaces; this document tells implementers exactly where confidence comes from.

Feature 2 has 65 epic TCs. This plan maps each TC to one primary test. It also adds 11 non-TC decided tests for design risks that are not captured one-to-one in the epic.

## Test Architecture

Tests follow the service-mock philosophy from Epic 1. Enter through public workbench services, exercise internal modules together, and mock only true external boundaries. The highest-value tests are store-snapshot-driven:

- create a Thread with known Messages, Turns, imports, projection metadata, and chunk artifacts
- create one or more Thread Views with known band selections
- invoke the workbench service under test
- assert on returned summaries, detail payloads, emitted message sequences, or state transitions

The service suite remains the primary confidence layer, but the E2E suite should still cover the real seams introduced by Feature 2. It should stay much smaller than the service suite while still exercising:

- opening a real Thread with a real active Thread View
- creating an empty draft Thread View through the real entry surface
- composing upper bands into a real draft
- comparing draft and active views
- activating a draft and archiving the prior active view
- opening fixture Threads through the same workbench surface

It should also include the most meaningful edge cases for those seams:

- Thread with no active Thread View
- Thread with no Turns when draft creation is attempted
- activation when emitted output is required but missing
- lower-band blocker visibility when a selected chunk is open or missing required summary artifacts
- source-safety after Thread View edits and activation

| Boundary | Test Treatment |
|---|---|
| Canonical Thread store | Use real temp directories and real Thread snapshots. This is already-proven infrastructure and remains a core read boundary. |
| Thread View store | Use real temp directories. Thread View persistence is core behavior for Feature 2. |
| Internal workbench services | Do not mock. Internal wiring is part of the behavior. |
| Future command or UI adapters | Fake only the adapter boundary if adapter tests are added later. |
| Search ranking/truncation policy | Exercise through workbench search service, not through isolated string-only tests. |

Primary test locations:

```text
tests/context-workbench/
  foundation.test.ts
  thread-view-store.test.ts
  workbench-query-service.test.ts
  workbench-search-service.test.ts
  thread-view-edit-service.test.ts
  thread-view-materializer.test.ts
  thread-view-compare-service.test.ts
  thread-view-activation-service.test.ts
  file-thread-view-store.integration.test.ts
```

## Mock and Fixture Strategy

Fixtures should live in `src/context-workbench/test/fixtures.ts` for reusable builders and in temp store helpers that can write both canonical Thread state and Thread View state into an isolated `.context-steward` root.

Required builders:

| Builder | Purpose |
|---|---|
| `makeThreadView()` | Build active, draft, or archived Thread View records with selected bands. |
| `makeBandRecord()` | Build full-fidelity, smooth, detailed, or brief band selections. |
| `makeThreadViewMessage()` | Build materialized emitted Thread View messages. |
| `makeWorkbenchSearchInput()` | Build search requests with content query and metadata filters. |
| `makeThreadSnapshot()` | Reuse Epic 1 canonical Thread snapshot builders for source state. |
| `withTempWorkbenchStore()` | Create isolated source Thread + Thread View temp roots and clean them up. |

## TC Mapping

### `workbench-query-service.test.ts`

This file owns primary confidence for opening Threads, reading active Thread Views, full-detail inspection, lower-band awareness, and record pivots. It carries more TCs than the other files because those concerns all share the same high-leverage query-entry seam over realistic Thread and Thread View state rather than separate mutation paths.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-1.1a | shows source Thread and active view separately | Thread with one active view | `openThread` | Result contains distinct thread and active-view identity |
| TC-1.1b | reads Thread with no active view | Thread without Thread Views | `openThread` | Result still returns source Thread and explicit missing active view |
| TC-1.2a | reports usable Thread | Thread with no blockers | `openThread` | `usableStatus` is ready |
| TC-1.2b | reports blocked or degraded Thread | Thread with known blocker state | `openThread` | Blocker surfaced at reader-usable level |
| TC-1.3a | shows active view band regions | Active Thread View with populated bands | `openThread` | All band regions visible in order |
| TC-1.3b | shows empty band explicitly | Active Thread View with empty band | `openThread` | Empty band present, not omitted |
| TC-1.4a | lists active draft archived views | Thread with multiple view states | `openThread` | All views returned with state |
| TC-1.4b | shows one active view invariant | Thread with one active view | `openThread` | Exactly one active view in result |
| TC-1.5a | opens fixture Thread through same read surface | Fixture Thread snapshot | `openFixtureThread` | Fixture result matches normal Thread inspection shape |
| TC-3.1a | opens full message detail | Message with multiple Parts | `openMessageDetail` | All Parts returned in order |
| TC-3.1b | message detail includes source metadata | Message with source order and actor metadata | `openMessageDetail` | Metadata present |
| TC-3.2a | opens full Turn detail | Turn with member Messages | `openTurnDetail` | Member Messages returned in source order |
| TC-3.2b | turn detail includes current view relationship | Turn included in active view | `openTurnDetail` | View placement present |
| TC-3.3a | Thread View detail shows all bands | Thread View with multiple populated bands | `openThreadViewDetail` | All band regions returned |
| TC-3.3b | Thread View detail includes emitted result | Thread View with materialized output | `openThreadViewDetail` | Emitted message sequence present |
| TC-3.4a | pivots from message to turn | Message in a known Turn | `openMessageDetail` | Turn pivot returned |
| TC-3.4b | pivots from turn to Thread View placement | Turn in active or draft view | `openTurnDetail` | View pivot returned |
| TC-3.4c | pivots from band selection to source detail | Thread View band with selected turns or chunks | `openThreadViewDetail` | Source pivots returned |
| TC-6.1a | detailed band uses chunk selections | Thread View with detailed band | `openThreadViewDetail` | Detailed band source units are chunks |
| TC-6.1b | brief band uses chunk selections | Thread View with brief band | `openThreadViewDetail` | Brief band source units are chunks |
| TC-6.2a | open chunk not eligible for detailed band | Open chunk in source Thread | `inspectLowerBandReadiness` | Open chunk excluded from detailed-band eligibility |
| TC-6.2b | open chunk not eligible for brief band | Open chunk in source Thread | `inspectLowerBandReadiness` | Open chunk excluded from brief-band eligibility |
| TC-6.3a | detailed-ready chunk shown as eligible | Closed chunk with detailed artifact | `inspectLowerBandReadiness` | Chunk marked eligible for detailed band |
| TC-6.3b | missing lower-band artifact shown as not ready | Closed chunk missing needed artifact | `inspectLowerBandReadiness` | Chunk marked not ready |
| TC-6.4a | chunk detail remains minimal | Chunk exists with lifecycle + representations | `openChunkDetail` | Minimal chunk state returned without full control-plane data |
| TC-6.4b | missing chunk data does not block upper-band inspection | Chunk artifacts incomplete, upper-band selections valid | `openThreadViewDetail` | Upper-band inspection still succeeds |

### `workbench-search-service.test.ts`

This file owns search and skim behavior. It proves both content and metadata search, stable result shapes, and skim-oriented summary outputs.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-2.1a | searches message content | Thread with searchable message content | `searchMessages` | Matching message summaries returned |
| TC-2.1b | searches turn content | Thread with searchable turn content | `searchTurns` | Matching turn summaries returned |
| TC-2.1c | searches Thread View metadata | Thread with multiple Thread Views | `searchThreadViews` | Matching Thread View summaries returned |
| TC-2.1d | metadata filters narrow results | Records with varied metadata | Search with filters | Result set narrowed correctly |
| TC-2.2a | message results show leading recognizable content | Long message result set | Search messages | Summary row uses leading recognizable content |
| TC-2.2b | turn results use compact turn summary | Long turn result set | Search turns | Turn summary row returned instead of raw dump |
| TC-2.2c | Thread View results show state and purpose | Multiple Thread Views with varied state | Search Thread Views | State and purpose shown |
| TC-2.3a | message result includes turn relationship hint | Message belongs to Turn | Search messages | Relationship hint points to owning Turn |
| TC-2.3b | turn result includes view relationship hint | Turn included in active or draft view | Search turns | Relationship hint points to view placement |
| TC-2.4a | long result set stays in summary form | Large result set | Search any supported scope | Results remain summary-shaped |
| TC-2.4b | empty search is explicit | No matching records | Search any supported scope | Empty result reported explicitly |

### `thread-view-edit-service.test.ts`

This file owns draft lifecycle, exclusion, and archive-without-activate behavior. It proves that editing is curation over views and not mutation of source truth.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-4.1a | creates empty draft with empty bands | Thread exists | `createDraftThreadView` | Draft created with empty band selections |
| TC-4.1b | empty draft is explicit in readback | Existing empty draft | `openThreadViewDetail` | Empty state visible |
| TC-4.1c | empty source Thread still permits draft creation | Thread with no Turns | `createDraftThreadView` | Empty draft still created |
| TC-4.2a | draft creation does not change source Thread | Thread snapshot with source Messages/Turns | `createDraftThreadView` | Source Thread unchanged |
| TC-4.2b | draft creation does not copy active view | Thread with active Thread View | `createDraftThreadView` | New draft starts empty |
| TC-4.3a | draft state is explicit | View in non-active non-archived state | Read view | State is draft |
| TC-4.3b | archived state is explicit | Archived view | Read view | State is archived |
| TC-4.4a | one active view invariant preserved in store reads | Thread with active view | List views | Exactly one active |
| TC-4.4b | creating draft does not create second active | Thread already has active view | `createDraftThreadView` | Existing active remains only active |
| TC-4.5a | archives draft without activation | Existing draft view | `archiveDraftThreadView` | Draft becomes archived and remains readable |
| TC-5.5a | excludes turn from draft view composition | Draft with included Turn | `excludeTurnFromThreadView` | Turn removed from draft view |
| TC-5.5b | exclusion does not mutate source Thread | Source Turn excluded from view | Read Thread after exclusion | Source Thread unchanged |

### `thread-view-materializer.test.ts`

This file owns band-to-output behavior. It proves that selected source units become the right emitted message forms for the upper bands and that lower-band rendering respects artifact readiness.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-5.1a | full-fidelity selection is turn-based | Draft with selected full-fidelity turns | `materializeThreadView` | Full-fidelity source units treated as turns |
| TC-5.1b | full-fidelity does not split turns | Turn with multiple Messages | `materializeThreadView` | Turn emits as a whole sequence |
| TC-5.2a | selected full-fidelity turns emit raw messages | Selected full-fidelity turns | `materializeThreadView` | Raw Messages emitted in source order |
| TC-5.2b | full-fidelity preserves actor back-and-forth | Multi-actor Turn selected for full fidelity | `materializeThreadView` | Emitted raw sequence preserves original order |
| TC-5.3a | smooth band uses turn selections | Draft with selected smooth turns | `materializeThreadView` | Smooth band source units treated as turns |
| TC-5.3b | smooth band follows full-fidelity boundary by default | Draft with full-fidelity boundary and no override | `materializeThreadView` | Smooth selection begins at next older eligible turns |
| TC-5.4a | selected smooth turn emits one smooth representation | Turn with smooth artifact | `materializeThreadView` | One smooth synthetic message emitted |
| TC-5.4b | missing smooth artifact is visible | Turn selected for smooth band without smooth artifact | `materializeThreadView` | Band status or issues mark missing smooth artifact |

### `thread-view-compare-service.test.ts`

This file owns on-demand draft-vs-active comparison and materialized-result comparison behavior.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-7.1a | compares band-level differences | Active and draft views differ by band composition | `compareThreadViews` | Band differences returned |
| TC-7.1b | compares selected source-unit differences | Active and draft views differ by selected turns or chunks | `compareThreadViews` | Added/removed selected ids returned |
| TC-7.2a | draft emitted message sequence inspectable before activation | Draft has materialized output | `compareThreadViews` or draft detail read | Draft emitted sequence available |
| TC-7.2b | missing materialized output is explicit | Draft lacks emitted output | `compareThreadViews` or draft detail read | Missing output reported explicitly |

### `thread-view-activation-service.test.ts`

This file owns activation, prior-active archival, and source-safety during state transitions.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-7.3a | activating draft makes it only active view | Thread with one active and one draft | `activateDraftThreadView` | Draft becomes only active view |
| TC-7.3b | prior active view archived on activation | Thread with one active and one draft | `activateDraftThreadView` | Prior active becomes archived |
| TC-7.4a | activation does not mutate source Thread | Source Thread snapshot + draft activation | `activateDraftThreadView` | Source Thread unchanged |
| TC-7.4b | archived view remains readable after activation | Prior active archived through activation | `openThreadView` | Archived view still readable |

## Non-TC Decided Tests

These tests are required by design risk rather than by a single epic TC.

| ID | Test File | Test Name |
|---|---|---|
| NTC-1 | `foundation.test.ts` | Thread View id and emitted-message ordering helpers are deterministic |
| NTC-2 | `foundation.test.ts` | band-order concatenation helpers preserve `full_fidelity -> smooth -> detailed -> brief` |
| NTC-3 | `thread-view-store.test.ts` | active Thread View pointer and per-view state remain consistent on startup reconciliation |
| NTC-4 | `workbench-search-service.test.ts` | stable ordering for equal-score metadata matches |
| NTC-5 | `workbench-search-service.test.ts` | skim summaries omit full-detail payloads from long result sets |
| NTC-6 | `thread-view-edit-service.test.ts` | archival preserves emitted messages for later readback |
| NTC-7 | `thread-view-materializer.test.ts` | materializer preserves band order when one band is empty |
| NTC-8 | `thread-view-materializer.test.ts` | open chunk never materializes into lower bands even if summary artifacts are erroneously present |
| NTC-9 | `thread-view-compare-service.test.ts` | comparison ignores archived views unless explicitly requested |
| NTC-10 | `thread-view-activation-service.test.ts` | activation rejects draft when policy requires materialized output and it is missing |
| NTC-11 | `file-thread-view-store.integration.test.ts` | Thread Views survive process-style reopen with consistent active-view invariant |

## Chunk Test Counts

| Chunk | Primary TC Tests | Non-TC Tests | Total |
|---|---:|---:|---:|
| Chunk 0: Foundation | 0 | 2 | 2 |
| Chunk 1: Thread And Active View Inspection | 9 | 1 | 10 |
| Chunk 2: Search, Skim, And Full Detail | 20 | 2 | 22 |
| Chunk 3: Draft Thread View Lifecycle And Turn Exclusion | 12 | 2 | 14 |
| Chunk 4: Band Composition And Lower-Band Awareness | 16 | 2 | 18 |
| Chunk 5: Comparison And Activation | 8 | 2 | 10 |
| Total | 65 | 11 | 76 |

## Verification Commands

| Gate | Command | Expected Use |
|---|---|---|
| `red-verify` | `npm run typecheck` | Run after Red tests are written but expected to fail. |
| `verify` | `npm run typecheck && npm run test` | Standard development gate. |
| `green-verify` | `npm run verify && npm run guard:no-test-changes` | Run after implementation passes and Red tests should remain unchanged. |
| `verify-all` | `npm run verify && npm run test:integration && npm run test:e2e` | Run for story completion and before release. |

Initial integration coverage should focus on Thread View persistence and realistic workbench reads:

| Test File | Test Name | Purpose |
|---|---|---|
| `file-thread-view-store.integration.test.ts` | Thread Views survive process-style reopen | Verifies persisted active/draft/archived state and emitted messages reopen correctly |
| `file-thread-view-store.integration.test.ts` | activation updates active-view invariant atomically | Verifies activation changes active pointer and view states consistently |
| `file-thread-view-store.integration.test.ts` | workbench query reads mixed Thread + Thread View state | Verifies read services can open realistic Thread + view snapshots from disk |
| `file-thread-view-store.integration.test.ts` | search remains practical over large realistic thread data | Verifies file-backed content and metadata search remains practical for expected Thread sizes |

Dedicated E2E coverage should focus on real workbench lifecycle seams rather than duplicating the full service suite. For Feature 2, "E2E" means end-to-end through the full workbench service stack against real filesystem-backed Thread and Thread View state. These tests are not expected to drive PI directly. They should pre-seed realistic source Thread and Thread View state, then exercise the real workbench entry surfaces over that state.

| Test File | Test Name | Purpose |
|---|---|---|
| `context-workbench.e2e.test.ts` | opens Thread with active Thread View | Verifies the real entry surface can read mixed Thread + active-view state |
| `context-workbench.e2e.test.ts` | creates empty draft from source truth | Verifies draft lifecycle starts empty through the real surface |
| `context-workbench.e2e.test.ts` | fills upper bands and materializes emitted output | Verifies real draft composition for full-fidelity and smooth bands |
| `context-workbench.e2e.test.ts` | compares draft and active views | Verifies the comparison seam over real persisted state |
| `context-workbench.e2e.test.ts` | activates draft and archives prior active view | Verifies activation seam and one-active invariant through the real surface |
| `context-workbench.e2e.test.ts` | rejects activation when emitted output is required but missing | Verifies the key activation edge case at end-to-end scope |
| `context-workbench.e2e.test.ts` | opens fixture Thread through workbench flow | Verifies fixture-read seam through the same workbench path |
| `context-workbench.e2e.test.ts` | reports lower-band blocker for open or incomplete chunk | Verifies lower-band edge-case visibility through the real surface |
| `context-workbench.e2e.test.ts` | source Thread remains unchanged after view edits and activation | Verifies source-safety at end-to-end scope |

## Count Reconciliation

The epic contains 65 TCs. This plan maps 65 primary TC tests. Non-TC decided tests add 11 tests. The planned Feature 2 service-layer total is therefore 76 tests.

Deep-gate suites are additive:

- 76 planned service-layer tests
- 4 integration tests
- 9 E2E tests
- 89 tests at the full deep gate when all planned suites exist

Per-file primary TC counts:

| Test File | Primary TC Tests |
|---|---:|
| `workbench-query-service.test.ts` | 26 |
| `workbench-search-service.test.ts` | 11 |
| `thread-view-edit-service.test.ts` | 12 |
| `thread-view-materializer.test.ts` | 8 |
| `thread-view-compare-service.test.ts` | 4 |
| `thread-view-activation-service.test.ts` | 4 |
| Total | 65 |
