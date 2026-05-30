# Story Lead Base Prompt

## Role Charter
You are the story lead for `05-inspection-reporting-snapshot-export` on durable story run `05-inspection-reporting-snapshot-export-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 4.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/05-inspection-reporting-snapshot-export.md
Bytes: 10670

# Story 5: Inspection, Reporting, Snapshot, And Export

### Summary
<!-- Jira: Summary field -->

Make `lhx` inspection/reporting and snapshot/export workflows read SQLite-backed threads while preserving file-backed portability and generated rollout boundaries.

### Description
<!-- Jira: Description field -->

**User Profile:** Long Horizon operator / tech lead maintaining managed PI sessions.

**Objective:** Preserve operator inspection and portable debugging workflows after SQLite becomes the managed source artifact.

**Scope In:**

- `lhx` reads SQLite-backed summary, tokens, bands, post-compact report, and readiness state.
- File-backed inspection remains available without requiring a SQLite native driver.
- SQLite inspection uses optional/dynamic driver loading and returns `SQLITE_DRIVER_UNAVAILABLE` when needed.
- Snapshot includes `thread.sqlite`, generated rollout JSONL when present, and manifest metadata.
- Export remains inspectable and explicit about canonical/derived/projection ownership.
- Snapshot/export output remains compatible with legacy debugging and fixture review needs.

**Scope Out:**

- Runtime store factory cutover.
- Smart compact generation behavior.
- Retiring active legacy file writes.
- Web workbench or manual curation workflows.

**Dependencies:**

- Story 2 whole-store runtime compatibility cutover.
- Story 4 smart compact/regeneration for generated rollout metadata.
- `tech-design.md` Sections 10, 11, 12, 13, and 14.
- `test-plan.md` Chunk 5.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-6.1:** Summary inspection reports migrated and live SQLite-backed state.

- **TC-6.1a:** Given SQLite-backed managed state, when summary inspection runs, then it reports thread identity, source revision, message counts, turn counts, chunk counts, generated rollout path if present, generated token count if present, degraded counts, and repair-needed counts.

**AC-6.2:** Token inspection distinguishes canonical, derived, and generated counts.

- **TC-6.2a:** Given SQLite-backed token metadata, when token inspection runs, then it reports raw canonical estimates/counts, tool-result scale, smooth counts, lower-band/chunk counts, exact vs heuristic status, and generated rollout token count where available.
- **TC-6.2b:** Given generated assistant usage metadata conflicts with authoritative generated-output metadata, when reported, then authoritative generated-output metadata remains the generated-session count source.

**AC-6.3:** Band inspection reports actual generated projection layout.

- **TC-6.3a:** Given a generated rollout from SQLite-backed state, when band inspection runs, then it reports full/smooth/detailed/brief selected ranges or chunks, token sums, record/message counts, and warnings for missing metadata.

**AC-6.4:** Post-compact report composes SQLite-backed inspection results.

- **TC-6.4a:** Given a post-compact report request, when the report runs, then it composes summary, token, band, status, warning, and mismatch information without mutating managed state.

**AC-6.5:** Inspection handles missing generated rollout files gracefully.

- **TC-6.5a:** Given managed SQLite state with no current rollout file or a missing rollout path, when inspection runs, then it reports partial managed state and a warning rather than crashing.

**AC-7.1:** Snapshot captures managed database and generated projection artifacts.

- **TC-7.1a:** Given a managed thread, when a snapshot is created, then it includes the thread database, current/generated rollout JSONL if present, manifest metadata, and enough counts/status to identify the snapshot later.

**AC-7.2:** Export produces an inspectable portable artifact.

- **TC-7.2a:** Given a SQLite-backed thread, when exported, then the output can be copied, archived, and inspected without relying on the original live project directory.
- **TC-7.2b:** Given export includes JSON compatibility output, when reviewed by humans or fixtures, then canonical-vs-derived-vs-projection ownership remains explicit.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 5 preserves the operator/debugging surface after SQLite becomes the managed source artifact. `lhx` and snapshot/export must make source, derived, and projection ownership explicit rather than reintroducing legacy JSON as source truth.

`packages/lh-context` remains portable: no hard native SQLite dependency is added to the package. SQLite inspection uses optional/dynamic adapter behavior and returns structured `SQLITE_DRIVER_UNAVAILABLE` guidance when the driver is unavailable; file-backed inspection must still work.

#### Build Strategy

Strategy: tdd-lite

Reason:
- This story is mostly read-model/CLI/SDK composition plus snapshot/export packaging.
- The important risks are contract clarity, optional driver behavior, and portability rather than complex mutation.

Risk Reminders:
- Do not duplicate primitive inspector logic inside reports.
- Keep JSON output stable and agent-friendly.
- Snapshot/export must label canonical, derived, generated, and legacy debug artifacts.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| `lhx` SDK/CLI | `packages/lh-context/src/*` |
| SQLite read adapter | optional/dynamic SQLite adapter under `packages/lh-context` or shared query module |
| Snapshot/export | root snapshot/export services and manifest writer |
| Error contract | structured `SQLITE_DRIVER_UNAVAILABLE` and missing rollout warnings |
| Tests | `lhx-sqlite-inspection.test.ts`, `snapshot-export-sqlite.test.ts`, `legacy-export-sqlite.test.ts`, `legacy-compat-sqlite.test.ts` |

#### Design References

- [tech-design.md §Inspection, Snapshot, Export](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:643), lines 643-674
- [tech-design.md §Dependency Decision](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:676), lines 676-706
- [tech-design.md §Error Contracts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:708), lines 708-724
- [tech-design.md §Testing And Verification Strategy](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:726), lines 726-768
- [test-plan.md §Inspection tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:171), lines 171-180
- [test-plan.md §Snapshot/export tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:182), lines 182-191
- [test-plan.md §Chunk 5](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:295), lines 295-307
- [coverage.md §Story 05](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md:130), lines 130-135

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-6.1a | `lhx-sqlite-inspection.test.ts` | summary reports identity, revision, counts, rollout path/token count, degraded and repair-needed counts |
| TC-6.2a, TC-6.2b | `lhx-sqlite-inspection.test.ts` | token inspection distinguishes canonical/derived/generated and prefers authoritative generated-output metadata over assistant usage |
| TC-6.3a | `lhx-sqlite-inspection.test.ts` | band inspection reports generated projection layout, counts, ranges/chunks, token sums, and warnings |
| TC-6.4a | `lhx-sqlite-inspection.test.ts` | post-compact report composes summary/tokens/bands/status/warnings/mismatches read-only |
| TC-6.5a | `lhx-sqlite-inspection.test.ts` | missing generated rollout reports partial state plus warning, not crash |
| TC-7.1a | `snapshot-export-sqlite.test.ts` | snapshot includes `thread.sqlite`, rollout JSONL when present, manifest counts/status |
| TC-7.2a, TC-7.2b | `snapshot-export-sqlite.test.ts`, `legacy-export-sqlite.test.ts` | portable export is inspectable and labels canonical-vs-derived-vs-projection ownership |

#### Architecture-Risk Tests

| Risk | Test File / Check | Test Description | Why AC/TC Mapping Alone Would Miss It |
|------|-------------------|------------------|---------------------------------------|
| Optional SQLite Driver For `lhx` | `lhx-sqlite-inspection.test.ts` | driver missing returns `SQLITE_DRIVER_UNAVAILABLE`; file-backed inspection still works | Packaging/portability risk is outside functional inspection ACs |
| Snapshot Portability | `snapshot-export-sqlite.test.ts` | copied/exported artifact can be inspected away from live project directory | Snapshot correctness is about portability, not just files existing |
| Legacy Compatibility | `legacy-export-sqlite.test.ts`, `legacy-compat-sqlite.test.ts` | JSON debug/export paths remain labeled non-authoritative | Export can accidentally recreate split-brain semantics |

#### SDK/CLI Contract

- CLI remains thin over SDK inspector/export functions.
- JSON output is stable and serializable for agents/scripts.
- Human output is concise; full IDs/details can remain in JSON if human output becomes noisy.
- Missing generated files, missing optional driver, and unsupported SQLite inspection are structured warning/error states.

#### Anti-Shim Requirements

- Do not add a hard `better-sqlite3` dependency to `packages/lh-context` in this story.
- Do not mutate/repair state from inspection/report commands.
- Do not make export JSON appear authoritative after SQLite cutover.

#### Production Path Proof

- Entrypoint: `lhx inspect ...` / SDK functions plus snapshot/export commands.
- Package proof: package-local typecheck/test/build must pass when `packages/lh-context` is touched.
- Runtime proof: smoke against a SQLite-backed fixture and a file-backed fixture without SQLite driver availability.

#### Verification

- Targeted: Chunk 5 test files listed above
- Package-local: `packages/lh-context` typecheck/test/build when touched
- Story gate: `npm run verify`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] `lhx` summary/tokens/bands/report/readiness can inspect SQLite-backed state.
- [ ] File-backed inspection still works without SQLite native driver.
- [ ] Missing generated rollout paths produce warnings, not crashes.
- [ ] Snapshot includes `thread.sqlite`, generated JSONL when present, and manifest counts/status.
- [ ] Export is portable and ownership-labeled.
- [ ] `npm run verify` and package-local `lh-context` gates pass or known-red issues are tracked.


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
- planner_turn_index: 4
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: quick-fix completed with outcome ready-for-verification and status ok.
- latest_response_kind: quick-fix-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/006-quick-fix.json
- older_response_count: 2
- caller_input_artifact_count: 0
- prior_self_note_count: 3
- latest_self_note: "After quick-fix returns, send the fix back to verifier continuation with focus on SV-05-F1 and SV-05-F2; do not accept without a pass and no open findings."

## Response Trail
<current_response>
```yaml
kind: quick-fix-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/006-quick-fix.json
bytes: 9160
payload:
  command: "quick-fix"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    provider: "codex"
    model: "gpt-5.4"
    rawProviderOutputPreview: |-
      {"type":"thread.started","thread_id":"019e63a5-1896-73b3-9ee6-df2c14380a1f"}
      {"type":"turn.started"}
      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m digging into the `lhx` readiness paths first so we can fix both failure modes cleanly, then I’ll add the targeted tests and run the package-local gates the task calls for."}}
      {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/Users/leemoore/code/pi-long-horizon\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc 'rg --files'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc 'rg --files'","aggregated_output":"src/thread/store/schema-version.ts\nsrc/thread/store/mutation-coordinator.ts\nsrc/thread/store/file-thread-store.ts\nsrc/thread/store/migrations/0001_sqlite_store_foundation.sql\nsrc/thread/store/thread-store.ts\nsrc/thread/store/sqlite-thread-store.ts\nsrc/thread/services/repair-service.ts\nsrc/thread/services/capture-service.ts\nsrc/thread/services/turn-service.ts\nsrc/thread/services/thread-service.ts\nsrc/thread/services/import-service.ts\nsrc/thread/migration/sqlite-thread-migration-service.ts\nsrc/thread/domain/output-metadata.ts\nsrc/thread/domain/records.ts\nsrc/thread/domain/errors.ts\nsrc/thread/domain/ids.ts\nsrc/thread/async-thread/services/placeholder-artifact-service.ts\nsrc/thread/async-thread/services/async-thread-run-service.ts\nsrc/thread/async-thread/services/pi-codex-lower-band-compression-provider.ts\nsrc/thread/async-thread/services/thread-maintenance-repair-service.ts\nsrc/thread/async-thread/services/smooth-turn-service.ts\nsrc/thread/async-thread/services/user-prompt-smoothing-service.ts\nsrc/thread/async-thread/services/lower-band-compression-service.ts\nsrc/thread/async-thread/services/chunk-service.ts\nsrc/thread/async-thread/services/pi-codex-user-prompt-smoothing-provider.ts\nsrc/thread/async-thread/services/lower-band-turn-projection-service.ts\nsrc/thread/async-thread/domain/async-thread-status.ts\nsrc/thread/async-thread/domain/placeholder-artifact-state.ts\nsrc/thread/async-thread/domain/chunk-state.ts\nsrc/thread/async-thread/domain/settings.ts\nsrc/thread/async-thread/domain/lower-band-artifact-state.ts\nsrc/thread/async-thread/domain/smooth-turn-state.ts\nsrc/thread/async-thread/test/temp-thread-store.ts\nsrc/thread/async-thread/test/fixtures.ts\nsrc/token-accounting/materialized-representation-counter.ts\nsrc/token-accounting/index.ts\nsrc/token-accounting/token-count-metadata.ts\nsrc/token-accounting/counter-source-policy.ts\nsrc/token-accounting/openai-generated-session-converter.ts\nsrc/token-accounting/openai-input-token-counter.ts\nsrc/commands/command-results.ts\nsrc/commands/smart-compact.ts\nsrc/pi-baseline.ts\nsrc/workbench/services/active-rollout-inspection-service.ts\nsrc/workbench/services/workbench-search-service.ts\nsrc/workbench/services/smoothing-inspection-service.ts\nsrc/workbench/services/workbench-query-service.ts\nsrc/workbench/services/compaction-report-service.ts\nsrc/workbench/services/compaction-report-formatter.ts\nsrc/workbench/domain/workbench-errors.ts\nsrc/workbench/test/temp-workbench-store.ts\nsrc/workbench/test/fixtures.ts\nsrc/harness-adapter/pi-cli-ha/pi-cli-ha.ts\nsrc/harness-adapter/pi-cli-ha/load-thread-view-file.ts\nsrc/context-workbench/store/file-thread-view-store.ts\nsrc/context-workbench/store/thread-view-store.ts\nsrc/context-workbench/services/workbench-search-service.ts\nsrc/context-workbench/services/workbench-query-service.ts\nsrc/context-workbench/services/thread-view-compare-service.ts\nsrc/context-workbench/services/thread-view-edit-service.ts\nsrc/context-workbench/services/thread-view-activation-service.ts\nsrc/context-workbench/services/thread-view-materializer.ts\nsrc/context-workbench/domain/thread-view-records.ts\nsrc/context-workbench/domain/workbench-errors.ts\nsrc/context-workbench/test/temp-workbench-store.ts\nsrc/context-workbench/test/fixtures.ts\nsrc/pi-extensions/codex-fast.ts\nsrc/pi-extensions/codex-web-search.ts\nsrc/context-steward/store/schema-version.ts\nsrc/context-steward/store/file-thread-store.ts\nsrc/context-steward/store/thread-store.ts\nsrc/context-steward/store/sqlite-thread-store.ts\nsrc/context-steward/services/snapshot-export-service.ts\nsrc/context-steward/services/repair-service.ts\nsrc/context-steward/services/capture-service.ts\nsrc/context-steward/services/turn-service.ts\nsrc/context-steward/services/fixture-service.ts\nsrc/context-steward/services/thread-service.ts\nsrc/context-steward/services/import-service.ts\nsrc/context-steward/domain/records.ts\nsrc/context-steward/domain/errors.ts\nsrc/context-steward/domain/ids.ts\nsrc/context-steward/commands/command-results.ts\nsrc/context-steward/pi/pi-extension.ts\nsrc/context-steward/pi/pi-session-importer.ts\nsrc/context-steward/pi/pi-message-mapper.ts\nsrc/context-steward/test/temp-store.ts\nsrc/context-steward/test/fixtures.ts\nsrc/login-chatgpt.ts\nsrc/list-models.ts\nsrc/thread-view/store/file-thread-view-store.ts\nsrc/thread-view/store/thread-view-store.ts\nsrc/thread-view/services/thread-view-builder.ts\nsrc/thread-view/services/thread-view-compare-service.ts\nsrc/thread-view/services/pi-token-estimator.ts\nsrc/thread-view/services/prompt-visible-tool-result-projection.ts\nsrc/thread-view/services/thread-view-activation-service.ts\nsrc/thread-view/services/live-tool-result-truncation.ts\nsrc/thread-view/services/thread-view-materializer.ts\nsrc/thread-view/domain/thread-view-errors.ts\nsrc/thread-view/domain/thread-view-records.ts\nsrc/thread-view/domain/pi-thread-view-file.ts\nbeads-instructions.md\nsrc/thread-view/targets/pi/pi-thread-view-prompt-truncation.ts\nCLAUDE.md\nAGENTS.md\nsrc/thread-view/targets/pi/active-prompt-projection-writer.ts\nsrc/thread-view/targets/pi/pi-thread-view-writer.ts\nsrc/thread-view/targets/pi/pi-thread-view-builder.ts\nREADME.md\ntsconfig.json\nsrc/integration-error.ts\npackage.json\npi-session-2026-05-11T23-26-49-660Z_019e195d-5d3c-71e3-a76a-7abb5387657f.html\npackage-lock.json\nsrc/thread-view/test/fixtures.ts\nscripts/prepare-real-long-thread.ts\nscripts/smoke-openai-input-token-count.ts\nscripts/openrouter-ping.ts\nscripts/inspect-smoothing-status.ts\nscripts/login-openai-api-key.mjs\nscripts/large-session-lib.ts\nscripts/smoke-openrouter-user-prompt-smoothing.ts\nscripts/run-compact.ts\nscripts/run-compact-custom.ts\nscripts/eval-user-prompt-smoothing.ts\nscripts/compact-report.ts\nscripts/import-pi-session.ts\nscripts/inspect-lower-band-status.ts\nscripts/maintain-thread.ts\nscripts/guard-no-test-changes.mjs\nscripts/login-openrouter-api-key.mjs\nscripts/run-node-tests.mjs\nscripts/seed-scenarios.ts\nscripts/inspect-active-thread-view.ts\nscripts/seed-large-session.ts\nrepo-ref/hydrate.md\nrepo-ref/beads-readme.md\nfixtures/real-pi-session/projections.json\nfixtures/real-pi-session/chunks.json\nfixtures/real-pi-session/fixture-manifest.json\nfixtures/real-pi-session/imports.json\nfixtures/real-pi-session/actors.json\nfixtures/real-pi-session/thread.json\nfixtures/real-pi-session/turns.json\nfixtures/real-pi-session/messages.jsonl\npackages/lh-context/src/pi-lh.ts\npackages/lh-context/tsconfig.json\npackages/lh-context/package.json\npackages/lh-context/README.md\ndocs/token-accounting/stage-4-materialized-counts.md\ndocs/token-accounting/stage-8-generated-session-validation.md\ndocs/token-accounting/final-worktree-reconciliation.md\ndocs/token-accounting/stage-2-token-metadata-schema.md\ndocs/token-accounting/stage-1-worktree-triage.md\ndocs/token-accounting/phase-a-compatibility-cleanup.md\ndocs/token-accounting/stage-7-thread-view-allocation.md\ndocs/token-accounting/stage-6-maintenance-rollups.md\ndocs/token-accounting/stage-3-provider-usage-capture.md\ndocs/token-accounting/stage-5-counter-source-poli
    rawProviderOutputBytes: 705554
    rawProviderOutputTruncated: true
    rawProviderOutputLogPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/streams/006-quick-fix.stdout.log"
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/006-quick-fix.json"
  startedAt: "2026-05-26T09:37:04.420Z"
  finishedAt: "2026-05-26T09:40:55.404Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/003-implementor.json
bytes: 5400
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "4c504b7f-3cc3-4d2a-b360-043f79e79b44"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e638c-e3f7-7fb0-b669-ba701f33eafe"
    continuation:
      provider: "codex"
      sessionId: "019e638c-e3f7-7fb0-b669-ba701f33eafe"
      storyId: "05-inspection-reporting-snapshot-export"
    outcome: "ready-for-verification"
    story:
      id: "05-inspection-reporting-snapshot-export"
      title: "Story 5: Inspection, Reporting, Snapshot, And Export"
    planSummary: "Added SQLite-aware `lhx` readiness/reporting support with optional-driver-safe loading and bundled-rollout portability, then introduced SQLite snapshot/export service APIs plus legacy-labeled debug export coverage."
    changedFiles:
      -
        path: "packages/lh-context/src/core/io.ts"
        reason: "Added backing-aware thread loading, mixed file/SQLite resolution, bundled generated-rollout fallback, and testable optional SQLite driver handling."
      -
        path: "packages/lh-context/src/core/inspectors.ts"
        reason: "Added readiness inspection, widened band source-id parsing, and composed projection/token/maintenance readiness summaries."
      -
        path: "packages/lh-context/src/commands/readiness.ts"
        reason: "Added the new `lhx inspect readiness` command entrypoint."
      -
        path: "packages/lh-context/src/commands/run.ts"
        reason: "Routed readiness commands and validated the new `--backing` option."
      -
        path: "packages/lh-context/src/commands/help.ts"
        reason: "Documented readiness inspection and backing selection in CLI help."
      -
        path: "packages/lh-context/src/output/format.ts"
        reason: "Added human-readable readiness formatting."
      -
        path: "packages/lh-context/src/types/public.ts"
        reason: "Extended public inspection contracts with backing selection and readiness result types."
      -
        path: "packages/lh-context/src/index.ts"
        reason: "Exported readiness inspector and formatter APIs."
      -
        path: "packages/lh-context/test/core/sqlite-inspection.test.ts"
        reason: "Added SQLite inspection coverage for summary/tokens/bands/report/readiness and optional-driver fallback behavior."
      -
        path: "packages/lh-context/test/cli/inspect-routing.test.ts"
        reason: "Extended CLI routing coverage to include readiness commands and aliases."
      -
        path: "src/context-steward/services/snapshot-export-service.ts"
        reason: "Added SQLite snapshot creation, restore, and legacy debug export services with manifest labeling and generated-rollout bundling."
      -
        path: "tests/context-steward/snapshot-export-sqlite.test.ts"
        reason: "Added snapshot portability, restore, and missing-rollout warning coverage for SQLite bundles."
      -
        path: "tests/context-steward/legacy-export-sqlite.test.ts"
        reason: "Added coverage for explicit legacy debug export ownership labeling and inspectability."
      -
        path: "tests/context-steward/legacy-compat-sqlite.test.ts"
        reason: "Added compatibility coverage proving fixture/export workflows do not create split-brain live JSON source files."
    tests:
      added:
        - "packages/lh-context/test/core/sqlite-inspection.test.ts"
        - "tests/context-steward/snapshot-export-sqlite.test.ts"
        - "tests/context-steward/legacy-export-sqlite.test.ts"
        - "tests/context-steward/legacy-compat-sqlite.test.ts"
      modified:
        - "packages/lh-context/test/cli/inspect-routing.test.ts"
      removed:
[]
      totalAfterStory: 643
      deltaFromPriorBaseline: 4
    gatesRun:
      -
        command: "node --test --import tsx tests/context-steward/snapshot-export-sqlite.test.ts tests/context-steward/legacy-export-sqlite.test.ts tests/context-steward/legacy-compat-sqlite.test.ts tests/context-steward/snapshot-sqlite-smoke.test.ts"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context test"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context run typecheck"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context run build"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Prevented explicit missing `--thread-view` paths from silently falling through to bundled generated files, restoring the intended partial-warning behavior."
        - "Made auto inspection tolerate unreadable SQLite threads so file-backed inspection still works when the optional driver is unavailable."
        - "Wrapped injected SQLite-loader failures as structured `SQLITE_DRIVER_UNAVAILABLE` errors and removed the unhandled-rejection test hazard."
        - "Verified restored snapshot bundles inspect against their bundled generated rollout instead of depending on the original project path."
      findingsSurfaced:
        - "Snapshot/export are implemented as service-layer entry points; if verification expects a dedicated operator command facade, that wiring would be the next follow-up."
    openQuestions:
      - "Should the new snapshot/export services be wired into a user-facing command/catalog surface in this epic, or stay as service APIs for now?"
    specDeviations:
[]
    recommendedNextStep: "Hand this story to verification, with explicit attention on whether the service-level snapshot/export entrypoints satisfy the expected command surface for Story 5."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/003-implementor.json"
  startedAt: "2026-05-26T09:10:38.049Z"
  finishedAt: "2026-05-26T09:26:47.118Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/004-verify.json
bytes: 9060
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "2f372cd3-0b0d-43d9-9f4e-60af73c37e3f"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e639b-d21f-7072-881c-75752e7ef7a1"
    continuation:
      provider: "codex"
      sessionId: "019e639b-d21f-7072-881c-75752e7ef7a1"
      storyId: "05-inspection-reporting-snapshot-export"
    mode: "initial"
    story:
      id: "05-inspection-reporting-snapshot-export"
      title: "Story 5: Inspection, Reporting, Snapshot, And Export"
    artifactsRead:
      - "docs/spec-build/epics/06-sqlite-persistence/stories/05-inspection-reporting-snapshot-export.md"
      - "docs/spec-build/epics/06-sqlite-persistence/tech-design.md"
      - "docs/spec-build/epics/06-sqlite-persistence/test-plan.md"
      - "docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md"
      - "package.json"
      - "packages/lh-context/package.json"
      - "packages/lh-context/src/core/io.ts"
      - "packages/lh-context/src/core/inspectors.ts"
      - "packages/lh-context/src/core/reports.ts"
      - "packages/lh-context/src/output/format.ts"
      - "packages/lh-context/src/types/public.ts"
      - "packages/lh-context/src/commands/run.ts"
      - "packages/lh-context/src/commands/help.ts"
      - "packages/lh-context/src/commands/readiness.ts"
      - "packages/lh-context/src/index.ts"
      - "packages/lh-context/test/core/sqlite-inspection.test.ts"
      - "packages/lh-context/test/cli/inspect-routing.test.ts"
      - "tests/context-steward/lhx-sqlite-smoke.test.ts"
      - "src/context-steward/services/snapshot-export-service.ts"
      - "tests/context-steward/snapshot-export-sqlite.test.ts"
      - "tests/context-steward/legacy-export-sqlite.test.ts"
      - "tests/context-steward/legacy-compat-sqlite.test.ts"
      - "src/thread/domain/output-metadata.ts"
      - "src/workbench/services/workbench-query-service.ts"
    reviewScopeSummary: "Reviewed Story 5 spec coverage against the lhx SQLite inspection/readiness/reporting implementation, snapshot/export services, legacy compatibility/export paths, and the Story 5 test surfaces plus root/package verification gates."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-05-F1"
        severity: "major"
        title: "`lhx inspect readiness` crashes in human-output mode when maintenance status is absent"
        evidence: "`inspectReadiness()` always emits `background`, `manualRepair`, and `prepare` keys even when the underlying maintenance records are missing (`packages/lh-context/src/core/inspectors.ts:155-158`). `formatReadinessHuman()` then blindly dereferences every entry (`packages/lh-context/src/output/format.ts:100-102`). Repro on the shipped sample fixture: `npx tsx --eval \"import { runCli } from './packages/lh-context/src/commands/run.ts'; (async () => { const result = await runCli(['inspect','readiness','--root','packages/lh-context/test/fixtures/sample']); console.log(JSON.stringify(result)); })();\"` returns `lhx error: Cannot read properties of undefined (reading 'status')`. The CLI tests only exercise readiness under `--json` (`packages/lh-context/test/cli/inspect-routing.test.ts:25-29,41`), so this operator-facing regression is currently untested."
        affectedFiles:
          - "packages/lh-context/src/core/inspectors.ts"
          - "packages/lh-context/src/output/format.ts"
          - "packages/lh-context/test/cli/inspect-routing.test.ts"
        requirementIds:
          - "Scope-In: lhx reads SQLite-backed readiness state"
          - "DoD: lhx summary/tokens/bands/report/readiness can inspect SQLite-backed state"
        recommendedFixScope: "quick-fix"
        blocking: true
      -
        id: "SV-05-F2"
        severity: "major"
        title: "Readiness can report failed generated-output state as `ready` when the stale rollout file still exists"
        evidence: "`projectionReadiness()` marks any generated file with records as `ready` unless `generatedOutput.status` is literally `degraded` (`packages/lh-context/src/core/inspectors.ts:229-235`), so `blocked`, `write_failed`, and `reload_failed` never win if the failed JSONL is still on disk. Repro: seeding a SQLite thread with `generatedOutput.status='write_failed'` and an existing generated file produced `{\"projectionStatus\":\"ready\",\"overallStatus\":\"prepare_recommended\"}` from `inspectReadiness()`. This diverges from the product’s workbench readiness logic, which treats non-`available` generated outputs as blocked/degraded (`src/workbench/services/workbench-query-service.ts:311-317`). That makes the lhx readiness surface capable of telling operators that a broken rollout is healthy."
        affectedFiles:
          - "packages/lh-context/src/core/inspectors.ts"
          - "packages/lh-context/test/core/sqlite-inspection.test.ts"
        requirementIds:
          - "Scope-In: lhx reads SQLite-backed readiness state"
          - "DoD: lhx summary/tokens/bands/report/readiness can inspect SQLite-backed state"
        recommendedFixScope: "quick-fix"
        blocking: true
    openFindings:
      -
        id: "SV-05-F1"
        severity: "major"
        title: "`lhx inspect readiness` crashes in human-output mode when maintenance status is absent"
        evidence: "`inspectReadiness()` always emits `background`, `manualRepair`, and `prepare` keys even when the underlying maintenance records are missing (`packages/lh-context/src/core/inspectors.ts:155-158`). `formatReadinessHuman()` then blindly dereferences every entry (`packages/lh-context/src/output/format.ts:100-102`). Repro on the shipped sample fixture: `npx tsx --eval \"import { runCli } from './packages/lh-context/src/commands/run.ts'; (async () => { const result = await runCli(['inspect','readiness','--root','packages/lh-context/test/fixtures/sample']); console.log(JSON.stringify(result)); })();\"` returns `lhx error: Cannot read properties of undefined (reading 'status')`. The CLI tests only exercise readiness under `--json` (`packages/lh-context/test/cli/inspect-routing.test.ts:25-29,41`), so this operator-facing regression is currently untested."
        affectedFiles:
          - "packages/lh-context/src/core/inspectors.ts"
          - "packages/lh-context/src/output/format.ts"
          - "packages/lh-context/test/cli/inspect-routing.test.ts"
        requirementIds:
          - "Scope-In: lhx reads SQLite-backed readiness state"
          - "DoD: lhx summary/tokens/bands/report/readiness can inspect SQLite-backed state"
        recommendedFixScope: "quick-fix"
        blocking: true
      -
        id: "SV-05-F2"
        severity: "major"
        title: "Readiness can report failed generated-output state as `ready` when the stale rollout file still exists"
        evidence: "`projectionReadiness()` marks any generated file with records as `ready` unless `generatedOutput.status` is literally `degraded` (`packages/lh-context/src/core/inspectors.ts:229-235`), so `blocked`, `write_failed`, and `reload_failed` never win if the failed JSONL is still on disk. Repro: seeding a SQLite thread with `generatedOutput.status='write_failed'` and an existing generated file produced `{\"projectionStatus\":\"ready\",\"overallStatus\":\"prepare_recommended\"}` from `inspectReadiness()`. This diverges from the product’s workbench readiness logic, which treats non-`available` generated outputs as blocked/degraded (`src/workbench/services/workbench-query-service.ts:311-317`). That makes the lhx readiness surface capable of telling operators that a broken rollout is healthy."
        affectedFiles:
          - "packages/lh-context/src/core/inspectors.ts"
          - "packages/lh-context/test/core/sqlite-inspection.test.ts"
        requirementIds:
          - "Scope-In: lhx reads SQLite-backed readiness state"
          - "DoD: lhx summary/tokens/bands/report/readiness can inspect SQLite-backed state"
        recommendedFixScope: "quick-fix"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-6.1"
        - "TC-6.1a"
        - "AC-6.2"
        - "TC-6.2a"
        - "TC-6.2b"
        - "AC-6.3"
        - "TC-6.3a"
        - "AC-6.4"
        - "TC-6.4a"
        - "AC-6.5"
        - "TC-6.5a"
        - "AC-7.1"
        - "TC-7.1a"
        - "AC-7.2"
        - "TC-7.2a"
        - "TC-7.2b"
      unverified:
        - "Scope-In: lhx reads SQLite-backed readiness state"
        - "DoD: lhx summary/tokens/bands/report/readiness can inspect SQLite-backed state"
    gatesRun:
      -
        command: "npm run verify-all"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context run typecheck"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context run test"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context run build"
        result: "pass"
    productionPathFindings:
      - "SV-05-F1: the default human-facing `lhx inspect readiness` path can crash on ordinary threads that have no maintenance status payload."
      - "SV-05-F2: readiness can label a failed/stale generated rollout as `ready`, which misleads operator compact/snapshot decisions in a real runtime state."
    recommendedNextStep: "revise"
    recommendedFixScope: "quick-fix"
    openQuestions:
[]
    additionalObservations:
      - "`npm run verify-all` and the package-local lh-context gates all passed; the remaining risk is behavioral, not gate health."
      - "I did not find a fake adapter, shim, or placeholder execution path in the reviewed Story 5 production code."
      - "Current readiness coverage is JSON-only and does not exercise either the human formatter branch or failed generated-output status branches."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/004-verify.json"
  startedAt: "2026-05-26T09:26:56.508Z"
  finishedAt: "2026-05-26T09:36:52.945Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/story-lead/001-current.json
Bytes: 2386

```yaml
storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
storyId: "05-inspection-reporting-snapshot-export"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "quick-fix completed with outcome ready-for-verification and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/004-verify.json"
    provenance: "current-run"
  -
    kind: "quick-fix-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/006-quick-fix.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e638c-e3f7-7fb0-b669-ba701f33eafe"
    storyId: "05-inspection-reporting-snapshot-export"
  storyVerifier:
    provider: "codex"
    sessionId: "019e639b-d21f-7072-881c-75752e7ef7a1"
    storyId: "05-inspection-reporting-snapshot-export"
latestEventSequence: 13
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "The latest verifier result is revise with two blocking major findings, both marked quick-fix scope and both isolated to lhx readiness behavior. Acceptance is not allowed until these are fixed and reverified."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/006-quick-fix.json"
replayBoundary: null
updatedAt: "2026-05-26T09:40:55.413Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After quick-fix returns, send the fix back to verifier continuation with focus on SV-05-F1 and SV-05-F2; do not accept without a pass and no open findings.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-26T09:10:38.013Z; note="After implementation returns, verify evidence covers optional driver unavailable behavior, file-backed inspection without SQLite driver, missing rollout warnings, snapshot portability, and ownership labels before considering verifier dispatch."
- sequence=8; actionSequence=7; createdAt=2026-05-26T09:26:56.472Z; note="After verifier returns, do not accept unless it explicitly passes with no open findings and addresses the snapshot/export service-vs-command surface question."
- sequence=12; actionSequence=11; createdAt=2026-05-26T09:37:04.386Z; note="After quick-fix returns, send the fix back to verifier continuation with focus on SV-05-F1 and SV-05-F2; do not accept without a pass and no open findings."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/story-lead/001-events.jsonl
Bytes: 6279

```yaml
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 1
  timestamp: "2026-05-26T09:10:23.641Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 2
  timestamp: "2026-05-26T09:10:37.990Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e638c-aba7-7070-8771-9725cdda5bbb"
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 3
  timestamp: "2026-05-26T09:10:38.012Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, verify evidence covers optional driver unavailable behavior, file-backed inspection without SQLite driver, missing rollout warnings, snapshot portability, and ownership labels before considering verifier dispatch."
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 4
  timestamp: "2026-05-26T09:10:38.013Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, verify evidence covers optional driver unavailable behavior, file-backed inspection without SQLite driver, missing rollout warnings, snapshot portability, and ownership labels before considering verifier dispatch."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 5
  timestamp: "2026-05-26T09:26:47.132Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 6
  timestamp: "2026-05-26T09:26:56.450Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e639b-ad5e-7b33-b1f5-307783df516d"
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 7
  timestamp: "2026-05-26T09:26:56.472Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "After verifier returns, do not accept unless it explicitly passes with no open findings and addresses the snapshot/export service-vs-command surface question."
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 8
  timestamp: "2026-05-26T09:26:56.472Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After verifier returns, do not accept unless it explicitly passes with no open findings and addresses the snapshot/export service-vs-command surface question."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 9
  timestamp: "2026-05-26T09:36:52.955Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/004-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 10
  timestamp: "2026-05-26T09:37:04.366Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/05-inspection-reporting-snapshot-export/story-lead/prompts/001-planner-turn-003.md"
    sessionId: "019e63a4-ebf0-7842-8c1d-fc6574a4b138"
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 11
  timestamp: "2026-05-26T09:37:04.386Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-quick-fix."
  data:
    actionType: "run-quick-fix"
    turn: 3
    selfNote: "After quick-fix returns, send the fix back to verifier continuation with focus on SV-05-F1 and SV-05-F2; do not accept without a pass and no open findings."
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 12
  timestamp: "2026-05-26T09:37:04.386Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After quick-fix returns, send the fix back to verifier continuation with focus on SV-05-F1 and SV-05-F2; do not accept without a pass and no open findings."
    actionSequence: 11
    actionType: "run-quick-fix"
    turn: 3
-
  storyRunId: "05-inspection-reporting-snapshot-export-story-run-001"
  sequence: 13
  timestamp: "2026-05-26T09:40:55.412Z"
  type: "child-operation-completed"
  summary: "quick-fix completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/006-quick-fix.json"
  data:
    actionType: "run-quick-fix"
    command: "quick-fix"
    outcome: "ready-for-verification"
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
