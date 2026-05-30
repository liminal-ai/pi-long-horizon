# Story Lead Base Prompt

## Role Charter
You are the story lead for `03-derived-maintenance-row-level-adaptation` on durable story run `03-derived-maintenance-row-level-adaptation-story-run-001`.
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
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/03-derived-maintenance-row-level-adaptation.md
Bytes: 11395

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
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/004-verify.json
- older_response_count: 1
- caller_input_artifact_count: 0
- prior_self_note_count: 2
- latest_self_note: "After verifier returns, accept only if final verifier outcome is pass with no open findings; otherwise choose quick-fix, continue, block, or ruling based on verifier evidence."

## Response Trail
<current_response>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/004-verify.json
bytes: 8326
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "71b95bc8-53ba-4d3a-8280-240e5eacf7c8"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e630e-061d-7262-8c9a-a00fecd45b93"
    continuation:
      provider: "codex"
      sessionId: "019e630e-061d-7262-8c9a-a00fecd45b93"
      storyId: "03-derived-maintenance-row-level-adaptation"
    mode: "initial"
    story:
      id: "03-derived-maintenance-row-level-adaptation"
      title: "Story 3: Derived Maintenance Row-Level Adaptation"
    artifactsRead:
      - "docs/spec-build/epics/06-sqlite-persistence/stories/03-derived-maintenance-row-level-adaptation.md"
      - "docs/spec-build/epics/06-sqlite-persistence/tech-design.md"
      - "docs/spec-build/epics/06-sqlite-persistence/test-plan.md"
      - "docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/003-implementor.json"
      - "src/thread/store/thread-store.ts"
      - "src/thread/domain/records.ts"
      - "src/thread/store/sqlite-thread-store.ts"
      - "src/thread/async-thread/services/async-thread-run-service.ts"
      - "src/thread/async-thread/services/thread-maintenance-repair-service.ts"
      - "src/thread/async-thread/services/smooth-turn-service.ts"
      - "src/thread/async-thread/services/lower-band-turn-projection-service.ts"
      - "src/thread/async-thread/services/chunk-service.ts"
      - "src/thread/async-thread/services/lower-band-compression-service.ts"
      - "tests/thread/helpers/sqlite-maintenance-helpers.ts"
      - "tests/thread/sqlite-maintenance-row-level.test.ts"
      - "tests/thread/sqlite-manual-repair.test.ts"
      - "tests/thread/sqlite-maintenance-reporting.test.ts"
      - "tests/thread/sqlite-token-counts.test.ts"
      - "tests/thread/async-thread-run-service.test.ts"
      - "tests/thread/lower-band-compression-service.test.ts"
      - "tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
    reviewScopeSummary: "Reviewed Story 3 requirements and design/test-plan context, then verified the SQLite row-level maintenance implementation, status persistence, and story-mapped tests against the current codebase and the configured `npm run verify-all` gate."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-03-01"
        severity: "major"
        title: "Same-row SQLite maintenance writes still lose newer derived state"
        evidence: "`writeTurnRows` and `writeChunkRows` only revalidate thread/message source state before overwriting the full stored `turn_json`/`chunk_json` row (`src/thread/store/sqlite-thread-store.ts:1452-1626`). The callers pass whole cloned records and intentionally skip `turnsRevision` protection when row APIs exist (`src/thread/async-thread/services/smooth-turn-service.ts:713-731,765-768`; `src/thread/async-thread/services/lower-band-turn-projection-service.ts:370-388,422-425`; `src/thread/async-thread/services/lower-band-compression-service.ts:467-475`). Direct probes against the seeded SQLite fixture reproduced the lost-update behavior: after one row write changed a turn raw-token count to `1111`, a second stale row write that only changed smooth-token data succeeded and the final raw-token count reverted to `132`; the same pattern on a chunk row reverted a smooth-token count from `4444` back to `30`. That means concurrent/stale derived writers on the same row can silently erase exact token/provenance repairs instead of retrying or deferring."
        affectedFiles:
          - "src/thread/store/sqlite-thread-store.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread/async-thread/services/smooth-turn-service.ts"
          - "src/thread/async-thread/services/lower-band-turn-projection-service.ts"
          - "src/thread/async-thread/services/chunk-service.ts"
          - "src/thread/async-thread/services/lower-band-compression-service.ts"
        requirementIds:
          - "AC-4.3"
          - "TC-4.3b"
          - "AC-4.5"
          - "TC-4.5b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "SV-03-02"
        severity: "major"
        title: "Background maintenance status reports fabricated fixed counts on no-op runs"
        evidence: "`maintainAsyncThread` persists `background.fixedCount` from a hard-coded phase tally instead of actual repaired entities (`src/thread/async-thread/services/async-thread-run-service.ts:2567-2579`). After fully repairing the seeded SQLite fixture, running `maintainAsyncThread` again on the already-clean thread stored `{ status: \"ready\", fixedCount: 3, remainingDebtCount: 0 }` even though the pass had no debt and no blockers. That makes thread-level maintenance reporting overstate work on the `TC-4.1b`/`TC-4.6a` no-op path and leaves the inspectable counts inaccurate."
        affectedFiles:
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "tests/thread/sqlite-maintenance-reporting.test.ts"
        requirementIds:
          - "AC-4.6"
          - "TC-4.6a"
        recommendedFixScope: "quick-fix"
        blocking: true
    openFindings:
      -
        id: "SV-03-01"
        severity: "major"
        title: "Same-row SQLite maintenance writes still lose newer derived state"
        evidence: "`writeTurnRows` and `writeChunkRows` only revalidate thread/message source state before overwriting the full stored `turn_json`/`chunk_json` row (`src/thread/store/sqlite-thread-store.ts:1452-1626`). The callers pass whole cloned records and intentionally skip `turnsRevision` protection when row APIs exist (`src/thread/async-thread/services/smooth-turn-service.ts:713-731,765-768`; `src/thread/async-thread/services/lower-band-turn-projection-service.ts:370-388,422-425`; `src/thread/async-thread/services/lower-band-compression-service.ts:467-475`). Direct probes against the seeded SQLite fixture reproduced the lost-update behavior: after one row write changed a turn raw-token count to `1111`, a second stale row write that only changed smooth-token data succeeded and the final raw-token count reverted to `132`; the same pattern on a chunk row reverted a smooth-token count from `4444` back to `30`. That means concurrent/stale derived writers on the same row can silently erase exact token/provenance repairs instead of retrying or deferring."
        affectedFiles:
          - "src/thread/store/sqlite-thread-store.ts"
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "src/thread/async-thread/services/smooth-turn-service.ts"
          - "src/thread/async-thread/services/lower-band-turn-projection-service.ts"
          - "src/thread/async-thread/services/chunk-service.ts"
          - "src/thread/async-thread/services/lower-band-compression-service.ts"
        requirementIds:
          - "AC-4.3"
          - "TC-4.3b"
          - "AC-4.5"
          - "TC-4.5b"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "SV-03-02"
        severity: "major"
        title: "Background maintenance status reports fabricated fixed counts on no-op runs"
        evidence: "`maintainAsyncThread` persists `background.fixedCount` from a hard-coded phase tally instead of actual repaired entities (`src/thread/async-thread/services/async-thread-run-service.ts:2567-2579`). After fully repairing the seeded SQLite fixture, running `maintainAsyncThread` again on the already-clean thread stored `{ status: \"ready\", fixedCount: 3, remainingDebtCount: 0 }` even though the pass had no debt and no blockers. That makes thread-level maintenance reporting overstate work on the `TC-4.1b`/`TC-4.6a` no-op path and leaves the inspectable counts inaccurate."
        affectedFiles:
          - "src/thread/async-thread/services/async-thread-run-service.ts"
          - "tests/thread/sqlite-maintenance-reporting.test.ts"
        requirementIds:
          - "AC-4.6"
          - "TC-4.6a"
        recommendedFixScope: "quick-fix"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-4.1"
        - "AC-4.2"
        - "AC-4.4"
      unverified:
        - "AC-4.3"
        - "AC-4.5"
        - "AC-4.6"
    gatesRun:
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
[]
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
[]
    additionalObservations:
      - "The configured story gate passed, so the current regression suite does not yet protect against same-row stale-write clobbering or no-op maintenance-count misreporting."
      - "The audited maintenance runtime uses real `SqliteThreadStore.writeTurnRows`/`writeChunkRows` production paths when available; I did not find a fake adapter, shim, or placeholder execution path standing in for SQLite row writes."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/004-verify.json"
  startedAt: "2026-05-26T06:52:03.719Z"
  finishedAt: "2026-05-26T07:01:59.951Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/003-implementor.json
