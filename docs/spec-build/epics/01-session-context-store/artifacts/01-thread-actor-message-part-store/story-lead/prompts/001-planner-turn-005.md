# Story Lead Base Prompt

## Role Charter
You are the story lead for `01-thread-actor-message-part-store` on durable story run `01-thread-actor-message-part-store-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 5.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/stories/01-thread-actor-message-part-store.md
Bytes: 10764

# Story 1: Thread, Actor, Message, And Part Store

### Summary
<!-- Jira: Summary field -->

Create the managed Thread store foundation: Thread creation/opening, target metadata, schema gating, actor declarations, append-only source messages, and canonical message ordering.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Create and read the canonical Thread store records that all later capture, import, repair, and fixture work depends on.

**In Scope**

- Create or open one active canonical Thread for a PI target.
- Store target metadata separately from source records.
- Block mutation for unsupported schema versions.
- Declare and reuse Thread-level actors.
- Append source messages with stable canonical order.
- Preserve message content and source order when turn state changes or repair runs later.

**Out of Scope**

- Mapping live PI events into Messages.
- Prompt-bounded Turn lifecycle.
- Attach/import and repair behavior.
- Fixture creation.

**Dependencies**

- Story 0 complete.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-1.1:** A managed PI session has one active canonical Thread.

- **TC-1.1a: New managed session creates source thread**
  - Given: No managed Thread exists for the PI session
  - When: Context Steward starts capture for the session
  - Then: A Thread exists with a unique thread identifier, target runtime `pi`, schema version metadata, and no stored source messages
- **TC-1.1b: Existing managed session opens source thread**
  - Given: A managed Thread already exists for the PI session
  - When: Context Steward starts capture for the session
  - Then: The existing Thread is opened and no duplicate active Thread is created for the same session association
- **TC-1.1c: Store unavailable on session start**
  - Given: The canonical store cannot be read or written
  - When: Context Steward starts capture for the session
  - Then: The steward reports `STORE_UNAVAILABLE` and does not create or open a Thread

**AC-1.2:** The Thread records target metadata for the PI session without treating the PI session file as the source Thread.

- **TC-1.2a: Target metadata is recorded**
  - Given: A Thread is created or opened for a PI session
  - When: The session association is established
  - Then: The Thread records the target runtime, target session identifier when available, and current generated PI session file path when available
- **TC-1.2b: Source history remains independent**
  - Given: A Thread has target metadata for a PI session file
  - When: Stored messages are read from the Thread
  - Then: Source messages are read from canonical Thread records, not from the generated PI session file

**AC-1.3:** Thread data exposes schema version metadata before source records are mutated.

- **TC-1.3a: Supported schema allows mutation**
  - Given: A Thread has a supported schema version
  - When: Context Steward appends a message or writes turn state
  - Then: The write can proceed
- **TC-1.3b: Unsupported schema blocks mutation**
  - Given: A Thread has an unsupported schema version
  - When: Context Steward attempts to append a message or write turn state
  - Then: The write is rejected with a status that names the schema incompatibility

**AC-1.4:** Actors are declared at Thread level and referenced by stored messages.

- **TC-1.4a: Actor declared before message reference**
  - Given: A finalized PI message is captured from an actor not yet known to the Thread
  - When: The message is stored
  - Then: The Thread has an actor record with actor type, actor identifier, and display label when available
- **TC-1.4b: Existing actor reused**
  - Given: A Thread already has an actor record for the message actor
  - When: Another message from that actor is stored
  - Then: The message references the existing actor identity

**AC-2.3:** Stored messages are append-only source records.

- **TC-2.3a: Captured message is not mutated by later turn updates**
  - Given: A stored Message belongs to a Turn
  - When: The Turn state changes from open to closed
  - Then: The stored Message content, parts, actor identity, message kind, timestamp, and source order remain unchanged
- **TC-2.3b: Captured message is not mutated by repair**
  - Given: A stored Message exists before turn repair
  - When: Turn repair reconstructs membership
  - Then: The stored Message content and source order remain unchanged

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 1 establishes the canonical persistence surface that every later story depends on: one active Thread per PI target, immutable source messages, thread-level actors, and metadata that points to PI without letting PI's session file become source truth. The design pressure here is authority. `messages.jsonl` is immutable source history, while `thread.json` and the root `index.json` are control-plane state that tell the rest of the system which thread is active and whether it is safe to mutate.

This story also owns the global association rule that attach/import and live capture rely on later. If target-key derivation or `index.json` recovery is fuzzy here, Story 5 will either create duplicate managed threads or need to re-implement the same uniqueness logic from scratch. Story 4 extends this same metadata surface for generated-session tracking, so this story needs to keep metadata ownership crisp instead of widening `thread.json` into a catch-all record dump.

#### Implementation Targets

| Owned Targets | Files / Modules |
|---|---|
| Store interface and file layout | `src/context-steward/store/thread-store.ts`, `src/context-steward/store/file-thread-store.ts`, `src/context-steward/store/schema-version.ts` |
| Thread and actor lifecycle | `src/context-steward/services/thread-service.ts` |
| Primary tests | `tests/context-steward/thread-store.test.ts` |

| Integration Touchpoints | Files / Modules |
|---|---|
| Shared canonical record types from Story 0 | `src/context-steward/domain/records.ts` |

#### Design References

- [tech-design.md §Architecture Decisions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:188), lines 188-205
- [tech-design.md §Record Schemas](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:292), lines 292-452
- [tech-design.md §Store Interface](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:503), lines 503-655
- [tech-design.md §Target Session Key Contract](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:595), lines 595-617
- [tech-design.md §Flow 1: Source Thread Initialization](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:658), lines 658-699
- [tech-design.md §Flow 3: Generated PI Session Target Metadata](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:755), lines 755-787
- [test-plan.md `thread-store.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:55), lines 55-78

