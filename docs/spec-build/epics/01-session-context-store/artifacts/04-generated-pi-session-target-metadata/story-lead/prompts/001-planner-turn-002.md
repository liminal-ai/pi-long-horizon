# Story Lead Base Prompt

## Role Charter
You are the story lead for `04-generated-pi-session-target-metadata` on durable story run `04-generated-pi-session-target-metadata-story-run-001`.
Select exactly one bounded next action for this `run` turn.
This is planner turn 2.
Do not invent tools, bypass the bounded action protocol, or rely on hidden provider session memory.

## Authority Boundary
Impl-lead stays outside this loop and owns final story acceptance, receipts, commits, cleanup dispatch, and epic progression.
You may recommend acceptance, request a ruling, or block the story, but you do not accept the story on behalf of impl-lead.

## Requirements Source
Treat the story file and test plan below as the story-local requirements source for this turn.
Do not pull in epic, tech design, git status, git diff, or workspace summaries unless they are already present in the durable record below.

### Story Requirements
### story-file
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/stories/04-generated-pi-session-target-metadata.md
Bytes: 7502

# Story 4: Generated PI Session Target Metadata

### Summary
<!-- Jira: Summary field -->

Record generated PI session target metadata on the source Thread without treating generated PI session files as source records.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Store the PI target session association and current generated PI session file metadata needed by later projection work.

**In Scope**

- Current generated PI session file path metadata.
- Explicit representation when no generated path or projection revisions exist.
- Separation of canonical Thread identity from PI target session identity.
- Readable projection metadata without reading generated session content as the source Thread.

**Out of Scope**

- Smart compact, projection compilation, generated file writing, archive behavior, and PI reload. Feature 3 owns these.
- Full projection revision semantics beyond minimal metadata.

**Dependencies**

- Story 1 complete.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.1:** The source Thread records the current generated PI session file path when the path is known.

- **TC-4.1a: Generated path recorded**
  - Given: The generated PI session file path is available for a managed Thread
  - When: Target metadata is written
  - Then: The Thread records the path as the current generated PI session file path
- **TC-4.1b: Missing generated path is explicit**
  - Given: No generated PI session file path exists yet
  - When: Target metadata is read
  - Then: The Thread reports that no current generated file path is available
- **TC-4.1c: Projection revisions can be absent**
  - Given: A Thread has no generated-session output revisions
  - When: Generated-session metadata is read
  - Then: The absence of projection revisions is explicitly represented

**AC-4.2:** Target metadata distinguishes PI runtime association from canonical source records.

- **TC-4.2a: Target session id does not replace thread id**
  - Given: A Thread has a PI target session identifier
  - When: Thread identity is read
  - Then: The canonical Thread identifier and PI target session identifier are both visible as separate fields
- **TC-4.2b: Generated file path does not define message order**
  - Given: A Thread has a current generated PI session file path
  - When: Source messages are read
  - Then: Message ordering comes from the source Thread, not from generated file order
- **TC-4.2c: Projection metadata is readable without treating generated file as the source Thread**
  - Given: A Thread has generated-session output metadata from a prior operation
  - When: The Thread is read
  - Then: The metadata is available without reading generated PI session content as the source Thread

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 4 owns the narrow metadata seam between the canonical Thread and the generated PI session artifacts that later features will compile and reload. The important thing here is separation of concerns: Feature 1 records current generated-session association and optional projection revision metadata, but it does not start compiling or validating generated PI session content.

This story lives on the same persistence foundation as Story 1, so it should reuse the same store ownership rules rather than inventing a parallel projection model. `thread.json` holds the live target-association field used by PI today, while `projections.json` holds the full revision collection that later projection work can extend.

#### Implementation Targets

| Area | Files / Modules |
|---|---|
| Target metadata update/read behavior | `src/context-steward/services/thread-service.ts` |
| Projection metadata contracts | `src/context-steward/store/thread-store.ts` |
| File-backed persistence | `src/context-steward/store/file-thread-store.ts` |
| Primary tests | `tests/context-steward/thread-store.test.ts` |

#### Design References

