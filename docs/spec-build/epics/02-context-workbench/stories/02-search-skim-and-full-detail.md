# Story 2: Search, Skim, And Full Detail

### Summary
<!-- Jira: Summary field -->

Search messages, turns, and Thread Views by content and metadata, skim large result sets with compact summaries, open full detail for any record, and pivot between related records.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages long-running PI coding sessions whose useful context is larger than a raw transcript. The steward needs to find relevant source material quickly, understand how that material is currently represented, and build or revise Thread Views without mutating source truth.

**Objective**

Deliver the find/skim/inspect surface. The steward can search across source records and Thread Views, get compact high-signal result rows for large sets, open any record in full detail, and navigate between related records (message → turn, turn → Thread View placement, Thread View band → source detail).

**Scope**

In scope:
- Content search across messages, turns, Thread Views
- Metadata filters: message kind, actor type, source-order range (messages); lifecycle status, turn-order range (turns); state, name, purpose (Thread Views)
- Skim-friendly summary rows with leading recognizable content
- Full detail views for messages, turns, and Thread Views
- Pivots: message → turn, turn → Thread View placement, Thread View band → source detail (chunk detail surface owned by Story 5)
- Empty search result reporting

Out of scope:
- Draft creation or editing (Story 3+)
- Band composition or materialization (Story 4+)
- Full chunk editing or maintenance workflows

**Dependencies**

- Story 1 (workbench query service, Thread View store)
- Epic 1 ThreadStore for source Message and Turn reads

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-2.1:** Using the workbench, the steward can search messages, turns, and Thread Views by content and metadata.

- **TC-2.1a: Message search returns matching messages**
  - Given: A Thread contains searchable message content
  - When: The steward searches messages
  - Then: Matching messages are returned
- **TC-2.1b: Turn search returns matching turns**
  - Given: A Thread contains searchable turn content
  - When: The steward searches turns
  - Then: Matching turns are returned
- **TC-2.1c: Thread View search returns matching views**
  - Given: A Thread has multiple Thread Views with identifiable metadata
  - When: The steward searches Thread Views
  - Then: Matching Thread Views are returned
- **TC-2.1d: Metadata filters narrow results**
  - Given: Searchable records contain filterable metadata
  - When: The steward applies supported metadata filters
  - Then: The result set is narrowed according to those filters

**AC-2.2:** Using the workbench, the steward can skim large result sets through compact, recognizable summaries.

- **TC-2.2a: Message result shows compact high-signal content**
  - Given: Message search returns many matches
  - When: The workbench renders the result list
  - Then: Each result shows leading recognizable content and metadata that help the steward skim quickly
- **TC-2.2b: Turn result shows summary fields rather than raw dump**
  - Given: Turn search returns many matches
  - When: The workbench renders the result list
  - Then: Each result shows a compact summary of the turn rather than the full raw turn payload
- **TC-2.2c: Thread View result shows state and purpose**
  - Given: Thread View search returns many matches
  - When: The workbench renders the result list
  - Then: Each result shows enough metadata to distinguish active, draft, and archived views and their intended use

**AC-2.3:** Using the workbench, the steward can see enough structural context in search results to support decisions.

- **TC-2.3a: Message result includes turn relationship**
  - Given: A message belongs to a Turn
  - When: The message appears in search results
  - Then: The result includes enough metadata to locate the owning Turn
- **TC-2.3b: Turn result includes current band or view relationship when applicable**
  - Given: A Turn is included in one or more Thread Views
  - When: The Turn appears in search results
  - Then: The result includes enough metadata to understand whether it participates in the active or draft view

**AC-2.4:** Using the workbench, the steward can receive long result sets without forcing full-detail rendering.

- **TC-2.4a: Long result set does not require full-detail payloads**
  - Given: A search returns a long list of matches
  - When: The results are rendered
  - Then: The list uses summary forms rather than full-detail forms
- **TC-2.4b: Empty search result is explicit**
  - Given: No records match the search
  - When: The steward submits the query
  - Then: The workbench reports that no results were found

**AC-3.1:** Using the workbench, the steward can open a message in full detail.

- **TC-3.1a: Full message detail includes all parts**
  - Given: A Message contains multiple typed Parts
  - When: The steward opens the Message
  - Then: The full Message detail includes all parts in order
- **TC-3.1b: Message detail includes source metadata**
  - Given: A Message has source-order and actor metadata
  - When: The steward opens the Message
  - Then: The detail view includes the metadata needed to place the Message back into Thread context

**AC-3.2:** Using the workbench, the steward can open a Turn in full detail.

- **TC-3.2a: Full Turn detail includes its member messages**
  - Given: A Turn contains multiple Messages
  - When: The steward opens the Turn
  - Then: The detail view shows the Turn's member Messages in source order
- **TC-3.2b: Turn detail includes current view relationship when applicable**
  - Given: A Turn is included in one or more Thread Views
  - When: The steward opens the Turn
  - Then: The detail view shows whether the Turn is currently included in the active or draft view and in which band

**AC-3.3:** Using the workbench, the steward can open a Thread View in full detail.

- **TC-3.3a: Thread View detail shows all band regions**
  - Given: A Thread View contains multiple populated bands
  - When: The steward opens the Thread View
  - Then: The detail view shows all band regions in order with their current selected units
- **TC-3.3b: Thread View detail shows emitted context result**
  - Given: A Thread View has a materialized emitted message sequence
  - When: The steward opens the Thread View
  - Then: The steward can inspect the resulting message sequence in addition to the band selections

