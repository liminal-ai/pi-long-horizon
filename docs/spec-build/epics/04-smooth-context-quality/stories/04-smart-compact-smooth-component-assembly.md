# Story 4: Smart Compact Smooth Component Assembly

### Summary
<!-- Jira: Summary field -->

Smart compact selects complete regenerated smooth Turns, assembles smooth-band output from ready components, and keeps lower bands compatible with the new smooth source.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward runs smart compact to keep long PI sessions usable. When older Turns move into the smooth band, the generated PI rollout should use the new component-first smooth representation rather than legacy monolithic smooth text. If model-backed user prompt smoothing is unavailable, compact should still produce safe deterministic-preserved user prompt text and report degraded quality.

**Objective**

Integrate complete regenerated smooth Turns into smart compact. Smooth-band materialization assembles selected Turns from ready components at compact time. Prepare mode can catch up missing deterministic components and can allow user prompt smoothing to finish or degrade to deterministic-preserved text. Smart compact must not silently include partial smooth Turns, and its reports must identify degraded smoothing quality. Because detailed and brief bands are built from smooth chunk content, this story must also verify that chunk, detailed, and brief lower-band paths continue to consume the new complete smooth Turn bodies correctly.

**Scope**

In scope:
- Smooth-band selection/readiness uses component-first state
- Smart compact assembles complete smooth Turn text from components at compact time
- Prepare/catch-up path fills missing deterministic assistant, thinking, and tool exchange components
- Prepare/catch-up path can trigger or await bounded user prompt smoothing/fallback for selected Turns
- Missing/failed user prompt smoothing falls back to deterministic-preserved text
- Degraded user prompt smoothing is surfaced in compact result/report
- Token accounting uses assembled smooth output
- Chunk/update paths consume complete assembled smooth Turn output where needed
- Detailed and brief lower-band rebuild paths remain deterministic placeholder artifacts derived from the new full smoothed Turn source
- Generated PI rollout contains assembled smooth component text

Out of scope:
- Assistant response compression
- Whole-turn summaries
- Detailed/brief semantic summaries
- Web visualization

**Dependencies**

- Story 1 (component-first smooth Turn foundation)
- Story 2 (user prompt smoothing runtime lane)
- Story 3 (deterministic smooth components)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-4.1:** Smooth-band compact selection uses component readiness.

- **TC-4.1a: Component-ready smooth Turn is eligible**
  - Given: a closed Turn has ready required smooth components
  - When: smooth-band selection runs
  - Then: the Turn can be selected into the smooth band
- **TC-4.1b: Partial smooth Turn is not silently selected**
  - Given: a closed Turn is missing required components
  - When: smooth-band selection or materialization runs
  - Then: the missing state is reported or repaired rather than silently emitted as partial smooth output

**AC-4.2:** Smooth-band output is assembled deterministically as complete smooth Turn text at compact time.

- **TC-4.2a: Selected smooth Turn assembles from components**
  - Given: a selected smooth Turn has ready components
  - When: smart compact materializes the smooth band
  - Then: complete smooth Turn output text is assembled from components in deterministic source order
- **TC-4.2b: Assembly does not depend on legacy monolithic smooth text**
  - Given: component-first state is ready
  - When: smart compact materializes smooth output
  - Then: it uses component state rather than requiring legacy `turn.smooth.text`

**AC-4.3:** Prepare/catch-up can make selected Turns safe for compact.

- **TC-4.3a: Missing deterministic components are generated during prepare**
  - Given: selected smooth Turns are missing assistant, thinking, or tool exchange components
  - When: smart compact runs in prepare mode
  - Then: deterministic component catch-up runs before materialization
- **TC-4.3b: Missing user prompt smoothing degrades to deterministic-preserved text**
  - Given: selected smooth Turns are missing model-smoothed user prompt text
  - When: catch-up cannot produce model-smoothed text
  - Then: deterministic-preserved user prompt text is produced and marked degraded

**AC-4.4:** Smart compact reports smoothing degradation.

- **TC-4.4a: Degraded user prompt smoothing appears in compact result**
  - Given: compact uses deterministic-preserved user prompt text
  - When: compact completes
  - Then: the compact result reports the degraded smoothing count
