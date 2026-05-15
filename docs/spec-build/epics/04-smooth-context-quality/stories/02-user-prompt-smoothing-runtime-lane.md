# Story 2: User Prompt Smoothing Runtime Lane

### Summary
<!-- Jira: Summary field -->

User prompt smoothing starts asynchronously on user message-end capture, feeds smooth Turn readiness, and falls back to deterministic-preserved text when model smoothing is unavailable.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward works interactively with PI over long sessions and often writes user prompts quickly, with typos, intensity, profanity, repeated attention spikes, and rough grammar. Those traits are useful in the live moment but can become attentional snags when preserved in older smooth-band context. The steward needs smoothed user prompts that preserve intent and uncertainty while reducing unnecessary friction for future model reads.

**Objective**

Deliver a user prompt smoothing lane that begins immediately after a user message-end event is captured. The smoothing lane runs asynchronously and does not block foreground provider calls or turn-end deterministic maintenance. It uses PI's ChatGPT Codex OAuth-backed `gpt-5.4-mini` lane to produce a smoothed user prompt, preserving intent, constraints, uncertainty, and concrete details while reducing typos, grammar issues, whitespace noise, repetition, anger, and profanity. If model smoothing fails or is intentionally skipped, the system writes deterministic-preserved user prompt text so smooth Turn assembly can still proceed.

**Scope**

In scope:
- User prompt smoothing triggered by user `message_end`
- User component writes integrate with later closed-Turn smooth readiness
- Async, non-blocking model call lane
- Per-message in-flight guard to avoid duplicate smoothing work
- PI ChatGPT Codex OAuth-backed `gpt-5.4-mini` smoothing implementation
- Prompt behavior: preserve intent and uncertainty, soften intensity/profanity, fix typos/grammar/capitalization/whitespace
- Deterministic-preserved fallback after failures or skip policy
- Visible failure logging to CLI/stderr and structured debug log
- Runtime readiness integration with component-first smooth state

Out of scope:
- Assistant response compression
- Whole-turn summary inference
- Web visual inspection
- Semantic guard model or deterministic semantic equivalence checker

**Dependencies**

- Story 1 (component-first smooth Turn foundation)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-2.1:** User prompt smoothing starts promptly and does not block capture.

- **TC-2.1a: User message schedules smoothing on message_end**
  - Given: A user message is captured
  - When: the `message_end` handler completes
  - Then: user prompt smoothing is scheduled for that message
- **TC-2.1b: User prompt smoothing is not awaited by message capture**
  - Given: the smoothing provider is slow
  - When: a user message is captured
  - Then: capture returns without waiting for smoothing completion

**AC-2.2:** User prompt smoothing preserves intent while reducing attentional snags.

- **TC-2.2a: Smoothed prompt preserves uncertainty**
  - Given: a user prompt includes uncertainty such as "I think", "maybe", or "I'm not sure"
  - When: smoothing succeeds
  - Then: the smoothed prompt preserves that uncertainty rather than turning it into a firm decision
- **TC-2.2b: Smoothed prompt softens intensity and profanity**
  - Given: a user prompt uses profanity, anger, repeated emphasis, or attention-spiking language
  - When: smoothing succeeds
  - Then: the smoothed prompt lowers the intensity while preserving the instruction and priority
- **TC-2.2c: Smoothed prompt preserves concrete constraints**
  - Given: a user prompt includes commands, file paths, thread ids, thresholds, or explicit constraints
  - When: smoothing succeeds
  - Then: the smoothed prompt preserves those concrete details

**AC-2.3:** Smoothing failures produce deterministic-preserved user prompt text.

- **TC-2.3a: Failed smoothing attempts are logged visibly**
  - Given: the smoothing provider fails
  - When: smoothing is attempted
  - Then: each failure is written to a visible CLI/stderr surface and structured debug log with useful cause information
