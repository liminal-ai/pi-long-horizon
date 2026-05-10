# Story Lead Base Prompt

## Role Charter
You are the story lead for `02-live-pi-activity-capture` on durable story run `02-live-pi-activity-capture-story-run-001`.
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
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/stories/02-live-pi-activity-capture.md
Bytes: 10776

# Story 2: Live PI Activity Capture

### Summary
<!-- Jira: Summary field -->

Capture finalized PI runtime activity as canonical Messages with ordered typed Parts, source ordering, duplicate detection, and explicit capture failure reporting.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Map finalized PI activity into canonical Messages and Parts without losing ordering, typed content, target metadata, or failure visibility.

**In Scope**

- Capture finalized prompts, agent responses, tool results, runtime notes, and rapid event sequences.
- Preserve ordered typed Parts from PI activity.
- Detect duplicate/replayed finalized activity.
- Report append failures with target/activity context.

**Out of Scope**

- Opening/closing canonical Turns. Story 3 owns turn membership.
- Attach/import of existing PI session files. Story 5 owns import.
- Repair and fixture behavior.

**Dependencies**

- Story 1 complete.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-2.1:** The steward records finalized PI messages during PI extension events.

- **TC-2.1a: Prompt captured**
  - Given: PI finalizes an agent-addressed prompt
  - When: The extension event is received
  - Then: The steward appends a stored Message for the prompt with actor identity, message kind, timestamp, source order, ordered parts, and PI target metadata
- **TC-2.1b: Agent response captured**
  - Given: PI finalizes an agent response
  - When: The extension event is received
  - Then: The steward appends a stored Message for the response with actor identity, message kind, timestamp, source order, ordered parts, and PI target metadata
- **TC-2.1c: Tool result captured**
  - Given: PI finalizes a tool result
  - When: The extension event is received
  - Then: The steward appends a stored Message for the tool result with actor identity, message kind, timestamp, source order, ordered parts, and PI target metadata
- **TC-2.1d: Runtime note captured**
  - Given: PI emits a finalized runtime note that affects session state, turn state, capture state, or repair/import status
  - When: The extension event is received
  - Then: The steward appends a stored Message with a runtime-note Part that preserves the note content, timestamp, source order, and PI target metadata
- **TC-2.1e: Rapid finalized events preserve order**
  - Given: PI emits two finalized activity events for the same Thread in rapid succession
  - When: The steward captures both events
  - Then: Both messages are appended with distinct source order values that match the finalized event order observed by the steward
- **TC-2.1f: Duplicate finalized event is not appended twice**
  - Given: A finalized PI activity event matches a target event identifier or target message identifier already captured for the Thread
  - When: The steward receives the same finalized activity again
  - Then: The steward reports `CAPTURE_DUPLICATE_EVENT` and preserves the existing stored Message without appending a duplicate source record

**AC-2.2:** Stored messages preserve ordered typed parts from PI activity.

- **TC-2.2a: Multiple parts preserve order**
  - Given: A finalized PI message contains multiple parts
  - When: The message is stored
  - Then: The stored Message contains Parts in the same semantic order as the source activity
- **TC-2.2b: Supported part types are typed**
  - Given: A finalized PI message contains text, reasoning, tool call, tool result, runtime note, image reference, or file reference content
  - When: The message is stored
  - Then: Each supported item is stored as a Part with a specific part type and content payload
- **TC-2.2c: Unsupported part type is visible**
  - Given: A finalized PI message contains a part type the steward cannot map
  - When: The message is stored or rejected
  - Then: The steward reports the unmapped part type and preserves or rejects the source content with an explicit status

**AC-2.4:** Capture failures are reported and failed activity is not represented as captured source records.

- **TC-2.4a: Message append failure is reported**
  - Given: A finalized PI message is received
  - When: The steward cannot append the message
  - Then: The steward reports `CAPTURE_APPEND_FAILED` with target runtime, target session identifier when available, actor identity when available, message kind when available, event timestamp when available, and failure reason
- **TC-2.4b: Failed message is not marked captured**
  - Given: A finalized PI message append fails
  - When: The Thread is read
  - Then: The failed message is not represented as a successfully captured source record

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 2 owns the adapter seam where finalized PI runtime activity becomes canonical source history. It is responsible for preserving actor identity, source ordering, typed parts, and enough PI metadata for deduplication and later projection work, while still keeping the canonical records target-neutral.

This story does not own prompt-bounded turn membership rules. Story 3 decides how captured messages are grouped into canonical turns. Story 2 does, however, own the partial-failure behavior when source capture succeeds but turn-state persistence cannot keep up. In that case the correct outcome is "message captured, turn state degraded to `repair_needed`," not a fake all-or-nothing failure.

