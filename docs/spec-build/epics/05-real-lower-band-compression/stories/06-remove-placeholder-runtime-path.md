# Story 6: Remove Placeholder Runtime Path

### Summary
<!-- Jira: Summary field -->

Deterministic placeholder detailed/brief generation is removed from normal runtime behavior and tests no longer bless placeholder fallback.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands.

**Objective:** After this story, the deterministic placeholder generator is not reachable through normal smart compact or runtime selection. Old placeholder state is never treated as ready lower-band output. Tests that previously asserted deterministic placeholder lower-band generation are removed or rewritten to assert real lower-band behavior.

**Scope:**

In scope:
- Placeholder generator unreachable through normal compact/runtime path
- Placeholder-era output not emitted for selected lower bands
- Old placeholder state not treated as ready
- Tests that blessed placeholder behavior removed or rewritten
- No runtime compatibility shim preserved for placeholder output
- New code must not deepen imports into placeholder services
- E2E assertion, piggybacking on Story 5's PI runtime path, that generated rollout output contains no deterministic placeholder fallback

Out of scope:
- Removing placeholder code from the repo entirely (it may stay as dead code for reference until a cleanup pass)
- Polished migration of old sessions (operator clears them)
- Formal eval of the replacement output quality

**Dependencies:** Story 5 complete.

**Story type:** Packaging / cutover

**Governing idea:** Placeholder lower-band output is impossible to reach at runtime after cutover.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.4:** Smart compact does not use deterministic placeholder output as a runtime fallback.

- **TC-4.4a: Placeholder output is not emitted for selected lower bands**
  - Given: selected lower-band semantic output is missing or failed
  - When: smart compact prepares generated session output
  - Then: it does not emit deterministic placeholder detailed or brief text
- **TC-4.4b: Old placeholder state is not treated as ready**
  - Given: a Chunk has old deterministic placeholder lower-band data but no real semantic lower-band output
  - When: smart compact validates lower-band readiness
  - Then: the Chunk is not treated as ready for selected detailed or brief output

**AC-4.5:** Existing placeholder generation is removed from normal runtime behavior.

- **TC-4.5a: Placeholder generator is not reachable through normal compact**
  - Given: smart compact needs lower-band output
  - When: normal runtime behavior runs
  - Then: the deterministic placeholder generator is not invoked as a fallback
- **TC-4.5b: Placeholder tests are replaced**
  - Given: tests previously asserted deterministic placeholder lower-band generation
  - When: the epic's tests are reviewed
  - Then: those tests have been removed or rewritten to assert real lower-band behavior

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This is the runtime ownership cutover story. By the time it starts, the new
lower-band path should already be real enough that placeholders are no longer a
necessary compatibility bridge. The story does not need to delete all
placeholder-era code from the repo, but it does need to make runtime selection,
reporting, and tests behave as though placeholders are dead.

The shape here is important: legacy state may still be recognized so the system
can block or report it, but not to satisfy readiness. That distinction is what
prevents “temporary compatibility” from quietly becoming a second product path.

#### Build Strategy

Strategy: `simple-risk-reminders`

Reason:
- the conceptual center is strong: cut runtime selection away from placeholders
- most of the work is coordinated surface cleanup, not a new algorithm
- the risk is shim creep more than raw implementation complexity

Risk Reminders:
- remove placeholder validity from every consumer that can bless runtime
  readiness
- keep legacy-state inspection/reporting without letting it satisfy readiness
- rewrite tests so they fail if placeholder success behavior is still reachable

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Prepare/runtime lower-band selection | `src/thread/async-thread/services/async-thread-run-service.ts`, `src/commands/smart-compact.ts` |
| Runtime projection and materialization | `src/thread-view/services/thread-view-builder.ts`, `src/thread-view/services/thread-view-materializer.ts`, `src/thread-view/targets/pi/pi-thread-view-builder.ts` |
| Workbench/query/reporting cutover | `src/workbench/services/workbench-query-service.ts`, `src/workbench/services/workbench-search-service.ts`, `src/workbench/services/compaction-report-service.ts`, `src/workbench/services/active-rollout-inspection-service.ts` |
| PI command surface | `src/context-steward/pi/pi-extension.ts` |
| Placeholder-era tests and fixtures | `tests/commands/smart-compact.test.ts`, placeholder-focused thread/workbench fixtures and related tests |

#### Design References

- [tech-design.md §Placeholder Cutover Inventory](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:313), lines 313-343
- [tech-design.md §Architecture Decisions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:219), lines 227-237
- [tech-design.md §Chunk 6: Placeholder Runtime Path Removal And Legacy Blocking](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:986), lines 986-1001
- [test-plan.md §tests/commands/smart-compact.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:245), lines 245-252
- [test-plan.md §Non-TC Architecture-Risk Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:295), lines 295-314

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-4.4a`, `TC-4.4b` | `tests/commands/smart-compact.test.ts` | placeholder output is never emitted and old placeholder state never satisfies lower-band readiness |
| `TC-4.5a`, `TC-4.5b` | `tests/commands/smart-compact.test.ts` | placeholder generator is unreachable in runtime behavior and tests no longer depend on placeholder success |

#### Non-TC Decided Tests

- `tests/commands/smart-compact.test.ts`: runtime path cannot invoke placeholder generator after cutover
- `tests/context-workbench/workbench-query-service.test.ts`, `tests/context-workbench/workbench-search-service.test.ts`: workbench summaries stop presenting placeholder output as valid semantic lower-band state
- `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts`: the Story 5 runtime continuation E2E also asserts generated rollout output contains semantic lower-band text and no deterministic placeholder detailed/brief fallback

#### Technical Notes

- This story is about runtime selection and reporting behavior, not necessarily
  full code deletion. Dead code cleanup can happen later if it stays unreachable.
- The workbench/query surfaces are part of the cutover, not a trailing cleanup.
- New code should not deepen imports into placeholder services even if existing
  placeholder code remains in the tree temporarily.
- The E2E requirement should extend the Story 5 PI runtime scenario. Do not add
  a separate full long-thread E2E solely for placeholder removal unless the
  shared runtime path cannot expose the assertion.

#### Anti-Shim Requirements

- Do not leave a hidden “just in case” placeholder fallback in compact, builder,
  materializer, or workbench paths.
- Do not preserve placeholder readiness in workbench/query output to make the
  operator experience look more complete.
- Do not count a story as done if the tests merely stop mentioning placeholders;
  they need to fail when placeholder success behavior is still reachable.
- Do not satisfy the E2E by checking only service-tier state; the final generated
  rollout artifact must be free of placeholder fallback text.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Placeholder generator not invoked by normal compact/builder/materializer path
- [ ] Placeholder-era output never emitted for selected lower bands
- [ ] Old placeholder state not treated as ready
- [ ] No runtime-facing test depends on placeholder success behavior
- [ ] No new code deepens imports into placeholder services
- [ ] Story 5 PI runtime E2E includes placeholder-free generated rollout assertion
- [ ] `npm run verify` passes
- [ ] `npm run verify-all` passes with the placeholder-free runtime assertion
- [ ] Architecture-risk test: runtime path cannot invoke placeholder generator after cutover
