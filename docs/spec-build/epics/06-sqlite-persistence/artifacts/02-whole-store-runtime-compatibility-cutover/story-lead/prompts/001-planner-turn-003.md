# Story Lead Base Prompt

## Role Charter
You are the story lead for `02-whole-store-runtime-compatibility-cutover` on durable story run `02-whole-store-runtime-compatibility-cutover-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 3.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/02-whole-store-runtime-compatibility-cutover.md
Bytes: 15720

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


### Test Plan
### test-plan
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md
Bytes: 30917

# Epic 6 Test Plan: SQLite Persistence

This test plan is the verification companion to `tech-design.md`. It maps every Epic 6 TC to a planned test, defines architecture-risk tests introduced by the SQLite design, and states the mock/storage strategy and verification gates for implementation stories.

The main testing principle is:

> Test through stable service/store/command entry points. Mock provider/network boundaries. Use real temp directories and real SQLite DB files when local persistence, generated files, migration, restart/reopen, or snapshot behavior is the product contract.

## 1. Test Strategy

### 1.1 Existing test-suite posture

The current test suite contains many direct `new FileThreadStore(...)` constructions and helpers that create file-backed temp stores. After production cutover, those tests cannot remain the only service confidence signal because they would keep proving the legacy store while runtime uses SQLite.

Policy:

1. Existing file-store tests remain valuable as **legacy regression tests** for import/export/fixture compatibility.
2. Shared service tests that are meant to prove active production behavior should be moved behind a test-store factory, e.g. `createTestThreadStore({ backing: "file" | "sqlite" })`, or duplicated through a store-conformance matrix where practical.
3. Story 2 must run a meaningful active-store service subset against `SqliteThreadStore`, not only new SQLite-only tests.
4. Later cleanup should label file-backed tests as legacy compatibility where they intentionally remain file-only.

This prevents false confidence where root tests pass against `FileThreadStore` while the active runtime path uses SQLite.

### 1.2 Test layers

| Layer | Purpose | Examples | Count expectation |
|---|---|---|---|
| Service / local integration tests | Primary TDD and behavior coverage through real store/service entry points | migration, SQLite store, capture service, maintenance, compact builder, `lhx` inspectors | Many |
| Pure algorithm tests | Deterministic boundaries and golden cases | band selection tie-breakers, dirty-record ordering, token selection policy | Focused |
| CLI/command tests | Thin command surfaces and structured output | migration command, snapshot/export command, `lhx inspect` | Moderate |
| PI E2E / runtime smoke | Proves actual PI adapter wiring and generated rollout behavior | capture one turn into SQLite; smart compact reloads generated JSONL | Few |

### 1.3 Mock boundary

| Boundary | Mock? | Policy |
|---|---|---|
| SQLite DB | No for persistence tests | Use real temp DB files. SQLite behavior is the feature. For `lhx` packaging tests, driver availability may be simulated to verify graceful optional-driver behavior. |
| Filesystem thread layout | No for migration/snapshot/generated-file tests | Use real temp directories and files. |
| OpenAI/Codex provider calls | Yes | Use deterministic fake token counters and lower-band/smoothing providers. |
| PI runtime | Fake in service tests; real in targeted E2E | Service tests call capture/maintenance services directly. E2E proves adapter registration/wiring. |
| Internal store/maintenance modules | No | Exercise through public service/store/command entry points. Store-conformance tests may run the same behavior through file and SQLite factories when the behavior is meant to be backing-agnostic. |
| Child process launcher | Mock when incidental | Only relevant for launcher/package tests, not core SQLite persistence. |

### 1.4 Fixture and helper contracts

SQLite tests need realistic fixtures that match the current `.context-steward` file layout and the target SQLite schema. The repo already has mature file-backed helpers such as `withTempThreadStore(...)`, record builders, thread-view fixtures, and multi-turn builders. SQLite work should adapt this infrastructure rather than create a parallel ad hoc fixture world.

Fixture/helper rules:

- Add `withTempSqliteThreadStore(...)` or a generic `withTempThreadStore({ backing })` helper in the existing test helper area.
- Add `createTestThreadStore({ backing: "file" | "sqlite" })` for shared service tests that should run against the active production store.
- Keep existing file-backed helpers for legacy import/export fixtures, but label tests that intentionally exercise legacy file behavior.
- Default fixture builders produce valid managed threads for both file-backed import and SQLite direct seeding.
- Invalid states use explicit names, e.g. `makeThreadWithMissingTurnMembership()` or `makeLegacyPlaceholderChunk()`.
- File-backed migration fixtures include `thread.json`, `actors.json`, `messages.jsonl`, `turns.json`, `chunks.json`, `imports.json`, `projections.json`, and generated rollout files where relevant.
- Runtime-shaped fixtures for PI events must match installed PI event shapes, not invented simplified objects.
- Token metadata fixtures distinguish exact/provider counts from heuristic counts.

## 2. Verification Gates

Actual repo commands should be used by stories.

| Gate concept | Project command | Notes |
|---|---|---|
| Red-exit quality gate | `npm run typecheck` plus targeted non-behavior checks where available | Behavior tests are expected to fail during Red; existing tests must still pass. |
| Standard service gate | `npm run verify` | Service suite. Do not close implementation beads while this is red unless a known-red blocker is explicitly tracked. |
| E2E gate | `npm run test:e2e` | Use only for runtime/wiring or regression surfaces that require PI behavior. |
| Deep gate | `npm run verify-all` | Service + E2E. Use sufficient timeout, currently 600s recommended for long-thread E2E. |
| Package-local gate | package-specific `typecheck`, `test`, `build` | Applies to `packages/lh-context` when touched. Root gate still matters before close. |

## 3. TC → Test Mapping

Status is `Planned` because this is the design-stage plan. A single test may cover multiple TCs when the observable behavior naturally proves the group.

### 3.1 Entity coverage tests

| TC | Test File | Test Description | Status |
|---|---|---|---|
| TC-1.1a | `sqlite-thread-migration.test.ts` | imports thread identity, project/root, source revision, timestamps, target/session linkage, and status summary | Planned |
| TC-1.1b | `sqlite-thread-store.test.ts` | source revision changes and projection metadata revisions remain distinguishable after writes | Planned |
| TC-1.1c | `sqlite-thread-migration.test.ts` | migrates PI session → managed thread lookup so reopen does not depend only on loose JSON map | Planned |
| TC-1.2a | `sqlite-thread-migration.test.ts` | imports actor identity/type/source mapping without merging compatible records incorrectly | Planned |
| TC-1.2b | `runtime-capture-sqlite.test.ts` | runtime capture reuses/deploys stable actors for new activity | Planned |
| TC-1.2c | `sqlite-thread-migration.test.ts` | duplicate/conflicting actor slugs or types produce migration warnings/conflict policy results | Planned |
| TC-1.3a | `sqlite-thread-migration.test.ts` | imports canonical messages and ordered parts preserving order, source revision, actor, kind, timestamp, and part order | Planned |
| TC-1.3b | `sqlite-thread-migration.test.ts` | imports large tool results fully and confirms prompt-visible projection truncation does not alter canonical content | Planned |
| TC-1.4a | `sqlite-thread-migration.test.ts` | imports open/closed turns with index, lifecycle, message span, prompt boundary, repair state, and token metadata | Planned |
| TC-1.4b | `sqlite-thread-migration.test.ts` | inconsistent turn membership imports as repair-needed issue rather than silent correction | Planned |
| TC-1.5a | `sqlite-derived-artifacts.test.ts` | imports/regenerates smooth artifacts with content, provenance, source revision/input refs, token metadata, stale state, provider metadata | Planned |
| TC-1.5b | `sqlite-derived-artifacts.test.ts` | canonical source change marks dependent smooth artifact stale/repair-needed | Planned |
| TC-1.6a | `sqlite-derived-artifacts.test.ts` | imports chunk ID/range/lifecycle/membership/smooth text/token metadata/readiness | Planned |
| TC-1.6b | `sqlite-maintenance-row-level.test.ts` | affected chunk readiness updates without rewriting unrelated source records | Planned |
| TC-1.7a | `sqlite-derived-artifacts.test.ts` | imports detailed/brief lower-band artifacts with text, band, source chunk, provider/model, prompt version, token metadata, stale/failure state | Planned |
| TC-1.7b | `sqlite-derived-artifacts.test.ts` | legacy placeholder or missing provenance is classified according to readiness and eligible for regeneration | Planned |
| TC-1.8a | `sqlite-token-counts.test.ts` | imports/writes exact and heuristic token counts with source/trust/provider/model/encoding metadata | Planned |
| TC-1.8b | `sqlite-token-counts.test.ts` | missing/heuristic/stale/failed counts surface tokenCounting repair-needed/blocker status | Planned |
| TC-1.9a | `sqlite-projection-metadata.test.ts` | imports/writes generated file path, projection ID, source revision, band layout, generated token count, status, timestamps | Planned |
| TC-1.9b | `sqlite-projection-metadata.test.ts` | missing generated rollout file leaves metadata readable and reports warning/blocker per policy | Planned |
| TC-1.10a | `sqlite-readiness-issues.test.ts` | imports/writes repair/degraded/warning/blocker issues with code, scope, entity, severity, message, status, metadata | Planned |
| TC-1.10b | `sqlite-readiness-issues.test.ts` | resolving repair debt removes active blocker while preserving audit information | Planned |

### 3.2 Migration tests

| TC | Test File | Test Description | Status |
|---|---|---|---|
| TC-2.1a | `sqlite-thread-migration.test.ts` | canonical message/part counts match legacy files unless report identifies rejected records | Planned |
| TC-2.1b | `sqlite-thread-migration.test.ts` | full canonical tool-result content remains available after migration | Planned |
| TC-2.1c | `sqlite-thread-migration.test.ts` | repository-level index/threadId-map/session lookup state is migrated or replaced by explicit managed lookup and remaining file index is non-authoritative | Planned |
| TC-2.2a | `sqlite-thread-migration.test.ts` | valid turns/chunks/smooth/lower-band/token metadata are imported with provenance/readiness metadata | Planned |
| TC-2.2b | `sqlite-thread-migration.test.ts` | missing/stale/legacy/invalid derived state is reported skipped/downgraded/stale/repair-needed | Planned |
| TC-2.3a | `sqlite-thread-migration.test.ts` | projection metadata and rollout paths are imported/preserved/remapped | Planned |
| TC-2.3b | `sqlite-thread-migration.test.ts` | generated JSONL disagreement does not override canonical managed state and is reported if it affects projection validity | Planned |
| TC-2.4a | `sqlite-thread-migration.test.ts` | repeat migration does not duplicate messages, turns, chunks, artifacts, or token rows | Planned |
| TC-2.4b | `sqlite-thread-migration.test.ts` | interrupted migration retries safely and reports partial state handling | Planned |
| TC-2.5a | `sqlite-thread-migration.test.ts` | migration report includes source thread ID, DB path, counts, skipped counts, warnings, blockers, rollout linkage, readiness summary | Planned |
| TC-2.5b | `sqlite-thread-migration.test.ts` | migration warnings/blockers include affected entity IDs or ranges where available | Planned |

### 3.3 Runtime capture, attach, and canonical write tests

| TC | Test File | Test Description | Status |
|---|---|---|---|
| TC-3.1a | `runtime-capture-sqlite.test.ts` | finalized prompt/response/tool/runtime-note writes message, parts, actor ref, source order, source revision atomically | Planned |
| TC-3.1b | `runtime-capture-sqlite.test.ts` | duplicate finalized runtime activity is idempotent | Planned |
| TC-3.1c | `runtime-capture-sqlite.test.ts` | first managed capture creates SQLite thread, session linkage, required actors, and first message transactionally | Planned |
| TC-3.2a | `runtime-capture-sqlite.test.ts` | captured messages open/close prompt-bounded turns with consistent membership/source refs | Planned |
| TC-3.2b | `runtime-capture-sqlite.test.ts` | capture succeeds but derived turn update failure leaves canonical message and visible turn repair-needed debt | Planned |
| TC-3.3a | `runtime-capture-sqlite.test.ts` | canonical capture succeeds independently while background maintenance is repairing token/artifact rows | Planned |
| TC-3.3b | `sqlite-maintenance-row-level.test.ts` | derived maintenance detecting newer source yields/retries without rolling back canonical messages | Planned |
| TC-3.4a | `runtime-capture-sqlite.test.ts` | failed canonical write reports operation/thread/source event/retry guidance | Planned |
| TC-3.4b | `runtime-capture-sqlite.test.ts` | transient busy/conflict retries according to policy and final result is observable | Planned |
| TC-3.5a | `runtime-reopen-sqlite.test.ts` | restart restores messages, turns, status, projection linkage from SQLite | Planned |
| TC-3.5b | `runtime-reopen-sqlite.test.ts` | restart after message commit but incomplete turn update preserves message and marks/reconstructs turn repair-needed | Planned |
| TC-3.5c | `runtime-reopen-sqlite.test.ts` | PI appended to generated rollout after compact is reconciled without treating old projection metadata as current canonical truth | Planned |
| TC-3.5d | `runtime-reopen-sqlite.test.ts` | crash during async maintenance reopens with committed derived state or repair-needed debt; canonical source intact | Planned |
| TC-3.6a | `attach-import-sqlite.test.ts` | post-cutover attach/import writes canonical messages, actors, derivable turns, target linkage, import status to SQLite | Planned |
| TC-3.6b | `attach-import-sqlite.test.ts` | unsupported/lossy/duplicate/partially ordered PI records produce import report and inspectable ready/repair-needed state | Planned |

### 3.4 Async maintenance and repair tests

| TC | Test File | Test Description | Status |
|---|---|---|---|
| TC-4.1a | `sqlite-maintenance-row-level.test.ts` | background maintenance repairs only configured bounded affected turns/chunks and leaves remaining debt visible | Planned |
| TC-4.1b | `sqlite-maintenance-row-level.test.ts` | no-op background maintenance exits without unnecessary readiness/projection metadata changes | Planned |
| TC-4.2a | `sqlite-manual-repair.test.ts` | manual repair performs full catch-up for eligible dirty turns/chunks/artifacts/token metadata | Planned |
| TC-4.2b | `sqlite-manual-repair.test.ts` | provider/token-counter failures persist/report failures without generating/reloading rollout unless explicitly requested | Planned |
| TC-4.3a | `sqlite-maintenance-row-level.test.ts` | token repair for one turn commits without rewriting unrelated turns | Planned |
| TC-4.3b | `sqlite-maintenance-row-level.test.ts` | transient store contention causes derived repair retry/defer with visible debt for next pass | Planned |
| TC-4.4a | `sqlite-token-counts.test.ts` | exact provider-backed count writes value/source/trust/provider/model/encoding/entity metadata | Planned |
| TC-4.4b | `sqlite-token-counts.test.ts` | partial exact token repair leaves tokenCounting repair-needed for unresolved records | Planned |
| TC-4.5a | `sqlite-maintenance-row-level.test.ts` | smooth artifact change invalidates dependent chunk/lower-band artifacts without serving them ready | Planned |
| TC-4.5b | `sqlite-maintenance-row-level.test.ts` | chunk membership/change invalidates dependent detailed/brief/token rows | Planned |
| TC-4.6a | `sqlite-maintenance-reporting.test.ts` | thread-level last maintenance status reports fixed/skipped/failed counts, remaining debt, blockers | Planned |
| TC-4.6b | `sqlite-maintenance-reporting.test.ts` | per-entity debt lists affected turns/chunks/artifacts/token records where available | Planned |
| TC-4.6c | `sqlite-maintenance-reporting.test.ts` | status distinguishes bounded background maintenance from manual/full repair results | Planned |

### 3.5 Smart compact and rollout regeneration tests

| TC | Test File | Test Description | Status |
|---|---|---|---|
| TC-5.1a | `smart-compact-sqlite.test.ts` | strict compact reads ready SQLite state and writes generated PI JSONL with projection metadata/current binding | Planned |
| TC-5.1b | `smart-compact-sqlite.test.ts` | compact reads from SQLite snapshot, not stale legacy JSON or previous generated rollout | Planned |
| TC-5.2a | `smart-compact-sqlite.test.ts` | strict compact blocks/reports when required artifacts/token counts are missing/stale/heuristic | Planned |
| TC-5.2b | `smart-compact-sqlite.test.ts` | strict compact does not silently run full repair unless prepare/manual mode requested | Planned |
| TC-5.3a | `smart-compact-prepare-sqlite.test.ts` | prepare mode performs full catch-up then compacts when debt is repairable | Planned |
| TC-5.3b | `smart-compact-prepare-sqlite.test.ts` | prepare mode persists unrepaired blockers and avoids generating/reloading invalid rollout | Planned |
| TC-5.4a | `rollout-regeneration-sqlite.test.ts` | missing/deleted generated rollout is regenerated from SQLite state | Planned |
| TC-5.4b | `rollout-regeneration-sqlite.test.ts` | regenerated rollout receives new projection metadata/current binding and old invalid path is not source truth | Planned |
| TC-5.5a | `smart-compact-sqlite.test.ts` | prompt-visible tool-result truncation applies to generated rollout while canonical full content remains in SQLite | Planned |
| TC-5.5b | `smart-compact-sqlite.test.ts` | generated exact token count records final serialized/truncated output, separate from source artifact rollups | Planned |

### 3.6 Inspection, reporting, and readiness tests

| TC | Test File | Test Description | Status |
|---|---|---|---|
| TC-6.1a | `lhx-sqlite-inspection.test.ts` | summary/tokens/bands/report read SQLite-backed state and remain comparable to file-backed output | Planned |
| TC-6.2a | `lhx-sqlite-inspection.test.ts` | readiness reports tokenCounting/artifact/projection blockers from SQLite issue/debt rows | Planned |
| TC-6.2b | `lhx-sqlite-inspection.test.ts` | resolved debt disappears from active readiness while audit remains queryable | Planned |
| TC-6.3a | `lhx-sqlite-inspection.test.ts` | missing generated rollout path is surfaced as warning/blocker per policy without crashing | Planned |
| TC-6.4a | `lhx-sqlite-inspection.test.ts` | report distinguishes canonical counts, derived artifact rollups, projection metadata, and generated exact output counts | Planned |
| TC-6.5a | `lhx-sqlite-inspection.test.ts` | JSON output is stable/serializable and human output remains concise for agent use | Planned |

### 3.7 Snapshot, export, and compatibility tests

| TC | Test File | Test Description | Status |
|---|---|---|---|
| TC-7.1a | `snapshot-export-sqlite.test.ts` | snapshot includes `thread.sqlite`, selected/current generated JSONL, and manifest with counts/status | Planned |
| TC-7.2a | `snapshot-export-sqlite.test.ts` | restored/imported snapshot preserves canonical and derived state | Planned |
| TC-7.2b | `snapshot-export-sqlite.test.ts` | snapshot with missing/generated rollout reports recoverable missing projection state | Planned |
| TC-7.3a | `legacy-export-sqlite.test.ts` | explicit legacy JSON export produces debug/importable files labeled non-authoritative | Planned |
| TC-7.4a | `legacy-compat-sqlite.test.ts` | legacy file-store fixtures/import workflows remain usable during transition | Planned |
| TC-7.5a | `legacy-compat-sqlite.test.ts` | active runtime refuses or avoids split-brain writes to both legacy JSON and SQLite source truth | Planned |

## 4. Non-TC Architecture-Risk Tests

| Risk | Test File | Test Description | Why AC/TC Mapping Alone Would Miss It |
|---|---|---|---|
| Persistence / Restart | `runtime-reopen-sqlite.test.ts` | open fresh store instance after writes and verify messages, artifacts, projection metadata, readiness | ACs mention reopen but not fresh-process DB behavior across all state families |
| Concurrency / Lost Update | `sqlite-maintenance-row-level.test.ts` | simulate read → async provider yield → capture/source write → stale derived commit attempt; derived repair must revalidate source revision/input hash and not clobber newer state | ACs describe outcomes, not the real Node interleaving where async provider work yields between sync SQLite reads/writes |
| Atomicity / Rollback | `runtime-capture-sqlite.test.ts` | injected failure rolls back message+parts+source revision together | ACs say transactionally but not partial failure shape |
| Atomicity / Rollback | `smart-compact-sqlite.test.ts` | generated file temp write succeeds but metadata update fails; recovery does not mark rollout current | User sees final compact, not intermediate file/metadata split |
| Fixture Validity | `sqlite-fixtures.test.ts` | fixture builders create valid lifecycle/token/projection states; invalid builders are explicit | Bad fixtures can make every later test trustworthy-looking but wrong |
| Migration / Compatibility | `legacy-compat-sqlite.test.ts` | old file-backed import path delegates to migration service and does not create active JSON source writes | Epic says compatibility, not allowed import direction |
| Source vs Projection Truth | `rollout-regeneration-sqlite.test.ts` | generated rollout disagreement never overwrites canonical SQLite messages | Epic names source truth but not this regression vector |
| Runtime Adapter Boundary | `pi-extension-sqlite.e2e.test.ts` | real PI extension registers handlers and captures one turn into SQLite with packaged/default deps | Service tests cannot prove real extension registration/defaults |
| Idempotency / Retry | `sqlite-thread-migration.test.ts` | migration interrupted after some inserts can be rerun without duplicates | Normal migration success does not prove crash/retry behavior |
| Threshold / Budget | `smart-compact-sqlite.test.ts` | strict compact golden cases for lower bound, oversized item, stale artifact, and band tie ordering | ACs say strict/prepare behavior but exact boundaries must be deterministic |
| Derived-State Provenance | `sqlite-derived-artifacts.test.ts` | source revision/settings hash mismatch marks artifact stale and blocks strict compact | ACs require provenance but not exact invalidation mechanics |
| Busy/Retry Policy | `sqlite-thread-store.test.ts` | retryable SQLite busy/locked errors surface structured retry/final failure behavior across the async `ThreadStore` interface even though `better-sqlite3` operations are synchronous internally | SQLite-specific runtime hazard not visible in functional ACs |
| Whole-array Compatibility | `sqlite-thread-store-compat.test.ts` | `writeTurns`/`writeChunks` accept full arrays but update only changed rows and preserve unchanged records; unchanged rows keep stable provenance/timestamps where applicable | Existing callers require compatibility during shared factory cutover; ACs do not expose migration strategy |
| Compact Read Consistency | `smart-compact-sqlite.test.ts` | compact uses one SQLite read snapshot for thread/messages/turns/chunks/artifacts or explicitly reports accepted compatibility window | Separate store reads can mix revisions under WAL if not designed |
| Optional SQLite Driver For `lhx` | `lhx-sqlite-inspection.test.ts` | SQLite-backed inspection reports structured driver-unavailable error when optional driver is missing; file-backed inspection still works | Packaging/portability risk is not a functional Epic TC |

## 5. Chunk Test Plan And Counts

Counts are estimates for story publishing. They should be reconciled during story enrichment if tests split or merge.

### Chunk 0: SQLite Store Foundation

**Archetypes:** Local Persistence Foundation, Fixture/Test Foundation, Store Compatibility Foundation.

**Scope:** dependency, schema/migrator, SQLite open/create, DB lifecycle helpers, basic store conformance, test helper adaptation, and a migration smoke path. No full migration suite and no runtime cutover.

**Relevant design sections:** Purpose, Current Architecture, Target System View, Store/Module Architecture, Interface Definitions, SQLite Data Model, Dependency Decision.

| Test File | TC Tests | Architecture-Risk Tests | Total |
|---|---:|---:|---:|
| `sqlite-thread-store.test.ts` | 2 | 2 | 4 |
| `sqlite-thread-store-compat.test.ts` | 0 | 1 | 1 |
| `sqlite-fixtures.test.ts` | 0 | 2 | 2 |
| `sqlite-thread-migration-smoke.test.ts` | 4 | 1 | 5 |
| shared helper conformance smoke | 0 | 1 | 1 |
| **Chunk total** | **6** | **7** | **13** |

### Chunk 1: Full Migration And Entity Coverage

**Archetypes:** Migration Foundation, Entity Coverage Validation, Compatibility Bridge.

**Scope:** complete file-backed thread import, entity preservation, validation report, idempotency, interrupted retry, projection metadata import, derived artifact/token/readiness import. No runtime cutover yet.

**Relevant design sections:** Current Architecture, SQLite Data Model, Migration Design, Fixture Contracts, Error Contracts.

| Test File | TC Tests | Architecture-Risk Tests | Total |
|---|---:|---:|---:|
| `sqlite-thread-migration.test.ts` | 25 | 2 | 27 |
| `sqlite-derived-artifacts.test.ts` | 9 | 1 | 10 |
| `sqlite-token-counts.test.ts` | 4 | 0 | 4 |
| `sqlite-projection-metadata.test.ts` | 2 | 0 | 2 |
| `sqlite-readiness-issues.test.ts` | 2 | 0 | 2 |
| **Chunk total** | **42** | **3** | **45** |

### Chunk 2: Whole-Store Runtime Compatibility Cutover

**Scope:** shared `createStore` returns `SqliteThreadStore` for active managed threads. Capture, maintenance, commands, and compact all operate against SQLite through the existing compatibility API. `writeTurns`/`writeChunks` compatibility methods accept full arrays and internally perform transactional row-diff updates where practical.

**Relevant design sections:** Store/Module Architecture, Whole-array Compatibility Strategy, Transaction Semantics, Runtime Flows, Error Contracts.

| Test File | TC Tests | Architecture-Risk Tests | Total |
|---|---:|---:|---:|
| `runtime-capture-sqlite.test.ts` | 10 | 1 | 11 |
| `runtime-reopen-sqlite.test.ts` | 4 | 1 | 5 |
| `attach-import-sqlite.test.ts` | 2 | 0 | 2 |
| `sqlite-thread-store-compat.test.ts` | 0 | 1 | 1 |
| `lhx-sqlite-smoke.test.ts` | 0 | 1 | 1 |
| `snapshot-sqlite-smoke.test.ts` | 0 | 1 | 1 |
| `pi-extension-sqlite.e2e.test.ts` | 0 | 1 | 1 |
| **Chunk total** | **16** | **6** | **22** |

### Chunk 3: Derived Maintenance Row-Level Adaptation

**Scope:** bounded background maintenance, full manual repair/prepare support, token/artifact/chunk row updates, visible debt/status. High-contention services stop relying on compatibility whole-array writes where targeted row methods exist.

**Relevant design sections:** SQLite Data Model, Transaction Semantics, Runtime Flows, Derived-State Provenance, Mutation Semantics.

| Test File | TC Tests | Architecture-Risk Tests | Total |
|---|---:|---:|---:|
| `sqlite-maintenance-row-level.test.ts` | 8 | 2 | 10 |
| `sqlite-manual-repair.test.ts` | 2 | 0 | 2 |
| `sqlite-token-counts.test.ts` | 2 | 0 | 2 |
| `sqlite-maintenance-reporting.test.ts` | 3 | 0 | 3 |
| **Chunk total** | **15** | **2** | **17** |

### Chunk 4: Smart Compact Snapshot And Rollout Regeneration Hardening

**Scope:** strict/prepare compact from a consistent SQLite compact snapshot, generated JSONL writing, prompt-visible truncation, exact generated output count, rollout regeneration.

**Relevant design sections:** Current smart compact path, Target System View, Projection Tables, Projection Read/Write Transaction, Runtime Flow 9.6.

| Test File | TC Tests | Architecture-Risk Tests | Total |
|---|---:|---:|---:|
| `smart-compact-sqlite.test.ts` | 7 | 3 | 10 |
| `smart-compact-prepare-sqlite.test.ts` | 2 | 0 | 2 |
| `rollout-regeneration-sqlite.test.ts` | 2 | 1 | 3 |
| **Chunk total** | **11** | **4** | **15** |

### Chunk 5: Inspection, Reporting, Snapshot, And Export

**Scope:** `lhx` SQLite-backed query support, readiness/report output, snapshot/export/legacy debug export.

**Relevant design sections:** Inspection, Snapshot, Export; Error Contracts; Test Strategy.

| Test File | TC Tests | Architecture-Risk Tests | Total |
|---|---:|---:|---:|
| `lhx-sqlite-inspection.test.ts` | 6 | 1 | 7 |
| `snapshot-export-sqlite.test.ts` | 3 | 0 | 3 |
| `legacy-export-sqlite.test.ts` | 1 | 0 | 1 |
| `legacy-compat-sqlite.test.ts` | 2 | 1 | 3 |
| **Chunk total** | **12** | **2** | **14** |

### Chunk 6: Legacy File-Store Retirement And Compatibility Cleanup
**Scope:** quarantine active JSON writes, remove direct JSON assumptions from runtime/compact/inspection paths, preserve explicit import/export/fixture support.

**Relevant design sections:** Compatibility Direction, Migration Design, Inspection/Snapshot/Export, Work Breakdown.

| Test File | TC Tests | Architecture-Risk Tests | Total |
|---|---:|---:|---:|
| `legacy-compat-sqlite.test.ts` | 0 | 1 additional smoke if needed | 1 |
| root smoke/grep guard | 0 | 1 | 1 |
| **Chunk total** | **0** | **2** | **2** |

### Count reconciliation

| Category | Count |
|---|---:|
| Epic TCs mapped | 83 |
| Estimated TC-behavior tests | 102 planned TC-level behavior checks across chunk files; after deduplicating repeated coverage across chunks, 83 unique Epic TCs are covered |
| Architecture-risk tests | 26 |
| Estimated chunk test total | 128 |

The estimated total is intentionally approximate because story enrichment may combine test files or split cases. The invariant is that all 83 unique TCs remain mapped and each architecture-risk category remains assigned.

## 6. Manual / Smoke Verification

Manual verification is limited and targeted; most confidence comes from service/local integration tests.

- Run migration on a copied dogfood thread; inspect migration report.
- Run `lhx inspect report post-compact --root <temp-root>` against SQLite-backed migrated state.
- Launch PI with SQLite-backed extension in a temp repo and capture one short turn.
- Run smart compact from SQLite-backed state and confirm PI reloads generated JSONL.
- Delete generated rollout and confirm regeneration path works from SQLite.

## 7. Test Plan Self-Review

- Every TC from `epic.md` appears in Section 3.
- Architecture-risk tests cover persistence/restart, concurrency/lost update, atomicity/rollback, fixture validity/helper adaptation, migration/compatibility, source-vs-projection truth, runtime boundary, idempotency/retry, threshold/budget, derived provenance, whole-array compatibility, compact read consistency, optional driver behavior, and busy/retry policy.
- Mock strategy uses real temp SQLite/local filesystem where persistence is product behavior.
- Chunk test counts are estimated and reconciled at the chunk level.
- Actual repo gates are named explicitly.


## Current Run Index
- planner_turn_index: 3
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-verify completed with outcome revise and status ok.
- latest_response_kind: verifier-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/004-verify.json
- older_response_count: 1
- caller_input_artifact_count: 0
- prior_self_note_count: 1
- latest_self_note: "First child operation should establish current implementation state from disk and return concrete evidence before any review or acceptance decision."

## Response Trail
<current_response>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/004-verify.json
bytes: 14114
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "fa36616f-bacb-4cb3-bbb0-a1b90af81920"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e629c-bfd2-7fc0-94f2-5ed10ad97a60"
    continuation:
      provider: "codex"
      sessionId: "019e629c-bfd2-7fc0-94f2-5ed10ad97a60"
      storyId: "02-whole-store-runtime-compatibility-cutover"
    mode: "initial"
    story:
      id: "02-whole-store-runtime-compatibility-cutover"
      title: "Story 2: Whole-Store Runtime Compatibility Cutover"
    artifactsRead:
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/02-whole-store-runtime-compatibility-cutover.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/003-implementor.json"
      - "/Users/leemoore/code/pi-long-horizon/scripts/run-node-tests.mjs"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-extension.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/test/temp-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/services/import-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/store/sqlite-thread-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/thread/migration/sqlite-thread-migration-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/packages/lh-context/src/core/io.ts"
      - "/Users/leemoore/code/pi-long-horizon/packages/lh-context/src/commands/run.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/runtime-capture-sqlite.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/attach-import-sqlite.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/pi-extension-sqlite.e2e.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/pi-extension-commands.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/e2e-cli.e2e.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/capture-service.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/import-service.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/repair-service.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/turn-service.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/thread-store.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/thread/sqlite-thread-store-compat.test.ts"
    reviewScopeSummary: "Verified Story 2 against the story/test-plan expectations by reading the spec set and implementor artifact, inspecting the SQLite cutover runtime/store/inspection paths and changed tests, reproducing focused production-path failures for attach/import and `lhx` inspection, and running the configured repo gate (`npm run verify-all`), which passed."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-01"
        severity: "major"
        title: "Attach/import duplicate detection still depends on `index.json`, so a SQLite-backed session can be imported twice"
        evidence: "`attachExistingPiSession` checks `store.findThreadByTarget(...)` before importing (`src/thread/services/import-service.ts:303-318`), but `SqliteThreadStore.findThreadByTarget` and `createThread` both consult only `index.json` (`src/thread/store/sqlite-thread-store.ts:806-841`, `1010-1045`). The migration path only seeds `thread.sqlite` rows and does not repopulate `index.json` (`src/thread/migration/sqlite-thread-migration-service.ts:531-542`). Reproduction: after creating a SQLite-backed managed thread and removing `index.json`, `node --import tsx --eval '...'` returned `{\"attachOk\":true,...,\"threadDirs\":[\"thread-existing\",\"thread_<new>\"]}`, proving attach/import created a second managed thread instead of recognizing the existing SQLite linkage. This contradicts the design rule that SQLite session linkage is authoritative and the JSON index is only a discovery cache (`tech-design.md:44`, `208-210`)."
        affectedFiles:
          - "src/thread/services/import-service.ts"
          - "src/thread/store/sqlite-thread-store.ts"
          - "src/thread/migration/sqlite-thread-migration-service.ts"
        requirementIds:
          - "AC-3.6"
          - "TC-3.6a"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "SV-02"
        severity: "major"
        title: "`lhx inspect` still treats valid SQLite-backed threads as missing"
        evidence: "`packages/lh-context/src/core/io.ts` still resolves Long Horizon state exclusively through `thread.json`, `turns.json`, `chunks.json`, and `messages.jsonl` (`packages/lh-context/src/core/io.ts:39-76`). Against a real root containing only a SQLite-managed thread, running `node --import tsx --eval '... runCli([\"inspect\",\"summary\",\"--root\", root]) ...'` returned `{\"exitCode\":1,\"stdout\":\"\",\"stderr\":\"lhx error (NO_THREADS): No thread.json files found under .../.context-steward/threads\\n\"}`. The CLI wraps the thrown `LhxError` as a generic failure (`packages/lh-context/src/commands/run.ts:11-24`), so the required inspection smoke does not handle SQLite-backed state and does not produce a SQLite-specific unavailable path."
        affectedFiles:
          - "packages/lh-context/src/core/io.ts"
          - "packages/lh-context/src/commands/run.ts"
        requirementIds:
          - "SC-2.3"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "SV-03"
        severity: "major"
        title: "Required SQLite cutover coverage and test classification are still missing for several Chunk 2 behaviors"
        evidence: "The story and test plan call for Chunk 2 coverage including `runtime-reopen-sqlite.test.ts`, `lhx-sqlite-smoke.test.ts`, and `snapshot-sqlite-smoke.test.ts`, plus classification of existing tests into SQLite production-path, legacy regression, or store-agnostic groups (`02-whole-store-runtime-compatibility-cutover.md:179-209`). In the repo, `rg --files` finds only three new SQLite-specific context-steward tests: `tests/context-steward/runtime-capture-sqlite.test.ts`, `attach-import-sqlite.test.ts`, and `pi-extension-sqlite.e2e.test.ts`. Those cover happy-path capture/idempotency/reopen (`runtime-capture-sqlite.test.ts:53-177`), happy-path attach/import (`attach-import-sqlite.test.ts:50-99`), and a minimal status-command smoke (`pi-extension-sqlite.e2e.test.ts:54-121`). Meanwhile the broader capture/import/repair/turn/thread-store suites still instantiate `FileThreadStore` directly, e.g. `tests/context-steward/capture-service.test.ts:240`, `import-service.test.ts:157`, `repair-service.test.ts:55`, `turn-service.test.ts:41`, and `thread-store.test.ts:157`. `npm run verify-all` also only walks `tests/**` (`scripts/run-node-tests.mjs:5-45`), so package-level inspection tests are outside the gate. That leaves required SQLite proof missing for failure/repair/conflict cases and for snapshot/export smoke."
        affectedFiles:
          - "tests/context-steward/runtime-capture-sqlite.test.ts"
          - "tests/context-steward/attach-import-sqlite.test.ts"
          - "tests/context-steward/capture-service.test.ts"
          - "tests/context-steward/import-service.test.ts"
          - "tests/context-steward/repair-service.test.ts"
          - "tests/context-steward/turn-service.test.ts"
          - "tests/context-steward/thread-store.test.ts"
          - "scripts/run-node-tests.mjs"
        requirementIds:
          - "TC-3.1a"
          - "TC-3.1c"
          - "TC-3.2a"
          - "TC-3.2b"
          - "TC-3.3a"
          - "TC-3.3b"
          - "TC-3.4a"
          - "TC-3.4b"
          - "TC-3.5a"
          - "TC-3.5b"
          - "TC-3.5d"
          - "TC-3.6b"
          - "SC-2.4"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    openFindings:
      -
        id: "SV-01"
        severity: "major"
        title: "Attach/import duplicate detection still depends on `index.json`, so a SQLite-backed session can be imported twice"
        evidence: "`attachExistingPiSession` checks `store.findThreadByTarget(...)` before importing (`src/thread/services/import-service.ts:303-318`), but `SqliteThreadStore.findThreadByTarget` and `createThread` both consult only `index.json` (`src/thread/store/sqlite-thread-store.ts:806-841`, `1010-1045`). The migration path only seeds `thread.sqlite` rows and does not repopulate `index.json` (`src/thread/migration/sqlite-thread-migration-service.ts:531-542`). Reproduction: after creating a SQLite-backed managed thread and removing `index.json`, `node --import tsx --eval '...'` returned `{\"attachOk\":true,...,\"threadDirs\":[\"thread-existing\",\"thread_<new>\"]}`, proving attach/import created a second managed thread instead of recognizing the existing SQLite linkage. This contradicts the design rule that SQLite session linkage is authoritative and the JSON index is only a discovery cache (`tech-design.md:44`, `208-210`)."
        affectedFiles:
          - "src/thread/services/import-service.ts"
          - "src/thread/store/sqlite-thread-store.ts"
          - "src/thread/migration/sqlite-thread-migration-service.ts"
        requirementIds:
          - "AC-3.6"
          - "TC-3.6a"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "SV-02"
        severity: "major"
        title: "`lhx inspect` still treats valid SQLite-backed threads as missing"
        evidence: "`packages/lh-context/src/core/io.ts` still resolves Long Horizon state exclusively through `thread.json`, `turns.json`, `chunks.json`, and `messages.jsonl` (`packages/lh-context/src/core/io.ts:39-76`). Against a real root containing only a SQLite-managed thread, running `node --import tsx --eval '... runCli([\"inspect\",\"summary\",\"--root\", root]) ...'` returned `{\"exitCode\":1,\"stdout\":\"\",\"stderr\":\"lhx error (NO_THREADS): No thread.json files found under .../.context-steward/threads\\n\"}`. The CLI wraps the thrown `LhxError` as a generic failure (`packages/lh-context/src/commands/run.ts:11-24`), so the required inspection smoke does not handle SQLite-backed state and does not produce a SQLite-specific unavailable path."
        affectedFiles:
          - "packages/lh-context/src/core/io.ts"
          - "packages/lh-context/src/commands/run.ts"
        requirementIds:
          - "SC-2.3"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "SV-03"
        severity: "major"
        title: "Required SQLite cutover coverage and test classification are still missing for several Chunk 2 behaviors"
        evidence: "The story and test plan call for Chunk 2 coverage including `runtime-reopen-sqlite.test.ts`, `lhx-sqlite-smoke.test.ts`, and `snapshot-sqlite-smoke.test.ts`, plus classification of existing tests into SQLite production-path, legacy regression, or store-agnostic groups (`02-whole-store-runtime-compatibility-cutover.md:179-209`). In the repo, `rg --files` finds only three new SQLite-specific context-steward tests: `tests/context-steward/runtime-capture-sqlite.test.ts`, `attach-import-sqlite.test.ts`, and `pi-extension-sqlite.e2e.test.ts`. Those cover happy-path capture/idempotency/reopen (`runtime-capture-sqlite.test.ts:53-177`), happy-path attach/import (`attach-import-sqlite.test.ts:50-99`), and a minimal status-command smoke (`pi-extension-sqlite.e2e.test.ts:54-121`). Meanwhile the broader capture/import/repair/turn/thread-store suites still instantiate `FileThreadStore` directly, e.g. `tests/context-steward/capture-service.test.ts:240`, `import-service.test.ts:157`, `repair-service.test.ts:55`, `turn-service.test.ts:41`, and `thread-store.test.ts:157`. `npm run verify-all` also only walks `tests/**` (`scripts/run-node-tests.mjs:5-45`), so package-level inspection tests are outside the gate. That leaves required SQLite proof missing for failure/repair/conflict cases and for snapshot/export smoke."
        affectedFiles:
          - "tests/context-steward/runtime-capture-sqlite.test.ts"
          - "tests/context-steward/attach-import-sqlite.test.ts"
          - "tests/context-steward/capture-service.test.ts"
          - "tests/context-steward/import-service.test.ts"
          - "tests/context-steward/repair-service.test.ts"
          - "tests/context-steward/turn-service.test.ts"
          - "tests/context-steward/thread-store.test.ts"
          - "scripts/run-node-tests.mjs"
        requirementIds:
          - "TC-3.1a"
          - "TC-3.1c"
          - "TC-3.2a"
          - "TC-3.2b"
          - "TC-3.3a"
          - "TC-3.3b"
          - "TC-3.4a"
          - "TC-3.4b"
          - "TC-3.5a"
          - "TC-3.5b"
          - "TC-3.5d"
          - "TC-3.6b"
          - "SC-2.4"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    requirementCoverage:
      verified:
        - "TC-3.1b"
        - "TC-3.5c"
        - "TC-3.6a"
        - "SC-2.1"
        - "SC-2.2"
      unverified:
        - "TC-3.1a"
        - "TC-3.1c"
        - "TC-3.2a"
        - "TC-3.2b"
        - "TC-3.3a"
        - "TC-3.3b"
        - "TC-3.4a"
        - "TC-3.4b"
        - "TC-3.5a"
        - "TC-3.5b"
        - "TC-3.5d"
        - "TC-3.6b"
        - "SC-2.3"
        - "SC-2.4"
    gatesRun:
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "`attachExistingPiSession` still relies on `findThreadByTarget`, and the SQLite implementation of that lookup is driven by `index.json` rather than authoritative SQLite linkage; when the JSON cache is missing or stale, attach/import can create a second managed thread for the same PI session."
      - "`lhx` inspection still enumerates `thread.json`/`messages.jsonl` and returns `NO_THREADS` for a valid SQLite-managed thread, so the inspection smoke path has not crossed the runtime cutover boundary."
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
      - "Which concrete snapshot/export surface is intended to satisfy SC-2.4 in Story 2? I did not find a current SQLite smoke or touched production path for that requirement in this repo state."
    additionalObservations:
      - "`npm run verify-all` passed, but that gate only collects tests under `tests/**` (`scripts/run-node-tests.mjs:5-45`), so it does not exercise `packages/lh-context/test/**` and cannot by itself prove the inspection smoke requirement."
      - "The runtime cutover itself is real: `src/context-steward/pi/pi-extension.ts` now defaults the production store factory to `SqliteThreadStore`, and `tests/context-steward/runtime-capture-sqlite.test.ts:87-91` confirmed active managed threads no longer emit legacy `thread.json`/`messages.jsonl`/`turns.json`/`chunks.json` source files."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/004-verify.json"
  startedAt: "2026-05-26T04:48:20.155Z"
  finishedAt: "2026-05-26T04:59:46.516Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/003-implementor.json
bytes: 4841
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "6d76eb93-59ba-428c-9252-d67201ce0064"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e6286-8f94-7f72-b5e1-5f84318d2daa"
    continuation:
      provider: "codex"
      sessionId: "019e6286-8f94-7f72-b5e1-5f84318d2daa"
      storyId: "02-whole-store-runtime-compatibility-cutover"
    outcome: "ready-for-verification"
    story:
      id: "02-whole-store-runtime-compatibility-cutover"
      title: "Story 2: Whole-Store Runtime Compatibility Cutover"
    planSummary: "Cut over the production PI extension store factory to SQLite, made SQLite whole-array compatibility writes preserve existing rows instead of replacing entire tables, and added SQLite-backed runtime/command/E2E coverage including migrated long-thread clone flows."
    changedFiles:
      -
        path: "src/context-steward/pi/pi-extension.ts"
        reason: "Switched the default runtime store factory from FileThreadStore to SqliteThreadStore for the shared PI extension path."
      -
        path: "src/thread/store/sqlite-thread-store.ts"
        reason: "Updated compatibility `writeTurns` and `writeChunks` to diff/update rows transactionally instead of deleting whole tables, preserving stable rows during cutover."
      -
        path: "tests/thread/sqlite-thread-store-compat.test.ts"
        reason: "Added regression coverage proving SQLite compatibility writes preserve existing turn/chunk rows while accepting whole-array callers."
      -
        path: "tests/context-steward/pi-extension-commands.test.ts"
        reason: "Moved default-store command smoke coverage onto SQLite-backed managed threads and default extension wiring."
      -
        path: "tests/context-steward/runtime-capture-sqlite.test.ts"
        reason: "Added SQLite runtime capture coverage for default extension capture, idempotent duplicate suppression, reopen, and no-legacy-source-file assertions."
      -
        path: "tests/context-steward/attach-import-sqlite.test.ts"
        reason: "Added post-cutover attach/import coverage that writes canonical imported session state into SQLite-backed managed threads."
      -
        path: "tests/context-steward/pi-extension-sqlite.e2e.test.ts"
        reason: "Added a focused PI extension runtime smoke proving default handler registration and status commands work against SQLite-backed state."
      -
        path: "tests/context-steward/e2e-cli.e2e.test.ts"
        reason: "Updated CLI E2E expectations and inspections from legacy thread JSON files to SQLite-backed managed state."
      -
        path: "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
        reason: "Updated long-thread real-runtime E2E coverage to import prepared clones into SQLite before execution and inspect the SQLite-backed source of truth."
    tests:
      added:
        - "tests/context-steward/runtime-capture-sqlite.test.ts"
        - "tests/context-steward/attach-import-sqlite.test.ts"
        - "tests/context-steward/pi-extension-sqlite.e2e.test.ts"
      modified:
        - "tests/thread/sqlite-thread-store-compat.test.ts"
        - "tests/context-steward/pi-extension-commands.test.ts"
        - "tests/context-steward/e2e-cli.e2e.test.ts"
        - "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
      removed:
[]
    gatesRun:
      -
        command: "node --import tsx --test tests/thread/sqlite-thread-store-compat.test.ts tests/context-steward/runtime-capture-sqlite.test.ts tests/context-steward/attach-import-sqlite.test.ts tests/context-steward/pi-extension-commands.test.ts tests/context-steward/pi-extension-sqlite.e2e.test.ts"
        result: "pass"
      -
        command: "node --import tsx --test tests/context-steward/e2e-cli.e2e.test.ts tests/context-steward/long-thread-real-pi-execution.e2e.test.ts tests/context-steward/pi-extension-sqlite.e2e.test.ts"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Default production PI runtime/command wiring now uses SqliteThreadStore instead of the legacy file store."
        - "SQLite compatibility whole-array writes now preserve existing rows rather than replacing complete turn/chunk tables."
        - "Legacy file-oriented E2E assertions were updated to verify SQLite-backed managed state, including migrated prepared long-thread fixtures."
      findingsSurfaced:
[]
    openQuestions:
      - "The orchestration baseline seed (`627`) did not line up cleanly with repo-visible file or runner totals, so `tests.totalAfterStory` and `deltaFromPriorBaseline` are reported as `null` rather than guessed."
    specDeviations:
[]
    recommendedNextStep: "Run story verification focused on the SQLite cutover acceptance criteria and migrated-thread reopen/runtime smoke paths."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/003-implementor.json"
  startedAt: "2026-05-26T04:24:06.000Z"
  finishedAt: "2026-05-26T04:48:08.697Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/story-lead/001-current.json
Bytes: 2425

```yaml
storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
storyId: "02-whole-store-runtime-compatibility-cutover"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-verify completed with outcome revise and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/004-verify.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e6286-8f94-7f72-b5e1-5f84318d2daa"
    storyId: "02-whole-store-runtime-compatibility-cutover"
  storyVerifier:
    provider: "codex"
    sessionId: "019e629c-bfd2-7fc0-94f2-5ed10ad97a60"
    storyId: "02-whole-store-runtime-compatibility-cutover"
latestEventSequence: 8
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "Implementation reports ready-for-verification with targeted and full gates passing, but the durable record does not yet contain an independent verifier pass. The smallest safe next action is to verify the implementor artifact against the story-local acceptance criteria, Chunk 2 test plan, runtime factory cutover proof, SQLite compatibility API, and smoke/E2E requirements before any acceptance recommendation."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/004-verify.json"
replayBoundary: null
updatedAt: "2026-05-26T04:59:46.526Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: First child operation should establish current implementation state from disk and return concrete evidence before any review or acceptance decision.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-26T04:24:05.963Z; note="First child operation should establish current implementation state from disk and return concrete evidence before any review or acceptance decision."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/story-lead/001-events.jsonl
Bytes: 3560

```yaml
-
  storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
  sequence: 1
  timestamp: "2026-05-26T04:23:42.774Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
  sequence: 2
  timestamp: "2026-05-26T04:24:05.940Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e6286-364d-78c1-a7bc-fa45d961506c"
-
  storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
  sequence: 3
  timestamp: "2026-05-26T04:24:05.963Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "First child operation should establish current implementation state from disk and return concrete evidence before any review or acceptance decision."
-
  storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
  sequence: 4
  timestamp: "2026-05-26T04:24:05.963Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "First child operation should establish current implementation state from disk and return concrete evidence before any review or acceptance decision."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
  sequence: 5
  timestamp: "2026-05-26T04:48:08.705Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
  sequence: 6
  timestamp: "2026-05-26T04:48:20.092Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e629c-930e-79b2-8f7a-846e13d73be8"
-
  storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
  sequence: 7
  timestamp: "2026-05-26T04:48:20.118Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "02-whole-store-runtime-compatibility-cutover-story-run-001"
  sequence: 8
  timestamp: "2026-05-26T04:59:46.526Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/02-whole-store-runtime-compatibility-cutover/004-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
```

## State Rules
### state-rules
Bytes: 2986

Requirements source for story-local acceptance: the story file and test plan below.
Current lifecycle state: awaiting_story_lead_action

Lifecycle rules:
State: initialized
Public status: running
Allowed actions: none
Meaning: Runtime scaffolding exists, but no planner turn or child operation has started yet.
Caller implication: Treat this as startup bookkeeping only; wait for the first planner transition before routing work.

State: awaiting_story_lead_action
Public status: running
Allowed actions: run-implement, run-continue, run-self-review, run-verify, run-quick-fix, accept-story, request-ruling, block-story, fail-story
Meaning: The durable record is ready and the next fresh story-lead turn may choose one bounded action.
Caller implication: Planner output is the next source of truth; the run is waiting for a valid bounded action selection.

State: running_child_operation
Public status: running
Allowed actions: none
Meaning: The runtime is executing one bounded child operation selected by the story lead.
Caller implication: Poll runtime artifacts instead of rerouting; the current child operation is still in flight.

State: recording_result
Public status: running
Allowed actions: none
Meaning: The child result or terminal decision is being written to durable artifacts before the next transition.
Caller implication: Do not treat the run as advanced until evidence and ledger updates are durably recorded.

State: terminal
Public status: terminal-only
Allowed actions: none
Meaning: A terminal public outcome has been recorded separately from lifecycleState and the story-lead loop will not continue automatically.
Caller implication: Read the public status and final package to decide impl-lead follow-up such as accept, reopen, or ruling.

Terminal outcome rules:
Outcome: accepted
Meaning: Story-lead evidence is complete enough to recommend acceptance for impl-lead review.
Caller implication: Impl-lead still owes receipt completion, verification gates, and the story commit before accepting the story.

Outcome: needs-ruling
Meaning: The run reached a boundary that requires an explicit caller or maintainer decision.
Caller implication: Surface the ruling request instead of guessing or downgrading the decision into cleanup debt.

Outcome: blocked
Meaning: A named blocker prevents safe forward progress with the current inputs or runtime state.
Caller implication: Resolve the blocker or change the plan before resuming; do not pretend the story is ready to continue.

Outcome: failed
Meaning: An unrecoverable runtime or planner failure ended the current story-lead attempt.
Caller implication: Inspect the failure details and durable artifacts before deciding whether to replay or open a new attempt.

Outcome: interrupted
Meaning: The run stopped before a planned transition finished, usually because the caller or runtime interrupted it.
Caller implication: Use status or resume against the durable artifacts to continue from the last safe checkpoint.

## Runtime Settings
### runtime-settings
Bytes: 219

```yaml
storyGate: "npm run verify-all"
epicGate: "npm run verify-all"
plannerTimeoutMs: 600000
wholeRunTimeoutMs: 7200000
providerStartupTimeoutMs: 300000
providerActiveSilenceTimeoutMs: 600000
```

## Action Protocol
Return exactly one JSON object matching `StoryLeadAction`.

Examples:
{"action":"run-implement","rationale":"...","inputs":{"promptAddendum":"optional"},"selfNote":"optional durable reminder"}
{"action":"run-continue","rationale":"...","inputs":{"continuationRef":"storyImplementor","promptAddendum":"..."}}
{"action":"run-self-review","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"focus":"optional","continuationRef":"storyImplementor","passes":1}}
{"action":"run-verify","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"focus":"optional","provider":"codex"}}
{"action":"run-verify","rationale":"...","inputs":{"artifactRefs":["/abs/path.json"],"verifierContinuationRef":"storyVerifier","responseArtifactRef":"/abs/path.json"}}
{"action":"run-quick-fix","rationale":"...","inputs":{"findingRefs":["finding-001"],"remediationGoal":"...","workingDirectory":"optional"}}
{"action":"request-ruling","rationale":"...","inputs":{"decisionType":"...","question":"...","defaultRecommendation":"...","evidence":["..."],"allowedResponses":["..."]}}
{"action":"accept-story","rationale":"...","inputs":{"summary":"...","acceptanceCheckRefs":["..."],"acceptanceChecks":[{"name":"...","status":"pass","evidence":["..."],"reasoning":"..."}],"recommendedImplLeadAction":"accept"},"verification":{"finalVerifierOutcome":"pass","findings":[{"id":"...","status":"fixed","evidence":["..."]}]}}
{"action":"block-story","rationale":"...","inputs":{"reason":"...","detail":"optional","evidence":["..."]},"verification":{"finalVerifierOutcome":"block","findings":[{"id":"...","status":"unresolved","evidence":["..."]}]}}
{"action":"fail-story","rationale":"...","inputs":{"reason":"...","detail":"optional","evidence":["..."]}}

Rules:
- Choose exactly one bounded next action.
- Use only the durable story-run record in this prompt. Do not assume hidden retained planner memory exists.
- Treat `<current_response>` as the latest bounded child response and `<history_responses>` as older response history.
- If the story file and test plan are insufficient for a safe next step, request a ruling instead of asking for epic, tech design, git status, or git diff by default.
- Include `selfNote` only when you want to leave a durable reminder for a later planner turn.

## Acceptance Rubric
Choose the smallest safe bounded action that advances the story using the durable evidence already present.
Prefer continuing from valid child-operation evidence over repeating work, and keep unresolved authority-boundary questions explicit.

## Acceptance Decision Standard
Choose `accept-story` only when the latest verifier result is `pass`, no open findings remain, required proof is present, and the configured story gate passed.
If readiness is promising but gate truth is failed, unavailable, or uncertain, do not accept. Choose the smallest safe next action: verify, quick-fix, block, or request a ruling.

## Ruling Boundaries
Request a ruling when story-local requirements are insufficient, when a blocker needs a caller decision, or when the evidence conflicts in a way that the durable record cannot resolve safely.
