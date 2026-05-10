# Story 4: Upper-Band Composition

### Summary
<!-- Jira: Summary field -->

Fill full-fidelity and smooth bands from turn selections, render selected representations (raw messages for full fidelity, smooth-turn messages for smooth), and materialize the emitted output.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages long-running PI coding sessions whose useful context is larger than a raw transcript. The steward needs to find relevant source material quickly, understand how that material is currently represented, and build or revise Thread Views without mutating source truth.

**Objective**

Deliver upper-band composition: the steward selects turns for the full-fidelity and smooth bands, the materializer renders them into the appropriate representations, and the draft Thread View persists both band selections and the materialized emitted messages.

**Scope**

In scope:
- Full-fidelity band composition using turn selections
- Full-fidelity rendering: raw messages from selected turns in source order
- Smooth band composition using turn selections
- Smooth rendering: one synthetic smooth-turn message per selected turn
- Band boundary preservation (turns are atomic — never split across bands)
- Smooth band defaults to contiguous turns adjacent to full-fidelity boundary (bespoke overrides allowed)
- Missing smooth artifact visibility
- Materialized emitted message persistence

Out of scope:
- Turn-level exclusion (Story 3)
- Lower-band chunk composition (Story 5)
- Comparison and activation (Story 6)
- Smooth turn generation (Feature 3/4)

**Dependencies**

- Story 3 (draft Thread View lifecycle, ThreadViewStore updates)
- Epic 1 ThreadStore for source Turn and Message reads

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-5.1:** Using the workbench, the steward can compose the full-fidelity band from turn selections while preserving turn boundaries.

- **TC-5.1a: Full-fidelity selection is turn-based**
  - Given: A draft Thread View is being filled
  - When: The steward adds content to the full-fidelity band
  - Then: The selected source units are Turns, not individual Messages
- **TC-5.1b: Full-fidelity band does not split a Turn**
  - Given: A Turn has multiple Messages
  - When: The Turn is selected for the full-fidelity band
  - Then: The Turn is either included or excluded as a whole

**AC-5.2:** Using the workbench, the steward can inspect full-fidelity rendering as raw Messages for the selected Turns.

- **TC-5.2a: Selected full-fidelity turn renders raw messages**
  - Given: One or more Turns are selected for the full-fidelity band
  - When: The draft Thread View is materialized
  - Then: The full-fidelity band emits the raw Messages from those Turns in source order
- **TC-5.2b: Full-fidelity band preserves raw actor back-and-forth**
  - Given: A selected Turn contains multiple actor exchanges
  - When: The full-fidelity band is materialized
  - Then: The emitted full-fidelity content preserves the original message sequence

**AC-5.3:** Using the workbench, the steward can compose the smooth band from turn selections distinct from the full-fidelity band.

- **TC-5.3a: Smooth band uses selected turns**
  - Given: A draft Thread View contains a smooth band
  - When: The steward fills that band
  - Then: The selected source units are Turns
- **TC-5.3b: Smooth band follows the full-fidelity boundary by default**
  - Given: A draft Thread View has selected full-fidelity Turns and no bespoke curation override applies
  - When: The steward fills the smooth band
  - Then: Smooth-band selection starts from the next older eligible turns outside the full-fidelity region

**AC-5.4:** Using the workbench, the steward can inspect smooth-band rendering as smooth-turn representations for selected Turns.

- **TC-5.4a: Selected smooth turn renders one smooth representation**
  - Given: A Turn has a smooth representation available
  - When: The Turn is selected for the smooth band
  - Then: The smooth band emits the smooth-turn representation for that Turn
- **TC-5.4b: Missing smooth artifact is visible**
  - Given: A Turn is selected for the smooth band and no smooth representation is available
  - When: The draft Thread View is inspected
  - Then: The workbench reports that the selected Turn lacks a smooth representation

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story owns the first true composition and materialization behavior in the workbench. It takes a persisted draft view from Story 3 and turns selected upper-band source units into the emitted message sequence that later comparison and activation rely on.

The key distinction is between band selection truth and emitted result. This story has to persist both.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Band update entrypoint | `src/context-workbench/services/thread-view-edit-service.ts` |
| Materializer | `src/context-workbench/services/thread-view-materializer.ts` |
| Thread View records | `src/context-workbench/domain/thread-view-records.ts` |
| Materializer tests | `tests/context-workbench/thread-view-materializer.test.ts` |

#### Design References

- [tech-design.md §Persisted vs Computed Split](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:366), lines 366-378
- [tech-design.md §Flow 5: Upper-Band Composition](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:483), lines 483-510
- [tech-design.md §Materialization Contracts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/tech-design.md:684), lines 684-702
- [test-plan.md §thread-view-materializer.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/02-context-workbench/test-plan.md:145), lines 145-158

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-5.1a | `tests/context-workbench/thread-view-materializer.test.ts` | full-fidelity selection is turn-based |
| TC-5.1b | `tests/context-workbench/thread-view-materializer.test.ts` | full-fidelity does not split turns |
| TC-5.2a | `tests/context-workbench/thread-view-materializer.test.ts` | selected full-fidelity turns emit raw messages |
| TC-5.2b | `tests/context-workbench/thread-view-materializer.test.ts` | full-fidelity preserves actor back-and-forth |
| TC-5.3a | `tests/context-workbench/thread-view-materializer.test.ts` | smooth band uses turn selections |
| TC-5.3b | `tests/context-workbench/thread-view-materializer.test.ts` | smooth band follows full-fidelity boundary by default |
| TC-5.4a | `tests/context-workbench/thread-view-materializer.test.ts` | selected smooth turn emits one smooth representation |
| TC-5.4b | `tests/context-workbench/thread-view-materializer.test.ts` | missing smooth artifact is visible |

#### Non-TC Decided Tests

- `thread-view-materializer.test.ts`: materializer preserves band order when one band is empty

#### Technical Notes

Upper bands use turn IDs as their source-unit selections. Full-fidelity entries emit raw turn messages in source order. Smooth entries emit one synthetic smooth-turn message per selected turn using standardized `[user]`, `[assistant]`, `[tool]`, `[thinking]` markers.

#### Anti-Shim Requirements

- Assert against the actual emitted message sequence, not only selected IDs or a “materialized” boolean.
- Prove the smooth-turn wire format uses the expected role markers rather than a generic stringified blob.

#### Verification

- Targeted: `node --import tsx --test tests/context-workbench/thread-view-materializer.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All TCs pass (TC-5.1a through TC-5.4b)
- [ ] Materializer produces correct emitted messages for full-fidelity and smooth bands
- [ ] Band selections and emitted messages are persisted on draft
- [ ] Missing smooth artifacts reported as band-level issues
- [ ] `npm run verify` passes
- [ ] `npm run green-verify` passes