#### Test Mapping

| TC | Test File / Check | Test Description |
|---|---|---|
| TC-1.1a, TC-1.1b, TC-1.1c | `tests/context-steward/thread-store.test.ts` | create or reopen one managed Thread for a PI target and report unavailable store state |
| TC-1.2a, TC-1.2b | `tests/context-steward/thread-store.test.ts` | persist PI target metadata while keeping source reads independent from generated PI session files |
| TC-1.3a, TC-1.3b | `tests/context-steward/thread-store.test.ts` | allow mutation only for supported schema versions |
| TC-1.4a, TC-1.4b | `tests/context-steward/thread-store.test.ts` | declare actors before message reference and reuse existing actor identities |
| TC-2.3a, TC-2.3b | `tests/context-steward/thread-store.test.ts` | preserve append-only message content and source order across later turn closure and repair |

#### Non-TC Decided Tests

- `tests/context-steward/thread-store.test.ts`: NTC-3 atomic metadata rewrite leaves the prior committed file intact on failed temp write
- `tests/context-steward/thread-store.test.ts`: NTC-4 duplicate target index rebuilds from existing messages on startup

#### Technical Notes

- `index.json` is the source of truth for target-session association. Use the canonical and alias key rules from `deriveTargetSessionKeys(...)`; do not let later stories invent alternate lookup keys.
- `thread.json` keeps import and projection summaries only. `imports.json` and `projections.json` own those collections and Story 4 should extend that same ownership model rather than collapsing everything into thread metadata.
- This story owns the immutable message guarantee. Future stories may reference or group messages, but they should not widen the store to mutate existing `MessageRecord`s.

#### Anti-Shim Requirements

- Use real temp directories and atomic rename behavior for store tests instead of mocking filesystem persistence away.
- Prove duplicate-target protection through `index.json` and target-key alias behavior, not just by stubbing `findThreadByTarget(...)`.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- `ThreadStore` and `FileThreadStore` create/open managed Threads.
- Target association prevents duplicate active Threads for the same PI target.
- Schema version gate blocks unsupported writes.
- Actor declaration and reuse are implemented.
- Messages append with stable `sourceOrder` and are not mutated by later turn or repair operations.
- `thread-store.test.ts` covers all TCs assigned to this story.


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
- planner_turn_index: 5
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-verify completed with outcome revise and status ok.
- latest_response_kind: verifier-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/006-verify.json
- older_response_count: 3
- caller_input_artifact_count: 0
- prior_self_note_count: 3
- latest_self_note: "If verifier outcome is pass with no open findings and npm run verify evidence is present, recommend acceptance next; otherwise route the smallest fix/block/ruling action from the verifier evidence."