bytes: 5768
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "b5285091-a5ec-41d7-a005-b589714433f8"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e62dd-215c-7420-9693-eee6dc316194"
    continuation:
      provider: "codex"
      sessionId: "019e62dd-215c-7420-9693-eee6dc316194"
      storyId: "03-derived-maintenance-row-level-adaptation"
    outcome: "ready-for-verification"
    story:
      id: "03-derived-maintenance-row-level-adaptation"
      title: "Story 3: Derived Maintenance Row-Level Adaptation"
    planSummary: "Implemented Story 3 by adding SQLite row-level turn/chunk maintenance writes, persisting thread-level maintenance run status, adapting async/manual repair paths off whole-array writes where row-level APIs exist, tightening chunk transcript refresh semantics, and adding the planned SQLite maintenance/reporting/token tests plus regression coverage for smart-compact and short-lived PI runs."
    changedFiles:
      -
        path: "src/thread/store/thread-store.ts"
        reason: "Added optional row-level turn/chunk write contracts and maintenance-status persistence contract for stores."
      -
        path: "src/thread/domain/records.ts"
        reason: "Extended thread status with maintenance run records and debt metadata for inspectable bounded/manual repair status."
      -
        path: "src/thread/store/sqlite-thread-store.ts"
        reason: "Implemented SQLite row-level turn/chunk mutation methods and persisted maintenance status updates."
      -
        path: "src/thread/async-thread/services/async-thread-run-service.ts"
        reason: "Switched bounded token maintenance to row-level writes, added maintenance debt/status persistence, and reduced background-run overhead."
      -
        path: "src/thread/async-thread/services/smooth-turn-service.ts"
        reason: "Used row-level turn writes for smooth persistence when available."
      -
        path: "src/thread/async-thread/services/lower-band-turn-projection-service.ts"
        reason: "Used row-level turn writes for lower-band projection persistence when available."
      -
        path: "src/thread/async-thread/services/chunk-service.ts"
        reason: "Used row-level chunk writes for chunk-state refreshes and refined transcript-change handling so semantic artifacts are not invalidated on no-op refreshes."
      -
        path: "src/thread/async-thread/services/lower-band-compression-service.ts"
        reason: "Used row-level chunk writes for semantic artifact persistence and queued async compression via an unref’d timer so short-lived PI runs can exit cleanly."
      -
        path: "src/thread/async-thread/services/thread-maintenance-repair-service.ts"
        reason: "Persisted full manual-repair maintenance status after success/failure."
      -
        path: "tests/thread/helpers/sqlite-maintenance-helpers.ts"
        reason: "Added reusable SQLite maintenance fixture and fake exact-token counter helpers for Story 3 coverage."
      -
        path: "tests/thread/sqlite-maintenance-row-level.test.ts"
        reason: "Added bounded background maintenance, stale derived write, and dependent chunk invalidation coverage."
      -
        path: "tests/thread/sqlite-manual-repair.test.ts"
        reason: "Added full manual repair success/failure coverage with persisted maintenance status assertions."
      -
        path: "tests/thread/sqlite-maintenance-reporting.test.ts"
        reason: "Added thread-level maintenance reporting coverage for counts, backlog visibility, and bounded-vs-manual distinction."
      -
        path: "tests/thread/sqlite-token-counts.test.ts"
        reason: "Extended token tests to cover exact SQLite repair metadata persistence and partial-repair debt visibility."
    tests:
      added:
        - "tests/thread/sqlite-maintenance-row-level.test.ts"
        - "tests/thread/sqlite-manual-repair.test.ts"
        - "tests/thread/sqlite-maintenance-reporting.test.ts"
      modified:
        - "tests/thread/sqlite-token-counts.test.ts"
      removed:
