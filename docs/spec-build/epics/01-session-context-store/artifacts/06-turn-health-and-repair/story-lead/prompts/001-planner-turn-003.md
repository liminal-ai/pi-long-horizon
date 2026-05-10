# Story Lead Base Prompt

## Role Charter
You are the story lead for `06-turn-health-and-repair` on durable story run `06-turn-health-and-repair-story-run-001`.
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
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/stories/06-turn-health-and-repair.md
Bytes: 11198

# Story 6: Turn Health And Repair

### Summary
<!-- Jira: Summary field -->

Detect missing or incomplete Turn state, reconstruct prompt-bounded Turn membership from stored Messages, and keep downstream maintenance blocked until Turn state is valid.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Make Turn state repairable from immutable Messages and make incomplete Turn state visible before downstream maintenance uses it.

**In Scope**

- Detect missing and incomplete Turn state.
- Reconstruct Turn membership from stored Messages using agent-addressed prompt boundaries.
- Preserve message order and content during repair.
- Report downstream readiness blockers.
- Report ambiguous boundaries, write failures, and stale source input.

**Out of Scope**

- Smoothing, chunking, summarization, and smart compact.
- Full Context Navigator views.
- Import-specific reconstruction behavior covered by Story 5.

**Dependencies**

- Story 3 complete.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-6.1:** The steward can detect missing or incomplete Turn state for stored messages.

- **TC-6.1a: Missing turn state detected**
  - Given: A Thread has stored messages and no Turn records
  - When: Turn health is checked
  - Then: The steward reports missing Turn state for the affected message range
- **TC-6.1b: Incomplete turn membership detected**
  - Given: A Thread has stored messages that are not covered by existing Turn membership
  - When: Turn health is checked
  - Then: The steward reports incomplete Turn state and identifies the uncovered message range
- **TC-6.1c: Healthy turn state passes**
  - Given: All stored messages that belong to Turns are covered by valid Turn membership
  - When: Turn health is checked
  - Then: The steward reports Turn state as ready for later maintenance

**AC-6.2:** Repair reconstructs Turn membership from stored messages using agent-addressed prompt boundaries.

- **TC-6.2a: Repair creates turns from prompts**
  - Given: A Thread has stored messages with agent-addressed prompts and missing Turn state
  - When: Repair runs
  - Then: The steward creates Turn records using each agent-addressed prompt as a Turn boundary
- **TC-6.2b: Repair assigns between-boundary messages**
  - Given: Stored messages appear between two agent-addressed prompts
  - When: Repair runs
  - Then: The messages are assigned to the Turn started by the first prompt
- **TC-6.2c: Repair preserves final open turn**
  - Given: The last agent-addressed prompt has no later initiating prompt
  - When: Repair runs
  - Then: The final Turn is marked open

**AC-6.3:** Repair preserves message order and raw message content.

- **TC-6.3a: Message order preserved**
  - Given: A Thread has stored messages in source order
  - When: Repair runs
  - Then: The messages retain the same source order after repair
- **TC-6.3b: Message content preserved**
  - Given: A Thread has stored messages before repair
  - When: Repair runs
  - Then: Message content, parts, actor identity, message kind, timestamps, and target metadata remain unchanged

**AC-6.4:** Missing or incomplete Turn state is reported before smoothing, chunking, or smart compact uses affected Turns.

- **TC-6.4a: Missing turn state blocks downstream readiness**
  - Given: A Thread has messages with missing Turn state
  - When: Maintenance readiness is checked for smoothing, chunking, or smart compact
  - Then: The steward reports blocked readiness and names missing Turn state as the blocker
- **TC-6.4b: Incomplete turn state blocks downstream readiness**
  - Given: A Thread has incomplete Turn membership
  - When: Maintenance readiness is checked for smoothing, chunking, or smart compact
  - Then: The steward reports blocked readiness and identifies the affected message range
- **TC-6.4c: Repaired turn state clears blocker**
  - Given: Turn repair has reconstructed valid Turn membership for affected messages
  - When: Maintenance readiness is checked
  - Then: Turn state is no longer reported as a blocker for those messages

**AC-6.5:** Repair failures are visible and do not produce partially trusted Turn state.

- **TC-6.5a: Ambiguous prompt boundary reported**
  - Given: Stored messages contain activity whose initiating prompt status cannot be determined
  - When: Repair runs
  - Then: The steward reports the ambiguous message range and does not mark the affected Turn state ready
