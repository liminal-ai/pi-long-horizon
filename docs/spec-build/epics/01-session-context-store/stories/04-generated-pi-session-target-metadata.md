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
