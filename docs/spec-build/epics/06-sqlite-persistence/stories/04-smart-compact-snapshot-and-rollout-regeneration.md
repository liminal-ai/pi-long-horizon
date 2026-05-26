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
