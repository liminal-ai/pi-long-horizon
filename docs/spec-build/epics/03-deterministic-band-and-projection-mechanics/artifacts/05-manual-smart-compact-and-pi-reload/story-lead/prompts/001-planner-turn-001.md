# Story Lead Base Prompt

## Role Charter
You are the story lead for `05-manual-smart-compact-and-pi-reload` on durable story run `05-manual-smart-compact-and-pi-reload-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 1.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/05-manual-smart-compact-and-pi-reload.md
Bytes: 13001

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


### Test Plan
### test-plan
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md
Bytes: 18628

# Test Plan: Deterministic Band And Projection Mechanics

## Purpose

This test plan maps every Test Condition from Epic 3 to a concrete test file
and behavior. It is the authoritative TC-to-test matrix for Feature 3.

Feature 3 currently has **67 epic TCs**. The count comes from:

- Flow 1: 8
- Flow 2: 11
- Flow 3: 8
- Flow 4: 15
- Flow 5: 15
- Flow 6: 10

This plan maps each TC to one primary test location. It also adds **12 non-TC
decided tests** for design risks that are not captured one-to-one in the epic.

The primary confidence layers are:

- service-mock tests over public entry points inside each surface
- integration tests over real file-backed state transitions
- E2E tests over the command-driven deterministic maintenance loop

Feature 3 is exactly the sort of interlocking lifecycle where E2E should not be
an afterthought. It still stays smaller than the service suite, but it must hit
the real seams.

## Test Architecture

Tests follow the service-mock philosophy:

- enter at public service or command boundaries
- exercise internal modules together
- mock only true external boundaries

For Feature 3, the “external boundary” usually means:

- filesystem faults or process-control seams
- PI CLI harness adapter behavior

The highest-value service and integration tests are still store-snapshot-driven:

- create a Thread with known Messages, Turns, and source metadata
- persist or omit smooth/chunk/placeholder artifacts intentionally
- create Thread Views with known selections when needed
- invoke the public service or command under test
- assert on persisted state transitions, emitted messages, PI-target files, or
  explicit blockers

### Primary Test Locations

```text
tests/thread/
  foundation.test.ts
  smooth-turn-service.test.ts
  chunk-service.test.ts
  placeholder-artifact-service.test.ts
  async-thread-run-service.test.ts
  thread-async.integration.test.ts

tests/thread-view/
  thread-view-builder.test.ts
  thread-view-materializer.test.ts
  pi-thread-view-builder.test.ts
  pi-thread-view-writer.test.ts
  pi-thread-view-writer.integration.test.ts

tests/workbench/
  workbench-query-service.test.ts
  workbench-lower-band.integration.test.ts

tests/harness-adapter/
  pi-cli-ha.test.ts

tests/commands/
  smart-compact.test.ts
  smart-compact.integration.test.ts
  smart-compact.e2e.test.ts
```

## Mock And Fixture Strategy

Required fixture builders:

| Builder | Purpose |
|---|---|
| `makeThreadSnapshot()` | Canonical source Thread with Messages, Turns, and metadata |
| `makeSmoothTurnState()` | Deterministic smooth artifact fixture |
| `makeChunkState()` | Open/closed chunk lifecycle fixture |
| `makePlaceholderArtifactState()` | Detailed/brief placeholder fixture |
| `makeThreadView()` | Draft, active, or archived Thread View fixture |
| `makePiThreadViewFile()` | PI-target output fixture |
| `withTempThreadStore()` | Real temp root for thread + async-thread state |
| `withTempFeature3Store()` | Real temp root for thread + Thread View + PI-target output |

Mock boundaries:

| Boundary | Treatment |
|---|---|
| Canonical Thread store | Real temp directories for integration and E2E; fake only for unit tests if the unit is not about store behavior |
| Thread View store | Real temp directories for integration and E2E |
| PI CLI harness adapter | Mock in most service and integration tests; use a real adapter double in E2E |
| Filesystem failure paths | Mock or inject faultable writer at the file-writer boundary |
| Internal services | Do not mock across internal domain boundaries |

## TC Mapping

### `tests/thread/smooth-turn-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-1.1a | closed turn receives smooth text | Closed turn without current smooth artifact | Smooth text and token count written |
| TC-1.1b | open turn does not receive final smooth text | Open turn | No final smooth artifact written |
| TC-1.2a | smooth text preserves fixed actor section markers | Closed turn with user/assistant/tool/thinking content | Marker-based output preserved |
| TC-1.2b | one smooth text field per turn | Closed multi-message turn | Single smooth text field produced |
| TC-1.3a | whitespace normalization is deterministic | Irregular whitespace in input | Normalized output stable |
| TC-1.3b | tool-output handling follows fixed policy | Oversized tool output | Deterministic truncation/removal applied |
| TC-1.4a | missing smooth output is explicit | Closed turn without smooth state | Missing status surfaced |
| TC-1.4b | stale or invalid smooth output can be regenerated | Stale/invalid smooth state | Repair regenerates smooth artifact |

