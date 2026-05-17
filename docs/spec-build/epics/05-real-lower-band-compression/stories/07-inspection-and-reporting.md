# Story 7: Lower-Band Inspection And Reporting

### Summary
<!-- Jira: Summary field -->

Operator inspection reports lower-band transcript readiness, detailed/brief status, failures, catch-up events, and compact blockers without becoming a formal eval system.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward (secondary: human operator)

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands. The operator inspects lower-band readiness, watches for warnings and failures, and diagnoses compact blockers.

**Objective:** After this story, the operator can inspect a Thread to see which closed Chunks have conversation-only transcripts, whether detailed and brief outputs are ready/pending/failed, what error caused a failure, whether compact had to perform catch-up, and which Chunk/band blocked compact. The inspection does not produce quality grades, model comparison dashboards, or formal eval reports.

**Scope:**

In scope:
- Inspection reports transcript readiness per Chunk
- Inspection reports detailed and brief status (ready, pending/not ready, failed)
- Failed output includes last error code or message
- Compact blocker reporting identifies Chunk and band
- Retry, escalation, and catch-up events visible in operational logs
- Catch-up events visible in rollout/inspection surfaces
- No automatic quality grade assigned
- No model comparison dashboard required
- Narrow E2E/CLI proof that the real operator command surface can reach lower-band inspection output

Out of scope:
- Formal quality eval harness
- Automatic scoring
- Model comparison reports
- Summary quality judgment (remains human dogfood judgment)

**Dependencies:** Story 6 complete. Inspection support may be delivered incrementally in earlier stories when it helps validate compression and smart compact behavior. Story 7 completes the formal inspection AC coverage.

**Story type:** Metadata / reporting

**Governing idea:** Operators see lower-band readiness and failures without the system becoming an eval product.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-5.1:** Inspection reports lower-band readiness for closed Chunks.

- **TC-5.1a: Transcript readiness visible**
  - Given: a closed Chunk exists
  - When: the operator inspects lower-band state
  - Then: the report shows whether the conversation-only Chunk transcript is present and usable
- **TC-5.1b: Detailed and brief status visible**
  - Given: a closed Chunk exists
  - When: the operator inspects lower-band state
  - Then: the report shows detailed and brief status as ready, pending/not ready, or failed

**AC-5.2:** Inspection reports actionable failure information.

- **TC-5.2a: Failed lower-band output includes error summary**
  - Given: detailed or brief generation failed for a Chunk
  - When: the operator inspects lower-band state
  - Then: the report includes the last error code or message for that band
- **TC-5.2b: Compact blocker identifies Chunk and band**
  - Given: smart compact fails because selected lower-band output cannot be produced
  - When: the failure is reported
  - Then: the report identifies the blocking Chunk and band

**AC-5.3:** Logs expose abnormal lower-band generation events.

- **TC-5.3a: Retry and escalation logged**
  - Given: detailed or brief generation retries or escalates
  - When: operational logs are inspected
  - Then: retry and escalation events are visible
- **TC-5.3b: Catch-up generation logged**
  - Given: smart compact performs synchronous catch-up generation
  - When: standard error or operational logs are inspected
  - Then: the event is visible with the affected Chunk and band

**AC-5.4:** Inspection does not become formal quality evaluation.

- **TC-5.4a: No automatic quality grade required**
  - Given: detailed or brief output exists
  - When: lower-band inspection runs
  - Then: the report does not need to assign an automatic quality score
- **TC-5.4b: No model comparison dashboard required**
  - Given: lower-band generation has run
  - When: epic requirements are evaluated
  - Then: model comparison dashboards and formal eval reports are not required for this epic

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story finishes the operator-facing side of Epic 5. By this point, lower-band
state should already exist and smart compact should already refuse fake runtime
fallbacks. The remaining job is to make the state legible through the workbench
and PI command surfaces without drifting into a quality-eval product.

The key design choice is to extend the existing workbench query/search/reporting
surfaces instead of inventing a parallel inspection subsystem. That keeps the
operator truth, the PI command truth, and the draft/projection compact snapshot
truth aligned in one place.

#### Build Strategy

Strategy: `simple-risk-reminders`

Reason:
- this is a metadata/reporting story with a strong conceptual center
- the risk is stale or misleading inspection output rather than deep algorithmic
  complexity
