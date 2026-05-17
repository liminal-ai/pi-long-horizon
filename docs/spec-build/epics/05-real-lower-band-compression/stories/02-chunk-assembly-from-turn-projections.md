# Story 2: Chunk Assembly From Turn Projections

### Summary
<!-- Jira: Summary field -->

Chunks use conversation-only Turn projection token counts for boundary decisions, assemble conversation-only transcripts, and block legacy placeholder-era state.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands.

**Objective:** After this story, Chunk membership decisions use the exact token count from the conversation-only Turn projection instead of full smooth text counts. Each Chunk assembles a conversation-only transcript from its Turn projections. Smooth text remains a separate representation. Existing closed Chunk membership is not silently rewritten. Legacy placeholder-era Chunk state is blocked from lower-band selection.

**Scope:**

In scope:
- Chunk boundary threshold evaluation uses projection token counts
- Conversation-only Chunk transcript assembled from Turn projections in Chunk order
- Smooth text remains available as a separate representation
- Detailed and brief share the same conversation-only Chunk transcript (brief is not derived from detailed)
- Closed Chunk membership not silently mutated
- Legacy/placeholder-era Chunk state blocked and distinguishable from new state
- `schemaVersion = "conversation_only_chunk_v1"` on new Chunk records

Out of scope:
- Semantic model judgment for Chunk boundaries (future)
- Separate Chunk groupings for detailed and brief
- Replacement of smooth text with the conversation-only transcript
- Polished migration of existing placeholder Chunk state
- Semantic compression of Chunk transcripts (Story 3)

**Dependencies:** Story 1 complete.

**Story type:** Adapter / mapping

**Governing idea:** Chunks group Turns using the count authority that matches the representation lower-band compression will consume.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-2.1:** Chunk boundary decisions use proper token counts from the conversation-only Turn projection.

- **TC-2.1a: Conversation-only count drives append decision**
  - Given: A current Chunk and a next Turn with a ready conversation-only projection
  - When: the steward evaluates whether to append the Turn
  - Then: the decision uses the proper token count for the Turn projection
- **TC-2.1b: Full smooth text count does not drive lower-band boundary**
  - Given: A tool-heavy Turn has large smooth text and small conversation-only projection text
  - When: Chunk assembly evaluates the Turn
  - Then: the boundary decision is based on the conversation-only projection count

**AC-2.3:** The conversation-only Chunk transcript is assembled from the Turn projections in that Chunk.

- **TC-2.3a: Chunk transcript preserves Turn order**
  - Given: A Chunk contains multiple Turns with ready conversation-only projections
  - When: the Chunk transcript is assembled
  - Then: the transcript concatenates those Turn projections in Chunk order
- **TC-2.3b: Chunk transcript excludes tool and thinking content**
  - Given: Turns in the Chunk contain thinking and tool exchange components
  - When: the Chunk transcript is assembled
  - Then: thinking, tool calls, and tool results remain absent
- **TC-2.3c: User-only Chunk transcript is valid**
  - Given: every Turn projection in a Chunk contains a user block and no assistant-visible blocks
  - When: the Chunk transcript is assembled
  - Then: the transcript remains valid lower-band compression input

**AC-2.4:** Detailed and brief use the same conversation-only Chunk transcript as source.

- **TC-2.4a: Shared source transcript**
  - Given: A closed Chunk is ready for lower-band generation
  - When: detailed and brief generation run
  - Then: both outputs are generated from the same conversation-only Chunk transcript
- **TC-2.4b: Brief is not generated from detailed**
  - Given: detailed output exists for a Chunk
  - When: brief generation runs
  - Then: brief uses the conversation-only Chunk transcript rather than the detailed output

**AC-2.5:** The conversation-only Chunk transcript does not replace smooth text.

- **TC-2.5a: Smooth representation remains available**
  - Given: A Chunk has a conversation-only transcript
  - When: smooth-band materialization needs smooth text
  - Then: smooth text remains available as its own representation
- **TC-2.5b: Lower-band source remains separate**
  - Given: A Chunk has both smooth text and conversation-only transcript state
  - When: lower-band generation runs
  - Then: it uses the conversation-only transcript rather than smooth text

**AC-2.6:** Existing closed Chunk membership is not silently rewritten under the new lower-band basis.

- **TC-2.6a: Closed Chunk membership is not mutated in place**
  - Given: a closed Chunk already contains a set of Turns
  - When: lower-band Chunk assembly or repair evaluates new boundary rules
  - Then: the closed Chunk's Turn list is not silently edited in place
- **TC-2.6b: Old placeholder Chunk state is not selectable**
  - Given: a Thread contains Chunks created under the old placeholder lower-band path
  - When: smart compact selects lower-band material after this epic
  - Then: those Chunks are not selectable as real lower-band output until they have been cleared, rebuilt, or explicitly superseded by the new path
