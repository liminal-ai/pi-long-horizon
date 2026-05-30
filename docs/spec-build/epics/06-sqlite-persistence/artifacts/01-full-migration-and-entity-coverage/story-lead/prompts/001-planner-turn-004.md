# Story Lead Base Prompt

## Role Charter
You are the story lead for `01-full-migration-and-entity-coverage` on durable story run `01-full-migration-and-entity-coverage-story-run-001`.
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
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/01-full-migration-and-entity-coverage.md
Bytes: 17723

# Story 1: Full Migration And Entity Coverage

### Summary
<!-- Jira: Summary field -->

Import file-backed managed threads into SQLite with complete entity preservation, validation reporting, and repeatable migration behavior.

### Description
<!-- Jira: Description field -->

**User Profile:** Long Horizon operator / tech lead maintaining managed PI sessions.

**Objective:** Prove that existing file-backed thread directories can be imported into `thread.sqlite` without losing canonical or derived managed state.

**Scope In:**

- Full migration from the current `.context-steward/threads/<threadId>` file layout.
- Entity coverage for thread identity, actors, messages, turns, chunks, artifacts, token metadata, projection metadata, readiness issues, and repair state.
- Session/thread lookup migration or replacement with explicit managed-store lookup.
- Migration validation report.
- Idempotent and interrupted migration handling.

**Scope Out:**

- Runtime store factory cutover.
- Row-level maintenance adaptation.
- Smart compact snapshot hardening.
- `lhx` SQLite inspection surface beyond migration validation needs.

**Dependencies:**

- Story 0 SQLite store foundation.
- `tech-design.md` Sections 3, 7, 8, 10, and 13.
- `test-plan.md` Chunk 1.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-1.1:** Thread identity and lifecycle state are preserved.

- **TC-1.1a:** Given an existing thread, when migrated or stored in SQLite-backed persistence, then thread ID, project/root identity, source revision, creation/update timestamps, active target/session linkage, and status summaries are preserved or explicitly reported as unavailable.
- **TC-1.1b:** Given source revision changes, when canonical or derived writes occur, then inspection can distinguish current managed state from older generated projection metadata.
- **TC-1.1c:** Given PI session identity maps to a managed thread before migration, when migration and cutover complete, then PI session → managed thread resolution still works and does not depend on a loose JSON mapping as the only authoritative source.

**AC-1.2:** Actor identity is preserved.

- **TC-1.2a:** Given captured user, assistant, tool, system, or runtime-note actors in file-backed state, when migration runs, then actor identity, actor type, and source mapping are preserved for duplicate detection and audit.
- **TC-1.2b:** Given new runtime activity after cutover, when actors are declared or reused, then actor identity, actor type, and source mapping remain stable for duplicate detection and audit.
- **TC-1.2c:** Given migrated actor records contain duplicate slugs, conflicting types, or ambiguous source mappings, when migration runs, then the conflict is reported and resolved according to migration policy rather than silently merging incompatible actors.

**Story 1 note:** The actor reuse case above is exercised here through direct SQLite store actor declaration/reuse operations, not through the runtime PI capture path. Runtime capture validation for actor reuse happens in Story 2.

**AC-1.3:** Canonical messages and parts are preserved as ordered source truth.

- **TC-1.3a:** Given canonical messages with ordered parts, when migrated or written, then message order, source order, source revision, actor, message kind, timestamps, part order, part type, and content are preserved.
- **TC-1.3b:** Given large tool results, when migrated or written, then full canonical content is preserved even if prompt-visible projections later truncate it.

**AC-1.4:** Turns preserve prompt-bounded semantic grouping.

- **TC-1.4a:** Given open and closed turns, when migrated or written, then turn identity, numeric index, lifecycle state, source message span, actor/prompt boundary relationships, repair status, and token metadata are preserved.
- **TC-1.4b:** Given incomplete or inconsistent turn membership, when inspected after migration, then the inconsistency is surfaced as repair-needed state rather than silently corrected without report.

**AC-1.5:** Smooth turn artifacts preserve derived content and provenance.

- **TC-1.5a:** Given a smooth artifact, when migrated or regenerated, then the smooth text/content, provenance, source revision or input references, token metadata, stale/dirty state, and provider metadata where available are preserved.
- **TC-1.5b:** Given canonical source changes that invalidate a smooth artifact, when inspected, then dependent smooth state is marked stale or repair-needed.

**AC-1.6:** Chunks preserve grouped closed-turn state.

- **TC-1.6a:** Given chunk state, when migrated or updated, then chunk ID, turn range, lifecycle state, source turn membership, smooth chunk content, token metadata, and readiness status are preserved.
- **TC-1.6b:** Given a chunk affected by turn/artifact changes, when maintenance runs, then chunk readiness reflects the affected state without rewriting unrelated source records.

**Story 1 note:** The chunk readiness update case above is exercised here through direct SQLite chunk/readiness update behavior and migration validation, not through the production maintenance loop. Production maintenance row-level behavior is validated in Story 3.

**AC-1.7:** Lower-band artifacts preserve detailed/brief projections and provenance.

- **TC-1.7a:** Given detailed and brief lower-band artifacts, when migrated or regenerated, then artifact text, band type, source chunk, provider/model metadata, prompt version, token metadata, stale state, and failure state are preserved.
- **TC-1.7b:** Given a legacy placeholder or artifact missing required provenance, when prepare or repair evaluates readiness, then the artifact is treated according to current readiness policy and can be regenerated.

