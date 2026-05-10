# Story 1: Thread And Thread View Inspection

### Summary
<!-- Jira: Summary field -->

Open a Thread in the workbench, read source-vs-active-view state, list Thread Views, report usable vs blocked status, and read fixture Threads through the same surface.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages long-running PI coding sessions whose useful context is larger than a raw transcript. The steward needs to find relevant source material quickly, understand how that material is currently represented, and build or revise Thread Views without mutating source truth.

**Objective**

Deliver the workbench entry point: opening a Thread, reading its source identity and active Thread View, seeing band structure, listing all Thread Views with their states, and determining whether the Thread is usable for stewardship work. Fixture Threads open through the same surface.

**Scope**

In scope:
- Open Thread and read source state
- Read active Thread View and its band regions
- List all Thread Views (active, draft, archived) for a Thread
- Report usable/blocked/degraded thread status
- Open fixture Threads through the same inspection flow

Out of scope:
- Search and skim (Story 2)
- Draft creation or editing (Story 3+)
- Band composition (Story 4+)

**Dependencies**

- Story 0 (record types, error codes, fixtures)
- Epic 1 ThreadStore for source Thread reads

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-1.1:** Using the workbench, the steward can distinguish source Thread state from active Thread View state.

- **TC-1.1a: Source and active view are shown separately**
  - Given: A Thread has an active Thread View
  - When: The workbench opens the Thread
  - Then: The source Thread identity and the active Thread View identity are both visible as separate records
- **TC-1.1b: Thread without active view remains readable**
  - Given: A Thread exists and no active Thread View exists
  - When: The workbench opens the Thread
  - Then: The source Thread is still readable and the absence of an active Thread View is explicit

**AC-1.2:** Using the workbench, the steward can see whether the Thread is currently usable for stewardship work.

- **TC-1.2a: Ready thread reports usable status**
  - Given: A Thread has no known blockers for current workbench operations
  - When: The workbench opens the Thread
  - Then: The Thread is shown as usable
- **TC-1.2b: Blocked or degraded thread reports why**
  - Given: A Thread has known blocked or degraded maintenance state
  - When: The workbench opens the Thread
  - Then: The workbench shows the blocked or degraded status and names the blocker at a reader-usable level

**AC-1.3:** Using the workbench, the steward can inspect the active Thread View's band structure.

- **TC-1.3a: Active view band regions are visible**
  - Given: An active Thread View exists
  - When: The workbench opens the Thread
  - Then: The active Thread View shows full-fidelity, smooth, detailed, and brief band regions in order
- **TC-1.3b: Empty band is explicit**
  - Given: A Thread View has no content in one or more bands
  - When: The Thread View is opened
  - Then: Empty bands are shown explicitly rather than omitted silently

**AC-1.4:** Using the workbench, the steward can list all Thread Views for a Thread with their current state.

- **TC-1.4a: Active, draft, and archived views are listed**
  - Given: A Thread has multiple Thread Views in different states
  - When: The workbench opens the Thread
  - Then: All Thread Views are listed with their current state
- **TC-1.4b: One active view invariant is visible**
  - Given: A Thread has an active Thread View
  - When: The workbench lists Thread Views
  - Then: Exactly one Thread View is shown as active

**AC-1.5:** Using the workbench, the steward can open fixture Threads as normal Thread-shaped records.

- **TC-1.5a: Fixture Thread opens through the same inspection surface**
  - Given: A fixture Thread exists
  - When: The steward opens the fixture in the workbench
  - Then: The fixture is readable through the same inspection flow used for normal Threads

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the reader entrypoint into the workbench. It sits directly on the seam between canonical Thread reads and Thread View reads. Its job is to make that distinction legible without yet pulling in search or editing behavior.

The story also introduces the active-view invariant to the user-facing surface. A Thread may have many Thread Views, but this story is where the steward first sees which one is active and whether the thread is ready for further work.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Thread/workbench query entrypoint | `src/context-workbench/services/workbench-query-service.ts` |
| Thread View persistence interface | `src/context-workbench/store/thread-view-store.ts` |
| File-backed Thread View store | `src/context-workbench/store/file-thread-view-store.ts` |
| Thread View record vocabulary | `src/context-workbench/domain/thread-view-records.ts` |
| Query service tests | `tests/context-workbench/workbench-query-service.test.ts` |

#### Design References

- [tech-design.md §System View](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:70), lines 70-124
- [tech-design.md §Record Schemas](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:205), lines 205-300
- [tech-design.md §Active View Pointer](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:301), lines 301-309
- [tech-design.md §Flow 1: Thread And Active View Inspection](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:382), lines 382-405
- [test-plan.md §workbench-query-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:75), lines 75-106

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-1.1a | `tests/context-workbench/workbench-query-service.test.ts` | source Thread and active view shown separately |
| TC-1.1b | `tests/context-workbench/workbench-query-service.test.ts` | Thread readable without active view |
| TC-1.2a | `tests/context-workbench/workbench-query-service.test.ts` | ready Thread reports usable status |
| TC-1.2b | `tests/context-workbench/workbench-query-service.test.ts` | blocked/degraded Thread reports why |
| TC-1.3a | `tests/context-workbench/workbench-query-service.test.ts` | active view band regions visible |
| TC-1.3b | `tests/context-workbench/workbench-query-service.test.ts` | empty band explicit |
| TC-1.4a | `tests/context-workbench/workbench-query-service.test.ts` | active/draft/archived views listed |
| TC-1.4b | `tests/context-workbench/workbench-query-service.test.ts` | one active view invariant visible |
| TC-1.5a | `tests/context-workbench/workbench-query-service.test.ts` | fixture Thread opens through same read surface |

#### Non-TC Decided Tests

- `thread-view-store.test.ts`: active Thread View pointer and per-view state remain consistent on startup reconciliation
- `workbench-query-service.test.ts`: opening a Thread with many archived views keeps active-view lookup cheap

#### Technical Notes

This story depends on the optional `activeThreadViewId` pointer on `thread.json` for cheap active-view lookup, but the per-view `state` field remains authoritative for validation. The read surface should never assume the pointer and per-view state agree without checking.

#### Anti-Shim Requirements

- Read canonical Thread state through the real Epic 1 Thread store. Do not hand-assemble a fake “thread summary” object inside the query service.
- Read fixture Threads through the same code path used for normal Threads. Do not create a separate fixture-only branch in the query logic.

#### Verification

- Targeted: `node --import tsx --test tests/context-workbench/workbench-query-service.test.ts tests/context-workbench/thread-view-store.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All TCs pass (TC-1.1a through TC-1.5a)
- [ ] ThreadViewStore listThreadViews and openThreadView implemented
- [ ] FileThreadViewStore persists under thread-views/ directories
- [ ] `npm run verify` passes
- [ ] `npm run green-verify` passes
