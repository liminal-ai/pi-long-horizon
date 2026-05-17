# Story 1: Conversation-Only Turn Projection

### Summary
<!-- Jira: Summary field -->

Closed smooth Turns produce a deterministic conversation-only projection with exact boundary-driving token counts.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands.

**Objective:** After this story, closed Turns with ready smooth components produce a conversation-only lower-band projection: one `>` user block, zero or more `●` assistant blocks, no thinking or tool content, with a proper persisted token count suitable for Chunk boundary decisions. The projection text is stable for the same smooth component state.

**Scope:**

In scope:
- Materialize conversation-only text from smooth components
- Emit `>` for user prompt, `●` for each assistant-visible segment
- Exclude thinking, tool calls, tool results
- Include intermediate assistant-visible output (not only final response)
- User-only Turn projections are valid (assistant output not required)
- Compute and persist exact boundary-driving token count
- Block projection when required smooth components are missing
- Report invalid state for multi-user-prompt Turns
- Smooth catch-up attempts with visible stderr warnings during compact preparation
- Specific compact failure when smooth catch-up fails
- Projection text stability (same smooth state produces same text)

Out of scope:
- Chunk boundary logic changes (Story 2)
- Semantic compression (Story 3)
- Multi-assistant speaker notation beyond `●`

**Dependencies:** Story 0 complete.

**Story type:** Semantic rule

**Governing idea:** Smooth components produce a stable, deterministic conversation-only text with an exact persisted token count.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-1.1:** The steward derives lower-band Turn text from smooth components, not raw canonical message text.

- **TC-1.1a: Smooth source used for user prompt**
  - Given: A closed Turn has a ready smooth user prompt component
  - When: lower-band Turn projection runs
  - Then: the `>` user block is generated from the smooth user prompt component
- **TC-1.1b: Raw text is not used when smooth text differs**
  - Given: A closed Turn has raw user text and a different ready smooth user prompt component
  - When: lower-band Turn projection runs
  - Then: the projected user block uses the smooth component text

**AC-1.2:** The Turn projection preserves conversation-visible user and assistant text in source order.

- **TC-1.2a: User prompt appears before assistant output**
  - Given: A closed Turn has a ready user prompt and assistant-visible output
  - When: lower-band Turn projection runs
  - Then: the projection begins with one `>` user block followed by assistant blocks in source order
- **TC-1.2b: Intermediate assistant output is included**
  - Given: A closed Turn contains assistant-visible progress or reflection text before the final assistant response
  - When: lower-band Turn projection runs
  - Then: that intermediate assistant-visible text appears in the projection
- **TC-1.2c: Speaker marker characters are exact**
  - Given: a closed Turn has a ready user prompt and assistant-visible output
  - When: lower-band Turn projection runs
  - Then: user blocks begin with `>` and assistant-visible blocks begin with `●`

**AC-1.3:** Separate assistant-visible output segments remain separate `●` blocks.

- **TC-1.3a: Multiple assistant outputs produce multiple markers**
  - Given: A closed Turn has multiple assistant-visible output segments
  - When: lower-band Turn projection runs
  - Then: each segment appears as its own `●` block
- **TC-1.3b: No heavy separators are added**
  - Given: A lower-band Turn projection contains multiple assistant blocks
  - When: the projection text is inspected
  - Then: it uses repeated `●` markers rather than separator banners or component metadata

**AC-1.4:** The Turn projection excludes thinking and tool exchange content.

- **TC-1.4a: Thinking is excluded**
  - Given: A closed Turn has thinking components and assistant-visible output
  - When: lower-band Turn projection runs
  - Then: thinking text does not appear in the projection
- **TC-1.4b: Tool calls and tool results are excluded**
  - Given: A closed Turn has tool calls or tool results
  - When: lower-band Turn projection runs
  - Then: tool calls and tool results do not appear in the projection

**AC-1.5:** A user-only Turn projection is valid when no assistant-visible text exists after exclusions.

- **TC-1.5a: User-only Turn is retained**
  - Given: A closed Turn has a ready user prompt and no assistant-visible output after thinking and tool exchange components are excluded
  - When: lower-band Turn projection runs
  - Then: the projection contains the `>` user block and remains eligible for Chunk assembly