**AC-1.8:** Token counts preserve source, trust, and repair state.

- **TC-1.8a:** Given raw, smooth, lower-band, chunk, or generated token counts, when migrated or written, then exact vs heuristic status, count source, trust class, provider/model/encoding metadata, and measured value are preserved.
- **TC-1.8b:** Given missing, heuristic, stale, or failed token counts, when inspected, then tokenCounting readiness and blockers reflect the remaining debt.

**AC-1.9:** Projection and rollout metadata are preserved separately from rollout file content.

- **TC-1.9a:** Given generated thread-view metadata, when migrated or written, then generated file path, projection ID, source revision, band layout, generated token count, status, and timestamps are preserved.
- **TC-1.9b:** Given a missing generated rollout file, when inspected, then managed projection metadata remains readable and the missing file is reported as a warning or blocker according to current policy.

**AC-1.10:** Repair, degraded, and readiness issues are preserved.

- **TC-1.10a:** Given repair-needed, degraded, warning, or blocker issues, when migrated or updated, then issue code, scope, affected entity, severity, message, status, and relevant metadata are preserved.
- **TC-1.10b:** Given a repair operation that resolves debt, when inspected, then resolved readiness state no longer reports stale blockers while preserving enough audit information to understand what changed.

**AC-2.1:** Migration imports canonical source records without loss.

- **TC-2.1a:** Given a file-backed thread with canonical messages and parts, when migration runs, then migrated message and part counts match the file-backed source unless the migration report identifies specific rejected records.
- **TC-2.1b:** Given canonical full tool-result content, when migration runs, then full content remains available from managed state after migration.
- **TC-2.1c:** Given repository-level identity files such as project indexes or PI session → thread ID maps, when migration runs, then required session/thread lookup state is migrated, preserved, or replaced by an explicit managed-store lookup and any remaining file index is non-authoritative discovery metadata.

**AC-2.2:** Migration imports derived artifacts and status where valid.

- **TC-2.2a:** Given file-backed turns, chunks, smooth artifacts, lower-band artifacts, and token metadata, when migration runs, then valid derived state is imported with provenance and readiness metadata.
- **TC-2.2b:** Given missing, stale, legacy, or invalid derived state, when migration runs, then the migration report marks affected records as skipped, downgraded, stale, or repair-needed rather than pretending they are ready.

**AC-2.3:** Migration preserves projection metadata without treating generated JSONL as source truth.

- **TC-2.3a:** Given generated projection metadata and rollout files, when migration runs, then metadata is imported and rollout file paths are preserved or remapped.
- **TC-2.3b:** Given generated JSONL content that differs from canonical managed state, when migration runs, then canonical managed state wins and the difference is reported if it affects current projection validity.

**AC-2.4:** Migration is idempotent or safely repeatable.

- **TC-2.4a:** Given a completed migration, when migration is run again against the same source and target, then it does not duplicate canonical messages, turns, chunks, or artifacts.
- **TC-2.4b:** Given a failed or interrupted migration, when migration is retried, then it resumes or restarts safely and reports any partial state handling.

**AC-2.5:** Migration produces a validation report.

- **TC-2.5a:** Given a migration run, when it completes, then the report includes source thread ID, target database path, imported counts, skipped counts, warnings, blockers, generated rollout linkage, and readiness summary.
- **TC-2.5b:** Given migration warnings or blockers, when the operator reviews the report, then affected entity IDs or ranges are included where available.

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 1 proves the current file-backed managed thread model can move into `thread.sqlite` without losing canonical source, derived artifacts, token metadata, readiness state, projection metadata, or identity/session linkage. Runtime remains file-backed until Story 2; this story is migration/entity preservation, not active production cutover.

Generated PI rollout JSONL is imported only as projection metadata/linkage. It must never overwrite canonical messages, turns, or derived managed state during migration.

#### Build Strategy

Strategy: full-staged-risk

Reason:
- This is a large migration/entity-coverage story with many ways to silently lose data or mark invalid derived state as ready.
- It needs TDD around realistic file-backed fixtures, validation reports, idempotency, and interrupted retry.

Risk Reminders:
- Preserve canonical messages/parts first.
- Downgrade or mark invalid derived state instead of pretending it is ready.
- Treat TC-1.2b and TC-1.6b as direct store/entity behavior here; runtime/maintenance production paths are later stories.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Migration service | `src/thread/migration/sqlite-thread-migration-service.ts` |
| SQLite store mapping | `src/thread/store/sqlite-thread-store.ts`, `src/thread/store/migrations/*.sql` |
| Legacy readers | `src/thread/store/file-thread-store.ts` and current file-backed helpers |
| Entity fixtures | existing thread/store/thread-view fixtures plus migration-specific legacy fixtures |
| Tests | `sqlite-thread-migration.test.ts`, `sqlite-derived-artifacts.test.ts`, `sqlite-token-counts.test.ts`, `sqlite-projection-metadata.test.ts`, `sqlite-readiness-issues.test.ts` |

#### Design References

