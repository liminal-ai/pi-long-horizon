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
