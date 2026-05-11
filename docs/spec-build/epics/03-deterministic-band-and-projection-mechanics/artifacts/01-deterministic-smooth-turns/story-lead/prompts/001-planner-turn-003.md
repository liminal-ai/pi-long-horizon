# Story Lead Base Prompt

## Role Charter
You are the story lead for `01-deterministic-smooth-turns` on durable story run `01-deterministic-smooth-turns-story-run-001`.
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
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/01-deterministic-smooth-turns.md
Bytes: 8397

# Story 1: Deterministic Smooth Turns

### Summary
<!-- Jira: Summary field -->

Closed Turns receive deterministic smooth output with readiness, token counts, and repairable missing/stale state.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Objective**

Deliver deterministic smooth-turn generation for closed Turns. Each closed Turn receives one smooth text representation that concatenates its content into a single readable field with fixed section markers for user, assistant, tool, and thinking content. Whitespace is normalized deterministically. Tool output is truncated or removed by fixed policy. Missing or stale smooth output is reported explicitly and repairable through the same deterministic path.

**Scope**

In scope:
- One deterministic smooth text field per closed Turn
- Fixed section markers preserving actor back-and-forth
- Deterministic whitespace normalization
- Deterministic tool-output truncation/removal policy
- Smooth token count recording
- Smooth readiness state (missing, ready, stale, invalid)
- Smooth strategy recording
- Missing/stale smooth output visibility and repair

Out of scope:
- Model-assisted smoothing (Feature 4)
- Chunk formation (Story 2)
- Open Turn smoothing

**Dependencies**

- Story 0 (domain types, fixtures, error codes)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-1.1:** The steward generates one deterministic smooth representation for each closed Turn.

- **TC-1.1a: Closed Turn receives smooth text**
  - Given: A Turn is closed and has no current smooth output
  - When: deterministic smoothing runs
  - Then: the Turn receives one smooth text representation and a smooth token count
- **TC-1.1b: Open Turn does not receive final smooth text**
  - Given: A Turn is still open
  - When: deterministic smoothing is evaluated
  - Then: the Turn is not marked as having final smooth output

**AC-1.2:** Deterministic smooth output preserves enough structure to remain readable and useful for later chunking.

- **TC-1.2a: Smooth text preserves actor sections**
  - Given: A closed Turn contains content from multiple actor types
  - When: deterministic smoothing runs
  - Then: the smooth text preserves the actor back-and-forth in a standardized readable form using fixed section markers for user, assistant, tool, and thinking content
- **TC-1.2b: Smooth text remains one single text field per Turn**
  - Given: A closed Turn contains multiple source Messages
  - When: deterministic smoothing runs
  - Then: the output is one smooth text field for the Turn rather than multiple separate emitted records

**AC-1.3:** Deterministic smoothing applies only fixed normalization and fixed tool-output rules.

- **TC-1.3a: Whitespace normalization is deterministic**
  - Given: A closed Turn contains irregular whitespace
  - When: deterministic smoothing runs
  - Then: the resulting smooth text applies the same fixed normalization rule each time
- **TC-1.3b: Tool-output handling follows fixed policy**
  - Given: A closed Turn contains tool output large enough to trigger smoothing policy
  - When: deterministic smoothing runs
  - Then: tool output is truncated or removed according to fixed deterministic policy rather than model judgment

**AC-1.4:** Missing, stale, or invalid smooth output is visible and repairable.

- **TC-1.4a: Missing smooth output is explicit**
  - Given: A closed Turn lacks smooth output
  - When: the steward inspects smooth readiness or later work depends on that Turn
  - Then: the missing smooth state is reported explicitly
- **TC-1.4b: Stale or invalid smooth output can be regenerated**
  - Given: A closed Turn has stale or invalid smooth output
  - When: deterministic smooth repair runs
  - Then: the smooth output is regenerated through the same deterministic path

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the first real derived-state step in Feature 3. It turns a closed
Turn into a deterministic smooth artifact that later stories can consume
without needing a model. Everything downstream assumes this story is solid:
chunking depends on smooth readiness, rebuild depends on smooth token counts,
and compact preflight depends on missing or stale smooth state being explicit.

This story lives entirely under `thread/async-thread`. It should not know about
Thread View composition or PI-target output. Its job is simpler and narrower:
read a closed canonical Turn, build one smooth text field in a fixed marker
format, write deterministic state back to the Thread, and support repair when
that state is missing or invalid.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Smooth-turn state types | `src/thread/async-thread/domain/smooth-turn-state.ts` |
| Smooth-turn service | `src/thread/async-thread/services/smooth-turn-service.ts` |
| Smooth formatting helper | `src/thread/async-thread/services/smooth-turn-format.ts` or equivalent helper near the service |
| Supporting source reads | `src/thread/store/thread-store.ts`, `src/thread/services/turn-service.ts` |

