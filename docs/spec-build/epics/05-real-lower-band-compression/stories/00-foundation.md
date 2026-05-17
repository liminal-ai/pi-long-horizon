# Story 0: Foundation And Verification Gates

### Summary
<!-- Jira: Summary field -->

Establish shared lower-band record shapes, test fixtures, verification command truth, and the long-thread prep tier plan for Epic 5.

### Description
<!-- Jira: Description field -->

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active Thread View must retain useful long-range context after smart compact moves older conversation into detailed and brief bands.

**Objective:** Deliver the shared vocabulary, fixture contracts, and verification rails that all later stories depend on. After this story, the repo has the record types for conversation-only Turn projections and semantic lower-band Chunk artifacts, test fixture builders for those types, and an explicit plan for how real provider-backed non-E2E tests and deeper E2E/lifecycle tests fit into the existing runner model without reintroducing a separate integration layer.

**Scope:**

In scope:
- `TurnLowerBandProjectionRecord` type on `TurnSmoothRecord`
- `ChunkConversationTranscriptRecord` and `ChunkSemanticArtifactRecord` types
- `ChunkState` extension with `schemaVersion`, `conversationTranscript`, and `lowerBand`
- Token-count scope `turn_lower_band_projection_materialized`
- Fixture builders: `makeTurnLowerBandProjection()`, `makeChunkState()` (new schema), `makeLegacyPlaceholderChunkState()`, `makeChunkLowerBandArtifacts()`
- Foundation tests validating fixture lifecycle validity
- Document and plan the long-thread prep test decomposition across service-tier and E2E coverage

Out of scope:
- Projection materialization logic (Story 1)
- Chunk assembly changes (Story 2)
- Provider integration (Story 3)
- Placeholder removal (Story 6)

**Dependencies:** Epic accepted. Epic 4 smooth component work landed.

**Story type:** Foundation

**Governing idea:** Record shapes, fixtures, and verification gates exist before any feature behavior is built.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-6.1:** Service-mock tests cover acceptance-level pathways.

- **TC-6.1a: Service-mock tests enter through meaningful surfaces**
  - Given: a story implements lower-band behavior
  - When: its fast tests run
  - Then: they exercise service or command surfaces rather than only isolated helper functions
- **TC-6.1b: Service-mock tests mock only external calls where practical**
  - Given: lower-band generation depends on GPT OAuth inference
  - When: service-mock tests run
  - Then: the external inference call is mocked while local pathway logic is exercised in process

**AC-6.4:** Both verification levels gate story acceptance.

- **TC-6.4a: Fast verification required**
  - Given: a story in this epic is submitted for acceptance
  - When: acceptance evidence is reviewed
  - Then: the fast service-mock verification group has passed
- **TC-6.4b: Full E2E/lifecycle verification required**
  - Given: a story in this epic is submitted for acceptance after both verification groups exist
  - When: acceptance evidence is reviewed
  - Then: the full E2E/lifecycle verification group has passed
- **TC-6.4c: Compression stories wait for provider-backed verification**
  - Given: a story introduces or depends on GPT OAuth lower-band compression
  - When: the story is submitted for acceptance
  - Then: the real GPT OAuth provider-backed verification exists inside the default non-E2E suite and passes

**Story-local acceptance criterion:** The quarantined heavyweight long-thread
prep proof is decomposed into clean test tiers instead of remaining a skipped
pseudo-test.

- Given: `tests/thread-view/real-long-thread-fixture-prep.NEEDS-REFACTOR.ts`
  exists as a skipped heavyweight in-process proof
- When: Story 0 foundation work completes
- Then: `tests/thread-view/real-long-thread-fixture-prep.ts` remains reusable
  test infrastructure, any still-unique prep invariants are assigned to focused
  file-backed service-tier tests, the real runtime proof remains in
  `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts`, and the
  skipped pseudo-test is no longer treated as an acceptable standing proof

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story establishes the canonical lower-band record vocabulary and the
verification rails the rest of the epic depends on. It does not implement
projection, chunking, or compression behavior. It creates the types, fixture
contracts, and command structure that let later stories add behavior without
inventing record shapes or smuggling a separate integration runner back into
the repo.

The important design constraint is that this story must align to the runner
that actually exists. The repo does not have a separate integration runner
layer. Non-E2E `*.test.ts` files, including those named `.integration.test.ts`,
already run inside the default `npm run verify` suite. This story therefore
clarifies verification truth instead of inventing a new runner seam.

#### Build Strategy

Strategy: `simple-risk-reminders`

Reason:
- the story is mostly record-shape and verification wiring work
- the main risks are fake gate wiring and fixture drift, not a deep runtime
  state machine

Risk Reminders:
- do not reintroduce a separate integration runner layer the repo intentionally
  removed
- fixture defaults must represent valid new-schema states; invalid states must
  be explicit builders