## Response Trail
<current_response>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/006-verify.json
bytes: 10615
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "9eaf850c-617c-47d4-a199-0e52c3b9dd49"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e0fc9-f40e-73d3-89e1-9d8786ae57cc"
    continuation:
      provider: "codex"
      sessionId: "019e0fc9-f40e-73d3-89e1-9d8786ae57cc"
      storyId: "01-thread-actor-message-part-store"
    mode: "initial"
    story:
      id: "01-thread-actor-message-part-store"
      title: "Story 1: Thread, Actor, Message, And Part Store"
    artifactsRead:
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/stories/01-thread-actor-message-part-store.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/tech-design.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/test-plan.md"
      - "/Users/leemoore/code/pi-long-horizon/package.json"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/domain/errors.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/domain/ids.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/domain/records.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/store/thread-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/store/file-thread-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/store/schema-version.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/services/thread-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/test/fixtures.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/test/temp-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/thread-store.test.ts"
    reviewScopeSummary: "Reviewed Story 1’s persistence foundation against the story, full tech design, and test plan, then inspected the implemented Thread store/domain/thread-service surfaces and the dedicated `thread-store.test.ts` coverage before running `npm run verify` and `npm run verify-all`."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "S1-01"
        severity: "major"
        title: "A thread created from `sessionFilePath` only can be reopened from `sessionId` as a second active thread"
        evidence: "`openOrCreateManagedThread` only looks up the exact key set present on the current call (`src/context-steward/services/thread-service.ts:39-49`). When the first association is file-path-only, `deriveTargetSessionKeys` emits only a file key (`src/context-steward/domain/ids.ts:167-195`), and `findThreadByTarget` only checks the incoming key set (`src/context-steward/store/file-thread-store.ts:180-206, 840-848`). Manual repro: create a managed thread with `{ runtime: \"pi\", sessionFilePath }`, then call `openOrCreateManagedThread` with `{ runtime: \"pi\", sessionId }`; the second call returned a different `threadId` and `readdir(.context-steward/threads)` showed two thread directories. `tests/context-steward/thread-store.test.ts:85-109` only covers reopen behavior when the later lookup still carries the original association data, so TC-1.1b is not actually established for identifier transitions."
        affectedFiles:
          - "src/context-steward/services/thread-service.ts"
          - "src/context-steward/store/file-thread-store.ts"
          - "src/context-steward/domain/ids.ts"
          - "tests/context-steward/thread-store.test.ts"
        requirementIds:
          - "TC-1.1b"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "S1-02"
        severity: "major"
        title: "`STORE_UNAVAILABLE` during thread creation can still leave an openable managed thread behind"
        evidence: "`createThread` writes the thread snapshot files before it updates `index.json` (`src/context-steward/store/file-thread-store.ts:131-145, 769-783`), but cleanup only runs when the later `index.json` write fails (`src/context-steward/store/file-thread-store.ts:138-143`). A manual repro that throws while writing `actors.json` returned `STORE_UNAVAILABLE`, yet the new thread directory remained under `.context-steward/threads`, and a fresh `FileThreadStore.findThreadByTarget(...)` reopened that thread successfully. `tests/context-steward/thread-store.test.ts:112-121` only exercises root-creation failure, so the implemented path contradicts TC-1.1c’s requirement that a failed session start must not create or open a Thread."
        affectedFiles:
          - "src/context-steward/store/file-thread-store.ts"
          - "tests/context-steward/thread-store.test.ts"
        requirementIds:
          - "TC-1.1c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "S1-03"
        severity: "major"
        title: "Concurrent writes are only serialized per store instance, leaving the real file store race-prone"
        evidence: "`FileThreadStore` keeps its write queue on each instance (`src/context-steward/store/file-thread-store.ts:98-108, 557-580`), and temp-file names only use basename + pid + `Date.now()` (`src/context-steward/store/file-thread-store.ts:536-549`). Two `FileThreadStore` instances writing the same thread therefore do not coordinate. Manual repro: two concurrent `appendSourceMessage` calls against the same thread through two store instances produced `STORE_UNAVAILABLE` from an `ENOENT` rename on `.actors.json.<pid>.<ms>.tmp`, and only one message was appended. `npm run verify-all` exited 0 but reported `No integration tests found.`, so the concurrency/file-store smoke coverage called for in the tech design is still missing."
        affectedFiles:
          - "src/context-steward/store/file-thread-store.ts"
          - "tests/context-steward/thread-store.test.ts"
        requirementIds:
