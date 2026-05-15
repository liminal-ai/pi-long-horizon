# Story 1: Component-First Smooth Turn Foundation

### Summary
<!-- Jira: Summary field -->

Smooth Turns become component-first derived records whose readiness supports complete regenerated smooth Turn text for smart compact and downstream bands.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward manages long PI sessions where older content is represented through a fidelity gradient. The steward needs the smooth band to preserve conversational fidelity while removing avoidable attentional snags and bounding tool-heavy turns. The steward also needs the derived state to be inspectable enough that implementers and verifiers can understand why a Turn is or is not smooth-ready.

**Objective**

Replace the monolithic smooth-turn artifact as the primary smooth representation with a component-first smooth Turn model. A smooth Turn is ready when its required component outputs are ready: user prompt components, assistant message components, and tool exchange components when tool work exists. Thinking is optional and can be explicitly omitted. The model must also support materializing one complete regenerated smooth Turn text from those components, because smart compact and the lower detailed/brief bands consume full smooth Turns rather than isolated component records.

**Scope**

In scope:
- Component-first smooth Turn state
- Required component kinds for user prompts, assistant messages, and tool exchanges
- Optional thinking component with explicit omitted state
- Readiness derived from component readiness
- Source-order component assembly plan
- Complete smooth Turn materialization contract for downstream compact/chunk/lower-band consumers
- Persisted component data contract replacing the previous single `turn.smooth.text` field
- Future-proof actor labels for multi-agent assistant responses
- Migration/readability handling for existing `deterministic_marker_sections_v1` smooth records
- Missing, stale, invalid, degraded, and ready states for component-first smooth Turns

Out of scope:
- Calling a model for user prompt smoothing (Story 2)
- Deterministic tool exchange rendering details (Story 3)
- Smart compact component assembly integration (Story 4)
- Web visualization (future)

**Dependencies**

- Epic 3 smooth-turn, chunk, and smart compact mechanics

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-1.1:** A closed Turn can represent smooth readiness through component state.

- **TC-1.1a: Closed Turn reports missing components explicitly**
  - Given: A closed Turn has no component-first smooth state
  - When: smooth readiness is evaluated
  - Then: the Turn reports missing required components rather than claiming ready
- **TC-1.1b: Required components make a Turn smooth-ready**
  - Given: A closed Turn has ready user, assistant, and required tool exchange components
  - When: smooth readiness is evaluated
  - Then: the Turn is marked smooth-ready

**AC-1.2:** Thinking does not block smooth readiness.

- **TC-1.2a: Missing plaintext thinking is explicitly omitted**
  - Given: A Turn has reasoning parts with no usable plaintext thinking
  - When: component readiness is evaluated
  - Then: the thinking component can be marked omitted
- **TC-1.2b: Omitted thinking does not block readiness**
  - Given: Required user, assistant, and tool components are ready and thinking is omitted
  - When: smooth readiness is evaluated
  - Then: the Turn is smooth-ready

**AC-1.3:** Component ordering and actor labels are future-proof.

- **TC-1.3a: Components preserve canonical source order**
  - Given: A Turn contains interleaved user, assistant, thinking, tool call, and tool result messages
  - When: components are listed for assembly
  - Then: component order follows canonical message and part source order
- **TC-1.3b: Assistant actor labels are optional metadata**
  - Given: Assistant messages have no agent-specific actor label today
  - When: components are created
  - Then: components remain valid without assuming there is only one assistant forever

**AC-1.4:** Existing smooth records remain usable during migration.

- **TC-1.4a: Legacy smooth text remains readable**
  - Given: A Turn has existing `deterministic_marker_sections_v1` smooth text
  - When: smooth state is inspected
  - Then: the legacy state is reported clearly rather than discarded
- **TC-1.4b: Legacy smooth state can be regenerated into component-first state**
  - Given: A closed Turn has only legacy smooth state
  - When: component-first maintenance runs
  - Then: component-first state can be created without mutating canonical messages

**AC-1.5:** Component-first state exposes a complete smooth Turn materialization contract.

- **TC-1.5a: Ready components can materialize complete smooth Turn text**
  - Given: a closed Turn has ready required components
  - When: a downstream service asks for complete smooth Turn text
  - Then: the service receives one assembled smooth Turn body with a token count
- **TC-1.5b: Incomplete components do not materialize as complete smooth text**
  - Given: a closed Turn is missing a required component
  - When: a downstream service asks for complete smooth Turn text
  - Then: the request returns an explicit missing/incomplete state rather than partial text

**AC-1.6:** Component-first state records source provenance for stale detection.

- **TC-1.6a: Component records include source references**
  - Given: a component is generated from canonical messages or parts
  - When: the component is persisted
  - Then: it records the source message ids, source part ids where applicable, source revision, generated time, and generation strategy
- **TC-1.6b: Complete smooth materialization records a source fingerprint**
  - Given: complete smooth Turn text is assembled from ready components
  - When: the materialization result is returned
  - Then: it includes a stable source fingerprint and token count for downstream chunk and lower-band freshness checks

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Epic 3 created a deterministic smooth Turn as one text field. That was enough to prove the fidelity-gradient mechanics, and downstream chunk, detailed, brief, and smart-compact paths now assume there is a full smooth Turn body available. This story preserves that downstream contract while changing the authoritative internal representation to component-first state.

This story changes the primary model to component-first smooth state. The Turn can still expose smooth readiness, but the underlying record must explain which required pieces exist, which are degraded, and which are omitted. Downstream assembly belongs to smart compact and related materialization services, but those services need a stable way to request the complete assembled smooth Turn text.

