# Story 5: Manual Smart Compact And PI Reload

### Summary
<!-- Jira: Summary field -->

Manual smart compact accepts explicit per-run compaction inputs, verifies deterministic prerequisites, writes generated PI session output atomically, archives prior output, reloads PI, and preserves source/projection distinction.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Objective**

Deliver the manual smart compact command. The operator runs smart compact with explicit per-run inputs (lower-bound target and band-allocation percentages). The command validates inputs, checks deterministic prerequisites (smooth output, placeholder lower-band output), supports strict or prepare mode, writes the generated PI session file atomically using PI's native session-file format, archives the prior generated output, reloads PI through the existing session-switch path, and preserves the distinction between source truth and generated output. The command can also bootstrap a fresh Thread that has never been compacted.

**Scope**

In scope:
- Accept explicit per-run compaction inputs
- Reject invalid per-run compaction inputs
- Verify required smooth output exists
- Verify required placeholder lower-band output exists
- Bootstrap missing deterministic artifacts on first smart compact (or stop explicitly)
- Strict mode: report blockers, stop if artifacts missing
- Prepare mode: run missing deterministic artifact preparation, then continue if ready
- Generated PI session file uses PI's native session-file format
- Atomic write of generated PI session file
- Failed write does not leave partial output as current target
- Archive prior generated output on successful replacement
- First generated output succeeds without requiring archive
- PI reload triggered after successful write, through existing session-switch path
- Reload failure reported explicitly
- Source Thread unchanged after compact
- Generated output identifiable as projection output
- Smart compact succeeds with deterministic placeholder lower-band content
- Placeholder nature remains explicit in generated output

Out of scope:
- Automatic smart compact trigger (future)
- Persisted default compaction policies (future)
- Non-PI projection targets (future)

**Dependencies**

- Story 4 (deterministic band rebuild)
- Story 0 (error/blocker codes)
- Stories 1–3 (async-thread readiness services for prerequisite checking)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-5.1:** Manual smart compact accepts explicit run inputs and checks deterministic prerequisites before writing a generated PI session file.

- **TC-5.1a: Smart compact accepts explicit per-run compaction inputs**
  - Given: The operator starts manual smart compact
  - When: the command begins
  - Then: the command accepts explicit lower-bound and band-allocation inputs for that run
- **TC-5.1b: Smart compact rejects invalid per-run compaction inputs**
  - Given: The operator provides invalid compaction inputs
  - When: manual smart compact begins
  - Then: the command rejects the run explicitly
- **TC-5.1c: Smart compact verifies required smooth output**
  - Given: Smart compact starts
  - When: prerequisites are checked
  - Then: the command verifies that required smooth Turn output exists
- **TC-5.1d: Smart compact verifies required placeholder lower-band output**
  - Given: Smart compact starts
  - When: prerequisites are checked
  - Then: the command verifies that required placeholder detailed and brief outputs exist for selected lower-band Chunks
- **TC-5.1e: First smart compact can bootstrap missing deterministic artifacts**
  - Given: A Thread has never previously been compacted and required deterministic derived artifacts do not yet exist
  - When: manual smart compact starts
  - Then: the command can bootstrap the required deterministic smoothing, chunk, and placeholder work or stop explicitly naming the missing prerequisite

**AC-5.2:** Manual smart compact writes the generated PI session file atomically.

- **TC-5.2a: Generated PI session file is written atomically**
  - Given: Smart compact has a valid draft Thread View to project
  - When: the generated PI session file is written
  - Then: the file write is atomic
- **TC-5.2b: Failed write does not leave partial generated output as the current target**
  - Given: generated file writing fails mid-operation
  - When: smart compact handles the failure
  - Then: the current generated target is not left pointing at a partial write

**AC-5.3:** Manual smart compact archives the prior generated output when a new one is written.

- **TC-5.3a: Prior generated output is archived on successful replacement**
  - Given: A current generated PI session file exists
  - When: smart compact writes a new generated PI session file successfully
  - Then: the prior generated output is archived
- **TC-5.3b: First generated output does not require prior archive**
  - Given: No prior generated PI session file exists
  - When: smart compact writes the first generated output
  - Then: the write succeeds without requiring an archive step

**AC-5.4:** Manual smart compact reloads PI from the new generated PI session file.

- **TC-5.4a: PI reload is triggered after successful generated write**
  - Given: Smart compact writes a new generated PI session file successfully
  - When: the compact operation completes
  - Then: PI reload is triggered against the new generated file
- **TC-5.4b: Reload failure is explicit**
  - Given: Generated output writing succeeded but PI reload fails
  - When: smart compact completes
  - Then: the reload failure is reported explicitly

**AC-5.5:** Manual smart compact preserves the distinction between source truth and generated output.

- **TC-5.5a: Smart compact does not mutate canonical source Messages or Turns**
  - Given: Smart compact runs successfully
  - When: source Thread state is inspected afterward
  - Then: canonical Messages and Turns remain source truth and are not rewritten as generated output
- **TC-5.5b: Generated output remains identifiable as projection output**
  - Given: Smart compact has written a generated PI session file
  - When: projection metadata is inspected
  - Then: the generated file is identifiable as projection output rather than canonical source state