- **TC-2.3b: Repeated failure writes deterministic-preserved text**
  - Given: user prompt smoothing fails through the configured runtime attempts
  - When: fallback runs
  - Then: deterministic-preserved user prompt text is written as the user component and marked degraded
- **TC-2.3c: Intentional skip writes deterministic-preserved text**
  - Given: a user prompt is not sent to the model by policy
  - When: smoothing is evaluated
  - Then: deterministic-preserved text is written as the user component without treating it as a model failure

**AC-2.4:** Smoothing work is deduplicated and inspectable.

- **TC-2.4a: Duplicate message events do not start duplicate model calls**
  - Given: the same user message is observed more than once
  - When: smoothing is scheduled
  - Then: only one in-flight smoothing job runs for that message
- **TC-2.4b: Smoothing status survives store reopen**
  - Given: a user prompt component has model-smoothed or deterministic-preserved text
  - When: the store is reopened
  - Then: the user prompt component remains inspectable with its quality state

**AC-2.5:** User smoothing output is testable without live model assertions.

- **TC-2.5a: Golden provider fixture output is stored as model-smoothed text**
  - Given: a mocked smoothing provider returns a known smoothed prompt
  - When: user prompt smoothing succeeds
  - Then: the user component stores that exact output with `model_smoothed` quality and provider metadata
- **TC-2.5b: Live provider behavior is isolated behind a provider boundary**
  - Given: service tests run without network access
  - When: smoothing service tests execute
  - Then: they use a mocked provider and do not call `gpt-5.4-mini`

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

User prompt smoothing is the only inference-backed component in this pass. It starts at user message-end capture time because it is the slowest part of smooth Turn preparation and should be in flight before a Turn closes and deterministic work begins. It must not block capture, provider calls, or turn-end maintenance.

The event split matters: message-end starts user smoothing early; closed-Turn maintenance finishes deterministic non-user components and evaluates whether a complete regenerated smooth Turn body can be assembled. Story 2 owns the user component side of that split, not final whole-turn assembly. `turn_end` must not generate complete smooth components for open canonical Turns; open Turns remain pending until the canonical Turn closes.

The term is **user prompt smoothing**, not cleanup. The behavior is not generic cleanup; it is prompt-visible smoothing for older context: preserve what the user meant, reduce avoidable attention spikes, and keep long-horizon context easier for later agents to read.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| PI message-end scheduling | `src/context-steward/pi/pi-extension.ts` |
| User prompt smoothing service | `src/thread/async-thread/services/user-prompt-smoothing-service.ts` |
| PI Codex smoothing provider | `src/thread/async-thread/services/pi-codex-user-prompt-smoothing-provider.ts` |
| Smooth state domain | `src/thread/async-thread/domain/smooth-turn-state.ts` |
| Async maintenance/readiness handoff | `src/thread/async-thread/services/async-thread-run-service.ts` |
| Debug logging | `.context-steward/debug/*`, extension logging helpers |

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-2.1a | `tests/context-steward/pi-extension-commands.test.ts` | user message schedules smoothing on message_end |
| TC-2.1b | `tests/context-steward/capture-service.test.ts` | smoothing is not awaited by message capture |
| TC-2.2a | `tests/thread/user-prompt-smoothing-service.test.ts` | uncertainty is preserved in fixture output |
| TC-2.2b | `tests/thread/user-prompt-smoothing-service.test.ts` | intensity and profanity are softened in fixture output |
| TC-2.2c | `tests/thread/user-prompt-smoothing-service.test.ts` | concrete constraints are preserved |
| TC-2.3a | `tests/thread/user-prompt-smoothing-service.test.ts` | provider failures are visibly logged |
| TC-2.3b | `tests/thread/user-prompt-smoothing-service.test.ts` | repeated failure writes deterministic-preserved text |
| TC-2.3c | `tests/thread/user-prompt-smoothing-service.test.ts` | skipped prompt writes deterministic-preserved text |
| TC-2.4a | `tests/context-steward/capture-service.test.ts` | duplicate events do not start duplicate smoothing work |
| TC-2.4b | `tests/workbench/workbench-query-service.test.ts` | smoothing status survives store reopen |
| TC-2.5a | `tests/thread/user-prompt-smoothing-service.test.ts` | golden provider fixture output is stored as model-smoothed text |
| TC-2.5b | `tests/thread/user-prompt-smoothing-service.test.ts` | service tests mock provider boundary and avoid live model calls |