Component-first state replaces the previous single generated smooth field as the authoritative derived state. Do not introduce a separate compatibility cache for the full concatenated smooth text. The complete smooth Turn body is assembled from component fields when smart compact or downstream chunk/lower-band logic needs it.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Smooth state domain | `src/thread/async-thread/domain/smooth-turn-state.ts` |
| Smooth service readiness | `src/thread/async-thread/services/smooth-turn-service.ts` |
| Async readiness checks | `src/thread/async-thread/services/async-thread-run-service.ts` |
| Thread record compatibility | `src/thread/domain/records.ts`, `src/thread/store/file-thread-store.ts` |
| Workbench read surfaces | `src/workbench/services/workbench-query-service.ts` |

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-1.1a | `tests/thread/smooth-turn-service.test.ts` | closed turn reports missing component-first smooth state |
| TC-1.1b | `tests/thread/smooth-turn-service.test.ts` | required components make a turn smooth-ready |
| TC-1.2a | `tests/thread/smooth-turn-service.test.ts` | missing plaintext thinking is explicitly omitted |
| TC-1.2b | `tests/thread/smooth-turn-service.test.ts` | omitted thinking does not block readiness |
| TC-1.3a | `tests/thread/smooth-turn-service.test.ts` | component ordering follows canonical source order |
| TC-1.3b | `tests/thread/smooth-turn-service.test.ts` | assistant actor labels are optional metadata |
| TC-1.4a | `tests/thread/smooth-turn-service.test.ts` | legacy deterministic smooth state remains inspectable |
| TC-1.4b | `tests/thread/smooth-turn-service.test.ts` | legacy smooth state can be regenerated into component-first state |
| TC-1.5a | `tests/thread/smooth-turn-service.test.ts` | ready components materialize complete smooth turn text and token count |
| TC-1.5b | `tests/thread/smooth-turn-service.test.ts` | incomplete components do not materialize as complete smooth text |
| TC-1.6a | `tests/thread/smooth-turn-service.test.ts` | component records include source references |
| TC-1.6b | `tests/thread/smooth-turn-service.test.ts` | complete smooth materialization records source fingerprint |

#### Non-TC Decided Tests

- `tests/workbench/workbench-query-service.test.ts`: component readiness and degraded/omitted states survive store reopen and are visible through normal inspection.

#### Technical Notes

Do not design the schema around one final assistant response. Assistant components should be message/component records with optional actor labels so future multi-agent conversations can render labels such as `[assistant:agent-one]` without changing the readiness model.

The existing `turn.smooth.text` path is legacy input only. New component-first state replaces it as the source for new smooth-band assembly. Existing deterministic smooth records may remain readable and may be used to bootstrap component-first migration, but new code should not write a new full concatenated `turn.smooth.text` as the authoritative output.

This story should explicitly preserve compatibility with downstream chunk and lower-band mechanics by defining how callers obtain the complete smooth Turn body and token count after component-first readiness is achieved.

Component-first smooth state should include these persisted fields:

| Field | Required | Description |
|-------|----------|-------------|
| `turnId`, `threadId` | yes | Identifies the owning Turn. |
| `schemaVersion` | yes | Component state schema version, initially `component_smooth_turn_v1`. |
| `status` | yes | Overall readiness: `missing`, `pending`, `ready`, `degraded`, `stale`, or `invalid`. |
| `components[]` | yes | Ordered component records for user prompt, assistant message, tool exchange, and optional thinking. |
| `components[].componentId` | yes | Stable id derived from turn id, kind, and source ids. |
| `components[].kind` | yes | `user_prompt`, `assistant_message`, `tool_exchange`, or `thinking`. |
| `components[].status` | yes | `pending`, `ready`, `degraded`, `omitted`, `stale`, or `invalid`. |
| `components[].text` | when ready/degraded | Prompt-visible component text. |
| `components[].quality` | when ready/degraded/omitted | `model_smoothed`, `deterministic_preserved`, `deterministic_rendered`, or `omitted_no_plaintext`. |
| `components[].sourceMessageIds` | yes | Canonical message ids used to generate the component. |
| `components[].sourcePartIds` | when part-backed | Canonical part ids used to generate the component. |
| `components[].sourceRevision` | yes | Source revision observed when the component was generated. |
| `components[].generatedAt` | when generated | ISO timestamp for generation. |
| `components[].strategy` | yes | Generation strategy, such as `gpt_5_4_mini_user_prompt_v1`, `deterministic_assistant_v1`, `deterministic_tool_exchange_v1`, or `thinking_plaintext_or_omitted_v1`. |
| `materialized.sourceFingerprint` | when ready/degraded | Stable hash/fingerprint over ordered component ids, component source revisions, component strategies, and component text. |
| `materialized.tokenCountMetadata` | when ready/degraded | Token accounting for the assembled complete smooth Turn body. |

#### Anti-Shim Requirements

- Prove readiness from real Turn/Message/Part records, not synthetic component-only fixtures.
- Prove legacy state compatibility against existing deterministic smooth records.
- Do not mark a Turn ready by writing a placeholder monolithic string while required components are missing.
- Prove new component-first writes replace the old generated `turn.smooth.text` path as the authoritative smooth source.

#### Verification

- Targeted: `node --import tsx --test tests/thread/smooth-turn-service.test.ts tests/workbench/workbench-query-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

Intentional revision from Epic 3 deterministic mechanics: component-first smooth state replaces the previous single generated `turn.smooth.text` field as the authoritative smooth source for new work. Legacy deterministic smooth records remain migration/readability inputs only.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 12 TCs pass (TC-1.1a through TC-1.6b)
- [ ] Component-first smooth readiness persists and survives process restart
- [ ] Component state includes source provenance and materialized source fingerprint
- [ ] Existing smooth records remain inspectable or repairable
- [ ] `npm run verify` passes