[]
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "S1-01"
        severity: "major"
        title: "A thread created from `sessionFilePath` only can be reopened from `sessionId` as a second active thread"
        evidence: "`openOrCreateManagedThread` only looks up the exact key set present on the current call (`src/context-steward/services/thread-service.ts:39-49`). When the first association is file-path-only, `deriveTargetSessionKeys` emits only a file key (`src/context-steward/domain/ids.ts:167-195`), and `findThreadByTarget` only checks the incoming key set (`src/context-steward/store/file-thread-store.ts:180-206, 840-848`). Manual repro: create a managed thread with `{ runtime: \"pi\", sessionFilePath }`, then call `openOrCreateManagedThread` with `{ runtime: \"pi\", sessionId }`; the second call returned a different `threadId` and `readdir(.context-steward/threads)` showed two thread directories. `tests/context-steward/thread-store.test.ts:85-109` only covers reopen behavior when the later lookup still carries the original association data, so TC-1.1b is not actually established for identifier transitions."
        affectedFiles:
          - "src/context-steward/services/thread-service.ts"
          - "src/context-steward/store/file-thread-store.ts"
          - "src/context-steward/domain/ids.ts"
          - "tests/context-steward/thread-store.test.ts"
        requirementIds:
          - "TC-1.1b"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "S1-02"
        severity: "major"
        title: "`STORE_UNAVAILABLE` during thread creation can still leave an openable managed thread behind"
        evidence: "`createThread` writes the thread snapshot files before it updates `index.json` (`src/context-steward/store/file-thread-store.ts:131-145, 769-783`), but cleanup only runs when the later `index.json` write fails (`src/context-steward/store/file-thread-store.ts:138-143`). A manual repro that throws while writing `actors.json` returned `STORE_UNAVAILABLE`, yet the new thread directory remained under `.context-steward/threads`, and a fresh `FileThreadStore.findThreadByTarget(...)` reopened that thread successfully. `tests/context-steward/thread-store.test.ts:112-121` only exercises root-creation failure, so the implemented path contradicts TC-1.1c’s requirement that a failed session start must not create or open a Thread."
        affectedFiles:
          - "src/context-steward/store/file-thread-store.ts"
          - "tests/context-steward/thread-store.test.ts"
        requirementIds:
          - "TC-1.1c"
        recommendedFixScope: "same-session-implementor"
        blocking: true
      -
        id: "S1-03"
        severity: "major"
        title: "Concurrent writes are only serialized per store instance, leaving the real file store race-prone"
        evidence: "`FileThreadStore` keeps its write queue on each instance (`src/context-steward/store/file-thread-store.ts:98-108, 557-580`), and temp-file names only use basename + pid + `Date.now()` (`src/context-steward/store/file-thread-store.ts:536-549`). Two `FileThreadStore` instances writing the same thread therefore do not coordinate. Manual repro: two concurrent `appendSourceMessage` calls against the same thread through two store instances produced `STORE_UNAVAILABLE` from an `ENOENT` rename on `.actors.json.<pid>.<ms>.tmp`, and only one message was appended. `npm run verify-all` exited 0 but reported `No integration tests found.`, so the concurrency/file-store smoke coverage called for in the tech design is still missing."
        affectedFiles:
          - "src/context-steward/store/file-thread-store.ts"
          - "tests/context-steward/thread-store.test.ts"
        requirementIds:
[]
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "TC-1.1a"
        - "TC-1.2a"
        - "TC-1.2b"
        - "TC-1.3a"
        - "TC-1.3b"
        - "TC-1.4a"
        - "TC-1.4b"
        - "TC-2.3a"
        - "TC-2.3b"
      unverified:
        - "TC-1.1b"
        - "TC-1.1c"
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "A file-path-only managed association can still duplicate into a second active thread when the next open uses only `sessionId`."
      - "A mid-create filesystem failure can leave a real thread directory that a fresh store instance reopens even though the original call returned `STORE_UNAVAILABLE`."
      - "Two `FileThreadStore` instances can race on actor/message persistence because serialization is instance-local, not process-wide."
    recommendedNextStep: "revise"
    recommendedFixScope: "same-session-implementor"
    openQuestions:
[]
    additionalObservations:
      - "`npm run verify` passed 24 tests, and `npm run verify-all` exited 0, but the epic gate currently provides no integration coverage because it reports `No integration tests found.`"
      - "The explicit story-unit coverage is otherwise strong for target metadata persistence, schema gating, actor reuse, and append-only invariants across later turn-state rewrites."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/006-verify.json"
  startedAt: "2026-05-10T02:49:13.779Z"
  finishedAt: "2026-05-10T02:58:19.015Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/004-implementor.json
bytes: 3512
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "aff0574d-8fee-4fc9-bc76-580103080632"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e0fb5-cf76-7e91-88b6-7cbffbfc16f4"
    continuation:
      provider: "codex"
      sessionId: "019e0fb5-cf76-7e91-88b6-7cbffbfc16f4"
      storyId: "01-thread-actor-message-part-store"
    outcome: "ready-for-verification"
    story:
      id: "01-thread-actor-message-part-store"
      title: "Story 1: Thread, Actor, Message, And Part Store"
    planSummary: "Implemented the Story 1 thread-store foundation: schema-version gating, the file-backed `ThreadStore` interface and persistence layout, thread/actor/message lifecycle helpers in `thread-service`, target-session association indexing with startup rebuilds, minimal generated-session metadata support, and the full scoped `thread-store` test coverage against real temp directories."
    changedFiles:
      -
        path: "src/context-steward/store/schema-version.ts"
        reason: "Added the supported-schema contract and mutation guard used before thread writes."
      -
        path: "src/context-steward/store/thread-store.ts"
        reason: "Defined the canonical store interface, snapshots, and mutation input contracts for thread, actor, message, turn, import, projection, and fixture persistence."
      -
        path: "src/context-steward/store/file-thread-store.ts"
        reason: "Implemented the filesystem-backed thread store with atomic JSON metadata writes, append-only `messages.jsonl`, target-session association indexing, startup index reconciliation, schema gating, and minimal projection/fixture persistence surfaces."
      -
        path: "src/context-steward/services/thread-service.ts"
        reason: "Added managed-thread open/create behavior, actor declaration and reuse helpers, source-message append orchestration, and generated-session metadata updates."
      -
        path: "tests/context-steward/thread-store.test.ts"
        reason: "Added the Story 1 persistence test suite covering create/open behavior, target metadata ownership, schema gating, actor reuse, append-only message guarantees, generated-session metadata, atomic metadata writes, and target-index rebuilds."
    tests:
      added:
        - "tests/context-steward/thread-store.test.ts"
      modified:
[]
      removed:
[]
      totalAfterStory: 23
      deltaFromPriorBaseline: 19
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    selfReview:
      passesRun: 0
      findingsFixed:
        - "Backfilled target-session alias keys when an existing managed thread gains a session file path so `index.json` remains authoritative for later reopen/lookups."
        - "Updated the thread-store tests to materialize real session files so `deriveTargetSessionKeys(...)` exercises the required realpath behavior instead of relying on missing-path fallthrough."
        - "Proved failed temp metadata writes leave the last committed `thread.json` intact and that startup rebuilds missing target-key mappings from on-disk threads."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Hand this story to independent verification, then move to Story 2 using the new thread-store and thread-service seams as the capture foundation."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/004-implementor.json"
  startedAt: "2026-05-10T02:27:13.675Z"
  finishedAt: "2026-05-10T02:41:02.949Z"
```
</history_entry>

<history_entry>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/005-verify.json
bytes: 5978
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "revise"
  result:
    resultId: "1365df95-646a-444f-a115-c9a03f972843"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e0fc2-9a63-7412-9202-0c84ae12ed89"
    continuation:
      provider: "codex"
      sessionId: "019e0fc2-9a63-7412-9202-0c84ae12ed89"
      storyId: "01-thread-actor-message-part-store"
    mode: "initial"
    story:
      id: "01-thread-actor-message-part-store"
      title: "Story 1: Thread, Actor, Message, And Part Store"
    artifactsRead:
      - "docs/spec-build/epics/01-session-context-store/stories/01-thread-actor-message-part-store.md"
      - "docs/spec-build/epics/01-session-context-store/tech-design.md"
      - "docs/spec-build/epics/01-session-context-store/test-plan.md"
      - "package.json"
      - "scripts/run-node-tests.mjs"
      - "src/context-steward/domain/records.ts"
      - "src/context-steward/domain/errors.ts"
      - "src/context-steward/domain/ids.ts"
      - "src/context-steward/store/thread-store.ts"
      - "src/context-steward/store/schema-version.ts"
      - "src/context-steward/store/file-thread-store.ts"
      - "src/context-steward/services/thread-service.ts"
      - "src/context-steward/test/fixtures.ts"
      - "src/context-steward/test/temp-store.ts"
      - "tests/context-steward/foundation.test.ts"
      - "tests/context-steward/thread-store.test.ts"
    reviewScopeSummary: "Verified Story 1’s file-backed thread store, root target-association index, schema gating, actor/message persistence, append-only message behavior, and generated-session metadata against the story/test-plan evidence, then ran the story and epic verification commands."
    priorFindingStatuses:
[]
    newFindings:
      -
        id: "S1-F001"
        severity: "major"
        title: "Conflicting target-metadata updates can corrupt the active-thread association state after returning an error"
        evidence: "`src/context-steward/store/file-thread-store.ts:359-445` persists `thread.json` at line 401 before it derives the next target keys and rejects conflicts at lines 434-440. That means a failed `updateThreadMetadata(...)` can still rewrite the thread’s persisted target. I reproduced this with a temp store by creating threads for `session-a` and `session-b`, then updating thread A to thread B’s target: the call correctly returned `TARGET_ASSOCIATION_CONFLICT`, but thread A’s on-disk `thread.json` had already been rewritten to `session-b`, and a fresh `findThreadByTarget(targetA)` then failed with `TARGET_ASSOCIATION_CONFLICT` because both thread directories now claimed the same target. This breaks the story-owned uniqueness contract in `docs/spec-build/epics/01-session-context-store/stories/01-thread-actor-message-part-store.md:50-63` and the root-index recovery contract in `docs/spec-build/epics/01-session-context-store/tech-design.md:593-616`. The existing suite covers successful reopen/rebuild flows, but it does not cover this failed-reassociation rollback path."
        affectedFiles:
          - "src/context-steward/store/file-thread-store.ts"
          - "tests/context-steward/thread-store.test.ts"
        requirementIds:
          - "AC-1.1"
          - "TC-1.1b"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    openFindings:
      -
        id: "S1-F001"
        severity: "major"
        title: "Conflicting target-metadata updates can corrupt the active-thread association state after returning an error"
        evidence: "`src/context-steward/store/file-thread-store.ts:359-445` persists `thread.json` at line 401 before it derives the next target keys and rejects conflicts at lines 434-440. That means a failed `updateThreadMetadata(...)` can still rewrite the thread’s persisted target. I reproduced this with a temp store by creating threads for `session-a` and `session-b`, then updating thread A to thread B’s target: the call correctly returned `TARGET_ASSOCIATION_CONFLICT`, but thread A’s on-disk `thread.json` had already been rewritten to `session-b`, and a fresh `findThreadByTarget(targetA)` then failed with `TARGET_ASSOCIATION_CONFLICT` because both thread directories now claimed the same target. This breaks the story-owned uniqueness contract in `docs/spec-build/epics/01-session-context-store/stories/01-thread-actor-message-part-store.md:50-63` and the root-index recovery contract in `docs/spec-build/epics/01-session-context-store/tech-design.md:593-616`. The existing suite covers successful reopen/rebuild flows, but it does not cover this failed-reassociation rollback path."
        affectedFiles:
          - "src/context-steward/store/file-thread-store.ts"
          - "tests/context-steward/thread-store.test.ts"
        requirementIds:
          - "AC-1.1"
          - "TC-1.1b"
        recommendedFixScope: "same-session-implementor"
        blocking: true
    requirementCoverage:
      verified:
        - "TC-1.1a"
        - "TC-1.1c"
        - "AC-1.2"
        - "TC-1.2a"
        - "TC-1.2b"
        - "AC-1.3"
        - "TC-1.3a"
        - "TC-1.3b"
        - "AC-1.4"
        - "TC-1.4a"
        - "TC-1.4b"
        - "AC-2.3"
        - "TC-2.3a"
        - "TC-2.3b"
        - "TC-4.1a"
        - "TC-4.1b"
        - "TC-4.1c"
        - "TC-4.2a"
        - "TC-4.2b"
        - "TC-4.2c"
      unverified:
        - "AC-1.1"
        - "TC-1.1b"
    gatesRun:
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
      - "No fake adapters, shim branches, placeholder branches, or mock runtime fallbacks were identified in the reviewed Story 1 production code."
      - "The real production path for failed target reassociation can leave `thread.json` and `index.json` out of sync, which then blocks future store operations with `TARGET_ASSOCIATION_CONFLICT` until repaired."
    recommendedNextStep: "revise"
    recommendedFixScope: "same-session-implementor"
    openQuestions:
[]
    additionalObservations:
      - "`npm run verify-all` exited 0 because `scripts/run-node-tests.mjs integration` reported `No integration tests found.` The epic-level integration smoke coverage listed in `test-plan.md` is still absent, but that did not cause the configured command to fail."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/005-verify.json"
  startedAt: "2026-05-10T02:41:12.054Z"
  finishedAt: "2026-05-10T02:46:42.496Z"
```
</history_entry>