- **TC-6.5b: Repair write failure reported**
  - Given: Repair reconstructs Turn membership
  - When: The steward cannot write repaired Turn state
  - Then: The steward reports repair failure and leaves readiness blocked for the affected range
- **TC-6.5c: Repair detects source changes during repair**
  - Given: Repair starts from a Thread source range
  - When: New messages are captured in that range before repair writes Turn state
  - Then: The steward reports stale repair input and does not mark the affected Turn state ready from the stale repair result

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 6 is the safety net that makes immutable source history usable when turn state is missing, incomplete, or stale. It owns health reporting, repair orchestration, and the explicit blocked-state behavior that later smoothing, chunking, and smart compact will depend on before they trust Turn data.

This story should not invent a second set of turn-boundary rules. Story 3 already defines how prompts, responses, tool activity, and pre-turn records are grouped. Repair must reuse that same prompt-boundary logic against stored Messages, then apply optimistic source-revision guards so stale repair input never gets mistaken for current truth.

#### Implementation Targets

| Owned Targets | Files / Modules |
|---|---|
| Health checks and prompt-boundary helpers | `src/context-steward/services/turn-service.ts` |
| Repair orchestration and stale-source guards | `src/context-steward/services/repair-service.ts` |
| Primary tests | `tests/context-steward/repair-service.test.ts` |

| Integration Touchpoints | Files / Modules |
|---|---|
| Turn snapshot persistence contract from Story 1 | `src/context-steward/store/thread-store.ts` |
| Operator command surface | `src/context-steward/pi/pi-extension.ts` |

#### Design References

