# Story 2: Whole-Store Runtime Compatibility Cutover

### Summary
<!-- Jira: Summary field -->

Switch the shared runtime store factory to SQLite while preserving the existing `ThreadStore` compatibility API across capture, maintenance, commands, compact, and smoke inspection paths.

### Description
<!-- Jira: Description field -->

**User Profile:** Long Horizon operator / tech lead maintaining managed PI sessions.

**Objective:** Make SQLite the active runtime store without requiring all callers to adopt row-level APIs in the same story.

**Scope In:**

- Shared `createStore` returns `SqliteThreadStore` for active managed threads.
- `SqliteThreadStore` implements the full existing `ThreadStore` interface.
- Compatibility methods such as `writeTurns` and `writeChunks` accept current whole-array callers.
- New thread creation, capture, reopen, and attach/import are tested through SQLite.
- Smoke checks confirm legacy JSON files are not used as competing source truth during the compatibility cutover.
- Smoke checks prove background maintenance, smart compact, inspection, and snapshot surfaces do not crash against SQLite-backed state.

**Scope Out:**

- Migrating high-contention maintenance callers to row-level methods.
- Replacing compact split reads with `readCompactSnapshot`.
- Full `lhx` SQLite inspection feature work.
- Retiring compatibility methods.

**Dependencies:**

- Story 0 SQLite foundation.
- Story 1 full migration/entity coverage.
- `tech-design.md` Sections 5, 6, 8, 9, 13, and 14.
- `test-plan.md` Chunk 2.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-3.1:** Runtime capture appends canonical messages transactionally.

- **TC-3.1a:** Given a finalized PI prompt, response, tool result, or runtime note, when capture writes it, then message, parts, actor reference, source order, and source revision update together.
- **TC-3.1b:** Given duplicate finalized runtime activity, when capture receives it again, then canonical state remains idempotent and does not duplicate source messages.
- **TC-3.1c:** Given PI starts in a project with no existing managed thread for the active session, when the first managed capture occurs, then a SQLite-backed thread, session linkage, required actors, and first canonical message are created transactionally.

**AC-3.2:** Turn lifecycle updates remain consistent with captured messages.

- **TC-3.2a:** Given captured messages that open or close a prompt-bounded turn, when turn lifecycle state updates, then turn membership and source message references remain consistent.
- **TC-3.2b:** Given capture succeeds but derived turn update cannot complete, when inspected, then canonical messages remain present and turn repair-needed state is visible.

**AC-3.3:** Canonical source writes are not blocked by stale derived maintenance writes.

- **TC-3.3a:** Given background maintenance is repairing token counts or artifacts, when new source activity is captured, then canonical source capture succeeds or fails independently with an explicit source-write error.
- **TC-3.3b:** Given derived maintenance detects a conflict with newer source state, when it retries or yields, then it does not roll back or corrupt canonical source messages.

**AC-3.4:** Capture failures are explicit and recoverable.

- **TC-3.4a:** Given a failed canonical write, when capture reports the failure, then the error identifies the operation, thread, affected source event if available, and whether retry/import/repair is required.
- **TC-3.4b:** Given a transient store conflict or busy state, when capture retries according to policy, then success or final failure is observable.

**AC-3.5:** Restart/reopen preserves active managed state.

- **TC-3.5a:** Given a PI session is restarted after SQLite-backed capture has written state, when Long Horizon opens the thread, then canonical messages, turns, status, and projection linkage are restored from SQLite-managed state.
- **TC-3.5b:** Given capture wrote canonical messages but turn lifecycle update did not complete before restart, when Long Horizon reopens the thread, then canonical messages remain present and affected turn state is marked repair-needed or reconstructed according to repair policy.
- **TC-3.5c:** Given PI appended to the generated rollout after the last compact, when Long Horizon restarts, then managed canonical state and generated rollout linkage are reconciled without treating older projection metadata as current canonical truth.
- **TC-3.5d:** Given a crash occurs during async maintenance, when Long Horizon reopens the thread, then partially completed derived work is either visible as committed state or repair-needed debt; canonical source state remains intact.

