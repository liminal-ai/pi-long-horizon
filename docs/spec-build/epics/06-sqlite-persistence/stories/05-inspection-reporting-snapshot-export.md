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