### `tests/thread/chunk-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-2.1a | open or unsmoothed turn is not eligible | Open turn or no smooth state | Not chunk-eligible |
| TC-2.1b | closed smoothed turn becomes eligible | Closed turn with smooth artifact | Eligible |
| TC-2.2a | exactly one open chunk exists | Normal thread state | One open chunk only |
| TC-2.2b | closed chunk remains closed | Existing closed chunk | No new turn appended |
| TC-2.3a | eligible turn joins open chunk | Open chunk + eligible turn | Turn appended |
| TC-2.3b | chunk order follows turn order | Multiple eligible turns | Source order preserved |
| TC-2.4a | chunk stays open below threshold | Open chunk under min | Remains open |
| TC-2.4b | chunk closes on soft threshold condition | Open chunk at min and next turn exceeds soft max | Current chunk closes, next opens |
| TC-2.4c | hard-cap closure is explicit | Open chunk reaches/exceeds hard max | Closes with `hard_max` reason |
| TC-2.5a | closed chunk reports closed state and token size | Closed chunk | Closed state and token count visible |
| TC-2.5b | open chunk reports partial state | Open chunk | Open state and token count visible |

### `tests/thread/placeholder-artifact-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-3.1a | closed chunk gets 30 percent placeholder | Closed chunk without detailed placeholder | Detailed placeholder written |
| TC-3.1b | detailed placeholder explicitly marked | Placeholder detailed output | Marker visible |
| TC-3.2a | closed chunk gets 5 percent placeholder | Closed chunk without brief placeholder | Brief placeholder written |
| TC-3.2b | brief placeholder explicitly marked | Placeholder brief output | Marker visible |
| TC-3.3a | placeholder output deterministic for same source state | Same closed chunk rebuilt twice | Same output |
| TC-3.3b | placeholder output can regenerate after deletion | Missing placeholder artifact | Recreated deterministically |
| TC-3.4a | detailed placeholder records token count | Detailed placeholder written | Token count persisted |
| TC-3.4b | brief placeholder records token count and strategy | Brief placeholder written | Token count and strategy persisted |

### `tests/thread-view/thread-view-builder.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-4.1a | rebuild accepts explicit run inputs | Valid lower bound and band percentages | Inputs accepted |
| TC-4.1b | rebuild rejects invalid run inputs | Invalid lower bound or band mix | Rejects explicitly |
| TC-4.2a | full-fidelity selection starts from newest turns | Ordered turns with token sizes | Newest-first selection |
| TC-4.2b | full-fidelity does not split turns | Turn too large to split | Turn included or excluded whole |
| TC-4.2c | full-fidelity-only overage is explicit | Raw recent turns alone exceed lower bound | Overage explicit |
| TC-4.3a | smooth band begins after full-fidelity region by default | Full-fidelity selected, no bespoke override | Smooth starts at next older eligible turns |
| TC-4.3b | smooth band does not split turns | Smooth turn near boundary | Whole-turn behavior preserved |
| TC-4.4a | closed chunk can enter lower band | Closed chunk with placeholder artifact | Eligible |
| TC-4.4b | open chunk cannot enter lower band | Open chunk | Not eligible |
| TC-4.4c | no closed chunks leaves lower bands empty | No closed chunks present | Detailed and brief bands explicit empty |
| TC-4.6a | rebuild lands at or below lower bound | Enough artifacts available | Rebuild within target |
| TC-4.6b | rebuild failure to reach lower bound is explicit | Target cannot be met | Explicit degraded/blocked result |
| TC-4.6c | invalid band percentages rejected before allocation | Invalid mix | Rejects before selection |

