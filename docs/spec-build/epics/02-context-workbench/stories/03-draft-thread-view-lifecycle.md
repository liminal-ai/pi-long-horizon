# Story 3: Draft Thread View Lifecycle

### Summary
<!-- Jira: Summary field -->

Create empty draft Thread Views from source truth, track active/draft/archived states, enforce one-active-view invariants, archive drafts without activation, and support turn-level exclusion as view curation.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages long-running PI coding sessions whose useful context is larger than a raw transcript. The steward needs to find relevant source material quickly, understand how that material is currently represented, and build or revise Thread Views without mutating source truth.

**Objective**

Deliver the draft Thread View lifecycle: create an empty draft, track its state, enforce that only one Thread View can be active per Thread, allow archiving a draft without activation, and support excluding turns from a draft as a curation decision that does not mutate source records.

**Scope**

In scope:
- Create empty draft Thread View for a Thread
- Draft starts with empty band regions
- Thread View states: active, draft, archived
- One-active-view invariant enforcement
- Archive a draft without activating it
- Turn-level exclusion from a draft Thread View
- Source Thread remains unchanged through all draft operations

Out of scope:
- Band composition and materialization (Story 4+)
- Comparison and activation (Story 6)
- Lower-band chunk awareness (Story 5)

**Dependencies**

- Story 1 (ThreadViewStore, workbench query service)
- Story 0 (record types, error codes)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.1:** Using the workbench, the steward can create a new draft Thread View that starts empty.

- **TC-4.1a: Draft view is created with no selected source units**
  - Given: A Thread exists
  - When: The steward creates a new draft Thread View
  - Then: The draft exists with empty band regions
- **TC-4.1b: Empty draft is explicit**
  - Given: A draft Thread View has not yet been filled
  - When: The steward opens the draft
  - Then: The workbench shows that the draft is empty rather than implying inferred content
- **TC-4.1c: Empty source thread still permits draft creation**
  - Given: A Thread exists and has no Turns yet
  - When: The steward creates a draft Thread View
  - Then: The draft is created and remains empty

**AC-4.2:** Using the workbench, the steward can create draft Thread Views from source truth without mutating the source Thread.

- **TC-4.2a: Draft creation does not change source Thread**
  - Given: A Thread contains source Messages and Turns
  - When: The steward creates a draft Thread View
  - Then: The source Thread remains unchanged
- **TC-4.2b: Draft creation does not require copying the active view**
  - Given: A Thread has an active Thread View
  - When: The steward creates a new draft
  - Then: The draft starts as a new empty view associated with the same source Thread

**AC-4.3:** Using the workbench, the steward can distinguish active, draft, and archived Thread View states.

- **TC-4.3a: Draft state is explicit**
  - Given: A Thread View is not active and not archived
  - When: The workbench reads its state
  - Then: The Thread View is shown as draft
- **TC-4.3b: Archived state is explicit**
  - Given: A Thread View has been archived
  - When: The workbench reads its state
  - Then: The Thread View is shown as archived

**AC-4.4:** Using the workbench, the steward can rely on exactly one active Thread View for a Thread at a time.

- **TC-4.4a: Thread with active view lists one active state**
  - Given: A Thread has one active Thread View
  - When: The workbench lists all Thread Views
  - Then: Exactly one is active
- **TC-4.4b: Draft creation does not create a second active view**
  - Given: A Thread already has an active Thread View
  - When: The steward creates a draft
  - Then: The existing active view remains the only active view

**AC-4.5:** Using the workbench, the steward can archive a draft Thread View without activating it.

- **TC-4.5a: Draft can be archived as an abandonment path**
  - Given: A draft Thread View exists and will not be activated
  - When: The steward archives the draft
  - Then: The draft becomes archived and remains readable as an abandoned draft view

**AC-5.5:** Using the workbench, the steward can exclude Turns from a Thread View as a curation decision.

