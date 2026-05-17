# Story 5: Smart Compact Lower-Band Readiness

### Summary
<!-- Jira: Summary field -->

Smart compact requires selected real lower-band outputs, performs visible catch-up when needed, and fails specifically when selected output cannot be produced.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands.

**Objective:** After this story, smart compact validates that selected Chunks have ready detailed or brief semantic output before building the runtime projection. If selected output is missing, compact performs synchronous catch-up generation with visible stderr warnings. If catch-up fails, compact stops with a specific error identifying the blocking Chunk and band. No placeholder text is emitted for selected lower bands.

**Scope:**

In scope:
- Selected detailed Chunks require ready detailed output
- Selected brief Chunks require ready brief output
- Missing selected output triggers synchronous catch-up generation
- Catch-up writes visible stderr warning identifying Chunk and band
- Catch-up failure blocks compact with specific error
- Legacy/blocked Chunks report as explicit blockers before draft build
- Runtime projection (`buildThreadViewProjection`) only proceeds when selected lower-band output is ready
- E2E proof that PI can continue after smart compact consumes ready semantic lower-band output

Out of scope:
- Removing placeholder generator from runtime (Story 6)
- Formal inspection reporting (Story 7)
- Changes to band allocation percentages

**Dependencies:** Story 4 complete.

**Story type:** Orchestration / convergence

**Governing idea:** Selected lower-band output must be real and ready, or compact fails visibly.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.1:** Smart compact requires selected lower-band outputs to be ready.

- **TC-4.1a: Detailed-selected Chunk requires detailed output**
  - Given: smart compact selects a Chunk for the detailed band
  - When: compact validates lower-band readiness
  - Then: the Chunk must have ready detailed output
- **TC-4.1b: Brief-selected Chunk requires brief output**
  - Given: smart compact selects a Chunk for the brief band
  - When: compact validates lower-band readiness
  - Then: the Chunk must have ready brief output

**AC-4.2:** Smart compact performs visible catch-up when selected lower-band output is missing.

- **TC-4.2a: Missing selected output triggers catch-up**
  - Given: a selected Chunk is missing required detailed or brief output
  - When: smart compact prepares selected lower-band material
  - Then: the system attempts synchronous generation for the missing output
- **TC-4.2b: Catch-up warning is visible**
  - Given: smart compact performs synchronous lower-band catch-up
  - When: catch-up starts
  - Then: the system writes a standard-error warning identifying the selected Chunk and band being regenerated

**AC-4.3:** Smart compact fails specifically when required lower-band output cannot be produced.

- **TC-4.3a: Detailed failure blocks detailed compact**
  - Given: a selected detailed Chunk cannot produce detailed output after allowed catch-up
  - When: smart compact prepares lower-band material
  - Then: compact fails with a specific error identifying the Chunk and detailed band
- **TC-4.3b: Brief failure blocks brief compact**
  - Given: a selected brief Chunk cannot produce brief output after allowed catch-up
  - When: smart compact prepares lower-band material
  - Then: compact fails with a specific error identifying the Chunk and brief band

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the runtime consumer gate for the entire Epic 5 path. The lower
bands can only be considered real once smart compact refuses to build a runtime
projection from missing or fake lower-band output. The runtime projection path
uses `buildThreadViewProjection` and records projection revisions on the
canonical thread state; it does not rely on `ThreadViewStore` as active rollout
truth.

The catch-up path is intentionally narrow. Prepare mode may synchronously
regenerate selected missing lower-band output, but only for the selected Chunk
and band. If that repair fails, no generated output should be written and the
operator should get a specific blocker.

#### Build Strategy

Strategy: `full-staged-risk`

Reason:
- this story crosses command, prepare, builder, and projection-output seams
- it is easy to fake with helper-level readiness checks
- failure handling matters as much as the happy path

