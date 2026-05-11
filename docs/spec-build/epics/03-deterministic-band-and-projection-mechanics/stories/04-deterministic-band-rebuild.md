# Story 4: Deterministic Band Rebuild

### Summary
<!-- Jira: Summary field -->

Rebuild a draft Thread View from explicit per-run compaction inputs using deterministic full-fidelity, smooth, detailed, and brief allocation rules.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Objective**

Deliver deterministic Thread View rebuild under explicit operator-supplied compaction inputs (lower-bound target and per-band allocation percentages). Full fidelity fills from newest raw Turns backward. Smooth fills from the next older eligible smooth Turns. Detailed and brief fill from closed Chunks with available placeholder representations. The result is a draft Thread View with a materialized emitted message sequence that lands at or below the requested lower-bound target, or reports explicit failure.

**Scope**

In scope:
- Accept explicit lower-bound target and per-band allocation percentages
- Reject invalid compaction inputs before allocation starts
- Full-fidelity band: newest Turns backward, no Turn splitting
- Full-fidelity overage reported explicitly when raw Turns alone exceed lower bound
- Smooth band: next older eligible smooth Turns, no Turn splitting
- Detailed and brief bands: closed Chunks only, open Chunk excluded
- Empty lower bands when no closed Chunks available
- Materialized emitted message sequence across all bands in band order
- Empty bands do not corrupt materialization
- Rebuild lands at or below lower-bound target, or failure is explicit
- Invalid band-allocation percentages rejected before allocation

Out of scope:
- Smart compact command orchestration (Story 5)
- PI-target file generation (Story 5)
- Blocked/degraded reporting infrastructure (Story 6)
- Persisted default compaction policies (future)

**Dependencies**

- Story 3 (closed Chunks with placeholder representations)
- Epic 2 ThreadViewStore for draft Thread View persistence

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.1:** The steward rebuilds a draft Thread View from explicit per-run compaction inputs.

- **TC-4.1a: Rebuild accepts explicit lower-bound target and band mix**
  - Given: The operator provides a lower-bound target and per-band allocation percentages
  - When: deterministic rebuild starts
  - Then: the rebuild uses those explicit inputs for that run
- **TC-4.1b: Invalid compaction inputs are rejected explicitly**
  - Given: The operator provides invalid compaction inputs
  - When: deterministic rebuild starts
  - Then: the rebuild is rejected explicitly rather than silently coerced

**AC-4.2:** Full-fidelity band is filled first from newest raw Turns without splitting Turn boundaries.

- **TC-4.2a: Full-fidelity selection starts from newest Turns**
  - Given: A draft rebuild begins
  - When: the full-fidelity band is filled
  - Then: selection starts from the newest eligible Turns and works backward
- **TC-4.2b: Turn boundaries remain intact in full fidelity**
  - Given: A Turn would partially fit if split
  - When: full-fidelity band selection runs
  - Then: the Turn is either fully included or fully excluded
- **TC-4.2c: Full-fidelity-only overage is explicit**
  - Given: The selected full-fidelity region alone exceeds the requested lower-bound target
  - When: deterministic rebuild completes or stops
  - Then: the overage is reported explicitly rather than hidden

**AC-4.3:** Smooth band is filled next from older smooth Turns without splitting Turn boundaries.

- **TC-4.3a: Smooth band begins after the full-fidelity region by default**
  - Given: Full-fidelity selection has finished and no bespoke exclusion applies
  - When: the smooth band is filled
  - Then: selection begins from the next older eligible Turns
- **TC-4.3b: Turn boundaries remain intact in the smooth band**
  - Given: A smooth Turn would partially fit if split
  - When: smooth-band selection runs
  - Then: the Turn is either fully included or fully excluded

**AC-4.4:** Detailed and brief bands use closed Chunks only.

- **TC-4.4a: Closed Chunk can enter detailed or brief band**
  - Given: A Chunk is closed and has the required placeholder representation
  - When: lower-band allocation runs
  - Then: the Chunk can be selected into the corresponding band
- **TC-4.4b: Open Chunk cannot enter detailed or brief band**
  - Given: A Chunk is still open
  - When: lower-band allocation runs
  - Then: the Chunk is not eligible for detailed or brief band selection
- **TC-4.4c: No closed Chunks leaves lower bands empty explicitly**
  - Given: No closed Chunks are available for lower-band allocation
  - When: lower-band allocation runs
  - Then: the detailed and brief bands remain explicitly empty

**AC-4.5:** The rebuilt draft Thread View materializes a full emitted message sequence across all selected bands.

- **TC-4.5a: Materialized emitted sequence preserves band order**
  - Given: A draft Thread View has selections across multiple bands
  - When: emitted messages are materialized
  - Then: the final message sequence preserves the ordered band layout
- **TC-4.5b: Empty band does not corrupt materialization**
  - Given: One or more bands are empty
  - When: emitted messages are materialized
  - Then: the emitted sequence still materializes correctly from the non-empty bands