- **TC-5.5a: Turn can be excluded from draft Thread View**
  - Given: A Turn would otherwise be part of a draft Thread View
  - When: The steward excludes that Turn
  - Then: The Turn is removed from the draft Thread View composition
- **TC-5.5b: Exclusion does not mutate source Thread**
  - Given: A Turn is excluded from a Thread View
  - When: The source Thread is read
  - Then: The Turn and its Messages remain unchanged in source truth

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story introduces Thread Views as durable editing objects rather than just things the runtime consumes. The key job here is to make draft lifecycle explicit and safe before any band composition logic arrives in Story 4.

It also owns turn exclusion because exclusion is fundamentally a draft-view curation decision, not a materialization concern.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Draft lifecycle service | `src/context-workbench/services/thread-view-edit-service.ts` |
| Thread View store | `src/context-workbench/store/thread-view-store.ts` |
| File-backed Thread View store | `src/context-workbench/store/file-thread-view-store.ts` |
| Thread View records | `src/context-workbench/domain/thread-view-records.ts` |
| Draft lifecycle tests | `tests/context-workbench/thread-view-edit-service.test.ts` |

#### Design References

- [tech-design.md §Record Schemas](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:205), lines 205-263
- [tech-design.md §Active View Pointer](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:301), lines 301-309
- [tech-design.md §Flow 4: Draft Thread View Lifecycle](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:459), lines 459-481
- [tech-design.md §Chunk 3: Draft Thread View Lifecycle and Turn Exclusion](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:808), lines 808-820
- [test-plan.md §thread-view-edit-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:126), lines 126-143

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-4.1a | `tests/context-workbench/thread-view-edit-service.test.ts` | creates empty draft with empty bands |
| TC-4.1b | `tests/context-workbench/thread-view-edit-service.test.ts` | empty draft explicit in readback |
| TC-4.1c | `tests/context-workbench/thread-view-edit-service.test.ts` | empty source Thread still permits draft creation |
| TC-4.2a | `tests/context-workbench/thread-view-edit-service.test.ts` | draft creation does not change source Thread |
| TC-4.2b | `tests/context-workbench/thread-view-edit-service.test.ts` | draft creation does not copy active view |
| TC-4.3a | `tests/context-workbench/thread-view-edit-service.test.ts` | draft state explicit |
| TC-4.3b | `tests/context-workbench/thread-view-edit-service.test.ts` | archived state explicit |
| TC-4.4a | `tests/context-workbench/thread-view-edit-service.test.ts` | one active view invariant preserved in reads |
| TC-4.4b | `tests/context-workbench/thread-view-edit-service.test.ts` | creating draft does not create second active |
| TC-4.5a | `tests/context-workbench/thread-view-edit-service.test.ts` | archives draft without activation |
| TC-5.5a | `tests/context-workbench/thread-view-edit-service.test.ts` | excludes turn from draft view composition |
| TC-5.5b | `tests/context-workbench/thread-view-edit-service.test.ts` | exclusion does not mutate source Thread |

#### Non-TC Decided Tests

- `thread-view-edit-service.test.ts`: archival preserves emitted messages for later readback

#### Technical Notes

`sourceStateReference` captures `<sourceRevision, messageHighWatermark>` from the canonical Thread at draft creation. Draft deletion remains out of scope. Archival is the only abandonment path in Feature 2.

Exclusions are stored as turn IDs on the view composition rather than as source mutations.

#### Anti-Shim Requirements

- Prove one-active-view invariants through the real store and service transitions, not through a mock repository that never has conflicting state.
- Prove exclusion against the real source Thread snapshot so the test actually catches accidental source mutation.

#### Verification

- Targeted: `node --import tsx --test tests/context-workbench/thread-view-edit-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All TCs pass (TC-4.1a through TC-4.5a, TC-5.5a through TC-5.5b)
- [ ] ThreadViewStore createThreadView, archiveThreadView implemented
- [ ] One-active-view invariant enforced in store
- [ ] Turn exclusion updates band selections without mutating source
- [ ] `npm run verify` passes
- [ ] `npm run green-verify` passes