- Story 0 should describe the actual verification commands accurately instead of
  implying a missing runner tier

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Turn projection record shape | `src/thread/domain/records.ts` |
| Chunk transcript and semantic artifact shapes | `src/thread/async-thread/domain/lower-band-artifact-state.ts`, `src/thread/async-thread/domain/chunk-state.ts` |
| Token-count scope and policy wiring | `src/token-accounting/token-count-metadata.ts`, `src/token-accounting/counter-source-policy.ts` |
| Verification command truth | `scripts/run-node-tests.mjs`, `package.json` |
| Fixture builders and lifecycle-valid defaults | `src/thread/async-thread/test/fixtures.ts`, `tests/thread/foundation.test.ts` |
| Long-thread prep tier cleanup | `tests/thread-view/real-long-thread-fixture-prep.NEEDS-REFACTOR.ts`, `tests/thread-view/real-long-thread-fixture-prep.ts`, `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts` |

#### Design References

- [tech-design.md §Module Architecture](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:244), lines 244-290
- [tech-design.md §Turn Projection Types](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:576), lines 576-601
- [tech-design.md §Chunk Transcript And Semantic Artifact Types](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:603), lines 603-631
- [tech-design.md §Chunk State Extension](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:633), lines 633-669
- [tech-design.md §Verification Scripts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:826), lines 826-848
- [tech-design.md §Chunk 0: Lower-Band Foundation And Verification Rails](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/tech-design.md:873), lines 873-895
- [test-plan.md §Meaningful Verification Layers](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:103), lines 103-118
- [test-plan.md §Mock And Fixture Strategy](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:120), lines 120-152
- [test-plan.md §Quarantined Heavyweight Prep Proof](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:119), lines 119-138
- [test-plan.md §Verification Gate Evidence](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/05-real-lower-band-compression/test-plan.md:282), lines 282-293

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| `TC-6.1a`, `TC-6.1b` | `package.json`, `scripts/run-node-tests.mjs`, service-mock suite layout | fast suite remains entry-point oriented and mocks only true external boundaries |
| `TC-6.4a` | `npm run verify` acceptance evidence | fast/default story gate exists and passes |
| `TC-6.4b`, `TC-6.4c` | `package.json`, `scripts/run-node-tests.mjs`, lower-band provider-backed test placement | real GPT OAuth lower-band tests live in the default non-E2E suite, while `verify-all` remains the deeper E2E/lifecycle gate |

Story-local acceptance evidence:
- `test-plan.md` long-thread prep tier plan maps the skipped pseudo-test to
  helper infrastructure + focused service-tier assertions + the existing PI E2E
  proof

#### Non-TC Decided Tests

- `tests/thread/foundation.test.ts`: fixture lifecycle validity for default new-schema Turn and Chunk builders
- command-truth checks around `package.json` and `scripts/run-node-tests.mjs`: no separate integration runner layer is reintroduced
- long-thread prep decomposition notes and any extracted focused assertions from
  `real-long-thread-fixture-prep.NEEDS-REFACTOR.ts`

#### Technical Notes

- Use the exact tech-design interfaces for Story 0 record work. Do not regress to
  simplified epic-level fields like `tokenCount` or a single `error` field.
- This story establishes verification-command truth. The story text and DoD
  should describe the current runner accurately instead of creating a missing
  tier.
- `turn_lower_band_projection_materialized` is introduced here as vocabulary and
  metadata scope; the behavior that produces it belongs to Story 1.

#### Anti-Shim Requirements

- Do not add back `test:integration` or a separate `integration` runner mode to
  make the plan look cleaner.
- Do not preserve placeholder-shaped lower-band record structures “for
  compatibility” in the new canonical shape.
- Do not create default fixtures that are secretly invalid or that require later
  stories’ behavior to appear usable.
- Do not let the skipped heavyweight long-thread prep pseudo-test survive as an
  accepted standing proof once its coverage is redistributed.

#### Verification

- Targeted: `npm run red-verify`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

The epic's TC-6.4b/TC-6.4c wording refers to "integration verification" and an
"integration gate." This story renders those requirements as the repo's actual
runner model: provider-backed non-E2E verification under `npm run verify`, and
E2E/lifecycle verification under `npm run verify-all`. The repo intentionally
has no separate `test:integration` command or integration runner mode, so this
terminology adaptation preserves the requirement without reintroducing a removed
test tier.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] `TurnLowerBandProjectionRecord` type exists on `TurnSmoothRecord`
- [ ] `ChunkConversationTranscriptRecord` and `ChunkSemanticArtifactRecord` types exist
- [ ] `ChunkState` extended with `schemaVersion`, `conversationTranscript`, `lowerBand`
- [ ] Token-count scope `turn_lower_band_projection_materialized` added
- [ ] Fixture builders produce valid and explicitly-invalid states
- [ ] Story 0 records the runner truth: non-E2E `*.test.ts` live under `npm run verify`, and `verify-all` remains the deeper E2E/lifecycle gate
- [ ] long-thread prep tier plan captured in the test plan and linked from this story
- [ ] `npm run red-verify` passes
- [ ] New record shapes do not preserve placeholder runtime assumptions
- [ ] Fixture defaults represent valid Turn and Chunk lifecycle states
- [ ] Story gates use actual repo scripts, not invented aliases
