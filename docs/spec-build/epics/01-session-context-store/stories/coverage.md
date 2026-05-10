# Session Context Store Story Coverage

## Coverage Gate

Every AC and TC from `epic.md` is assigned to exactly one story file.

| AC | TC(s) | Story |
|---|---|---|
| AC-1.1 | TC-1.1a, TC-1.1b, TC-1.1c | Story 1: `01-thread-actor-message-part-store.md` |
| AC-1.2 | TC-1.2a, TC-1.2b | Story 1: `01-thread-actor-message-part-store.md` |
| AC-1.3 | TC-1.3a, TC-1.3b | Story 1: `01-thread-actor-message-part-store.md` |
| AC-1.4 | TC-1.4a, TC-1.4b | Story 1: `01-thread-actor-message-part-store.md` |
| AC-2.1 | TC-2.1a, TC-2.1b, TC-2.1c, TC-2.1d, TC-2.1e, TC-2.1f | Story 2: `02-live-pi-activity-capture.md` |
| AC-2.2 | TC-2.2a, TC-2.2b, TC-2.2c | Story 2: `02-live-pi-activity-capture.md` |
| AC-2.3 | TC-2.3a, TC-2.3b | Story 1: `01-thread-actor-message-part-store.md` |
| AC-2.4 | TC-2.4a, TC-2.4b | Story 2: `02-live-pi-activity-capture.md` |
| AC-3.1 | TC-3.1a, TC-3.1b | Story 3: `03-prompt-bounded-turn-lifecycle.md` |
| AC-3.2 | TC-3.2a, TC-3.2b, TC-3.2c | Story 3: `03-prompt-bounded-turn-lifecycle.md` |
| AC-3.3 | TC-3.3a, TC-3.3b | Story 3: `03-prompt-bounded-turn-lifecycle.md` |
| AC-3.4 | TC-3.4a, TC-3.4b | Story 3: `03-prompt-bounded-turn-lifecycle.md` |
| AC-3.5 | TC-3.5a, TC-3.5b | Story 3: `03-prompt-bounded-turn-lifecycle.md` |
| AC-4.1 | TC-4.1a, TC-4.1b, TC-4.1c | Story 4: `04-generated-pi-session-target-metadata.md` |
| AC-4.2 | TC-4.2a, TC-4.2b, TC-4.2c | Story 4: `04-generated-pi-session-target-metadata.md` |
| AC-5.1 | TC-5.1a, TC-5.1b, TC-5.1c | Story 5: `05-attach-and-import-existing-pi-sessions.md` |
| AC-5.2 | TC-5.2a, TC-5.2b | Story 5: `05-attach-and-import-existing-pi-sessions.md` |
| AC-5.3 | TC-5.3a, TC-5.3b, TC-5.3c | Story 5: `05-attach-and-import-existing-pi-sessions.md` |
| AC-5.4 | TC-5.4a, TC-5.4b | Story 5: `05-attach-and-import-existing-pi-sessions.md` |
| AC-5.5 | TC-5.5a, TC-5.5b, TC-5.5c | Story 5: `05-attach-and-import-existing-pi-sessions.md` |
| AC-5.6 | TC-5.6a, TC-5.6b, TC-5.6c | Story 5: `05-attach-and-import-existing-pi-sessions.md` |
| AC-6.1 | TC-6.1a, TC-6.1b, TC-6.1c | Story 6: `06-turn-health-and-repair.md` |
| AC-6.2 | TC-6.2a, TC-6.2b, TC-6.2c | Story 6: `06-turn-health-and-repair.md` |
| AC-6.3 | TC-6.3a, TC-6.3b | Story 6: `06-turn-health-and-repair.md` |
| AC-6.4 | TC-6.4a, TC-6.4b, TC-6.4c | Story 6: `06-turn-health-and-repair.md` |
| AC-6.5 | TC-6.5a, TC-6.5b, TC-6.5c | Story 6: `06-turn-health-and-repair.md` |
| AC-7.1 | TC-7.1a, TC-7.1b, TC-7.1c | Story 7: `07-real-session-fixtures.md` |
| AC-7.2 | TC-7.2a, TC-7.2b | Story 7: `07-real-session-fixtures.md` |
| AC-7.3 | TC-7.3a, TC-7.3b | Story 7: `07-real-session-fixtures.md` |
| AC-7.4 | TC-7.4a, TC-7.4b | Story 7: `07-real-session-fixtures.md` |

### Coverage Count

| Story | ACs | TC Count |
|---|---|---:|
| Story 0: Foundation | No direct epic ACs | 0 |
| Story 1: Thread, Actor, Message, And Part Store | AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-2.3 | 11 |
| Story 2: Live PI Activity Capture | AC-2.1, AC-2.2, AC-2.4 | 11 |
| Story 3: Prompt-Bounded Turn Lifecycle | AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5 | 11 |
| Story 4: Generated PI Session Target Metadata | AC-4.1, AC-4.2 | 6 |
| Story 5: Attach And Import Existing PI Sessions | AC-5.1, AC-5.2, AC-5.3, AC-5.4, AC-5.5, AC-5.6 | 16 |
| Story 6: Turn Health And Repair | AC-6.1, AC-6.2, AC-6.3, AC-6.4, AC-6.5 | 14 |
| Story 7: Real-Session Fixtures | AC-7.1, AC-7.2, AC-7.3, AC-7.4 | 9 |
| Total | 30 ACs | 78 |