**AC-3.6:** Attach/import of unmanaged PI sessions works after SQLite cutover.

- **TC-3.6a:** Given an existing PI session that was not previously managed by Long Horizon, when attach/import runs after SQLite cutover, then imported canonical messages, actors, turns where derivable, target/session linkage, and import status are written to SQLite-backed managed state.
- **TC-3.6b:** Given attach/import encounters unsupported, lossy, duplicate, or partially ordered PI records, when it completes, then the import report identifies affected records and leaves the managed thread in an inspectable ready or repair-needed state.

**SC-2.1:** Background maintenance smoke runs against SQLite-backed state.

- Given the shared store factory returns `SqliteThreadStore`, when bounded background maintenance runs through the existing compatibility API, then it completes or reports structured repair debt without crashing due to store incompatibility.

**SC-2.2:** Smart compact smoke reaches the SQLite-backed store.

- Given the shared store factory returns `SqliteThreadStore`, when a minimal smart compact/readiness smoke runs through existing compatibility reads, then it reaches SQLite-backed state without falling back to legacy JSON as source truth.

**SC-2.3:** Inspection smoke handles SQLite-backed state.

- Given a SQLite-backed managed thread, when the basic inspection smoke runs, then it returns structured output or a structured driver/feature-unavailable issue rather than crashing.

**SC-2.4:** Snapshot/export smoke handles SQLite-backed state.

- Given a SQLite-backed managed thread, when the snapshot/export smoke runs, then it identifies the SQLite backing and does not assume legacy JSON source files are authoritative.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 2 is the big source-authority transition. The real code uses one shared `createStore` factory for capture, maintenance, commands, compact, and related runtime surfaces. Therefore this story switches the shared factory to `SqliteThreadStore` as a whole-store compatibility cutover; it is not a capture-only cutover.

`SqliteThreadStore` must implement the full existing `ThreadStore` interface during this story. The new row-level APIs can exist, but existing consumers continue through compatibility methods until later stories adapt them.

#### Build Strategy

Strategy: full-staged-risk

Reason:
- This story changes the active production store backing for runtime-managed threads.
- Service-level behavior is not enough; production adapter wiring and default factory behavior must be proven.

Risk Reminders:
- Preserve canonical capture before derived turn/maintenance state.
- Keep generated rollout JSONL as projection output, not source truth.
- Smoke maintenance/compact/inspection/snapshot immediately because the shared factory affects all consumers at once.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Shared store factory / runtime adapter | `src/context-steward/pi/pi-extension.ts`, store factory wiring |
| SQLite compatibility store | `src/thread/store/sqlite-thread-store.ts`, `src/thread/store/thread-store.ts` |
| Capture and attach/import services | `src/thread/services/*`, attach/import paths |
| Compatibility methods | `writeTurns`, `writeChunks`, projection metadata, session/thread lookup, fixtures/mutation assertions |
| Tests | `runtime-capture-sqlite.test.ts`, `runtime-reopen-sqlite.test.ts`, `attach-import-sqlite.test.ts`, `sqlite-thread-store-compat.test.ts`, `lhx-sqlite-smoke.test.ts`, `snapshot-sqlite-smoke.test.ts`, `pi-extension-sqlite.e2e.test.ts` |

#### Design References

- [tech-design.md §Compatibility direction](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:245), lines 245-271
- [tech-design.md §Whole-array compatibility strategy](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:272), lines 272-284
- [tech-design.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:286), lines 286-400
- [tech-design.md §Source transactions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:489), lines 489-501
- [tech-design.md §Runtime Flows](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:557), lines 557-599
- [tech-design.md §Existing test-suite migration](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:748), lines 748-759
- [test-plan.md §Runtime capture tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:118), lines 118-136
- [test-plan.md §Chunk 2](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:251), lines 251-266
- [coverage.md §Story 02](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md:111), lines 111-117

#### Test Mapping