### `tests/thread-view/thread-view-materializer.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-4.5a | materialized emitted sequence preserves band order | Draft with multiple bands selected | Emitted messages follow band order |
| TC-4.5b | empty band does not corrupt materialization | One or more empty bands | Materialization still succeeds correctly |

### `tests/thread-view/pi-thread-view-builder.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-5.6b | placeholder lower-band outputs remain explicit in PI-target output | Thread View with placeholder lower-band messages | PI-target entries preserve placeholder explicitness |

### `tests/thread-view/pi-thread-view-writer.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-5.2a | PI-target file write is atomic | Valid PI Thread View file | Atomic write succeeds |
| TC-5.2b | failed write does not leave partial current target | Injected write failure | Current target unchanged |
| TC-5.3a | prior output archived on successful replacement | Existing current output | Archive path created |
| TC-5.3b | first output does not require archive | No prior output | Write succeeds without archive |

### `tests/harness-adapter/pi-cli-ha.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-5.4a | PI load triggered after successful write | Valid file path + harness double | Load request issued |
| TC-5.4b | reload failure explicit | Harness load failure | Failure surfaced explicitly |

### `tests/commands/smart-compact.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-5.1a | command accepts explicit per-run inputs | Valid command args | Inputs accepted |
| TC-5.1b | command rejects invalid per-run inputs | Invalid command args | Run rejected |
| TC-5.1c | command verifies required smooth output | Missing or present smooth state | Smooth prerequisite checked |
| TC-5.1d | command verifies required placeholder output | Missing or present placeholders | Lower-band prerequisite checked |
| TC-5.1e | first smart compact can bootstrap deterministic artifacts | Fresh thread without artifacts | Bootstrap or explicit stop |
| TC-5.5a | command does not mutate canonical source records | Successful compact | Source Thread unchanged |
| TC-5.5b | generated output remains identifiable as projection output | Successful compact | Output metadata identifies generated file |
| TC-5.6a | compact succeeds without model summaries | Deterministic artifacts available | Success path works with no model |
| TC-6.3a | above-target draft reports degraded threshold result | Rebuild stays above lower bound | Degraded threshold state explicit |
| TC-6.3b | compaction can stop on threshold failure | Lower bound cannot be met | Stop explicit, not silent success |

### `tests/workbench/workbench-query-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-6.4a | blocked smooth or chunk state appears in inspectable records | Persisted blocked smooth/chunk state | Normal workbench inspection shows blockers |
| TC-6.4b | projection failure state appears in inspectable output metadata | Persisted write/load failure metadata | Workbench inspection shows failure |
| TC-6.5a | placeholder strategy visible in lower-band records | Placeholder artifacts persisted | Strategy visible in inspection |
| TC-6.5b | Feature 3 output does not claim semantic summary quality | Placeholder lower-band output present | Inspection keeps placeholder quality explicit |

### `tests/thread/async-thread-run-service.test.ts`

| TC | Test Name | Setup | Assert |
|---|---|---|---|
| TC-6.1a | missing smooth output blocks dependent work explicitly | Missing smooth state | Blocked status explicit |
| TC-6.1b | missing placeholder output blocks lower-band use explicitly | Missing placeholder state | Blocked status explicit |
| TC-6.2a | invalid chunk state reported explicitly | Invalid chunk lifecycle | Invalid state surfaced |
| TC-6.2b | invalid Thread View materialization state reported explicitly | Inconsistent selection/materialization input | Invalid state surfaced |