#### Non-TC Decided Tests

- `tests/thread/user-prompt-smoothing-service.test.ts`: fallback deterministic preservation applies basic whitespace normalization but does not rewrite content semantically.
- `tests/thread/user-prompt-smoothing-service.test.ts`: model output fixtures do not add moralizing, apologies, or therapeutic framing.
- `tests/thread/async-thread-run-service.test.ts`: a completed user smoothing component is visible to closed-Turn smooth readiness evaluation without blocking the foreground provider cycle.

#### Technical Notes

Do not add assistant response compression in this story. User prompt smoothing is inference-backed; assistant and tool components remain deterministic in this pass.

The smoothing lane should use `openai-codex/gpt-5.4-mini` with `reasoningEffort: "none"` and low text verbosity, called through PI's existing ChatGPT Codex OAuth credential path. Use `AuthStorage.getApiKey("openai-codex")` from `.pi/agent/auth.json` and PI AI's `openai-codex-responses` provider. The provider should prefer SSE transport for this short, background smoothing lane unless the implementation has a concrete reason to use websocket caching.

Story 5 eval should use this same `gpt-5.4-mini` lane and vary prompt versions, held-out prompt fixtures, timeout policy, and output review surfaces. Do not add a separate model provider for this story.

Smoke evidence from 2026-05-14: a direct PI OAuth-backed call to `openai-codex/gpt-5.4-mini` with `reasoningEffort: "none"`, `textVerbosity: "low"`, and `transport: "sse"` completed successfully in 1337 ms using `AuthStorage.getApiKey("openai-codex")`. The call returned `stopReason: "stop"` with 53 input tokens and 18 output tokens.

Provider interface contract:

| Field / Behavior | Requirement |
|------------------|-------------|
| Input | Raw user prompt text, message id, turn id when known, thread id, source revision, and prompt version. |
| Output | Smoothed text, provider id `openai-codex`, model id `gpt-5.4-mini`, reasoning effort `none`, prompt version, usage when available, elapsed ms, and generated timestamp. |
| Timeout | Default 30 seconds per prompt; timeout falls back to deterministic-preserved text after configured attempts. |
| Retry | One immediate attempt is sufficient for runtime; smart compact prepare may trigger catch-up/fallback for selected closed Turns. |
| Concurrency | Per-message in-flight guard prevents duplicate calls; implementation should use a small bounded queue so smoothing cannot starve foreground PI work. |
| Persistence | Pending work does not need to survive as an in-memory job. Persist component status/source state, and let closed-Turn maintenance or smart compact catch-up retry missing pending user components. |
| Test mock boundary | Mock the `UserPromptSmoothingProvider` interface, not `AuthStorage`, `complete`, or PI internals in service tests. |

#### Anti-Shim Requirements

- Prove scheduling through actual message capture/lifecycle surfaces, not a direct service-only call.
- Prove failure visibility with a real logger/stderr/debug-log double, not an ignored mock.
- Prove degraded deterministic-preserved state persists in canonical thread state and is visible after reopen.
- Prove semantic ACs through golden mocked provider outputs and stored quality metadata, not live-model assertions.

#### Verification

- Targeted: `node --import tsx --test tests/thread/user-prompt-smoothing-service.test.ts tests/context-steward/capture-service.test.ts tests/workbench/workbench-query-service.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 12 TCs pass (TC-2.1a through TC-2.5b)
- [ ] User prompt smoothing starts asynchronously on user message capture
- [ ] Runtime failures are visible and result in deterministic-preserved degraded text
- [ ] `npm run verify` passes