- [tech-design.md §Current Architecture Review](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:50), lines 50-178
- [tech-design.md §SQLite Data Model](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:401), lines 401-477
- [tech-design.md §Derived-state provenance](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:533), lines 533-545
- [tech-design.md §Migration Design](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:601), lines 601-641
- [tech-design.md §Error Contracts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/tech-design.md:708), lines 708-724
- [test-plan.md §Entity coverage tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:75), lines 75-100
- [test-plan.md §Migration tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:102), lines 102-116
- [test-plan.md §Chunk 1](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/test-plan.md:234), lines 234-249
- [coverage.md §Story 01](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/stories/coverage.md:104), lines 104-110

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-1.1a, TC-1.1c, TC-2.1c | `sqlite-thread-migration.test.ts` | thread identity, project/root, source revision, session/thread lookup, and index replacement/import behavior |
| TC-1.1b | `sqlite-thread-store.test.ts` | source revision and projection revision stay distinguishable after writes |
| TC-1.2a, TC-1.2c | `sqlite-thread-migration.test.ts` | actor identity imports and conflicting actors report migration policy outcomes |
| TC-1.2b | `sqlite-thread-migration.test.ts` | actor declaration/reuse remains stable through direct SQLite store/import operations; runtime capture validation is later |
| TC-1.3a, TC-1.3b, TC-2.1a, TC-2.1b | `sqlite-thread-migration.test.ts` | canonical messages/parts/tool-result content import without loss |
| TC-1.4a, TC-1.4b | `sqlite-thread-migration.test.ts` | turn lifecycle/membership imports or becomes repair-needed on inconsistency |
| TC-1.5a, TC-1.5b, TC-1.6a, TC-1.6b, TC-1.7a, TC-1.7b, TC-2.2a, TC-2.2b | `sqlite-derived-artifacts.test.ts` | smooth/chunk/lower-band artifacts import, classify stale/legacy state, and preserve provenance/readiness |
| TC-1.8a, TC-1.8b | `sqlite-token-counts.test.ts` | exact/heuristic token metadata and tokenCounting debt import/report correctly |
| TC-1.9a, TC-1.9b, TC-2.3a, TC-2.3b | `sqlite-projection-metadata.test.ts`, `sqlite-thread-migration.test.ts` | projection metadata imports separately from generated JSONL content and preserves source-truth priority |
| TC-1.10a, TC-1.10b | `sqlite-readiness-issues.test.ts` | readiness/degraded/blocker issues import and resolve without losing audit context |
| TC-2.4a, TC-2.4b | `sqlite-thread-migration.test.ts` | repeat/interrupted migration is safe and non-duplicating |
| TC-2.5a, TC-2.5b | `sqlite-thread-migration.test.ts` | migration report includes counts, warnings, blockers, rollout linkage, readiness, and affected entity references |

#### Architecture-Risk Tests

| Risk | Test File / Check | Test Description | Why AC/TC Mapping Alone Would Miss It |
|------|-------------------|------------------|---------------------------------------|
| Migration / Compatibility | `sqlite-thread-migration.test.ts` | interrupted/repeated import uses stable IDs and does not duplicate rows | Happy-path migration does not prove retry safety |
| Source vs Projection Truth | `rollout-regeneration-sqlite.test.ts` or migration projection case | generated rollout disagreement never overwrites canonical SQLite messages | ACs say generated is projection, but migration is a high-risk overwrite vector |
| Derived-State Provenance | `sqlite-derived-artifacts.test.ts` | missing provider/revision/settings metadata imports as stale/repair-needed | Entity count preservation alone can hide invalid readiness |

#### Transition-State Risk

- A migrated DB must not be marked SQLite-ready until validation completes.
- Any remaining project-level JSON index is discovery/cache metadata only, not authoritative source truth.

#### Fixture Fidelity

- Legacy fixtures must include `thread.json`, `actors.json`, `messages.jsonl`, `turns.json`, `chunks.json`, `imports.json`, `projections.json`, and generated rollout files where relevant.
- Invalid fixtures should be named by broken invariant, not created implicitly.

#### Anti-Shim Requirements

- Do not prove migration by counts alone; assert provenance/readiness ownership for derived artifacts.
- Do not accept generated JSONL as canonical source input.
- Do not use simplified fixtures that omit session/thread lookup metadata for identity tests.

#### Production Path Proof

- Entrypoint: internal migration service; no active runtime entrypoint yet.
- Registration/default path: runtime remains file-backed until Story 2.
- Evidence: migration service tests and smoke fixtures prove import/read behavior, not production cutover.

#### Verification

