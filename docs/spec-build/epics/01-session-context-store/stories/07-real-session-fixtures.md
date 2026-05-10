# Story 7: Real-Session Fixtures

### Summary
<!-- Jira: Summary field -->

Create Thread-shaped fixtures from managed Threads or PI sessions, preserving canonical ordering, typed Parts, repair status, and FixtureRecord metadata.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Create reusable real-session fixtures that later Navigator, projection, and summarization tests can read through the same Thread-shaped store interface.

**In Scope**

- Fixture creation from managed Threads.
- Fixture creation through PI session import.
- Fixture failure reporting.
- Preservation of message order and typed Part structure.
- Repair status and source range metadata.
- FixtureRecord identity, source, range, creation time, import/repair status, and availability status.

**Out of Scope**

- Expanded threshold/projection fixture generation beyond basic real-session fixture creation.
- Navigator display behavior.
- Smart compact or summarization validation.

**Dependencies**

- Story 5 complete.
- Story 6 complete.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

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

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 7 packages real source behavior into reusable fixtures for later Navigator, projection, and summarization work. The design rule here is shape fidelity: a fixture must still look like a Thread-shaped data set, not like a one-off export format or screenshot of state. That is what lets later features open fixtures through the same store and traversal concepts they use for live threads.

This story can reuse import behavior when the source is an unmanaged PI session, but it still owns the fixture directory layout and `FixtureRecord` contract. A fixture from a PI session should therefore end as fixture-shaped Thread data with import and repair status preserved, not as a special import artifact that later tests have to understand differently.

#### Implementation Targets

| Owned Targets | Files / Modules |
|---|---|
| Fixture creation and metadata | `src/context-steward/services/fixture-service.ts` |
| Fixture directory layout | `src/context-steward/store/file-thread-store.ts` |
| Primary tests | `tests/context-steward/fixture-service.test.ts` |
| Shared command-surface non-TC coverage | `tests/context-steward/pi-extension-commands.test.ts` |

| Integration Touchpoints | Files / Modules |
|---|---|
| PI-session fixture path from Story 5 | `src/context-steward/services/import-service.ts` |
| Operator command surface | `src/context-steward/pi/pi-extension.ts` |

#### Design References

- [tech-design.md §Record Schemas](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:292), lines 292-452
- [tech-design.md §File Layout](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:618), lines 618-647
- [tech-design.md §Flow 6: Real-Session Fixtures](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:882), lines 882-920
- [tech-design.md §Commands](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1090), lines 1090-1105
- [tech-design.md §Chunk 5: Real-Session Fixtures and Commands](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1224), lines 1224-1237
- [test-plan.md `fixture-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:159), lines 159-174
- [test-plan.md §Command Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:175), lines 175-185
- [test-plan.md §Non-TC Decided Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:187), lines 187-205

#### Test Mapping

| TC | Test File / Check | Test Description |
|---|---|---|
| TC-7.1a, TC-7.1b, TC-7.1c | `tests/context-steward/fixture-service.test.ts` | create fixture data from managed Threads or PI sessions and report creation failures explicitly |
| TC-7.2a, TC-7.2b | `tests/context-steward/fixture-service.test.ts` | preserve canonical message order and typed-part structure in fixture output |
| TC-7.3a, TC-7.3b | `tests/context-steward/fixture-service.test.ts` | preserve ready vs repair-needed state inside fixture metadata |
| TC-7.4a, TC-7.4b | `tests/context-steward/fixture-service.test.ts` | record fixture identity, source, range, import/repair status, and availability metadata |

#### Non-TC Decided Tests

- `tests/context-steward/pi-extension-commands.test.ts`: NTC-12 command formatter returns concise success and error summaries
- `tests/context-steward/pi-extension-commands.test.ts`: NTC-13 `/lh-status` works when no managed Thread exists

#### Technical Notes

- Fixtures created from PI sessions may call into import logic, but the persisted result must still be the fixture directory shape defined by this story.
- `fixture.json` should preserve import and repair visibility so later consumers can reason about fixture quality without opening every underlying record file.
- Keep fixture paths separate from managed thread paths. A fixture is consumable source material, not an active thread association.
- Story 7 is also the home for the shared command-surface non-TC checks from Chunk 5 so `/lh-fixture` and `/lh-status` output behavior lives alongside the fixture command surface instead of being duplicated across import and repair stories.

#### Anti-Shim Requirements

- Verify fixture directory contents and record shapes, not only the returned `FixtureRecord`.
- For PI-session fixture sources, use real import fixtures rather than bypassing `import-service` with already-normalized canonical records.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- Managed Threads can produce Thread-shaped fixture data.
- PI sessions can produce Thread-shaped fixture data through import.
- Fixture failures report `FIXTURE_CREATE_FAILED`.
- Fixture messages preserve canonical order and typed Parts.
- Fixture repair status and affected ranges are visible.
- FixtureRecord metadata records identity, source, range, creation time, import/repair status, and availability status.
- `fixture-service.test.ts` covers all TCs assigned to this story.
