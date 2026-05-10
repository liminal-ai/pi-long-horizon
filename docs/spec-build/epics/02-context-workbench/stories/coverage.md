# Coverage Artifact: Context Workbench Stories

## Coverage Gate

Every AC and TC from the detailed epic mapped to exactly one story.

| AC | TC | Story |
|----|-----|-------|
| AC-1.1 | TC-1.1a, TC-1.1b | Story 1 |
| AC-1.2 | TC-1.2a, TC-1.2b | Story 1 |
| AC-1.3 | TC-1.3a, TC-1.3b | Story 1 |
| AC-1.4 | TC-1.4a, TC-1.4b | Story 1 |
| AC-1.5 | TC-1.5a | Story 1 |
| AC-2.1 | TC-2.1a, TC-2.1b, TC-2.1c, TC-2.1d | Story 2 |
| AC-2.2 | TC-2.2a, TC-2.2b, TC-2.2c | Story 2 |
| AC-2.3 | TC-2.3a, TC-2.3b | Story 2 |
| AC-2.4 | TC-2.4a, TC-2.4b | Story 2 |
| AC-3.1 | TC-3.1a, TC-3.1b | Story 2 |
| AC-3.2 | TC-3.2a, TC-3.2b | Story 2 |
| AC-3.3 | TC-3.3a, TC-3.3b | Story 2 |
| AC-3.4 | TC-3.4a, TC-3.4b, TC-3.4c | Story 2 |
| AC-4.1 | TC-4.1a, TC-4.1b, TC-4.1c | Story 3 |
| AC-4.2 | TC-4.2a, TC-4.2b | Story 3 |
| AC-4.3 | TC-4.3a, TC-4.3b | Story 3 |
| AC-4.4 | TC-4.4a, TC-4.4b | Story 3 |
| AC-4.5 | TC-4.5a | Story 3 |
| AC-5.1 | TC-5.1a, TC-5.1b | Story 4 |
| AC-5.2 | TC-5.2a, TC-5.2b | Story 4 |
| AC-5.3 | TC-5.3a, TC-5.3b | Story 4 |
| AC-5.4 | TC-5.4a, TC-5.4b | Story 4 |
| AC-5.5 | TC-5.5a, TC-5.5b | Story 3 |
| AC-6.1 | TC-6.1a, TC-6.1b | Story 5 |
| AC-6.2 | TC-6.2a, TC-6.2b | Story 5 |
| AC-6.3 | TC-6.3a, TC-6.3b | Story 5 |
| AC-6.4 | TC-6.4a, TC-6.4b | Story 5 |
| AC-7.1 | TC-7.1a, TC-7.1b | Story 6 |
| AC-7.2 | TC-7.2a, TC-7.2b | Story 6 |
| AC-7.3 | TC-7.3a, TC-7.3b | Story 6 |
| AC-7.4 | TC-7.4a, TC-7.4b | Story 6 |

**Total ACs:** 31
**Total TCs:** 65
**Unmapped TCs:** 0

---

## Integration Path Trace

### Path 1: Draft Thread View Build and Activation

The primary stewardship path: open a thread, create a draft, compose bands, compare, activate.

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Open Thread | Read source thread and active view state | Story 1 | TC-1.1a |
| List Thread Views | See all active/draft/archived views | Story 1 | TC-1.4a |
| Create Draft | Start empty draft from source truth | Story 3 | TC-4.1a |
| Select Full-Fidelity Turns | Fill the full-fidelity band | Story 4 | TC-5.1a |
| Materialize Full Fidelity | Emit raw messages from selected turns | Story 4 | TC-5.2a |
| Select Smooth Turns | Fill the smooth band | Story 4 | TC-5.3a |
| Materialize Smooth | Emit smooth-turn messages | Story 4 | TC-5.4a |
| Inspect Lower-Band Readiness | Check chunk eligibility for detailed/brief bands | Story 5 | TC-6.3a |
| Compare Draft vs Active | See band and selection differences | Story 6 | TC-7.1a |
| Inspect Materialized Output | Review emitted message sequence before activation | Story 6 | TC-7.2a |
| Activate Draft | Draft becomes active, prior active archived | Story 6 | TC-7.3a |
| Verify Source Safety | Source Thread unchanged after activation | Story 6 | TC-7.4a |

### Path 2: Search, Inspect, and Decide

The steward finds relevant source content before making curation decisions.

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Search Messages | Find messages by content or metadata | Story 2 | TC-2.1a |
| Skim Results | Review compact summary rows | Story 2 | TC-2.2a |
| Open Message Detail | Inspect full message with all parts | Story 2 | TC-3.1a |
| Pivot to Turn | Navigate from message to owning turn | Story 2 | TC-3.4a |
| Open Turn Detail | Inspect turn with view placement info | Story 2 | TC-3.2b |
| Pivot to Thread View | Navigate from turn to view placement | Story 2 | TC-3.4b |
| Exclude Turn | Remove turn from draft as curation decision | Story 3 | TC-5.5a |
| Verify Source Safety | Source Thread unchanged after exclusion | Story 3 | TC-5.5b |

### Path 3: Draft Abandonment

The steward creates a draft, decides not to activate it, and archives it.

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Create Draft | Start empty draft from source truth | Story 3 | TC-4.1a |
| Archive Draft | Abandon the draft via archival | Story 3 | TC-4.5a |
| Verify Archived Readable | Archived draft remains readable | Story 6 | TC-7.4b |

### Path 4: Lower-Band Blocker Visibility

The steward inspects lower-band readiness and encounters an open or incomplete chunk.

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Inspect Lower-Band Readiness | Check chunk eligibility for detailed/brief bands | Story 5 | TC-6.3a |
| Open Chunk Blocked | Open chunk reported as ineligible for lower bands | Story 5 | TC-6.2a |
| Missing Artifact Reported | Closed chunk missing summary shown as not ready | Story 5 | TC-6.3b |
| Upper Bands Unblocked | Upper-band inspection remains available despite chunk issues | Story 5 | TC-6.4b |

### Path 5: Fixture Thread Inspection

Fixture Threads are readable through the same workbench surface.

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Open Fixture Thread | Read fixture through normal inspection flow | Story 1 | TC-1.5a |

**Integration gaps:** None. All path segments have story ownership and TC coverage.