[]
      totalAfterStory: 642
      deltaFromPriorBaseline: 9
    gatesRun:
      -
        command: "npm run typecheck"
        result: "pass"
      -
        command: "node --import tsx --test tests/thread/sqlite-maintenance-row-level.test.ts tests/thread/sqlite-manual-repair.test.ts tests/thread/sqlite-maintenance-reporting.test.ts tests/thread/sqlite-token-counts.test.ts"
        result: "pass"
      -
        command: "node --import tsx --test --test-name-pattern \"^smart compact writes a generated rollout after live PI turns on a prepared long-thread clone$\" tests/context-steward/long-thread-real-pi-execution.e2e.test.ts"
        result: "pass"
      -
        command: "node --import tsx --test --test-name-pattern \"^e2e: path stability across /tmp symlink$|^one thread directory exists \\(no conflict\\)$|^index keys use stable resolved paths$|^second prompt captured \\(no conflict blocked capture\\)$\" tests/context-steward/e2e-cli.e2e.test.ts"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Replaced high-contention maintenance turn/chunk compatibility rewrites with SQLite row-level writes where the Story 3 services persist derived state."
        - "Persisted bounded/manual maintenance run summaries and debt details on thread status so backlog, failures, and affected entities remain inspectable."
        - "Fixed two regressions during self-review: no-op transcript refreshes/smooth-only updates no longer invalidate semantic lower-band artifacts, and async lower-band scheduling no longer keeps short-lived PI/e2e runs alive."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Run the story verifier/self-review pass against the Story 3 artifacts now that verify-all is green."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/003-implementor.json"
  startedAt: "2026-05-26T05:58:39.428Z"
  finishedAt: "2026-05-26T06:51:54.095Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/story-lead/001-current.json