- existing workbench surfaces already exist and need extension, not replacement

Risk Reminders:
- inspection must reflect real semantic lower-band readiness, not old
  placeholder-era summary behavior
- rollout inspection should distinguish generated semantic output from live tail
- no quality scoring or model-comparison creep

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Lower-band readiness inspection | `src/workbench/services/workbench-query-service.ts` |
| Projection/search summary cutover | `src/workbench/services/workbench-search-service.ts` |
| Compact blocker and freshness reporting | `src/workbench/services/compaction-report-service.ts`, `src/workbench/services/compaction-report-formatter.ts` |
| Active generated rollout visibility | `src/workbench/services/active-rollout-inspection-service.ts` |
| Operator entry points | `src/context-steward/pi/pi-extension.ts`, `scripts/inspect-lower-band-status.ts` |

#### Design References

- [tech-design.md §Flow 5: Inspection And Operator Visibility](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:522), lines 522-545
- [tech-design.md §Module Architecture](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:244), lines 271-283
- [tech-design.md §Responsibility Matrix](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:292), lines 307-310
- [tech-design.md §Chunk 7: Inspection, Reporting, And PI Command Surfaces](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:1003), lines 1003-1020
- [test-plan.md §tests/context-workbench/workbench-query-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:254), lines 254-262
- [test-plan.md §tests/workbench/compaction-report-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:264), lines 264-268
- [test-plan.md §tests/workbench/active-rollout-inspection-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:270), lines 270-274
- [test-plan.md §tests/thread/lower-band-compression-service.test.ts and log helpers](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:276), lines 276-280
- [test-plan.md §Non-TC Architecture-Risk Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:295), lines 295-314

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-5.1a`, `TC-5.1b`, `TC-5.2a`, `TC-5.4a`, `TC-5.4b` | `tests/context-workbench/workbench-query-service.test.ts` | transcript readiness, band status, failure summary, and non-evaluative inspection output |
| `TC-5.2b` | `tests/workbench/compaction-report-service.test.ts` | compact blocker output identifies the blocking Chunk and band |
| `TC-5.3a` | `tests/thread/lower-band-compression-service.test.ts` and log helpers | retry and escalation events are visible in operational logs |
| `TC-5.3b` | `tests/workbench/active-rollout-inspection-service.test.ts` | catch-up activity is visible through rollout/inspection surfaces |

#### Non-TC Decided Tests

- `tests/context-workbench/workbench-search-service.test.ts`: search and summary surfaces stop blessing placeholder output as valid lower-band state
- `tests/workbench/workbench-lower-band-service.test.ts`: persisted thread/chunk/workbench path reflects semantic lower-band readiness coherently; rename the legacy `.integration.test.ts` file if this story touches it
- `tests/context-steward/e2e-cli.e2e.test.ts`: real operator command surface can invoke lower-band readiness/failure inspection without a duplicate inspection pathway

#### Technical Notes

- This story should extend the existing workbench surfaces rather than create a
  new standalone inspection service.
- PI extension and local script entry points should delegate to the same
  workbench-owned query/reporting logic.
- “Pending/not ready” language should stay operational and should not drift into
  implied quality judgment.
- The E2E assertion should stay narrow: command reachability plus truthful
  lower-band readiness/failure output. It should not recreate the full smart
  compact lifecycle or evaluate summary quality.

#### Anti-Shim Requirements

- Do not produce inspection output by reading legacy placeholder summaries and
  renaming them as semantic lower-band state.
- Do not add quality scores, model leaderboards, or eval language just because
  the operator wants more visibility.
- Do not fork a second inspection pathway for PI commands if the workbench query
  surface can own the truth.
- Do not make the E2E pass through a command stub that bypasses the workbench
  query/reporting services.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] `workbench-query-service.ts` reports transcript/detailed/brief status per Chunk
- [ ] Failed artifacts show last error code or message
- [ ] Compact blockers identify specific Chunk and band
- [ ] Retry/escalation/catch-up events visible in logs
- [ ] Catch-up events visible in rollout/inspection output
- [ ] No automatic quality score or model comparison produced
- [ ] Narrow E2E proves the operator command surface can reach lower-band inspection output
- [ ] `npm run verify` passes
- [ ] `npm run verify-all` passes with the Story 7 operator command-surface E2E
