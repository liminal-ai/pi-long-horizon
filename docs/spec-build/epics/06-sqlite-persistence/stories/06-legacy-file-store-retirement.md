# Story 6: Legacy File-Store Retirement And Compatibility Cleanup

### Summary
<!-- Jira: Summary field -->

Retire or quarantine active JSON source writes while preserving explicit legacy import, export, and fixture support.

### Description
<!-- Jira: Description field -->

**User Profile:** Long Horizon operator / tech lead maintaining managed PI sessions.

**Objective:** Prevent split-brain managed state after SQLite cutover while keeping legacy file-backed workflows explicit and safe.

**Scope In:**

- Guard active runtime code from mutating legacy JSON as source truth after SQLite cutover.
- Remove or quarantine whole-array compatibility usage from active high-contention paths where row-level methods exist.
- Preserve file-backed import/export/fixture support with explicit legacy labels.
- Add regression coverage across capture, maintenance, compact, inspection, migration, and snapshot workflows.

**Scope Out:**

- Removing generated PI rollout JSONL.
- Removing legacy import/export support.
- New provider/model support.
- Broad smart compact UX redesign.

**Dependencies:**

- Story 2 whole-store runtime compatibility cutover.
- Story 3 row-level maintenance adaptation.
- Story 4 compact snapshot/regeneration.
- Story 5 inspection/snapshot/export.
- `tech-design.md` Sections 5.3, 5.4, 11, 14, and 15.
- `test-plan.md` Chunk 6.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-7.3:** Legacy file-backed fixtures remain usable during transition.

- **TC-7.3a:** Given existing tests or fixtures in file-backed layout, when the transition begins, then they either import into SQLite-backed state or remain explicitly supported by a legacy adapter until retired.

**AC-7.4:** Active writes do not split between JSON and SQLite source truth.

- **TC-7.4a:** Given a thread has been cut over to SQLite-backed persistence, when runtime capture, maintenance, repair, compact, and inspection run, then active managed source writes do not continue to mutate legacy JSON files as a competing source of truth.

**AC-7.5:** Rollback or fallback behavior is explicit.

- **TC-7.5a:** Given a migration or cutover cannot complete, when the operator inspects state, then the system identifies whether the active source truth is still file-backed or SQLite-backed and what action is required.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 6 closes the authority transition. After SQLite cutover and row-level adaptation, active managed source writes must not split between legacy JSON files and `thread.sqlite`. Legacy file-backed support remains only for import/export/fixtures/debug, with explicit labels and guardrails.

This is a cleanup/retirement story, but it is high authority-risk: a small accidental legacy write can recreate split-brain state.

#### Build Strategy

Strategy: tdd-lite

Reason:
- The implementation should be mostly cleanup, guards, labels, and regression smoke.
- The risk is broad surface area, so tests should focus on source-truth boundaries rather than exhaustive internal rewrites.

Risk Reminders:
- Keep generated PI rollout JSONL; it is not legacy managed source.
- Preserve legacy import/export/fixture workflows explicitly.
- Remove, guard, or label remaining compatibility methods based on active-path usage.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Runtime write guards | store factory/runtime paths touched in Story 2 |
| Compatibility cleanup | `SqliteThreadStore` compatibility methods and any remaining high-contention callers |
| Legacy adapters | file-store import/export/fixture adapters |
| Snapshot/export labels | snapshot/export manifest and legacy JSON export labeling |
| Tests | `legacy-compat-sqlite.test.ts`, root smoke/grep guard |

#### Design References

- [tech-design.md §Compatibility direction](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:245), lines 245-271
- [tech-design.md §Whole-array compatibility strategy](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:272), lines 272-284
- [tech-design.md §Inspection, Snapshot, Export](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:643), lines 643-674
- [tech-design.md §Work Breakdown](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:771), lines 771-852
- [test-plan.md §Snapshot/export and compatibility tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:182), lines 182-191
- [test-plan.md §Chunk 6](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:309), lines 309-318
- [coverage.md §Story 06](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md:136), lines 136-140

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-7.3a | `legacy-compat-sqlite.test.ts` | file-backed fixtures/import workflows remain usable through explicit legacy adapter/import path |
| TC-7.4a | `legacy-compat-sqlite.test.ts`, root smoke/grep guard | runtime capture, maintenance, compact, inspection, and repair do not actively mutate legacy JSON as competing source truth |
| TC-7.5a | `legacy-compat-sqlite.test.ts` | failed migration/cutover exposes active source-truth backing and required operator action |

#### Architecture-Risk Tests

| Risk | Test File / Check | Test Description | Why AC/TC Mapping Alone Would Miss It |
|------|-------------------|------------------|---------------------------------------|
| Active Split-Brain Regression | `legacy-compat-sqlite.test.ts` | active runtime refuses/avoids JSON+SQLite source writes after cutover | AC wording can pass with partial cleanup while one path still writes JSON |
| Direct JSON Assumption Guard | root smoke/grep guard | direct managed JSON source writes are absent, guarded, or explicitly legacy-labeled | Codebase-wide cleanup risk is easy to miss in service tests |

#### Authority Boundary

Allowed:
- legacy file-backed import;
- legacy/debug export;
- fixture support;
- generated PI rollout JSONL output.

Forbidden:
- active managed source writes to legacy JSON after SQLite cutover;
- generated rollout JSONL being used to overwrite canonical SQLite state;
- unlabeled file-store compatibility paths in production defaults.

#### Anti-Shim Requirements

- Do not delete file-backed tests/fixtures just to make SQLite the only tested path.
- Do not satisfy split-brain prevention only with documentation; add executable guardrails where practical.
- Do not remove generated rollout JSONL, which remains the PI-facing projection artifact.

#### Production Path Proof

- Entrypoint: runtime capture, maintenance, compact, inspection/reporting, migration, and snapshot/export surfaces after cutover.
- Evidence: smoke/grep guard plus selected end-to-end or local integration checks that active defaults no longer write legacy source JSON.

#### Verification

- Targeted: Chunk 6 checks listed above
- Story gate: `npm run verify`
- Selected smoke/E2E: run where needed to prove active defaults and no split-brain behavior

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Active runtime source writes no longer mutate legacy JSON source files after cutover.
- [ ] Legacy file-backed import/export/fixture paths remain explicit.
- [ ] Compatibility method usage is retired, guarded, or labeled.
- [ ] Regression coverage spans capture, maintenance, compact, inspection, migration, and snapshot surfaces.
- [ ] `npm run verify` and selected smoke/E2E checks pass or known-red issues are tracked.