#### Implementation Targets

| Owned Targets | Files / Modules |
|---|---|
| PI finalized-message mapping | `src/context-steward/pi/pi-message-mapper.ts` |
| Source capture orchestration | `src/context-steward/services/capture-service.ts` |
| Primary tests | `tests/context-steward/capture-service.test.ts` |

| Integration Touchpoints | Files / Modules |
|---|---|
| Message append and duplicate detection contract from Story 1 | `src/context-steward/store/thread-store.ts` |
| PI extension event hookup | `src/context-steward/pi/pi-extension.ts` |

#### Design References

- [tech-design.md §Flow 2: Live PI Activity Capture](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:700), lines 700-754
- [tech-design.md §PI Target Metadata](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:454), lines 454-501
- [tech-design.md §PI Mapping](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1065), lines 1065-1089
- [tech-design.md §Core Services](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:923), lines 923-1064
- [tech-design.md §Testing Strategy](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1107), lines 1107-1122
- [tech-design.md §Chunk 2: Live PI Activity Capture and Turn Lifecycle](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1182), lines 1182-1195
- [test-plan.md `capture-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:79), lines 79-96

#### Test Mapping

| TC | Test File / Check | Test Description |
|---|---|---|
| TC-2.1a, TC-2.1b, TC-2.1c, TC-2.1d | `tests/context-steward/capture-service.test.ts` | capture finalized prompt, response, tool-result, and runtime-note activity into canonical messages |
| TC-2.1e, TC-2.1f | `tests/context-steward/capture-service.test.ts` | preserve observed event order and suppress duplicate/replayed finalized activity |
| TC-2.2a, TC-2.2b, TC-2.2c | `tests/context-steward/capture-service.test.ts` | preserve ordered typed parts and surface unmapped content explicitly |
| TC-2.4a, TC-2.4b | `tests/context-steward/capture-service.test.ts` | report append failures with capture context and avoid claiming failed activity as captured |

#### Non-TC Decided Tests

- `tests/context-steward/capture-service.test.ts`: NTC-5 signature-only reasoning is preserved without invented text
- `tests/context-steward/capture-service.test.ts`: NTC-6 message append success plus turn write failure degrades thread turn state to `repair_needed` without losing the source message
- `tests/context-steward/capture-service.test.ts`: NTC-7 tool execution lifecycle events are ignored unless finalized into messages or relevant runtime notes

#### Technical Notes

- Use PI `message_end` as the finalized source event. `message_update` and tool execution progress events are not canonical source history on their own.
- When `duplicate === true`, `capture-service` should return the already-persisted message for that `targetEventKey` and treat the outcome as success with no new append.
- Story 3 owns canonical turn membership. This story should only pass the appended message into turn application and propagate `repair_needed` when the turn snapshot cannot be updated.

#### Anti-Shim Requirements

- Assert on stored `MessageRecord`, `PartRecord`, and `PiTargetMetadata` content through the capture-service boundary, not only on mapper helper return values.
- Exercise duplicate capture and partial degradation paths through real `capture-service` behavior, not by stubbing the result object directly.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- PI finalized prompts, responses, tool results, and runtime notes map to canonical Messages.
- Supported PI content maps to ordered typed Parts.
- Unknown PI content is preserved or rejected with explicit status.
- Duplicate finalized events do not append duplicate source records.
- Append failures return `CAPTURE_APPEND_FAILED` with required context.
- `capture-service.test.ts` covers all TCs assigned to this story.


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
- planner_turn_index: 3
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-verify completed with outcome revise and status ok.
- latest_response_kind: verifier-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/004-verify.json
- older_response_count: 1
- caller_input_artifact_count: 0
- prior_self_note_count: 2
- latest_self_note: "After verifier returns, accept only if final verifier outcome is pass, no open findings remain, and story gate evidence is present; otherwise choose quick-fix, continue, block, or request ruling based on verifier findings."

## Response Trail
<current_response>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/004-verify.json
bytes: 9237
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "7adf4857-81a8-4dc7-a86d-bd8cbfe6c0eb"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e1000-59a6-73b1-9075-d12bfaf1c120"
    continuation:
      provider: "codex"
      sessionId: "019e1000-59a6-73b1-9075-d12bfaf1c120"
      storyId: "02-live-pi-activity-capture"
    mode: "initial"
    story:
      id: "02-live-pi-activity-capture"
      title: "Story 2: Live PI Activity Capture"
    artifactsRead:
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/stories/02-live-pi-activity-capture.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/tech-design.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/test-plan.md"
      - "/Users/leemoore/code/pi-long-horizon/package.json"
      - "/Users/leemoore/code/pi-long-horizon/scripts/run-node-tests.mjs"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-extension.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-message-mapper.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/services/capture-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/services/thread-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/store/thread-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/store/file-thread-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/test/fixtures.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/capture-service.test.ts"
      - "/Users/leemoore/code/pi-long-horizon/.pi/extensions/thinking-level.ts"
    reviewScopeSummary: "Reviewed Story 2 against the current live-capture implementation, focusing on PI finalized-message mapping, duplicate suppression, append-failure handling, runtime-note handling, production PI extension hookup, and the configured verification gates."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "story2-missing-live-extension-hook"
        severity: "major"
        title: "Live PI capture is not wired into a real extension entrypoint"
        evidence: "AC-2.1 requires capture during PI extension events (docs/spec-build/epics/01-session-context-store/stories/02-live-pi-activity-capture.md:47-72), and the tech design assigns `pi-extension.ts` the extension-event hookup plus a project entrypoint `.pi/extensions/context-steward.ts` (docs/spec-build/epics/01-session-context-store/tech-design.md:119-121, 228-263, 700-754). The implemented `src/context-steward/pi/pi-extension.ts:1-72` only exports helper functions and never imports `ExtensionAPI`, exports a default extension factory, or calls `pi.on(\"message_end\", ...)`. The repo also has no `.pi/extensions/context-steward.ts` file; `rg --files .pi src` shows only `.pi/extensions/thinking-level.ts` under `.pi/extensions`. `capturePiEvent` is referenced only from `tests/context-steward/capture-service.test.ts:484-526`, so there is no production callsite proving real PI `message_end` traffic reaches `capture-service`."
        affectedFiles:
          - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-extension.ts"
          - "/Users/leemoore/code/pi-long-horizon/.pi/extensions/context-steward.ts"
        requirementIds:
          - "AC-2.1"
          - "TC-2.1a"
          - "TC-2.1b"
          - "TC-2.1c"
          - "TC-2.1e"
          - "TC-2.1f"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "story2-runtime-note-events-dropped"
        severity: "major"
        title: "Runtime-note capture exists only as a test helper and drops live runtime events"
        evidence: "TC-2.1d requires finalized runtime notes from extension events (docs/spec-build/epics/01-session-context-store/stories/02-live-pi-activity-capture.md:61-64). The tech design says lifecycle/readiness events such as `turn_start`, `turn_end`, `session_start`, `session_before_switch`, and `session_shutdown` are the runtime-note source when relevant (docs/spec-build/epics/01-session-context-store/tech-design.md:54-57, 736-738). The only runtime-note builder is `createPiRuntimeNoteActivity` in `src/context-steward/pi/pi-message-mapper.ts:444-489`, but its only callsite is the unit test at `tests/context-steward/capture-service.test.ts:175-184`. In production code, `src/context-steward/pi/pi-extension.ts:41-48` returns `ok(undefined)` for every non-`message_end` event, so no live session/turn/capture-status event is converted into a canonical `runtime_note` message."
        affectedFiles:
          - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-extension.ts"
          - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-message-mapper.ts"
          - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/capture-service.test.ts"
        requirementIds:
          - "AC-2.1"
          - "TC-2.1d"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "story2-missing-live-extension-hook"
        severity: "major"
        title: "Live PI capture is not wired into a real extension entrypoint"
        evidence: "AC-2.1 requires capture during PI extension events (docs/spec-build/epics/01-session-context-store/stories/02-live-pi-activity-capture.md:47-72), and the tech design assigns `pi-extension.ts` the extension-event hookup plus a project entrypoint `.pi/extensions/context-steward.ts` (docs/spec-build/epics/01-session-context-store/tech-design.md:119-121, 228-263, 700-754). The implemented `src/context-steward/pi/pi-extension.ts:1-72` only exports helper functions and never imports `ExtensionAPI`, exports a default extension factory, or calls `pi.on(\"message_end\", ...)`. The repo also has no `.pi/extensions/context-steward.ts` file; `rg --files .pi src` shows only `.pi/extensions/thinking-level.ts` under `.pi/extensions`. `capturePiEvent` is referenced only from `tests/context-steward/capture-service.test.ts:484-526`, so there is no production callsite proving real PI `message_end` traffic reaches `capture-service`."
        affectedFiles:
          - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-extension.ts"
          - "/Users/leemoore/code/pi-long-horizon/.pi/extensions/context-steward.ts"
        requirementIds:
          - "AC-2.1"
          - "TC-2.1a"
          - "TC-2.1b"
          - "TC-2.1c"
          - "TC-2.1e"
          - "TC-2.1f"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "story2-runtime-note-events-dropped"
        severity: "major"
        title: "Runtime-note capture exists only as a test helper and drops live runtime events"
        evidence: "TC-2.1d requires finalized runtime notes from extension events (docs/spec-build/epics/01-session-context-store/stories/02-live-pi-activity-capture.md:61-64). The tech design says lifecycle/readiness events such as `turn_start`, `turn_end`, `session_start`, `session_before_switch`, and `session_shutdown` are the runtime-note source when relevant (docs/spec-build/epics/01-session-context-store/tech-design.md:54-57, 736-738). The only runtime-note builder is `createPiRuntimeNoteActivity` in `src/context-steward/pi/pi-message-mapper.ts:444-489`, but its only callsite is the unit test at `tests/context-steward/capture-service.test.ts:175-184`. In production code, `src/context-steward/pi/pi-extension.ts:41-48` returns `ok(undefined)` for every non-`message_end` event, so no live session/turn/capture-status event is converted into a canonical `runtime_note` message."
        affectedFiles:
          - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-extension.ts"
          - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-message-mapper.ts"
          - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/capture-service.test.ts"
        requirementIds:
          - "AC-2.1"
          - "TC-2.1d"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "AC-2.2"
        - "TC-2.2a"
        - "TC-2.2b"
        - "TC-2.2c"
        - "AC-2.4"
        - "TC-2.4a"
        - "TC-2.4b"
      unverified:
        - "AC-2.1"
        - "TC-2.1a"
        - "TC-2.1b"
        - "TC-2.1c"
        - "TC-2.1d"
        - "TC-2.1e"
        - "TC-2.1f"
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "The production PI extension path is not wired: there is no real `ExtensionAPI` registration or `.pi/extensions/context-steward.ts` entrypoint connecting live `message_end` events to `capture-service`."
      - "Runtime-note capture is test-only today: `createPiRuntimeNoteActivity` has no production callsite, and `pi-extension.ts` drops non-`message_end` events instead of persisting relevant runtime/session notes."
    recommendedNextStep: "revise"
    recommendedFixScope: "same-session-implementor"
    openQuestions:
[]
    additionalObservations:
      - "Service-level evidence is otherwise solid for ordered typed-part mapping, duplicate suppression, append-failure reporting, signature-only reasoning preservation, and repair-needed degradation; those behaviors are covered in `tests/context-steward/capture-service.test.ts`."
      - "`npm run verify-all` exited 0 because `scripts/run-node-tests.mjs` treats an empty integration-test set as success; the repo currently has no `*.integration.test.ts` files, so that gate adds no integration signal yet."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/004-verify.json"
  startedAt: "2026-05-10T03:48:38.722Z"
  finishedAt: "2026-05-10T03:54:20.156Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/003-implementor.json
bytes: 3914
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "fa802d72-0286-4358-9c66-fc4e4871ae24"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e0ff3-9282-7952-897b-820318b0c31e"
    continuation:
      provider: "codex"
      sessionId: "019e0ff3-9282-7952-897b-820318b0c31e"
      storyId: "02-live-pi-activity-capture"
    outcome: "ready-for-verification"
    story:
      id: "02-live-pi-activity-capture"
      title: "Story 2: Live PI Activity Capture"
    planSummary: "Implemented the live PI activity capture seam for Story 2 by adding finalized PI message mapping, canonical capture orchestration with duplicate suppression and append-failure reporting, a thin PI event helper that only captures `message_end`, and full capture-service coverage for the story’s mapped test conditions and non-TC risks."
    changedFiles:
      -
        path: "src/context-steward/services/capture-service.ts"
        reason: "Adds canonical finalized-activity capture orchestration, duplicate-as-success handling, append failure reporting, and repair-needed degradation when downstream turn persistence fails."
      -
        path: "src/context-steward/pi/pi-message-mapper.ts"
        reason: "Maps finalized PI user, assistant, tool-result, and runtime-note activity into canonical actors, message kinds, ordered typed parts, target metadata, and deterministic target event keys."
      -
        path: "src/context-steward/pi/pi-extension.ts"
        reason: "Adds a thin PI event capture helper that routes `message_end` into capture and ignores non-finalized tool lifecycle events."
      -
        path: "src/context-steward/test/fixtures.ts"
        reason: "Adds reusable PI extension-context fixtures for capture and mapper tests."
      -
        path: "tests/context-steward/capture-service.test.ts"
        reason: "Adds Story 2 coverage for finalized prompt/response/tool-result/runtime-note capture, duplicate suppression, typed-part preservation, append failure reporting, repair-needed degradation, and ignored tool lifecycle events."
    tests:
      added:
        - "tests/context-steward/capture-service.test.ts"
      modified:
[]
      removed:
[]
      totalAfterStory: 44
      deltaFromPriorBaseline: 15
    gatesRun:
      -
        command: "npm run typecheck"
        result: "pass"
      -
        command: "node --import tsx --test tests/context-steward/capture-service.test.ts"
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
        - "Mapped finalized PI user, assistant, tool-result, and runtime-note activity into canonical messages with ordered typed parts and PI target metadata."
        - "Changed duplicate finalized-event handling to return success with the already-persisted message plus `CAPTURE_DUPLICATE_EVENT`, instead of treating duplicates as a hard failure."
        - "Preserved source-message commits when downstream turn persistence fails by degrading thread turn state to `repair_needed` and covering that path with tests."
      findingsSurfaced:
        - "Live PI dogfooding should still confirm whether `message_end` reliably exposes a stronger stable identifier than the current `sessionEntryId`/`responseId`/`toolCallId` plus fingerprint fallback used for duplicate keys."
    openQuestions:
      - "Should live dogfood standardize duplicate detection on a specific `message_end` field if PI consistently exposes one beyond the current fallback key strategy?"
    specDeviations:
[]
    recommendedNextStep: "Run verification against live PI extension traffic, then wire Story 3’s real turn writer into the new capture-service seam so prompt-bounded turn membership replaces the current injected turn-writer boundary."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/003-implementor.json"
  startedAt: "2026-05-10T03:34:41.307Z"
  finishedAt: "2026-05-10T03:48:28.191Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/story-lead/001-current.json
Bytes: 2144

```yaml
storyRunId: "02-live-pi-activity-capture-story-run-001"
storyId: "02-live-pi-activity-capture"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-verify completed with outcome revise and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/004-verify.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e0ff3-9282-7952-897b-820318b0c31e"
    storyId: "02-live-pi-activity-capture"
  storyVerifier:
    provider: "codex"
    sessionId: "019e1000-59a6-73b1-9075-d12bfaf1c120"
    storyId: "02-live-pi-activity-capture"
latestEventSequence: 9
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "Implementation reports Story 2 ready for verification with local gates passing, but the run has no independent verifier result yet. The smallest safe next action is to run story verification against the implementor artifact before considering acceptance."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/004-verify.json"
replayBoundary: null
updatedAt: "2026-05-10T03:54:20.165Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After verifier returns, accept only if final verifier outcome is pass, no open findings remain, and story gate evidence is present; otherwise choose quick-fix, continue, block, or request ruling based on verifier findings.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-10T03:34:41.272Z; note="After implementation returns, inspect test/gate evidence before choosing verify, quick-fix, or self-review; do not accept without a passing verifier result and story gate evidence."
- sequence=8; actionSequence=7; createdAt=2026-05-10T03:48:38.682Z; note="After verifier returns, accept only if final verifier outcome is pass, no open findings remain, and story gate evidence is present; otherwise choose quick-fix, continue, block, or request ruling based on verifier findings."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/story-lead/001-events.jsonl
Bytes: 4192

```yaml
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 1
  timestamp: "2026-05-10T03:34:27.838Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 2
  timestamp: "2026-05-10T03:34:41.251Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e0ff3-5dd5-7ac3-983b-f3485f5c81b1"
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 3
  timestamp: "2026-05-10T03:34:41.272Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, inspect test/gate evidence before choosing verify, quick-fix, or self-review; do not accept without a passing verifier result and story gate evidence."
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 4
  timestamp: "2026-05-10T03:34:41.272Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, inspect test/gate evidence before choosing verify, quick-fix, or self-review; do not accept without a passing verifier result and story gate evidence."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 5
  timestamp: "2026-05-10T03:48:28.202Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 6
  timestamp: "2026-05-10T03:48:38.655Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e1000-3092-78e3-b2ea-cf00a2f16248"
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 7
  timestamp: "2026-05-10T03:48:38.681Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "After verifier returns, accept only if final verifier outcome is pass, no open findings remain, and story gate evidence is present; otherwise choose quick-fix, continue, block, or request ruling based on verifier findings."
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 8
  timestamp: "2026-05-10T03:48:38.682Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After verifier returns, accept only if final verifier outcome is pass, no open findings remain, and story gate evidence is present; otherwise choose quick-fix, continue, block, or request ruling based on verifier findings."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "02-live-pi-activity-capture-story-run-001"
  sequence: 9
  timestamp: "2026-05-10T03:54:20.165Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/02-live-pi-activity-capture/004-verify.json"
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