- Targeted: Chunk 1 migration/entity tests when added
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all` with sufficient timeout when runtime/E2E coverage is involved

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] File-backed threads import into SQLite with complete entity coverage.
- [ ] Migration report includes imported/skipped counts, warnings, blockers, rollout linkage, and readiness summary.
- [ ] Repeat migration is idempotent.
- [ ] Interrupted migration retry behavior is tested.
- [ ] Canonical-vs-projection ownership is preserved.
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
- planner_turn_index: 4
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: quick-fix completed with outcome ready-for-verification and status ok.
- latest_response_kind: quick-fix-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/001-quick-fix.json
- older_response_count: 2
- caller_input_artifact_count: 0
- prior_self_note_count: 3
- latest_self_note: "After quick-fix returns, send the updated artifact back to verifier; accept only after verifier outcome is pass with no open findings and story gate evidence remains sufficient."

## Response Trail
<current_response>
```yaml
kind: quick-fix-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/001-quick-fix.json
bytes: 9228
payload:
  command: "quick-fix"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    provider: "codex"
    model: "gpt-5.4"
    rawProviderOutputPreview: |-
      {"type":"thread.started","thread_id":"019e6277-3c80-7d92-ba46-8f37d3ee1e91"}
      {"type":"turn.started"}
      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m going to inspect the current migration and managed-thread lookup code, check the related bead/story context, and then make the fix with focused tests before running the targeted validation commands."}}
      {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/Users/leemoore/code/pi-long-horizon\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' beads-instructions.md\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' beads-instructions.md\"","aggregated_output":"# Beads Instructions\n\nThis project uses **bd (beads)** for issue tracking.\n\n## Purpose\n\nBeads is the primary tracker for actionable backlog items, priorities, dependencies, ready/blocked state, and multi-agent handoff.\n\nMarkdown remains appropriate for ADRs, design notes, specs, and narrative context. Do not treat `.tech-lead/backlog.md` as the live task tracker unless explicitly instructed.\n\n## Core Commands\n\n```bash\nbd prime                 # Show current agent workflow context\nbd ready                 # Find unblocked work\nbd show <id>             # View issue details and audit trail\nbd update <id> --claim   # Claim work atomically\nbd close <id>            # Complete work\nbd list                  # List issues\nbd status                # Database overview\nbd create \"Title\" --type task --priority 2\n```\n\nUse `--json` when structured output is useful for agents.\n\n## Storage / Sync Notes\n\nIssues live in a local Dolt database under `.beads/`. `.beads/issues.jsonl` is an export/view artifact, not the source of truth.\n\nCross-machine sync uses Beads/Dolt commands such as:\n\n```bash\nbd dolt push\nbd dolt pull\n```\n\nDo not `bd import` during normal operation unless intentionally restoring/importing data.\n\n## Agent Usage Guidance\n\n- Use Beads for actionable tasks instead of ad hoc markdown TODO lists.\n- Use `bd ready` to find work and `bd show <id>` before starting.\n- Claim work with `bd update <id> --claim` when appropriate.\n- Close issues only when the work and validation are actually complete.\n- Add comments/notes to issues when useful for handoff.\n\n## Project Preference\n\nKeep root `AGENTS.md` minimal. Detailed Beads workflow belongs here, not in `AGENTS.md`.\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_3","type":"command_execution","command":"/bin/zsh -lc 'rg --files'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"/bin/zsh -lc 'rg --files'","aggregated_output":"src/thread/store/schema-version.ts\nsrc/thread/store/mutation-coordinator.ts\nsrc/thread/store/file-thread-store.ts\nsrc/thread/store/migrations/0001_sqlite_store_foundation.sql\nsrc/thread/store/thread-store.ts\nsrc/thread/store/sqlite-thread-store.ts\nsrc/thread/services/repair-service.ts\nsrc/thread/services/capture-service.ts\nsrc/thread/services/turn-service.ts\nsrc/thread/services/thread-service.ts\nsrc/thread/services/import-service.ts\nsrc/thread/migration/sqlite-thread-migration-service.ts\nsrc/thread/domain/output-metadata.ts\nsrc/thread/domain/records.ts\nsrc/thread/domain/errors.ts\nsrc/thread/domain/ids.ts\nsrc/thread/async-thread/services/placeholder-artifact-service.ts\nsrc/thread/async-thread/services/async-thread-run-service.ts\nsrc/thread/async-thread/services/pi-codex-lower-band-compression-provider.ts\nsrc/thread/async-thread/services/thread-maintenance-repair-service.ts\nsrc/thread/async-thread/services/smooth-turn-service.ts\nsrc/thread/async-thread/services/user-prompt-smoothing-service.ts\nsrc/thread/async-thread/services/lower-band-compression-service.ts\nsrc/thread/async-thread/services/chunk-service.ts\nsrc/thread/async-thread/services/pi-codex-user-prompt-smoothing-provider.ts\nsrc/thread/async-thread/services/lower-band-turn-projection-service.ts\nsrc/thread/async-thread/domain/async-thread-status.ts\nsrc/thread/async-thread/domain/placeholder-artifact-state.ts\nsrc/thread/async-thread/domain/chunk-state.ts\nsrc/thread/async-thread/domain/settings.ts\nsrc/thread/async-thread/domain/lower-band-artifact-state.ts\nsrc/thread/async-thread/domain/smooth-turn-state.ts\nsrc/thread/async-thread/test/temp-thread-store.ts\nsrc/thread/async-thread/test/fixtures.ts\nsrc/token-accounting/materialized-representation-counter.ts\nsrc/token-accounting/index.ts\nsrc/token-accounting/token-count-metadata.ts\nsrc/token-accounting/counter-source-policy.ts\nsrc/token-accounting/openai-generated-session-converter.ts\nsrc/token-accounting/openai-input-token-counter.ts\nsrc/commands/command-results.ts\nsrc/commands/smart-compact.ts\nsrc/pi-baseline.ts\nsrc/workbench/services/active-rollout-inspection-service.ts\nsrc/workbench/services/workbench-search-service.ts\nsrc/workbench/services/smoothing-inspection-service.ts\nsrc/workbench/services/workbench-query-service.ts\nsrc/workbench/services/compaction-report-service.ts\nsrc/workbench/services/compaction-report-formatter.ts\nsrc/workbench/domain/workbench-errors.ts\nsrc/workbench/test/temp-workbench-store.ts\nsrc/workbench/test/fixtures.ts\nsrc/harness-adapter/pi-cli-ha/pi-cli-ha.ts\nsrc/harness-adapter/pi-cli-ha/load-thread-view-file.ts\nsrc/context-workbench/store/file-thread-view-store.ts\nsrc/context-workbench/store/thread-view-store.ts\nsrc/context-workbench/services/workbench-search-service.ts\nsrc/context-workbench/services/workbench-query-service.ts\nsrc/context-workbench/services/thread-view-compare-service.ts\nsrc/context-workbench/services/thread-view-edit-service.ts\nsrc/context-workbench/services/thread-view-activation-service.ts\nsrc/context-workbench/services/thread-view-materializer.ts\nsrc/context-workbench/domain/thread-view-records.ts\nsrc/context-workbench/domain/workbench-errors.ts\nsrc/context-workbench/test/temp-workbench-store.ts\nsrc/context-workbench/test/fixtures.ts\nsrc/pi-extensions/codex-fast.ts\nsrc/pi-extensions/codex-web-search.ts\nsrc/context-steward/store/schema-version.ts\nsrc/context-steward/store/file-thread-store.ts\nsrc/context-steward/store/thread-store.ts\nsrc/context-steward/store/sqlite-thread-store.ts\nsrc/context-steward/services/repair-service.ts\nsrc/context-steward/services/capture-service.ts\nsrc/context-steward/services/turn-service.ts\nsrc/context-steward/services/fixture-service.ts\nsrc/context-steward/services/thread-service.ts\nsrc/context-steward/services/import-service.ts\nsrc/context-steward/domain/records.ts\nsrc/context-steward/domain/errors.ts\nsrc/context-steward/domain/ids.ts\nsrc/context-steward/commands/command-results.ts\nsrc/context-steward/pi/pi-extension.ts\nsrc/context-steward/pi/pi-session-importer.ts\nsrc/context-steward/pi/pi-message-mapper.ts\nsrc/context-steward/test/temp-store.ts\nsrc/context-steward/test/fixtures.ts\nsrc/login-chatgpt.ts\nsrc/list-models.ts\nsrc/thread-view/store/file-thread-view-store.ts\nsrc/thread-view/store/thread-view-store.ts\nsrc/thread-view/services/thread-view-builder.ts\nsrc/thread-view/services/thread-view-compare-service.ts\nsrc/thread-view/services/pi-token-estimator.ts\nsrc/thread-view/services/prompt-visible-tool-result-projection.ts\nsrc/thread-view/services/thread-view-activation-service.ts\nsrc/thread-view/services/live-tool-result-truncation.ts\nsrc/thread-view/services/thread-view-materializer.ts\nsrc/thread-view/domain/thread-view-errors.ts\nsrc/thread-view/domain/thread-view-records.ts\nsrc/thread-view/domain/pi-thread-view-file.ts\nAGENTS.md\nbeads-instructions.md\nCLAUDE.md\nsrc/integration-error.ts\nREADME.md\npackage.json\npackage-
    rawProviderOutputBytes: 1210347
    rawProviderOutputTruncated: true
    rawProviderOutputLogPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/streams/001-quick-fix.stdout.log"
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/001-quick-fix.json"
  startedAt: "2026-05-26T04:07:21.730Z"
  finishedAt: "2026-05-26T04:13:38.090Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/003-implementor.json
bytes: 4753
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "8f08d903-fde8-49f0-915f-5dc37936f48e"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e625f-e4b9-71d2-a556-e42b325cff9a"
    continuation:
      provider: "codex"
      sessionId: "019e625f-e4b9-71d2-a556-e42b325cff9a"
      storyId: "01-full-migration-and-entity-coverage"
    outcome: "ready-for-verification"
    story:
      id: "01-full-migration-and-entity-coverage"
      title: "Story 1: Full Migration And Entity Coverage"
    planSummary: "Expanded the SQLite migration from the Story 0 smoke path into a full file-backed thread import that preserves turns, chunks, imports, projections, token/readiness metadata, and canonical content; added migration-time validation/downgrade rules for conflicting or invalid legacy state; and added SQLite-side managed-thread lookup fallback so migrated threads remain discoverable even when loose JSON maps are missing."
    changedFiles:
      -
        path: "src/thread/migration/sqlite-thread-migration-service.ts"
        reason: "Replaced the smoke-only importer with full snapshot migration, entity counting, validation warnings, derived-state downgrades, token metadata checks, and repeat-import handling."
      -
        path: "src/thread/store/sqlite-thread-store.ts"
        reason: "Added authoritative SQLite thread scanning fallback so managed-thread lookup can resolve migrated threads without depending solely on `threadId-map.json`."
      -
        path: "src/thread/domain/errors.ts"
        reason: "Added the `GENERATED_ROLLOUT_MISSING` issue code used by migration validation/reporting."
      -
        path: "tests/thread/sqlite-migration-test-helpers.ts"
        reason: "Added reusable legacy-fixture helpers for creating file-backed migration inputs across the new Story 1 tests."
      -
        path: "tests/thread/sqlite-thread-migration.test.ts"
        reason: "Covered full migration preservation, actor conflict handling, repair-needed turn import, idempotent reruns, and managed-thread lookup fallback."
      -
        path: "tests/thread/sqlite-derived-artifacts.test.ts"
        reason: "Covered valid derived-artifact preservation plus downgrade behavior for missing smooth/chunk provenance."
      -
        path: "tests/thread/sqlite-token-counts.test.ts"
        reason: "Covered exact/heuristic token metadata preservation and repair-needed surfacing for invalid token records."
      -
        path: "tests/thread/sqlite-projection-metadata.test.ts"
        reason: "Covered projection metadata import staying separate from generated rollout content plus missing-rollout warnings."
      -
        path: "tests/thread/sqlite-readiness-issues.test.ts"
        reason: "Covered preservation of readiness/token-counting issue audit state and resolved-ready state."
      -
        path: "tests/thread/sqlite-thread-migration-smoke.test.ts"
        reason: "Updated the legacy smoke expectation to match full turn import now that Story 1 migration is no longer smoke-only."
    tests:
      added:
        - "tests/thread/sqlite-thread-migration.test.ts"
        - "tests/thread/sqlite-derived-artifacts.test.ts"
        - "tests/thread/sqlite-token-counts.test.ts"
        - "tests/thread/sqlite-projection-metadata.test.ts"
        - "tests/thread/sqlite-readiness-issues.test.ts"
      modified:
        - "tests/thread/sqlite-thread-migration-smoke.test.ts"
      removed:
[]
      totalAfterStory: 522
      deltaFromPriorBaseline: 11
    gatesRun:
      -
        command: "npm run typecheck"
        result: "pass"
      -
        command: "node --import tsx --test tests/thread/sqlite-thread-migration.test.ts tests/thread/sqlite-derived-artifacts.test.ts tests/thread/sqlite-token-counts.test.ts tests/thread/sqlite-projection-metadata.test.ts tests/thread/sqlite-readiness-issues.test.ts"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Replaced the partial Story 0 import with full entity coverage so turns, chunks, imports, projections, and embedded token/readiness state now migrate into SQLite."
        - "Added explicit migration warnings and downgrade behavior for conflicting actors, inconsistent turns, invalid derived provenance, missing generated rollout files, and malformed token metadata instead of silently importing them as ready."
        - "Removed the managed-thread lookup dependence on loose JSON maps alone by adding SQLite-side fallback scanning for migrated threads."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Run story verification with attention on the migration warning/downgrade policy and the new SQLite managed-thread lookup fallback."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/003-implementor.json"
  startedAt: "2026-05-26T03:41:51.776Z"
  finishedAt: "2026-05-26T03:57:16.460Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/004-verify.json
bytes: 9049
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "b96340d4-cb03-4e7b-a379-6236186ba8c2"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e626e-5224-7d81-94ce-c3b05f789b90"
    continuation:
      provider: "codex"
      sessionId: "019e626e-5224-7d81-94ce-c3b05f789b90"
      storyId: "01-full-migration-and-entity-coverage"
    mode: "initial"
    story:
      id: "01-full-migration-and-entity-coverage"
      title: "Story 1: Full Migration And Entity Coverage"
    artifactsRead:
      - "docs/spec-build/epics/06-sqlite-persistence/stories/01-full-migration-and-entity-coverage.md"
      - "docs/spec-build/epics/06-sqlite-persistence/tech-design.md"
      - "docs/spec-build/epics/06-sqlite-persistence/test-plan.md"
      - "docs/spec-build/epics/06-sqlite-persistence/impl-run.config.json"
      - "docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/003-implementor.json"
      - "src/thread/migration/sqlite-thread-migration-service.ts"
      - "src/thread/store/sqlite-thread-store.ts"
      - "src/thread/store/migrations/0001_sqlite_store_foundation.sql"
      - "src/thread/domain/records.ts"
      - "tests/thread/sqlite-thread-migration.test.ts"
      - "tests/thread/sqlite-thread-migration-smoke.test.ts"
      - "tests/thread/sqlite-derived-artifacts.test.ts"
      - "tests/thread/sqlite-token-counts.test.ts"
      - "tests/thread/sqlite-projection-metadata.test.ts"
      - "tests/thread/sqlite-readiness-issues.test.ts"
      - "tests/thread/sqlite-migration-test-helpers.ts"
      - "tests/thread/sqlite-thread-store.test.ts"
      - "tests/thread/sqlite-thread-store-compat.test.ts"
      - "tests/context-steward/thread-store.test.ts"
    reviewScopeSummary: "Reviewed Story 1's migration/entity-coverage implementation across the migration service, SQLite store persistence and lookup behavior, Story 1 tests, and the supporting story/tech-design/test-plan artifacts. I also ran the configured story gate (npm run verify-all) and executed a targeted reproduction for migrated generated-rollout lookup after removing threadId-map.json and index.json."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-01"
        severity: "major"
        title: "Generated rollout identities still stop resolving when loose JSON maps are removed"
        evidence: "TC-1.1c and TC-2.1c require session-to-thread resolution to survive migration without depending on threadId-map.json as the only authority. In src/thread/store/sqlite-thread-store.ts:929-971, findManagedThread falls back to scanThreadsByTarget, but scanThreadsByTarget at 1543-1572 only compares the incoming target against thread.target. Generated-rollout identities live in projection metadata/threadViewOutputSummary instead (see src/thread/store/sqlite-thread-store.ts:439-458 and 1644-1646), so they are never matched by the SQLite fallback. I reproduced this with a temporary migrated fixture: after deleting threadId-map.json and index.json, findManagedThread(originalTarget) returned the thread, while findManagedThread({sessionId:\"generated-session-001\", sessionFilePath:\".../projection-001.jsonl\"}) returned ok with no value. tests/thread/sqlite-thread-migration.test.ts:167-192 only exercises the original target, so this gap is not covered by the story tests."
        affectedFiles:
          - "src/thread/store/sqlite-thread-store.ts"
          - "tests/thread/sqlite-thread-migration.test.ts"
        requirementIds:
          - "TC-1.1c"
          - "TC-2.1c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "SV-02"
        severity: "major"
        title: "Interrupted-migration handling is not reported or persisted as required"
        evidence: "TC-2.4b requires retry after failed/interrupted migration to resume or restart safely and report how partial state was handled; TC-2.5a requires that status in the validation report. The ImportFileBackedThreadResult contract in src/thread/migration/sqlite-thread-migration-service.ts:35-44 has no repeat/partial-status field, and importFileBackedThread only emits a generic 'already existed' warning when the DB path exists (390-398) before reseeding the database. The actual seed path in src/thread/store/sqlite-thread-store.ts:480-507 simply DELETEs and rewrites the thread snapshot transactionally; repo search found no migration_incomplete or migration_runs handling in the migration code. tests/thread/sqlite-thread-migration.test.ts:258-327 simulates a rerun by manually seeding partial rows, but it only asserts row counts plus the generic warning and never verifies any partial-state report. The interrupted-retry/reporting contract is therefore still missing."
        affectedFiles:
          - "src/thread/migration/sqlite-thread-migration-service.ts"
          - "src/thread/store/sqlite-thread-store.ts"
          - "tests/thread/sqlite-thread-migration.test.ts"
        requirementIds:
          - "TC-2.4b"
          - "TC-2.5a"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    openFindings:
      -
        id: "SV-01"
        severity: "major"
        title: "Generated rollout identities still stop resolving when loose JSON maps are removed"
        evidence: "TC-1.1c and TC-2.1c require session-to-thread resolution to survive migration without depending on threadId-map.json as the only authority. In src/thread/store/sqlite-thread-store.ts:929-971, findManagedThread falls back to scanThreadsByTarget, but scanThreadsByTarget at 1543-1572 only compares the incoming target against thread.target. Generated-rollout identities live in projection metadata/threadViewOutputSummary instead (see src/thread/store/sqlite-thread-store.ts:439-458 and 1644-1646), so they are never matched by the SQLite fallback. I reproduced this with a temporary migrated fixture: after deleting threadId-map.json and index.json, findManagedThread(originalTarget) returned the thread, while findManagedThread({sessionId:\"generated-session-001\", sessionFilePath:\".../projection-001.jsonl\"}) returned ok with no value. tests/thread/sqlite-thread-migration.test.ts:167-192 only exercises the original target, so this gap is not covered by the story tests."
        affectedFiles:
          - "src/thread/store/sqlite-thread-store.ts"
          - "tests/thread/sqlite-thread-migration.test.ts"
        requirementIds:
          - "TC-1.1c"
          - "TC-2.1c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "SV-02"
        severity: "major"
        title: "Interrupted-migration handling is not reported or persisted as required"
        evidence: "TC-2.4b requires retry after failed/interrupted migration to resume or restart safely and report how partial state was handled; TC-2.5a requires that status in the validation report. The ImportFileBackedThreadResult contract in src/thread/migration/sqlite-thread-migration-service.ts:35-44 has no repeat/partial-status field, and importFileBackedThread only emits a generic 'already existed' warning when the DB path exists (390-398) before reseeding the database. The actual seed path in src/thread/store/sqlite-thread-store.ts:480-507 simply DELETEs and rewrites the thread snapshot transactionally; repo search found no migration_incomplete or migration_runs handling in the migration code. tests/thread/sqlite-thread-migration.test.ts:258-327 simulates a rerun by manually seeding partial rows, but it only asserts row counts plus the generic warning and never verifies any partial-state report. The interrupted-retry/reporting contract is therefore still missing."
        affectedFiles:
          - "src/thread/migration/sqlite-thread-migration-service.ts"
          - "src/thread/store/sqlite-thread-store.ts"
          - "tests/thread/sqlite-thread-migration.test.ts"
        requirementIds:
          - "TC-2.4b"
          - "TC-2.5a"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    requirementCoverage:
      verified:
        - "TC-1.1a"
        - "TC-1.2a"
        - "TC-1.2c"
        - "TC-1.3a"
        - "TC-1.3b"
        - "TC-1.4a"
        - "TC-1.4b"
        - "TC-1.5a"
        - "TC-1.6a"
        - "TC-1.7a"
        - "TC-1.7b"
        - "TC-1.8a"
        - "TC-1.8b"
        - "TC-1.9a"
        - "TC-1.9b"
        - "TC-1.10a"
        - "TC-1.10b"
        - "TC-2.1a"
        - "TC-2.1b"
        - "TC-2.2a"
        - "TC-2.2b"
        - "TC-2.3a"
        - "TC-2.3b"
        - "TC-2.4a"
        - "TC-2.5b"
      unverified:
        - "TC-1.1b"
        - "TC-1.1c"
        - "TC-1.2b"
        - "TC-1.5b"
        - "TC-1.6b"
        - "TC-2.1c"
        - "TC-2.4b"
        - "TC-2.5a"
    gatesRun:
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "After migration, authoritative SQLite lookup still fails for generated-rollout identities once threadId-map.json/index.json are removed; only the original thread target is recoverable from SQLite alone."
      - "The migration path currently treats reruns as 'delete and reseed' and does not persist or report interrupted-run state."
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
[]
    additionalObservations:
      - "npm run verify-all passed locally (522 service tests and 15 e2e tests), but the current gate does not exercise generated-rollout lookup without the JSON maps and it does not verify interrupted-migration reporting."
      - "I did not find a fake adapter, shim, or placeholder execution branch in the touched production migration path; the story uses real FileThreadStore fixtures and real SQLite databases."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/004-verify.json"
  startedAt: "2026-05-26T03:57:37.397Z"
  finishedAt: "2026-05-26T04:07:11.551Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/story-lead/001-current.json
Bytes: 2471

```yaml
storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
storyId: "01-full-migration-and-entity-coverage"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "quick-fix completed with outcome ready-for-verification and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/004-verify.json"
    provenance: "current-run"
  -
    kind: "quick-fix-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/001-quick-fix.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e625f-e4b9-71d2-a556-e42b325cff9a"
    storyId: "01-full-migration-and-entity-coverage"
  storyVerifier:
    provider: "codex"
    sessionId: "019e626e-5224-7d81-94ce-c3b05f789b90"
    storyId: "01-full-migration-and-entity-coverage"
latestEventSequence: 13
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "The latest verifier outcome is revise with two blocking major findings, so acceptance is not allowed. Both findings are concrete, story-local, and fixable within the current implementation scope; the smallest safe next action is a bounded quick-fix targeting those verifier findings before re-verification."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/001-quick-fix.json"
replayBoundary: null
updatedAt: "2026-05-26T04:13:38.099Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After quick-fix returns, send the updated artifact back to verifier; accept only after verifier outcome is pass with no open findings and story gate evidence remains sufficient.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-26T03:41:51.739Z; note="After implementor returns, route first to self-review or verifier depending on whether the implementation reports complete targeted test coverage and gate evidence."
- sequence=8; actionSequence=7; createdAt=2026-05-26T03:57:37.361Z; note="After verifier returns, accept only if verifier outcome is pass with no open findings and story gate evidence remains sufficient; otherwise route to quick-fix, continue, block, or ruling based on verifier findings."
- sequence=12; actionSequence=11; createdAt=2026-05-26T04:07:21.696Z; note="After quick-fix returns, send the updated artifact back to verifier; accept only after verifier outcome is pass with no open findings and story gate evidence remains sufficient."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/story-lead/001-events.jsonl
Bytes: 6241

```yaml
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 1
  timestamp: "2026-05-26T03:41:32.464Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 2
  timestamp: "2026-05-26T03:41:51.712Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e625f-9afb-7fb1-b082-17e57da3cead"
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 3
  timestamp: "2026-05-26T03:41:51.738Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementor returns, route first to self-review or verifier depending on whether the implementation reports complete targeted test coverage and gate evidence."
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 4
  timestamp: "2026-05-26T03:41:51.739Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementor returns, route first to self-review or verifier depending on whether the implementation reports complete targeted test coverage and gate evidence."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 5
  timestamp: "2026-05-26T03:57:16.470Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 6
  timestamp: "2026-05-26T03:57:37.336Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e626e-0042-75a2-adf6-fe9741413a33"
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 7
  timestamp: "2026-05-26T03:57:37.360Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "After verifier returns, accept only if verifier outcome is pass with no open findings and story gate evidence remains sufficient; otherwise route to quick-fix, continue, block, or ruling based on verifier findings."
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 8
  timestamp: "2026-05-26T03:57:37.361Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After verifier returns, accept only if verifier outcome is pass with no open findings and story gate evidence remains sufficient; otherwise route to quick-fix, continue, block, or ruling based on verifier findings."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 9
  timestamp: "2026-05-26T04:07:11.560Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/004-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 10
  timestamp: "2026-05-26T04:07:21.676Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/01-full-migration-and-entity-coverage/story-lead/prompts/001-planner-turn-003.md"
    sessionId: "019e6277-14d5-77a0-ab0f-21c8c21b01ae"
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 11
  timestamp: "2026-05-26T04:07:21.695Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-quick-fix."
  data:
    actionType: "run-quick-fix"
    turn: 3
    selfNote: "After quick-fix returns, send the updated artifact back to verifier; accept only after verifier outcome is pass with no open findings and story gate evidence remains sufficient."
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 12
  timestamp: "2026-05-26T04:07:21.696Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After quick-fix returns, send the updated artifact back to verifier; accept only after verifier outcome is pass with no open findings and story gate evidence remains sufficient."
    actionSequence: 11
    actionType: "run-quick-fix"
    turn: 3
-
  storyRunId: "01-full-migration-and-entity-coverage-story-run-001"
  sequence: 13
  timestamp: "2026-05-26T04:13:38.099Z"
  type: "child-operation-completed"
  summary: "quick-fix completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/06-sqlite-persistence/artifacts/quick-fix/001-quick-fix.json"
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
