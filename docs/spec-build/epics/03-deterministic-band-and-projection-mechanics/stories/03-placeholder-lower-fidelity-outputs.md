# Story 3: Placeholder Lower-Fidelity Outputs

### Summary
<!-- Jira: Summary field -->

Closed Chunks receive deterministic 30% and 5% placeholder representations with explicit markers and token accounting.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Objective**

Deliver deterministic placeholder lower-fidelity representations for closed Chunks. The detailed placeholder compresses the Chunk body to approximately 30% of its smooth length. The brief placeholder compresses to approximately 5%. Both are explicitly marked as deterministic placeholders, not semantic summaries. Placeholder output is deterministic and regenerable. Token counts and strategy metadata are recorded.

**Scope**

In scope:
- Deterministic detailed placeholder at ~30% of smooth-chunk length
- Deterministic brief placeholder at ~5% of smooth-chunk length
- Explicit placeholder markers on both representations
- Deterministic regenerability (same input yields same output)
- Repair path for missing or deleted placeholders
- Token count recording for both representations
- Strategy metadata: `deterministic_truncate_30` and `deterministic_truncate_5`

Out of scope:
- Model-generated detailed summaries (Feature 4)
- Model-generated brief summaries (Feature 4)
- Band allocation using these representations (Story 4)

**Dependencies**

- Story 2 (closed Chunks with smooth text)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-3.1:** A closed Chunk receives a deterministic placeholder detailed representation.

- **TC-3.1a: Closed Chunk gets 30% placeholder representation**
  - Given: A Chunk is closed and has no detailed representation
  - When: placeholder detailed generation runs
  - Then: the Chunk receives a deterministic detailed representation at approximately 30% of the smooth-chunk length
- **TC-3.1b: Detailed placeholder is explicitly marked**
  - Given: A placeholder detailed representation exists
  - When: the representation is inspected
  - Then: it includes an explicit marker that it is a deterministic placeholder compression

**AC-3.2:** A closed Chunk receives a deterministic placeholder brief representation.

- **TC-3.2a: Closed Chunk gets 5% placeholder representation**
  - Given: A Chunk is closed and has no brief representation
  - When: placeholder brief generation runs
  - Then: the Chunk receives a deterministic brief representation at approximately 5% of the smooth-chunk length
- **TC-3.2b: Brief placeholder is explicitly marked**
  - Given: A placeholder brief representation exists
  - When: the representation is inspected
  - Then: it includes an explicit marker that it is a deterministic placeholder compression

**AC-3.3:** Placeholder lower-fidelity representations are deterministic and regenerable.

- **TC-3.3a: Same closed Chunk yields same placeholder output under same source state**
  - Given: A closed Chunk has unchanged smooth content
  - When: deterministic placeholder generation runs again
  - Then: the resulting placeholder representation is the same for that source state
- **TC-3.3b: Placeholder representation can be regenerated after deletion or invalidation**
  - Given: A closed Chunk is missing a placeholder representation
  - When: deterministic placeholder generation runs
  - Then: the representation is recreated through the same deterministic path

**AC-3.4:** Placeholder lower-fidelity generation records token accounting and strategy metadata.

- **TC-3.4a: Detailed placeholder records token count**
  - Given: A detailed placeholder representation is generated
  - When: its metadata is inspected
  - Then: the token count for that representation is available
- **TC-3.4b: Brief placeholder records token count and placeholder strategy**
  - Given: A brief placeholder representation is generated
  - When: its metadata is inspected
  - Then: the token count and placeholder strategy are available

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is where lower-band mechanics become real but still deliberately
low-quality. It does not try to be clever. It takes a closed Chunk’s smooth text
and produces two deterministic placeholder artifacts that later stories can use
for lower-band rebuild and compact testing.

The important architectural point is that these artifacts are persisted derived
Thread state, not in-memory helpers and not semantic summaries. They must
survive restarts and be readable by both rebuild/materialization and workbench
inspection.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Placeholder artifact types | `src/thread/async-thread/domain/placeholder-artifact-state.ts` |
| Placeholder build settings | `src/thread/async-thread/domain/settings.ts` |
| Placeholder artifact service | `src/thread/async-thread/services/placeholder-artifact-service.ts` |
| Supporting chunk reads | `src/thread/async-thread/services/chunk-service.ts`, `src/thread/store/thread-store.ts` |

#### Design References

- [tech-design-thread.md §Sequence: Flow 3 Placeholder Lower-Fidelity Representations](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:227), lines 227-268
- [tech-design-thread.md §Persisted State Layout](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:81), lines 81-113
- [test-plan.md §`tests/thread/placeholder-artifact-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:139), lines 139-150

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-3.1a | `tests/thread/placeholder-artifact-service.test.ts` | closed chunk gets 30 percent placeholder |
| TC-3.1b | `tests/thread/placeholder-artifact-service.test.ts` | detailed placeholder explicitly marked |
| TC-3.2a | `tests/thread/placeholder-artifact-service.test.ts` | closed chunk gets 5 percent placeholder |
| TC-3.2b | `tests/thread/placeholder-artifact-service.test.ts` | brief placeholder explicitly marked |
| TC-3.3a | `tests/thread/placeholder-artifact-service.test.ts` | placeholder output deterministic for same source state |
| TC-3.3b | `tests/thread/placeholder-artifact-service.test.ts` | placeholder output can regenerate after deletion |
| TC-3.4a | `tests/thread/placeholder-artifact-service.test.ts` | detailed placeholder records token count |
| TC-3.4b | `tests/thread/placeholder-artifact-service.test.ts` | brief placeholder records token count and strategy |

#### Non-TC Decided Tests

- `tests/thread/placeholder-artifact-service.test.ts`: repeated regeneration preserves explicit placeholder markers

#### Technical Notes

The two strategy values are already fixed by the epic:
- `deterministic_truncate_30`
- `deterministic_truncate_5`

This story should not introduce any model-facing abstraction yet. It is
preparing stable placeholder artifacts that Feature 4 can later replace with
semantic outputs without changing the surrounding mechanics.

#### Anti-Shim Requirements

- Prove truncation against real smooth chunk text and token/word-boundary logic, not by slicing a pre-shortened test string.
- Prove the explicit placeholder marker is part of the persisted artifact, not just something added at render time.

#### Verification

- Targeted: `node --import tsx --test tests/thread/placeholder-artifact-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 8 TCs pass (TC-3.1a through TC-3.4b)
- [ ] Placeholder artifacts persist alongside chunk state and survive process restart
- [ ] `npm run verify` passes