- **TC-4.4b: Compact report surfaces degraded smoothing details**
  - Given: a generated Thread View used degraded smoothing
  - When: `/lh-compact-report` or the report service is used
  - Then: degraded smoothing information is visible

**AC-4.5:** Canonical source remains unchanged.

- **TC-4.5a: Component assembly does not mutate canonical message content**
  - Given: smart compact assembles smooth output
  - When: canonical messages are inspected afterward
  - Then: source message content remains unchanged
- **TC-4.5b: Generated PI rollout contains assembled component smooth text**
  - Given: smart compact succeeds with smooth-band selections
  - When: the generated PI rollout is inspected
  - Then: smooth-band entries contain assembled component output

**AC-4.6:** Lower detailed and brief bands continue to work from the regenerated smooth source.

- **TC-4.6a: Chunk bodies rebuild from assembled smooth Turns**
  - Given: closed Chunks are rebuilt after component-first smoothing is available
  - When: chunk body generation reads selected Turns
  - Then: it uses complete assembled smooth Turn text rather than stale legacy smooth text
- **TC-4.6b: Detailed and brief artifacts remain regenerable**
  - Given: detailed and brief lower-band artifacts are derived from smooth chunk content
  - When: the underlying complete smooth Turn text changes because component-first smoothing is regenerated
  - Then: detailed and brief artifacts are marked stale or regenerated through the existing lower-band path
- **TC-4.6c: Thread View band allocation still accounts for all three derived bands**
  - Given: a Thread View contains smooth, detailed, and brief bands
  - When: smart compact builds the generated PI rollout
  - Then: allocation and token accounting use the regenerated smooth source and compatible lower-band artifacts without dropping a band

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

This story is where component-first smooth state becomes part of the active prompt-visible projection. The generated PI rollout should not depend on old one-field deterministic smooth text when component state exists. It should assemble the selected smooth Turns from the component model at materialization time.

The lower two derived bands matter here. Detailed and brief artifacts remain deterministic placeholder artifacts in this pass, not semantic summaries. They are not independent sources of truth; they are built from smooth chunk content, which is in turn built from full smooth Turn bodies. Replacing smooth Turn generation means smart compact must either rebuild stale lower-band artifacts or explicitly block/degrade with a report that names the stale dependency. It is not enough for the smooth band alone to render correctly.

This story also settles the smart compact failure rule for user prompt smoothing: model failure is not a compact blocker if deterministic-preserved user prompt text can be produced. Compact should continue and report degraded smoothing. Hard failures remain reserved for cases where no safe component can be produced or core read/write/reload operations fail.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Smart compact command | `src/commands/smart-compact.ts` |
| Async preparation | `src/thread/async-thread/services/async-thread-run-service.ts` |
| Smooth assembly service | `src/thread/async-thread/services/smooth-turn-service.ts` |
| Chunk/lower-band dependency refresh | `src/thread/async-thread/services/chunk-service.ts`, `src/thread/async-thread/services/placeholder-artifact-service.ts` |
| Thread View builder | `src/thread-view/services/thread-view-builder.ts` |
| Materializer | `src/thread-view/services/thread-view-materializer.ts` |
| PI target builder | `src/thread-view/targets/pi/pi-thread-view-builder.ts` |
| Compact report | `src/workbench/services/compaction-report-service.ts` |

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-4.1a | `tests/thread-view/thread-view-builder.test.ts` | component-ready smooth turn is eligible |
| TC-4.1b | `tests/thread-view/thread-view-builder.test.ts` | partial smooth turn is not silently selected |
| TC-4.2a | `tests/thread-view/thread-view-materializer.test.ts` | selected smooth turn assembles from components |
| TC-4.2b | `tests/thread-view/thread-view-materializer.test.ts` | assembly does not depend on legacy smooth text |
| TC-4.3a | `tests/commands/smart-compact.test.ts` | prepare generates missing deterministic components |
| TC-4.3b | `tests/commands/smart-compact.test.ts` | missing user prompt smoothing degrades to deterministic-preserved |
| TC-4.4a | `tests/commands/smart-compact.test.ts` | degraded user prompt smoothing appears in compact result |
| TC-4.4b | `tests/context-steward/pi-extension-commands.test.ts` | compact report surfaces degraded smoothing details |
| TC-4.5a | `tests/commands/smart-compact.test.ts` | canonical message content remains unchanged |
| TC-4.5b | `tests/thread-view/pi-thread-view-builder.test.ts` | generated rollout contains assembled component smooth text |
| TC-4.6a | `tests/thread/chunk-service.test.ts` | chunk bodies rebuild from assembled smooth Turns |
| TC-4.6b | `tests/thread/placeholder-artifact-service.test.ts` | detailed and brief artifacts stale/regenerate from new smooth source |
| TC-4.6c | `tests/thread-view/thread-view-builder.test.ts` | band allocation accounts for smooth, detailed, and brief after regenerated smooth source |

