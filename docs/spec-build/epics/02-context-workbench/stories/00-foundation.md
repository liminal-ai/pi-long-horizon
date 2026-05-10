# Story 0: Foundation

### Summary
<!-- Jira: Summary field -->

Establish shared record vocabulary, error codes, test fixtures, and verification scripts for Context Workbench implementation.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages long-running PI coding sessions whose useful context is larger than a raw transcript. The steward needs to find relevant source material quickly, understand how that material is currently represented, and build or revise Thread Views without mutating source truth.

**Objective**

Deliver the domain types, error infrastructure, test fixture builders, and temp-store helpers that all subsequent workbench stories depend on.

**Scope**

In scope:
- Thread View, Band, ThreadViewMessage, and SearchResultSummary record types
- WorkbenchChunkRead minimal chunk read shape
- Feature 2 error codes and StewardResult helpers
- Thread View fixture builders (makeThreadView, makeBandRecord, makeThreadViewMessage, makeWorkbenchSearchInput)
- Temp workbench store helper (withTempWorkbenchStore)
- Verification script wiring for workbench test files

Out of scope:
- Service implementations
- Store implementations
- Any PI runtime integration

**Dependencies**

- Epic 1 domain records (ThreadRecord, MessageRecord, TurnRecord, ActorRecord, etc.)
- Epic 1 error infrastructure (StewardResult, StewardIssue, StewardErrorCode)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

Story 0 has no epic ACs. It delivers infrastructure that enables all subsequent stories.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story establishes the shared workbench vocabulary that every later story depends on. The critical output is not user-visible behavior. It is a stable set of record shapes and helpers that preserve the design's core distinctions:

- source Thread versus Thread View
- persisted composition truth versus computed convenience outputs
- turn-based upper-band selection versus chunk-based lower-band reads

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Thread View record vocabulary | `src/context-workbench/domain/thread-view-records.ts` |
| Workbench error/result helpers | `src/context-workbench/domain/workbench-errors.ts` |
| Test fixtures | `src/context-workbench/test/fixtures.ts` |
| Temp store helpers | `src/context-workbench/test/temp-workbench-store.ts` |
| Verification script wiring | `package.json`, `scripts/run-node-tests.mjs` |

#### Design References

- [tech-design.md §Record Schemas](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:205), lines 205-300
- [tech-design.md §Persisted vs Computed Split](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:366), lines 366-378
- [tech-design.md §Chunk 0: Foundation](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:768), lines 768-778
- [test-plan.md §Non-TC Decided Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:182), lines 182-198

#### Test Mapping

None. Story 0 has no epic-owned ACs or TCs.

#### Non-TC Decided Tests

- `foundation.test.ts`: Thread View id and emitted-message ordering helpers are deterministic
- `foundation.test.ts`: band-order concatenation helpers preserve `full_fidelity -> smooth -> detailed -> brief`

#### Technical Notes

Thread View records should be complete enough to persist both composition truth and emitted result. Search result summaries and comparison outputs are intentionally not part of the persisted record family.

#### Anti-Shim Requirements

- Prove fixture builders emit records that match the design shapes, not just partial objects used by one test.
- Keep helpers generic across all later workbench stories. Do not bake Story 1-only or Story 4-only assumptions into foundation fixtures.

#### Verification

- Targeted: `npm run typecheck && node --import tsx --test tests/context-workbench/foundation.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All record types compile and are importable
- [ ] All error codes are defined and exportable
- [ ] Fixture builders produce valid record instances
- [ ] Temp workbench store helper creates and cleans up isolated roots
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes with foundation tests
