# Story 1: Deterministic Smooth Turns

### Summary
<!-- Jira: Summary field -->

Closed Turns receive deterministic smooth output with readiness, token counts, and repairable missing/stale state.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Objective**

Deliver deterministic smooth-turn generation for closed Turns. Each closed Turn receives one smooth text representation that concatenates its content into a single readable field with fixed section markers for user, assistant, tool, and thinking content. Whitespace is normalized deterministically. Tool output is truncated or removed by fixed policy. Missing or stale smooth output is reported explicitly and repairable through the same deterministic path.

**Scope**

In scope:
- One deterministic smooth text field per closed Turn
- Fixed section markers preserving actor back-and-forth
- Deterministic whitespace normalization
- Deterministic tool-output truncation/removal policy
- Smooth token count recording
- Smooth readiness state (missing, ready, stale, invalid)
- Smooth strategy recording
- Missing/stale smooth output visibility and repair

Out of scope:
- Model-assisted smoothing (Feature 4)
- Chunk formation (Story 2)
- Open Turn smoothing

**Dependencies**

- Story 0 (domain types, fixtures, error codes)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-1.1:** The steward generates one deterministic smooth representation for each closed Turn.

- **TC-1.1a: Closed Turn receives smooth text**
  - Given: A Turn is closed and has no current smooth output
  - When: deterministic smoothing runs
  - Then: the Turn receives one smooth text representation and a smooth token count
- **TC-1.1b: Open Turn does not receive final smooth text**
  - Given: A Turn is still open
  - When: deterministic smoothing is evaluated
  - Then: the Turn is not marked as having final smooth output

**AC-1.2:** Deterministic smooth output preserves enough structure to remain readable and useful for later chunking.

- **TC-1.2a: Smooth text preserves actor sections**
  - Given: A closed Turn contains content from multiple actor types
  - When: deterministic smoothing runs
  - Then: the smooth text preserves the actor back-and-forth in a standardized readable form using fixed section markers for user, assistant, tool, and thinking content
- **TC-1.2b: Smooth text remains one single text field per Turn**
  - Given: A closed Turn contains multiple source Messages
  - When: deterministic smoothing runs
  - Then: the output is one smooth text field for the Turn rather than multiple separate emitted records

**AC-1.3:** Deterministic smoothing applies only fixed normalization and fixed tool-output rules.

- **TC-1.3a: Whitespace normalization is deterministic**
  - Given: A closed Turn contains irregular whitespace
  - When: deterministic smoothing runs
  - Then: the resulting smooth text applies the same fixed normalization rule each time
- **TC-1.3b: Tool-output handling follows fixed policy**
  - Given: A closed Turn contains tool output large enough to trigger smoothing policy
  - When: deterministic smoothing runs
  - Then: tool output is truncated or removed according to fixed deterministic policy rather than model judgment

**AC-1.4:** Missing, stale, or invalid smooth output is visible and repairable.

- **TC-1.4a: Missing smooth output is explicit**
  - Given: A closed Turn lacks smooth output
  - When: the steward inspects smooth readiness or later work depends on that Turn
  - Then: the missing smooth state is reported explicitly
- **TC-1.4b: Stale or invalid smooth output can be regenerated**
  - Given: A closed Turn has stale or invalid smooth output
  - When: deterministic smooth repair runs
  - Then: the smooth output is regenerated through the same deterministic path

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the first real derived-state step in Feature 3. It turns a closed
Turn into a deterministic smooth artifact that later stories can consume
without needing a model. Everything downstream assumes this story is solid:
chunking depends on smooth readiness, rebuild depends on smooth token counts,
and compact preflight depends on missing or stale smooth state being explicit.

This story lives entirely under `thread/async-thread`. It should not know about
Thread View composition or PI-target output. Its job is simpler and narrower:
read a closed canonical Turn, build one smooth text field in a fixed marker
format, write deterministic state back to the Thread, and support repair when
that state is missing or invalid.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Smooth-turn state types | `src/thread/async-thread/domain/smooth-turn-state.ts` |
| Smooth-turn service | `src/thread/async-thread/services/smooth-turn-service.ts` |
| Smooth formatting helper | `src/thread/async-thread/services/smooth-turn-format.ts` or equivalent helper near the service |
| Supporting source reads | `src/thread/store/thread-store.ts`, `src/thread/services/turn-service.ts` |

#### Design References

- [tech-design-thread.md §Sequence: Flow 1 Smooth Turn Preparation](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:132), lines 132-174
- [tech-design-thread.md §Interface Definitions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/tech-design-thread.md:286), lines 286-325
- [test-plan.md §`tests/thread/smooth-turn-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics/test-plan.md:110), lines 110-121

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-1.1a | `tests/thread/smooth-turn-service.test.ts` | closed turn receives smooth text |
| TC-1.1b | `tests/thread/smooth-turn-service.test.ts` | open turn does not receive final smooth text |
| TC-1.2a | `tests/thread/smooth-turn-service.test.ts` | smooth text preserves fixed actor section markers |
| TC-1.2b | `tests/thread/smooth-turn-service.test.ts` | one smooth text field per turn |
| TC-1.3a | `tests/thread/smooth-turn-service.test.ts` | whitespace normalization is deterministic |
| TC-1.3b | `tests/thread/smooth-turn-service.test.ts` | tool-output handling follows fixed policy |
| TC-1.4a | `tests/thread/smooth-turn-service.test.ts` | missing smooth output is explicit |
| TC-1.4b | `tests/thread/smooth-turn-service.test.ts` | stale or invalid smooth output can be regenerated |

#### Non-TC Decided Tests

- `tests/thread/smooth-turn-service.test.ts`: empty or noise-only sections are omitted without collapsing section order incorrectly

#### Technical Notes

The output format is not free-form. It must preserve fixed section markers for
user, assistant, tool, and thinking content, because later chunking and manual
inspection depend on that structure remaining recognizable.

Smooth state persists on Turn records rather than in a separate smooth-only
store. That keeps deterministic derived Thread state close to the Turn it was
derived from and makes restart behavior easier to reason about.

#### Anti-Shim Requirements

- Prove marker format and ordering against real Turn/Message/Part records, not a pre-baked joined string.
- Prove tool-output truncation/removal against realistic oversized tool content, not a fake boolean flag path.

#### Verification

- Targeted: `node --import tsx --test tests/thread/smooth-turn-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 8 TCs pass (TC-1.1a through TC-1.4b)
- [ ] Smooth state persists on Turn records and survives process restart
- [ ] `npm run verify` passes