Bytes: 2284

```yaml
storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
storyId: "03-derived-maintenance-row-level-adaptation"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-verify completed with outcome revise and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/004-verify.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e62dd-215c-7420-9693-eee6dc316194"
    storyId: "03-derived-maintenance-row-level-adaptation"
  storyVerifier:
    provider: "codex"
    sessionId: "019e630e-061d-7262-8c9a-a00fecd45b93"
    storyId: "03-derived-maintenance-row-level-adaptation"
latestEventSequence: 9
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "The implementor reports ready-for-verification and says the configured story gate passed, but the durable record has no independent verifier result yet. The smallest safe next action is to run the story verifier against the implementation artifact before considering acceptance."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/004-verify.json"
replayBoundary: null
updatedAt: "2026-05-26T07:01:59.961Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After verifier returns, accept only if final verifier outcome is pass with no open findings; otherwise choose quick-fix, continue, block, or ruling based on verifier evidence.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-26T05:58:39.391Z; note="After implementation returns, run verification before considering acceptance; configured story gate is npm run verify-all."
- sequence=8; actionSequence=7; createdAt=2026-05-26T06:52:03.684Z; note="After verifier returns, accept only if final verifier outcome is pass with no open findings; otherwise choose quick-fix, continue, block, or ruling based on verifier evidence."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/story-lead/001-events.jsonl
Bytes: 4178

```yaml
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 1
  timestamp: "2026-05-26T05:58:26.894Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 2
  timestamp: "2026-05-26T05:58:39.366Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e62dc-f1c7-7ac1-a6c5-d783b08f9dee"
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 3
  timestamp: "2026-05-26T05:58:39.391Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, run verification before considering acceptance; configured story gate is npm run verify-all."
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 4
  timestamp: "2026-05-26T05:58:39.391Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, run verification before considering acceptance; configured story gate is npm run verify-all."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 5
  timestamp: "2026-05-26T06:51:54.105Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 6
  timestamp: "2026-05-26T06:52:03.660Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e630d-e093-7d53-a3bb-6fecdf10e48e"
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 7
  timestamp: "2026-05-26T06:52:03.683Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "After verifier returns, accept only if final verifier outcome is pass with no open findings; otherwise choose quick-fix, continue, block, or ruling based on verifier evidence."
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 8
  timestamp: "2026-05-26T06:52:03.684Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After verifier returns, accept only if final verifier outcome is pass with no open findings; otherwise choose quick-fix, continue, block, or ruling based on verifier evidence."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "03-derived-maintenance-row-level-adaptation-story-run-001"
  sequence: 9
  timestamp: "2026-05-26T07:01:59.961Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/03-derived-maintenance-row-level-adaptation/004-verify.json"
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