## Non-TC Decided Tests

| ID | Test File | Test Name |
|---|---|---|
| NTC-1 | `tests/thread/foundation.test.ts` | deterministic id and token-count helpers are stable across reruns |
| NTC-2 | `tests/thread/foundation.test.ts` | thread-scoped mutation coordinator rejects stale revision writes cleanly |
| NTC-3 | `tests/thread/smooth-turn-service.test.ts` | empty or noise-only sections are omitted without collapsing section order incorrectly |
| NTC-4 | `tests/thread/chunk-service.test.ts` | hard-max closure creates the next open chunk in the same update pass |
| NTC-5 | `tests/thread/placeholder-artifact-service.test.ts` | repeated regeneration preserves explicit placeholder markers |
| NTC-6 | `tests/thread-view/thread-view-builder.test.ts` | lower-band selection rejects closed-chunk ids missing required persisted artifacts |
| NTC-7 | `tests/thread-view/thread-view-materializer.test.ts` | band order preserved when multiple middle or lower bands are empty |
| NTC-8 | `tests/thread-view/pi-thread-view-builder.test.ts` | PI-target entries preserve generated-source markers for smooth and placeholder content |
| NTC-9 | `tests/commands/smart-compact.test.ts` | strict mode reports blockers without mutating draft or output state |
| NTC-10 | `tests/commands/smart-compact.test.ts` | prepare mode repairs missing deterministic artifacts then continues |
| NTC-11 | `tests/workbench/workbench-query-service.test.ts` | chunk-backed lower-band inspection remains available after store reopen |
| NTC-12 | `tests/harness-adapter/pi-cli-ha.test.ts` | load requests remain idempotent when same file is requested twice |

## Chunk Test Counts

Epic story estimates were directional. The test plan is the exact
reconciliation.

Chunk counts are by **story/AC ownership**, not purely by test-file location.
That matters for Feature 3 because some threshold-failure behavior from Story 6
is observed at the `smart-compact` command seam and therefore lives in
`tests/commands/smart-compact.test.ts` even though the owning ACs remain in
Chunk 6.

| Chunk | Primary TC Tests | Non-TC Tests | Total |
|---|---:|---:|---:|
| Chunk 0: Foundation and surface migration | 0 | 2 | 2 |
| Chunk 1: Deterministic smooth turns | 8 | 1 | 9 |
| Chunk 2: Deterministic chunk lifecycle | 11 | 1 | 12 |
| Chunk 3: Placeholder lower-fidelity outputs | 8 | 1 | 9 |
| Chunk 4: Deterministic Thread View rebuild and materialization | 15 | 2 | 17 |
| Chunk 5: Manual smart compact, PI-target output, archive, and PI load | 15 | 4 | 19 |
| Chunk 6: Blocked/degraded deterministic maintenance state and inspectability | 10 | 1 | 11 |
| Total | 67 | 12 | 79 |

### Chunk 0 Migration Verification

Chunk 0 includes real surface/name migration scaffolding. Even if the migration
is implemented incrementally or through compatibility re-exports, it needs a
regression gate beyond the 2 local non-TC tests:

- run the full existing Epic 1 + Epic 2 suites after the migration step
- require `npm run verify-all` to stay green before Feature 3 implementation
  proceeds

This is a gate requirement, not a new Epic 3 TC.

## Integration Tests

Feature 3 needs explicit integration coverage over real file-backed state. These
are additive to the 79 primary planned tests above.

| Test File | Focus |
|---|---|
| `tests/thread/thread-async.integration.test.ts` | smooth state, chunk lifecycle, and placeholder artifacts survive reopen and remain usable |
| `tests/thread-view/pi-thread-view-writer.integration.test.ts` | PI-target file write and archive behavior against real temp directories |
| `tests/commands/smart-compact.integration.test.ts` | command path runs over real thread + thread-view + PI-target stores with harness double |
| `tests/workbench/workbench-lower-band.integration.test.ts` | workbench lower-band inspection uses real chunk-backed persisted state |

