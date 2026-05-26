# Story 0: SQLite Store Foundation

### Summary
<!-- Jira: Summary field -->

Add the SQLite store foundation, schema migration rails, and SQLite-aware test helpers needed before migration or runtime cutover work begins.

### Description
<!-- Jira: Description field -->

**User Profile:** Long Horizon operator / tech lead maintaining managed PI sessions.

**Objective:** Establish the local SQLite persistence foundation without changing the active runtime source of truth.

**Scope In:**

- Add the SQLite dependency and internal schema migration runner.
- Create `thread.sqlite` open/create/migrate helpers.
- Add test helpers such as `withTempSqliteThreadStore(...)` or `createTestThreadStore({ backing })`.
- Add store compatibility smoke coverage for existing whole-array methods.
- Add a migration smoke fixture proving file-backed state can be opened and partially imported for validation.

**Scope Out:**

- Full file-backed migration/entity coverage.
- Runtime `createStore` cutover.
- Row-level maintenance adaptation.
- Smart compact read-snapshot hardening.
- `lhx` SQLite read support.

**Dependencies:**

- `tech-design.md` Sections 5–8 and 12.
- `test-plan.md` Chunk 0.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**FC-0.1:** SQLite database lifecycle helpers exist.

- Given a temp project root, when the SQLite store foundation opens or creates a thread database, then schema migrations are applied and the database can be reopened from disk.

**FC-0.2:** Test helpers support SQLite-backed stores.

- Given a service test that needs a managed thread store, when it uses the new test-store helper, then it can request file-backed or SQLite-backed storage explicitly.

**FC-0.3:** Existing compatibility methods have smoke coverage.

- Given a SQLite-backed store, when compatibility methods such as `openThread`, `readChunks`, `writeTurns`, and `writeChunks` are called in simple cases, then they behave through the existing `ThreadStore` result/error contract.

**FC-0.4:** Migration smoke fixture exists.

- Given a minimal file-backed thread fixture, when the migration smoke path runs, then it creates a SQLite database and reports imported core identity/message state without changing active runtime behavior.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 0 is foundation only: it creates the SQLite dependency, DB lifecycle, migration rails, and SQLite-aware fixture/test infrastructure needed by later behavior stories. It must not become hidden discovery work or a partial runtime cutover. The active runtime source of truth remains the file-backed store until Story 2.

The `FC-0.x` identifiers are Foundation Criteria, not epic AC/TC ownership. They exist so the foundation story can be implemented and tested without stealing AC/TC ownership from migration/runtime stories.

#### Build Strategy

Strategy: full-staged-risk

Reason:
- This story establishes persistence and fixture rails that every later story trusts.
- Bad helper abstractions or in-memory SQLite shortcuts would make later green tests misleading.

Risk Reminders:
- Keep runtime behavior unchanged.
- Use real temp SQLite DB files for persistence/reopen checks.
- Adapt existing fixture infrastructure; do not create a parallel fixture universe.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Store interface / factory | `src/thread/store/thread-store.ts`, new `src/thread/store/sqlite-thread-store.ts` |
| SQLite migrations | new `src/thread/store/migrations/*.sql` |
| Migration smoke | new `src/thread/migration/sqlite-thread-migration-service.ts` smoke path |
| Test helpers | existing `src/context-steward/test/*`, `src/thread-view/test/*`, plus SQLite helper additions |
| Foundation tests | `sqlite-thread-store.test.ts`, `sqlite-thread-store-compat.test.ts`, `sqlite-fixtures.test.ts`, `sqlite-thread-migration-smoke.test.ts` |

#### Design References

- [tech-design.md §Store And Module Architecture](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:215), lines 215-285
- [tech-design.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:286), lines 286-400
- [tech-design.md §SQLite Data Model](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:401), lines 401-477
- [tech-design.md §Fixture contracts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:524), lines 524-532
- [tech-design.md §Dependency Decision](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:676), lines 676-706
- [test-plan.md §Chunk 0](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:217), lines 217-232
- [coverage.md §Story 00](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md:97), lines 97-103

#### Test Mapping

| Criterion | Test File / Check | Test Description |
|----|-------------------|------------------|
| FC-0.1 | `sqlite-thread-store.test.ts` | DB open/create/migrate/reopen lifecycle works from disk |
| FC-0.2 | `sqlite-fixtures.test.ts`, shared helper conformance smoke | test-store helpers can request file or SQLite backing explicitly |
| FC-0.3 | `sqlite-thread-store-compat.test.ts` | simple compatibility calls use the existing `ThreadStore` result/error shape |
| FC-0.4 | `sqlite-thread-migration-smoke.test.ts` | minimal legacy fixture creates a SQLite DB and reports core imported state |

#### Architecture-Risk Tests

| Risk | Test File / Check | Test Description | Why AC/TC Mapping Alone Would Miss It |
|------|-------------------|------------------|---------------------------------------|
| Persistence / Restart | `sqlite-thread-store.test.ts` | Reopen a fresh store instance and verify persisted state survives process-like reopen | Foundation criteria do not prove durable on-disk behavior unless reopened |
| Fixture Validity | `sqlite-fixtures.test.ts` | Valid builders create realistic lifecycle/token/projection states; invalid builders are explicit | Bad fixtures would make later story tests trustworthy-looking but wrong |
| Whole-array Compatibility Smoke | `sqlite-thread-store-compat.test.ts` | `writeTurns`/`writeChunks` simple compatibility calls work before full Story 2 validation | Later cutover depends on compatibility seams existing early |

#### Technical Notes

- `SqliteThreadStore` keeps the Promise-based `ThreadStore` shape even though `better-sqlite3` is synchronous internally.
- Provider/model calls are not part of this story.
- The internal migrator should be small and explicit; no ORM is introduced in this slice.

#### Anti-Shim Requirements

- Do not use in-memory SQLite for persistence/reopen tests.
- Do not satisfy helpers with private test-only APIs that production stores cannot use.
- Do not mark full migration/entity ACs complete from the smoke fixture.

#### Production Path Proof

- Entrypoint: None for runtime behavior in this story.
- Registration/default path: No runtime default changes are allowed.
- Evidence: Tests prove foundation helpers and store lifecycle only; production-path proof begins in Story 2.

#### Verification

- Targeted: `npm run typecheck` plus Chunk 0 targeted tests when added
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all` with sufficient timeout when runtime/E2E coverage is involved

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] SQLite dependency and internal migrator are added.
- [ ] `thread.sqlite` open/create/reopen works in temp directories.
- [ ] SQLite-aware test helpers exist.
- [ ] Compatibility method smoke tests pass.
- [ ] Migration smoke test passes.
- [ ] No production runtime path has been cut over yet.
- [ ] `npm run verify` passes or any known-red issue is explicitly tracked.
