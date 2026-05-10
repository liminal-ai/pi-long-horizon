# Story Lead Base Prompt

## Role Charter
You are the story lead for `06-view-comparison-and-activation` on durable story run `06-view-comparison-and-activation-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 1.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/stories/06-view-comparison-and-activation.md
Bytes: 9743

# Story 6: View Comparison And Activation

### Summary
<!-- Jira: Summary field -->

Compare draft and active Thread Views, inspect the materialized draft result before activation, activate a draft (archiving the prior active), and verify source truth remains unchanged through all transitions.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages long-running PI coding sessions whose useful context is larger than a raw transcript. The steward needs to find relevant source material quickly, understand how that material is currently represented, and build or revise Thread Views without mutating source truth.

**Objective**

Deliver the final workbench lifecycle step: comparing a draft Thread View against the active view, inspecting the draft's materialized output, activating the draft so it becomes the single active view, and archiving the prior active view. Source truth remains unchanged through the entire transition.

**Scope**

In scope:
- Band-level comparison (added/removed source units per band)
- Emitted-message-level comparison
- Draft materialized result inspection before activation
- Missing materialized output reported explicitly
- Activation transitions draft to active, prior active to archived
- One-active-view invariant preserved
- Source Thread unchanged after activation
- Archived views remain readable

Out of scope:
- PI runtime reload on activation (Feature 3)
- Smart compact execution (Feature 3)
- Draft creation or band editing (Stories 3–4)

**Dependencies**

- Story 3 (draft lifecycle, ThreadViewStore)
- Story 4 (upper-band composition, materializer)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-7.1:** Using the workbench, the steward can compare draft and active Thread Views.

- **TC-7.1a: Comparison shows band-level differences**
  - Given: A draft Thread View and an active Thread View both exist
  - When: The steward compares them
  - Then: The workbench shows differences in band composition
- **TC-7.1b: Comparison shows selection differences**
  - Given: A draft differs from the active view in selected turns or chunks
  - When: The steward compares them
  - Then: The workbench shows which source units differ between the views

**AC-7.2:** Using the workbench, the steward can inspect the materialized emitted result of a draft before activation.

- **TC-7.2a: Draft emitted message sequence is inspectable**
  - Given: A draft Thread View has been assembled
  - When: The steward opens the draft's materialized result
  - Then: The steward can inspect the emitted message sequence before activation
- **TC-7.2b: Missing materialized output is explicit**
  - Given: A draft Thread View has selections but no materialized output yet
  - When: The steward opens the draft result
  - Then: The workbench explicitly reports that the emitted result is not yet materialized

**AC-7.3:** Using the workbench, the steward can activate a draft Thread View while preserving one-active-view invariants.

- **TC-7.3a: Activating draft makes it the only active view**
  - Given: A Thread has one active view and one draft view
  - When: The steward activates the draft
  - Then: The draft becomes active and no second active view exists
- **TC-7.3b: Prior active view is preserved as archived**
  - Given: A Thread has an active view and a draft view
  - When: The steward activates the draft
  - Then: The prior active view is archived rather than deleted

**AC-7.4:** Using the workbench, the steward can activate or archive a Thread View without mutating source truth.

- **TC-7.4a: Source thread remains unchanged after activation**
  - Given: A draft Thread View is activated
  - When: The source Thread is read
  - Then: The source Thread records remain unchanged
- **TC-7.4b: Archived view remains readable**
  - Given: A previously active Thread View has been archived
  - When: The steward opens the archived view
  - Then: The archived view remains readable as a historical curated context

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story closes the main workbench lifecycle. It does not build new view content. It consumes an already-assembled draft, compares it to the active view, and then performs the only state transition that changes runtime-facing view ownership.

That makes this story the state-transition seam where correctness matters most: one-active-view invariant, archival of the prior active, and source-safety of the canonical Thread.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Compare service | `src/context-workbench/services/thread-view-compare-service.ts` |
| Activation service | `src/context-workbench/services/thread-view-activation-service.ts` |
| Thread View store activation path | `src/context-workbench/store/thread-view-store.ts`, `src/context-workbench/store/file-thread-view-store.ts` |
| Compare tests | `tests/context-workbench/thread-view-compare-service.test.ts` |
| Activation tests | `tests/context-workbench/thread-view-activation-service.test.ts` |

#### Design References

- [tech-design.md §ProjectionRevision Linkage](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:310), lines 310-320
- [tech-design.md §Flow 7: View Comparison And Activation](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:545), lines 545-571
- [tech-design.md §Store Interface](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:321), lines 321-364
- [test-plan.md §thread-view-compare-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:160), lines 160-169
- [test-plan.md §thread-view-activation-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:171), lines 171-180

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-7.1a | `tests/context-workbench/thread-view-compare-service.test.ts` | compares band-level differences |
| TC-7.1b | `tests/context-workbench/thread-view-compare-service.test.ts` | compares selected source-unit differences |
| TC-7.2a | `tests/context-workbench/thread-view-compare-service.test.ts` | draft emitted message sequence inspectable before activation |
| TC-7.2b | `tests/context-workbench/thread-view-compare-service.test.ts` | missing materialized output explicit |
| TC-7.3a | `tests/context-workbench/thread-view-activation-service.test.ts` | activating draft makes it only active view |
| TC-7.3b | `tests/context-workbench/thread-view-activation-service.test.ts` | prior active archived on activation |
| TC-7.4a | `tests/context-workbench/thread-view-activation-service.test.ts` | activation does not mutate source Thread |
| TC-7.4b | `tests/context-workbench/thread-view-activation-service.test.ts` | archived view remains readable after activation |

#### Non-TC Decided Tests

- `thread-view-compare-service.test.ts`: comparison ignores archived views unless explicitly requested
- `thread-view-activation-service.test.ts`: activation rejects draft when policy requires materialized output and it is missing

#### Technical Notes

Comparison output contract:

| Field | Type | Description |
|------|------|-------------|
| bandDifferences | array | Per-band added/removed source-unit IDs |
| bandDifferences[].bandType | string | Which band differs |
| bandDifferences[].addedIds | array of string | Source units in draft but not active |
| bandDifferences[].removedIds | array of string | Source units in active but not draft |
| emittedMessageDifferences | array | Per-position message differences |
| emittedMessageDifferences[].messageOrder | integer | Position in emitted sequence |
| emittedMessageDifferences[].active | ThreadViewMessage or absent | Active view's message at this position |
| emittedMessageDifferences[].draft | ThreadViewMessage or absent | Draft view's message at this position |

Activation transition:

| Before | After |
|------|-------|
| Draft view: `state = "draft"` | Draft view: `state = "active"` |
| Prior active view: `state = "active"` | Prior active view: `state = "archived"` |
| `thread.json`: `activeThreadViewId = <prior>` | `thread.json`: `activeThreadViewId = <draft>` |

ProjectionRevision linkage is available for later Feature 3 work, but activation in this story changes only Thread View state and the `activeThreadViewId` pointer.

#### Anti-Shim Requirements

- Prove activation atomicity through the real store transition, not by flipping two in-memory state fields independently.
- Prove source safety by asserting the canonical Thread records are unchanged after activation, not just by asserting that the activation service “does not call” a mutation helper.

#### Verification

- Targeted: `node --import tsx --test tests/context-workbench/thread-view-compare-service.test.ts`
- Targeted: `node --import tsx --test tests/context-workbench/thread-view-activation-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All TCs pass (TC-7.1a through TC-7.4b)
- [ ] Comparison returns band-level and emitted-message-level differences
- [ ] Missing materialized output reported explicitly
- [ ] Activation transitions states atomically
- [ ] Source Thread unchanged after activation
- [ ] Archived views remain readable
- [ ] `npm run verify` passes
- [ ] `npm run green-verify` passes


