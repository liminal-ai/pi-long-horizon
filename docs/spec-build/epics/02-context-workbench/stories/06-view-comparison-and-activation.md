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
