# Story 2: Deterministic Chunk Lifecycle

### Summary
<!-- Jira: Summary field -->

One open Chunk per Thread, chunk eligibility from deterministic readiness rules over closed smooth Turns, deterministic chunk growth, and deterministic chunk closure.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Objective**

Deliver deterministic chunk formation. Closed smooth Turns become chunk-eligible through deterministic readiness rules. Eligible Turns join the one open Chunk in source order. The open Chunk closes by deterministic smooth-token-count threshold rules. Closed Chunks remain stable. Chunk state is inspectable.

**Scope**

In scope:
- Chunk eligibility: closed + smoothed Turn is eligible; open or unsmoothed is not
- One open Chunk per Thread invariant
- Append eligible Turns to open Chunk in source order
- Deterministic chunk closure by smooth-token-count threshold rules (min, soft max, hard max)
- Close reason recording
- Inspectable chunk state (open/closed, token size)

Out of scope:
- Model-assisted chunk boundary adjudication (Feature 4)
- Placeholder lower-fidelity representations (Story 3)
- Higher-order chunk merging (future)

**Dependencies**

- Story 1 (deterministic smooth-turn output)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-2.1:** A closed smooth Turn becomes chunk-eligible through deterministic readiness rules before lower-band allocation uses closed Chunks.

- **TC-2.1a: Open or unsmoothed Turn is not chunk-eligible**
  - Given: A Turn is still open or lacks current smooth output
  - When: chunk eligibility is evaluated
  - Then: the Turn is not chunk-eligible
- **TC-2.1b: Closed smoothed Turn becomes chunk-eligible**
  - Given: A Turn is closed and has current smooth output
  - When: chunk eligibility is evaluated
  - Then: the Turn becomes chunk-eligible

**AC-2.2:** The steward maintains exactly one open Chunk per Thread.

- **TC-2.2a: One open Chunk exists during normal operation**
  - Given: A Thread is under deterministic chunk maintenance
  - When: chunk state is inspected
  - Then: exactly one Chunk is open
- **TC-2.2b: Closed Chunks remain closed**
  - Given: A Chunk has been closed
  - When: later chunk maintenance runs
  - Then: new Turns are not appended to that Chunk

**AC-2.3:** The steward appends chunk-eligible smooth Turns to the open Chunk in source order.

- **TC-2.3a: Eligible Turn joins open Chunk**
  - Given: A smooth Turn is chunk-eligible and an open Chunk exists
  - When: chunk update runs
  - Then: the Turn is appended to the open Chunk
- **TC-2.3b: Chunk order follows Turn order**
  - Given: Multiple smooth Turns become chunk-eligible
  - When: they are appended to the open Chunk
  - Then: their order inside the Chunk follows canonical Turn order

**AC-2.4:** The steward closes the open Chunk by deterministic smooth-token-count threshold rules rather than model judgment.

- **TC-2.4a: Open Chunk stays open below close threshold**
  - Given: The open Chunk remains below its deterministic close conditions
  - When: chunk closure is evaluated
  - Then: the Chunk remains open
- **TC-2.4b: Open Chunk closes when deterministic close condition is met**
  - Given: The open Chunk reaches its deterministic close condition
  - When: chunk closure is evaluated
  - Then: the Chunk closes and a new open Chunk is created
- **TC-2.4c: Hard-cap closure is explicit**
  - Given: The open Chunk reaches a deterministic hard maximum even without a cleaner earlier stop
  - When: chunk closure is evaluated
  - Then: the Chunk closes because the hard-cap rule was met

**AC-2.5:** Chunk closure state is inspectable and stable.

- **TC-2.5a: Closed Chunk reports closed state and token size**
  - Given: A Chunk has closed
  - When: chunk detail is inspected
  - Then: the Chunk reports closed state and its smooth-token size
- **TC-2.5b: Open Chunk reports current partial state**
  - Given: The current Chunk is still open
  - When: chunk detail is inspected
  - Then: the Chunk reports open state and its current smooth-token size

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story owns the first real lifecycle state machine in Feature 3. It is the
place where closed smooth Turns stop being isolated artifacts and start becoming
ordered chunk state. The key architectural move is that chunk formation happens
upstream of Thread View rebuild. It is not waiting on band allocation to tell it
what a chunk is.

The implementation lives under `thread/async-thread` and should stay there.
Chunk lifecycle is derived Thread state. It does not yet build lower-band
representations, and it does not know anything about PI-target output. It only
decides which Turns are eligible, how they join the open Chunk, and when the
open Chunk closes.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Chunk lifecycle types | `src/thread/async-thread/domain/chunk-state.ts` |
| Chunk settings | `src/thread/async-thread/domain/settings.ts` |
| Chunk lifecycle service | `src/thread/async-thread/services/chunk-service.ts` |
| Supporting smooth reads | `src/thread/async-thread/services/smooth-turn-service.ts`, `src/thread/store/thread-store.ts` |

#### Design References

- [tech-design-thread.md §Sequence: Flow 2 Deterministic Chunk Formation](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:176), lines 176-225
- [tech-design-thread.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:286), lines 286-341
- [test-plan.md §`tests/thread/chunk-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:123), lines 123-137

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-2.1a | `tests/thread/chunk-service.test.ts` | open or unsmoothed turn is not eligible |
| TC-2.1b | `tests/thread/chunk-service.test.ts` | closed smoothed turn becomes eligible |
| TC-2.2a | `tests/thread/chunk-service.test.ts` | exactly one open chunk exists |
| TC-2.2b | `tests/thread/chunk-service.test.ts` | closed chunk remains closed |
| TC-2.3a | `tests/thread/chunk-service.test.ts` | eligible turn joins open chunk |
| TC-2.3b | `tests/thread/chunk-service.test.ts` | chunk order follows turn order |
| TC-2.4a | `tests/thread/chunk-service.test.ts` | chunk stays open below threshold |
| TC-2.4b | `tests/thread/chunk-service.test.ts` | chunk closes on soft threshold condition |
| TC-2.4c | `tests/thread/chunk-service.test.ts` | hard-cap closure is explicit |
| TC-2.5a | `tests/thread/chunk-service.test.ts` | closed chunk reports closed state and token size |
| TC-2.5b | `tests/thread/chunk-service.test.ts` | open chunk reports partial state |

#### Non-TC Decided Tests

- `tests/thread/chunk-service.test.ts`: hard-max closure creates the next open chunk in the same update pass

#### Technical Notes

Chunk eligibility is based on deterministic readiness rules over source Thread
state, not on Thread View band membership. That avoids the circular dependency
between “chunk formation needs band allocation” and “band allocation needs
chunks” that the epic intentionally removed.

Chunk-close thresholds are tunable settings, not hard-coded architecture truths.
The service should consume settings values, validate them, and record the close
reason explicitly when closure happens.

#### Anti-Shim Requirements

- Prove chunk eligibility from real closed-turn + smooth-state conditions, not from a fake “eligible” flag in fixtures.
- Prove one-open-chunk behavior across successive updates, not just in a single isolated append call.

#### Verification

- Targeted: `node --import tsx --test tests/thread/chunk-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 11 TCs pass (TC-2.1a through TC-2.5b)
- [ ] Chunk state persists in chunks.json and survives process restart
- [ ] `npm run verify` passes