**AC-1.6:** A Turn is not lower-band chunkable until required smooth components are ready.

- **TC-1.6a: Missing user prompt component blocks projection**
  - Given: A closed Turn has no ready smooth user prompt component
  - When: lower-band chunking evaluates the Turn
  - Then: the Turn is not eligible for lower-band Chunk assembly
- **TC-1.6b: Missing required assistant component blocks projection**
  - Given: A closed Turn has assistant-visible output that lacks required smooth component state
  - When: lower-band chunking evaluates the Turn
  - Then: the Turn is not eligible for lower-band Chunk assembly
- **TC-1.6c: Catch-up attempts are visible**
  - Given: smart compact reaches a Turn whose required smooth components are not ready
  - When: the system attempts synchronous catch-up generation
  - Then: the catch-up attempts write visible standard-error warnings
- **TC-1.6d: Smooth catch-up failure stops compact**
  - Given: required smooth components cannot be produced after allowed catch-up attempts
  - When: smart compact prepares selected lower-band output
  - Then: smart compact stops with a specific error describing the missing Turn readiness
- **TC-1.6e: Multiple user prompts block projection**
  - Given: a Turn contains multiple user prompts
  - When: lower-band Turn projection evaluates the Turn
  - Then: the Turn is reported as invalid for lower-band projection rather than being flattened into a normal transcript

**AC-1.7:** The conversation-only Turn projection text is stable for the same smooth component state.

- **TC-1.7a: Projection text is retained or reproducible**
  - Given: a Turn has ready smooth components and lower-band projection has run
  - When: the system later needs that Turn's conversation-only projection
  - Then: the same projection text is available from stored state or reproduced deterministically from the same smooth component state
- **TC-1.7b: Same smooth state produces same projection text**
  - Given: the same ready smooth component state is projected more than once
  - When: lower-band Turn projection runs
  - Then: the emitted conversation-only text is identical across runs

**AC-2.2:** Token counts that drive Chunk boundaries are stable proper token counts.

- **TC-2.2a: Boundary count is persisted**
  - Given: A Turn receives a conversation-only projection
  - When: the projection becomes eligible for Chunk assembly
  - Then: the proper token count used for boundary decisions is stored with the derived Turn state
- **TC-2.2b: Runtime estimates are not persisted as boundary counts**
  - Given: compression routing uses `chars / 3.5` estimates
  - When: boundary-driving Turn state is inspected
  - Then: those rough estimates are not stored as the boundary token count
- **TC-2.2c: Boundary count is reproducible**
  - Given: the same conversation-only Turn projection is counted with the same token counting policy
  - When: the proper token count is produced again
  - Then: the count is stable and reproducible for that projection and policy
- **TC-2.2d: Boundary count failure blocks chunking**
  - Given: a conversation-only Turn projection exists but its proper token count cannot be produced
  - When: Chunk assembly evaluates the Turn
  - Then: the Turn is not added to a Chunk and the failure is reported

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is the first real behavior slice in Epic 5. It turns smooth
component state into the lower-band source unit that later Chunk assembly will
consume. The authority stays on the Turn: projection text is derived from
smooth components, persisted with the smooth-derived Turn state, and counted
with an exact boundary-driving token-count record.

The key lifecycle rule is that projection catch-up never compensates for
missing smooth component state. Prepare-mode work must first ensure smooth
components are ready, then build the conversation-only projection from those
components. That keeps source truth, smooth truth, and lower-band truth from
blurring together.

#### Build Strategy

Strategy: `simple-risk-reminders`

Reason:
- the story has one strong governing rule: smooth components deterministically
  produce a projection and exact count
- the main risks are exact marker behavior, stale-writer safety, and fake
  projection generation from raw messages

Risk Reminders:
- prove `>` / `●` output from actual smooth component state, not handcrafted
  strings
