# Story 0: Foundation

### Summary
<!-- Jira: Summary field -->

Deterministic smoothing, chunking, placeholder, and compaction foundation types, fixtures, error codes, compaction-input helpers, and test utilities.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Objective**

Establish the shared infrastructure for all Feature 3 stories: domain record types for smooth-turn state, chunk lifecycle, placeholder artifacts, and smart compact results; error/blocker codes; compaction-input validation helpers; test fixture builders; and temp store helpers. This story also includes the surface/name migration scaffolding from the older `context-steward`/`context-workbench` module structure to the cleaner `thread`/`thread-view`/`workbench` layout.

**Scope**

In scope:
- Smooth-turn state, chunk lifecycle, placeholder artifact, and async-thread status domain types
- Smart compact result and compaction-input types
- Error/blocker code vocabulary (SMOOTH_MISSING, SMOOTH_INVALID, CHUNK_STATE_INVALID, CHUNK_PLACEHOLDER_MISSING, LOWER_THRESHOLD_UNREACHED, GENERATED_WRITE_FAILED, PI_RELOAD_FAILED)
- Chunk close settings and placeholder build settings types
- Test fixture builders (makeSmoothTurnState, makeChunkState, makePlaceholderArtifactState, withTempThreadStore, withTempFeature3Store)
- Surface/name migration scaffolding from `context-steward`/`context-workbench` to `thread`/`thread-view`/`workbench`
- Migration verification: existing Epic 1 and Epic 2 test suites must remain green after migration

Out of scope:
- Any service implementation (Stories 1–6)
- Any TC-mapped behavior

**Dependencies**

- Epic 2 implementation complete

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

No epic ACs are assigned to this story. Story 0 provides shared infrastructure consumed by Stories 1–6.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 0 is the one place where Feature 3 is allowed to do broad structural
prep work without pretending to deliver user-facing behavior yet. It sets up
the new surface vocabulary, the core derived-state record shapes, the mutation
coordination seam, and the fixture/test helpers that every later story depends
on. If this story is sloppy, the rest of the feature will either duplicate
infrastructure or fight naming and import churn all the way through.

This story also owns the migration scaffolding from the older
`context-steward` / `context-workbench` layout into the cleaner `thread`,
`thread-view`, `workbench`, `harness-adapter`, and `commands` structure. The
goal is not to “finish the refactor forever” here. The goal is to create stable
paths and exports that later Feature 3 stories can build on without dragging
old naming deeper into the repo.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Surface migration scaffolding | `src/thread/`, `src/thread-view/`, `src/workbench/`, `src/harness-adapter/`, `src/commands/` |
| Derived-state domain types | `src/thread/async-thread/domain/smooth-turn-state.ts`, `src/thread/async-thread/domain/chunk-state.ts`, `src/thread/async-thread/domain/placeholder-artifact-state.ts`, `src/thread/async-thread/domain/async-thread-status.ts`, `src/thread/async-thread/domain/settings.ts` |
| Thread mutation coordination | `src/thread/store/mutation-coordinator.ts` |
| PI-target file vocabulary | `src/thread-view/domain/pi-thread-view-file.ts` |
| Feature 3 fixture/test helpers | `src/thread/async-thread/test/fixtures.ts`, `src/thread-view/test/fixtures.ts`, `src/thread/async-thread/test/temp-thread-store.ts` |

#### Design References

- [tech-design.md §Architecture Decisions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design.md:220), lines 220-236
- [tech-design.md §Module Boundaries](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design.md:238), lines 238-333
- [tech-design-thread.md §Persisted State Layout](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:81), lines 81-113
- [test-plan.md §Non-TC Decided Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:232), lines 232-247
- [test-plan.md §Chunk 0 Migration Verification](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:271), lines 271-279

#### Test Mapping

None. Story 0 owns no epic TCs.

#### Non-TC Decided Tests

- `tests/thread/foundation.test.ts`: deterministic id and token-count helpers are stable across reruns
- `tests/thread/foundation.test.ts`: thread-scoped mutation coordinator rejects stale revision writes cleanly

#### Technical Notes

- Keep compatibility re-exports as thin as possible if the migration lands incrementally.
- Do not deepen old names like `context-steward`, `projection`, or `runtime integration` in new files.
- The mutation coordinator interface must exist before rebuild and compact services land.

#### Anti-Shim Requirements

- Prove migration safety by running the full existing Epic 1 and Epic 2 suites, not just Feature 3-local tests.
- Do not satisfy this story with doc-only or path-only moves; the new modules and exports must be importable and usable by later stories.

#### Verification

- Targeted: `node --import tsx --test tests/thread/foundation.test.ts`
- Story gate: `npm run verify-all`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All domain types compile and are importable by downstream stories
- [ ] All error/blocker codes are defined and exported
- [ ] All test fixture builders are functional
- [ ] Surface/name migration complete
- [ ] `npm run verify-all` passes with all existing Epic 1 and Epic 2 tests green
