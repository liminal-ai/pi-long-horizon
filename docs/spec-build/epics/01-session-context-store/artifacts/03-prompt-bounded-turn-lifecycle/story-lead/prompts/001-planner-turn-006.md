# Story Lead Base Prompt

## Role Charter
You are the story lead for `03-prompt-bounded-turn-lifecycle` on durable story run `03-prompt-bounded-turn-lifecycle-story-run-001`.
Select exactly one bounded next action for this `resume` turn.
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
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/stories/03-prompt-bounded-turn-lifecycle.md
Bytes: 9935

# Story 3: Prompt-Bounded Turn Lifecycle

### Summary
<!-- Jira: Summary field -->

Group captured Messages into prompt-bounded canonical Turns with open/closed lifecycle state, multi-response/tool-cycle membership, and pre-turn source record reporting.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Create canonical Turn state from captured Messages using agent-addressed prompt boundaries instead of PI internal turn boundaries.

**In Scope**

- Open the first canonical Turn from the first agent-addressed prompt.
- Close a prior Turn and open a new Turn when the next initiating prompt arrives.
- Keep responses, tool activity, runtime notes, and intermediate outputs in the current Turn.
- Record open and closed lifecycle status.
- Preserve pre-turn source records outside Turn membership and report their ranges.

**Out of Scope**

- PI event-to-Message mapping. Story 2 owns capture mapping.
- Turn repair from broken state. Story 6 owns repair.
- Import turn reconstruction. Story 5 owns import.

**Dependencies**

- Story 2 complete.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-3.1:** An agent-addressed prompt starts a canonical Turn.

- **TC-3.1a: First prompt opens first turn**
  - Given: A Thread has no open Turn
  - When: The steward captures an agent-addressed prompt
  - Then: A new open Turn is created with the prompt message as the initiating message
- **TC-3.1b: Next prompt closes previous turn**
  - Given: A Thread has an open Turn
  - When: The steward captures the next agent-addressed prompt
  - Then: The previous Turn is closed and a new open Turn is created for the new prompt

**AC-3.2:** Agent responses, tool activity, runtime notes, and intermediate outputs remain in the current canonical Turn until the next agent-addressed prompt.

- **TC-3.2a: Response joins open turn**
  - Given: A Thread has an open Turn
  - When: The steward captures an agent response before the next initiating prompt
  - Then: The response message is associated with the open Turn
- **TC-3.2b: Tool activity joins open turn**
  - Given: A Thread has an open Turn
  - When: The steward captures tool call or tool result activity before the next initiating prompt
  - Then: The tool activity message or part is associated with the open Turn
- **TC-3.2c: Runtime note joins open turn**
  - Given: A Thread has an open Turn
  - When: The steward captures a runtime note that affects session state, turn state, capture state, or repair/import status before the next initiating prompt
  - Then: The runtime note is associated with the open Turn

**AC-3.3:** A canonical Turn can contain multiple assistant responses and tool cycles.

- **TC-3.3a: Multiple responses stay in one turn**
  - Given: A Thread has an open Turn
  - When: PI finalizes multiple agent responses before the next initiating prompt
  - Then: All response messages are associated with the same Turn in source order
- **TC-3.3b: Multiple tool cycles stay in one turn**
  - Given: A Thread has an open Turn
  - When: PI finalizes multiple tool call and tool result cycles before the next initiating prompt
  - Then: All tool activity is associated with the same Turn in source order

**AC-3.4:** Turn state records open and closed lifecycle status.

- **TC-3.4a: Open turn status recorded**
  - Given: An agent-addressed prompt has been captured and no later initiating prompt has been captured
  - When: Turn state is read
  - Then: The Turn status is open and references its current member messages
- **TC-3.4b: Closed turn status recorded**
  - Given: A Turn has been followed by another agent-addressed prompt
  - When: Turn state is read
  - Then: The prior Turn status is closed and references its final member messages

**AC-3.5:** Activity captured before any agent-addressed prompt is visible as pre-turn source records.

- **TC-3.5a: Pre-turn runtime note retained**
  - Given: PI emits a runtime note before the first agent-addressed prompt
  - When: The steward captures the note
  - Then: The note is stored in the source Thread and remains outside Turn membership
- **TC-3.5b: Pre-turn source records reported**
  - Given: A Thread contains source messages before the first agent-addressed prompt
  - When: Turn health is checked
  - Then: The steward reports pre-turn source messages with their source order range

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 3 owns the canonical turn boundary rule for Feature 1: one agent-addressed prompt opens a turn, and all following responses, tool activity, runtime notes, and intermediate outputs stay inside that turn until the next initiating prompt arrives. This is intentionally different from PI's internal turn lifecycle, which is smaller and tool-call-oriented.

The story also owns the pre-turn edge case. Activity can exist before the first initiating prompt, and that activity must stay in the source Thread without being forced into fake Turn membership. Story 6 will later repair or validate turn state using the same boundary rule, so this story should keep the grouping logic centralized and reusable rather than scattering prompt-boundary heuristics across services.

#### Implementation Targets

| Owned Targets | Files / Modules |
|---|---|
| Prompt-boundary grouping and lifecycle | `src/context-steward/services/turn-service.ts` |
| Primary tests | `tests/context-steward/turn-service.test.ts` |

| Integration Touchpoints | Files / Modules |
|---|---|
| Capture-to-turn handoff from Story 2 | `src/context-steward/services/capture-service.ts` |
| Turn persistence contract from Story 1 | `src/context-steward/store/thread-store.ts` |

#### Design References

