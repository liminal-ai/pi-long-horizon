# Story 6: Blocked And Degraded Deterministic Maintenance State

### Summary
<!-- Jira: Summary field -->

Deterministic maintenance blockers, invalid state, threshold failures, and placeholder status remain explicit and inspectable.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Objective**

Deliver explicit blocked and degraded state reporting for the deterministic maintenance loop. Missing smooth output blocks dependent chunk or rebuild work. Missing placeholder lower-band output blocks lower-band use. Invalid chunk or Thread View state is reported rather than silently repaired. Threshold failures are reported as degraded output. All blocked and degraded state is inspectable through normal workbench concepts. Placeholder strategy remains visible and is never mistaken for semantic summarization quality.

**Scope**

In scope:
- Missing smooth output blocks dependent work explicitly
- Missing placeholder lower-band output blocks lower-band use explicitly
- Invalid chunk state reported explicitly
- Invalid Thread View materialization state reported explicitly
- Above-target draft reports degraded threshold result
- Compaction can stop on threshold failure
- Blocked smooth/chunk state visible through normal workbench inspection
- Projection failure state visible through inspectable output metadata
- Placeholder strategy visible in lower-band records
- Feature 3 output does not claim semantic summarization quality

Out of scope:
- Full async dependency-graph inspection (future)
- Automatic retry or recovery (future)

**Dependencies**

- Story 5 (smart compact and PI reload must exist for threshold failure and projection failure TCs to be observable)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-6.1:** Missing deterministic prerequisites block the dependent maintenance step explicitly.

- **TC-6.1a: Missing smooth output blocks dependent chunk or rebuild work**
  - Given: A later deterministic maintenance step depends on smooth output that is missing
  - When: that step runs
  - Then: the step is blocked explicitly
- **TC-6.1b: Missing placeholder lower-band output blocks lower-band use**
  - Given: lower-band allocation or compaction depends on placeholder output that is missing
  - When: the dependent step runs
  - Then: the step is blocked explicitly

**AC-6.2:** Invalid deterministic state is reported rather than silently repaired inside unrelated steps.

- **TC-6.2a: Invalid Chunk state is reported explicitly**
  - Given: Chunk state violates deterministic lifecycle expectations
  - When: the steward inspects or uses that Chunk
  - Then: the invalid state is reported explicitly
- **TC-6.2b: Invalid Thread View materialization state is reported explicitly**
  - Given: A Thread View cannot be materialized consistently from its selections
  - When: the steward attempts materialization or compaction
  - Then: the invalid state is reported explicitly

**AC-6.3:** Failure to hit the lower threshold is reported as degraded deterministic output rather than hidden success.

- **TC-6.3a: Above-target draft reports degraded threshold result**
  - Given: A rebuild completes but remains above the lower threshold
  - When: the result is inspected
  - Then: it reports degraded threshold state explicitly
- **TC-6.3b: Compaction can stop on threshold failure**
  - Given: manual smart compact cannot produce an acceptable draft under threshold policy
  - When: the operation completes or stops
  - Then: the threshold failure is explicit and not treated as silent success

**AC-6.4:** Deterministic maintenance state is inspectable through normal workbench concepts.

- **TC-6.4a: Blocked smooth or chunk state appears in inspectable records**
  - Given: deterministic maintenance has blocked state
  - When: the steward inspects the relevant Turn, Chunk, or Thread View
  - Then: the blocked state is visible through normal workbench inspection
- **TC-6.4b: Projection failure state appears in inspectable output metadata**
  - Given: compaction output or reload failed
  - When: projection metadata is inspected
  - Then: the failure state is visible through normal inspection surfaces

**AC-6.5:** Deterministic placeholder behavior remains explicit rather than being mistaken for final semantic quality.

- **TC-6.5a: Placeholder strategy is visible in lower-band records**
  - Given: a lower-band placeholder representation exists
  - When: the record is inspected
  - Then: the placeholder strategy is visible