<history_entry>
```yaml
kind: quick-fix-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/003-quick-fix.json
bytes: 9191
payload:
  command: "quick-fix"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    provider: "codex"
    model: "gpt-5.4"
    rawProviderOutputPreview: |-
      {"type":"thread.started","thread_id":"019e0fc7-d4a8-79a1-9e9e-b3cfee475fbc"}
      {"type":"turn.started"}
      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m treating this as a bug fix with a regression test, so I’m starting by tracing `FileThreadStore` and the existing target/index write path to see exactly where metadata is mutated too early. After that I’ll patch the ordering, add the failing test, and run `npm run verify` to make sure the full story gate stays green."}}
      {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' /Users/leemoore/.codex/skills/tdd/SKILL.md\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"sed -n '1,220p' /Users/leemoore/.codex/skills/tdd/SKILL.md\"","aggregated_output":"---\nname: tdd\ndescription: Test-driven development with red-green-refactor loop. Use when user wants to build features or fix bugs using TDD, mentions \"red-green-refactor\", wants integration tests, or asks for test-first development.\n---\n\n# Test-Driven Development\n\n## Philosophy\n\n**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.\n\n**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification - \"user can checkout with valid cart\" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.\n\n**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behavior hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.\n\nSee [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.\n\n## Anti-Pattern: Horizontal Slices\n\n**DO NOT write all tests first, then all implementation.** This is \"horizontal slicing\" - treating RED as \"write all tests\" and GREEN as \"write all code.\"\n\nThis produces **crap tests**:\n\n- Tests written in bulk test _imagined_ behavior, not _actual_ behavior\n- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior\n- Tests become insensitive to real changes - they pass when behavior breaks, fail when behavior is fine\n- You outrun your headlights, committing to test structure before understanding the implementation\n\n**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.\n\n```\nWRONG (horizontal):\n  RED:   test1, test2, test3, test4, test5\n  GREEN: impl1, impl2, impl3, impl4, impl5\n\nRIGHT (vertical):\n  RED→GREEN: test1→impl1\n  RED→GREEN: test2→impl2\n  RED→GREEN: test3→impl3\n  ...\n```\n\n## Workflow\n\n### 1. Planning\n\nWhen exploring the codebase, use the project's domain glossary so that test names and interface vocabulary match the project's language, and respect ADRs in the area you're touching.\n\nBefore writing any code:\n\n- [ ] Confirm with user what interface changes are needed\n- [ ] Confirm with user which behaviors to test (prioritize)\n- [ ] Identify opportunities for [deep modules](deep-modules.md) (small interface, deep implementation)\n- [ ] Design interfaces for [testability](interface-design.md)\n- [ ] List the behaviors to test (not implementation steps)\n- [ ] Get user approval on the plan\n\nAsk: \"What should the public interface look like? Which behaviors are most important to test?\"\n\n**You can't test everything.** Confirm with the user exactly which behaviors matter most. Focus testing effort on critical paths and complex logic, not every possible edge case.\n\n### 2. Tracer Bullet\n\nWrite ONE test that confirms ONE thing about the system:\n\n```\nRED:   Write test for first behavior → test fails\nGREEN: Write minimal code to pass → test passes\n```\n\nThis is your tracer bullet - proves the path works end-to-end.\n\n### 3. Incremental Loop\n\nFor each remaining behavior:\n\n```\nRED:   Write next test → fails\nGREEN: Minimal code to pass → passes\n```\n\nRules:\n\n- One test at a time\n- Only enough code to pass current test\n- Don't anticipate future tests\n- Keep tests focused on observable behavior\n\n### 4. Refactor\n\nAfter all tests pass, look for [refactor candidates](refactoring.md):\n\n- [ ] Extract duplication\n- [ ] Deepen modules (move complexity behind simple interfaces)\n- [ ] Apply SOLID principles where natural\n- [ ] Consider what new code reveals about existing code\n- [ ] Run tests after each refactor step\n\n**Never refactor while RED.** Get to GREEN first.\n\n## Checklist Per Cycle\n\n```\n[ ] Test describes behavior, not implementation\n[ ] Test uses public interface only\n[ ] Test would survive internal refactor\n[ ] Code is minimal for this test\n[ ] No speculative features added\n```\n","exit_code":0,"status":"completed"}}
      {"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc 'pwd && rg -n \"FileThreadStore|thread.json|index.json|target metadata|reassociate|target association|root target\" -S .'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
      {"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc 'pwd && rg -n \"FileThreadStore|thread.json|index.json|target metadata|reassociate|target association|root target\" -S .'","aggregated_output":"/Users/leemoore/code/pi-long-horizon\n./src/context-steward/store/file-thread-store.ts:98:export class FileThreadStore implements ThreadStore {\n./src/context-steward/store/file-thread-store.ts:107:    this.indexPath = join(rootDir, \"index.json\");\n./src/context-steward/store/file-thread-store.ts:643:            `Target key ${key} points to thread ${threadId} in index.json but thread ${expectedThreadId} on disk.`,\n./src/context-steward/store/file-thread-store.ts:650:          targetAssociationConflict(`Target key ${key} points to missing or stale thread ${threadId} in index.json.`),\n./src/context-steward/store/file-thread-store.ts:803:      thread: join(threadDir, \"thread.json\"),\n./src/context-steward/store/file-thread-store.ts:818:      thread: join(fixtureDir, \"thread.json\"),\n./docs/spec-build/technical-architecture.md:249:**Consequence:** `thread.json` or equivalent store metadata should record schema version, created version, and last migrated version. Readers should detect unsupported versions before mutation. Migrations belong in tech design, but every v1 record family should assume future schema evolution.\n./docs/spec-build/technical-architecture.md:346:      thread.json\n./docs/spec-build/technical-architecture.md:358:Generated PI session files live where PI expects them, not inside the canonical store unless PI is configured that way. `thread.json` records target metadata:\n./docs/spec-build/technical-architecture.md:396:- Exact file schemas for `thread.json`, `messages.jsonl`, `turns.jsonl`, `chunks.jsonl`, `jobs.jsonl`, and `projections.jsonl`.\n./tests/context-steward/thread-store.test.ts:13:import { FileThreadStore } from \"../../src/context-steward/store/file-thread-store.js\";\n./tests/context-steward/thread-store.test.ts:53:class TempWriteFailingFileThreadStore extends FileThreadStore {\n./tests/context-steward/thread-store.test.ts:57:    if (this.failNextThreadMetadataWrite && filePath.endsWith(\"thread.json\")) {\n./tests/context-steward/thread-store.test.ts:68:    const store = new FileThreadStore(storeRootDir);\n./tests/context-steward/thread-store.test.ts:87:    const store = new FileThreadStore(storeRootDir);\n./tests/cont
    rawProviderOutputBytes: 207992
    rawProviderOutputTruncated: true
    rawProviderOutputLogPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/streams/003-quick-fix.stdout.log"
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/003-quick-fix.json"
  startedAt: "2026-05-10T02:46:54.684Z"
  finishedAt: "2026-05-10T02:48:57.429Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/story-lead/001-current.json
Bytes: 2853

```yaml
storyRunId: "01-thread-actor-message-part-store-story-run-001"
storyId: "01-thread-actor-message-part-store"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-verify completed with outcome revise and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/002-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/004-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/005-verify.json"
    provenance: "current-run"
  -
    kind: "quick-fix-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/003-quick-fix.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/006-verify.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e0fb5-cf76-7e91-88b6-7cbffbfc16f4"
    storyId: "01-thread-actor-message-part-store"
  storyVerifier:
    provider: "codex"
    sessionId: "019e0fc9-f40e-73d3-89e1-9d8786ae57cc"
    storyId: "01-thread-actor-message-part-store"