Risk Reminders:
- prove the compact path through `prepareAsyncThread` and `buildThreadViewProjection`
- catch-up must remain selected-output-only
- prove no active/generated output is written on failure

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Prepare-mode readiness and catch-up | `src/thread/async-thread/services/async-thread-run-service.ts` |
| Command orchestration and generated-output safety | `src/commands/smart-compact.ts` |
| Runtime projection build boundary | `src/thread-view/services/thread-view-builder.ts`, `src/thread-view/services/thread-view-materializer.ts` |
| Generated output metadata / projection revision path | `src/thread/services/thread-service.ts`, `src/thread/domain/records.ts` |

#### Design References

- [tech-design.md §Architecture Decisions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:219), lines 231-237
- [tech-design.md §Flow 4: Smart Compact Lower-Band Readiness And Catch-Up](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:483), lines 483-520
- [tech-design.md §Surface Ownership / Compatibility Boundary](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:334), lines 334-343
- [tech-design.md §Chunk 5: Smart Compact Lower-Band Readiness](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:968), lines 968-984
- [test-plan.md §tests/thread/async-thread-run-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:232), lines 232-243
- [test-plan.md §tests/commands/smart-compact.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:245), lines 245-252
- [test-plan.md §Non-TC Architecture-Risk Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:295), lines 295-314

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-4.1a`, `TC-4.1b` | `tests/thread/async-thread-run-service.test.ts` | selected detailed/brief Chunks require ready output before compact can proceed |
| `TC-4.2a`, `TC-4.2b` | `tests/thread/async-thread-run-service.test.ts` | missing selected output triggers synchronous catch-up and visible warnings |
| `TC-4.3a`, `TC-4.3b` | `tests/thread/async-thread-run-service.test.ts` | failed selected-band catch-up blocks compact with Chunk/band-specific errors |

#### Non-TC Decided Tests

- `tests/commands/smart-compact.test.ts`: partial smart compact failure leaves no active bad generated output
- `tests/thread/chunk-service.test.ts`, `tests/thread/async-thread-run-service.test.ts`: later-stage tests consume real prior-story projection/transcript state rather than fake eligibility flags
- `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts`: prepared long-thread PI session runs, semantic lower-band output is ready, smart compact consumes that output through `buildThreadViewProjection`, generated rollout reloads, and PI continues afterward

#### Technical Notes

- Runtime compact path means `buildThreadViewProjection`, not draft `ThreadViewStore`
  flows. Keep that distinction explicit in code and tests.
- Catch-up belongs to prepare mode only. The direct command path should not
  silently grow its own repair logic.
- Legacy/blocked Chunk handling is part of readiness evaluation even though the
  actual placeholder-runtime cutover completes in Story 6.
- The E2E assertion is not a replacement for service-tier readiness tests. It
  proves that the already-tested readiness behavior survives the real PI
  generated-session reload and continuation path.

#### Anti-Shim Requirements

- Do not prove readiness through helper booleans or hand-built builder inputs
  while skipping the real prepare/build path.
- Do not let catch-up regenerate non-selected bands “for convenience.”
- Do not write or reload generated output on any path where selected lower-band
  readiness remains blocked or failed.
- Do not satisfy the E2E with placeholder text, hand-seeded compact output, or a
  fake generated-session reload.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Selected detailed Chunks validated for ready detailed output
- [ ] Selected brief Chunks validated for ready brief output
- [ ] Missing selected output triggers synchronous catch-up via compression service
- [ ] Catch-up writes visible stderr warning with Chunk and band identifiers
- [ ] Catch-up failure blocks compact with specific error
- [ ] Legacy/blocked Chunks surface as explicit blockers
- [ ] No generated output written when selected lower-band output missing or failed
- [ ] E2E proves PI continues after smart compact consumes ready semantic lower-band output
- [ ] `npm run verify` passes
- [ ] `npm run verify-all` passes with the Story 5 lower-band runtime continuation E2E
- [ ] Architecture-risk test: partial compact failure leaves no active bad output