- **TC-2.6c: Rebuild or supersession is explicit**
  - Given: existing Chunk state must be replaced to use conversation-only boundary counts
  - When: the replacement occurs
  - Then: the operator can distinguish the new lower-band-ready Chunk state from old placeholder-era state

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story changes the authority that decides Chunk membership without creating
“lower-band chunks” as a second memory object. Chunks still contain Turns. The
change is that Chunk assembly reads the persisted conversation-only Turn
projection count instead of the smooth-turn count, and it persists a second
derived Chunk representation: the conversation-only transcript.

This story also owns the first explicit legacy boundary in Epic 5. Current
placeholder-era Chunk state remains present in the repo and current sessions,
but this story makes it distinguishable and blocks it from being treated as real
lower-band source material. That is why this slice is more than a simple field
addition.

#### Build Strategy

Strategy: `full-staged-risk`

Reason:
- exact threshold decisions are easy to mis-implement and easy to fake with
  mirrored tests
- the story touches persisted lifecycle state and legacy blocking rules
- the current code already refreshes closed Chunk smooth text in place, so the
  implementation needs to be deliberate about what changes and what stops

Risk Reminders:
- preserve one Chunk concept while changing the count authority
- prove closed `sourceTurnIds` stability separately from transcript refresh
- keep legacy detection and current-schema pending/not-ready behavior distinct

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Chunk lifecycle and count authority | `src/thread/async-thread/services/chunk-service.ts` |
| Chunk record shape | `src/thread/async-thread/domain/chunk-state.ts`, `src/thread/async-thread/domain/lower-band-artifact-state.ts` |
| Projection count consumption | `src/thread/async-thread/services/lower-band-turn-projection-service.ts` |
| Legacy blocking and runtime selection compatibility | `src/thread-view/services/thread-view-builder.ts`, `src/thread/async-thread/services/async-thread-run-service.ts` |

#### Design References

- [tech-design.md §Flow 2: Lower-Band-Native Chunk Assembly](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:389), lines 389-429
- [tech-design.md §Chunk State Extension](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:633), lines 633-669
- [tech-design.md §Placeholder Cutover Inventory](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:313), lines 313-343
- [tech-design.md §Chunk 2: Lower-Band-Native Chunk Assembly](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:913), lines 913-930
- [test-plan.md §tests/thread/chunk-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:180), lines 180-195
- [test-plan.md §Non-TC Architecture-Risk Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:295), lines 295-314

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-2.1a`, `TC-2.1b` | `tests/thread/chunk-service.test.ts` | chunk append/close decisions use projection counts instead of smooth-turn counts |
| `TC-2.3a`, `TC-2.3b`, `TC-2.3c` | `tests/thread/chunk-service.test.ts` | transcript persists Turn order, remains conversation-only, and allows user-only chunks |
| `TC-2.4a`, `TC-2.4b` | `tests/thread/chunk-service.test.ts` | detailed and brief share transcript source and brief does not derive from detailed |
| `TC-2.5a`, `TC-2.5b` | `tests/thread/chunk-service.test.ts` | smooth text remains separate from conversation-only transcript state |
| `TC-2.6a`, `TC-2.6b`, `TC-2.6c` | `tests/thread/chunk-service.test.ts` | closed membership is stable, legacy placeholder state is blocked, and replacement is explicit |

#### Non-TC Decided Tests

- `tests/thread/chunk-service.test.ts`: exact threshold golden cases for min / soft max / hard max decisions
- `tests/thread/chunk-service.test.ts`, `tests/thread/async-thread-run-service.test.ts`: later stories consume real projection/transcript state rather than fake eligibility flags
- reopen/restart survival for transcript and schema-versioned Chunk state

#### Technical Notes

- The threshold settings stay where they are; only the count authority changes.
  That means code should be conservative about algorithm drift.
- A current-schema Chunk missing `conversationTranscript` is pending/not-ready,
  not automatically legacy. Legacy blocking depends on schema/version and
  placeholder-era fields.
- The current code’s closed-Chunk smooth refresh behavior is part of the
  implementation context for this story and should be handled explicitly, not by
  accident.

#### Anti-Shim Requirements

- Do not satisfy this story by copying smooth-text counts into a new field while
  leaving boundary decisions effectively unchanged.
- Do not prove closed-Chunk immutability only by checking text fields; assert
  `sourceTurnIds` stability directly.
- Do not fake transcript assembly with prebuilt fixture strings that bypass real
  Turn projection state.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] Chunk boundary decisions use `lowerBandProjection.tokenCountMetadata`, not `smooth.tokenCountMetadata`
- [ ] Conversation-only Chunk transcript assembled and persisted on Chunk state
- [ ] Smooth text still materialized separately
- [ ] Closed Chunk membership not silently rewritten in normal maintenance
- [ ] Legacy/placeholder-era Chunks blocked from lower-band selection
- [ ] New Chunks written with `schemaVersion = "conversation_only_chunk_v1"`
- [ ] `npm run verify` passes
- [ ] Architecture-risk tests: exact threshold golden cases, legacy state blocked, reopen/restart survival