#### Non-TC Decided Tests

- `tests/thread/async-thread-run-service.test.ts`: runtime maintenance can mark Turns smooth-ready after deterministic components and deterministic-preserved user prompt text exist.
- `tests/thread-view/thread-view-builder.test.ts`: token accounting for smooth selection uses assembled component output.
- `tests/commands/smart-compact.test.ts`: prepare mode reports whether selected Turns were already smoothed, caught up, degraded, or blocked by lower-band stale dependencies.

#### Technical Notes

The smooth band should assemble from components deterministically during compact/materialization. Do not ask the product owner to approve a cached assembled text shape; derive whatever compatibility fields are needed from the existing code while keeping component-first state authoritative for new compact output.

Detailed and brief artifacts remain `chunk.placeholders.detailed` and `chunk.placeholders.brief` with the existing deterministic strategies (`deterministic_truncate_30`, `deterministic_truncate_5`). Add provenance to each placeholder record so stale detection can compare the lower artifact against the current assembled smooth source:

| Field | Required | Description |
|-------|----------|-------------|
| `smoothSourceFingerprint` | yes | Fingerprint of the smooth chunk body used to generate this placeholder. |
| `smoothSourceRevision` | yes | Chunk/source revision observed when generated. |
| `smoothSourceTokenCount` | yes | Token count of the smooth chunk source used for placeholder sizing/accounting. |
| `generatedFromComponentSmooth` | yes | Boolean confirming the placeholder came from component-first assembled smooth text rather than legacy `turn.smooth.text`. |

If the current chunk body assembled from complete smooth Turns has a different `smoothSourceFingerprint`, detailed/brief placeholders are stale. Prepare mode should regenerate deterministic placeholders when possible. Strict smart compact should block rather than silently use stale lower-band artifacts.

Placeholder staleness is computed from provenance mismatch in this pass. Do not add a persisted `stale` placeholder status unless implementation discovers a stronger reason; the existing ready/missing/invalid status can remain, with freshness reported by comparing the persisted placeholder source fingerprint against the current assembled smooth chunk fingerprint.

#### Anti-Shim Requirements

- Prove generated PI rollout content comes from component state by using fixture components that differ from legacy smooth text.
- Prove lower-band artifacts are not silently reused when their smooth source body changes.
- Prove degraded user prompt smoothing is reported from persisted component state, not from a hard-coded command result.
- Prove canonical messages remain byte-for-byte/source-content unchanged by compact.

#### Verification

- Targeted: `node --import tsx --test tests/commands/smart-compact.test.ts tests/thread/async-thread-run-service.test.ts tests/thread/placeholder-artifact-service.test.ts tests/thread-view/thread-view-builder.test.ts tests/thread-view/thread-view-materializer.test.ts tests/thread-view/pi-thread-view-builder.test.ts tests/context-steward/pi-extension-commands.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

Intentional revision from Epic 3 deterministic mechanics: smart compact should consume component-first assembled smooth Turn text rather than legacy monolithic `turn.smooth.text`, while detailed/brief lower bands remain deterministic placeholder artifacts derived from the current assembled smooth source.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 13 TCs pass (TC-4.1a through TC-4.6c)
- [ ] Smooth-band generated PI output assembles from component-first smooth state
- [ ] Detailed and brief lower-band artifacts remain correct or are explicitly regenerated/blocked after smooth source changes
- [ ] Degraded deterministic-preserved user prompt smoothing is reported
- [ ] `npm run verify` passes
