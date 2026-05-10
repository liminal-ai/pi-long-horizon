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