#### Design References

- [tech-design-thread.md §Sequence: Flow 1 Smooth Turn Preparation](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:132), lines 132-174
- [tech-design-thread.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:286), lines 286-325
- [test-plan.md §`tests/thread/smooth-turn-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:110), lines 110-121

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-1.1a | `tests/thread/smooth-turn-service.test.ts` | closed turn receives smooth text |
| TC-1.1b | `tests/thread/smooth-turn-service.test.ts` | open turn does not receive final smooth text |
| TC-1.2a | `tests/thread/smooth-turn-service.test.ts` | smooth text preserves fixed actor section markers |
| TC-1.2b | `tests/thread/smooth-turn-service.test.ts` | one smooth text field per turn |
| TC-1.3a | `tests/thread/smooth-turn-service.test.ts` | whitespace normalization is deterministic |
| TC-1.3b | `tests/thread/smooth-turn-service.test.ts` | tool-output handling follows fixed policy |
| TC-1.4a | `tests/thread/smooth-turn-service.test.ts` | missing smooth output is explicit |
| TC-1.4b | `tests/thread/smooth-turn-service.test.ts` | stale or invalid smooth output can be regenerated |

#### Non-TC Decided Tests

- `tests/thread/smooth-turn-service.test.ts`: empty or noise-only sections are omitted without collapsing section order incorrectly

#### Technical Notes

The output format is not free-form. It must preserve fixed section markers for
user, assistant, tool, and thinking content, because later chunking and manual
inspection depend on that structure remaining recognizable.

Smooth state persists on Turn records rather than in a separate smooth-only
store. That keeps deterministic derived Thread state close to the Turn it was
derived from and makes restart behavior easier to reason about.

#### Anti-Shim Requirements

- Prove marker format and ordering against real Turn/Message/Part records, not a pre-baked joined string.
- Prove tool-output truncation/removal against realistic oversized tool content, not a fake boolean flag path.

#### Verification

- Targeted: `node --import tsx --test tests/thread/smooth-turn-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 8 TCs pass (TC-1.1a through TC-1.4b)
- [ ] Smooth state persists on Turn records and survives process restart
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
- planner_turn_index: 3
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-verify completed with outcome revise and status ok.
- latest_response_kind: verifier-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/005-verify.json
- older_response_count: 1
- caller_input_artifact_count: 0
- prior_self_note_count: 2
- latest_self_note: "After verifier returns, accept only if final verifier outcome is pass with no open findings and evidence covers all 8 TCs, the NTC smooth test, Turn-record persistence, and npm run verify."

## Response Trail
<current_response>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/005-verify.json
bytes: 5985
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "3e7f7256-bc47-47dc-b315-fa0c78c77697"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e14ed-aeac-72b0-bbc6-8047979df660"
    continuation:
      provider: "codex"
      sessionId: "019e14ed-aeac-72b0-bbc6-8047979df660"
      storyId: "01-deterministic-smooth-turns"
    mode: "initial"
    story:
      id: "01-deterministic-smooth-turns"
      title: "Story 1: Deterministic Smooth Turns"
    artifactsRead:
      - "docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/stories/01-deterministic-smooth-turns.md"
      - "docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design.md"
      - "docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md"
      - "docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread-view.md"
      - "docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md"
      - "docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/003-implementor.json"
      - "package.json"
      - "scripts/run-node-tests.mjs"
      - "src/context-steward/domain/records.ts"
      - "src/context-steward/store/thread-store.ts"
      - "src/context-steward/store/file-thread-store.ts"
      - "src/context-steward/services/thread-service.ts"
      - "src/thread/store/mutation-coordinator.ts"
      - "src/thread/async-thread/domain/smooth-turn-state.ts"
      - "src/thread/async-thread/services/smooth-turn-format.ts"
      - "src/thread/async-thread/services/smooth-turn-service.ts"
      - "src/thread/async-thread/test/temp-thread-store.ts"
      - "src/thread/async-thread/test/fixtures.ts"
      - "tests/thread/foundation.test.ts"
      - "tests/thread/smooth-turn-service.test.ts"
    reviewScopeSummary: "Initial verification of Story 1 covered the story and full tech-design set, the smooth-turn runtime and persistence paths, the story/foundation tests, the story gate and epic gate, a manual reopen persistence check, and a stale-snapshot overwrite reproduction against the real file store."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "smooth-turn-stale-write-clobber"
        severity: "major"
        title: "Whole-snapshot turn writes can erase previously generated smooth state"
        evidence: "`ensureSmoothTurn` rewrites the entire turn snapshot through `writeTurns` without acquiring `ThreadMutationCoordinator` or any other derived-state lease ([src/thread/async-thread/services/smooth-turn-service.ts:176-228]). `writeTurns` only guards on `thread.sourceRevision` and `messageHighWatermark`, and neither value changes when smooth state is persisted ([src/context-steward/store/file-thread-store.ts:345-363]). A real-store stale-snapshot reproduction succeeded with two writes from the same source revision and dropped the first smooth record, ending with `[ {\"turnId\":\"turn-a\"}, {\"turnId\":\"turn-b\",\"smoothText\":\"[assistant]\\nB\"} ]`. This breaks the guarantee that closed turns keep their deterministic smooth artifact once generated."
        affectedFiles:
          - "src/thread/async-thread/services/smooth-turn-service.ts"
          - "src/context-steward/store/file-thread-store.ts"
          - "src/thread/store/mutation-coordinator.ts"
        requirementIds:
          - "AC-1.1"
          - "AC-1.4"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    openFindings:
      -
        id: "smooth-turn-stale-write-clobber"
        severity: "major"
        title: "Whole-snapshot turn writes can erase previously generated smooth state"
        evidence: "`ensureSmoothTurn` rewrites the entire turn snapshot through `writeTurns` without acquiring `ThreadMutationCoordinator` or any other derived-state lease ([src/thread/async-thread/services/smooth-turn-service.ts:176-228]). `writeTurns` only guards on `thread.sourceRevision` and `messageHighWatermark`, and neither value changes when smooth state is persisted ([src/context-steward/store/file-thread-store.ts:345-363]). A real-store stale-snapshot reproduction succeeded with two writes from the same source revision and dropped the first smooth record, ending with `[ {\"turnId\":\"turn-a\"}, {\"turnId\":\"turn-b\",\"smoothText\":\"[assistant]\\nB\"} ]`. This breaks the guarantee that closed turns keep their deterministic smooth artifact once generated."
        affectedFiles:
          - "src/thread/async-thread/services/smooth-turn-service.ts"
          - "src/context-steward/store/file-thread-store.ts"
          - "src/thread/store/mutation-coordinator.ts"
        requirementIds:
          - "AC-1.1"
          - "AC-1.4"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-1.2"
        - "AC-1.3"
        - "TC-1.1a"
        - "TC-1.1b"
        - "TC-1.2a"
        - "TC-1.2b"
        - "TC-1.3a"
        - "TC-1.3b"
        - "TC-1.4a"
        - "TC-1.4b"
      unverified:
        - "AC-1.1"
        - "AC-1.4"
    gatesRun:
      -
        command: "node --import tsx --test tests/thread/smooth-turn-service.test.ts"
        result: "pass"
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "Derived smooth-state persistence is still vulnerable to stale-snapshot overwrite because runtime code writes the whole `turns.json` snapshot without a derived-state revision/lease that survives beyond the current in-process queue."
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
[]
    additionalObservations:
      - "The mapped Story 1 test file covers all 8 explicit TCs plus the decided empty/noise-only section case, and all of those tests passed."
      - "A manual reopen check with a second `FileThreadStore` instance confirmed that the single-writer happy path does persist smooth state to `turns.json` across store reopen; the blocker is stale-write safety, not basic disk persistence."
      - "No fake adapter, placeholder branch, or mock-only runtime path was found in the smooth-turn formatter/service itself."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/005-verify.json"
  startedAt: "2026-05-11T02:46:21.393Z"
  finishedAt: "2026-05-11T02:52:38.773Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/003-implementor.json
bytes: 3268
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "eebf6515-fbd3-4333-9f5f-160175dde470"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e14e4-2d3f-78a0-998b-429dd28f15a1"
    continuation:
      provider: "codex"
      sessionId: "019e14e4-2d3f-78a0-998b-429dd28f15a1"
      storyId: "01-deterministic-smooth-turns"
    outcome: "ready-for-verification"
    story:
      id: "01-deterministic-smooth-turns"
      title: "Story 1: Deterministic Smooth Turns"
    planSummary: "Implemented deterministic smooth-turn generation for closed turns with persisted readiness/strategy metadata, a fixed marker-based formatter and tool-output policy, plus a new story-level test suite covering all Story 1 TCs and the decided empty-section case."
    changedFiles:
      -
        path: "src/context-steward/domain/records.ts"
        reason: "Expanded persisted turn smooth metadata to store readiness, strategy, generation timestamp, and source revision alongside text/token count."
      -
        path: "src/thread/async-thread/domain/smooth-turn-state.ts"
        reason: "Added smooth-state read result types and conversion helpers for persisted turn smooth records."
      -
        path: "src/thread/async-thread/services/smooth-turn-format.ts"
        reason: "Added deterministic smooth-text formatting with fixed section markers, whitespace normalization, stable object serialization, and deterministic tool-output truncation/removal rules."
      -
        path: "src/thread/async-thread/services/smooth-turn-service.ts"
        reason: "Implemented smooth-state inspection and repair for turns, including stale/invalid detection and persisted regeneration for closed turns."
      -
        path: "tests/thread/smooth-turn-service.test.ts"
        reason: "Added Story 1 coverage for all smooth-turn acceptance criteria plus the empty/noise-only section decided test using real stored thread/message/turn records."
    tests:
      added:
        - "tests/thread/smooth-turn-service.test.ts"
      modified:
[]
      removed:
[]
      totalAfterStory: 222
      deltaFromPriorBaseline: 9
    gatesRun:
      -
        command: "node --import tsx --test tests/thread/smooth-turn-service.test.ts"
        result: "pass"
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Persisted full smooth-turn metadata on turn records so missing, stale, invalid, and ready states are distinguishable and repairable."
        - "Moved deterministic formatting into a dedicated helper with fixed actor markers and tool-output policy so later chunking can rely on stable structure."
        - "Added realistic service tests that exercise real message/part/turn records instead of a pre-joined string, including oversized tool output and omitted noise-only sections."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Proceed to Story 2, using the persisted smooth readiness/token metadata as the input seam for deterministic chunk lifecycle work."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/003-implementor.json"
  startedAt: "2026-05-11T02:35:58.409Z"
  finishedAt: "2026-05-11T02:46:10.382Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/story-lead/001-current.json
Bytes: 2386

```yaml
storyRunId: "01-deterministic-smooth-turns-story-run-001"
storyId: "01-deterministic-smooth-turns"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-verify completed with outcome revise and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/005-verify.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e14e4-2d3f-78a0-998b-429dd28f15a1"
    storyId: "01-deterministic-smooth-turns"
  storyVerifier:
    provider: "codex"
    sessionId: "019e14ed-aeac-72b0-bbc6-8047979df660"
    storyId: "01-deterministic-smooth-turns"
latestEventSequence: 9
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "Implementation reports ready-for-verification with targeted, story, and epic gates passing, but the durable record has no independent verifier result yet. The smallest safe next action is to verify the implementor artifact against Story 1 acceptance requirements, including all 8 mapped TCs, the NTC empty-section case, smooth state persistence on Turn records, and the configured story gate."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/005-verify.json"
replayBoundary: null
updatedAt: "2026-05-11T02:52:38.783Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After verifier returns, accept only if final verifier outcome is pass with no open findings and evidence covers all 8 TCs, the NTC smooth test, Turn-record persistence, and npm run verify.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-11T02:35:58.367Z; note="After implementation returns, verify that all 8 TC tests and the NTC smooth test exist, targeted smooth-turn tests pass, and persistence-on-Turn behavior is evidenced before considering story gate verification."
- sequence=8; actionSequence=7; createdAt=2026-05-11T02:46:21.357Z; note="After verifier returns, accept only if final verifier outcome is pass with no open findings and evidence covers all 8 TCs, the NTC smooth test, Turn-record persistence, and npm run verify."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/story-lead/001-events.jsonl
Bytes: 4298

```yaml
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 1
  timestamp: "2026-05-11T02:35:43.537Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 2
  timestamp: "2026-05-11T02:35:58.345Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e14e3-f318-7073-94eb-21e250bb8bb4"
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 3
  timestamp: "2026-05-11T02:35:58.366Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, verify that all 8 TC tests and the NTC smooth test exist, targeted smooth-turn tests pass, and persistence-on-Turn behavior is evidenced before considering story gate verification."
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 4
  timestamp: "2026-05-11T02:35:58.367Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, verify that all 8 TC tests and the NTC smooth test exist, targeted smooth-turn tests pass, and persistence-on-Turn behavior is evidenced before considering story gate verification."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 5
  timestamp: "2026-05-11T02:46:10.392Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 6
  timestamp: "2026-05-11T02:46:21.327Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e14ed-83b9-79c1-8b1f-b61a87c1aa84"
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 7
  timestamp: "2026-05-11T02:46:21.357Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "After verifier returns, accept only if final verifier outcome is pass with no open findings and evidence covers all 8 TCs, the NTC smooth test, Turn-record persistence, and npm run verify."
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 8
  timestamp: "2026-05-11T02:46:21.357Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After verifier returns, accept only if final verifier outcome is pass with no open findings and evidence covers all 8 TCs, the NTC smooth test, Turn-record persistence, and npm run verify."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "01-deterministic-smooth-turns-story-run-001"
  sequence: 9
  timestamp: "2026-05-11T02:52:38.783Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/artifacts/01-deterministic-smooth-turns/005-verify.json"
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
