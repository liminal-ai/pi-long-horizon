# Story 5: Attach And Import Existing PI Sessions

### Summary
<!-- Jira: Summary field -->

Attach to an existing PI session by importing the active linear path into a new source Thread, recording import metadata, reconstructing turns, and continuing live capture.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Import prior PI activity from unmanaged sessions into canonical Thread records and associate future finalized PI activity with that Thread.

**In Scope**

- Attach/import existing PI sessions with or without prior activity.
- Reject duplicate attach/import for already-managed sessions.
- Import the active linear path from branched PI-native sessions or reject ambiguous branch state.
- Preserve imported order, Parts, timestamps, and PI target metadata.
- Record import metadata at the Thread/import level.
- Reconstruct prompt-bounded Turns from imported messages.
- Continue live capture after attach.

**Out of Scope**

- PI fork-created child Thread management.
- Full Navigator views of imported data.
- Smart compact or projection behavior.

**Dependencies**

- Story 2 complete.
- Story 3 complete.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

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

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 5 is the bridge from PI's native session history into the steward's canonical Thread. It has to read the active linear path from a potentially branched PI session, map those records into the same canonical Message and Part vocabulary used by live capture, reconstruct prompt-bounded turn state, and then hand the session back to normal live capture without creating a duplicate managed thread.

This story is where the target-association rules become operational. The same session can show up by id or by file path, so attach/import has to use the root target-key contract from the tech design rather than inventing a new association shortcut. It also must route imported activity through the canonical capture path so imported and live-captured records converge on one source shape instead of diverging into "import-only" records.

#### Implementation Targets

| Owned Targets | Files / Modules |
|---|---|
| Attach/import orchestration | `src/context-steward/services/import-service.ts` |
| PI active-path resolution | `src/context-steward/pi/pi-session-importer.ts` |
| Primary tests | `tests/context-steward/import-service.test.ts` |

| Integration Touchpoints | Files / Modules |
|---|---|
| Canonical imported capture from Story 2 | `src/context-steward/services/capture-service.ts` |
| Imported turn reconstruction from Story 3 prompt-boundary rules | `src/context-steward/services/turn-service.ts` |
| Operator command surface | `src/context-steward/pi/pi-extension.ts` |

#### Design References

- [tech-design.md §Target Session Key Contract](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:595), lines 595-617
- [tech-design.md §Flow 4: Attach and Import Existing PI Sessions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:788), lines 788-837
- [tech-design.md §PI Mapping](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1065), lines 1065-1089
- [tech-design.md §Core Services](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:923), lines 923-1064
- [tech-design.md §Chunk 3: Attach and Import Existing PI Sessions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1196), lines 1196-1209
- [test-plan.md `import-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:115), lines 115-137
- [test-plan.md §Command Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:175), lines 175-185

#### Test Mapping

| TC | Test File / Check | Test Description |
|---|---|---|
| TC-5.1a, TC-5.1b, TC-5.1c | `tests/context-steward/import-service.test.ts` | create a managed Thread for an unmanaged PI session, handle empty import, and reject duplicate managed association |
| TC-5.2a, TC-5.2b | `tests/context-steward/import-service.test.ts` | import only the active branch path or reject ambiguous branch state |
| TC-5.3a, TC-5.3b, TC-5.3c | `tests/context-steward/import-service.test.ts` | preserve imported source order, typed parts, timestamps, and PI metadata |
| TC-5.4a, TC-5.4b | `tests/context-steward/import-service.test.ts` | record import source, source range, count, and status metadata |
| TC-5.5a, TC-5.5b, TC-5.5c | `tests/context-steward/import-service.test.ts` | reconstruct imported turns with prompt-boundary rules and mark incomplete reconstruction as `repair_needed` |
| TC-5.6a, TC-5.6b, TC-5.6c | `tests/context-steward/import-service.test.ts` | continue live capture on the imported Thread and prevent overlap with active live capture for the same target |

#### Non-TC Decided Tests

- `tests/context-steward/import-service.test.ts`: NTC-8 import dry run reports the active path without writing records
- `tests/context-steward/import-service.test.ts`: NTC-9 partial import issues are sorted by source order

#### Technical Notes

- Imported PI entries should be persisted through the same canonical capture path used for live events whenever that is feasible, so message and part shape do not diverge.
- If imported turn reconstruction is incomplete, report `partial` import status and mark the thread `repair_needed`; do not synthesize a "ready" state from guessed boundaries.
- Story 2 owns finalized-message mapping and Story 3 owns prompt-boundary turn rules. This story consumes those seams; it should not create import-only variants of either rule.
- Story 6 remains the later owner of health checks, repair orchestration, range-limited repair, and stale-source recovery. Story 5 only reconstructs imported turns well enough to classify the imported thread as ready or `repair_needed`.
- Command-output coverage for `/lh-attach` lives in the shared command-surface non-TC tests under Story 7 so service-level TC ownership stays here and command-format ownership stays in one place.

#### Anti-Shim Requirements

- Use real PI session-shaped fixtures and active-path resolution logic. Do not bypass `pi-session-importer` with hand-built final message arrays.
- Prove that live capture continues on the same imported Thread after attach instead of only asserting on import-time records.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- `/lh-attach` core service creates a Thread for unmanaged PI sessions.
- Duplicate attach/import is rejected.
- Branched sessions import only an identifiable active path or fail with `IMPORT_PATH_AMBIGUOUS`.
- Imported messages use the canonical Message/Part shape.
- Import metadata records source, range, count, active path, and status.
- Imported turn reconstruction follows prompt-boundary rules and marks repair-needed state when incomplete.
- Live capture continues after attach.
- `import-service.test.ts` covers all TCs assigned to this story.
