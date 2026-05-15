# Story 5: Inspection, Audit, And Eval Surfaces

### Summary
<!-- Jira: Summary field -->

Active rollout, smoothing event state, lower-band provenance, and eval outputs are inspectable through shared services, PI commands, local CLI scripts, and compact reports.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward needs to understand what the active PI rollout contains without ad hoc file archaeology. During dogfood, the steward frequently asks how many turns/messages/tool results are in each band, how much prompt-visible content remains, and whether smoothing/truncation is doing the expected thing. Implementers and verifiers also need direct local scripts so they can inspect repository state without asking the user to run PI commands and paste output back.

**Objective**

Deliver inspection, audit, and eval surfaces for the smooth-context quality work. A shared inspection service parses the active generated PI rollout and reports band sizes, live tail, tool truncation counts, and largest tool outputs. A smoothing inspection surface reports message-end user smoothing state, closed-Turn deterministic component state, complete smooth Turn readiness, and degraded/failure counts. PI commands and local CLI scripts use the same services. Smart compact audit reports include smoothing quality details and lower-band provenance so implementers can see whether detailed and brief artifacts came from the current regenerated smooth Turn source. A non-mutating eval harness can run user prompt smoothing prompt variants over real canonical user messages with the production `gpt-5.4-mini` lane and write side-by-side outputs for manual review.

**Scope**

In scope:
- Shared active rollout inspection service
- Local CLI/script `scripts/inspect-active-thread-view.ts` for active thread-view status
- PI command for active thread-view status using same service
- Band split, live tail, message/turn/tool counts, truncation counts
- Largest non-truncated tool result reporting
- Smoothing status inspection service
- PI/local command or script for message-end, closed-Turn deterministic component, complete smooth readiness, degraded, and failure counts
- Compact audit report includes smoothing quality counts
- Compact audit report includes lower-band source freshness/provenance where detailed and brief artifacts depend on regenerated smooth content
- Non-mutating user prompt smoothing eval harness `scripts/eval-user-prompt-smoothing.ts` over real messages using `gpt-5.4-mini`
- Machine-readable JSON output for agent/verifier use

Out of scope:
- Web visualizer
- Full interactive browser UI
- Automatic model selection
- Mutating eval outputs into canonical thread state

**Dependencies**

- Story 1 (component-first smooth Turn foundation)
- Story 2 (user prompt smoothing runtime lane)
- Story 3 (deterministic smooth components)
- Story 4 (smart compact smooth component assembly)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-5.1:** Active PI rollout state is inspectable without ad hoc scripts.

- **TC-5.1a: Local command resolves active generated rollout**
  - Given: a managed thread has an active generated PI rollout
  - When: the local inspection command runs for that thread
  - Then: it resolves the active generated file from thread/projection metadata
- **TC-5.1b: Active rollout report includes band and live-tail counts**
  - Given: an active generated rollout contains compacted bands and appended live messages
  - When: inspection runs
  - Then: the report includes band splits, live-tail counts, message counts, and estimated visible tokens
- **TC-5.1c: Active rollout report includes tool truncation counts**
  - Given: the rollout contains full and truncated tool results
  - When: inspection runs
  - Then: the report includes truncated/non-truncated tool result counts and largest non-truncated tool results

**AC-5.2:** PI command and local CLI use the same inspection logic.

- **TC-5.2a: PI command reports active rollout state**
  - Given: PI is running a managed thread
  - When: the active rollout status command is invoked
  - Then: it reports the same fields as the local inspection service
- **TC-5.2b: JSON output is machine-readable**
  - Given: an implementer or verifier needs to inspect state programmatically
  - When: the local command runs with JSON output
  - Then: it emits parseable structured JSON

**AC-5.3:** Smoothing readiness and quality are inspectable.

- **TC-5.3a: Smoothing status reports readiness counts**
  - Given: a thread has component-first smooth state
  - When: smoothing inspection runs
  - Then: it reports ready, pending, degraded, failed, and missing counts
- **TC-5.3b: Degraded deterministic-preserved prompts are visible**
  - Given: user prompt smoothing fell back to deterministic-preserved text
  - When: smoothing inspection runs
  - Then: the degraded count and affected message/turn references are visible