- [tech-design.md §Architecture Decisions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:188), lines 188-205
- [tech-design.md §Store Interface](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:503), lines 503-655
- [tech-design.md §Flow 5: Turn Health and Repair](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:838), lines 838-881
- [tech-design.md §Core Services](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:923), lines 923-1064
- [tech-design.md §Chunk 4: Turn Health and Repair](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1210), lines 1210-1223
- [test-plan.md `repair-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:138), lines 138-158
- [test-plan.md §Command Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:175), lines 175-185

#### Test Mapping

| TC | Test File / Check | Test Description |
|---|---|---|
| TC-6.1a, TC-6.1b, TC-6.1c | `tests/context-steward/repair-service.test.ts` | detect missing turn state, incomplete membership, and healthy ready state |
| TC-6.2a, TC-6.2b, TC-6.2c | `tests/context-steward/repair-service.test.ts` | reconstruct prompt-bounded turn membership from stored messages and preserve final open turn |
| TC-6.3a, TC-6.3b | `tests/context-steward/repair-service.test.ts` | preserve source order and message content during repair |
| TC-6.4a, TC-6.4b, TC-6.4c | `tests/context-steward/repair-service.test.ts` | block downstream readiness on bad turn state and clear the blocker after successful repair |
| TC-6.5a, TC-6.5b, TC-6.5c | `tests/context-steward/repair-service.test.ts` | surface ambiguous boundaries, write failures, and stale source input without trusting partial repair |

#### Non-TC Decided Tests

- `tests/context-steward/repair-service.test.ts`: NTC-10 range-limited repair does not rewrite unaffected turns
- `tests/context-steward/repair-service.test.ts`: NTC-11 health report ranges are sorted by source order

#### Technical Notes

- Reuse Story 3's prompt-boundary rule. Repair should not have a second heuristic for deciding which messages belong to a turn.
- The tech design defines `STALE_SOURCE_REVISION` as the internal code for stale repair input. The epic-level behavior for this story remains TC-6.5c: source changed during repair, readiness stays blocked, and stale output is not trusted.
- Later maintenance consumers will read only the health/readiness contract, not the repair internals, so keep the blocked/ready state transitions explicit and conservative.
- Command-output coverage for `/lh-turn-health` and `/lh-repair-turns` is centralized in Story 7's command-surface non-TC tests so repair behavior stays owned here and formatting behavior stays in one story.

#### Anti-Shim Requirements

- Run repair against real stored Messages and source revisions, not mocked turn arrays or hand-waved snapshot objects.
- Assert that ambiguous, write-failure, and stale-source paths leave readiness blocked after the repair attempt rather than only checking for thrown errors.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- Turn health identifies missing, incomplete, and ready states.
- Repair reconstructs prompt-bounded Turn membership from stored Messages.
- Repair preserves message content and source order.
- Maintenance readiness reports blockers until Turn state is valid.
- Ambiguous boundaries, write failures, and stale source input leave affected state blocked.
- `repair-service.test.ts` covers all TCs assigned to this story.


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
- current_summary: story-verify completed with outcome pass and status ok.
- latest_response_kind: verifier-result
- latest_response_path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/004-verify.json
- older_response_count: 1
- caller_input_artifact_count: 0
- prior_self_note_count: 2
- latest_self_note: "Do not accept until a verifier result is present with final outcome pass and no unresolved findings; implementor gate claims alone are not enough."

## Response Trail
<current_response>
```yaml
kind: verifier-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/004-verify.json
bytes: 4099
payload:
  command: "story-verify"
  version: 1
  status: "ok"
  outcome: "pass"
  result:
    resultId: "4f3e8183-8e27-42c5-96be-49287fb8ef19"
    role: "story_verifier"
    provider: "codex"
    model: "gpt-5.4"
    sessionId: "019e1058-53fc-74f1-aa06-9740db764c9c"
    continuation:
      provider: "codex"
      sessionId: "019e1058-53fc-74f1-aa06-9740db764c9c"
      storyId: "06-turn-health-and-repair"
    mode: "initial"
    story:
      id: "06-turn-health-and-repair"
      title: "Story 6: Turn Health And Repair"
    artifactsRead:
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/stories/06-turn-health-and-repair.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/tech-design.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/test-plan.md"
      - "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/003-implementor.json"
      - "/Users/leemoore/code/pi-long-horizon/package.json"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/services/turn-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/services/repair-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/services/capture-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/services/thread-service.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/store/thread-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/store/file-thread-store.ts"
      - "/Users/leemoore/code/pi-long-horizon/src/context-steward/pi/pi-extension.ts"
      - "/Users/leemoore/code/pi-long-horizon/.pi/extensions/context-steward.ts"
      - "/Users/leemoore/code/pi-long-horizon/tests/context-steward/repair-service.test.ts"
    reviewScopeSummary: "Verified Story 6 against the story, the full Session Context Store tech design, and the test plan. Reviewed the turn health and repair implementation in `turn-service.ts` and `repair-service.ts`, checked the supporting store/capture/thread seams for stale-write and real-runtime behavior, reviewed the Story 6 implementor artifact, and reran the focused Story 6 tests plus the configured story and epic gates."
    priorFindingStatuses:
[]
    newFindings:
[]
    openFindings:
[]
    requirementCoverage:
      verified:
        - "AC-6.1"
        - "TC-6.1a"
        - "TC-6.1b"
        - "TC-6.1c"
        - "AC-6.2"
        - "TC-6.2a"
        - "TC-6.2b"
        - "TC-6.2c"
        - "AC-6.3"
        - "TC-6.3a"
        - "TC-6.3b"
        - "AC-6.4"
        - "TC-6.4a"
        - "TC-6.4b"
        - "TC-6.4c"
        - "AC-6.5"
        - "TC-6.5a"
        - "TC-6.5b"
        - "TC-6.5c"
        - "NTC-10"
        - "NTC-11"
      unverified:
[]
    gatesRun:
      -
        command: "node --import tsx --test tests/context-steward/repair-service.test.ts"
        result: "pass"
      -
        command: "npm run verify"
        result: "pass"
      -
        command: "npm run verify-all"
        result: "pass"
    productionPathFindings:
[]
    recommendedNextStep: "pass"
    recommendedFixScope: "same-session-implementor"
    openQuestions:
[]
    additionalObservations:
      - "`src/context-steward/services/turn-service.ts` reuses `applyCapturedMessageToTurns()` inside `reconstructTurnsFromMessages()`, so repair follows the same prompt-boundary rule as live capture instead of introducing a second heuristic."
      - "`src/context-steward/services/repair-service.ts` serializes repair per thread, merges range-limited repair conservatively, and relies on `writeTurns()` source-revision and high-watermark guards before trusting repaired state."
      - "`npm run verify-all` exited successfully, but its integration leg currently reports `No integration tests found.` Story 6's mapped evidence still comes from the passing real-store `tests/context-steward/repair-service.test.ts` coverage, so this is residual project-level context rather than a blocker."
      - "Production-path audit of the touched Story 6 runtime code found no material fake adapter, shim, placeholder branch, or other non-real repair path in the reviewed implementation."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/004-verify.json"
  startedAt: "2026-05-10T05:24:44.440Z"
  finishedAt: "2026-05-10T05:30:07.143Z"
```
</current_response>

<history_responses>

<history_entry>
```yaml
kind: implementor-result
path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/003-implementor.json
bytes: 3016
payload:
  command: "story-implement"
  version: 1
  status: "ok"
  outcome: "ready-for-verification"
  result:
    resultId: "1758a3d1-f138-48e6-b95e-12f2bb16e390"
    provider: "codex"
    model: "gpt-5.4"
    role: "story_implementor"
    sessionId: "019e104d-0a3d-7110-9915-fafa45e8ee92"
    continuation:
      provider: "codex"
      sessionId: "019e104d-0a3d-7110-9915-fafa45e8ee92"
      storyId: "06-turn-health-and-repair"
    outcome: "ready-for-verification"
    story:
      id: "06-turn-health-and-repair"
      title: "Story 6: Turn Health And Repair"
    planSummary: "Implemented Story 6 turn repair by adding stored-message reconstruction and maintenance-readiness checks in `turn-service`, creating a new `repair-service` with stale-source and write-failure handling, and adding the dedicated real-store `repair-service.test.ts` coverage for all Story 6 TC and NTC cases."
    changedFiles:
      -
        path: "src/context-steward/services/turn-service.ts"
        reason: "Added reconstruction-from-messages helpers plus the maintenance-readiness contract that blocks downstream consumers on missing, incomplete, or non-ready turn state."
      -
        path: "src/context-steward/services/repair-service.ts"
        reason: "Implemented turn-state repair orchestration, range-limited repair merging, optimistic source-revision handling, and conservative failure reporting."
      -
        path: "tests/context-steward/repair-service.test.ts"
        reason: "Added Story 6 TC and NTC coverage using the real file-backed thread store, including missing/incomplete health checks, repair success paths, ambiguous boundaries, write failures, stale input, and range-limited repair."
    tests:
      added:
        - "tests/context-steward/repair-service.test.ts"
      modified:
[]
      removed:
[]
      totalAfterStory: 91
      deltaFromPriorBaseline: 16
    gatesRun:
      -
        command: "npm run typecheck"
        result: "pass"
      -
        command: "node --import tsx --test tests/context-steward/repair-service.test.ts"
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
        - "Added explicit maintenance-readiness blocking so downstream maintenance now stops on missing, incomplete, repair-needed, and repair-failed turn state."
        - "Implemented optimistic repair orchestration that reconstructs turns from stored messages, preserves message payloads/order, and rejects stale source writes."
        - "Fixed range-limited repair so affected turns are replaced without rewriting unaffected turns, even when the broken snapshot shrank the old turn range."
      findingsSurfaced:
[]
    openQuestions:
[]
    specDeviations:
[]
    recommendedNextStep: "Move to verification review for Story 6, then wire the operator-facing `/lh-turn-health` and `/lh-repair-turns` command surface in Story 7."
  errors:
[]
  warnings:
[]
  artifacts:
    -
      kind: "result-envelope"
      path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/003-implementor.json"
  startedAt: "2026-05-10T05:12:24.656Z"
  finishedAt: "2026-05-10T05:24:30.962Z"
```
</history_entry>

</history_responses>

## Current Snapshot
### current-snapshot
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/story-lead/001-current.json
Bytes: 2140

```yaml
storyRunId: "06-turn-health-and-repair-story-run-001"
storyId: "06-turn-health-and-repair"
attempt: 1
status: "running"
lifecycleState: "awaiting_story_lead_action"
currentSummary: "story-verify completed with outcome pass and status ok."
currentPhase: "story-lead-awaiting-action"
currentChildOperation: null
latestArtifacts:
  -
    kind: "validation-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/001-story-validate.json"
    provenance: "prior-run"
  -
    kind: "implementor-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/003-implementor.json"
    provenance: "current-run"
  -
    kind: "verifier-result"
    path: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/004-verify.json"
    provenance: "current-run"
latestContinuationHandles:
  storyImplementor:
    provider: "codex"
    sessionId: "019e104d-0a3d-7110-9915-fafa45e8ee92"
    storyId: "06-turn-health-and-repair"
  storyVerifier:
    provider: "codex"
    sessionId: "019e1058-53fc-74f1-aa06-9740db764c9c"
    storyId: "06-turn-health-and-repair"
latestEventSequence: 9
callerInputHistory:
  reviewRequests:
[]
  rulings:
[]
nextIntent:
  actionType: "await-story-lead-action"
  summary: "Implementation reports all Story 6 targets complete and gates passing, but acceptance requires an independent verifier pass with no open findings. The smallest safe next action is verification against the implementor artifact and story-local AC/test-plan requirements."
  artifactRef: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/004-verify.json"
replayBoundary: null
updatedAt: "2026-05-10T05:30:07.153Z"
```

## Caller Input Artifacts
None.

## Prior Self Notes
Latest note highlight: Do not accept until a verifier result is present with final outcome pass and no unresolved findings; implementor gate claims alone are not enough.

All prior runtime self-notes:
- sequence=4; actionSequence=3; createdAt=2026-05-10T05:12:24.621Z; note="First planner turn dispatched implementation; later turns should require concrete test/gate evidence before considering acceptance."
- sequence=8; actionSequence=7; createdAt=2026-05-10T05:24:44.404Z; note="Do not accept until a verifier result is present with final outcome pass and no unresolved findings; implementor gate claims alone are not enough."

## Event History
### event-history
Path: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/story-lead/001-events.jsonl
Bytes: 3912

```yaml
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 1
  timestamp: "2026-05-10T05:12:09.212Z"
  type: "story-run-started"
  summary: "Story orchestration run started after orienting from 1 existing artifact(s)."
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 2
  timestamp: "2026-05-10T05:12:24.601Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/story-lead/prompts/001-planner-turn-001.md"
    sessionId: "019e104c-cde6-7992-99ee-62c68cde4f68"
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 3
  timestamp: "2026-05-10T05:12:24.620Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-implement."
  data:
    actionType: "run-implement"
    turn: 1
    selfNote: "First planner turn dispatched implementation; later turns should require concrete test/gate evidence before considering acceptance."
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 4
  timestamp: "2026-05-10T05:12:24.621Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "First planner turn dispatched implementation; later turns should require concrete test/gate evidence before considering acceptance."
    actionSequence: 3
    actionType: "run-implement"
    turn: 1
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 5
  timestamp: "2026-05-10T05:24:30.972Z"
  type: "child-operation-completed"
  summary: "story-implement completed with outcome ready-for-verification and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/003-implementor.json"
  data:
    actionType: "run-implement"
    command: "story-implement"
    outcome: "ready-for-verification"
    status: "ok"
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 6
  timestamp: "2026-05-10T05:24:44.380Z"
  type: "story-lead-provider-started"
  summary: "Fresh story-lead provider turn executed without planner session resume."
  data:
    provider: "codex"
    model: "gpt-5.5"
    reasoningEffort: "high"
    promptArtifactPath: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/story-lead/prompts/001-planner-turn-002.md"
    sessionId: "019e1058-1f5d-7052-8e68-055ab4a39873"
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 7
  timestamp: "2026-05-10T05:24:44.404Z"
  type: "story-lead-action-selected"
  summary: "Story-lead selected run-verify."
  data:
    actionType: "run-verify"
    turn: 2
    selfNote: "Do not accept until a verifier result is present with final outcome pass and no unresolved findings; implementor gate claims alone are not enough."
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 8
  timestamp: "2026-05-10T05:24:44.404Z"
  type: "story-lead-self-note-recorded"
  summary: "Story-lead recorded a durable self-note for a future planner turn."
  data:
    note: "Do not accept until a verifier result is present with final outcome pass and no unresolved findings; implementor gate claims alone are not enough."
    actionSequence: 7
    actionType: "run-verify"
    turn: 2
-
  storyRunId: "06-turn-health-and-repair-story-run-001"
  sequence: 9
  timestamp: "2026-05-10T05:30:07.153Z"
  type: "child-operation-completed"
  summary: "story-verify completed with outcome pass and status ok."
  artifact: "/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/01-session-context-store/artifacts/06-turn-health-and-repair/004-verify.json"
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