- [tech-design.md §Record Schemas](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:292), lines 292-452
- [tech-design.md §File Layout](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:618), lines 618-647
- [tech-design.md §Flow 3: Generated PI Session Target Metadata](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:755), lines 755-787
- [tech-design.md §Chunk 1: Thread, Actor, Message, and Target Metadata Store](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1168), lines 1168-1181
- [test-plan.md `thread-store.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:55), lines 55-78

#### Test Mapping

| TC | Test File / Check | Test Description |
|---|---|---|
| TC-4.1a, TC-4.1b, TC-4.1c | `tests/context-steward/thread-store.test.ts` | record current generated PI session file path and represent missing path or empty projection revision state explicitly |
| TC-4.2a, TC-4.2b, TC-4.2c | `tests/context-steward/thread-store.test.ts` | keep PI target identity distinct from canonical Thread identity and source message ordering |

#### Non-TC Decided Tests

None.

#### Technical Notes

- `target.currentGeneratedFilePath` is the active runtime-association field. `projectionSummary.currentGeneratedFilePath` mirrors the latest generated output summary for fast status reads.
- When those fields differ, `target.currentGeneratedFilePath` wins for the path PI should currently treat as active.
- This story records metadata only. Compilation, archive retention, reload, and generated-file validation stay deferred to later projection work.

#### Anti-Shim Requirements

- Verify metadata through the thread-store boundary and projection collection reads, not by inspecting generated PI session file contents.
- Do not add placeholder projection compilation behavior here just to make metadata reads look "more complete."

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- Current generated PI session file path can be recorded and read.
- Missing generated path and empty projection revisions are represented explicitly.
- Thread id and PI target session id remain separate.
- Source message ordering never comes from generated PI session files.
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
- planner_turn_index: 2
- mode: run
- current_status: running
- lifecycle_state: awaiting_story_lead_action
- current_phase: story-lead-awaiting-action
- current_child_operation: none
- current_summary: story-implement completed with outcome ready-for-verification and status ok.
- latest_response_kind: implementor-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/003-implementor.json
- older_response_count: 0
- caller_input_artifact_count: 0
- prior_self_note_count: 1
- latest_self_note: "After implementation, require verifier evidence that npm run verify passed and that thread-store.test.ts covers all six Story 4 TCs before considering acceptance."

## Response Trail
<current_response>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/003-implementor.json
bytes: 2890
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "c697d771-1a82-4fe4-9507-4bd69a5c13c6"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e1023-adf9-7f01-b96a-31e5e21bfc4d"
    continuation:
      provider: "codex"
      sessionId: "019e1023-adf9-7f01-b96a-31e5e21bfc4d"
      storyId: "04-generated-pi-session-target-metadata"
    outcome: "ready-for-verification"
    story:
      id: "04-generated-pi-session-target-metadata"
      title: "Story 4: Generated PI Session Target Metadata"
    planSummary: "Implemented the Story 4 metadata seam so generated-session target metadata stays separate from projection revision summaries, refreshed the thread-service update flow after revision writes, and added coverage for active-path versus latest-projection-path behavior."
    changedFiles:
      -
        path: "src/context-steward/services/thread-service.ts"
        reason: "Serialized generated-session metadata updates and refreshed projection summary state after revision writes so returned thread metadata stays accurate."
      -
        path: "src/context-steward/store/file-thread-store.ts"
        reason: "Normalized projection summaries to mirror the latest recorded projection revision instead of drifting to the active target path."
      -
        path: "tests/context-steward/thread-store.test.ts"
        reason: "Added regression coverage for separating active generated paths from projection summaries and for returning refreshed revision summary details."
    tests:
      added:
        - "tests/context-steward/thread-store.test.ts :: keeps the active generated path separate from the latest projection summary"
        - "tests/context-steward/thread-store.test.ts :: returns refreshed projection summary details after recording a revision through metadata updates"
      modified:
        - "tests/context-steward/thread-store.test.ts"
      removed:
[]
      totalAfterStory: 62
      deltaFromPriorBaseline: 2
    gatesRun:
      -
        command: "npm test -- tests/context-steward/thread-store.test.ts"
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
        - "Projection summaries now continue to reflect the latest recorded projection revision even when the active PI-generated file path is updated to a different path."
        - "updateGeneratedSessionMetadata now returns refreshed projection summary count/status details after writing a projection revision instead of leaking stale pre-write metadata."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Hand Story 4 to verification."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/003-implementor.json"
  startedAt: "2026-05-10T04:27:14.061Z"
  finishedAt: "2026-05-10T04:31:45.452Z"
```
</current_response>

<history_responses>
No older response entries are recorded yet.
</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/story-lead/001-current.json
Bytes: 1861

```yaml
storyRunId: "04-generated-pi-session-target-metadata-story-run-001"
storyId: "04-generated-pi-session-target-metadata"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-implement completed with outcome ready-for-verification and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/003-implementor.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e1023-adf9-7f01-b96a-31e5e21bfc4d"
    storyId: "04-generated-pi-session-target-metadata"
latestEventSequence: 5
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "No bounded child operation has run yet, and the durable record contains story-local requirements plus the mapped test plan but no implementation or verifier evidence. The smallest safe next step is to start implementation for the Story 4 target metadata behavior and tests."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/003-implementor.json"
replayBoundary: null
updatedAt: "2026-05-10T04:31:45.463Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: After implementation, require verifier evidence that npm run verify passed and that thread-store.test.ts covers all six Story 4 TCs before considering acceptance.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-10T04:27:14.021Z; note="After implementation, require verifier evidence that npm run verify passed and that thread-store.test.ts covers all six Story 4 TCs before considering acceptance."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/story-lead/001-events.jsonl
Bytes: 2243

```yaml
-
  storyRunId: "04-generated-pi-session-target-metadata-story-run-001"
  sequence: 1
  timestamp: "2026-05-10T04:27:01.193Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "04-generated-pi-session-target-metadata-story-run-001"
  sequence: 2
  timestamp: "2026-05-10T04:27:13.998Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e1023-7bbc-74e0-ae6e-73834890bcec"
-
  storyRunId: "04-generated-pi-session-target-metadata-story-run-001"
  sequence: 3
  timestamp: "2026-05-10T04:27:14.020Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "After implementation, require verifier evidence that npm run verify passed and that thread-store.test.ts covers all six Story 4 TCs before considering acceptance."
-
  storyRunId: "04-generated-pi-session-target-metadata-story-run-001"
  sequence: 4
  timestamp: "2026-05-10T04:27:14.021Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "After implementation, require verifier evidence that npm run verify passed and that thread-store.test.ts covers all six Story 4 TCs before considering acceptance."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "04-generated-pi-session-target-metadata-story-run-001"
  sequence: 5
  timestamp: "2026-05-10T04:31:45.463Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/04-generated-pi-session-target-metadata/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
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
