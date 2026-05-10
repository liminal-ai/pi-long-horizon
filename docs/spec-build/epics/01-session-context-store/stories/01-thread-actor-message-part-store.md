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