| TC / Criterion | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-3.1a, TC-3.1b, TC-3.1c | `runtime-capture-sqlite.test.ts` | finalized activity, duplicate activity, and first managed capture write transactionally to SQLite |
| TC-3.2a, TC-3.2b | `runtime-capture-sqlite.test.ts` | turn lifecycle stays consistent, and turn failure leaves canonical messages plus repair-needed state |
| TC-3.3a, TC-3.3b | `runtime-capture-sqlite.test.ts`, `sqlite-maintenance-row-level.test.ts` | capture succeeds independently while stale derived maintenance yields/retries |
| TC-3.4a, TC-3.4b | `runtime-capture-sqlite.test.ts` | canonical write failures and retryable busy/conflict states are structured and observable |
| TC-3.5a, TC-3.5b, TC-3.5c, TC-3.5d | `runtime-reopen-sqlite.test.ts` | restart/reopen preserves committed state, repair-needed debt, generated rollout reconciliation, and crash-safe maintenance state |
| TC-3.6a, TC-3.6b | `attach-import-sqlite.test.ts` | post-cutover attach/import writes to SQLite and reports lossy/duplicate/partial records |
| SC-2.1 | `lhx-sqlite-smoke.test.ts` or maintenance smoke | background maintenance reaches SQLite compatibility API without crashing |
| SC-2.2 | smart compact smoke | compact/readiness smoke reaches SQLite, not legacy JSON source truth |
| SC-2.3 | `lhx-sqlite-smoke.test.ts` | inspection returns structured output or structured unavailable issue |
| SC-2.4 | `snapshot-sqlite-smoke.test.ts` | snapshot/export smoke recognizes SQLite backing and does not assume legacy JSON source files |

#### Architecture-Risk Tests

| Risk | Test File / Check | Test Description | Why AC/TC Mapping Alone Would Miss It |
|------|-------------------|------------------|---------------------------------------|
| Runtime Adapter Boundary | `pi-extension-sqlite.e2e.test.ts` | real PI extension/default deps capture one turn into SQLite | Service tests cannot prove extension registration/default factory behavior |
| Whole-array Compatibility | `sqlite-thread-store-compat.test.ts` | `writeTurns`/`writeChunks` accept full arrays but diff/update changed rows where practical | Existing callers require compatibility during shared cutover |
| Persistence / Restart | `runtime-reopen-sqlite.test.ts` | fresh store instance restores source, derived, projection, and readiness state | Runtime success before restart is insufficient |
| Atomicity / Rollback | `runtime-capture-sqlite.test.ts` | injected source-write failure rolls back message+parts+source revision together | AC wording does not prove partial failure behavior |
| Smoke surfaces | `lhx-sqlite-smoke.test.ts`, `snapshot-sqlite-smoke.test.ts` | non-primary consumers do not crash immediately after shared factory swap | Story primary ACs are capture, but the factory affects all store consumers |

#### Production Path Proof

- Entrypoint: actual PI extension/runtime store factory path.
- Registration/default deps: prove the default `createStore` path returns/uses `SqliteThreadStore` for active managed threads.
- Runtime/E2E: one targeted PI E2E or equivalent runtime smoke must prove handler registration and real capture path, not only service helpers.

#### Transition-State Risk

Story 1 may create a migrated SQLite DB while runtime capture still writes to the file-backed store. Until Story 2 ships, that SQLite DB is an import/read artifact, not the active source truth. If PI captures new messages between migration and cutover, those writes still belong to the file-backed source and must be re-imported or the cutover must explicitly report that the SQLite copy is stale.

Story 2 must make the active source-of-truth backing explicit at cutover time. It should not silently attach a runtime to an older migrated SQLite DB when newer file-backed source activity exists.

#### Cross-Story Contract Changes

This story permanently changes the default runtime store contract: the shared `createStore` path returns `SqliteThreadStore` for active managed threads after cutover. Stories 3-6 assume that default and should not reintroduce file-backed active writes except through an explicit legacy/import/export adapter or an intentional revert.

The compatibility API remains during this story so existing callers still work, but the source-authority contract changes here: active managed source state is SQLite-backed after the cutover.

#### Existing Test Classification

Before closing this story, classify current store/service tests:

1. production-path/store-conformance tests running against SQLite;
2. intentional legacy file-store regression tests;
3. store-agnostic service tests behind a factory/matrix.

Current Story 2 evidence after the SQLite cutover pass:

| Evidence need | Current proof |
|---|---|
| TC-3.3a canonical capture is independent from derived repair work | `tests/context-steward/runtime-capture-sqlite.test.ts` now blocks SQLite token-count repair for one closed turn, captures a second prompt while repair is in flight, and asserts the new canonical message persists before repair resumes. |
| TC-3.3b stale derived write does not corrupt canonical source | `tests/thread/sqlite-thread-store-compat.test.ts` now retries a stale `writeTurns` whole-array compatibility write after a newer canonical message append and asserts `STALE_SOURCE_REVISION` plus intact source messages. |
| TC-3.4a / TC-3.4b failure and retry observability | `tests/context-steward/runtime-capture-sqlite.test.ts` now injects a transient `SQLITE_STORE_UNAVAILABLE` append failure, asserts the surfaced `CAPTURE_APPEND_FAILED` metadata, then retries the same finalized event and confirms one persisted canonical message. |
| TC-3.5c generated-rollout reopen reconciliation | `tests/context-steward/runtime-reopen-sqlite.test.ts` now records generated rollout linkage, captures post-compact live activity through the generated session target, reopens SQLite, and asserts the canonical thread target remains authoritative while generated linkage still resolves. |
| TC-3.6b lossy/partial/duplicate import reporting | `tests/context-steward/attach-import-sqlite.test.ts` combines duplicate-target conflict proof with a partial import case that leaves only the affected imported turn `repair_needed` and records `UNMAPPED_PART_TYPE` source ranges in the SQLite import report. |

Current test classification evidence:

| Classification | Representative files | Why they belong there |
|---|---|---|
| Production-path / SQLite store-conformance | `tests/context-steward/runtime-capture-sqlite.test.ts`, `runtime-reopen-sqlite.test.ts`, `attach-import-sqlite.test.ts`, `lhx-sqlite-smoke.test.ts`, `snapshot-sqlite-smoke.test.ts`, `pi-extension-sqlite.e2e.test.ts`, `tests/thread/sqlite-thread-store-compat.test.ts`, `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts` | These tests run the active managed-thread path through `SqliteThreadStore`, the default PI extension/runtime wiring, or the SQLite compatibility API that production still uses in Story 2. |
| Intentional legacy file-store regression | `tests/context-steward/thread-store.test.ts`, `file-thread-store.integration.test.ts`, `capture-service.test.ts`, `import-service.test.ts`, `turn-service.test.ts`, `repair-service.test.ts`, `fixture-service.test.ts` | These suites still instantiate `FileThreadStore` directly to preserve legacy import/export/fixture and pre-cutover behavior expectations while SQLite production-path confidence comes from the dedicated cutover tests above. |
| Store-agnostic factory / matrix | `tests/thread/sqlite-fixtures.test.ts` | This suite explicitly runs helper expectations through `createTestThreadStore({ backing })` and `withTempManagedThreadStore({ backing })`, so it proves the shared fixture/test-store rails rather than one backing only. |

#### Anti-Shim Requirements

- Do not make a separate test-only store factory that production never uses.
- Do not satisfy compatibility by falling back to legacy JSON reads/writes as source truth.
- Do not treat maintenance/compact/inspection smoke as full later-story adaptation.

#### Verification

- Targeted: Chunk 2 test files listed above
- Runtime smoke/E2E: required for adapter/default-dependency proof
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all` with sufficient timeout

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Shared runtime store factory can return `SqliteThreadStore` for active managed threads.
- [ ] Existing compatibility API is implemented sufficiently for capture, maintenance, commands, compact, and smoke inspection paths.
- [ ] Capture/new thread/reopen/attach tests pass against SQLite.
- [ ] Active writes do not continue mutating legacy JSON as competing source truth.
- [ ] Existing tests are classified as production-path, legacy file-store, or store-agnostic.
- [ ] `npm run verify` passes or any known-red issue is explicitly tracked.