## Integration Path Trace

### Path 1: Managed PI Session Live Capture

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Start capture | Context Steward starts capture for a PI session and creates or opens the managed Thread. | Story 1 | TC-1.1a, TC-1.1b |
| Validate schema | Thread schema permits mutation before source records are written. | Story 1 | TC-1.3a, TC-1.3b |
| Declare actors | New actor identity is declared before message reference. | Story 1 | TC-1.4a |
| Capture prompt | Finalized agent-addressed prompt is stored as canonical Message. | Story 2 | TC-2.1a |
| Open Turn | First prompt opens the first canonical Turn. | Story 3 | TC-3.1a |
| Capture response/tool activity | Response and tool activity are stored and remain in current Turn. | Story 2 / Story 3 | TC-2.1b, TC-2.1c, TC-3.2a, TC-3.2b |
| Preserve ordering | Rapid finalized events keep observed order. | Story 2 | TC-2.1e |
| Prevent duplicate capture | Replayed finalized event does not append duplicate source record. | Story 2 | TC-2.1f |
| Close prior Turn | Next prompt closes the prior Turn and opens a new one. | Story 3 | TC-3.1b |

### Path 2: Attach Existing PI Session And Continue Capture

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Attach unmanaged session | Existing PI session imports into a new source Thread. | Story 5 | TC-5.1a |
| Handle empty or duplicate session | Empty session succeeds; already-managed session is rejected. | Story 5 | TC-5.1b, TC-5.1c |
| Resolve active path | Branched sessions import the active path or reject ambiguous branch state. | Story 5 | TC-5.2a, TC-5.2b |
| Preserve imported records | Imported order, Parts, timestamps, and PI metadata are preserved. | Story 5 | TC-5.3a, TC-5.3b, TC-5.3c |
| Record import metadata | Import source, range, count, and status are recorded. | Story 5 | TC-5.4a, TC-5.4b |
| Reconstruct imported Turns | Imported prompts/responses are grouped into canonical Turns. | Story 5 | TC-5.5a, TC-5.5b |
| Mark incomplete import repair-needed | Incomplete imported Turn reconstruction marks affected state repair-needed. | Story 5 | TC-5.5c |
| Continue live capture | New finalized PI activity appends after imported range and uses normal Turn rules. | Story 5 | TC-5.6a, TC-5.6b |
| Prevent overlapping import | Import cannot overlap active live capture for same session. | Story 5 | TC-5.6c |

### Path 3: Repair Turn State Before Downstream Maintenance

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Detect missing state | Turn health identifies missing Turn records. | Story 6 | TC-6.1a |
| Detect incomplete membership | Turn health identifies uncovered message ranges. | Story 6 | TC-6.1b |
| Reconstruct Turns | Repair creates Turns from prompt boundaries and assigns between-boundary messages. | Story 6 | TC-6.2a, TC-6.2b, TC-6.2c |
| Preserve source records | Repair does not mutate message order or message content. | Story 6 | TC-6.3a, TC-6.3b |
| Block downstream maintenance | Missing or incomplete Turn state blocks smoothing/chunking/smart compact readiness. | Story 6 | TC-6.4a, TC-6.4b |
| Clear blocker after repair | Repaired Turn state removes the blocker. | Story 6 | TC-6.4c |
| Report repair failure | Ambiguous boundary, write failure, or stale source input leaves state blocked. | Story 6 | TC-6.5a, TC-6.5b, TC-6.5c |

### Path 4: Create Real-Session Fixture For Later Validation

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Create fixture from managed Thread | Managed Thread creates Thread-shaped fixture data. | Story 7 | TC-7.1a |
| Create fixture from PI session | PI session import creates Thread-shaped fixture data. | Story 7 | TC-7.1b |
| Report fixture failure | Unreadable or unconvertible fixture source reports explicit error. | Story 7 | TC-7.1c |
| Preserve fixture structure | Fixture preserves message order and typed Parts. | Story 7 | TC-7.2a, TC-7.2b |
| Preserve repair status | Fixture records ready or repair-needed state and affected range. | Story 7 | TC-7.3a, TC-7.3b |
| Record fixture metadata | FixtureRecord identifies fixture, source, range, creation time, and status. | Story 7 | TC-7.4a, TC-7.4b |

## Validation

- [x] Every AC from the detailed epic appears in a story file.
- [x] Every TC from the detailed epic appears in exactly one story file.
- [x] Coverage artifact persisted as `stories/coverage.md`.
- [x] Integration path trace complete with no gaps.
- [x] Coverage gate table complete with no orphans.
- [x] Each story file has Jira section markers.
- [x] Story files are numbered and named consistently.
- [x] Business epic intentionally not produced.