- prove projection/state writes survive reopen and stale-writer competition
- keep catch-up order strict: smooth first, projection second

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Projection record shape on Turn state | `src/thread/domain/records.ts` |
| Smooth-derived projection helpers | `src/thread/async-thread/domain/smooth-turn-state.ts`, `src/thread/async-thread/services/smooth-turn-service.ts` |
| Projection materialization and persistence | `src/thread/async-thread/services/lower-band-turn-projection-service.ts` |
| Prepare-mode readiness / smooth catch-up integration | `src/thread/async-thread/services/async-thread-run-service.ts` |
| Exact boundary-driving token count | `src/token-accounting/token-count-metadata.ts`, `src/token-accounting/openai-input-token-counter.ts` |

#### Design References

- [tech-design.md §Flow 1: Conversation-Only Turn Projection](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:347), lines 347-387
- [tech-design.md §Turn Projection Types](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:576), lines 576-601
- [tech-design.md §Lower-Band Turn Projection Service](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:671), lines 671-695
- [tech-design.md §Chunk 1: Conversation-Only Turn Projection](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:896), lines 896-912
- [test-plan.md §tests/thread/lower-band-turn-projection-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:156), lines 156-178
- [test-plan.md §tests/thread/async-thread-run-service.test.ts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:232), lines 232-243
- [test-plan.md §Non-TC Architecture-Risk Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:295), lines 295-314

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-1.1a`, `TC-1.1b` | `tests/thread/lower-band-turn-projection-service.test.ts` | smooth component text is the projection source instead of raw message text |
| `TC-1.2a`, `TC-1.2b`, `TC-1.2c` | `tests/thread/lower-band-turn-projection-service.test.ts` | user and assistant-visible segments appear in order with exact marker characters |
| `TC-1.3a`, `TC-1.3b` | `tests/thread/lower-band-turn-projection-service.test.ts` | multiple assistant-visible segments stay as separate `●` blocks without heavy separators |
| `TC-1.4a`, `TC-1.4b` | `tests/thread/lower-band-turn-projection-service.test.ts` | thinking and tool exchange content are absent from the projection |
| `TC-1.5a` | `tests/thread/lower-band-turn-projection-service.test.ts` | user-only Turns remain valid projection input |
| `TC-1.6a`, `TC-1.6b`, `TC-1.6e` | `tests/thread/lower-band-turn-projection-service.test.ts` | missing required smooth state blocks projection and multi-user Turns are invalid |
| `TC-1.6c`, `TC-1.6d` | `tests/thread/async-thread-run-service.test.ts` | smooth catch-up is visible and compact stops when required smooth state cannot be repaired |
| `TC-1.7a`, `TC-1.7b` | `tests/thread/lower-band-turn-projection-service.test.ts` | the same smooth state produces the same projection text across reopen/rematerialize paths |
| `TC-2.2a`, `TC-2.2b`, `TC-2.2c`, `TC-2.2d` | `tests/thread/lower-band-turn-projection-service.test.ts` | exact boundary count is persisted, reproducible, and blocks chunking when unavailable |

#### Non-TC Decided Tests

- `tests/thread/lower-band-turn-projection-service.test.ts`: stale writer cannot clobber fresher projection state
- real temp store reopen check to prove projection text and `tokenCountMetadata` survive persistence boundaries

#### Technical Notes

- Store projection state nested on `TurnSmoothRecord`; do not create a parallel
  top-level record family for lower-band projections.
- `pending` is the persisted equivalent of the epic’s broader “not ready”
  language and should be used consistently in the record shape.
- The projection service should reuse existing smooth component ordering and
  source fingerprint logic rather than walking parts/messages a second way.

#### Anti-Shim Requirements

- Do not materialize projection text from raw canonical messages when smooth
  components are present.
- Do not prove marker behavior by testing helper-returned strings detached from
  persisted Turn state.
- Do not fake exact count behavior with `chars / 3.5`; this story owns the
  durable boundary-driving count path.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] `lower-band-turn-projection-service.ts` materializes conversation-only text from smooth components
- [ ] `>` and `●` markers emitted exactly
- [ ] Multi-user-prompt Turns reported as invalid
- [ ] User-only projections are valid
- [ ] Exact token count persisted under `turn_lower_band_projection_materialized` scope
- [ ] Same smooth state produces identical projection text and count
- [ ] Smooth catch-up visible on stderr during compact preparation
- [ ] Catch-up failure stops compact with specific error
- [ ] `npm run verify` passes
- [ ] Architecture-risk test: stale writer cannot clobber fresh projection state
