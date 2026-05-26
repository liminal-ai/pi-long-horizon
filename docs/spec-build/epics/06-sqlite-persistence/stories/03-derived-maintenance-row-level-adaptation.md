# Story 3: Derived Maintenance Row-Level Adaptation

### Summary
<!-- Jira: Summary field -->

Move async maintenance and repair from whole-array compatibility writes to targeted SQLite row updates with visible retryable debt.

### Description
<!-- Jira: Description field -->

**User Profile:** Long Horizon operator / tech lead maintaining managed PI sessions.

**Objective:** Adapt derived maintenance to SQLite's granular persistence model after the whole-store compatibility cutover.

**Scope In:**

- Bounded background maintenance uses targeted row-level updates for affected turns, chunks, artifacts, token counts, and readiness debt.
- Manual repair and prepare paths remain full catch-up paths.
- Exact token repair preserves provider/trust metadata.
- Stale provider results revalidate source revision/input hash before commit.
- Maintenance status distinguishes bounded backlog, provider failures, invalid state, and manual repair failures.

**Scope Out:**

- Runtime store factory cutover.
- Smart compact snapshot hardening.
- `lhx` full SQLite inspection work.
- Legacy compatibility retirement.

**Dependencies:**

- Story 2 whole-store runtime compatibility cutover.
- `tech-design.md` Sections 7, 8, 9, 13, and 14.
- `test-plan.md` Chunk 3.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.1:** Background maintenance performs bounded derived repair.

- **TC-4.1a:** Given newly affected turns or chunks, when background maintenance runs, then it repairs only the configured bounded set and leaves remaining debt visible.
- **TC-4.1b:** Given no affected derived state, when background maintenance runs, then it exits without changing readiness or projection metadata unnecessarily.

**AC-4.2:** Manual repair can perform full catch-up.

- **TC-4.2a:** Given historical repair debt, when the manual repair operation runs, then it attempts full catch-up for eligible dirty turns, chunks, artifacts, and token metadata.
- **TC-4.2b:** Given provider or token-counter failures during manual repair, when the operation completes, then failures are persisted and reported without generating or reloading a PI rollout unless explicitly requested by a separate operation.

**AC-4.3:** Derived writes are granular and retryable.

- **TC-4.3a:** Given token repair updates one affected turn, when it commits, then unrelated turns are not rewritten as a requirement of the update.
- **TC-4.3b:** Given a transient store contention event, when derived repair retries or defers, then repair-needed state remains visible and the next maintenance pass can continue.

**AC-4.4:** Exact token repair preserves trust metadata.

- **TC-4.4a:** Given heuristic or missing token counts, when exact provider-backed counting succeeds, then count value, source, trust class, provider/model/encoding metadata, and affected entity are persisted.
- **TC-4.4b:** Given exact token repair only partially completes, when readiness is inspected, then tokenCounting remains repair-needed for unresolved affected records.

**AC-4.5:** Artifact invalidation propagates to dependent state.

- **TC-4.5a:** Given a smooth turn artifact changes, when dependent chunk or lower-band artifacts become stale, then affected readiness/debt is marked without silently serving invalid dependent artifacts as ready.
- **TC-4.5b:** Given lower-band detailed/brief artifacts are regenerated, when readiness is inspected, then provider provenance and token metadata reflect the regenerated artifact.

**AC-4.6:** Maintenance status is inspectable.

- **TC-4.6a:** Given background or manual maintenance runs, when inspected, then last run status, fixed/skipped/failed counts, remaining debt, and blocker summaries are available at the thread level.
- **TC-4.6b:** Given specific turns, chunks, artifacts, or token records still have maintenance debt, when inspected, then affected entity IDs or ranges and debt categories are visible where available.
- **TC-4.6c:** Given background bounded maintenance and manual full repair both run, when inspected, then their results are distinguishable enough to tell whether remaining debt is expected bounded backlog, provider failure, invalid state, or manual repair failure.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 3 adapts derived maintenance after SQLite is already the active store. Story 2 compatibility methods may still support whole-array callers; this story moves high-contention maintenance paths to targeted row-level writes for turns, chunks, artifacts, token counts, readiness issues, and maintenance status.

Canonical source remains authoritative. Derived artifacts are repairable and must never corrupt or roll back canonical messages.

#### Build Strategy

Strategy: full-staged-risk

Reason:
- This story touches provider-backed derived artifacts, exact token repair, bounded-vs-full repair semantics, and stale-result recovery.
- The most important test is the real Node interleaving: read, yield for async provider/counting work, source changes, stale derived commit attempt.

