# Story Lead Base Prompt

## Role Charter
You are the story lead for `04-smart-compact-snapshot-and-rollout-regeneration` on durable story run `04-smart-compact-snapshot-and-rollout-regeneration-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 6.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/04-smart-compact-snapshot-and-rollout-regeneration.md
Bytes: 10796

# Story 4: Smart Compact Snapshot And Rollout Regeneration

### Summary
<!-- Jira: Summary field -->

Build smart compact and rollout regeneration from consistent SQLite snapshots while keeping generated PI JSONL as projection output.

### Description
<!-- Jira: Description field -->

**User Profile:** Long Horizon operator / tech lead maintaining managed PI sessions.

**Objective:** Make smart compact read managed state from SQLite and produce regenerable PI rollout JSONL without treating generated files as source truth.

**Scope In:**

- `readCompactSnapshot(...)` replaces split compact reads.
- Strict compact reads ready SQLite state and blocks/degrades according to readiness policy.
- Prepare compact performs full eligible catch-up before projection.
- Generated rollout JSONL can be regenerated from SQLite.
- Prompt-visible tool-result truncation remains projection-only.
- Generated exact token count remains separate from source artifact rollups.

**Scope Out:**

- Runtime store factory cutover.
- Derived maintenance row-level adaptation beyond compact needs.
- Full `lhx` inspection feature work.
- Removing legacy file-store compatibility.

**Dependencies:**

- Story 2 whole-store runtime compatibility cutover.
- Story 3 derived maintenance row-level adaptation for readiness debt behavior.
- `tech-design.md` Sections 7.5, 8.4, 8.7, 9.6, and 11.
- `test-plan.md` Chunk 4.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-5.1:** Smart compact builds projection from managed source state.

- **TC-5.1a:** Given SQLite-backed managed state, when smart compact runs, then it selects full, smooth, detailed, and brief content from managed canonical and derived entities rather than from a prior generated rollout file.
- **TC-5.1b:** Given an older generated rollout exists, when smart compact runs again, then the new projection is based on current managed source state and current readiness policy.

**AC-5.2:** Strict compact respects readiness blockers.

- **TC-5.2a:** Given missing or untrusted required token/artifact metadata, when strict smart compact runs, then it blocks or degrades according to existing policy and reports the blocker.
- **TC-5.2b:** Given ready managed state, when strict smart compact runs, then it does not require a full prepare repair first.

**AC-5.3:** Prepare compact performs full catch-up before projection.

- **TC-5.3a:** Given repairable derived debt, when smart compact runs in prepare mode, then it attempts full eligible repair before generating the rollout.
- **TC-5.3b:** Given unresolved provider or artifact failures after prepare, when projection proceeds or blocks, then degraded/repair-needed status is recorded and reported.

**AC-5.4:** Generated rollout JSONL remains regenerable.

- **TC-5.4a:** Given the current rollout JSONL is missing or archived, when regeneration runs from managed SQLite state, then a valid PI-facing rollout JSONL can be produced if required artifacts are ready.
- **TC-5.4b:** Given regeneration succeeds, when inspected, then projection metadata records generated path, source revision, band layout, generated token count, and status.

**AC-5.5:** Prompt-visible tool-result truncation remains projection-only.

- **TC-5.5a:** Given a canonical tool result with full content, when smart compact writes a rollout that truncates prompt-visible tool output, then canonical managed content remains full-fidelity.
- **TC-5.5b:** Given generated rollout messages contain truncated tool-result projections, when inspecting canonical state, then reports distinguish canonical source scale from generated prompt-visible scale.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 4 hardens the source-to-projection bridge. SQLite is the managed source of truth; generated PI rollout JSONL is disposable output. Smart compact must select from a consistent SQLite snapshot, not from a previous rollout file or mixed-revision split reads.

This story introduces the compact read model contract: `readCompactSnapshot(...)` returns all compact inputs from one SQLite read transaction, including canonical entities, derived artifacts, token metadata, readiness issues, and projection revisions.

#### Build Strategy

Strategy: full-staged-risk

Reason:
- Compact is a high-risk boundary where canonical, derived, generated, token-count, and PI-reload semantics meet.
- Failure can produce a plausible-looking rollout that is based on mixed or stale state.

Risk Reminders:
- Strict compact blocks/degrades according to readiness; it does not run full repair implicitly.
- Prepare mode remains the full catch-up path.
- Generated exact token count is the final serialized/truncated output count, not the source artifact rollup sum.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Compact read model | `readCompactSnapshot(...)` on `SqliteThreadStore` and related query module |
| Thread-view/projection builder | current smart compact/thread-view builder modules |
| Generated rollout writer | PI rollout/session JSONL writer/reload path |
| Projection metadata | `projection_revisions`, `projection_band_entries`, `generated_outputs` writes |
| Tests | `smart-compact-sqlite.test.ts`, `smart-compact-prepare-sqlite.test.ts`, `rollout-regeneration-sqlite.test.ts` |

#### Design References

- [tech-design.md §Projection tables](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:468), lines 468-476
- [tech-design.md §Projection read and write transaction semantics](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:515), lines 515-523
- [tech-design.md §Deterministic algorithm boundaries](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:546), lines 546-555
- [tech-design.md §Smart compact runtime flow](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:593), lines 593-596
- [tech-design.md §Inspection, Snapshot, Export](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:643), lines 643-674
- [test-plan.md §Smart compact tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:156), lines 156-169
- [test-plan.md §Chunk 4](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:282), lines 282-293
- [coverage.md §Story 04](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md:124), lines 124-129

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-5.1a, TC-5.1b | `smart-compact-sqlite.test.ts` | compact selects from current managed SQLite state, not previous generated rollout |
| TC-5.2a, TC-5.2b | `smart-compact-sqlite.test.ts` | strict compact reports blockers and does not run full prepare repair implicitly |
| TC-5.3a, TC-5.3b | `smart-compact-prepare-sqlite.test.ts` | prepare performs full eligible catch-up and persists unresolved blockers/degraded status |
| TC-5.4a, TC-5.4b | `rollout-regeneration-sqlite.test.ts` | missing/generated rollout is regenerated and projection metadata/current binding updates |
| TC-5.5a, TC-5.5b | `smart-compact-sqlite.test.ts` | prompt-visible truncation is projection-only and generated exact count is final serialized output |

#### Architecture-Risk Tests

| Risk | Test File / Check | Test Description | Why AC/TC Mapping Alone Would Miss It |
|------|-------------------|------------------|---------------------------------------|
| Compact Read Consistency | `smart-compact-sqlite.test.ts` | compact uses one SQLite read snapshot for thread/messages/turns/chunks/artifacts | Separate store reads can mix revisions under WAL |
| Source vs Projection Truth | `rollout-regeneration-sqlite.test.ts` | generated rollout disagreement never overwrites canonical SQLite state | Projection files are live PI artifacts and easy to accidentally treat as source |
| Projection Atomicity / Recovery | `smart-compact-sqlite.test.ts` | temp file write / metadata write split failure remains recoverable | User-facing compact output hides intermediate file/metadata states |
| Threshold / Budget | `smart-compact-sqlite.test.ts` | strict/prepare, lower-bound, stale artifact, and band tie cases are deterministic | ACs do not define exact boundary decisions |

#### `readCompactSnapshot(...)` Contract

The snapshot must include:

- thread identity/source revision;
- actors, messages, message parts;
- turns and turn membership;
- chunks and chunk membership;
- smooth/lower-band artifacts needed for band selection;
- token counts/trust metadata;
- readiness/debt issues;
- projection revisions/current generated-output metadata;
- a `readRevision` or equivalent identifier for the SQLite read snapshot.

All of the above must be read within one SQLite read transaction.

This replaces the current file-level read-consistency pattern that relies on `MutationCoordinator.acquireThreadLease` around smart compact reads. For SQLite-backed compact, WAL mode plus a single read transaction provides the consistency guarantee; do not keep a file-store mutation lease as the primary consistency mechanism for SQLite reads.

#### Anti-Shim Requirements

- Do not build a compact projection by reading the latest generated JSONL as source truth.
- Do not call separate snapshot/chunk reads and ignore mixed-revision risk after this story.
- Do not report artifact-rollup token sums as the final generated-session token count.

#### Production Path Proof

- Entrypoint: smart compact command/service path.
- Default deps: proof must use the real SQLite compact read path and generated rollout writer, with fake provider/token boundaries only where needed.
- Runtime smoke: verify generated rollout can be written/reloaded where existing compact tests require PI interaction.

#### Verification

- Targeted: Chunk 4 test files listed above
- Story gate: `npm run verify`
- E2E/smoke: run compact reload smoke where touched

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Smart compact reads from SQLite compact snapshots.
- [ ] Strict compact readiness behavior is preserved.
- [ ] Prepare compact catch-up behavior is preserved.
- [ ] Missing rollout regeneration works from SQLite.
- [ ] Projection metadata records generated path, source revision, band layout, token count, and status.
- [ ] Prompt-visible truncation remains projection-only.
- [ ] `npm run verify` and relevant E2E/smoke tests pass or known-red issues are tracked.


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
- planner_turn_index: 6
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: quick-fix completed with outcome ready-for-verification and status ok.
- latest_response_kind: quick-fix-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/005-quick-fix.json
- older_response_count: 4
- caller_input_artifact_count: 0
- prior_self_note_count: 5
- latest_self_note: "After this quick-fix returns, require independent verification focused on SV-04-001, AC-5.1/TC-5.1b, and `npm run verify-all`; accept only if verifier outcome is pass with no open findings."

## Response Trail
<current_response>
```yaml
kind: quick-fix-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/005-quick-fix.json
bytes: 9263
payload:
  command: "quick-fix"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    provider: "codex"
    model: "gpt-5.4"
    rawProviderOutputPreview: |-
      {"type":"thread.started","thread_id":"019e637f-01d8-7880-b5a2-221eee0dd220"}
      {"type":"turn.started"}
      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m picking up `SV-04-001` and will first inspect the issue details plus the existing smart-compact SQLite/file-store flow so we can patch the stale-revision check without disturbing legacy behavior."}}
      {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' beads-instructions.md\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' beads-instructions.md\"","aggregated_output":"# Beads Instructions\n\nThis project uses **bd (beads)** for issue tracking.\n\n## Purpose\n\nBeads is the primary tracker for actionable backlog items, priorities, dependencies, ready/blocked state, and multi-agent handoff.\n\nMarkdown remains appropriate for ADRs, design notes, specs, and narrative context. Do not treat `.tech-lead/backlog.md` as the live task tracker unless explicitly instructed.\n\n## Core Commands\n\n```bash\nbd prime                 # Show current agent workflow context\nbd ready                 # Find unblocked work\nbd show <id>             # View issue details and audit trail\nbd update <id> --claim   # Claim work atomically\nbd close <id>            # Complete work\nbd list                  # List issues\nbd status                # Database overview\nbd create \"Title\" --type task --priority 2\n```\n\nUse `--json` when structured output is useful for agents.\n\n## Storage / Sync Notes\n\nIssues live in a local Dolt database under `.beads/`. `.beads/issues.jsonl` is an export/view artifact, not the source of truth.\n\nCross-machine sync uses Beads/Dolt commands such as:\n\n```bash\nbd dolt push\nbd dolt pull\n```\n\nDo not `bd import` during normal operation unless intentionally restoring/importing data.\n\n## Agent Usage Guidance\n\n- Use Beads for actionable tasks instead of ad hoc markdown TODO lists.\n- Use `bd ready` to find work and `bd show <id>` before starting.\n- Claim work with `bd update <id> --claim` when appropriate.\n- Close issues only when the work and validation are actually complete.\n- Add comments/notes to issues when useful for handoff.\n\n## Project Preference\n\nKeep root `AGENTS.md` minimal. Detailed Beads workflow belongs here, not in `AGENTS.md`.\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' /Users/leemoore/code/pi-long-horizon/AGENTS.md\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' /Users/leemoore/code/pi-long-horizon/AGENTS.md\"","aggregated_output":"## Issue Tracking\n\nUse `bd` (Beads) for actionable work.\n\n- `bd ready` — find unblocked work\n- `bd show <id>` — inspect before starting\n- `bd update <id> --claim` — claim ownership\n- `bd close <id>` — close after validation\n\nSee `beads-instructions.md` for details.\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_3","type":"command_execution","command":"/bin/zsh -lc 'rg -n \"runSmartCompact|readCompactSnapshot|STALE_SOURCE_REVISION|smart compact|smart-compact\" -S .'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"/bin/zsh -lc 'rg -n \"runSmartCompact|readCompactSnapshot|STALE_SOURCE_REVISION|smart compact|smart-compact\" -S .'","aggregated_output":"./src/thread/store/mutation-coordinator.ts:31:        code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/file-thread-store.ts:165:    code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/file-thread-store.ts:173:    code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/file-thread-store.ts:578:          code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/file-thread-store.ts:601:  async readCompactSnapshot(threadId: string): Promise<StewardResult<CompactThreadSnapshot>> {\n./src/thread/store/file-thread-store.ts:642:          code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/thread-store.ts:131:  readCompactSnapshot(threadId: string): Promise<StewardResult<CompactThreadSnapshot>>;\n./src/thread/store/sqlite-thread-store.ts:310:    code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/sqlite-thread-store.ts:318:    code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/sqlite-thread-store.ts:1015:  async readCompactSnapshot(threadId: string): Promise<StewardResult<CompactThreadSnapshot>> {\n./src/thread/store/sqlite-thread-store.ts:1036:      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, \"readCompactSnapshot\", threadId));\n./src/thread/store/sqlite-thread-store.ts:1485:                code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/sqlite-thread-store.ts:1560:                code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/sqlite-thread-store.ts:1614:                code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/sqlite-thread-store.ts:1641:                  code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/sqlite-thread-store.ts:1704:                code: \"STALE_SOURCE_REVISION\",\n./src/thread/store/sqlite-thread-store.ts:1734:                    code: \"STALE_SOURCE_REVISION\",\n./src/thread/services/repair-service.ts:115:  if (issues.some((issue) => issue.code === \"STALE_SOURCE_REVISION\")) {\n./src/thread/services/repair-service.ts:183:      const failureIssues = writeResult.issues.some((issue) => issue.code === \"STALE_SOURCE_REVISION\")\n./src/thread/domain/errors.ts:24:  \"STALE_SOURCE_REVISION\",\n./src/thread/async-thread/services/async-thread-run-service.ts:147:  return issue.code === \"STALE_SOURCE_REVISION\" || issue.code === \"STORE_UNAVAILABLE\";\n./src/thread/async-thread/services/async-thread-run-service.ts:592:      `but ${input.mode} smart compact cannot derive usable token accounting for it. ` +\n./src/thread/async-thread/services/async-thread-run-service.ts:758:        message: `Turn ${turn.turnId} is missing deterministic smooth output required for smart compact.`,\n./src/thread/async-thread/services/async-thread-run-service.ts:807:            `Turn ${turn.turnId} (order ${turn.turnOrder}, lifecycle ${turn.lifecycleStatus}) is missing current OpenAI raw materialized token count required for strict smart compact allocation.` +\n./src/thread/async-thread/services/async-thread-run-service.ts:831:            message: `Turn ${turn.turnId} is missing current OpenAI smooth materialized token count required for strict smart compact allocation.`,\n./src/thread/async-thread/services/async-thread-run-service.ts:919:          message: `Chunk ${chunk.chunkId} is missing deterministic smooth chunk state required for smart compact.`,\n./src/thread/async-thread/services/async-thread-run-service.ts:941:            message: `Chunk ${chunk.chunkId} is missing current OpenAI smooth materialized token count required for strict smart compact allocation.`,\n./src/thread/async-thread/services/async-thread-run-service.ts:1229:          `[smart-compact] Smooth catch-up required for turn ${turn.turnId} before lower-band preparation can continue.`,\n./src/thread/async-thread/services/async-thread-run-service.ts:1435:        `[smart-compact] Lower-band catch-up required for chunk ${catchUpTarget.chunkId} ` +\n./src/thread/async-thread/services/async-thread-run-service.ts:1517:      \"OpenAI token counting failed during async preparation; strict smart compact cannot use heuristic token counts as success.\",\n./src/thread/async-thread/services/async-thread-run-service.ts:1519:      \"OpenAI materialized token counter is not configured; strict smart compact cannot use heuristic token counts as success.\",\n./src/thread/async-thread/services/async-thread-run-service.ts:2559:              \"OpenAI materialized token count repair was intentionally skipped during PI async background maintenance; exact materialized counts remain repai
    rawProviderOutputBytes: 2593663
    rawProviderOutputTruncated: true
    rawProviderOutputLogPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/streams/005-quick-fix.stdout.log"
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/005-quick-fix.json"
  startedAt: "2026-05-26T08:55:28.197Z"
  finishedAt: "2026-05-26T09:01:12.012Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/003-implementor.json
bytes: 4891
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "needs-followup-fix"
  result:
    resultId: "4e88dea3-2eac-4e3e-b840-d051518f9aef"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e634a-7588-7eb1-bc25-11d69dfbbb84"
    continuation:
      provider: "codex"
      sessionId: "019e634a-7588-7eb1-bc25-11d69dfbbb84"
      storyId: "04-smart-compact-snapshot-and-rollout-regeneration"
    outcome: "needs-followup-fix"
    story:
      id: "04-smart-compact-snapshot-and-rollout-regeneration"
      title: "Story 4: Smart Compact Snapshot And Rollout Regeneration"
    planSummary: "Implemented SQLite-backed compact snapshot reads, removed mixed post-build smart-compact reads, tightened projection metadata persistence/error handling, and added SQLite story coverage for strict, prepare, and regeneration flows."
    changedFiles:
      -
        path: "src/thread/store/thread-store.ts"
        reason: "Added the compact snapshot contract to the shared store interface."
      -
        path: "src/thread/store/file-thread-store.ts"
        reason: "Provided a compatibility `readCompactSnapshot` implementation for legacy file-backed callers."
      -
        path: "src/thread/store/sqlite-thread-store.ts"
        reason: "Added transactional `readCompactSnapshot` support and reused shared projection/chunk readers for consistent SQLite snapshot loads."
      -
        path: "src/thread-view/services/thread-view-builder.ts"
        reason: "Switched projection builds to consume one compact snapshot instead of split thread/chunk reads and surfaced snapshot thread metadata/read revision in results."
      -
        path: "src/commands/smart-compact.ts"
        reason: "Used snapshot-thread metadata for generated output/counting, removed premature generated identity mapping, and now fail explicitly when projection metadata persistence fails."
      -
        path: "tests/commands/helpers/smart-compact-sqlite-helpers.ts"
        reason: "Added reusable SQLite smart-compact fixture/counter helpers for story coverage."
      -
        path: "tests/commands/smart-compact-sqlite.test.ts"
        reason: "Added SQLite smart-compact coverage for consistent snapshot source revision behavior and source-vs-projection truth."
      -
        path: "tests/commands/smart-compact-prepare-sqlite.test.ts"
        reason: "Added SQLite prepare-mode coverage proving strict blockers remain until explicit prepare catch-up runs."
      -
        path: "tests/commands/rollout-regeneration-sqlite.test.ts"
        reason: "Added SQLite rollout regeneration coverage for missing generated-output recovery and metadata refresh."
    tests:
      added:
        - "tests/commands/smart-compact-sqlite.test.ts"
        - "tests/commands/smart-compact-prepare-sqlite.test.ts"
        - "tests/commands/rollout-regeneration-sqlite.test.ts"
      modified:
[]
      removed:
[]
      totalAfterStory: 575
      deltaFromPriorBaseline: 4
    gatesRun:
      -
        command: "npm run typecheck"
        result: "pass"
      -
        command: "node --import tsx --test tests/commands/smart-compact-sqlite.test.ts tests/commands/smart-compact-prepare-sqlite.test.ts tests/commands/rollout-regeneration-sqlite.test.ts"
        result: "pass"
      -
        command: "node --import tsx --test tests/commands/smart-compact.test.ts tests/commands/smart-compact.integration.test.ts tests/commands/smart-compact-lifecycle.integration.test.ts tests/thread-view/thread-view-builder.test.ts"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "fail"
      -
        command: "node --import tsx --test --test-name-pattern \"fixture creation command|creates a valid thread-shaped fixture\" tests/context-steward/e2e-cli.e2e.test.ts"
        result: "pass"
      -
        command: "node --import tsx --test --test-name-pattern \"^real PI execution continues the same prepared long-thread clone session with a second closed turn$\" tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Smart compact no longer builds from split thread/chunk reads and now uses a single store-level compact snapshot contract."
        - "Final generated-session counting and PI file creation now use the same compact snapshot thread metadata instead of reopening the thread after build."
        - "Projection metadata persistence is now checked explicitly, and the command no longer records generated-session identity mappings before metadata commit succeeds."
      findingsSurfaced:
        - "`npm run verify-all` is still unstable because long-running PI E2E coverage can time out inside the full suite even when the same failing test passes on isolated rerun."
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Stabilize or re-run the flaky full-suite long-thread E2E timeout so `npm run verify-all` goes green, then hand Story 4 to verification."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/003-implementor.json"
  startedAt: "2026-05-26T07:58:04.408Z"
  finishedAt: "2026-05-26T08:28:34.450Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/004-verify.json
bytes: 6361
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "ffd9b2db-5a32-48ee-a9d6-4447e0dd4dcf"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e6366-b6e8-77a3-8a73-1b0b0f43c529"
    continuation:
      provider: "codex"
      sessionId: "019e6366-b6e8-77a3-8a73-1b0b0f43c529"
      storyId: "04-smart-compact-snapshot-and-rollout-regeneration"
    mode: "initial"
    story:
      id: "04-smart-compact-snapshot-and-rollout-regeneration"
      title: "Story 4: Smart Compact Snapshot And Rollout Regeneration"
    artifactsRead:
      - "docs/spec-build/epics/06-sqlite-persistence/stories/04-smart-compact-snapshot-and-rollout-regeneration.md"
      - "docs/spec-build/epics/06-sqlite-persistence/tech-design.md"
      - "docs/spec-build/epics/06-sqlite-persistence/test-plan.md"
      - "src/commands/smart-compact.ts"
      - "src/thread/store/thread-store.ts"
      - "src/thread/store/sqlite-thread-store.ts"
      - "src/thread/store/file-thread-store.ts"
      - "src/thread/store/mutation-coordinator.ts"
      - "src/thread/services/thread-service.ts"
      - "src/thread/domain/output-metadata.ts"
      - "src/thread/async-thread/services/async-thread-run-service.ts"
      - "src/thread-view/services/thread-view-builder.ts"
      - "src/thread-view/services/thread-view-materializer.ts"
      - "src/context-steward/pi/pi-extension.ts"
      - "tests/commands/helpers/smart-compact-sqlite-helpers.ts"
      - "tests/commands/smart-compact-sqlite.test.ts"
      - "tests/commands/smart-compact-prepare-sqlite.test.ts"
      - "tests/commands/rollout-regeneration-sqlite.test.ts"
      - "tests/commands/smart-compact.test.ts"
      - "tests/thread-view/thread-view-materializer.test.ts"
      - "tests/context-steward/capture-service.test.ts"
    reviewScopeSummary: "Reviewed Story 4 against the story spec, the full SQLite persistence tech design, and the test plan; then traced the production smart-compact path from runSmartCompact through SQLite snapshot reads, projection/materialization, metadata persistence, and the new SQLite-focused tests. I also ran the configured story gate (`npm run verify-all`) and an ad-hoc mixed-snapshot repro to validate the compact-read-consistency claim."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-04-001"
        severity: "major"
        title: "Smart compact still re-reads live thread/chunk state after taking the SQLite compact snapshot"
        evidence: "`src/thread-view/services/thread-view-builder.ts:886-990` reads `readCompactSnapshot(...)`, but then hands only `threadId` + `draftView` to `ThreadViewMaterializer`. `src/thread-view/services/thread-view-materializer.ts:691-700` immediately calls `openThread()` and `readChunks()` again, outside the single SQLite read transaction established in `src/thread/store/sqlite-thread-store.ts:1015-1033`. That means selected IDs can come from one snapshot while rendered message/chunk content comes from a later store read. The new SQLite regression test at `tests/commands/smart-compact-sqlite.test.ts:93-123` only appends a brand-new message after the snapshot, so it does not cover mutations to already-selected rows. An ad-hoc repro on 2026-05-26 mutated a selected smooth component after `readCompactSnapshot` and produced `{\"sourceRevision\":8,\"snapshotReadRevision\":8,\"containsPostSnapshotText\":true}`, proving the generated rollout can include post-snapshot content."
        affectedFiles:
          - "src/thread-view/services/thread-view-builder.ts"
          - "src/thread-view/services/thread-view-materializer.ts"
          - "src/thread/store/sqlite-thread-store.ts"
          - "tests/commands/smart-compact-sqlite.test.ts"
        requirementIds:
          - "AC-5.1"
          - "TC-5.1a"
          - "TC-5.1b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    openFindings:
      -
        id: "SV-04-001"
        severity: "major"
        title: "Smart compact still re-reads live thread/chunk state after taking the SQLite compact snapshot"
        evidence: "`src/thread-view/services/thread-view-builder.ts:886-990` reads `readCompactSnapshot(...)`, but then hands only `threadId` + `draftView` to `ThreadViewMaterializer`. `src/thread-view/services/thread-view-materializer.ts:691-700` immediately calls `openThread()` and `readChunks()` again, outside the single SQLite read transaction established in `src/thread/store/sqlite-thread-store.ts:1015-1033`. That means selected IDs can come from one snapshot while rendered message/chunk content comes from a later store read. The new SQLite regression test at `tests/commands/smart-compact-sqlite.test.ts:93-123` only appends a brand-new message after the snapshot, so it does not cover mutations to already-selected rows. An ad-hoc repro on 2026-05-26 mutated a selected smooth component after `readCompactSnapshot` and produced `{\"sourceRevision\":8,\"snapshotReadRevision\":8,\"containsPostSnapshotText\":true}`, proving the generated rollout can include post-snapshot content."
        affectedFiles:
          - "src/thread-view/services/thread-view-builder.ts"
          - "src/thread-view/services/thread-view-materializer.ts"
          - "src/thread/store/sqlite-thread-store.ts"
          - "tests/commands/smart-compact-sqlite.test.ts"
        requirementIds:
          - "AC-5.1"
          - "TC-5.1a"
          - "TC-5.1b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-5.2"
        - "TC-5.2a"
        - "TC-5.2b"
        - "AC-5.3"
        - "TC-5.3a"
        - "TC-5.3b"
        - "AC-5.4"
        - "TC-5.4a"
        - "TC-5.4b"
        - "AC-5.5"
        - "TC-5.5a"
        - "TC-5.5b"
      unverified:
        - "AC-5.1"
        - "TC-5.1a"
        - "TC-5.1b"
    gatesRun:
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "No fake adapter, shim, or placeholder branch was found in the reviewed smart-compact SQLite path; the blocking defect is in real production code where `ThreadViewMaterializer` re-reads live store state after snapshot selection."
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
[]
    additionalObservations:
      - "The configured gate passed, so the blocker is a semantic consistency defect rather than a failing lint/type/test/build gate."
      - "The new SQLite-focused tests do cover source-vs-rollout truth, strict-vs-prepare behavior, and regeneration, but the compact-read-consistency case currently only exercises post-snapshot message append and misses post-snapshot mutations to already-selected turns/chunks."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/004-verify.json"
  startedAt: "2026-05-26T08:28:56.130Z"
  finishedAt: "2026-05-26T08:37:21.206Z"
```
</history_entry>

<history_entry>
```yaml
kind: quick-fix-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/004-quick-fix.json
bytes: 9095
payload:
  command: "quick-fix"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    provider: "codex"
    model: "gpt-5.4"
    rawProviderOutputPreview: |-
      {"type":"thread.started","thread_id":"019e636e-a4b2-7103-87fe-cc3ca74910ee"}
      {"type":"turn.started"}
      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m going to trace the compact snapshot path first so we can fix it at the source, then I’ll add the regression around post-snapshot mutation and run the requested test gates."}}
      {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"rg --files . | rg \\\"(AGENTS\\\\.md|beads-instructions\\\\.md|package\\\\.json|sqlite|compact|snapshot|chunk|rollout|projection)\\\"\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"rg --files . | rg \\\"(AGENTS\\\\.md|beads-instructions\\\\.md|package\\\\.json|sqlite|compact|snapshot|chunk|rollout|projection)\\\"\"","aggregated_output":"./src/thread/store/migrations/0001_sqlite_store_foundation.sql\n./src/thread/store/sqlite-thread-store.ts\n./src/thread/migration/sqlite-thread-migration-service.ts\n./src/thread/async-thread/services/chunk-service.ts\n./src/thread/async-thread/services/lower-band-turn-projection-service.ts\n./src/thread/async-thread/domain/chunk-state.ts\n./AGENTS.md\n./src/commands/smart-compact.ts\n./package.json\n./src/workbench/services/active-rollout-inspection-service.ts\n./src/workbench/services/compaction-report-service.ts\n./src/workbench/services/compaction-report-formatter.ts\n./fixtures/real-pi-session/projections.json\n./fixtures/real-pi-session/chunks.json\n./scripts/run-compact.ts\n./scripts/run-compact-custom.ts\n./scripts/compact-report.ts\n./src/context-steward/store/sqlite-thread-store.ts\n./src/thread-view/services/prompt-visible-tool-result-projection.ts\n./docs/further-chunking-and-brain-dumping-notes.md\n./src/thread-view/targets/pi/active-prompt-projection-writer.ts\n./beads-instructions.md\n./tests/thread/sqlite-readiness-issues.test.ts\n./tests/thread/sqlite-manual-repair.test.ts\n./tests/thread/sqlite-derived-artifacts.test.ts\n./tests/thread/chunk-service.test.ts\n./tests/thread/sqlite-thread-store-compat.test.ts\n./tests/thread/sqlite-token-counts.test.ts\n./tests/thread/sqlite-thread-store.test.ts\n./tests/thread/sqlite-thread-migration.test.ts\n./tests/thread/sqlite-thread-migration-smoke.test.ts\n./tests/thread/sqlite-projection-metadata.test.ts\n./tests/thread/sqlite-maintenance-reporting.test.ts\n./tests/thread/sqlite-migration-test-helpers.ts\n./tests/thread/lower-band-turn-projection-service.test.ts\n./tests/thread/sqlite-maintenance-row-level.test.ts\n./tests/thread/sqlite-fixtures.test.ts\n./tests/thread/helpers/sqlite-maintenance-helpers.ts\n./packages/lh-context/package.json\n./tests/workbench/compaction-report-large-session.test.ts\n./tests/workbench/compaction-report-formatter.test.ts\n./tests/workbench/active-rollout-inspection-service.test.ts\n./tests/workbench/compaction-report-service.test.ts\n./tests/commands/rollout-regeneration-sqlite.test.ts\n./tests/commands/smart-compact-sqlite.test.ts\n./tests/commands/smart-compact.integration.test.ts\n./tests/commands/smart-compact-prepare-sqlite.test.ts\n./tests/commands/smart-compact-lifecycle.integration.test.ts\n./tests/commands/smart-compact.test.ts\n./docs/spec-build/epics/04-smooth-context-quality/stories/04-smart-compact-smooth-component-assembly.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/team-impl-log.md\n./tests/commands/helpers/smart-compact-sqlite-helpers.ts\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread-view.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/epic.md\n./docs/spec-build/epics/06-sqlite-persistence/team-impl-log.md\n./docs/spec-build/epics/06-sqlite-persistence/test-plan.md\n./docs/spec-build/epics/06-sqlite-persistence/current-state-baseline.md\n./docs/spec-build/epics/06-sqlite-persistence/epic.md\n./tests/context-steward/runtime-reopen-sqlite.test.ts\n./tests/context-steward/lhx-sqlite-smoke.test.ts\n./tests/context-steward/attach-import-sqlite.test.ts\n./tests/context-steward/snapshot-sqlite-smoke.test.ts\n./tests/context-steward/pi-extension-sqlite.e2e.test.ts\n./tests/context-steward/runtime-capture-sqlite.test.ts\n./docs/spec-build/epics/05-real-lower-band-compression/stories/01-conversation-only-turn-projection.md\n./docs/spec-build/epics/05-real-lower-band-compression/stories/05-smart-compact-lower-band-readiness.md\n./docs/spec-build/epics/05-real-lower-band-compression/stories/02-chunk-assembly-from-turn-projections.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/01-deterministic-smooth-turns.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/coverage.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/02-deterministic-chunk-lifecycle.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/06-blocked-and-degraded-maintenance-state.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/05-manual-smart-compact-and-pi-reload.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/00-foundation.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/04-deterministic-band-rebuild.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/03-placeholder-lower-fidelity-outputs.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/impl-run.config.json\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design.md\n./docs/spec-build/epics/06-sqlite-persistence/stories/04-smart-compact-snapshot-and-rollout-regeneration.md\n./docs/spec-build/epics/06-sqlite-persistence/stories/00-sqlite-store-foundation.md\n./docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md\n./docs/spec-build/epics/06-sqlite-persistence/stories/05-inspection-reporting-snapshot-export.md\n./docs/spec-build/epics/06-sqlite-persistence/stories/03-derived-maintenance-row-level-adaptation.md\n./docs/spec-build/epics/06-sqlite-persistence/stories/02-whole-store-runtime-compatibility-cutover.md\n./docs/spec-build/epics/06-sqlite-persistence/stories/06-legacy-file-store-retirement.md\n./docs/spec-build/epics/06-sqlite-persistence/stories/01-full-migration-and-entity-coverage.md\n./docs/spec-build/epics/06-sqlite-persistence/impl-run.config.json\n./docs/spec-build/epics/06-sqlite-persistence/tech-design.md\n./tests/thread-view/prompt-visible-tool-result-projection.test.ts\n./tests/thread-view/active-prompt-projection-writer.test.ts\n./packages/lh-context/test/cli/post-compact-report.test.ts\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/preflight/001-preflight.json\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/preflight/006-preflight.json\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/preflight/007-preflight.json\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/preflight/008-preflight.json\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/preflight/002-preflight.json\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/preflight/005-preflight.json\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/preflight/004-preflight.json\n./docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/preflight/003-preflight.json\n./docs/spec-build/epics/06-sqlite-persistence/artifacts/preflight/001-preflight.json\n./docs/spec-build/epics/06-sqlite-persistence/artifacts/preflight/006-preflight.json\n./docs/spec-build/epics/06-sqlite-persistence/artifacts/preflight/002-preflight.json\n./docs/spec-build/epics/06-sqlite-persistence/artifacts/preflight/005-preflight.json\n./docs/spec-build/ep
    rawProviderOutputBytes: 2560200
    rawProviderOutputTruncated: true
    rawProviderOutputLogPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/streams/004-quick-fix.stdout.log"
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/004-quick-fix.json"
  startedAt: "2026-05-26T08:37:35.795Z"
  finishedAt: "2026-05-26T08:43:37.222Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/005-verify.json
bytes: 6431
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "695e671d-d114-432e-9e5a-37e978e10c61"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e6374-5647-7261-a925-b3aa2a8d61a0"
    continuation:
      provider: "codex"
      sessionId: "019e6374-5647-7261-a925-b3aa2a8d61a0"
      storyId: "04-smart-compact-snapshot-and-rollout-regeneration"
    mode: "initial"
    story:
      id: "04-smart-compact-snapshot-and-rollout-regeneration"
      title: "Story 4: Smart Compact Snapshot And Rollout Regeneration"
    artifactsRead:
      - "docs/spec-build/epics/06-sqlite-persistence/stories/04-smart-compact-snapshot-and-rollout-regeneration.md"
      - "docs/spec-build/epics/06-sqlite-persistence/tech-design.md"
      - "docs/spec-build/epics/06-sqlite-persistence/test-plan.md"
      - "docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md"
      - "package.json"
      - "src/commands/smart-compact.ts"
      - "src/thread/store/thread-store.ts"
      - "src/thread/store/sqlite-thread-store.ts"
      - "src/thread/store/file-thread-store.ts"
      - "src/thread/store/mutation-coordinator.ts"
      - "src/thread/services/thread-service.ts"
      - "src/thread/async-thread/services/async-thread-run-service.ts"
      - "src/thread-view/services/thread-view-builder.ts"
      - "src/thread-view/services/thread-view-materializer.ts"
      - "tests/commands/helpers/smart-compact-sqlite-helpers.ts"
      - "tests/commands/smart-compact-sqlite.test.ts"
      - "tests/commands/smart-compact-prepare-sqlite.test.ts"
      - "tests/commands/rollout-regeneration-sqlite.test.ts"
      - "tests/commands/smart-compact.test.ts"
      - "tests/commands/smart-compact.integration.test.ts"
      - "tests/thread-view/thread-view-materializer.test.ts"
      - "tests/thread/sqlite-manual-repair.test.ts"
      - "tests/thread/sqlite-maintenance-reporting.test.ts"
      - "tests/context-steward/runtime-reopen-sqlite.test.ts"
    reviewScopeSummary: "Reviewed Story 4 against the story spec, full SQLite persistence tech design, and test plan; traced the production smart-compact path through readiness, SQLite compact snapshot reads, projection/materialization, generated-output persistence, and regeneration; then ran focused smart-compact suites plus the configured `npm run verify-all` gate."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-04-001"
        severity: "major"
        title: "Smart compact can throw on a live SQLite source revision change before it ever reads the compact snapshot"
        evidence: "`runSmartCompact(...)` still opens the thread and then acquires a revision-pinned mutation lease before projection (`src/commands/smart-compact.ts:333-349`). `FileThreadMutationCoordinator.acquireThreadLease(...)` throws `StaleThreadMutationError` on source-revision drift instead of returning a structured result (`src/thread/store/mutation-coordinator.ts:72-101`). The new projection path only becomes SQLite-snapshot-based after that point (`src/thread-view/services/thread-view-builder.ts:987-991`). In an ad-hoc SQLite repro on 2026-05-26, appending one message after the initial `openThread()` but before lease acquisition caused `runSmartCompact` to throw `STALE_SOURCE_REVISION` rather than re-read current managed state and compact from `readCompactSnapshot(...)`. Because `npm run verify-all` passed, this regression is currently untested by the story gate."
        affectedFiles:
          - "src/commands/smart-compact.ts"
          - "src/thread/store/mutation-coordinator.ts"
          - "tests/commands/smart-compact-sqlite.test.ts"
        requirementIds:
          - "AC-5.1"
          - "TC-5.1b"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "SV-04-001"
        severity: "major"
        title: "Smart compact can throw on a live SQLite source revision change before it ever reads the compact snapshot"
        evidence: "`runSmartCompact(...)` still opens the thread and then acquires a revision-pinned mutation lease before projection (`src/commands/smart-compact.ts:333-349`). `FileThreadMutationCoordinator.acquireThreadLease(...)` throws `StaleThreadMutationError` on source-revision drift instead of returning a structured result (`src/thread/store/mutation-coordinator.ts:72-101`). The new projection path only becomes SQLite-snapshot-based after that point (`src/thread-view/services/thread-view-builder.ts:987-991`). In an ad-hoc SQLite repro on 2026-05-26, appending one message after the initial `openThread()` but before lease acquisition caused `runSmartCompact` to throw `STALE_SOURCE_REVISION` rather than re-read current managed state and compact from `readCompactSnapshot(...)`. Because `npm run verify-all` passed, this regression is currently untested by the story gate."
        affectedFiles:
          - "src/commands/smart-compact.ts"
          - "src/thread/store/mutation-coordinator.ts"
          - "tests/commands/smart-compact-sqlite.test.ts"
        requirementIds:
          - "AC-5.1"
          - "TC-5.1b"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "TC-5.1a"
        - "AC-5.2"
        - "TC-5.2a"
        - "TC-5.2b"
        - "AC-5.3"
        - "TC-5.3a"
        - "TC-5.3b"
        - "AC-5.4"
        - "TC-5.4a"
        - "TC-5.4b"
        - "AC-5.5"
        - "TC-5.5a"
        - "TC-5.5b"
      unverified:
        - "AC-5.1"
        - "TC-5.1b"
    gatesRun:
      -
        command: "node --import tsx --test tests/commands/smart-compact-sqlite.test.ts tests/commands/smart-compact-prepare-sqlite.test.ts tests/commands/rollout-regeneration-sqlite.test.ts"
        result: "pass"
      -
        command: "node --import tsx --test tests/commands/smart-compact.test.ts tests/commands/smart-compact.integration.test.ts"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "No fake adapter, shim, or placeholder production branch was found in the reviewed SQLite smart-compact path. The blocker is in the real runtime flow: `runSmartCompact` can abort on a stale pre-snapshot lease before it uses the intended SQLite snapshot contract."
    recommendedNextStep: "revise"
    recommendedFixScope: "same-session-implementor"
    openQuestions:
[]
    additionalObservations:
      - "`buildThreadViewProjection(...)` now uses `readCompactSnapshot(...)` and passes that snapshot into `ThreadViewMaterializer`, so the earlier post-snapshot re-read risk is not present in the current workspace."
      - "The configured gate is green; the remaining blocker is a semantic concurrency defect rather than a lint/type/test/build failure."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/005-verify.json"
  startedAt: "2026-05-26T08:43:48.915Z"
  finishedAt: "2026-05-26T08:55:06.901Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/story-lead/001-current.json
Bytes: 3048

```yaml
storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
storyId: "04-smart-compact-snapshot-and-rollout-regeneration"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "quick-fix completed with outcome ready-for-verification and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/004-verify.json"
    provenance: "current-run"
  -
    kind: "quick-fix-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/004-quick-fix.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/005-verify.json"
    provenance: "current-run"
  -
    kind: "quick-fix-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/005-quick-fix.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e634a-7588-7eb1-bc25-11d69dfbbb84"
    storyId: "04-smart-compact-snapshot-and-rollout-regeneration"
  storyVerifier:
    provider: "codex"
    sessionId: "019e6374-5647-7261-a925-b3aa2a8d61a0"
    storyId: "04-smart-compact-snapshot-and-rollout-regeneration"
latestEventSequence: 21
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "Latest verifier outcome is revise with one blocking Story 4 finding, SV-04-001. The smallest safe next action is a bounded fix focused on removing the stale pre-snapshot revision-pinned lease failure so SQLite smart compact re-reads/uses the current compact snapshot path instead of throwing before snapshot projection."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/005-quick-fix.json"
replayBoundary: null
updatedAt: "2026-05-26T09:01:12.020Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After this quick-fix returns, require independent verification focused on SV-04-001, AC-5.1/TC-5.1b, and `npm run verify-all`; accept only if verifier outcome is pass with no open findings.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-26T07:58:04.369Z; note="After implementation returns, require verification evidence for targeted Chunk 4 tests and the configured story gate before considering acceptance."
- sequence=8; actionSequence=7; createdAt=2026-05-26T08:28:56.093Z; note="Do not accept Story 4 until an independent verifier reports pass and the configured story gate `npm run verify-all` is pass or its failure is explicitly ruled non-story-blocking by impl-lead/maintainer."
- sequence=12; actionSequence=11; createdAt=2026-05-26T08:37:35.760Z; note="After quick-fix returns, require independent verification focused on SV-04-001 plus AC-5.1/TC-5.1a/TC-5.1b, and do not accept unless verifier outcome is pass and npm run verify-all passes or is explicitly ruled non-story-blocking."
- sequence=16; actionSequence=15; createdAt=2026-05-26T08:43:48.879Z; note="After this verification returns, accept only if verifier outcome is pass, SV-04-001 is fixed, AC-5.1/TC-5.1a/TC-5.1b are verified, and `npm run verify-all` passes or has an explicit non-story-blocking ruling."
- sequence=20; actionSequence=19; createdAt=2026-05-26T08:55:28.163Z; note="After this quick-fix returns, require independent verification focused on SV-04-001, AC-5.1/TC-5.1b, and `npm run verify-all`; accept only if verifier outcome is pass with no open findings."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/story-lead/001-events.jsonl
Bytes: 10689

```yaml
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 1
  timestamp: "2026-05-26T07:57:47.412Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 2
  timestamp: "2026-05-26T07:58:04.346Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e634a-344f-7ed1-a78e-a13d74474eb4"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 3
  timestamp: "2026-05-26T07:58:04.368Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, require verification evidence for targeted Chunk 4 tests and the configured story gate before considering acceptance."
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 4
  timestamp: "2026-05-26T07:58:04.369Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, require verification evidence for targeted Chunk 4 tests and the configured story gate before considering acceptance."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 5
  timestamp: "2026-05-26T08:28:34.459Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome needs-followup-fix and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "needs-followup-fix"
    status: "ok"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 6
  timestamp: "2026-05-26T08:28:56.069Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e6366-6223-7ae0-8072-c7ae682fb8f7"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 7
  timestamp: "2026-05-26T08:28:56.092Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "Do not accept Story 4 until an independent verifier reports pass and the configured story gate `npm run verify-all` is pass or its failure is explicitly ruled non-story-blocking by impl-lead/maintainer."
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 8
  timestamp: "2026-05-26T08:28:56.093Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "Do not accept Story 4 until an independent verifier reports pass and the configured story gate `npm run verify-all` is pass or its failure is explicitly ruled non-story-blocking by impl-lead/maintainer."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 9
  timestamp: "2026-05-26T08:37:21.215Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/004-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 10
  timestamp: "2026-05-26T08:37:35.717Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/story-lead/prompts/001-planner-turn-003.md"
    sessionId: "019e636e-6bc7-70a0-8a85-df3169c6c2d1"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 11
  timestamp: "2026-05-26T08:37:35.759Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-quick-fix."
  data:
    actionType: "run-quick-fix"
    turn: 3
    selfNote: "After quick-fix returns, require independent verification focused on SV-04-001 plus AC-5.1/TC-5.1a/TC-5.1b, and do not accept unless verifier outcome is pass and npm run verify-all passes or is explicitly ruled non-story-blocking."
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 12
  timestamp: "2026-05-26T08:37:35.760Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After quick-fix returns, require independent verification focused on SV-04-001 plus AC-5.1/TC-5.1a/TC-5.1b, and do not accept unless verifier outcome is pass and npm run verify-all passes or is explicitly ruled non-story-blocking."
    actionSequence: 11
    actionType: "run-quick-fix"
    turn: 3
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 13
  timestamp: "2026-05-26T08:43:37.231Z"
  type: "child-operation-completed"
  summary: "quick-fix completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/004-quick-fix.json"
  data:
    actionType: "run-quick-fix"
    command: "quick-fix"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 14
  timestamp: "2026-05-26T08:43:48.859Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/story-lead/prompts/001-planner-turn-004.md"
    sessionId: "019e6374-2896-7cf2-a9ac-fab465c177b2"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 15
  timestamp: "2026-05-26T08:43:48.878Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 4
    selfNote: "After this verification returns, accept only if verifier outcome is pass, SV-04-001 is fixed, AC-5.1/TC-5.1a/TC-5.1b are verified, and `npm run verify-all` passes or has an explicit non-story-blocking ruling."
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 16
  timestamp: "2026-05-26T08:43:48.879Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After this verification returns, accept only if verifier outcome is pass, SV-04-001 is fixed, AC-5.1/TC-5.1a/TC-5.1b are verified, and `npm run verify-all` passes or has an explicit non-story-blocking ruling."
    actionSequence: 15
    actionType: "run-verify"
    turn: 4
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 17
  timestamp: "2026-05-26T08:55:06.909Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/005-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 18
  timestamp: "2026-05-26T08:55:28.145Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/04-smart-compact-snapshot-and-rollout-regeneration/story-lead/prompts/001-planner-turn-005.md"
    sessionId: "019e637e-aebc-7a90-8e73-2b52dc54efae"
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 19
  timestamp: "2026-05-26T08:55:28.163Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-quick-fix."
  data:
    actionType: "run-quick-fix"
    turn: 5
    selfNote: "After this quick-fix returns, require independent verification focused on SV-04-001, AC-5.1/TC-5.1b, and `npm run verify-all`; accept only if verifier outcome is pass with no open findings."
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 20
  timestamp: "2026-05-26T08:55:28.163Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After this quick-fix returns, require independent verification focused on SV-04-001, AC-5.1/TC-5.1b, and `npm run verify-all`; accept only if verifier outcome is pass with no open findings."
    actionSequence: 19
    actionType: "run-quick-fix"
    turn: 5
-
  storyRunId: "04-smart-compact-snapshot-and-rollout-regeneration-story-run-001"
  sequence: 21
  timestamp: "2026-05-26T09:01:12.020Z"
  type: "child-operation-completed"
  summary: "quick-fix completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/005-quick-fix.json"
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
