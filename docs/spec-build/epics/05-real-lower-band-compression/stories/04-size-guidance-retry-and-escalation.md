# Story 4: Size Guidance, Retry, And Escalation

### Summary
<!-- Jira: Summary field -->

Detailed and brief outputs follow band-specific size guidance, retry with attempt history, escalate on the third attempt, and keep source-truth artifact records lean.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands.

**Objective:** After this story, lower-band generation checks output size against band-specific target ranges, retries with contextual feedback when output falls outside the range, escalates to GPT-5.5 medium on the third attempt and accepts its first response, and keeps source-truth artifact records lean (no model selection, routing estimates, or retry history stored on artifacts).

**Scope:**

In scope:
- Detailed output size check: 15% to 50% of conversation-only transcript estimate
- Brief output size check: 1% to 20% of conversation-only transcript estimate
- Retry with previous attempt, target range, and size feedback in context
- Attempts 1 and 2 use routed lane
- Attempt 3 escalates to GPT-5.5 medium and accepts first response regardless of size
- Lean artifact storage: ready stores final text only; failed stores minimal error state
- Operational logs carry routing, retry, and escalation details

Out of scope:
- Adjusting provisional routing thresholds (future calibration)
- Formal eval or quality scoring
- Persisting model/prompt/ratio metadata on artifact records

**Dependencies:** Story 3 complete.

**Story type:** Semantic rule

**Governing idea:** Size-guided retry produces appropriately-compressed output without storing attempt history in source truth.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-3.4:** Detailed output follows strong size guidance with deterministic range checks.

- **TC-3.4a: Detailed target range checked**
  - Given: detailed generation returns output for a Chunk transcript
  - When: output size is estimated
  - Then: the system checks whether the output is within 15% to 50% of the conversation-only transcript estimate
- **TC-3.4b: Detailed miss retries with size feedback**
  - Given: detailed output falls outside the allowed range on attempt 1
  - When: the retry runs
  - Then: the retry context includes the previous attempt, the target range, and where the previous attempt landed

**AC-3.5:** Brief output follows strong size guidance with deterministic range checks.

- **TC-3.5a: Brief target range checked**
  - Given: brief generation returns output for a Chunk transcript
  - When: output size is estimated
  - Then: the system checks whether the output is within 1% to 20% of the conversation-only transcript estimate
- **TC-3.5b: Brief miss retries with size feedback**
  - Given: brief output falls outside the allowed range on attempt 1
  - When: the retry runs
  - Then: the retry context includes the previous attempt, the target range, and where the previous attempt landed

**AC-3.6:** The third size retry escalates and accepts the first escalated response.

- **TC-3.6a: First two attempts use routed lane**
  - Given: an output remains outside range after attempt 1
  - When: attempt 2 runs
  - Then: attempt 2 uses the routed compression lane
- **TC-3.6b: Third attempt escalates**
  - Given: attempts 1 and 2 are outside the allowed range
  - When: attempt 3 runs
  - Then: the request escalates to GPT-5.5 medium
- **TC-3.6c: Escalated response accepted**
  - Given: attempt 3 returns output
  - When: the output size is outside the nominal range
  - Then: the first escalated response is accepted as the generated output

**AC-3.7:** Source-truth lower-band artifacts stay lean.

- **TC-3.7a: Ready artifact stores final text**
  - Given: detailed or brief generation succeeds
  - When: the lower-band artifact is stored
  - Then: the record contains the final text and ready status
- **TC-3.7b: Failed artifact stores minimal error state**
  - Given: detailed or brief generation fails after allowed attempts
  - When: the lower-band artifact state is stored
  - Then: the record contains failed status and a last error code or message
- **TC-3.7c: Logs carry generation details**
  - Given: routing, retry, or escalation occurs during lower-band generation
  - When: operational logs are inspected
  - Then: the logs contain those details, while source-truth artifact state does not store model selection, prompt version, routing estimate, compression ratio, or retry history

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story deepens the lower-band compression runtime policy without changing
the source chain established by Stories 1 through 3. The Chunk transcript is
already the source and the GPT OAuth provider path already exists. This slice
adds size guidance, deterministic retry behavior, escalation on the third
attempt, and the builder-side rule that token accounting comes from the
persisted semantic artifact text rather than any transient routing estimate.