- **TC-5.3c: Message-end and closed-Turn smoothing stages are distinguishable**
  - Given: a user prompt component is pending or ready and deterministic non-user components for closed Turns are pending or ready
  - When: smoothing inspection runs
  - Then: the report distinguishes message-end user smoothing state from closed-Turn deterministic component state and complete smooth Turn readiness

**AC-5.4:** Compact audit includes smoothing quality.

- **TC-5.4a: Compact report includes smoothing quality counts**
  - Given: smart compact generated a Thread View using component-first smooth Turns
  - When: compact report runs
  - Then: the report includes model-smoothed, deterministic-preserved, degraded, and failed/caught-up counts where applicable
- **TC-5.4b: Compact report remains useful for old deterministic views**
  - Given: a compact report is run on a pre-component Thread View
  - When: the report is generated
  - Then: it remains readable and clearly reports unavailable smoothing quality details as not applicable
- **TC-5.4c: Compact report includes lower-band source freshness**
  - Given: detailed or brief lower-band artifacts are included in a generated Thread View
  - When: compact report runs
  - Then: it reports whether those artifacts were derived from the current regenerated smooth Turn source, regenerated during prepare, or blocked/stale

**AC-5.5:** User prompt smoothing eval is non-mutating and reviewable.

- **TC-5.5a: Eval harness samples real user messages**
  - Given: a canonical thread contains user messages
  - When: the eval command runs
  - Then: it samples real user messages without mutating thread state
- **TC-5.5b: Eval output is side-by-side and auditable**
  - Given: eval has run against one or more prompt configurations using `gpt-5.4-mini`
  - When: output is inspected
  - Then: original and smoothed text are available side-by-side with prompt/model/effort metadata

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

The current repo has partial visibility: `/lh-status`, `/lh-prompt-projection-status`, and `/lh-compact-report`. Those are useful but incomplete. They do not replace the ad hoc local scripts currently needed to answer questions like "how many tool results are still non-truncated in the active rollout?" or "how large is each band right now?"

This story adds shared inspection services so both PI commands and local scripts can answer those questions. The local script path is important because implementers and verifier agents should be able to inspect state directly from files without asking the user to run PI commands and paste output back.

The new smoothing pass has two stages plus compact-time assembly: user smoothing starts at message-end, deterministic assistant/thinking/tool components are generated only after the canonical Turn closes, and smart compact materializes complete smooth Turns plus any lower-band artifacts that depend on them. Inspection should make those stages visible separately so failures are actionable.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Active rollout inspection service | `src/workbench/services/active-rollout-inspection-service.ts` |
| Smoothing inspection service | `src/workbench/services/smoothing-inspection-service.ts` |
| Lower-band provenance inspection | `src/workbench/services/smoothing-inspection-service.ts`, `src/workbench/services/compaction-report-service.ts` |
| PI commands | `src/context-steward/pi/pi-extension.ts` |
| Local CLI/scripts | `scripts/inspect-active-thread-view.ts`, `scripts/inspect-smoothing-status.ts` |
| Compact report | `src/workbench/services/compaction-report-service.ts`, `src/workbench/services/compaction-report-formatter.ts` |
| Eval harness | `scripts/eval-user-prompt-smoothing.ts` |

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-5.1a | `tests/workbench/active-rollout-inspection-service.test.ts` | local command resolves active generated rollout |
| TC-5.1b | `tests/workbench/active-rollout-inspection-service.test.ts` | report includes band and live-tail counts |
| TC-5.1c | `tests/workbench/active-rollout-inspection-service.test.ts` | report includes tool truncation counts |
| TC-5.2a | `tests/context-steward/pi-extension-commands.test.ts` | PI command reports active rollout state |
| TC-5.2b | `tests/workbench/active-rollout-inspection-service.test.ts` | JSON output is machine-readable |
| TC-5.3a | `tests/workbench/smoothing-inspection-service.test.ts` | smoothing status reports readiness counts |
| TC-5.3b | `tests/workbench/smoothing-inspection-service.test.ts` | degraded deterministic-preserved prompts are visible |
| TC-5.3c | `tests/workbench/smoothing-inspection-service.test.ts` | message-end and closed-Turn smoothing stages are distinguishable |
| TC-5.4a | `tests/context-steward/pi-extension-commands.test.ts` | compact report includes smoothing quality counts |
| TC-5.4b | `tests/context-steward/pi-extension-commands.test.ts` | compact report remains useful for old deterministic views |
| TC-5.4c | `tests/workbench/compaction-report-service.test.ts` | compact report includes lower-band source freshness |
| TC-5.5a | `tests/eval/user-prompt-smoothing-eval.test.ts` | eval harness samples real user messages without mutation |
| TC-5.5b | `tests/eval/user-prompt-smoothing-eval.test.ts` | eval output is side-by-side and auditable |