- [tech-design.md §Module Responsibility Matrix](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:244), lines 244-264
- [tech-design.md §Flow 2: Live PI Activity Capture](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:700), lines 700-754
- [tech-design.md §Flow 5: Turn Health and Repair](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:838), lines 838-881
- [tech-design.md §Core Services](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:923), lines 923-1064
- [tech-design.md §Chunk 2: Live PI Activity Capture and Turn Lifecycle](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1182), lines 1182-1195
- [test-plan.md `turn-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:97), lines 97-114

#### Test Mapping

| TC | Test File / Check | Test Description |
|---|---|---|
| TC-3.1a, TC-3.1b | `tests/context-steward/turn-service.test.ts` | open the first canonical turn from the first prompt and close/open turns on the next prompt |
| TC-3.2a, TC-3.2b, TC-3.2c | `tests/context-steward/turn-service.test.ts` | keep responses, tool activity, and runtime notes inside the current open turn |
| TC-3.3a, TC-3.3b | `tests/context-steward/turn-service.test.ts` | keep multiple responses and tool cycles inside one canonical turn in source order |
| TC-3.4a, TC-3.4b | `tests/context-steward/turn-service.test.ts` | expose open and closed lifecycle status correctly when turn state is read |
| TC-3.5a, TC-3.5b | `tests/context-steward/turn-service.test.ts` | preserve pre-turn source records outside turn membership and report their source-order range |

#### Non-TC Decided Tests

None.

#### Technical Notes

- Never use PI `turn_start` or `turn_end` as canonical turn boundaries. They may inform runtime notes, but this story's grouping rule is based on agent-addressed prompts.
- Pre-turn records must stay outside `TurnRecord.messageIds`; they are reported through health/range output, not shoved into a synthetic "turn 0."
- Story 6 should reuse this story's prompt-boundary helpers for repair rather than implementing a separate repair-only grouping algorithm.

#### Anti-Shim Requirements

- Prove membership through persisted `TurnRecord` content and `messageIds` ordering, not only through helper return values in isolation.
- Cover multi-response and multi-tool-cycle behavior using real captured message sequences so the tests exercise source-order assumptions, not toy arrays.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- Agent-addressed prompts open/close canonical Turns.
- Responses, tool activity, and runtime notes join the current Turn until the next initiating prompt.
- Multiple responses and tool cycles stay in one canonical Turn.
- Turn records expose open and closed lifecycle status.
- Pre-turn source records are retained and reported.
- `turn-service.test.ts` covers all TCs assigned to this story.


### Test Plan
### test-plan
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/test-plan.md
Bytes: 21828

# Test Plan: Session Context Store

## Purpose

This test plan maps every Test Condition from Epic 1 to a concrete test file and behavior. It is the authoritative TC-to-test matrix for Session Context Store implementation. The tech design index explains architecture and interfaces; this document tells implementers exactly where confidence comes from.

Feature 1 has 78 epic TCs. This plan maps each TC to one primary test. It also adds 13 non-TC decided tests for implementation risks that are not captured one-to-one in the epic.

## Test Architecture

Tests follow the service-mock philosophy. Enter through public Context Steward services and PI command handlers, exercise internal modules together, and mock only external boundaries.

| Boundary | Test Treatment |
|---|---|
| Filesystem store | Use real temp directories for store/service tests. This is core behavior, not an external service to mock away. |
| PI extension event payloads | Use typed fixtures that match `@earendil-works/pi-coding-agent` event shapes. |
| PI native session files | Use compact fixture JSONL/session-entry builders and `pi-session-importer` tests. |
| PI UI notifications | Fake `ctx.ui.notify` and assert code/summary rendering. |
| Internal services | Do not mock in service-level tests. Wiring is part of the behavior. |

Primary test locations:

```text
tests/context-steward/
  foundation.test.ts
  thread-store.test.ts
  capture-service.test.ts
  turn-service.test.ts
  import-service.test.ts
  repair-service.test.ts
  fixture-service.test.ts
  pi-extension-commands.test.ts
  file-thread-store.integration.test.ts
```

## Mock and Fixture Strategy

Fixtures should live in `src/context-steward/test/fixtures.ts` for reusable builders and in `tests/fixtures/pi-sessions/` for file-shaped PI session samples.

Required builders:

| Builder | Purpose |
|---|---|
| `makeThreadTarget()` | PI target metadata with session id, file path, and cwd. |
| `makePiUserMessage()` | Finalized agent-addressed prompt event. |
| `makePiAssistantMessage()` | Finalized assistant response with text, reasoning, and tool calls. |
| `makePiToolResultMessage()` | Finalized toolResult message. |
| `makeRuntimeNoteActivity()` | Canonical runtime-note activity for state-affecting events. |
| `makeThreadSnapshot()` | Store snapshot with configurable messages/turns. |
| `makePiSessionEntries()` | Active-path import fixtures with optional branches. |
| `withTempThreadStore()` | Creates isolated `.context-steward` temp root and cleans it up. |

## TC Mapping

### `thread-store.test.ts`

This file is the entry point for persistence rules that do not need PI runtime behavior to be meaningful. It proves thread creation, schema gating, actor reuse, append-only source invariants, and target metadata ownership against the real file-backed store.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-1.1a | creates source thread for new managed PI session | Empty temp store | `openOrCreateManagedThread` | Thread has unique id, `pi` target, schema version, no messages |
| TC-1.1b | opens existing source thread without duplicate | Store has associated Thread | `openOrCreateManagedThread` same target | Same thread id returned; only one active association |
| TC-1.1c | reports store unavailable on session start | Store root made unwritable or fake store throws | `openOrCreateManagedThread` | `STORE_UNAVAILABLE`; no Thread created |
| TC-1.2a | records PI target metadata | New/open Thread target includes session id/path | Read Thread | Target runtime, session id, generated path if supplied |
| TC-1.2b | reads source messages from canonical records | Thread has generated file path and canonical messages | `readMessages` | Messages come from `messages.jsonl`, not generated path |
| TC-1.3a | allows mutation for supported schema | Thread at v1 schema | Append message/write turns | Write succeeds |
| TC-1.3b | blocks mutation for unsupported schema | Thread schema manually set to future version | Append message/write turns | `UNSUPPORTED_SCHEMA_VERSION` |
| TC-1.4a | declares unknown actor before message reference | Capture message with new actor | Append message | Actor exists and message references actor id/type |
| TC-1.4b | reuses existing actor | Store has actor | Append second message from same actor | No duplicate actor; message references same actor |
| TC-2.3a | turn close does not mutate message content | Message belongs to open turn | Close turn via next prompt/writeTurns | Original message fields unchanged |
| TC-2.3b | repair does not mutate message content | Stored messages with broken turns | Run repair | Message content/source order unchanged |
| TC-4.1a | records generated PI session file path | Thread exists | `updateGeneratedSessionMetadata(path)` | `target.currentGeneratedFilePath` set |
| TC-4.1b | represents missing generated path explicitly | Thread has no generated path | Read target metadata | Field absent/undefined and status object says none |
| TC-4.1c | represents absent projection revisions | Thread has no projection records | `readProjectionRevisions` | Empty array, not error |
| TC-4.2a | keeps target session id separate from thread id | Thread target has PI session id | Read Thread identity | `threadId` and `target.sessionId` both visible |
| TC-4.2b | generated file path does not define source order | Thread has generated path and messages | `readMessages` | Order follows `sourceOrder` |
| TC-4.2c | reads projection metadata without source-file import | Thread has projection metadata | Read Thread/projections | Metadata available without reading generated file content |

### `capture-service.test.ts`

These tests exercise the capture seam where PI-finalized activity becomes canonical source history. They intentionally enter through `capture-service` so the PI mapper, duplicate detection, source-order assignment, and partial degradation logic are tested together.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-2.1a | captures finalized prompt | Managed Thread, PI user message | `captureFinalizedActivity` | Prompt message with actor, kind, timestamp, source order, parts, target metadata |
| TC-2.1b | captures finalized agent response | Managed Thread, PI assistant message | Capture | Response message with ordered text/reasoning/tool parts |
| TC-2.1c | captures finalized tool result | Managed Thread, PI toolResult message | Capture | Tool result message with tool metadata and parts |
| TC-2.1d | captures relevant runtime note | Managed Thread, runtime note activity | Capture | Runtime event message with runtime-note part |
| TC-2.1e | preserves rapid finalized event order | Two events queued for same Thread | Capture both sequentially through write queue | Distinct increasing source orders matching observed order |
| TC-2.1f | ignores duplicate finalized event | Existing message indexed by targetEventKey | Capture same targetEventKey | `CAPTURE_DUPLICATE_EVENT`; no appended duplicate |
| TC-2.2a | preserves multiple part order | PI message with text, reasoning, tool call | Map/capture | Parts have semantic order and partOrder 1..n |
| TC-2.2b | stores supported content as typed parts | PI message includes all supported content fixtures | Map/capture | Part types are specific: text/reasoning/tool_call/tool_result/runtime_note/image_ref/file_ref |
| TC-2.2c | reports unsupported part type visibly | PI message contains unknown custom content | Map/capture | `UNMAPPED_PART_TYPE`; source content preserved as unknown or rejected with issue |
| TC-2.4a | reports append failure with activity context | Store append throws | Capture finalized PI message | `CAPTURE_APPEND_FAILED` includes target, actor, kind, timestamp, cause |
| TC-2.4b | failed append is not marked captured | Store append throws | Read Thread | No successful source record for failed activity |

### `turn-service.test.ts`

This file focuses on prompt-bounded grouping rules rather than raw persistence. The goal is to show that open/closed turn lifecycle, pre-turn handling, and multi-response/tool-cycle membership are all consequences of one consistent boundary rule.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-3.1a | first prompt opens first canonical turn | Thread has no turns | Capture agent-addressed prompt | One open turn with prompt as initiating message |
| TC-3.1b | next prompt closes previous turn | Thread has open turn | Capture next prompt | Previous turn closed; new open turn created |
| TC-3.2a | response joins open turn | Thread has open turn | Capture response | Response message id in open turn |
| TC-3.2b | tool activity joins open turn | Thread has open turn | Capture tool call/result activity | Tool activity associated with same turn |
| TC-3.2c | runtime note joins open turn | Thread has open turn | Capture relevant runtime note | Runtime note associated with same turn |
| TC-3.3a | multiple responses stay in one turn | Open turn | Capture multiple assistant responses | All response ids in same turn in source order |
| TC-3.3b | multiple tool cycles stay in one turn | Open turn | Capture multiple tool result cycles | All tool ids in same turn in source order |
| TC-3.4a | records open turn status | Prompt captured, no later prompt | Read turns | Turn status `open` with current message ids |
| TC-3.4b | records closed turn status | Two prompts captured | Read first turn | Turn status `closed` with final member ids |
| TC-3.5a | retains pre-turn runtime note | Runtime note before first prompt | Capture/read | Message stored and absent from turn membership |
| TC-3.5b | reports pre-turn source record range | Thread has pre-turn message | `checkTurnHealth` | Report includes pre-turn source range |

### `import-service.test.ts`

Attach/import is its own seam because it has to reconcile two histories: PI's native active path and the steward's canonical Thread. These tests verify active-path resolution, canonical mapping, import metadata, and the handoff back to normal live capture rules.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-5.1a | imports existing PI session into new Thread | PI session fixture with prior activity, no Thread | `/lh-attach` core service | New Thread with imported canonical messages |
| TC-5.1b | attaches empty existing PI session | Empty PI session fixture, no Thread | Attach/import | New Thread with import metadata count 0 |
| TC-5.1c | rejects duplicate attach | Target already associated with Thread | Attach same target as new | `TARGET_ASSOCIATION_CONFLICT`; no duplicate Thread |
| TC-5.2a | imports active branch path only | Branched session with resolvable leaf | Attach/import | Imported messages match active path; metadata records path reference |
| TC-5.2b | rejects ambiguous branch path | Branched session without active path | Attach/import | `IMPORT_PATH_AMBIGUOUS`; no messages appended |
| TC-5.3a | preserves imported order | PI session with multiple entries | Attach/import | Canonical sourceOrder matches active path order |
| TC-5.3b | preserves imported parts | PI session with supported content types | Attach/import | Imported message parts typed and ordered |
| TC-5.3c | preserves imported metadata | PI entries include timestamp/ids | Attach/import | Timestamp and PI target metadata stored |
| TC-5.4a | records import source metadata | Successful import | Read Thread imports | Source session/path, time, source range, count, status |
| TC-5.4b | distinguishes imported range from later capture | Import then live capture | Read imports/messages | Imported range identifies prior messages; later sourceOrder outside range |
| TC-5.5a | imported prompts create turns | Imported history with prompts | Attach/import | Each prompt starts canonical turn |
| TC-5.5b | imported responses join prompt turns | Imported prompt/response/tool sequence | Attach/import | Responses/tool activity assigned between prompt boundaries |
| TC-5.5c | reports incomplete imported turn reconstruction | Imported history with ambiguous prompt status | Attach/import | Import partial; affected turns `repair_needed`; thread turnState `repair_needed` |
| TC-5.6a | appends new activity after imported range | Attach complete | Capture live activity | New sourceOrder after imported range |
| TC-5.6b | applies turn semantics after import | Imported Thread has open/closed state | Capture next prompt | Same prompt-bounded rules apply |
| TC-5.6c | prevents import overlapping active live capture | Live capture active for target | Attach same target as new Thread | `TARGET_ASSOCIATION_CONFLICT`; active Thread unchanged |

### `repair-service.test.ts`

Repair tests prove the feature's key recovery contract: immutable source messages can outlive broken turn state. They enter through `repair-service` and `turn-service` health checks so stale-source guards, ambiguous-boundary handling, and readiness blocking are visible at the same abstraction level operators will use.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-6.1a | detects missing turn state | Messages exist, no turns | `checkTurnHealth` | `TURN_STATE_MISSING` with affected range |
| TC-6.1b | detects incomplete turn membership | Turns omit expected message ids | Health check | `TURN_STATE_INCOMPLETE` and uncovered range |
| TC-6.1c | passes healthy turn state | Messages covered by valid turns | Health check | Status ready |
| TC-6.2a | repair creates turns from prompts | Messages with prompts, no turns | `repairTurnState` | Turns created at prompt boundaries |
| TC-6.2b | repair assigns between-boundary messages | Messages between two prompts | Repair | Between-boundary messages assigned to first prompt turn |
| TC-6.2c | repair preserves final open turn | Last prompt has no later prompt | Repair | Final turn status `open` |
| TC-6.3a | repair preserves source order | Ordered messages | Repair | Message sourceOrder unchanged |
| TC-6.3b | repair preserves message content | Messages with full fields | Repair | Content, parts, actor, kind, timestamps, metadata unchanged |
| TC-6.4a | missing turn state blocks readiness | Missing turns | `checkMaintenanceReadiness` | Blocked; blocker names missing turn state |
| TC-6.4b | incomplete turn state blocks readiness | Incomplete membership | Readiness check | Blocked; affected range identified |
| TC-6.4c | repaired state clears blocker | Repair completed | Readiness check | No turn-state blocker for repaired range |
| TC-6.5a | reports ambiguous prompt boundary | Message cannot be classified as prompt/non-prompt | Repair | `TURN_REPAIR_AMBIGUOUS`; affected state not ready |
| TC-6.5b | reports repair write failure | Store refuses writeTurns | Repair | `TURN_REPAIR_WRITE_FAILED`; readiness remains blocked |
| TC-6.5c | rejects stale repair input | Source revision changes during repair | Repair write | `STALE_SOURCE_REVISION`; state not marked ready |

### `fixture-service.test.ts`

Fixture creation is the bridge from live dogfooding into repeatable downstream validation. These tests verify that a fixture remains Thread-shaped data, not a bespoke export format, and that import/repair state survives into that fixture view.

| TC | Test Name | Setup | Action | Assert |
|---|---|---|---|---|
| TC-7.1a | creates fixture from managed Thread | Managed Thread with messages/turns | `createRealSessionFixture` | Fixture dir has Thread-shaped records and FixtureRecord |
| TC-7.1b | creates fixture from PI session import | PI session without managed Thread | Fixture via import | Fixture dir has imported canonical records and import metadata |
| TC-7.1c | reports fixture creation failure | Source unreadable/unconvertible | Create fixture | `FIXTURE_CREATE_FAILED` with source and cause |
| TC-7.2a | preserves fixture message order | Source Thread ordered messages | Create fixture | Fixture messages same canonical order |
| TC-7.2b | preserves fixture part structure | Source messages with ordered parts | Create fixture | Fixture preserves part type and part order |
| TC-7.3a | marks healthy fixture ready | Source turn state ready | Create fixture | FixtureRecord repairStatus `ready` |
| TC-7.3b | marks incomplete fixture repair-needed | Source turn state incomplete | Create fixture | FixtureRecord repairStatus `repair_needed` and affected range issue |
| TC-7.4a | records managed-thread fixture metadata | Fixture from managed Thread | Read `fixture.json` | Source type, thread id, created time, range, status |
| TC-7.4b | records PI-session fixture metadata | Fixture from PI session | Read `fixture.json` | Source session/path, import status, repair status, status |

## Command Tests

Command tests are secondary coverage over the same core behavior. They are not part of the 78-row primary TC reconciliation table below unless a story intentionally chooses a command as the primary verification entry point. The baseline 91-test count includes only the explicitly enumerated 13 non-TC tests in the next section.

| Test File | Test Name | Purpose |
|---|---|---|
| `pi-extension-commands.test.ts` | `/lh-attach` renders success and conflict summaries | Verifies command delegation and operator output. |
| `pi-extension-commands.test.ts` | `/lh-turn-health` renders ready and blocked states | Verifies health reports are operator-visible. |
| `pi-extension-commands.test.ts` | `/lh-repair-turns` renders repair success and stale-source failure | Verifies repair errors are not hidden. |
| `pi-extension-commands.test.ts` | `/lh-fixture` renders created fixture id and failure code | Verifies fixture command output. |
| `pi-extension-commands.test.ts` | `/lh-status` reports active Thread id and turn state | Verifies basic dogfood status command. |

## Non-TC Decided Tests

These tests are required by design risk, not by a single epic TC.

| ID | Test File | Test Name |
|---|---|---|
| NTC-1 | `foundation.test.ts` | id and content fingerprint helpers are deterministic |
| NTC-2 | `foundation.test.ts` | schema-version constants match thread initialization |
| NTC-3 | `thread-store.test.ts` | atomic metadata rewrite leaves prior file intact on failed temp write |
| NTC-4 | `thread-store.test.ts` | duplicate target index rebuilds from existing messages on startup |
| NTC-5 | `capture-service.test.ts` | signature-only reasoning block is preserved without invented text |
| NTC-6 | `capture-service.test.ts` | append succeeds but turn write fails and thread degrades to `repair_needed` without losing the source message |
| NTC-7 | `capture-service.test.ts` | tool execution lifecycle events are ignored unless finalized into messages or runtime notes |
| NTC-8 | `import-service.test.ts` | import dry run reports active path without writing records |
| NTC-9 | `import-service.test.ts` | partial import issues are sorted by source order |
| NTC-10 | `repair-service.test.ts` | range-limited repair does not rewrite unaffected turns |
| NTC-11 | `repair-service.test.ts` | health report ranges are sorted by source order |
| NTC-12 | `pi-extension-commands.test.ts` | command formatter returns concise success and error summaries |
| NTC-13 | `pi-extension-commands.test.ts` | `/lh-status` works when no managed Thread exists |

## Chunk Test Counts

| Chunk | Primary TC Tests | Non-TC Tests | Total |
|---|---:|---:|---:|
| Chunk 0: Foundation | 0 | 2 | 2 |
| Chunk 1: Thread, Actor, Message, and Target Metadata Store | 17 | 2 | 19 |
| Chunk 2: Live PI Activity Capture and Turn Lifecycle | 22 | 3 | 25 |
| Chunk 3: Attach and Import Existing PI Sessions | 16 | 2 | 18 |
| Chunk 4: Turn Health and Repair | 14 | 2 | 16 |
| Chunk 5: Real-Session Fixtures and Commands | 9 | 2 | 11 |
| Total | 78 | 13 | 91 |

## Verification Commands

| Gate | Command | Expected Use |
|---|---|---|
| `red-verify` | `npm run typecheck` | Run after Red tests are written but expected to fail. |
| `verify` | `npm run typecheck && npm run test` | Standard development gate. |
| `green-verify` | `npm run verify && npm run guard:no-test-changes` | Run after implementation passes and Red tests should remain unchanged. |
| `verify-all` | `npm run verify && npm run test:integration` | Run for story completion and before release. |

Integration tests should start with filesystem/import smoke coverage:

| Test File | Test Name | Purpose |
|---|---|---|
| `file-thread-store.integration.test.ts` | managed Thread survives process-style reopen | Verifies real file layout can be reopened from disk. |
| `file-thread-store.integration.test.ts` | PI session fixture imports through file path | Verifies import works against JSONL-shaped session fixture. |
| `file-thread-store.integration.test.ts` | concurrent capture requests serialize by source order | Verifies the per-thread write queue preserves canonical ordering under overlapping calls. |
| `file-thread-store.integration.test.ts` | stale temp metadata file does not replace the last committed snapshot | Verifies crash cleanup preserves the last known good state. |

## Count Reconciliation

The epic contains 78 TCs. This plan maps 78 primary TC tests. Non-TC decided tests add 13 tests. The planned Feature 1 total is therefore 91 tests.

Per-file primary TC counts:

This table is intentionally primary-TC-only. `foundation.test.ts` and `pi-extension-commands.test.ts` are omitted because they do not own primary epic TCs; they contribute to the separately counted non-TC baseline instead.

| Test File | Primary TC Tests |
|---|---:|
| `thread-store.test.ts` | 17 |
| `capture-service.test.ts` | 11 |
| `turn-service.test.ts` | 11 |
| `import-service.test.ts` | 16 |
| `repair-service.test.ts` | 14 |
| `fixture-service.test.ts` | 9 |
| Total | 78 |

Per-chunk primary TC totals also sum to 78. Per-chunk totals including non-TC tests sum to 91.


## Current Run Index
- planner_turn_index: 6
- mode: resume
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-verify completed with outcome pass and status ok.
- latest_response_kind: verifier-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/006-verify.json
- older_response_count: 3
- caller_input_artifact_count: 0
- prior_self_note_count: 2
- latest_self_note: "After quick-fix returns, run verification against SV-03-01 and SV-03-02, confirm AC-3.1/AC-3.2/AC-3.4 are verified, and require npm run verify evidence before considering acceptance."

## Response Trail
<current_response>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/006-verify.json
bytes: 3618
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "pass"
  result:
    resultId: "d2b7e890-22b6-413f-b64f-7f4e629118d3"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e1014-0fd0-7b72-b50f-8591a5551d11"
    continuation:
      provider: "codex"
      sessionId: "019e1014-0fd0-7b72-b50f-8591a5551d11"
      storyId: "03-prompt-bounded-turn-lifecycle"
    mode: "followup"
    story:
      id: "03-prompt-bounded-turn-lifecycle"
      title: "Story 3: Prompt-Bounded Turn Lifecycle"
    artifactsRead:
      - "docs/spec-build/epics/01-session-context-store/stories/03-prompt-bounded-turn-lifecycle.md"
      - "docs/spec-build/epics/01-session-context-store/tech-design.md"
      - "docs/spec-build/epics/01-session-context-store/test-plan.md"
      - "docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/007-quick-fix.json"
      - "src/context-steward/services/capture-service.ts"
      - "src/context-steward/services/thread-service.ts"
      - "src/context-steward/services/turn-service.ts"
      - "src/context-steward/pi/pi-extension.ts"
      - "tests/context-steward/capture-service.test.ts"
      - "tests/context-steward/turn-service.test.ts"
    reviewScopeSummary: "Follow-up verification focused on quick-fix 007 convergence for SV-03-01 and SV-03-02. I inspected the touched capture/thread/turn services and regression tests, reran the prior overlapping prompt+response capture reproduction against current code, and ran the configured story and epic gates."
    priorFindingStatuses:
      -
        id: "SV-03-01"
        status: "resolved"
        rationale: "The capture operation now wraps duplicate detection, actor declaration, source append, and turn persistence in `withSerializedThreadOperation` at `src/context-steward/services/capture-service.ts:184-250`, backed by the per-thread queue in `src/context-steward/services/thread-service.ts:35-63`. Regression coverage at `tests/context-steward/capture-service.test.ts:560-604` blocks the first `readTurns`, starts an overlapping response capture, proves the second capture does not enter turn reads while the first is blocked, then verifies both captures return `updated`, persisted messages are source orders 1 and 2, one canonical turn contains both messages, and `checkTurnHealth` has no issues. I also reran the previous focused repro manually and observed the same healthy state."
      -
        id: "SV-03-02"
        status: "resolved"
        rationale: "`captureFinalizedActivity` no longer has a no-turn-update success branch: `src/context-steward/services/capture-service.ts:149-158` defaults to `writeCapturedMessageTurns` when no override is supplied, and `tests/context-steward/capture-service.test.ts:174-201` verifies default finalized capture persists canonical turn membership with `turnStateOutcome: \"updated\"` and thread turn state `ready`."
    newFindings:
[]
    openFindings:
[]
    requirementCoverage:
      verified:
        - "AC-3.1"
        - "AC-3.2"
        - "AC-3.3"
        - "AC-3.4"
        - "AC-3.5"
      unverified:
[]
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
[]
    recommendedNextStep: "pass"
    recommendedFixScope: "quick-fix"
    openQuestions:
[]
    additionalObservations:
      - "`npm run verify` passed with 60 unit tests."
      - "`npm run verify-all` passed; the integration phase reported `No integration tests found.`, so the epic gate currently adds no integration coverage beyond the unit suite."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/006-verify.json"
  startedAt: "2026-05-10T04:23:56.093Z"
  finishedAt: "2026-05-10T04:25:18.310Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/003-implementor.json
bytes: 2651
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "f111d449-0286-42b2-bc09-5148d00efb74"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e100c-ab9f-7ab0-9274-14b131aa42d9"
    continuation:
      provider: "codex"
      sessionId: "019e100c-ab9f-7ab0-9274-14b131aa42d9"
      storyId: "03-prompt-bounded-turn-lifecycle"
    outcome: "ready-for-verification"
    story:
      id: "03-prompt-bounded-turn-lifecycle"
      title: "Story 3: Prompt-Bounded Turn Lifecycle"
    planSummary: "Implemented prompt-bounded canonical turn lifecycle in a new turn service, wired live PI capture to persist turn updates by default, and added the Story 3 turn-service coverage for prompt boundaries, open/closed lifecycle state, multi-response/tool-cycle membership, and pre-turn range reporting."
    changedFiles:
      -
        path: "src/context-steward/services/turn-service.ts"
        reason: "Added prompt-boundary turn application, persisted turn writing, and turn health reporting with pre-turn range detection."
      -
        path: "src/context-steward/pi/pi-extension.ts"
        reason: "Wired live capture and runtime-status notes through the new turn writer so production capture persists canonical turns."
      -
        path: "tests/context-steward/turn-service.test.ts"
        reason: "Added Story 3 primary coverage for canonical turn opening/closing, membership, lifecycle status, and pre-turn reporting."
    tests:
      added:
        - "tests/context-steward/turn-service.test.ts"
      modified:
[]
      removed:
[]
      totalAfterStory: 58
      deltaFromPriorBaseline: 11
    gatesRun:
      -
        command: "npm run typecheck"
        result: "pass"
      -
        command: "npm run test"
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
        - "Corrected turn-health reporting so threads with only pre-turn source records are treated as ready instead of incorrectly surfacing uncovered activity."
        - "Normalized degraded health status to return `repair_needed` for computed turn-state problems unless the thread was already marked `repair_failed`."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Hand this story to verification; Story 5 and Story 6 can now reuse the turn-service prompt-boundary and health helpers for import reconstruction and repair."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/003-implementor.json"
  startedAt: "2026-05-10T04:02:06.137Z"
  finishedAt: "2026-05-10T04:10:00.497Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/004-verify.json
bytes: 7694
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "31a111d5-ae7d-4f30-938c-d857dfba1af5"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e1014-0fd0-7b72-b50f-8591a5551d11"
    continuation:
      provider: "codex"
      sessionId: "019e1014-0fd0-7b72-b50f-8591a5551d11"
      storyId: "03-prompt-bounded-turn-lifecycle"
    mode: "initial"
    story:
      id: "03-prompt-bounded-turn-lifecycle"
      title: "Story 3: Prompt-Bounded Turn Lifecycle"
    artifactsRead:
      - "docs/spec-build/epics/01-session-context-store/stories/03-prompt-bounded-turn-lifecycle.md"
      - "docs/spec-build/epics/01-session-context-store/tech-design.md"
      - "docs/spec-build/epics/01-session-context-store/test-plan.md"
      - "docs/spec-build/epics/01-session-context-store/stories/coverage.md"
      - "docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/001-story-validate.json"
      - "docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/003-implementor.json"
      - "package.json"
      - "src/context-steward/domain/records.ts"
      - "src/context-steward/store/thread-store.ts"
      - "src/context-steward/store/file-thread-store.ts"
      - "src/context-steward/services/thread-service.ts"
      - "src/context-steward/services/capture-service.ts"
      - "src/context-steward/services/turn-service.ts"
      - "src/context-steward/pi/pi-message-mapper.ts"
      - "src/context-steward/pi/pi-extension.ts"
      - ".pi/extensions/context-steward.ts"
      - "src/context-steward/test/fixtures.ts"
      - "tests/context-steward/capture-service.test.ts"
      - "tests/context-steward/turn-service.test.ts"
    reviewScopeSummary: "Verified Story 3 against the story spec, the full Session Context Store tech design, and the test plan; inspected the capture, turn, thread-store, PI mapper, and PI extension code plus Story 3/capture tests; ran `npm run verify` and `npm run verify-all`; and reproduced an overlapping-capture production-path failure against the live services."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "SV-03-01"
        severity: "major"
        title: "Overlapping finalized captures can leave canonical turn state empty or stale even though both source messages commit"
        evidence: "`src/context-steward/services/thread-service.ts:35-63` serializes only `appendSourceMessage`, while `src/context-steward/services/turn-service.ts:190-213` applies/writes turns after the append and `src/context-steward/store/file-thread-store.ts:343-370` rejects turn writes whose expected source revision/high-water mark is no longer current. In a verification reproduction with concurrent prompt+response captures and a delayed first `readTurns`, the prompt capture returned `repair_needed` with `STALE_SOURCE_REVISION`, the response capture returned `updated`, `turns` persisted as `[]`, `thread.status.turnState` ended as `ready`, and `checkTurnHealth` reported `TURN_STATE_MISSING` for source orders 1-2."
        affectedFiles:
          - "src/context-steward/services/thread-service.ts"
          - "src/context-steward/services/turn-service.ts"
          - "src/context-steward/store/file-thread-store.ts"
          - "tests/context-steward/turn-service.test.ts"
        requirementIds:
          - "AC-3.1"
          - "AC-3.2"
          - "AC-3.4"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "SV-03-02"
        severity: "major"
        title: "`captureFinalizedActivity` still has a success path that skips turn lifecycle updates entirely"
        evidence: "`src/context-steward/services/capture-service.ts:156-179` returns success with `turnStateOutcome: \"not_applicable\"` whenever `turnWriter` is absent; it only rereads current turns and never applies Story 3 prompt-boundary logic. Flow 2 and Core Services in `docs/spec-build/epics/01-session-context-store/tech-design.md` define finalized capture as append-plus-turn-update, and the default capture tests (for example `tests/context-steward/capture-service.test.ts:90-154`) exercise `captureFinalizedActivity` without a turn writer, so this non-real bypass remains part of the supported runtime service surface rather than being confined to tests."
        affectedFiles:
          - "src/context-steward/services/capture-service.ts"
          - "tests/context-steward/capture-service.test.ts"
        requirementIds:
          - "AC-3.1"
          - "AC-3.2"
          - "AC-3.4"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "SV-03-01"
        severity: "major"
        title: "Overlapping finalized captures can leave canonical turn state empty or stale even though both source messages commit"
        evidence: "`src/context-steward/services/thread-service.ts:35-63` serializes only `appendSourceMessage`, while `src/context-steward/services/turn-service.ts:190-213` applies/writes turns after the append and `src/context-steward/store/file-thread-store.ts:343-370` rejects turn writes whose expected source revision/high-water mark is no longer current. In a verification reproduction with concurrent prompt+response captures and a delayed first `readTurns`, the prompt capture returned `repair_needed` with `STALE_SOURCE_REVISION`, the response capture returned `updated`, `turns` persisted as `[]`, `thread.status.turnState` ended as `ready`, and `checkTurnHealth` reported `TURN_STATE_MISSING` for source orders 1-2."
        affectedFiles:
          - "src/context-steward/services/thread-service.ts"
          - "src/context-steward/services/turn-service.ts"
          - "src/context-steward/store/file-thread-store.ts"
          - "tests/context-steward/turn-service.test.ts"
        requirementIds:
          - "AC-3.1"
          - "AC-3.2"
          - "AC-3.4"
        recommendedFixScope: "fresh-fix-path"
        blocking: true
      -
        id: "SV-03-02"
        severity: "major"
        title: "`captureFinalizedActivity` still has a success path that skips turn lifecycle updates entirely"
        evidence: "`src/context-steward/services/capture-service.ts:156-179` returns success with `turnStateOutcome: \"not_applicable\"` whenever `turnWriter` is absent; it only rereads current turns and never applies Story 3 prompt-boundary logic. Flow 2 and Core Services in `docs/spec-build/epics/01-session-context-store/tech-design.md` define finalized capture as append-plus-turn-update, and the default capture tests (for example `tests/context-steward/capture-service.test.ts:90-154`) exercise `captureFinalizedActivity` without a turn writer, so this non-real bypass remains part of the supported runtime service surface rather than being confined to tests."
        affectedFiles:
          - "src/context-steward/services/capture-service.ts"
          - "tests/context-steward/capture-service.test.ts"
        requirementIds:
          - "AC-3.1"
          - "AC-3.2"
          - "AC-3.4"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-3.3"
        - "AC-3.5"
      unverified:
        - "AC-3.1"
        - "AC-3.2"
        - "AC-3.4"
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "Live capture does not serialize append plus turn persistence as one per-thread operation, so overlapping finalized events can commit source records while leaving `turns` empty or stale."
      - "The exported capture service still treats missing turn application as a successful `not_applicable` runtime path, which is a real-code fallback not allowed by the story/design contract."
    recommendedNextStep: "revise"
    recommendedFixScope: "fresh-fix-path"
    openQuestions:
[]
    additionalObservations:
      - "All 58 current unit tests passed under `npm run verify`."
      - "`npm run verify-all` exited successfully but reported `No integration tests found.`, so the epic gate currently adds no extra execution beyond the unit suite."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/004-verify.json"
  startedAt: "2026-05-10T04:10:10.538Z"
  finishedAt: "2026-05-10T04:17:31.802Z"
```
</history_entry>

<history_entry>
```yaml
kind: quick-fix-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/007-quick-fix.json
bytes: 9122
payload:
  command: "quick-fix"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    provider: "codex"
    model: "gpt-5.4"
    rawProviderOutputPreview: |-
      {"type":"thread.started","thread_id":"019e101a-fbbc-7620-a505-e8ee5850caa2"}
      {"type":"turn.started"}
      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m tracing the current verifier blockers first so we can make a focused fix, then I’ll patch the capture path, add the regression coverage you asked for, and rerun `npm run verify` plus `npm run verify-all`."}}
      {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' /Users/leemoore/.agents/skills/diagnose/SKILL.md\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' /Users/leemoore/.agents/skills/diagnose/SKILL.md\"","aggregated_output":"---\nname: diagnose\ndescription: Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → minimise → hypothesise → instrument → fix → regression-test. Use when user says \"diagnose this\" / \"debug this\", reports a bug, says something is broken/throwing/failing, or describes a performance regression.\n---\n\n# Diagnose\n\nA discipline for hard bugs. Skip phases only when explicitly justified.\n\nWhen exploring the codebase, use the project's domain glossary to get a clear mental model of the relevant modules, and check ADRs in the area you're touching.\n\n## Phase 1 — Build a feedback loop\n\n**This is the skill.** Everything else is mechanical. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause — bisection, hypothesis-testing, and instrumentation all just consume that signal. If you don't have one, no amount of staring at code will save you.\n\nSpend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**\n\n### Ways to construct one — try them in roughly this order\n\n1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e.\n2. **Curl / HTTP script** against a running dev server.\n3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.\n4. **Headless browser script** (Playwright / Puppeteer) — drives the UI, asserts on DOM/console/network.\n5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.\n6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.\n7. **Property / fuzz loop.** If the bug is \"sometimes wrong output\", run 1000 random inputs and look for the failure mode.\n8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate \"boot at state X, check, repeat\" so you can `git bisect run` it.\n9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.\n10. **HITL bash script.** Last resort. If a human must click, drive _them_ with `scripts/hitl-loop.template.sh` so the loop is still structured. Captured output feeds back to you.\n\nBuild the right feedback loop, and the bug is 90% fixed.\n\n### Iterate on the loop itself\n\nTreat the loop as a product. Once you have _a_ loop, ask:\n\n- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)\n- Can I make the signal sharper? (Assert on the specific symptom, not \"didn't crash\".)\n- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)\n\nA 30-second flaky loop is barely better than no loop. A 2-second deterministic loop is a debugging superpower.\n\n### Non-deterministic bugs\n\nThe goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate until it's debuggable.\n\n### When you genuinely cannot build a loop\n\nStop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.\n\nDo not proceed to Phase 2 until you have a loop you believe in.\n\n## Phase 2 — Reproduce\n\nRun the loop. Watch the bug appear.\n\nConfirm:\n\n- [ ] The loop produces the failure mode the **user** described — not a different failure that happens to be nearby. Wrong bug = wrong fix.\n- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).\n- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.\n\nDo not proceed until you reproduce the bug.\n\n## Phase 3 — Hypothesise\n\nGenerate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.\n\nEach hypothesis must be **falsifiable**: state the prediction it makes.\n\n> Format: \"If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse.\"\n\nIf you cannot state the prediction, the hypothesis is a vibe — discard or sharpen it.\n\n**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly (\"we just deployed a change to #3\"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it — proceed with your ranking if the user is AFK.\n\n## Phase 4 — Instrument\n\nEach probe must map to a specific prediction from Phase 3. **Change one variable at a time.**\n\nTool preference:\n\n1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.\n2. **Targeted logs** at the boundaries that distinguish hypotheses.\n3. Never \"log everything and grep\".\n\n**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.\n\n**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.\n\n## Phase 5 — Fix + regression test\n\nWrite the regression test **before the fix** — but only if there is a **correct seam** for it.\n\nA correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.\n\n**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Flag this for the next phase.\n\nIf a correct seam exists:\n\n1. Turn the minimised repro into a failing test at that seam.\n2. Watch it fail.\n3. Apply the fix.\n4. Watch it pass.\n5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.\n\n## Phase 6 — Cleanup + post-mortem\n\nRequired before declaring done:\n\n- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)\n- [ ] Regression test passes (or absence of seam is documented)\n- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)\n- [ ] Throwaway prototypes deleted (or moved to a clearly-marked debug location)\n- [ ] The hypothesis that turned out correct is stated in the commit / PR message — so the next debugger learns\n\n**Then ask: what would have prevented this bug?** If the answer involves architectural change (no good test seam, tangled callers, hidden coupling) hand off to the `/improve-codebase-architecture` skill with the specifics. Make the recommendation **after** the fix is in, not before — you have more information now than when you started.\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_
    rawProviderOutputBytes: 417308
    rawProviderOutputTruncated: true
    rawProviderOutputLogPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/streams/007-quick-fix.stdout.log"
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/007-quick-fix.json"
  startedAt: "2026-05-10T04:17:44.170Z"
  finishedAt: "2026-05-10T04:22:56.253Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/001-current.json
Bytes: 2959

```yaml
storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
storyId: "03-prompt-bounded-turn-lifecycle"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-verify completed with outcome pass and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/004-verify.json"
    provenance: "current-run"
  -
    kind: "quick-fix-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/007-quick-fix.json"
    provenance: "current-run"
  -
    kind: "final-package"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/001-final-package.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/006-verify.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e100c-ab9f-7ab0-9274-14b131aa42d9"
    storyId: "03-prompt-bounded-turn-lifecycle"
  storyVerifier:
    provider: "codex"
    sessionId: "019e1014-0fd0-7b72-b50f-8591a5551d11"
    storyId: "03-prompt-bounded-turn-lifecycle"
latestEventSequence: 17
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "The latest quick-fix completed with outcome ready-for-verification, but the last verifier result still has blocking findings SV-03-01 and SV-03-02 with AC-3.1, AC-3.2, and AC-3.4 unverified. The smallest safe next action is to rerun story verification against the quick-fix evidence before considering acceptance."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/006-verify.json"
replayBoundary: null
updatedAt: "2026-05-10T04:25:18.320Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After quick-fix returns, run verification against SV-03-01 and SV-03-02, confirm AC-3.1/AC-3.2/AC-3.4 are verified, and require npm run verify evidence before considering acceptance.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-10T04:02:06.100Z; note="After implementation returns, check for complete TC-3.1a..TC-3.5b evidence and whether npm run verify passed before choosing self-review or verifier."
- sequence=11; actionSequence=10; createdAt=2026-05-10T04:17:44.132Z; note="After quick-fix returns, run verification against SV-03-01 and SV-03-02, confirm AC-3.1/AC-3.2/AC-3.4 are verified, and require npm run verify evidence before considering acceptance."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/001-events.jsonl
Bytes: 9697

```yaml
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 1
  timestamp: "2026-05-10T04:01:52.630Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 2
  timestamp: "2026-05-10T04:02:06.078Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e100c-76ce-7361-ace4-365daadbdaba"
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 3
  timestamp: "2026-05-10T04:02:06.100Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, check for complete TC-3.1a..TC-3.5b evidence and whether npm run verify passed before choosing self-review or verifier."
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 4
  timestamp: "2026-05-10T04:02:06.100Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, check for complete TC-3.1a..TC-3.5b evidence and whether npm run verify passed before choosing self-review or verifier."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 5
  timestamp: "2026-05-10T04:10:00.507Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 6
  timestamp: "2026-05-10T04:10:10.472Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e1013-e8a0-7b62-a70e-73922045fef6"
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 7
  timestamp: "2026-05-10T04:10:10.498Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 8
  timestamp: "2026-05-10T04:17:31.812Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/004-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 9
  timestamp: "2026-05-10T04:17:44.110Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/prompts/001-planner-turn-003.md"
    sessionId: "019e101a-cb8b-76c0-bf20-ea4cf41dfb44"
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 10
  timestamp: "2026-05-10T04:17:44.132Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-quick-fix."
  data:
    actionType: "run-quick-fix"
    turn: 3
    selfNote: "After quick-fix returns, run verification against SV-03-01 and SV-03-02, confirm AC-3.1/AC-3.2/AC-3.4 are verified, and require npm run verify evidence before considering acceptance."
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 11
  timestamp: "2026-05-10T04:17:44.132Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After quick-fix returns, run verification against SV-03-01 and SV-03-02, confirm AC-3.1/AC-3.2/AC-3.4 are verified, and require npm run verify evidence before considering acceptance."
    actionSequence: 10
    actionType: "run-quick-fix"
    turn: 3
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 12
  timestamp: "2026-05-10T04:22:56.261Z"
  type: "child-operation-completed"
  summary: "quick-fix completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/007-quick-fix.json"
  data:
    actionType: "run-quick-fix"
    command: "quick-fix"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 13
  timestamp: "2026-05-10T04:23:12.603Z"
  type: "provider-output-invalid"
  summary: "Provider output did not match the expected JSON payload. root keys: action, rationale, inputs, selfNote; direct payload: inputs.artifactRefs: Invalid input: expected array, received undefined; raw stdout bytes=1140; raw stdout preview=\"{\\\"type\\\":\\\"thread.started\\\",\\\"thread_id\\\":\\\"019e101f-befd-7353-b3ce-791907d32aef\\\"}\\n{\\\"type\\\":\\\"turn.started\\\"}\\n{\\\"type\\\":\\\"item.completed\\\",\\\"item\\\":{\\\"id\\\":\\\"item_0\\\",\\\"type\\\":\\\"agent_message\\\",\\\"text\\\":\\\"{\\\\\\\"action\\\\\\\":\\\\\\\"run-verify\\\\\\\",\\\\\\\"rationale\\\\\\\":\\\\\\\"The latest quick-fix completed successfully with outcome ready-for-verification, but the durable record still has a prior verifier outcome of revise with blocking findings SV-03-01 and SV-03-02. The smallest safe next action is to continue verification against the quick-fix art...[truncated]\"; raw stderr bytes=38; raw stderr preview=\"Reading additional input from stdin...\"; stdout log=/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/streams/001-story-lead.stdout.log; stderr log=/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/streams/001-story-lead.stderr.log; Reading additional input from stdin..."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/001-final-package.json"
  data:
    terminalDecision: "interrupted"
    recoveryBoundary:
      smallestSafeStep: "resume-from-last-valid-artifact"
      reasoning: "Provider output became invalid after durable artifacts were written, so replay should resume from the last valid artifact boundary."
      validArtifactPaths:
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/001-story-validate.json"
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/003-implementor.json"
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/004-verify.json"
        - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/007-quick-fix.json"
      requiresFreshStoryLeadSession: false
      requiresFreshChildProviderSession: true
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/prompts/001-planner-turn-004.md"
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 14
  timestamp: "2026-05-10T04:23:42.310Z"
  type: "story-run-resumed"
  summary: "Story orchestration resume started."
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 15
  timestamp: "2026-05-10T04:23:56.037Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/story-lead/prompts/001-planner-turn-005.md"
    sessionId: "019e1020-72d8-7e53-9b09-3ebcacbacfdc"
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 16
  timestamp: "2026-05-10T04:23:56.058Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 1
-
  storyRunId: "03-prompt-bounded-turn-lifecycle-story-run-001"
  sequence: 17
  timestamp: "2026-05-10T04:25:18.320Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome pass and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/03-prompt-bounded-turn-lifecycle/006-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "pass"
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
