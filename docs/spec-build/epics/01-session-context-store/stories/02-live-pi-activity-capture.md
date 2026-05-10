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