**AC-4.6:** The rebuilt draft Thread View targets the requested lower-bound input for that run.

- **TC-4.6a: Successful rebuild lands at or below lower threshold**
  - Given: Required source and placeholder artifacts are available and the operator has provided a lower-bound target
  - When: deterministic rebuild completes
  - Then: the resulting draft Thread View is at or below the requested lower-bound target
- **TC-4.6b: Failure to reach lower threshold is explicit**
  - Given: deterministic rebuild cannot reach the requested lower-bound target with the available mechanics
  - When: the rebuild completes or stops
  - Then: the failure is reported explicitly rather than hidden
- **TC-4.6c: Invalid band-allocation percentages are rejected explicitly**
  - Given: The operator provides an invalid band-allocation mix
  - When: deterministic rebuild starts
  - Then: the run is rejected explicitly before allocation proceeds

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the center of the Feature 3 mechanics. It is where source Thread
state and derived async-thread artifacts become a new draft Thread View under
explicit compaction inputs. That makes it the bridge between the source-truth
side of the system and the runtime-facing side.

This story owns rebuild and materialization, but it does **not** own command
orchestration, PI-target file generation, or harness loading. It should stop at:
- choosing band selections
- validating lower-band eligibility
- materializing emitted messages
- persisting the rebuilt draft Thread View

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Rebuild service | `src/thread-view/services/thread-view-builder.ts` |
| Materialization | `src/thread-view/services/thread-view-materializer.ts` |
| Thread View store updates | `src/thread-view/store/thread-view-store.ts`, `src/thread-view/store/file-thread-view-store.ts` |
| Source and derived-state reads | `src/thread/store/thread-store.ts`, `src/thread/async-thread/*` |

#### Design References

- [tech-design-thread-view.md §Sequence: Flow 4 Band Rebuild And View Materialization](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread-view.md:101), lines 101-160
- [tech-design-thread-view.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread-view.md:248), lines 248-267
- [test-plan.md §`tests/thread-view/thread-view-builder.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:152), lines 152-168
- [test-plan.md §`tests/thread-view/thread-view-materializer.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:170), lines 170-175

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-4.1a | `tests/thread-view/thread-view-builder.test.ts` | rebuild accepts explicit run inputs |
| TC-4.1b | `tests/thread-view/thread-view-builder.test.ts` | rebuild rejects invalid run inputs |
| TC-4.2a | `tests/thread-view/thread-view-builder.test.ts` | full-fidelity selection starts from newest turns |
| TC-4.2b | `tests/thread-view/thread-view-builder.test.ts` | full-fidelity does not split turns |
| TC-4.2c | `tests/thread-view/thread-view-builder.test.ts` | full-fidelity-only overage is explicit |
| TC-4.3a | `tests/thread-view/thread-view-builder.test.ts` | smooth band begins after full-fidelity region by default |
| TC-4.3b | `tests/thread-view/thread-view-builder.test.ts` | smooth band does not split turns |
| TC-4.4a | `tests/thread-view/thread-view-builder.test.ts` | closed chunk can enter lower band |
| TC-4.4b | `tests/thread-view/thread-view-builder.test.ts` | open chunk cannot enter lower band |
| TC-4.4c | `tests/thread-view/thread-view-builder.test.ts` | no closed chunks leaves lower bands empty |
| TC-4.5a | `tests/thread-view/thread-view-materializer.test.ts` | materialized emitted sequence preserves band order |
| TC-4.5b | `tests/thread-view/thread-view-materializer.test.ts` | empty band does not corrupt materialization |
| TC-4.6a | `tests/thread-view/thread-view-builder.test.ts` | rebuild lands at or below lower bound |
| TC-4.6b | `tests/thread-view/thread-view-builder.test.ts` | rebuild failure to reach lower bound is explicit |
| TC-4.6c | `tests/thread-view/thread-view-builder.test.ts` | invalid band percentages rejected before allocation |

#### Non-TC Decided Tests

- `tests/thread-view/thread-view-builder.test.ts`: lower-band selection rejects closed-chunk ids missing required persisted artifacts
- `tests/thread-view/thread-view-materializer.test.ts`: band order preserved when multiple middle or lower bands are empty

#### Technical Notes

The rebuild-specific contract is not fully described in the epic’s Data
Contracts section, so this story pulls the `ThreadViewBuildInputs` and
`ThreadViewBuildResult` contract from the tech design. That is the contract the
implementer actually needs here.

#### Anti-Shim Requirements

- Prove lower-band eligibility from real persisted chunk state, not from injected fake chunk summaries.
- Prove materialization from actual selected turns/chunks and band ordering, not from a canned emitted-message fixture.

#### Verification

- Targeted: `node --import tsx --test tests/thread-view/thread-view-builder.test.ts tests/thread-view/thread-view-materializer.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 15 TCs pass (TC-4.1a through TC-4.6c)
- [ ] Draft Thread Views persist with band selections and emitted messages
- [ ] `npm run verify` passes