- **TC-6.5b: Feature 3 output does not claim semantic summarization quality**
  - Given: Feature 3 deterministic lower-band output is used in a Thread View or projection
  - When: the output is inspected
  - Then: the system does not present it as model-calibrated semantic summary output

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the capstone observability story for Feature 3. It does not make
the deterministic loop happen. It makes the loop’s failures, blockers, and
degraded outcomes legible and inspectable across the normal read surfaces.

That means this story depends on earlier mechanics already existing:
- smooth and chunk state must be able to fail or block
- rebuild must be able to degrade
- smart compact must be able to produce compact-result and PI-load failure
  metadata

The subtle point is that some of its behavior is **owned** here but **observed**
through another seam. Threshold failure belongs to this story conceptually, but
the first place it appears is the smart compact command result.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Blocked/degraded state vocabulary | `src/thread/async-thread/domain/async-thread-status.ts` |
| Blocked/degraded evaluation | `src/thread/async-thread/services/async-thread-run-service.ts` |
| Workbench inspection over persisted state | `src/workbench/services/workbench-query-service.ts` |
| Command-result propagation for compact failures | `src/commands/smart-compact.ts` |

#### Design References

- [tech-design-thread.md §Sequence: Flow 6 Blocked And Degraded Deterministic Maintenance State](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:269), lines 269-378
- [tech-design-thread-view.md §Workbench Adjustments](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread-view.md:233), lines 233-246
- [test-plan.md §`tests/thread/async-thread-run-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:223), lines 223-230
- [test-plan.md §`tests/workbench/workbench-query-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:214), lines 214-221
- [test-plan.md §`tests/commands/smart-compact.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:199), lines 199-212

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-6.1a | `tests/thread/async-thread-run-service.test.ts` | missing smooth output blocks dependent work explicitly |
| TC-6.1b | `tests/thread/async-thread-run-service.test.ts` | missing placeholder output blocks lower-band use explicitly |
| TC-6.2a | `tests/thread/async-thread-run-service.test.ts` | invalid chunk state reported explicitly |
| TC-6.2b | `tests/thread/async-thread-run-service.test.ts` | invalid Thread View materialization state reported explicitly |
| TC-6.3a | `tests/commands/smart-compact.test.ts` | above-target draft reports degraded threshold result |
| TC-6.3b | `tests/commands/smart-compact.test.ts` | compaction can stop on threshold failure |
| TC-6.4a | `tests/workbench/workbench-query-service.test.ts` | blocked smooth or chunk state appears in inspectable records |
| TC-6.4b | `tests/workbench/workbench-query-service.test.ts` | projection failure state appears in inspectable output metadata |
| TC-6.5a | `tests/workbench/workbench-query-service.test.ts` | placeholder strategy visible in lower-band records |
| TC-6.5b | `tests/workbench/workbench-query-service.test.ts` | Feature 3 output does not claim semantic summary quality |

#### Non-TC Decided Tests

- `tests/workbench/workbench-query-service.test.ts`: chunk-backed lower-band inspection remains available after store reopen

#### Technical Notes

Ownership is by AC, not by first observation seam. That is why the threshold
failure TCs belong to this story even though the primary test file is
`tests/commands/smart-compact.test.ts`.

#### Anti-Shim Requirements

- Prove blocked and degraded state from persisted Thread/Thread View/output metadata, not by hard-coding final status strings in the workbench layer.
- Prove placeholder explicitness through the same read surfaces a steward uses, not by checking only raw stored fields in isolation.

#### Verification

- Targeted: `node --import tsx --test tests/thread/async-thread-run-service.test.ts tests/workbench/workbench-query-service.test.ts tests/commands/smart-compact.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 10 TCs pass (TC-6.1a through TC-6.5b)
- [ ] Blocked/degraded state visible through workbench inspection
- [ ] Placeholder strategy explicit in all lower-band records
- [ ] `npm run verify` passes
