# Epic 1: Session Context Store

This epic defines the complete requirements for the Session Context Store. It serves as the Feature 1 epic requirements.

---

## Onboarding Context

PI Long Horizon is a local context-maintenance layer for PI coding sessions. PI remains the runtime target. The Context Steward owns the source Thread and later produces generated PI session files from that history.

A Thread is the complete linear source record for one managed line of work. Messages are append-only source records from humans, agents, tools, systems, or the runtime. Parts are ordered typed content inside a Message. Turns are prompt-bounded groups of Messages. Generated PI session files are target output, not the source Thread.

---

## User Profile

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

---

## Feature Overview

The Session Context Store records live PI activity into a canonical source thread. It stores actor identity, ordered typed message parts, prompt-bounded canonical turns, import metadata, repair status, generated PI session target metadata, and real-session fixtures.

Flow summary:

- [Source Thread Initialization](#1-source-thread-initialization): create or open the canonical Thread, record schema and target metadata, declare actors, and preserve linear source order. AC: `1.1-1.4`
- [Live PI Activity Capture](#2-live-pi-activity-capture): capture finalized prompts, responses, tool results, reasoning, and runtime notes as canonical Messages with ordered Parts. AC: `2.1-2.4`
- [Prompt-Bounded Canonical Turns](#3-prompt-bounded-canonical-turns): group captured Messages into open and closed Turns using agent-addressed prompt boundaries. AC: `3.1-3.5`
- [Generated PI Session Target Metadata](#4-generated-pi-session-target-metadata): record generated PI session file metadata while keeping the source Thread independent. AC: `4.1-4.2`
- [Attach And Import Existing PI Sessions](#5-attach-and-import-existing-pi-sessions): import prior PI activity into a new Thread and continue with live capture. AC: `5.1-5.6`
- [Turn Repair And Maintenance Readiness](#6-turn-repair-and-maintenance-readiness): detect, repair, and report missing or incomplete Turn state before later maintenance uses it. AC: `6.1-6.5`
- [Real-Session Fixtures](#7-real-session-fixtures): create Thread-shaped fixtures from real PI sessions or managed Threads. AC: `7.1-7.4`

---

## Scope

### In Scope

- Thread records for stored source records.
- Actor identity fields on stored messages.
- Stored messages with ordered typed parts.
- Prompt-bounded canonical turns with open and closed states.
- PI extension capture of finalized runtime messages and runtime notes that affect session state, turn state, capture state, or repair/import status.
- Target metadata for the generated PI session file associated with the source thread.
- Attach/import for a PI session that already contains activity before Context Steward capture starts.
- Repair operation that reconstructs turn membership from stored messages.
- Repair status that identifies missing or incomplete turn state before later maintenance uses affected turns.
- Basic fixture creation from real PI sessions.

### Out of Scope

- Full Context Navigator query surface. Feature 2.
- Chunking, band allocation, and smart compact projection mechanics. Feature 3.
- Smooth turn generation and summary generation. Feature 4.
- Model prompts for smoothing, boundary decisions, detailed summaries, or brief summaries. Feature 4.
- Database storage. Future direction.
- Web UI for context editing. Future direction.
- Non-PI projection targets. Future direction.
- PI fork handling that creates or manages child Threads. Linear Thread semantics are settled in the technical architecture.

### Assumptions

| ID | Assumption | Status | Owner | Notes |
|----|------------|--------|-------|-------|
| A1 | PI extension events expose finalized message data needed to construct canonical messages. | Validated from PI source | Tech Lead | Dogfooding confirms field completeness during implementation. |
| A2 | PI can reload a generated PI session file from an extension command. | Validated from PI source | Tech Lead | This epic records target metadata; smart compact reload behavior belongs to Feature 3. |
| A3 | Canonical turns use agent-addressed prompt boundaries, not PI internal turn boundaries. | Validated from PI source and architecture | Tech Lead | PI activity boundaries may inform later smoothing but do not define canonical turn closure. |
| A4 | File-backed storage is sufficient for v1 source thread sizes. | Unvalidated | Tech Lead | Fixture expansion measures traversal and repair costs. |
| A5 | Imported PI-native messages can be mapped into the same canonical message and part vocabulary as live-captured PI activity. | Unvalidated | Tech Lead | Import reports unmapped or lossy records instead of silently dropping them. |

---

## Flows & Requirements

### 1. Source Thread Initialization

The steward creates or opens a canonical Thread for a managed PI session. The Thread contains source records for messages, turns, imports, and generated target metadata.

1. Operator starts a managed PI session.
2. Steward creates or opens the matching Thread.
3. Steward records schema version, thread identity, target runtime metadata, and active generated-session metadata.
4. Steward preserves a linear source order for all messages in the Thread.

#### Acceptance Criteria

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

### 2. Live PI Activity Capture

The steward captures finalized PI runtime activity from extension events. Captured messages preserve actor identity, message kind, ordered parts, timestamps, source order, and target-runtime metadata.

1. PI finalizes a prompt, response, tool result, reasoning part, or runtime note.
2. PI extension adapter passes the finalized activity to Context Steward.
3. Steward maps the activity to a canonical Message with ordered Parts.
4. Steward appends the Message to the Thread.
5. Steward updates the active canonical Turn when the message belongs to one.

#### Acceptance Criteria

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

**AC-2.3:** Stored messages are append-only source records.

- **TC-2.3a: Captured message is not mutated by later turn updates**
  - Given: A stored Message belongs to a Turn
  - When: The Turn state changes from open to closed
  - Then: The stored Message content, parts, actor identity, message kind, timestamp, and source order remain unchanged
- **TC-2.3b: Captured message is not mutated by repair**
  - Given: A stored Message exists before turn repair
  - When: Turn repair reconstructs membership
  - Then: The stored Message content and source order remain unchanged

**AC-2.4:** Capture failures are reported and failed activity is not represented as captured source records.

- **TC-2.4a: Message append failure is reported**
  - Given: A finalized PI message is received
  - When: The steward cannot append the message
  - Then: The steward reports `CAPTURE_APPEND_FAILED` with target runtime, target session identifier when available, actor identity when available, message kind when available, event timestamp when available, and failure reason
- **TC-2.4b: Failed message is not marked captured**
  - Given: A finalized PI message append fails
  - When: The Thread is read
  - Then: The failed message is not represented as a successfully captured source record

### 3. Prompt-Bounded Canonical Turns

The steward groups messages into canonical Turns using agent-addressed prompt boundaries. A canonical Turn begins with an initiating prompt and contains all resulting agent responses, tool activity, runtime notes, and intermediate outputs until the next agent-addressed prompt starts a new Turn.

1. Steward captures an agent-addressed prompt.
2. Steward opens a canonical Turn for that prompt and records the prompt message in the Turn.
3. Steward captures responses, tool activity, runtime notes, and intermediate outputs.
4. Steward associates those messages with the open Turn.
5. Steward captures the next agent-addressed prompt.
6. Steward closes the prior Turn and opens a new Turn for the new prompt.

#### Acceptance Criteria

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

### 4. Generated PI Session Target Metadata

The steward records which generated PI session file belongs to the source Thread. The generated PI session file is target output from the source Thread.

1. Steward creates or opens a Thread for a PI runtime target.
2. Steward records the current generated PI session file path when known.

#### Acceptance Criteria

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

### 5. Attach And Import Existing PI Sessions

The operator can attach Context Steward to a PI session that already contains activity. The steward imports prior PI messages from the active linear PI session path into a new source Thread, records import metadata, and then captures new activity through the same live extension-capture path. If a PI-native session contains branches, v1 imports the active path only. If the active path cannot be identified, import stops with an explicit status.

1. Operator runs attach/import for an existing PI session.
2. Steward identifies the active linear path in the PI-native session history.
3. Steward maps prior PI activity into canonical Messages and Parts.
4. Steward reconstructs prompt-bounded Turns from imported messages.
5. Steward records import metadata at the Thread/import level.
6. Steward switches future activity for that PI session to live extension capture.

#### Acceptance Criteria

**AC-5.1:** The steward can attach to an existing PI session and import prior PI messages from the active linear path into a new source Thread.

- **TC-5.1a: Existing session import creates thread**
  - Given: A PI session contains prior activity and has no managed Thread
  - When: The operator runs attach/import
  - Then: A new Thread is created and prior PI messages are imported as canonical source messages
- **TC-5.1b: Empty existing session attach succeeds**
  - Given: A PI session has no prior activity and has no managed Thread
  - When: The operator runs attach/import
  - Then: A new Thread is created with import metadata showing zero imported messages
- **TC-5.1c: Duplicate attach is rejected**
  - Given: A PI session already has a managed Thread
  - When: The operator runs attach/import for that same PI session as a new Thread
  - Then: The steward reports `TARGET_ASSOCIATION_CONFLICT` and does not create a duplicate active Thread

**AC-5.2:** Branched PI-native session imports use the active linear path or stop with an explicit error.

- **TC-5.2a: Branched session imports active path only**
  - Given: A PI-native session contains multiple branches and one active path can be identified
  - When: The operator runs attach/import
  - Then: The steward imports messages from the active path only and records the imported active path in import metadata
- **TC-5.2b: Ambiguous branch path is rejected**
  - Given: A PI-native session contains multiple branches and the active path cannot be identified
  - When: The operator runs attach/import
  - Then: The steward reports `IMPORT_PATH_AMBIGUOUS` and does not append imported messages

**AC-5.3:** Imported messages conform to the same canonical record shape as live-captured messages.

- **TC-5.3a: Imported order preserved**
  - Given: A PI session has multiple prior messages
  - When: The messages are imported
  - Then: Imported canonical messages preserve the session's source order
- **TC-5.3b: Imported parts preserved**
  - Given: A prior PI message contains text, reasoning, tool activity, runtime note, image reference, or file reference content
  - When: The message is imported
  - Then: Supported content is represented as ordered typed Parts
- **TC-5.3c: Imported metadata preserved**
  - Given: A prior PI message includes timestamp or target-runtime identifiers
  - When: The message is imported
  - Then: Available timestamp and PI target metadata are stored on the canonical Message

**AC-5.4:** Import operations are recorded at the Thread/import level.

- **TC-5.4a: Import metadata records source**
  - Given: A PI session import completes
  - When: The Thread import metadata is read
  - Then: It records the source PI session, import time, imported source range, imported message count, and import status
- **TC-5.4b: Imported range distinguishes prior activity from later capture**
  - Given: A Thread contains imported messages and later live-captured messages
  - When: Thread import metadata is read
  - Then: Imported source range metadata identifies the imported messages, and later live-captured messages fall outside the imported source range

**AC-5.5:** Imported prior activity is grouped into prompt-bounded canonical Turns.

- **TC-5.5a: Imported prompts create turns**
  - Given: Imported PI history contains agent-addressed prompts
  - When: Import reconstructs turn state
  - Then: Each initiating prompt starts a canonical Turn
- **TC-5.5b: Imported responses join turns**
  - Given: Imported PI history contains responses and tool activity after a prompt and before the next prompt
  - When: Import reconstructs turn state
  - Then: Those messages are associated with the prompt's Turn in source order
- **TC-5.5c: Import reports incomplete turn reconstruction**
  - Given: Imported PI history cannot be fully mapped into prompt-bounded Turns
  - When: Import completes
  - Then: The import status names the incomplete source range, affected Turns are marked `repairStatus: repair_needed`, and Thread `status.turnState` is set to `repair_needed`

**AC-5.6:** After attach completes, new finalized PI activity is recorded through the live extension-capture path and associated with the imported source Thread.

- **TC-5.6a: New activity appends to imported thread**
  - Given: Attach/import has completed for an existing PI session
  - When: PI finalizes new activity
  - Then: The steward appends the new activity to the imported Thread after the imported source range
- **TC-5.6b: New prompt continues canonical turn semantics**
  - Given: Attach/import has completed and the imported Thread has a current open or closed Turn state
  - When: PI finalizes the next agent-addressed prompt
  - Then: The steward applies the same prompt-bounded Turn rules used for live capture
- **TC-5.6c: Import cannot overlap active live capture for the same session**
  - Given: Live capture is active for a PI session
  - When: The operator attempts to import that same session into a new Thread
  - Then: The steward reports `TARGET_ASSOCIATION_CONFLICT` and leaves the active Thread unchanged

### 6. Turn Repair And Maintenance Readiness

A Thread may have messages whose Turn state is missing, stale, or incomplete. The steward can reconstruct Turn membership from stored messages using agent-addressed prompt boundaries. Repair preserves source messages and reports incomplete state before later maintenance uses affected Turns.

1. Operator or maintenance workflow requests a turn health check or repair.
2. Steward reads stored messages in canonical source order.
3. Steward identifies agent-addressed prompt boundaries.
4. Steward reconstructs Turn membership and open/closed status.
5. Steward writes repaired Turn state.
6. Steward reports remaining missing or incomplete Turn state.

#### Acceptance Criteria

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

### 7. Real-Session Fixtures

The steward can create basic fixtures from real PI sessions. Fixtures are Thread-shaped data with FixtureRecord metadata. They preserve enough canonical Thread structure to validate capture, import, turn repair, and later threshold/projection work.

1. Operator selects a real PI session or managed Thread as fixture source.
2. Steward creates Thread-shaped fixture data and FixtureRecord metadata from the selected source.
3. Fixture preserves source message order, actor identities, typed parts, turn boundaries, target metadata, and import/repair status when available.
4. Later tests and Navigator work can read the fixture as Thread-shaped data.

#### Acceptance Criteria

**AC-7.1:** The steward can create a basic fixture from a real PI session or managed Thread.

- **TC-7.1a: Fixture from managed Thread**
  - Given: A managed Thread contains captured source messages and Turn state
  - When: The operator creates a fixture from the Thread
  - Then: Thread-shaped fixture data is created with source messages, actors, typed parts, Turn state, target metadata, and FixtureRecord metadata
- **TC-7.1b: Fixture from PI session import**
  - Given: A PI session exists without a managed Thread
  - When: The operator creates a fixture through import
  - Then: Thread-shaped fixture data is created from imported canonical source records, import metadata, and FixtureRecord metadata
- **TC-7.1c: Fixture creation failure is reported**
  - Given: The selected fixture source cannot be read or converted into Thread-shaped records
  - When: The operator creates a fixture
  - Then: The steward reports `FIXTURE_CREATE_FAILED` with the selected source and failure reason

**AC-7.2:** Fixtures preserve canonical ordering and typed-part structure.

- **TC-7.2a: Fixture message order preserved**
  - Given: A source Thread has messages in canonical order
  - When: A fixture is created
  - Then: The fixture messages appear in the same canonical order
- **TC-7.2b: Fixture parts preserved**
  - Given: Source messages contain ordered typed Parts
  - When: A fixture is created
  - Then: The fixture preserves part type and part order for each message

**AC-7.3:** Fixtures expose repair status for later validation.

- **TC-7.3a: Healthy fixture marked ready**
  - Given: A source Thread has valid Turn state
  - When: A fixture is created
  - Then: The fixture records Turn state as ready
- **TC-7.3b: Incomplete fixture marked repair-needed**
  - Given: A source Thread has missing or incomplete Turn state
  - When: A fixture is created
  - Then: The fixture records the repair-needed status and affected source range

**AC-7.4:** Fixture metadata records fixture identity, source, source range, creation time, and status.

- **TC-7.4a: Managed-thread fixture metadata recorded**
  - Given: A fixture is created from a managed Thread
  - When: Fixture metadata is read
  - Then: FixtureRecord identifies the fixture, source type `managed_thread`, source Thread identifier, created time, source range, and fixture status
- **TC-7.4b: PI-session fixture metadata recorded**
  - Given: A fixture is created from a PI session import
  - When: Fixture metadata is read
  - Then: FixtureRecord identifies the fixture, source type `pi_session`, source session or path, created time, source range, import status, repair status, and fixture status

---

## Data Contracts

Data contracts define the canonical records and boundary operations needed by Feature 1. Field names are documentation labels, not implementation-specific type definitions.

### Boundary Operations

| Operation | Initiator | Input | Success Output | Error Output |
|-----------|-----------|-------|----------------|--------------|
| Start managed session capture | PI extension or operator command | PI session association | Thread opened or created; capture active | Unsupported schema, target association conflict, store unavailable |
| Capture finalized PI activity | PI extension | Finalized PI activity event | Message appended; actor declared; Turn updated when applicable | Capture failure with source activity context |
| Attach/import existing PI session | Operator command | PI session path or session identifier | Thread created; prior active-path messages imported; import metadata recorded; capture active | Import failure with unmapped, ambiguous, or unreadable source range |
| Check turn health | Operator command or maintenance prerequisite | Thread identifier | Turn readiness status and affected ranges | Unsupported schema, store unavailable |
| Repair turn state | Operator command or maintenance prerequisite | Thread identifier and optional source range | Turn records reconstructed; readiness updated | Repair failure with ambiguous or unwritable range |
| Create real-session fixture | Operator command | Managed Thread or PI session source | Fixture with Thread-shaped source records | Fixture failure with source and reason |

### Thread

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| threadId | string | yes | non-empty; unique among Threads | Canonical Thread identifier |
| schemaVersion | string | yes | supported version | Current schema version for Thread records |
| createdAt | timestamp | yes | ISO 8601 UTC | Thread creation time |
| updatedAt | timestamp | yes | ISO 8601 UTC | Last Thread metadata update time |
| target.runtime | string | yes | `pi` for v1 | Runtime target associated with this Thread |
| target.sessionId | string | no | non-empty | PI target session identifier |
| target.currentGeneratedFilePath | string | no | valid path | Current generated PI session file path |
| imports | array of ImportRecord | no | ordered by import time | Import operations applied to this Thread |
| status.turnState | string | yes | `ready`, `repair_needed`, `repair_failed`, `unknown` | Turn readiness for downstream maintenance |

### Actor

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| actorId | string | yes | non-empty; unique within Thread | Actor identifier referenced by messages |
| actorType | string | yes | `human`, `agent`, `system`, `tool`, `runtime`, `steward` | Actor category |
| displayName | string | no | non-empty | Human-readable actor label |
| targetMetadata | object | no | target-specific fields only | PI-specific actor metadata |

### Message

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| messageId | string | yes | non-empty; unique within Thread | Canonical message identifier |
| threadId | string | yes | existing Thread | Owning Thread |
| sourceOrder | integer | yes | greater than prior sourceOrder in the Thread | Canonical source order |
| actorId | string | yes | existing Actor | Actor that emitted the message |
| actorType | string | yes | matches referenced Actor | Actor category copied for query convenience |
| messageKind | string | yes | `prompt`, `response`, `tool_result`, `runtime_event`, `unknown` | Message category |
| createdAt | timestamp | no | ISO 8601 UTC | Source message timestamp |
| capturedAt | timestamp | yes | ISO 8601 UTC | Time the steward recorded the message |
| parts | array of Part | yes | ordered; may be empty only for explicit metadata events | Typed content parts |
| targetMetadata | object | no | target-specific fields only | PI message/session identifiers and related metadata |

### Part

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| partId | string | yes | non-empty; unique within Message | Part identifier |
| partOrder | integer | yes | starts at 1; increases within Message | Order of the Part inside the Message |
| partType | string | yes | `text`, `reasoning`, `tool_call`, `tool_result`, `runtime_note`, `image_ref`, `file_ref`, `unknown` | Content type |
| content | object or string | yes | non-empty unless source part is explicitly empty | Part payload |
| targetMetadata | object | no | target-specific fields only | PI-specific part identifiers or metadata |

### Turn

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| turnId | string | yes | non-empty; unique within Thread | Canonical Turn identifier |
| threadId | string | yes | existing Thread | Owning Thread |
| turnOrder | integer | yes | greater than prior turnOrder in the Thread | Canonical Turn order |
| lifecycleStatus | string | yes | `open`, `closed` | Turn lifecycle state |
| repairStatus | string | yes | `ready`, `repair_needed`, `repair_failed`, `unknown` | Turn health for downstream maintenance |
| initiatingMessageId | string | yes | existing agent-addressed prompt Message | Prompt that starts the Turn |
| messageIds | array of string | yes | existing Messages in source order | Messages belonging to the Turn |
| openedAt | timestamp | no | ISO 8601 UTC | Timestamp of initiating prompt |
| closedAt | timestamp | no | ISO 8601 UTC | Time the Turn closed |
| repairMetadata | object | no | present after repair attempts | Repair source range, result, and failure details when applicable |

### ImportRecord

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| importId | string | yes | non-empty; unique within Thread | Import operation identifier |
| sourceRuntime | string | yes | `pi` for v1 | Runtime source for imported activity |
| sourceSessionId | string | no | non-empty | Source PI session identifier |
| sourcePath | string | no | valid path | PI session path used for import |
| activePathReference | string | no | non-empty | Active PI session path imported from a tree-shaped source |
| importedAt | timestamp | yes | ISO 8601 UTC | Import completion time |
| importedMessageCount | integer | yes | >= 0 | Number of imported messages |
| importedSourceRange | string | no | non-empty | Source range represented by the import |
| status | string | yes | `complete`, `partial`, `failed` | Import result |
| issues | array of string | no | non-empty strings | Unmapped records, ambiguous boundaries, or read errors |

### ProjectionRevision Metadata

Feature 1 records target metadata needed by later projection work. Feature 3 defines full projection compilation behavior.

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| revisionId | string | yes | non-empty; unique within Thread | Generated output revision identifier |
| threadId | string | yes | existing Thread | Source Thread |
| targetRuntime | string | yes | `pi` for v1 | Projection target runtime |
| generatedFilePath | string | yes | valid path | Generated PI session file path |
| createdAt | timestamp | yes | ISO 8601 UTC | Revision creation time |
| sourceStateReference | string | no | non-empty | Source state marker used to produce the revision |
| status | string | yes | `available`, `stale`, `failed`, `unknown` | Generated output status |

### FixtureRecord

FixtureRecord metadata describes Thread-shaped fixture data created from a managed Thread or PI session source.

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| fixtureId | string | yes | non-empty; unique among fixtures | Fixture identifier |
| fixtureName | string | no | non-empty | Human-readable fixture label |
| sourceType | string | yes | `managed_thread`, `pi_session` | Source used to create the fixture |
| sourceThreadId | string | no | existing Thread | Managed Thread source identifier |
| sourceSessionId | string | no | non-empty | PI session source identifier |
| sourcePath | string | no | valid path | PI session or fixture source path |
| sourceRange | string | no | non-empty | Source message or session range included in the fixture |
| createdAt | timestamp | yes | ISO 8601 UTC | Fixture creation time |
| threadShape | string | yes | `thread_shaped_data` | Fixture representation shape |
| importStatus | string | no | `complete`, `partial`, `failed` | Import result when fixture came from PI session import |
| repairStatus | string | yes | `ready`, `repair_needed`, `repair_failed`, `unknown` | Turn repair state represented by the fixture |
| status | string | yes | `available`, `failed` | Fixture creation result |
| issues | array of string | no | non-empty strings | Fixture creation, import, or repair issues |

### Error Codes

| Code | Description |
|------|-------------|
| UNSUPPORTED_SCHEMA_VERSION | Thread schema version cannot be safely mutated |
| TARGET_ASSOCIATION_CONFLICT | PI session association maps to a different active Thread |
| STORE_UNAVAILABLE | Canonical store cannot be read or written |
| CAPTURE_APPEND_FAILED | Finalized PI activity could not be appended to source records |
| CAPTURE_DUPLICATE_EVENT | Finalized PI activity was already captured for the Thread |
| UNMAPPED_PART_TYPE | PI activity contains a part type that cannot be mapped without loss |
| IMPORT_SOURCE_UNREADABLE | PI session import source cannot be read |
| IMPORT_PATH_AMBIGUOUS | PI session import source has branches and no active path can be identified |
| IMPORT_PARTIAL | Import completed with unmapped or ambiguous source records |
| TURN_STATE_MISSING | Messages that belong to Turns have no Turn state |
| TURN_STATE_INCOMPLETE | Existing Turn state does not cover the expected message range |
| TURN_REPAIR_AMBIGUOUS | Repair cannot identify prompt boundaries for a source range |
| TURN_REPAIR_WRITE_FAILED | Reconstructed Turn state could not be written |
| FIXTURE_CREATE_FAILED | Fixture could not be created from the selected source |

---

## Dependencies

### Technical Dependencies

- PI extension events that expose finalized message activity.
- PI session file access for explicit attach/import.
- Local file-backed Thread store with stable ordering semantics.
- Store interface that can later map to database-backed storage without changing canonical domain behavior.
- Supported schema version detection before mutation.

### Process Dependencies

- Dogfood session that exercises live prompt, response, tool result, reasoning, and runtime-note capture.
- Import fixture from at least one PI session that started before Context Steward capture.
- Tech Design confirmation of exact PI event fields, session identifiers, and generated session path ownership.

---

## Non-Functional Requirements

### Capture Latency

- Live capture writes do not create visible delay in the PI TUI.
- Expensive maintenance work does not run in the finalized-message capture path.

### Ordering And Repairability

- Stored message order is explicit and stable across reads.
- Source messages are append-only records.
- Turn state can be rebuilt from stored messages when missing or incomplete.
- Repair reports affected source ranges when it cannot complete.

### Observability

- Capture, import, repair, and fixture creation report success, partial success, and failure states.
- Missing or incomplete Turn state is visible before smoothing, chunking, or smart compact uses affected Turns.

### Portability

- Canonical Thread, Message, Part, and Turn records avoid PI session schema fields except inside target metadata.
- PI-specific fields are isolated as target metadata.

### Schema Evolution

- Thread data exposes schema version metadata before mutation.
- Unsupported schema versions block writes and report an explicit error.

### Data Safety

- Generated PI session files are treated as target output and optional import/repair input, not the source Thread.
- Import and repair failures preserve source content or report rejected content with an explicit status, and affected state is not marked ready.

---

## Tech Design Questions

Questions for the Tech Lead to address during design:

1. What exact file schemas represent Thread, Actor, Message, Part, Turn, ImportRecord, and ProjectionRevision metadata?
2. Which PI extension events and event fields map to each canonical message kind and part type?
3. How does the steward identify an agent-addressed prompt across live capture and imported PI sessions?
4. How are provider reasoning parts represented when PI exposes partial, redacted, or target-specific reasoning payloads?
5. Which PI runtime notes affect session state, turn state, capture state, or repair/import status and must be captured as runtime-note Parts?
6. What target metadata is required to later generate a valid PI session file without making PI session JSONL the source Thread?
7. Which PI event or message identifiers are stable enough to detect duplicate or replayed finalized activity for `TC-2.1f`?
8. What locking or optimistic revision strategy enforces the overlap behavior required by `TC-2.1e`, `TC-5.1c`, `TC-5.6c`, and `TC-6.5c`?
9. How does attach/import handle PI session records that cannot be mapped into canonical messages without loss?
10. What command names and operator output formats expose attach/import, turn health, repair, and fixture creation?
11. How does the steward identify the active linear path in a branched PI-native session, and what does it report when multiple plausible active paths exist?
12. What fixture format lets later Navigator, projection, and summarization tests read fixtures as normal Thread-shaped data?
13. What schema migration policy applies when dogfooding changes record shapes during v1, and which version transitions are blocked until a migration runs?

---

## Recommended Story Breakdown

### Story 0: Foundation (Infrastructure)

**Delivers:** Canonical domain vocabulary, record validation helpers, error codes, test fixtures, and store test scaffolding needed by Feature 1 stories.

**Prerequisite:** PRD and technical architecture accepted.

**Estimated test count:** 8-12 foundation tests

### Story 1: Thread, Actor, Message, And Part Store

**Delivers:** A managed Thread can be created or opened, actors can be declared, and source messages with ordered Parts can be appended and read in canonical order.

**Prerequisite:** Story 0

**ACs covered:**
- AC-1.1 (active canonical Thread)
- AC-1.2 (target metadata separate from the source Thread)
- AC-1.3 (schema version metadata)
- AC-1.4 (Thread-level actors)
- AC-2.3 (append-only source records)

**Estimated test count:** 12-16 tests

### Story 2: Live PI Activity Capture

**Delivers:** Finalized PI prompts, responses, tool results, reasoning parts, and runtime notes are captured through extension events as canonical Messages.

**Prerequisite:** Story 1

**ACs covered:**
- AC-2.1 (finalized PI messages captured)
- AC-2.2 (ordered typed parts, capture mapping coverage)
- AC-2.4 (capture failure reporting)

**Estimated test count:** 14-18 tests

### Story 3: Prompt-Bounded Turn Lifecycle

**Delivers:** Agent-addressed prompts open canonical Turns, subsequent activity joins the open Turn, and the next prompt closes the previous Turn.

**Prerequisite:** Story 2

**ACs covered:**
- AC-3.1 (prompt starts Turn)
- AC-3.2 (activity remains in current Turn)
- AC-3.3 (multiple responses and tool cycles)
- AC-3.4 (open and closed Turn state)
- AC-3.5 (pre-turn activity visibility)

**Estimated test count:** 14-18 tests

### Story 4: Generated PI Session Target Metadata

**Delivers:** The Thread records PI target session association and current generated-session output metadata without treating the generated PI session file as the source Thread.

**Prerequisite:** Story 1

**ACs covered:**
- AC-4.1 (current generated PI session file path)
- AC-4.2 (target metadata distinct from source records)

**Estimated test count:** 8-10 tests

### Story 5: Attach And Import Existing PI Sessions

**Delivers:** An existing PI session can be imported into a new canonical Thread and then continue through live extension capture.

**Prerequisite:** Stories 2 and 3

**ACs covered:**
- AC-5.1 (attach/import creates Thread)
- AC-5.2 (branched session active-path behavior)
- AC-5.3 (import preserves source data)
- AC-5.4 (import metadata)
- AC-5.5 (imported Turn reconstruction)
- AC-5.6 (post-attach live capture)

**Estimated test count:** 18-24 tests

### Story 6: Turn Health And Repair

**Delivers:** Missing or incomplete Turn state can be detected, repaired from stored messages, and reported as blocked when repair cannot complete.

**Prerequisite:** Story 3

**ACs covered:**
- AC-6.1 (detect missing/incomplete Turn state)
- AC-6.2 (repair reconstructs membership)
- AC-6.3 (repair preserves messages)
- AC-6.4 (downstream readiness blocker)
- AC-6.5 (repair failure visibility)

**Estimated test count:** 18-24 tests

### Story 7: Real-Session Fixtures

**Delivers:** Real PI sessions and managed Threads can produce fixture data that preserves canonical source structure and repair status.

**Prerequisite:** Stories 5 and 6

**ACs covered:**
- AC-7.1 (fixture creation)
- AC-7.2 (fixture ordering and typed parts)
- AC-7.3 (fixture repair status)
- AC-7.4 (fixture metadata)

**Estimated test count:** 8-12 tests

### Sequencing Rationale

The story order follows dependency weight over data-entity grouping.

Foundation comes first because live capture, import, repair, and fixtures all depend on canonical records, error codes, and stable ordering.

Live capture precedes turn lifecycle because Turn assignment depends on captured message records and typed PI activity mapping.

Generated-session metadata can ship after the store foundation because it is independent of capture. Import follows live capture and turn lifecycle because imported records must converge onto the same canonical vocabulary and Turn rules.

Repair follows turn lifecycle because it reconstructs that state. Fixtures come last because they package the completed capture/import/repair behavior for downstream validation.

---

## Validation Checklist

- [x] User Profile has all four fields + Feature Overview
- [x] Flows cover happy, alternate, import, repair, and failure paths
- [x] Every AC is testable
- [x] Every AC has at least one TC
- [x] TCs cover happy path, edge cases, and errors
- [x] Data contracts are specified at PI/runtime-to-steward and store-consumer boundaries
- [x] Scope boundaries are explicit
- [x] Story breakdown covers all ACs
- [x] Stories sequence logically
- [ ] Validation review complete
- [x] Self-review complete