### Test Plan
### test-plan
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md
Bytes: 21008

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


## Current Run Index
- planner_turn_index: 1
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-orchestrate-run
- current_child_operation: none
- current_summary: Story orchestration started and durable state has been initialized.
- latest_response_kind: none
- latest_response_path: none
- older_response_count: 0
- caller_input_artifact_count: 0
- prior_self_note_count: 0
- latest_self_note: "none"

## Response Trail
<current_response>
No prior bounded child response is recorded yet.
</current_response>

<history_responses>
No older response entries are recorded yet.
</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/artifacts/06-view-comparison-and-activation/story-lead/001-current.json
Bytes: 974

```yaml
storyRunId: "06-view-comparison-and-activation-story-run-001"
storyId: "06-view-comparison-and-activation"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "Story orchestration started and durable state has been initialized."
currentPhase: "story-orchestrate-run"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/artifacts/06-view-comparison-and-activation/001-story-validate.json"
    provenance: "prior-run"
latestContinuationHandles:
{}
latestEventSequence: 1
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "orient-from-disk"
  summary: "Orient from 1 existing story artifact(s)."
replayBoundary: null
updatedAt: "2026-05-10T21:17:08.017Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
No prior runtime self-notes are recorded yet.

## Seeded Self-Note Example
Seeded first-turn instruction (not a prior runtime self-note): include `selfNote` when you want to leave a durable reminder for a later planner turn, for example `Track whether the next verifier pass still needs the ruling evidence.`

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/artifacts/06-view-comparison-and-activation/story-lead/001-events.jsonl
Bytes: 233

```yaml
-
  storyRunId: "06-view-comparison-and-activation-story-run-001"
  sequence: 1
  timestamp: "2026-05-10T21:17:08.016Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
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
Bytes: 221

```yaml
storyGate: "npm run green-verify"
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