Risk Reminders:
- Background maintenance remains bounded/incremental.
- Manual repair and prepare remain full catch-up paths.
- Remaining debt must stay inspectable; it must not disappear because a bounded pass stopped early.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Async maintenance | `src/thread/async-thread/*`, `maintainAsyncThread`, `prepareAsyncThread` |
| Manual repair | `src/thread/async-thread/services/thread-maintenance-repair-service.ts` or successor root repair service |
| Token repair | `repairOpenAITokenCounts`, token metadata/readiness persistence |
| Derived artifacts | smoothing, lower-band projection, chunk update services |
| SQLite row APIs | row-level artifact/token/readiness/maintenance methods on `SqliteThreadStore` |
| Tests | `sqlite-maintenance-row-level.test.ts`, `sqlite-manual-repair.test.ts`, `sqlite-token-counts.test.ts`, `sqlite-maintenance-reporting.test.ts` |

#### Design References

- [tech-design.md §Whole-array compatibility strategy](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:272), lines 272-284
- [tech-design.md §Token and readiness tables](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:447), lines 447-467
- [tech-design.md §Derived transactions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:502), lines 502-513
- [tech-design.md §Derived-state provenance](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:533), lines 533-545
- [tech-design.md §Deterministic algorithm boundaries](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:546), lines 546-555
- [tech-design.md §Runtime Flows](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:585), lines 585-591
- [tech-design.md §Async interface over synchronous SQLite](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:760), lines 760-768
- [test-plan.md §Async maintenance and repair tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:138), lines 138-154
- [test-plan.md §Chunk 3](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:268), lines 268-280
- [coverage.md §Story 03](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md:118), lines 118-123

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-4.1a, TC-4.1b | `sqlite-maintenance-row-level.test.ts` | bounded background maintenance repairs configured affected set and no-ops cleanly when nothing is dirty |
| TC-4.2a, TC-4.2b | `sqlite-manual-repair.test.ts` | manual repair performs full catch-up and reports provider/token failures without generating rollout |
| TC-4.3a, TC-4.3b | `sqlite-maintenance-row-level.test.ts` | one affected turn update avoids unrelated rewrites and retry/defer leaves visible debt |
| TC-4.4a, TC-4.4b | `sqlite-token-counts.test.ts` | exact token counts persist trust/provider/model/encoding metadata; partial repair leaves tokenCounting debt |
| TC-4.5a, TC-4.5b | `sqlite-maintenance-row-level.test.ts` | smooth/lower-band changes invalidate dependent readiness and regenerated artifacts preserve provenance/token metadata |
| TC-4.6a, TC-4.6b, TC-4.6c | `sqlite-maintenance-reporting.test.ts` | maintenance status reports run outcome, affected entities, and background-vs-manual distinction |

#### Architecture-Risk Tests

| Risk | Test File / Check | Test Description | Why AC/TC Mapping Alone Would Miss It |
|------|-------------------|------------------|---------------------------------------|
| Concurrency / Lost Update | `sqlite-maintenance-row-level.test.ts` | simulate read → async provider yield → capture/source write → stale derived commit attempt | This is the actual local Node race shape under sync SQLite + async providers |
| Derived-State Provenance | `sqlite-derived-artifacts.test.ts` or row-level maintenance test | stale revision/settings/input hash marks artifact repair-needed and blocks readiness | Counts alone can hide invalid artifact reuse |
| Bounded vs Full Repair | `sqlite-maintenance-row-level.test.ts`, `sqlite-manual-repair.test.ts` | background caps leave visible backlog; manual/prepare drains eligible debt | Both paths may call shared primitives but must keep different budgets |

#### Source/Derived Boundary

- Provider/token-counter calls happen outside DB transactions.
- Derived write transactions revalidate source revision and representation hash before committing.
- Derived repair failure persists retryable debt/status; it does not fail or roll back canonical source rows.

#### Anti-Shim Requirements

- Do not pass this story by keeping all maintenance writes on compatibility `writeTurns`/`writeChunks` when row-level APIs exist.
- Do not hide remaining debt after bounded maintenance.
- Do not mock internal maintenance/store modules for integration confidence; mock only provider/token-counter boundaries.

#### Production Path Proof

- Entrypoint: existing bounded background maintenance and manual repair/prepare service entrypoints.
- Default deps: prove production service wiring can use row-level SQLite methods without falling back to whole-file JSON writes.
- E2E: not required for every edge case; service/local integration tests are primary here.

#### Verification

- Targeted: Chunk 3 test files listed above
- Story gate: `npm run verify`
- Optional runtime smoke only if service wiring cannot prove a production-path concern

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Background maintenance updates affected rows only.
- [ ] Manual repair remains full catch-up.
- [ ] Exact token metadata and trust source are persisted correctly.
- [ ] Remaining debt is visible after partial repair.
- [ ] Stale derived results cannot clobber newer source/artifact state.
- [ ] `npm run verify` passes or any known-red issue is explicitly tracked.
