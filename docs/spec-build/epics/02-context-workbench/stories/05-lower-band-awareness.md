# Story 5: Lower-Band Awareness

### Summary
<!-- Jira: Summary field -->

Show lower-band chunk selections, keep open chunk content out of detailed and brief bands, expose minimal lower-band readiness, and provide chunk detail without the full chunk-maintenance workflow.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages long-running PI coding sessions whose useful context is larger than a raw transcript. The steward needs to find relevant source material quickly, understand how that material is currently represented, and build or revise Thread Views without mutating source truth.

**Objective**

Deliver minimal lower-band awareness. The workbench shows which closed chunks are eligible for detailed and brief bands, enforces that open chunk content stays in the smooth band, and exposes readiness signals for lower-band representations. Chunk detail is available but deliberately shallow — the full chunk-maintenance control plane remains Feature 3.

**Scope**

In scope:
- Detailed and brief bands use chunk selections
- Open chunk excluded from lower bands
- Closed chunk readiness (has required summary artifact or not)
- Minimal chunk detail view (identity, lifecycle, available representations)
- Missing chunk data does not block upper-band inspection

Out of scope:
- Chunk boundary editing or rework
- Chunk closure decisions
- Summary generation
- Full async dependency-chain visibility

**Dependencies**

- Story 4 (upper-band composition, materializer)
- Epic 1 ThreadStore for chunk metadata reads (when available)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-6.1:** Using the workbench, the steward can see that detailed and brief bands are chunk-based.

- **TC-6.1a: Detailed band uses chunk selections**
  - Given: A Thread View contains a detailed band
  - When: The workbench reads the band's composition
  - Then: The selected source units are chunks
- **TC-6.1b: Brief band uses chunk selections**
  - Given: A Thread View contains a brief band
  - When: The workbench reads the band's composition
  - Then: The selected source units are chunks

**AC-6.2:** Using the workbench, the steward can rely on open chunk content remaining outside lower-band representations.

- **TC-6.2a: Open chunk does not enter detailed band**
  - Given: A chunk is open
  - When: The steward inspects lower-band eligibility
  - Then: That chunk is not eligible for detailed-band representation
- **TC-6.2b: Open chunk does not enter brief band**
  - Given: A chunk is open
  - When: The steward inspects lower-band eligibility
  - Then: That chunk is not eligible for brief-band representation

**AC-6.3:** Using the workbench, the steward can inspect lower-band readiness.

- **TC-6.3a: Closed chunk with detailed artifact is shown as eligible for detailed band**
  - Given: A closed chunk has its detailed summary available
  - When: The workbench inspects lower-band readiness
  - Then: The chunk is shown as eligible for detailed-band use
- **TC-6.3b: Closed chunk missing required artifact is shown as not ready**
  - Given: A closed chunk lacks a required lower-band artifact
  - When: The workbench inspects lower-band readiness
  - Then: The chunk is shown as not ready for the relevant lower band

**AC-6.4:** Using the workbench, the steward can inspect chunk state in a minimal, reader-oriented way.

- **TC-6.4a: Chunk detail can be opened without exposing full chunk-control workflow**
  - Given: A chunk exists
  - When: The steward opens chunk detail
  - Then: The workbench shows chunk identity, lifecycle state, and available representations without exposing the full maintenance control plane
- **TC-6.4b: Missing chunk data does not block upper-band inspection**
  - Given: Chunk artifacts are incomplete
  - When: The steward inspects full-fidelity or smooth-band composition
  - Then: Upper-band inspection remains available and chunk incompleteness is localized to lower-band readiness

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is intentionally shallow compared with the upper-band story. It does not decide chunk boundaries, generate summaries, or orchestrate background work. It reads chunk state produced elsewhere and makes that state understandable enough for a steward to reason about lower-band composition.

This story also owns the minimal chunk detail surface itself. Story 2 only owns the pivot to chunk detail.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Lower-band query logic | `src/context-workbench/services/workbench-query-service.ts` |
| Chunk read shape | `src/context-workbench/domain/thread-view-records.ts` |
| Lower-band readiness tests | `tests/context-workbench/workbench-query-service.test.ts` |

#### Design References

- [tech-design.md §Flow 6: Lower-Band Awareness](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:512), lines 512-543
- [tech-design.md §Record Schemas](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:205), lines 205-263
- [tech-design.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:617), lines 617-682
- [test-plan.md §workbench-query-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:99), lines 99-106

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-6.1a | `tests/context-workbench/workbench-query-service.test.ts` | detailed band uses chunk selections |
| TC-6.1b | `tests/context-workbench/workbench-query-service.test.ts` | brief band uses chunk selections |
| TC-6.2a | `tests/context-workbench/workbench-query-service.test.ts` | open chunk does not enter detailed band |
| TC-6.2b | `tests/context-workbench/workbench-query-service.test.ts` | open chunk does not enter brief band |
| TC-6.3a | `tests/context-workbench/workbench-query-service.test.ts` | closed chunk with detailed artifact shown as eligible |
| TC-6.3b | `tests/context-workbench/workbench-query-service.test.ts` | closed chunk missing artifact shown as not ready |
| TC-6.4a | `tests/context-workbench/workbench-query-service.test.ts` | chunk detail remains minimal |
| TC-6.4b | `tests/context-workbench/workbench-query-service.test.ts` | missing chunk data does not block upper-band inspection |

#### Non-TC Decided Tests

None.

#### Technical Notes

The workbench consumes only a minimal chunk read shape here:

| Field | Type | Required | Description |
|------|------|----------|-------------|
| chunkId | string | yes | Chunk identifier |
| lifecycleStatus | string | yes | `open` or `closed` |
| sourceTurnIds | array of string | yes | Turns grouped into the chunk |
| smoothText | string | no | Concatenated smooth-turn content |
| smoothTokenCount | integer | no | Token count for smooth representation |
| detailedSummary | string | no | ~30% actor-narrative summary |
| detailedSummaryTokenCount | integer | no | Token count for detailed summary |
| briefSummary | string | no | ~5% brief narrative summary |
| briefSummaryTokenCount | integer | no | Token count for brief summary |

Lower-band readiness statuses:

| Status | Meaning |
|------|---------|
| `eligible` | Closed chunk with required summary artifact available |
| `missing_artifacts` | Closed chunk but required summary not yet generated |
| `blocked` | Closed chunk with failed or unreachable summary state |
| `ineligible_open_chunk` | Chunk is still open and cannot enter lower bands |

#### Anti-Shim Requirements

- Prove lower-band readiness against actual chunk lifecycle and summary fields, not by hard-coding statuses in the query layer.
- Prove that incomplete chunk data does not break upper-band inspection in the same test fixture, not by testing those concerns in total isolation.

#### Verification

- Targeted: `node --import tsx --test tests/context-workbench/workbench-query-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All TCs pass (TC-6.1a through TC-6.4b)
- [ ] Open chunk enforced as ineligible for lower bands
- [ ] Chunk detail returns minimal lifecycle/representation data
- [ ] Upper-band inspection unblocked by incomplete chunk state
- [ ] `npm run verify` passes
- [ ] `npm run green-verify` passes