The main risk is superficial success: it is easy to return “some text,” mark it
ready, and skip the size-policy loop or leak retry metadata into source truth.
The enrichment here should make that kind of shortcut harder.

#### Build Strategy

Strategy: `tdd-lite`

Reason:
- the architecture is already established by Story 3
- the behavioral contract is narrow but easy to fake with weak assertions
- the story’s main hazards are policy drift and metadata bloat, not a new
  subsystem

Risk Reminders:
- verify attempts 1/2/3 behavior separately
- prove retry context contains previous output and range data
- prove builder accounting uses persisted semantic artifact text, not runtime
  estimate leftovers

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Retry and escalation policy | `src/thread/async-thread/services/lower-band-compression-service.ts` |
| Provider retry context shape | `src/thread/async-thread/services/pi-codex-lower-band-compression-provider.ts` |
| Builder-side semantic artifact accounting | `src/thread-view/services/thread-view-builder.ts` |
| Semantic artifact token counters | `src/token-accounting/materialized-representation-counter.ts`, `src/token-accounting/openai-input-token-counter.ts` |

#### Design References

- [tech-design.md §Flow 3: Async Detailed / Brief Generation](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:431), lines 431-481
- [tech-design.md §Lower-Band Compression Service](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:738), lines 738-764
- [tech-design.md §Thread View Builder Lower-Band Accounting](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:766), lines 766-787
- [tech-design.md §Chunk 4: Retry, Escalation, And On-Demand Accounting](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:951), lines 951-966
- [test-plan.md §tests/thread/lower-band-compression-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:197), lines 197-221
- [test-plan.md §Non-TC Architecture-Risk Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:295), lines 295-314

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-3.4a`, `TC-3.4b` | `tests/thread/lower-band-compression-service.test.ts` | detailed output is checked against its range and retries with explicit size feedback |
| `TC-3.5a`, `TC-3.5b` | `tests/thread/lower-band-compression-service.test.ts` | brief output is checked against its range and retries with explicit size feedback |
| `TC-3.6a`, `TC-3.6b`, `TC-3.6c` | `tests/thread/lower-band-compression-service.test.ts` | attempts 1 and 2 stay on the routed lane, attempt 3 escalates, and the escalated response is accepted |
| `TC-3.7a`, `TC-3.7b`, `TC-3.7c` | `tests/thread/lower-band-compression-service.test.ts` | artifact records stay lean while logs retain retry/escalation detail |

#### Non-TC Decided Tests

- `tests/token-accounting/materialized-representation-counter.test.ts`: semantic counters read `chunk.lowerBand.*.text` instead of placeholder text
- `tests/token-accounting/openai-input-token-counter.test.ts`: exact/provider-input counting follows the new semantic artifact path

#### Technical Notes

- This story owns retry/escalation policy and lean artifact persistence, but it
  should not re-open Story 3’s questions about provider integration or Story 5’s
  readiness/catch-up behavior.
- The retry context is part of provider input, not part of persisted Chunk
  state.
- Builder accounting should be refreshed from the stored semantic artifact text
  at prepare/build time and not written back to the artifact record.

#### Anti-Shim Requirements

- Do not satisfy this story by hardcoding “attempt 3 escalates” without proving
  attempts 1 and 2 stay on the routed lane.
- Do not persist prompt version, model, ratio, retry history, or route estimate
  onto the artifact record to make debugging easier.
- Do not count semantic outputs from cached placeholder fields or from transient
  request payloads; use the persisted semantic artifact text.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Detailed output checked against 15%-50% range
- [ ] Brief output checked against 1%-20% range
- [ ] Retry context includes previous attempt, range, and landing point
- [ ] Attempts 1-2 use routed lane; attempt 3 escalates to GPT-5.5 medium
- [ ] Escalated response accepted regardless of size
- [ ] Artifact records store only status + text + error + updatedAt
- [ ] Logs carry retry/escalation/routing details
- [ ] Estimated size math never persists into source-truth artifacts
- [ ] `npm run verify` passes