**AC-5.6:** Manual smart compact can succeed using deterministic placeholder lower-fidelity content.

- **TC-5.6a: Smart compact succeeds without model-generated summaries**
  - Given: deterministic smooth output and deterministic placeholder lower-band outputs are available
  - When: manual smart compact runs
  - Then: the operation can complete successfully without requiring model-generated summaries
- **TC-5.6b: Placeholder lower-band outputs remain explicit after compaction**
  - Given: a generated PI session file contains lower-band content from placeholder representations
  - When: that output is inspected through projection metadata or fixtures
  - Then: the placeholder nature of those lower-band representations remains explicit

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the application seam of Feature 3. It is where all the lower
layers finally get sequenced into one operator-facing operation. Because it
crosses surfaces, it should not hide inside `thread`, `async-thread`,
`thread-view`, or `pi-cli-ha`. It belongs in the command/application layer.

This story owns:
- input validation
- strict vs prepare mode selection
- rebuild invocation
- PI-target file build/write/archive
- PI load handoff
- final compact result shape

It does not own the internal logic of smoothing, chunking, placeholder
generation, or rebuild itself. It consumes those services.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Smart compact command | `src/commands/smart-compact.ts` |
| PI-target file builder | `src/thread-view/targets/pi/pi-thread-view-builder.ts` |
| PI-target file writer | `src/thread-view/targets/pi/pi-thread-view-writer.ts` |
| PI CLI harness adapter | `src/harness-adapter/pi-cli-ha/pi-cli-ha.ts`, `src/harness-adapter/pi-cli-ha/load-thread-view-file.ts` |
| Async-thread preparation seam | `src/thread/async-thread/services/async-thread-run-service.ts` |

#### Design References

- [tech-design-thread-view.md §Sequence: Flow 5 Manual Smart Compact And PI Reload](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread-view.md:162), lines 162-231
- [tech-design-thread-view.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread-view.md:248), lines 248-333
- [test-plan.md §`tests/commands/smart-compact.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:199), lines 199-212
- [test-plan.md §`tests/thread-view/pi-thread-view-writer.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:183), lines 183-190
- [test-plan.md §`tests/harness-adapter/pi-cli-ha.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:192), lines 192-197

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-5.1a | `tests/commands/smart-compact.test.ts` | command accepts explicit per-run inputs |
| TC-5.1b | `tests/commands/smart-compact.test.ts` | command rejects invalid per-run inputs |
| TC-5.1c | `tests/commands/smart-compact.test.ts` | command verifies required smooth output |
| TC-5.1d | `tests/commands/smart-compact.test.ts` | command verifies required placeholder output |
| TC-5.1e | `tests/commands/smart-compact.test.ts` | first smart compact can bootstrap deterministic artifacts |
| TC-5.2a | `tests/thread-view/pi-thread-view-writer.test.ts` | PI-target file write is atomic |
| TC-5.2b | `tests/thread-view/pi-thread-view-writer.test.ts` | failed write does not leave partial current target |
| TC-5.3a | `tests/thread-view/pi-thread-view-writer.test.ts` | prior output archived on successful replacement |
| TC-5.3b | `tests/thread-view/pi-thread-view-writer.test.ts` | first output does not require archive |
| TC-5.4a | `tests/harness-adapter/pi-cli-ha.test.ts` and `tests/commands/smart-compact.test.ts` | PI load triggered after successful write |
| TC-5.4b | `tests/harness-adapter/pi-cli-ha.test.ts` and `tests/commands/smart-compact.test.ts` | reload failure explicit |
| TC-5.5a | `tests/commands/smart-compact.test.ts` | command does not mutate canonical source records |
| TC-5.5b | `tests/commands/smart-compact.test.ts` | generated output remains identifiable as projection output |
| TC-5.6a | `tests/commands/smart-compact.test.ts` | compact succeeds without model summaries |
| TC-5.6b | `tests/thread-view/pi-thread-view-builder.test.ts` | placeholder lower-band outputs remain explicit in PI-target output |

#### Non-TC Decided Tests

- `tests/commands/smart-compact.test.ts`: strict mode reports blockers without mutating draft or output state
- `tests/commands/smart-compact.test.ts`: prepare mode repairs missing deterministic artifacts then continues
- `tests/harness-adapter/pi-cli-ha.test.ts`: load requests remain idempotent when the same file is requested twice

#### Technical Notes

The command owns mode selection. The async-thread run service owns what those
modes mean during readiness and repair. Keep that boundary crisp.

#### Anti-Shim Requirements

- Prove the compact command through the real service chain, not by mocking out rebuild and write results into a trivial orchestrator shell.
- Prove archive and load behavior with real file-path outputs and a harness double, not only by asserting a result enum.

#### Verification

- Targeted: `node --import tsx --test tests/commands/smart-compact.test.ts tests/thread-view/pi-thread-view-writer.test.ts tests/harness-adapter/pi-cli-ha.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 15 TCs pass (TC-5.1a through TC-5.6b)
- [ ] Generated PI session file uses PI's native format
- [ ] Prior output archived on replacement
- [ ] PI reload works through session-switch path
- [ ] Source Thread unchanged after compact
- [ ] `npm run verify` passes