#### Non-TC Decided Tests

- `tests/workbench/active-rollout-inspection-service.test.ts`: active rollout inspection handles missing/stale generated files with explicit errors.
- `tests/workbench/smoothing-inspection-service.test.ts`: smoothing inspection can filter by selected thread view or active thread.
- `tests/workbench/smoothing-inspection-service.test.ts`: inspection reports complete smooth Turn source hash/provenance when available so lower-band freshness is explainable.

#### Technical Notes

Do not build the web visualizer in this story. Shape the services so a web visualizer can consume their JSON later.

Prefer one shared service per inspection domain. Do not duplicate active rollout parsing separately in PI commands and local scripts.

Eval should use the production `openai-codex/gpt-5.4-mini` path and `reasoningEffort: "none"` unless the story is explicitly changed later. The point of the eval harness in this pass is prompt-quality review against the chosen lane, not broad model selection.

Automated eval tests must not require live OAuth credentials or network access. Tests should mock the same provider boundary used by runtime smoothing; live eval runs are explicit local commands that may require the PI OAuth login.

Local/PI surfaces should expose stable machine-readable shapes:

| Surface | Required JSON fields |
|---------|----------------------|
| Active thread-view status | `threadId`, `activeProjectionId`, `generatedFilePath`, `bands`, `liveTail`, `toolResults`, `estimatedVisibleTokens`, `warnings[]`. |
| Smoothing status | `threadId`, `turnCounts`, `componentCounts`, `messageEndUserSmoothing`, `closedTurnDeterministicComponents`, `openTurnPendingCount`, `completeSmoothReadiness`, `degraded[]`, `failed[]`, `pending[]`. |
| Compact report smoothing section | `modelSmoothedCount`, `deterministicPreservedCount`, `degradedCount`, `failedCount`, `caughtUpCount`, `lowerBandFreshness`. |
| Eval output | JSONL rows with `promptNumber`, `sourceMessageId`, `original`, `smoothed`, `promptVersion`, `provider`, `model`, `reasoningEffort`, `usage`, `elapsedMs`, and `error` when applicable. |

Default eval output path should be under `docs/spec-build/epics/04-smooth-context-quality/eval-results/`. Default sample size should be explicit, with a flag to evaluate a provided fixture file.

#### Anti-Shim Requirements

- Prove active rollout inspection by parsing actual generated PI JSONL fixture files, not hand-built report objects.
- Prove PI command and local script/service agree by using the same service in tests.
- Prove eval is non-mutating by comparing thread files before and after eval.
- Prove lower-band freshness is calculated from persisted source/provenance metadata, not inferred from the current wall-clock run.

#### Verification

- Targeted: `node --import tsx --test tests/workbench/active-rollout-inspection-service.test.ts tests/workbench/smoothing-inspection-service.test.ts tests/workbench/compaction-report-service.test.ts tests/context-steward/pi-extension-commands.test.ts tests/eval/user-prompt-smoothing-eval.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 13 TCs pass (TC-5.1a through TC-5.5b)
- [ ] Local inspection commands can answer active rollout and smoothing status without PI command copy/paste
- [ ] Compact reports include smoothing quality and lower-band source freshness details
- [ ] Eval outputs are non-mutating and reviewable
- [ ] `npm run verify` passes
