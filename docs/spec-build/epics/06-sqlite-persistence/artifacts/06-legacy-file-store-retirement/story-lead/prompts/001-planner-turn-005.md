# Story Lead Base Prompt

## Role Charter
You are the story lead for `06-legacy-file-store-retirement` on durable story run `06-legacy-file-store-retirement-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 5.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/06-legacy-file-store-retirement.md
Bytes: 7892

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
- planner_turn_index: 5
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-verify completed with outcome revise and status ok.
- latest_response_kind: verifier-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/005-verify.json
- older_response_count: 3
- caller_input_artifact_count: 0
- prior_self_note_count: 4
- latest_self_note: "If verifier passes with no open findings and npm run verify-all is clean, the next planner turn may accept-story and recommend impl-lead acceptance. If gate truth is still contradictory, do not accept; block or request a ruling depending on verifier evidence."

## Response Trail
<current_response>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/005-verify.json
bytes: 7855
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "1f71e1b3-cb47-4401-ba82-c2e383ff72e5"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e63ce-b7c5-7041-9575-fecb7bb904e9"
    continuation:
      provider: "codex"
      sessionId: "019e63ce-b7c5-7041-9575-fecb7bb904e9"
      storyId: "06-legacy-file-store-retirement"
    mode: "initial"
    story:
      id: "06-legacy-file-store-retirement"
      title: "Story 6: Legacy File-Store Retirement And Compatibility Cleanup"
    artifactsRead:
      - "docs/spec-build/epics/06-sqlite-persistence/stories/06-legacy-file-store-retirement.md"
      - "docs/spec-build/epics/06-sqlite-persistence/tech-design.md"
      - "docs/spec-build/epics/06-sqlite-persistence/test-plan.md"
      - "docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md"
      - "docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/003-implementor.json"
      - "packages/lh-context/src/core/io.ts"
      - "packages/lh-context/src/core/inspectors.ts"
      - "packages/lh-context/src/core/reports.ts"
      - "packages/lh-context/src/output/format.ts"
      - "packages/lh-context/src/types/public.ts"
      - "packages/lh-context/test/output/format.test.ts"
      - "src/thread/store/thread-store.ts"
      - "src/thread/store/sqlite-thread-store.ts"
      - "src/thread/services/turn-service.ts"
      - "src/thread/services/repair-service.ts"
      - "src/thread/async-thread/services/async-thread-run-service.ts"
      - "src/thread/async-thread/services/user-prompt-smoothing-service.ts"
      - "src/context-steward/pi/pi-extension.ts"
      - "src/commands/smart-compact.ts"
      - "src/thread-view/services/thread-view-builder.ts"
      - "src/context-steward/services/snapshot-export-service.ts"
      - "tests/context-steward/legacy-compat-sqlite.test.ts"
      - "tests/context-steward/legacy-source-truth-guard.test.ts"
      - "tests/context-steward/runtime-capture-sqlite.test.ts"
      - "tests/context-steward/attach-import-sqlite.test.ts"
      - "tests/context-steward/snapshot-sqlite-smoke.test.ts"
      - "tests/context-steward/capture-service.test.ts"
      - "tests/context-steward/pi-smoothing-lifecycle.integration.test.ts"
      - "/tmp/pi-long-horizon-story6-verifier.log"
    reviewScopeSummary: "Verified Story 6 against the story, tech design, and test plan; inspected the lh-context backing-selection/reporting changes plus active post-cutover runtime, maintenance, compact, snapshot, and compatibility paths; and ran the full `npm run verify-all` gate."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "story6-user-prompt-smoothing-compat-write"
        severity: "major"
        title: "Active user-prompt smoothing still writes through the whole-array turn compatibility surface after cutover"
        evidence: "`src/context-steward/pi/pi-extension.ts:1988-2004` wires `UserPromptSmoothingService` into live user `message_end` handling and `src/context-steward/pi/pi-extension.ts:2210-2248` schedules it for non-duplicate runtime captures. The persistence path in `src/thread/async-thread/services/user-prompt-smoothing-service.ts:233-271` still calls `input.store.writeTurns(...)` even though row-level turn writes are available in `src/thread/store/thread-store.ts:134-135` and implemented by SQLite in `src/thread/store/sqlite-thread-store.ts:1593-1668`; the compatibility path at `src/thread/store/sqlite-thread-store.ts:1464-1505` still depends on whole-thread `turnsRevision` matching. Story 6’s new guard does not inspect this active runtime file (`tests/context-steward/legacy-source-truth-guard.test.ts:6-14`), and the lifecycle regression still injects `FileThreadStore` instead of SQLite (`tests/context-steward/pi-smoothing-lifecycle.integration.test.ts:126-147`), so the remaining post-cutover compatibility write is neither retired nor covered by SQLite regression proof."
        affectedFiles:
          - "src/context-steward/pi/pi-extension.ts"
          - "src/thread/async-thread/services/user-prompt-smoothing-service.ts"
          - "src/thread/store/thread-store.ts"
          - "src/thread/store/sqlite-thread-store.ts"
          - "tests/context-steward/legacy-source-truth-guard.test.ts"
          - "tests/context-steward/pi-smoothing-lifecycle.integration.test.ts"
        requirementIds:
          - "Scope-In-2 (remove or quarantine whole-array compatibility usage from active high-contention paths where row-level methods exist)"
          - "DoD-3 (compatibility method usage is retired, guarded, or labeled)"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "story6-user-prompt-smoothing-compat-write"
        severity: "major"
        title: "Active user-prompt smoothing still writes through the whole-array turn compatibility surface after cutover"
        evidence: "`src/context-steward/pi/pi-extension.ts:1988-2004` wires `UserPromptSmoothingService` into live user `message_end` handling and `src/context-steward/pi/pi-extension.ts:2210-2248` schedules it for non-duplicate runtime captures. The persistence path in `src/thread/async-thread/services/user-prompt-smoothing-service.ts:233-271` still calls `input.store.writeTurns(...)` even though row-level turn writes are available in `src/thread/store/thread-store.ts:134-135` and implemented by SQLite in `src/thread/store/sqlite-thread-store.ts:1593-1668`; the compatibility path at `src/thread/store/sqlite-thread-store.ts:1464-1505` still depends on whole-thread `turnsRevision` matching. Story 6’s new guard does not inspect this active runtime file (`tests/context-steward/legacy-source-truth-guard.test.ts:6-14`), and the lifecycle regression still injects `FileThreadStore` instead of SQLite (`tests/context-steward/pi-smoothing-lifecycle.integration.test.ts:126-147`), so the remaining post-cutover compatibility write is neither retired nor covered by SQLite regression proof."
        affectedFiles:
          - "src/context-steward/pi/pi-extension.ts"
          - "src/thread/async-thread/services/user-prompt-smoothing-service.ts"
          - "src/thread/store/thread-store.ts"
          - "src/thread/store/sqlite-thread-store.ts"
          - "tests/context-steward/legacy-source-truth-guard.test.ts"
          - "tests/context-steward/pi-smoothing-lifecycle.integration.test.ts"
        requirementIds:
          - "Scope-In-2 (remove or quarantine whole-array compatibility usage from active high-contention paths where row-level methods exist)"
          - "DoD-3 (compatibility method usage is retired, guarded, or labeled)"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-7.3"
        - "TC-7.3a"
        - "AC-7.4"
        - "TC-7.4a"
        - "AC-7.5"
        - "TC-7.5a"
      unverified:
        - "Scope-In-2 (remove or quarantine whole-array compatibility usage from active high-contention paths where row-level methods exist)"
        - "DoD-3 (compatibility method usage is retired, guarded, or labeled)"
    gatesRun:
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "Post-cutover user `message_end` smoothing is still a real runtime compatibility-write path (`src/thread/async-thread/services/user-prompt-smoothing-service.ts:233-271`) instead of a retired or quarantined legacy surface."
    recommendedNextStep: "revise"
    recommendedFixScope: "same-session-implementor"
    openQuestions:
[]
    additionalObservations:
      - "`npm run verify-all` passed from a clean verifier run (`/tmp/pi-long-horizon-story6-verifier.log`)."
      - "The split-brain/file-authority AC evidence itself is strong: runtime capture, attach/import, fixture export, snapshot/export, and Story 6 compatibility tests all keep live managed thread directories `thread.sqlite`-only while legacy fixture/debug outputs remain explicit."
      - "The lh-context changes do satisfy the operator-visibility part of Story 6: summary/readiness/tokens/bands/post-compact report outputs now surface the selected backing and dual-source warnings when legacy JSON shadows a live SQLite thread."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/005-verify.json"
  startedAt: "2026-05-26T10:22:31.982Z"
  finishedAt: "2026-05-26T10:32:28.966Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/003-implementor.json
bytes: 4076
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "4bf4b472-3133-4768-b788-c5943e42dfc7"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e63b0-4ada-7be2-b055-6cdad9b834bc"
    continuation:
      provider: "codex"
      sessionId: "019e63b0-4ada-7be2-b055-6cdad9b834bc"
      storyId: "06-legacy-file-store-retirement"
    outcome: "ready-for-verification"
    story:
      id: "06-legacy-file-store-retirement"
      title: "Story 6: Legacy File-Store Retirement And Compatibility Cleanup"
    planSummary: "Hardened lh-context inspection so mixed legacy-JSON plus SQLite thread directories now prefer SQLite as authoritative, surface the selected backing in inspection/report outputs, and warn operators how to clean up split-brain risk; added Story 6 regressions for dual-source inspection and a source-truth grep guard over active runtime/maintenance/compact paths."
    changedFiles:
      -
        path: "packages/lh-context/src/core/io.ts"
        reason: "Changed inspection loading to prefer SQLite in auto mode when both backings exist, avoid silent fallback to legacy JSON, and emit explicit dual-source cleanup warnings."
      -
        path: "packages/lh-context/src/core/inspectors.ts"
        reason: "Surfaced the selected backing on summary, tokens, bands, and readiness inspection results."
      -
        path: "packages/lh-context/src/core/reports.ts"
        reason: "Propagated backing metadata into post-compact report output."
      -
        path: "packages/lh-context/src/output/format.ts"
        reason: "Added backing lines to human-readable lh-context inspection/report output so operators can see source truth directly."
      -
        path: "packages/lh-context/src/types/public.ts"
        reason: "Extended public inspection/report result types with backing metadata."
      -
        path: "packages/lh-context/test/output/format.test.ts"
        reason: "Updated formatter fixtures for the new backing field."
      -
        path: "tests/context-steward/legacy-compat-sqlite.test.ts"
        reason: "Added Story 6 regression coverage proving inspection prefers SQLite and warns explicitly when stale legacy JSON shadows a live managed thread."
      -
        path: "tests/context-steward/legacy-source-truth-guard.test.ts"
        reason: "Added the root smoke/grep guard that blocks legacy managed JSON references in active runtime, maintenance, and compact entry paths."
    tests:
      added:
        - "tests/context-steward/legacy-source-truth-guard.test.ts"
      modified:
        - "packages/lh-context/test/output/format.test.ts"
        - "tests/context-steward/legacy-compat-sqlite.test.ts"
      removed:
[]
      totalAfterStory: 644
      deltaFromPriorBaseline: 1
    gatesRun:
      -
        command: "node --import tsx --test tests/context-steward/legacy-compat-sqlite.test.ts tests/context-steward/legacy-source-truth-guard.test.ts"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context run typecheck"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context test"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Inspection no longer silently trusts legacy thread JSON when a live thread directory also contains thread.sqlite; auto mode now treats SQLite as authoritative and warns with cleanup guidance."
        - "Inspection/report payloads and human output now identify the selected backing explicitly so rollback/source-truth state is inspectable by operators."
        - "Added executable guardrails for Story 6 by covering dual-source inspection behavior and asserting active runtime/maintenance/compact files do not hard-code legacy managed JSON sources."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Hand this to verification for Story 6 acceptance, with focus on AC-7.4/7.5 evidence from the new dual-source inspection regression and the active-path legacy-source guard."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/003-implementor.json"
  startedAt: "2026-05-26T09:49:18.144Z"
  finishedAt: "2026-05-26T09:59:12.139Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/004-verify.json
bytes: 8908
payload:
  command: "story-verify"
  version: 1
  status: "blocked"
  outcome: "block"
  result:
    resultId: "b73e77c5-4e9a-4e03-9bc5-68dccc850f34"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e63b9-8492-7122-98be-efc1e0ee91ac"
    continuation:
      provider: "codex"
      sessionId: "019e63b9-8492-7122-98be-efc1e0ee91ac"
      storyId: "06-legacy-file-store-retirement"
    mode: "initial"
    story:
      id: "06-legacy-file-store-retirement"
      title: "Story 6: Legacy File-Store Retirement And Compatibility Cleanup"
    artifactsRead:
      - "docs/spec-build/epics/06-sqlite-persistence/stories/06-legacy-file-store-retirement.md"
      - "docs/spec-build/epics/06-sqlite-persistence/tech-design.md"
      - "docs/spec-build/epics/06-sqlite-persistence/test-plan.md"
      - "docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/001-story-validate.json"
      - "docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/003-implementor.json"
      - "packages/lh-context/src/core/io.ts"
      - "packages/lh-context/src/core/inspectors.ts"
      - "packages/lh-context/src/core/reports.ts"
      - "packages/lh-context/src/output/format.ts"
      - "packages/lh-context/src/types/public.ts"
      - "src/context-steward/pi/pi-extension.ts"
      - "src/context-steward/services/fixture-service.ts"
      - "src/context-steward/services/snapshot-export-service.ts"
      - "src/thread/services/capture-service.ts"
      - "src/thread/services/turn-service.ts"
      - "src/thread/services/repair-service.ts"
      - "src/thread/store/thread-store.ts"
      - "src/thread/store/sqlite-thread-store.ts"
      - "tests/context-steward/legacy-compat-sqlite.test.ts"
      - "tests/context-steward/legacy-source-truth-guard.test.ts"
      - "tests/context-steward/runtime-capture-sqlite.test.ts"
      - "tests/context-steward/runtime-reopen-sqlite.test.ts"
      - "tests/context-steward/snapshot-sqlite-smoke.test.ts"
      - "tests/context-steward/legacy-export-sqlite.test.ts"
      - "tests/context-steward/e2e-cli.e2e.test.ts"
      - "tests/commands/smart-compact-sqlite.test.ts"
      - "/tmp/story6-verify-all.log"
    reviewScopeSummary: "Reviewed Story 6 retirement work across lh-context backing selection/output, explicit legacy fixture/export support, the new legacy-source guard test, and remaining active runtime turn-persistence paths; then cross-checked AC/TC expectations against code and tests and ran the configured root gate plus package-local lh-context checks."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "S6-compat-writeTurns"
        severity: "major"
        title: "Active turn lifecycle and repair paths still rely on whole-array compatibility writes, and the new guard does not cover them"
        evidence: "`tests/context-steward/legacy-source-truth-guard.test.ts:6-11` only scans `pi-extension.ts`, `async-thread-run-service.ts`, `thread-maintenance-repair-service.ts`, and `thread-view-builder.ts`. But `pi-extension.ts:531-535, 1035-1039, 2129` routes live capture, `/lh-repair-turns`, and `turn_end` through `writeCapturedMessageTurns`, `repairTurnState`, and `finalizeOpenTurnOnTurnEnd`; those services still call `input.store.writeTurns(...)` in `src/thread/services/turn-service.ts:296-303,361-368` and `src/thread/services/repair-service.ts:173-180`. The row-level alternative already exists on the store interface at `src/thread/store/thread-store.ts:134-135`, so Story 6 has not retired/quarantined whole-array compatibility writes from active post-cutover turn paths, and TC-7.4a proof does not cover the repair/turn-lifecycle surfaces it names."
        affectedFiles:
          - "tests/context-steward/legacy-source-truth-guard.test.ts"
          - "src/context-steward/pi/pi-extension.ts"
          - "src/thread/services/capture-service.ts"
          - "src/thread/services/turn-service.ts"
          - "src/thread/services/repair-service.ts"
          - "src/thread/store/thread-store.ts"
        requirementIds:
          - "AC-7.4"
          - "TC-7.4a"
          - "DoD-CompatibilityMethodUsage"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "S6-gate-verify-all"
        severity: "major"
        title: "The configured story gate produced contradictory outcomes, so readiness cannot be established from a trusted gate result"
        evidence: "One direct `npm run verify-all` run completed green in this verification session, but a second rerun logged to `/tmp/story6-verify-all.log` failed inside `tests/context-steward/e2e-cli.e2e.test.ts:333-359` (`e2e: path stability across /tmp symlink`). The log shows `assertPiCleanExit` tripping on PI exit code 124 and cancelling the three child assertions in that suite. Because the required gate yielded both pass and fail outcomes during the same verification pass, gate truth is not trustworthy enough for handoff."
        affectedFiles:
          - "tests/context-steward/e2e-cli.e2e.test.ts"
        requirementIds:
          - "StoryGate"
          - "EpicGate"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    openFindings:
      -
        id: "S6-compat-writeTurns"
        severity: "major"
        title: "Active turn lifecycle and repair paths still rely on whole-array compatibility writes, and the new guard does not cover them"
        evidence: "`tests/context-steward/legacy-source-truth-guard.test.ts:6-11` only scans `pi-extension.ts`, `async-thread-run-service.ts`, `thread-maintenance-repair-service.ts`, and `thread-view-builder.ts`. But `pi-extension.ts:531-535, 1035-1039, 2129` routes live capture, `/lh-repair-turns`, and `turn_end` through `writeCapturedMessageTurns`, `repairTurnState`, and `finalizeOpenTurnOnTurnEnd`; those services still call `input.store.writeTurns(...)` in `src/thread/services/turn-service.ts:296-303,361-368` and `src/thread/services/repair-service.ts:173-180`. The row-level alternative already exists on the store interface at `src/thread/store/thread-store.ts:134-135`, so Story 6 has not retired/quarantined whole-array compatibility writes from active post-cutover turn paths, and TC-7.4a proof does not cover the repair/turn-lifecycle surfaces it names."
        affectedFiles:
          - "tests/context-steward/legacy-source-truth-guard.test.ts"
          - "src/context-steward/pi/pi-extension.ts"
          - "src/thread/services/capture-service.ts"
          - "src/thread/services/turn-service.ts"
          - "src/thread/services/repair-service.ts"
          - "src/thread/store/thread-store.ts"
        requirementIds:
          - "AC-7.4"
          - "TC-7.4a"
          - "DoD-CompatibilityMethodUsage"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "S6-gate-verify-all"
        severity: "major"
        title: "The configured story gate produced contradictory outcomes, so readiness cannot be established from a trusted gate result"
        evidence: "One direct `npm run verify-all` run completed green in this verification session, but a second rerun logged to `/tmp/story6-verify-all.log` failed inside `tests/context-steward/e2e-cli.e2e.test.ts:333-359` (`e2e: path stability across /tmp symlink`). The log shows `assertPiCleanExit` tripping on PI exit code 124 and cancelling the three child assertions in that suite. Because the required gate yielded both pass and fail outcomes during the same verification pass, gate truth is not trustworthy enough for handoff."
        affectedFiles:
          - "tests/context-steward/e2e-cli.e2e.test.ts"
        requirementIds:
          - "StoryGate"
          - "EpicGate"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-7.3"
        - "TC-7.3a"
        - "AC-7.5"
        - "TC-7.5a"
      unverified:
        - "AC-7.4"
        - "TC-7.4a"
        - "DoD-CompatibilityMethodUsage"
    gatesRun:
      -
        command: "npm run verify-all (run 1)"
        result: "pass"
      -
        command: "npm run verify-all (run 2; log: /tmp/story6-verify-all.log)"
        result: "fail"
      -
        command: "npm --prefix packages/lh-context run typecheck"
        result: "pass"
      -
        command: "npm --prefix packages/lh-context test"
        result: "pass"
    productionPathFindings:
      - "Live capture, `turn_end` finalization, and `/lh-repair-turns` still depend on `writeTurns` compatibility writes instead of row-level turn writes, so whole-array compatibility remains on active post-cutover turn paths."
    recommendedNextStep: "block"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
      - "Was the failing `npm run verify-all` rerun hitting a reproducible path-stability regression or an environmental timeout flake? A clean isolated rerun is needed because the required gate produced both pass and fail outcomes."
    additionalObservations:
      - "`packages/lh-context` now does the Story 6 inspection work expected for AC-7.5: auto mode prefers `thread.sqlite` when both backings exist, emits explicit dual-source warnings, and surfaces the selected backing in summary/tokens/bands/readiness/report outputs."
      - "Explicit legacy compatibility remains constrained to allowed surfaces: snapshot export labels legacy JSON artifacts as `non_authoritative_legacy_export`, and fixture creation still routes PI-session imports through a temporary `FileThreadStore` rather than the live SQLite thread directory."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/004-verify.json"
  startedAt: "2026-05-26T09:59:22.747Z"
  finishedAt: "2026-05-26T10:10:28.174Z"
```
</history_entry>