latestEventSequence: 16
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "The quick-fix returned ready-for-verification after a prior blocking verifier finding, so the smallest safe next action is an independent verification pass before any acceptance recommendation."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/006-verify.json"
replayBoundary: null
updatedAt: "2026-05-10T02:58:19.023Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: If verifier outcome is pass with no open findings and npm run verify evidence is present, recommend acceptance next; otherwise route the smallest fix/block/ruling action from the verifier evidence.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-10T02:27:13.638Z; note="After implementation returns, check that story gate evidence includes npm run verify or a clear reason it could not run; do not recommend acceptance without a passing verifier and gate evidence."
- sequence=11; actionSequence=10; createdAt=2026-05-10T02:46:54.649Z; note="After quick-fix returns, run independent verification again; do not recommend acceptance until verifier outcome is pass with no open findings and npm run verify evidence is present."
- sequence=15; actionSequence=14; createdAt=2026-05-10T02:49:13.745Z; note="If verifier outcome is pass with no open findings and npm run verify evidence is present, recommend acceptance next; otherwise route the smallest fix/block/ruling action from the verifier evidence."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/story-lead/001-events.jsonl
Bytes: 7515

```yaml
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 1
  timestamp: "2026-05-10T02:26:58.303Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 2 existing artifact(s)."
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 2
  timestamp: "2026-05-10T02:27:13.616Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e0fb5-9379-7d32-867c-e84236604ef5"
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 3
  timestamp: "2026-05-10T02:27:13.637Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation returns, check that story gate evidence includes npm run verify or a clear reason it could not run; do not recommend acceptance without a passing verifier and gate evidence."
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 4
  timestamp: "2026-05-10T02:27:13.638Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation returns, check that story gate evidence includes npm run verify or a clear reason it could not run; do not recommend acceptance without a passing verifier and gate evidence."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 5
  timestamp: "2026-05-10T02:41:02.960Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/004-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 6
  timestamp: "2026-05-10T02:41:11.987Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e0fc2-76d5-72b1-9174-cf109f05abf0"
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 7
  timestamp: "2026-05-10T02:41:12.011Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 8
  timestamp: "2026-05-10T02:46:42.506Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/005-verify.json"
  data:
    actionType: "run-verify"
    command: "story-verify"
    outcome: "revise"
    status: "ok"
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 9
  timestamp: "2026-05-10T02:46:54.631Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/story-lead/prompts/001-planner-turn-003.md"
    sessionId: "019e0fc7-a52a-7ff0-8e1a-62b42de73a96"
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 10
  timestamp: "2026-05-10T02:46:54.649Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-quick-fix."
  data:
    actionType: "run-quick-fix"
    turn: 3
    selfNote: "After quick-fix returns, run independent verification again; do not recommend acceptance until verifier outcome is pass with no open findings and npm run verify evidence is present."
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 11
  timestamp: "2026-05-10T02:46:54.649Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After quick-fix returns, run independent verification again; do not recommend acceptance until verifier outcome is pass with no open findings and npm run verify evidence is present."
    actionSequence: 10
    actionType: "run-quick-fix"
    turn: 3
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 12
  timestamp: "2026-05-10T02:48:57.438Z"
  type: "child-operation-completed"
  summary: "quick-fix completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/quick-fix/003-quick-fix.json"
  data:
    actionType: "run-quick-fix"
    command: "quick-fix"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 13
  timestamp: "2026-05-10T02:49:13.722Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/story-lead/prompts/001-planner-turn-004.md"
    sessionId: "019e0fc9-b441-7232-b341-089a4334c8eb"
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 14
  timestamp: "2026-05-10T02:49:13.745Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 4
    selfNote: "If verifier outcome is pass with no open findings and npm run verify evidence is present, recommend acceptance next; otherwise route the smallest fix/block/ruling action from the verifier evidence."
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 15
  timestamp: "2026-05-10T02:49:13.745Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "If verifier outcome is pass with no open findings and npm run verify evidence is present, recommend acceptance next; otherwise route the smallest fix/block/ruling action from the verifier evidence."
    actionSequence: 14
    actionType: "run-verify"
    turn: 4
-
  storyRunId: "01-thread-actor-message-part-store-story-run-001"
  sequence: 16
  timestamp: "2026-05-10T02:58:19.023Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome revise and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/01-thread-actor-message-part-store/006-verify.json"
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