## E2E Tests

Feature 3 E2E means:

- end-to-end through the full command and service stack
- against real file-backed Thread and Thread View state
- with a real PI CLI harness adapter double for automated runs
- plus optional manual dogfood against actual PI CLI after the automated gate

The E2E suite should stay smaller than the service suite, but it must cover the
real seams and meaningful edge cases.

Planned E2E scenarios:

1. first smart compact bootstraps deterministic artifacts from a fresh Thread
2. repeated smart compact archives prior PI-target output and loads the new one
3. invalid compaction inputs reject before any state mutation
4. open chunk remains out of lower bands during rebuild
5. missing smooth artifact blocks strict-mode compact explicitly
6. missing placeholder artifact blocks lower-band use explicitly
7. full-fidelity-only overage produces explicit degraded threshold result
8. placeholder lower-band output remains explicit in the written PI-target file
9. persisted smooth/chunk/placeholder state survives restart and a later compact run
10. successful PI-target write followed by PI load failure reports explicit reload failure while preserving the newly written target and archive outcome
11. prepare mode repairs missing deterministic artifacts on a non-fresh Thread and then completes compact successfully
12. failed compact leaves blocked or degraded state inspectable through normal read surfaces after the command returns

These can live in `tests/commands/smart-compact.e2e.test.ts` unless the suite
becomes large enough to split by scenario family.

### Deep-Gate Count

- 79 primary planned tests
- 4 integration tests
- 12 E2E tests
- 95 planned tests at the full deep gate when all suites exist

## Verification Commands

| Gate | Command | Expected Use |
|---|---|---|
| `red-verify` | `npm run red-verify` | After Red tests are written and expected to fail |
| `verify` | `npm run verify` | Standard development gate |
| `green-verify` | `npm run green-verify` | After implementation passes and test files remain unchanged |
| `verify-all` | `npm run verify-all` | Story completion and release-ready deep gate |


## Current Run Index
- planner_turn_index: 1
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-orchestrate-run
- current_child_operation: none
- current_summary: Story orchestration started and durable state has been initialized.
- latest_response_kind: none
- latest_response_path: none
- older_response_count: 0
- caller_input_artifact_count: 0
- prior_self_note_count: 0
- latest_self_note: "none"

## Response Trail
<current_response>
No prior bounded child response is recorded yet.
</current_response>

<history_responses>
No older response entries are recorded yet.
</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/05-manual-smart-compact-and-pi-reload/story-lead/001-current.json
Bytes: 1012

```yaml
storyRunId: "05-manual-smart-compact-and-pi-reload-story-run-001"
storyId: "05-manual-smart-compact-and-pi-reload"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "Story orchestration started and durable state has been initialized."
currentPhase: "story-orchestrate-run"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/05-manual-smart-compact-and-pi-reload/001-story-validate.json"
    provenance: "prior-run"
latestContinuationHandles:
{}
latestEventSequence: 1
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "orient-from-disk"
  summary: "Orient from 1 existing story artifact(s)."
replayBoundary: null
updatedAt: "2026-05-11T04:04:48.844Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
No prior runtime self-notes are recorded yet.

## Seeded Self-Note Example
Seeded first-turn instruction (not a prior runtime self-note): include `selfNote` when you want to leave a durable reminder for a later planner turn, for example `Track whether the next verifier pass still needs the ruling evidence.`

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/05-manual-smart-compact-and-pi-reload/story-lead/001-events.jsonl
Bytes: 237

```yaml
-
  storyRunId: "05-manual-smart-compact-and-pi-reload-story-run-001"
  sequence: 1
  timestamp: "2026-05-11T04:04:48.843Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
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
Bytes: 215

```yaml
storyGate: "npm run verify"
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