<history_entry>
```yaml
kind: quick-fix-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/007-quick-fix.json
bytes: 9256
payload:
  command: "quick-fix"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    provider: "codex"
    model: "gpt-5.4"
    rawProviderOutputPreview: |-
      {"type":"thread.started","thread_id":"019e63c3-f01e-7e11-895f-63d089e8c74d"}
      {"type":"turn.started"}
      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m picking up the turn-lifecycle write path cleanup, then I’ll trace the active `writeTurns` call sites and map them against the existing row-level turn APIs before touching code."}}
      {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'bd ready'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'bd ready'","aggregated_output":"○ pi-long-horizon-611 ● P1 Smart compact progress feedback\n○ pi-long-horizon-xxh ● P2 Decide lh-context package/repo publish wiring\n○ pi-long-horizon-z9d ● P2 Maintain focused E2E coverage for smart compact/lower-band\n○ pi-long-horizon-9yd ● P2 Ensure lower-band artifact provenance\n○ pi-long-horizon-cuo ● P2 Support manual smooth/projection curation with provenance\n○ pi-long-horizon-lbv ● P2 Add live-tail/current-active-context accounting\n○ pi-long-horizon-bun ● P3 [bug] Investigate capture append STORE_UNAVAILABLE failures\n○ pi-long-horizon-z05 ● P3 Explore LLM/Keeper Wiki durable knowledge layer\n○ pi-long-horizon-ec3 ● P3 Fold Liminal Spec process notes into skills/tools\n○ pi-long-horizon-cvv ● P3 Refine prompt-visible tool-result truncation policy\n○ pi-long-horizon-t7e ● P3 Define projection/session edit hygiene\n○ pi-long-horizon-8km ● P3 Format surfaced warnings cleanly\n○ pi-long-horizon-ee1 ● P4 Clarify band percentage terminology\n\n--------------------------------------------------------------------------------\nReady: 13 issues with no active blockers\n\nStatus: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred\n","exit_code":0,"status":"completed"}}
      {"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"I’ve got the ready queue; next I’m matching your requested write-path and source-truth guard work to the right Beads item so I can claim the exact scope before editing."}}
      {"type":"item.started","item":{"id":"item_3","type":"command_execution","command":"/bin/zsh -lc 'bd search \"writeTurns post-cutover source-truth guard Story 6\"'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"/bin/zsh -lc 'bd search \"writeTurns post-cutover source-truth guard Story 6\"'","aggregated_output":"No issues found matching 'writeTurns post-cutover source-truth guard Story 6'\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_4","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_4","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"AGENTS.md\nCLAUDE.md\nREADME.md\nbeads-instructions.md\ndocs\nfixtures\nnode_modules\npackage-lock.json\npackage.json\npackages\npi-session-2026-05-11T23-26-49-660Z_019e195d-5d3c-71e3-a76a-7abb5387657f.html\nrepo-ref\nscripts\nsrc\ntests\ntsconfig.json\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_5","type":"command_execution","command":"/bin/zsh -lc 'rg -n \"writeTurns|source-truth|Story 6|path-stability|legacy\" -S .'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_5","type":"command_execution","command":"/bin/zsh -lc 'rg -n \"writeTurns|source-truth|Story 6|path-stability|legacy\" -S .'","aggregated_output":"./src/thread/store/file-thread-store.ts:565:  async writeTurns(input: WriteTurnsInput): Promise<StewardResult<TurnRecord[]>> {\n./src/thread/store/thread-store.ts:130:  writeTurns(input: WriteTurnsInput): Promise<StewardResult<TurnRecord[]>>;\n./src/thread/store/sqlite-thread-store.ts:1464:  async writeTurns(input: WriteTurnsInput): Promise<StewardResult<TurnRecord[]>> {\n./src/thread/store/sqlite-thread-store.ts:1513:        return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, \"writeTurns\", input.threadId));\n./src/thread/services/repair-service.ts:173:    const writeResult = await input.store.writeTurns({\n./src/thread/services/turn-service.ts:296:  const writtenTurns = await input.store.writeTurns({\n./src/thread/services/turn-service.ts:361:  const writtenTurns = await input.store.writeTurns({\n./src/thread/services/import-service.ts:216:    const writtenTurns = await input.store.writeTurns({\n./src/thread/async-thread/services/async-thread-run-service.ts:359:          message: `Chunk ${chunk.chunkId} is legacy placeholder-era lower-band state and cannot be selected for lower-band output.`,\n./src/thread/async-thread/services/async-thread-run-service.ts:361:          cause: \"legacy_placeholder_chunk_state\",\n./src/thread/async-thread/services/async-thread-run-service.ts:1525:  let writeTurnsMs = 0;\n./src/thread/async-thread/services/async-thread-run-service.ts:1681:    const writeTurnsResult = dependencies.store.writeTurnRows\n./src/thread/async-thread/services/async-thread-run-service.ts:1690:      : await dependencies.store.writeTurns({\n./src/thread/async-thread/services/async-thread-run-service.ts:1698:    writeTurnsMs = Date.now() - stepStartedAt;\n./src/thread/async-thread/services/async-thread-run-service.ts:1699:    if (!writeTurnsResult.ok) {\n./src/thread/async-thread/services/async-thread-run-service.ts:1700:      result = \"writeTurnsFailed\";\n./src/thread/async-thread/services/async-thread-run-service.ts:1705:        writeTurnsMs,\n./src/thread/async-thread/services/async-thread-run-service.ts:1710:      return writeTurnsResult.issues;\n./src/thread/async-thread/services/async-thread-run-service.ts:1723:      writeTurnsMs,\n./src/thread/async-thread/services/async-thread-run-service.ts:1741:      writeTurnsMs,\n./src/thread/async-thread/services/async-thread-run-service.ts:1868:      writeTurnsMs,\n./src/thread/async-thread/services/async-thread-run-service.ts:1895:      writeTurnsMs,\n./src/thread/async-thread/services/async-thread-run-service.ts:1934:    writeTurnsMs,\n./src/thread/async-thread/services/async-thread-run-service.ts:2051:    const writeTurnsResult = dependencies.store.writeTurnRows\n./src/thread/async-thread/services/async-thread-run-service.ts:2060:      : await dependencies.store.writeTurns({\n./src/thread/async-thread/services/async-thread-run-service.ts:2069:    result = writeTurnsResult.ok ? \"updated\" : \"writeFailed\";\n./src/thread/async-thread/services/async-thread-run-service.ts:2070:    if (writeTurnsResult.ok) {\n./src/thread/async-thread/services/async-thread-run-service.ts:2083:    lastIssues = writeTurnsResult.issues;\n./src/thread/async-thread/services/async-thread-run-service.ts:2084:    if (!writeTurnsResult.issues.some(isRetryableThreadMutationIssue)) {\n./src/thread/async-thread/services/async-thread-run-service.ts:2299:        detail: \"legacy_placeholder_state\",\n./src/thread/async-thread/services/smooth-turn-service.ts:722:    : await store.writeTurns({\n./src/thread/async-thread/services/user-prompt-smoothing-service.ts:264:      const writeResult = await input.store.writeTurns({\n./src/thread/async-thread/services/lower-band-turn-projection-service.ts:379:    : await store.writeTurns({\n./src/thread/async-thread/services/lower-band-compression-service.ts:451:          cause: \"legacy_chunk_state\",\n./src/thread/async-thread/services/lower-band-compression-service.ts:452:          message: `Chunk ${input.chunkId} is still using legacy placeholder state and cannot persist semantic lower-band artifacts.`,\n./src/thread/async-thread/services/lower-band-compression-service.ts:571:            cause: \"legacy_chunk_state\",\n./src/thread/async-thread/services/lower-band-compression-service.ts:572:            message: `Chunk ${input.chunkId} is still using legacy placeholder state and cannot generate semantic lower-band artifacts.`,\n./src/thread-view/services/thread-view-builder.ts:477:          message: `Chunk ${
    rawProviderOutputBytes: 1444155
    rawProviderOutputTruncated: true
    rawProviderOutputLogPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/streams/007-quick-fix.stdout.log"
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/007-quick-fix.json"
  startedAt: "2026-05-26T10:10:45.668Z"
  finishedAt: "2026-05-26T10:22:22.153Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/story-lead/001-current.json
Bytes: 2651

```yaml
storyRunId: "06-legacy-file-store-retirement-story-run-001"
storyId: "06-legacy-file-store-retirement"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-verify completed with outcome revise and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/004-verify.json"
    provenance: "current-run"
  -
    kind: "quick-fix-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/007-quick-fix.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/005-verify.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e63b0-4ada-7be2-b055-6cdad9b834bc"
    storyId: "06-legacy-file-store-retirement"
  storyVerifier:
    provider: "codex"
    sessionId: "019e63ce-b7c5-7041-9575-fecb7bb904e9"
    storyId: "06-legacy-file-store-retirement"
latestEventSequence: 17
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "The quick-fix completed ready-for-verification after the prior verifier blocked AC-7.4/TC-7.4a and gate trust. The smallest safe next action is to send the quick-fix back to verification, focused on the resolved findings and a clean configured story gate before any acceptance decision."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/005-verify.json"
replayBoundary: null
updatedAt: "2026-05-26T10:32:28.975Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: If verifier passes with no open findings and npm run verify-all is clean, the next planner turn may accept-story and recommend impl-lead acceptance. If gate truth is still contradictory, do not accept; block or request a ruling depending on verifier evidence.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-26T09:49:18.108Z; note="After implementation returns, verify evidence must prove active runtime/default paths no longer mutate legacy managed JSON source files while explicit legacy import/export/fixture paths remain supported."
- sequence=8; actionSequence=7; createdAt=2026-05-26T09:59:22.712Z; note="If verifier passes with no open findings, next planner turn can accept-story and recommend impl-lead acceptance; if verifier finds source-truth guard gaps, route a bounded quick-fix."
- sequence=12; actionSequence=11; createdAt=2026-05-26T10:10:45.633Z; note="After quick-fix returns, require verifier to re-check AC-7.4/TC-7.4a, DoD compatibility-method cleanup, the expanded guard coverage, and a clean story gate before considering accept-story."
- sequence=16; actionSequence=15; createdAt=2026-05-26T10:22:31.947Z; note="If verifier passes with no open findings and npm run verify-all is clean, the next planner turn may accept-story and recommend impl-lead acceptance. If gate truth is still contradictory, do not accept; block or request a ruling depending on verifier evidence."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/story-lead/001-events.jsonl
Bytes: 8271

```yaml
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 1
  timestamp: "2026-05-26T09:49:02.452Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 2
  timestamp: "2026-05-26T09:49:18.067Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e63b0-0d89-7d32-8276-84fd87bfa195"
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 3
  timestamp: "2026-05-26T09:49:18.107Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, verify evidence must prove active runtime/default paths no longer mutate legacy managed JSON source files while explicit legacy import/export/fixture paths remain supported."
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 4
  timestamp: "2026-05-26T09:49:18.108Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, verify evidence must prove active runtime/default paths no longer mutate legacy managed JSON source files while explicit legacy import/export/fixture paths remain supported."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 5
  timestamp: "2026-05-26T09:59:12.148Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 6
  timestamp: "2026-05-26T09:59:22.690Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e63b9-5b21-7013-a047-d9e7ab13d0b5"
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 7
  timestamp: "2026-05-26T09:59:22.711Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "If verifier passes with no open findings, next planner turn can accept-story and recommend impl-lead acceptance; if verifier finds source-truth guard gaps, route a bounded quick-fix."
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 8
  timestamp: "2026-05-26T09:59:22.712Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "If verifier passes with no open findings, next planner turn can accept-story and recommend impl-lead acceptance; if verifier finds source-truth guard gaps, route a bounded quick-fix."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 9
  timestamp: "2026-05-26T10:10:28.182Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome block and status blocked."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/004-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "block"
    status: "blocked"
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 10
  timestamp: "2026-05-26T10:10:45.608Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/story-lead/prompts/001-planner-turn-003.md"
    sessionId: "019e63c3-abe8-7ca3-887c-814b5195bf6f"
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 11
  timestamp: "2026-05-26T10:10:45.632Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-quick-fix."
  data:
    actionType: "run-quick-fix"
    turn: 3
    selfNote: "After quick-fix returns, require verifier to re-check AC-7.4/TC-7.4a, DoD compatibility-method cleanup, the expanded guard coverage, and a clean story gate before considering accept-story."
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 12
  timestamp: "2026-05-26T10:10:45.633Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After quick-fix returns, require verifier to re-check AC-7.4/TC-7.4a, DoD compatibility-method cleanup, the expanded guard coverage, and a clean story gate before considering accept-story."
    actionSequence: 11
    actionType: "run-quick-fix"
    turn: 3
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 13
  timestamp: "2026-05-26T10:22:22.168Z"
  type: "child-operation-completed"
  summary: "quick-fix completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/007-quick-fix.json"
  data:
    actionType: "run-quick-fix"
    command: "quick-fix"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 14
  timestamp: "2026-05-26T10:22:31.918Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/story-lead/prompts/001-planner-turn-004.md"
    sessionId: "019e63ce-9100-7ba1-8e0a-1cdda360d99a"
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 15
  timestamp: "2026-05-26T10:22:31.947Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 4
    selfNote: "If verifier passes with no open findings and npm run verify-all is clean, the next planner turn may accept-story and recommend impl-lead acceptance. If gate truth is still contradictory, do not accept; block or request a ruling depending on verifier evidence."
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 16
  timestamp: "2026-05-26T10:22:31.947Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "If verifier passes with no open findings and npm run verify-all is clean, the next planner turn may accept-story and recommend impl-lead acceptance. If gate truth is still contradictory, do not accept; block or request a ruling depending on verifier evidence."
    actionSequence: 15
    actionType: "run-verify"
    turn: 4
-
  storyRunId: "06-legacy-file-store-retirement-story-run-001"
  sequence: 17
  timestamp: "2026-05-26T10:32:28.975Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/06-legacy-file-store-retirement/005-verify.json"
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