**AC-3.4:** Using the workbench, the steward can pivot between related records.

- **TC-3.4a: Pivot from message to turn**
  - Given: A Message belongs to a Turn
  - When: The steward opens the Message
  - Then: The steward can move from that Message to its owning Turn
- **TC-3.4b: Pivot from turn to Thread View placement**
  - Given: A Turn appears in one or more Thread Views
  - When: The steward opens the Turn
  - Then: The steward can move from that Turn to the relevant Thread View placement
- **TC-3.4c: Pivot from Thread View band selection to source detail**
  - Given: A Thread View band contains selected turns or chunks
  - When: The steward opens that band selection
  - Then: The steward can move back to the source Turn or chunk detail

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the find/skim/inspect layer over existing Thread and Thread View state. It does not create or mutate view composition. It helps the steward locate the exact source material or Thread View context needed before any curation decision happens elsewhere.

The important design constraint is that this story is query-heavy and snapshot-driven. Search, detail, and pivots should read realistic state from the stores and return usable results without inventing a second persisted read model.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Search service | `src/context-workbench/services/workbench-search-service.ts` |
| Query/detail service | `src/context-workbench/services/workbench-query-service.ts` |
| Thread View records | `src/context-workbench/domain/thread-view-records.ts` |
| Search tests | `tests/context-workbench/workbench-search-service.test.ts` |
| Detail/pivot tests | `tests/context-workbench/workbench-query-service.test.ts` |

#### Design References

- [tech-design.md §Flow 2: Search And Skim](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:407), lines 407-432
- [tech-design.md §Flow 3: Detailed Inspection And Pivots](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:434), lines 434-457
- [tech-design.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:573), lines 573-682
- [test-plan.md §workbench-search-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:108), lines 108-124
- [test-plan.md §workbench-query-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:75), lines 75-106

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-2.1a | `tests/context-workbench/workbench-search-service.test.ts` | message search returns matches |
| TC-2.1b | `tests/context-workbench/workbench-search-service.test.ts` | turn search returns matches |
| TC-2.1c | `tests/context-workbench/workbench-search-service.test.ts` | Thread View metadata search returns matches |
| TC-2.1d | `tests/context-workbench/workbench-search-service.test.ts` | metadata filters narrow results |
| TC-2.2a | `tests/context-workbench/workbench-search-service.test.ts` | message skim row shows leading recognizable content |
| TC-2.2b | `tests/context-workbench/workbench-search-service.test.ts` | turn skim row stays summary-shaped |
| TC-2.2c | `tests/context-workbench/workbench-search-service.test.ts` | Thread View result shows state and purpose |
| TC-2.3a | `tests/context-workbench/workbench-search-service.test.ts` | message result includes turn relationship hint |
| TC-2.3b | `tests/context-workbench/workbench-search-service.test.ts` | turn result includes view relationship hint |
| TC-2.4a | `tests/context-workbench/workbench-search-service.test.ts` | long result set stays summary-shaped |
| TC-2.4b | `tests/context-workbench/workbench-search-service.test.ts` | empty search explicit |
| TC-3.1a | `tests/context-workbench/workbench-query-service.test.ts` | full message detail includes all parts |
| TC-3.1b | `tests/context-workbench/workbench-query-service.test.ts` | message detail includes source metadata |
| TC-3.2a | `tests/context-workbench/workbench-query-service.test.ts` | full Turn detail includes member messages |
| TC-3.2b | `tests/context-workbench/workbench-query-service.test.ts` | Turn detail includes current view relationship |
| TC-3.3a | `tests/context-workbench/workbench-query-service.test.ts` | Thread View detail shows all band regions |
| TC-3.3b | `tests/context-workbench/workbench-query-service.test.ts` | Thread View detail includes emitted result |
| TC-3.4a | `tests/context-workbench/workbench-query-service.test.ts` | pivot from message to Turn |
| TC-3.4b | `tests/context-workbench/workbench-query-service.test.ts` | pivot from Turn to Thread View placement |
| TC-3.4c | `tests/context-workbench/workbench-query-service.test.ts` | pivot from Thread View band selection to source detail |

#### Non-TC Decided Tests

- `workbench-search-service.test.ts`: stable ordering for equal-score metadata matches
- `workbench-search-service.test.ts`: skim summaries omit full-detail payloads from long result sets

#### Technical Notes

Search should use linear scans over canonical records and Thread View records within the current Thread scope, with in-process filtering and summary-row construction. Content search matches against text-bearing message parts. Metadata filtering uses the minimum fields listed in story scope.

Chunk detail is not implemented in this story. This story owns the pivot to chunk detail. Story 5 owns the minimal chunk detail surface itself.

#### Anti-Shim Requirements

- Prove search over real stored records, not over a pre-computed fake in-memory fixture that bypasses the store read shape.
- Prove skim rows are actually summary-shaped and not full-detail payloads with CSS-level truncation or equivalent presentation-only tricks.

#### Verification

- Targeted: `node --import tsx --test tests/context-workbench/workbench-search-service.test.ts tests/context-workbench/workbench-query-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All TCs pass (TC-2.1a through TC-3.4c)
- [ ] Search supports content queries and metadata filters
- [ ] Skim summaries use leading recognizable content
- [ ] Detail views return full records with relationship pivots
- [ ] `npm run verify` passes
- [ ] `npm run green-verify` passes
