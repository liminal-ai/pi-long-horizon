# Epic 5: Real Lower-Band Compression

This epic defines the requirements for replacing deterministic detailed and
brief placeholder output with real lower-band compression over conversation-only
chunk transcripts.

---

## Onboarding Context

PI Long Horizon stores the canonical Thread as source truth. Turns contain the
user prompt and everything that happens before the next user prompt. Smooth
components are derived from closed Turns and preserve the recent conversation at
higher fidelity.

Chunks are ordered groups of Turns. Chunk text is derived from the Turn-derived
state for the Turns in that Chunk. Before this epic, lower-band detailed and
brief output is deterministic placeholder truncation over Chunk smooth text.
Conversation-only text is derived from smooth Turn components and includes only
user prompts and assistant-visible responses, omitting thinking and tool
exchange content.

This epic replaces that placeholder lower-band behavior. The new path derives a
conversation-only text representation from smooth Turn components, groups Turns
into Chunks using proper token counts for that representation, and generates
detailed and brief semantic lower-band text from the assembled conversation-only
Chunk transcript.

---

## User Profile

**Primary User:** Context Steward

**Context:** The steward maintains a PI long-horizon coding session whose active
Thread View must retain useful long-range context after smart compact moves
older conversation into detailed and brief bands.

**Mental Model:** "Recent turns stay rich. Older turns are grouped using their
conversation-only text, then compressed into detailed and brief memory. If the
compressed lower bands are missing or fake, smart compact should stop instead of
quietly giving PI bad memory."

**Key Constraint:** The lower-band path must be inspectable and deterministic
around source preparation and Chunk membership while using model inference only
for the detailed and brief semantic compression outputs.

**Secondary User:** The human operator inspects lower-band readiness, watches
for warnings and failures, clears old dogfood sessions when needed, and runs
both fast service-mock verification and full integration verification before a
story is accepted.

---

## Feature Overview

This feature replaces placeholder detailed and brief lower-band output with
real semantic compression generated from deterministic conversation-only Chunk
transcripts. Turns receive a lower-band conversation projection derived from
smooth components. Chunks are sized from proper token counts of that projection.
Closed Chunks trigger asynchronous detailed and brief compression. Smart compact
requires selected lower-band output to be ready, attempts loud catch-up
generation when it is missing, and fails with a specific error when selected
output cannot be produced.

Flow summary:

- [Conversation-Only Turn Projection](#1-conversation-only-turn-projection):
  closed smooth Turns receive deterministic lower-band text with compact speaker
  markers and no thinking or tool exchange content. AC: `1.1-1.7`
- [Chunk Assembly From Lower-Band Turn Text](#2-chunk-assembly-from-lower-band-turn-text):
  Chunks continue to contain Turns, but boundary decisions use proper token
  counts from the conversation-only Turn projection. AC: `2.1-2.6`
- [Detailed And Brief Generation](#3-detailed-and-brief-generation):
  closed Chunks produce detailed and brief semantic outputs from the same
  conversation-only Chunk transcript, with retry and escalation behavior for
  size misses and provider failures. AC: `3.1-3.8`
- [Smart Compact Readiness And Failure](#4-smart-compact-readiness-and-failure):
  smart compact uses real lower-band outputs only, performs visible catch-up
  when needed, and fails instead of falling back to placeholders. AC: `4.1-4.5`
- [Inspection And Operator Visibility](#5-inspection-and-operator-visibility):
  the operator can inspect lower-band readiness, missing outputs, failures, and
  compact blockers without requiring a formal eval product. AC: `5.1-5.4`
- [Verification And Integration Gates](#6-verification-and-integration-gates):
  placeholder tests are replaced, service-mock tests cover AC-level pathways,
  and full integration tests prove the real GPT OAuth path. AC: `6.1-6.4`

---

## Scope

### In Scope

- Deterministic conversation-only Turn projection derived from smooth
  components.
- One `>` block for the Turn's user prompt.
- Zero or more `●` blocks for assistant-visible output in the Turn.
- Exclusion of thinking, tool calls, and tool results from the lower-band
  conversation projection.
- Inclusion of intermediate assistant-visible output, not only the final
  assistant response.
- Proper persisted token counts for any Turn-derived value that drives Chunk
  boundary decisions.
- Chunk membership based on the conversation-only Turn projection rather than
  full smooth text.
- Conversation-only Chunk transcript assembled from the Turn projections in the
  Chunk.
- Detailed semantic compression from the conversation-only Chunk transcript.
- Brief semantic compression from the same conversation-only Chunk transcript.
- GPT OAuth-backed inference for lower-band compression.
- Runtime `chars / 3.5` estimates for compression routing and retry checks,
  without storing those estimates on source-truth records.
- Size-guided retry behavior for detailed and brief outputs.
- Asynchronous lower-band generation when a Chunk closes, with limited retry.
- Synchronous catch-up generation during smart compact when selected lower-band
  output is missing.
- Specific smart compact failure when required lower-band output cannot be
  generated.
- Removal of deterministic placeholder detailed and brief generation from normal
  runtime behavior.
- Operational logs for routing, retry, escalation, warnings, and integration
  failures.
- Lightweight inspection of lower-band readiness and failures.
- Fast service-mock tests for AC-level behavior.
- Separate full integration tests that exercise the real GPT OAuth-backed
  detailed and brief path.

### Out of Scope

- Semantic model judgment for Chunk boundaries.
- Separate Chunk groupings for detailed and brief.
- Replacement of smooth text with the conversation-only Chunk transcript.
- Silent fallback to deterministic placeholder lower-band output.
- Backward compatibility shims that keep placeholder output selectable as normal
  lower-band behavior.
- Polished migration of existing placeholder Chunk state.
- Formal quality eval dashboards, automatic scoring, or model comparison
  reports.
- A required long-horizon dogfood scenario as formal epic acceptance.
- Multi-assistant speaker notation beyond the current `●` assistant marker.
- Non-GPT-OAuth inference surfaces for this lower-band compression work.

### Assumptions

| ID | Assumption | Status | Owner | Notes |
|----|------------|--------|-------|-------|
| A1 | Smooth component work is available before lower-band projection runs. | Validated from current project direction | Product + Tech Lead | Lower-band projection depends on smooth components, not raw message text. |
| A2 | A Turn normally begins with one user prompt and includes all activity before the next user prompt. | Validated from project model | Product + Tech Lead | Multiple user prompts inside one Turn are treated as upstream segmentation or import problems. |
| A3 | Existing PI sessions can be cleared for this phase instead of migrated through a polished compatibility path. | Validated by product direction | Product | Old placeholder state should not be treated as valid real lower-band output. |
| A4 | Human-guided dogfood is the right first quality calibration method. | Validated by product direction | Product | Formal evals may come later after the product surface is coherent. |
| A5 | Full integration tests can run in an environment with GPT OAuth configured. | Unvalidated | Tech Lead | Tech Design must define command shape and setup expectations. |

---

## Flows & Requirements

### 1. Conversation-Only Turn Projection

Closed Turns need a deterministic lower-band projection before they can drive
Chunk sizing or lower-band compression. The projection is derived from smooth
components. It keeps the user prompt and assistant-visible output, omits
thinking and tool exchange content, and uses compact speaker markers.

1. A Turn closes and smooth components become available.
2. The steward derives the Turn's conversation-only lower-band text.
3. The steward writes one `>` user block for the Turn's user prompt.
4. The steward writes one `●` assistant block for each assistant-visible output
   segment that belongs in the conversation.
5. The steward excludes thinking, tool calls, and tool results.
6. The steward records the projection and the proper token count used for Chunk
   boundary decisions.

#### Acceptance Criteria

**AC-1.1:** The steward derives lower-band Turn text from smooth components, not
raw canonical message text.

- **TC-1.1a: Smooth source used for user prompt**
  - Given: A closed Turn has a ready smooth user prompt component
  - When: lower-band Turn projection runs
  - Then: the `>` user block is generated from the smooth user prompt component
- **TC-1.1b: Raw text is not used when smooth text differs**
  - Given: A closed Turn has raw user text and a different ready smooth user
    prompt component
  - When: lower-band Turn projection runs
  - Then: the projected user block uses the smooth component text

**AC-1.2:** The Turn projection preserves conversation-visible user and
assistant text in source order.

- **TC-1.2a: User prompt appears before assistant output**
  - Given: A closed Turn has a ready user prompt and assistant-visible output
  - When: lower-band Turn projection runs
  - Then: the projection begins with one `>` user block followed by assistant
    blocks in source order
- **TC-1.2b: Intermediate assistant output is included**
  - Given: A closed Turn contains assistant-visible progress or reflection text
    before the final assistant response
  - When: lower-band Turn projection runs
  - Then: that intermediate assistant-visible text appears in the projection
- **TC-1.2c: Speaker marker characters are exact**
  - Given: a closed Turn has a ready user prompt and assistant-visible output
  - When: lower-band Turn projection runs
  - Then: user blocks begin with `>` and assistant-visible blocks begin with `●`

**AC-1.3:** Separate assistant-visible output segments remain separate `●`
blocks.

- **TC-1.3a: Multiple assistant outputs produce multiple markers**
  - Given: A closed Turn has multiple assistant-visible output segments
  - When: lower-band Turn projection runs
  - Then: each segment appears as its own `●` block
- **TC-1.3b: No heavy separators are added**
  - Given: A lower-band Turn projection contains multiple assistant blocks
  - When: the projection text is inspected
  - Then: it uses repeated `●` markers rather than separator banners or
    component metadata

**AC-1.4:** The Turn projection excludes thinking and tool exchange content.

- **TC-1.4a: Thinking is excluded**
  - Given: A closed Turn has thinking components and assistant-visible output
  - When: lower-band Turn projection runs
  - Then: thinking text does not appear in the projection
- **TC-1.4b: Tool calls and tool results are excluded**
  - Given: A closed Turn has tool calls or tool results
  - When: lower-band Turn projection runs
  - Then: tool calls and tool results do not appear in the projection

**AC-1.5:** A user-only Turn projection is valid when no assistant-visible text
exists after exclusions.

- **TC-1.5a: User-only Turn is retained**
  - Given: A closed Turn has a ready user prompt and no assistant-visible output
    after thinking and tool exchange components are excluded
  - When: lower-band Turn projection runs
  - Then: the projection contains the `>` user block and remains eligible for
    Chunk assembly

**AC-1.6:** A Turn is not lower-band chunkable until required smooth components
are ready.

- **TC-1.6a: Missing user prompt component blocks projection**
  - Given: A closed Turn has no ready smooth user prompt component
  - When: lower-band chunking evaluates the Turn
  - Then: the Turn is not eligible for lower-band Chunk assembly
- **TC-1.6b: Missing required assistant component blocks projection**
  - Given: A closed Turn has assistant-visible output that lacks required smooth
    component state
  - When: lower-band chunking evaluates the Turn
  - Then: the Turn is not eligible for lower-band Chunk assembly
- **TC-1.6c: Catch-up attempts are visible**
  - Given: smart compact reaches a Turn whose required smooth components are not
    ready
  - When: the system attempts synchronous catch-up generation
  - Then: the catch-up attempts write visible standard-error warnings
- **TC-1.6d: Smooth catch-up failure stops compact**
  - Given: required smooth components cannot be produced after allowed catch-up
    attempts
  - When: smart compact prepares selected lower-band output
  - Then: smart compact stops with a specific error describing the missing Turn
    readiness
- **TC-1.6e: Multiple user prompts block projection**
  - Given: a Turn contains multiple user prompts
  - When: lower-band Turn projection evaluates the Turn
  - Then: the Turn is reported as invalid for lower-band projection rather than
    being flattened into a normal transcript

**AC-1.7:** The conversation-only Turn projection text is stable for the same
smooth component state.

- **TC-1.7a: Projection text is retained or reproducible**
  - Given: a Turn has ready smooth components and lower-band projection has run
  - When: the system later needs that Turn's conversation-only projection
  - Then: the same projection text is available from stored state or reproduced
    deterministically from the same smooth component state
- **TC-1.7b: Same smooth state produces same projection text**
  - Given: the same ready smooth component state is projected more than once
  - When: lower-band Turn projection runs
  - Then: the emitted conversation-only text is identical across runs

### 2. Chunk Assembly From Lower-Band Turn Text

Chunks continue to contain Turns. The change is the text used for boundary
decisions and lower-band compression source. Chunk boundary decisions use the
proper token count of the per-Turn conversation-only projection. The
conversation-only Chunk transcript is assembled from the projections for the
Turns in the Chunk. Smooth text remains a separate representation.

1. A closed Turn has a ready conversation-only projection and proper token
   count.
2. The steward evaluates whether the Turn fits in the current Chunk.
3. The steward adds the Turn to the current Chunk or closes the current Chunk
   before starting the next one.
4. The steward assembles the conversation-only Chunk transcript from the Turns
   in the Chunk.
5. The steward leaves smooth text available as a separate representation.

#### Acceptance Criteria

**AC-2.1:** Chunk boundary decisions use proper token counts from the
conversation-only Turn projection.

- **TC-2.1a: Conversation-only count drives append decision**
  - Given: A current Chunk and a next Turn with a ready conversation-only
    projection
  - When: the steward evaluates whether to append the Turn
  - Then: the decision uses the proper token count for the Turn projection
- **TC-2.1b: Full smooth text count does not drive lower-band boundary**
  - Given: A tool-heavy Turn has large smooth text and small conversation-only
    projection text
  - When: Chunk assembly evaluates the Turn
  - Then: the boundary decision is based on the conversation-only projection
    count

**AC-2.2:** Token counts that drive Chunk boundaries are stable proper token
counts.

- **TC-2.2a: Boundary count is persisted**
  - Given: A Turn receives a conversation-only projection
  - When: the projection becomes eligible for Chunk assembly
  - Then: the proper token count used for boundary decisions is stored with the
    derived Turn state
- **TC-2.2b: Runtime estimates are not persisted as boundary counts**
  - Given: compression routing uses `chars / 3.5` estimates
  - When: boundary-driving Turn state is inspected
  - Then: those rough estimates are not stored as the boundary token count
- **TC-2.2c: Boundary count is reproducible**
  - Given: the same conversation-only Turn projection is counted with the same
    token counting policy
  - When: the proper token count is produced again
  - Then: the count is stable and reproducible for that projection and policy
- **TC-2.2d: Boundary count failure blocks chunking**
  - Given: a conversation-only Turn projection exists but its proper token count
    cannot be produced
  - When: Chunk assembly evaluates the Turn
  - Then: the Turn is not added to a Chunk and the failure is reported

**AC-2.3:** The conversation-only Chunk transcript is assembled from the Turn
projections in that Chunk.

- **TC-2.3a: Chunk transcript preserves Turn order**
  - Given: A Chunk contains multiple Turns with ready conversation-only
    projections
  - When: the Chunk transcript is assembled
  - Then: the transcript concatenates those Turn projections in Chunk order
- **TC-2.3b: Chunk transcript excludes tool and thinking content**
  - Given: Turns in the Chunk contain thinking and tool exchange components
  - When: the Chunk transcript is assembled
  - Then: thinking, tool calls, and tool results remain absent
- **TC-2.3c: User-only Chunk transcript is valid**
  - Given: every Turn projection in a Chunk contains a user block and no
    assistant-visible blocks
  - When: the Chunk transcript is assembled
  - Then: the transcript remains valid lower-band compression input

**AC-2.4:** Detailed and brief use the same conversation-only Chunk transcript
as source.

- **TC-2.4a: Shared source transcript**
  - Given: A closed Chunk is ready for lower-band generation
  - When: detailed and brief generation run
  - Then: both outputs are generated from the same conversation-only Chunk
    transcript
- **TC-2.4b: Brief is not generated from detailed**
  - Given: detailed output exists for a Chunk
  - When: brief generation runs
  - Then: brief uses the conversation-only Chunk transcript rather than the
    detailed output

**AC-2.5:** The conversation-only Chunk transcript does not replace smooth text.

- **TC-2.5a: Smooth representation remains available**
  - Given: A Chunk has a conversation-only transcript
  - When: smooth-band materialization needs smooth text
  - Then: smooth text remains available as its own representation
- **TC-2.5b: Lower-band source remains separate**
  - Given: A Chunk has both smooth text and conversation-only transcript state
  - When: lower-band generation runs
  - Then: it uses the conversation-only transcript rather than smooth text

**AC-2.6:** Existing closed Chunk membership is not silently rewritten under the
new lower-band basis.

- **TC-2.6a: Closed Chunk membership is not mutated in place**
  - Given: a closed Chunk already contains a set of Turns
  - When: lower-band Chunk assembly or repair evaluates new boundary rules
  - Then: the closed Chunk's Turn list is not silently edited in place
- **TC-2.6b: Old placeholder Chunk state is not selectable**
  - Given: a Thread contains Chunks created under the old placeholder lower-band
    path
  - When: smart compact selects lower-band material after this epic
  - Then: those Chunks are not selectable as real lower-band output until they
    have been cleared, rebuilt, or explicitly superseded by the new path
- **TC-2.6c: Rebuild or supersession is explicit**
  - Given: existing Chunk state must be replaced to use conversation-only
    boundary counts
  - When: the replacement occurs
  - Then: the operator can distinguish the new lower-band-ready Chunk state from
    old placeholder-era state

### 3. Detailed And Brief Generation

Closed Chunks trigger semantic lower-band generation. Detailed and brief are
sibling outputs from the same conversation-only Chunk transcript. Detailed is a
gentler compression. Brief is more aggressive and has its own prompt and quality
expectations. Both use the GPT OAuth-backed inference path for this epic. The
compressed outputs are semantic lower-band summaries and do not need to preserve
the `>` and `●` source transcript markers.

1. A Chunk closes and its conversation-only transcript is ready.
2. The steward triggers asynchronous generation for detailed and brief outputs.
3. The system routes the generation request using a runtime size estimate.
4. The system checks output size against the band-specific target range.
5. The system retries when output falls outside the range.
6. The third attempt escalates to GPT-5.5 medium and accepts the first response.
7. Provider failures retry through the configured lower-band generation retry
   path.
8. The final accepted output is stored with lean readiness/status/error state.

#### Acceptance Criteria

**AC-3.1:** Closed Chunks trigger asynchronous detailed and brief generation.

- **TC-3.1a: Chunk close triggers generation work**
  - Given: A Chunk closes with a ready conversation-only transcript
  - When: close processing completes
  - Then: detailed and brief generation work is triggered asynchronously or by
    an alternate worker process
- **TC-3.1b: Chunk close does not wait on model latency**
  - Given: lower-band generation requires model inference
  - When: the Chunk close path runs
  - Then: the deterministic close path is not blocked on model response latency

**AC-3.2:** Detailed and brief outputs are generated by separate prompts from
the same source transcript.

- **TC-3.2a: Detailed request uses detailed prompt**
  - Given: A Chunk has a ready conversation-only transcript
  - When: detailed generation runs
  - Then: the generation request uses the detailed-band prompt and stores the
    accepted output under the detailed band
- **TC-3.2b: Brief request uses brief prompt**
  - Given: A Chunk has a ready conversation-only transcript
  - When: brief generation runs
  - Then: the generation request uses the brief-band prompt and stores the
    accepted output under the brief band
- **TC-3.2c: Outputs do not derive from each other**
  - Given: both detailed and brief are generated for a Chunk
  - When: their source is inspected through available evidence
  - Then: both trace to the conversation-only Chunk transcript rather than one
    lower-band output deriving from the other
- **TC-3.2d: Compressed output need not preserve source markers**
  - Given: the conversation-only Chunk transcript uses `>` and `●` markers
  - When: detailed or brief generation accepts an output
  - Then: the output is valid as semantic lower-band text even when it does not
    preserve those source transcript markers

**AC-3.3:** Compression routing uses runtime estimates without storing them on
source-truth records.

- **TC-3.3a: Routing estimate uses character count**
  - Given: A conversation-only Chunk transcript is ready
  - When: compression routing runs
  - Then: the system estimates routing size using character count divided by
    `3.5`
- **TC-3.3b: Routing estimates are not persisted**
  - Given: compression generation completes
  - When: the Chunk's source-truth lower-band artifact state is inspected
  - Then: routing estimates and estimated token counts are not stored there
- **TC-3.3c: Oversized input warns**
  - Given: runtime routing estimates a Chunk transcript above `4,000` tokens
  - When: compression generation prepares the input
  - Then: the system writes a standard-error warning and truncates compression
    input for that generation attempt to the configured `4,000` estimated-token
    ceiling

**AC-3.4:** Detailed output follows strong size guidance with deterministic
range checks.

- **TC-3.4a: Detailed target range checked**
  - Given: detailed generation returns output for a Chunk transcript
  - When: output size is estimated
  - Then: the system checks whether the output is within `15%` to `50%` of the
    conversation-only transcript estimate
- **TC-3.4b: Detailed miss retries with size feedback**
  - Given: detailed output falls outside the allowed range on attempt 1
  - When: the retry runs
  - Then: the retry context includes the previous attempt, the target range, and
    where the previous attempt landed

**AC-3.5:** Brief output follows strong size guidance with deterministic range
checks.

- **TC-3.5a: Brief target range checked**
  - Given: brief generation returns output for a Chunk transcript
  - When: output size is estimated
  - Then: the system checks whether the output is within `1%` to `20%` of the
    conversation-only transcript estimate
- **TC-3.5b: Brief miss retries with size feedback**
  - Given: brief output falls outside the allowed range on attempt 1
  - When: the retry runs
  - Then: the retry context includes the previous attempt, the target range, and
    where the previous attempt landed

**AC-3.6:** The third size retry escalates and accepts the first escalated
response.

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
  - Then: the logs contain those details, while source-truth artifact state does
    not store model selection, prompt version, routing estimate, compression
    ratio, or retry history

**AC-3.8:** Provider, network, auth, or model failures retry and then produce
explicit failure state.

- **TC-3.8a: Provider failure leaves output not ready during retry**
  - Given: detailed or brief generation encounters a provider, network, auth, or
    model error
  - When: retry attempts remain
  - Then: the output is not marked ready and the retry activity is logged
- **TC-3.8b: Exhausted provider failures store failed state**
  - Given: detailed or brief generation encounters provider, network, auth, or
    model errors until allowed attempts are exhausted
  - When: generation stops
  - Then: the lower-band artifact records failed status and the last error code
    or message

### 4. Smart Compact Readiness And Failure

Smart compact must use real lower-band outputs for selected Chunks. If selected
output is missing, smart compact may perform synchronous catch-up generation.
Catch-up is abnormal and visible. If required output cannot be produced, compact
fails with a specific error. Placeholder detailed and brief output is not a
fallback path.

1. Smart compact selects Chunks for detailed and brief bands.
2. The steward checks whether the selected lower-band outputs are ready.
3. If required output is missing, the steward attempts synchronous catch-up
   generation and writes a standard-error warning.
4. If catch-up succeeds, compact continues.
5. If catch-up fails, compact stops with a specific error.

#### Acceptance Criteria

**AC-4.1:** Smart compact requires selected lower-band outputs to be ready.

- **TC-4.1a: Detailed-selected Chunk requires detailed output**
  - Given: smart compact selects a Chunk for the detailed band
  - When: compact validates lower-band readiness
  - Then: the Chunk must have ready detailed output
- **TC-4.1b: Brief-selected Chunk requires brief output**
  - Given: smart compact selects a Chunk for the brief band
  - When: compact validates lower-band readiness
  - Then: the Chunk must have ready brief output

**AC-4.2:** Smart compact performs visible catch-up when selected lower-band
output is missing.

- **TC-4.2a: Missing selected output triggers catch-up**
  - Given: a selected Chunk is missing required detailed or brief output
  - When: smart compact prepares selected lower-band material
  - Then: the system attempts synchronous generation for the missing output
- **TC-4.2b: Catch-up warning is visible**
  - Given: smart compact performs synchronous lower-band catch-up
  - When: catch-up starts
  - Then: the system writes a standard-error warning identifying the selected
    Chunk and band being regenerated

**AC-4.3:** Smart compact fails specifically when required lower-band output
cannot be produced.

- **TC-4.3a: Detailed failure blocks detailed compact**
  - Given: a selected detailed Chunk cannot produce detailed output after
    allowed catch-up
  - When: smart compact prepares lower-band material
  - Then: compact fails with a specific error identifying the Chunk and detailed
    band
- **TC-4.3b: Brief failure blocks brief compact**
  - Given: a selected brief Chunk cannot produce brief output after allowed
    catch-up
  - When: smart compact prepares lower-band material
  - Then: compact fails with a specific error identifying the Chunk and brief
    band

**AC-4.4:** Smart compact does not use deterministic placeholder output as a
runtime fallback.

- **TC-4.4a: Placeholder output is not emitted for selected lower bands**
  - Given: selected lower-band semantic output is missing or failed
  - When: smart compact prepares generated session output
  - Then: it does not emit deterministic placeholder detailed or brief text
- **TC-4.4b: Old placeholder state is not treated as ready**
  - Given: a Chunk has old deterministic placeholder lower-band data but no real
    semantic lower-band output
  - When: smart compact validates lower-band readiness
  - Then: the Chunk is not treated as ready for selected detailed or brief
    output

**AC-4.5:** Existing placeholder generation is removed from normal runtime
behavior.

- **TC-4.5a: Placeholder generator is not reachable through normal compact**
  - Given: smart compact needs lower-band output
  - When: normal runtime behavior runs
  - Then: the deterministic placeholder generator is not invoked as a fallback
- **TC-4.5b: Placeholder tests are replaced**
  - Given: tests previously asserted deterministic placeholder lower-band
    generation
  - When: the epic's tests are reviewed
  - Then: those tests have been removed or rewritten to assert real lower-band
    behavior

### 5. Inspection And Operator Visibility

The operator needs enough visibility to diagnose lower-band preparation without
turning this epic into a formal eval system. Inspection reports readiness,
missing outputs, failures, catch-up, and compact blockers. It does not score
summary quality or compare models.

1. The operator inspects a Thread or active compact preparation.
2. The system reports whether closed Chunks have conversation-only transcripts.
3. The system reports detailed and brief output status for Chunks.
4. The system reports failure messages and compact blockers.
5. The system leaves quality judgment to human dogfood and later eval work.

#### Acceptance Criteria

**AC-5.1:** Inspection reports lower-band readiness for closed Chunks.

- **TC-5.1a: Transcript readiness visible**
  - Given: a closed Chunk exists
  - When: the operator inspects lower-band state
  - Then: the report shows whether the conversation-only Chunk transcript is
    present and usable
- **TC-5.1b: Detailed and brief status visible**
  - Given: a closed Chunk exists
  - When: the operator inspects lower-band state
  - Then: the report shows detailed and brief status as ready, pending/not
    ready, or failed

**AC-5.2:** Inspection reports actionable failure information.

- **TC-5.2a: Failed lower-band output includes error summary**
  - Given: detailed or brief generation failed for a Chunk
  - When: the operator inspects lower-band state
  - Then: the report includes the last error code or message for that band
- **TC-5.2b: Compact blocker identifies Chunk and band**
  - Given: smart compact fails because selected lower-band output cannot be
    produced
  - When: the failure is reported
  - Then: the report identifies the blocking Chunk and band

**AC-5.3:** Logs expose abnormal lower-band generation events.

- **TC-5.3a: Retry and escalation logged**
  - Given: detailed or brief generation retries or escalates
  - When: operational logs are inspected
  - Then: retry and escalation events are visible
- **TC-5.3b: Catch-up generation logged**
  - Given: smart compact performs synchronous catch-up generation
  - When: standard error or operational logs are inspected
  - Then: the event is visible with the affected Chunk and band

**AC-5.4:** Inspection does not become formal quality evaluation.

- **TC-5.4a: No automatic quality grade required**
  - Given: detailed or brief output exists
  - When: lower-band inspection runs
  - Then: the report does not need to assign an automatic quality score
- **TC-5.4b: No model comparison dashboard required**
  - Given: lower-band generation has run
  - When: epic requirements are evaluated
  - Then: model comparison dashboards and formal eval reports are not required
    for this epic

### 6. Verification And Integration Gates

This epic replaces a mock lower-band path with real behavior. Tests must stop
blessing deterministic placeholder generation. Fast service-mock tests should
exercise acceptance-level pathways with only external calls mocked. Separate
full integration tests should exercise the real GPT OAuth-backed inference path.
Story 0 establishes the verification command shape. The GPT OAuth integration
path must be executable before compression stories that depend on it are
accepted. After both verification groups exist, every story acceptance requires
both to pass.

1. Existing placeholder expectations are removed or rewritten.
2. Service-mock tests cover the main AC pathways in process.
3. Full integration tests exercise real GPT OAuth lower-band generation.
4. Story acceptance requires both verification levels.

#### Acceptance Criteria

**AC-6.1:** Service-mock tests cover acceptance-level pathways.

- **TC-6.1a: Service-mock tests enter through meaningful surfaces**
  - Given: a story implements lower-band behavior
  - When: its fast tests run
  - Then: they exercise service or command surfaces rather than only isolated
    helper functions
- **TC-6.1b: Service-mock tests mock only external calls where practical**
  - Given: lower-band generation depends on GPT OAuth inference
  - When: service-mock tests run
  - Then: the external inference call is mocked while local pathway logic is
    exercised in process

**AC-6.2:** Full integration tests exercise the real GPT OAuth-backed lower-band
path.

- **TC-6.2a: Detailed integration path runs**
  - Given: the integration environment has required GPT OAuth configuration
  - When: the full integration verification command runs
  - Then: it exercises real detailed generation end to end for a basic Chunk
- **TC-6.2b: Brief integration path runs**
  - Given: the integration environment has required GPT OAuth configuration
  - When: the full integration verification command runs
  - Then: it exercises real brief generation end to end for a basic Chunk

**AC-6.3:** Integration verification fails when required integration setup is
missing or broken.

- **TC-6.3a: Missing OAuth setup fails integration gate**
  - Given: required GPT OAuth configuration is missing
  - When: the full integration verification command runs
  - Then: the command fails rather than silently skipping the tested integration
    surface
- **TC-6.3b: Broken model wiring fails integration gate**
  - Given: GPT OAuth configuration exists but lower-band inference wiring is
    broken
  - When: the full integration verification command runs
  - Then: the command fails with an actionable integration error

**AC-6.4:** Both verification levels gate story acceptance.

- **TC-6.4a: Fast verification required**
  - Given: a story in this epic is submitted for acceptance
  - When: acceptance evidence is reviewed
  - Then: the fast service-mock verification group has passed
- **TC-6.4b: Full integration verification required**
  - Given: a story in this epic is submitted for acceptance after both
    verification groups exist
  - When: acceptance evidence is reviewed
  - Then: the full integration verification group has passed
- **TC-6.4c: Compression stories wait for integration gate**
  - Given: a story introduces or depends on GPT OAuth lower-band compression
  - When: the story is submitted for acceptance
  - Then: the real GPT OAuth integration verification group exists and passes

---

## Data Contracts

### Conversation-Only Turn Projection

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | enum | yes | Projection readiness state. Required states are ready, pending/not ready, failed, and invalid. Tech Design may choose exact enum names. |
| text | string | required when ready | Deterministic conversation-only Turn text using `>` and `●` markers. |
| tokenCount | integer | required when ready | Proper token count used for Chunk boundary decisions. |
| error | string or structured error | required when failed or invalid | Last failure or invalidity reason when the projection cannot be produced or used. |
| updatedAt | timestamp | optional | ISO 8601 UTC time the projection status or text last changed. |

### Lower-Band Chunk Output

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | enum | yes | Output state for detailed or brief. Required states are ready, pending/not ready, and failed. Tech Design may choose exact enum names. |
| text | string | required when ready | Final accepted semantic lower-band text for the band. |
| error | string or structured error | required when failed | Last failure reason when output cannot be generated. |
| updatedAt | timestamp | optional | ISO 8601 UTC time the output status or text last changed. |

Lower-band output text is a semantic summary for the selected band. It is not
required to preserve the `>` and `●` speaker markers from the source
conversation-only Chunk transcript. The exact prose or bullet format belongs to
prompt calibration and Tech Design.

### Compression Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Runtime estimate formula | `ceil(characterCount / 3.5)` | Used for compression routing and size checks. Not stored on source-truth records. |
| Detailed size range | `15%` to `50%` of conversation-only Chunk transcript estimate | Attempt 1 and 2 retry when output falls outside this range. |
| Brief size range | `1%` to `20%` of conversation-only Chunk transcript estimate | Attempt 1 and 2 retry when output falls outside this range. |
| Input ceiling | `4,000` estimated tokens | Inputs above this ceiling warn to standard error and truncate for the generation attempt. |
| Escalation attempt | Attempt 3 | Escalates to GPT-5.5 medium and accepts the first response regardless of size. |

### Operational Logs

| Event | Required Information |
|-------|----------------------|
| Smooth catch-up attempt | Thread or Turn identifier, reason catch-up was needed, result. |
| Lower-band catch-up attempt | Thread, Chunk, band, reason catch-up was needed, result. |
| Size retry | Chunk, band, attempt number, allowed range, previous estimated size. |
| Escalation | Chunk, band, escalation attempt, result. |
| Provider failure retry | Chunk, band, attempt number, provider failure category, result. |
| Integration failure | Verification command, integration surface, actionable error. |

Source-truth lower-band artifact records do not store routing estimates, token
estimates, compression ratios, selected model, reasoning effort, prompt version,
retry history, or escalation history.

---

## Non-Functional Requirements

### Observability

- Missing lower-band output selected by smart compact writes a visible
  standard-error warning before catch-up generation begins.
- Smart compact lower-band failures identify the affected Chunk and band.
- Retry, escalation, provider failure, and catch-up events are visible in
  operational logs.

### Reliability

- Placeholder lower-band output is not used as silent fallback behavior.
- Lower-band generation failure must not produce apparently successful smart
  compact output for selected bands.
- Full integration verification fails when required GPT OAuth integration setup
  is missing or broken.

### Performance

- Chunk close does not block on model-backed detailed or brief generation.
- Smart compact catch-up generation is allowed only as an abnormal repair path
  and may block compact until selected lower-band output is ready or failed.

---

## Tech Design Questions

1. Where should the conversation-only Turn projection be stored so it remains
   tied to Turn-derived smooth component state while keeping source-truth records
   lean?
2. How should existing Chunk state be cleared, rebuilt, or superseded when
   switching boundary decisions from full smooth text to conversation-only Turn
   counts without silently mutating closed Chunk membership?
3. Which proper token counter should produce the persisted Turn projection count
   used for Chunk boundaries?
4. How should asynchronous lower-band generation be triggered when a Chunk
   closes, and where should limited retry state live while avoiding retry
   transcript persistence in source truth?
5. How should operational logs be written and located so routing, retries,
   escalation, and catch-up warnings are visible during dogfood?
6. How should the GPT OAuth lower-band compression provider share or diverge
   from the existing GPT OAuth smoothing provider?
7. What exact verification commands or test groups should represent fast
   service-mock verification and full integration verification in this repo?
8. How should old placeholder generation code and tests be removed without
   leaving a hidden runtime compatibility path?
9. What exact detailed and brief prompts should be used for the first dogfood
   pass, and how should prompt calibration artifacts be kept outside formal
   source-truth lower-band records?
10. How should smart compact selection report lower-band blockers alongside
    existing band allocation and readiness reports?

---

## Recommended Story Breakdown

### Story 0: Foundation And Verification Gates

**Delivers:** Shared lower-band terminology, test fixtures, verification command
shape, and removal plan for placeholder assumptions.

**Prerequisite:** Epic accepted.

**ACs covered:**
- AC-6.1
- AC-6.4

### Story 1: Conversation-Only Turn Projection

**Delivers:** Closed smooth Turns can produce deterministic lower-band
conversation text with proper boundary token counts.

**Prerequisite:** Story 0.

**ACs covered:**
- AC-1.1
- AC-1.2
- AC-1.3
- AC-1.4
- AC-1.5
- AC-1.6
- AC-1.7
- AC-2.2

### Story 2: Chunk Assembly From Turn Projections

**Delivers:** Chunks contain Turns selected by conversation-only projection
counts, and Chunk transcripts assemble from Turn projections while smooth text
remains separate.

**Prerequisite:** Story 1.

**ACs covered:**
- AC-2.1
- AC-2.3
- AC-2.4
- AC-2.5
- AC-2.6

### Story 3: GPT OAuth Lower-Band Compression

**Delivers:** Detailed and brief generation from conversation-only Chunk
transcripts through the GPT OAuth-backed inference path.

**Prerequisite:** Story 2.

**ACs covered:**
- AC-3.1
- AC-3.2
- AC-3.3
- AC-3.8
- AC-6.2
- AC-6.3

**Acceptance evidence:** Representative conversation-only Chunk transcripts
have been manually reviewed with generated detailed and brief outputs. Notes,
logs, or captured examples are sufficient; an automatic quality score, eval
dashboard, or model comparison report is not required.

### Story 4: Size Guidance, Retry, And Escalation

**Delivers:** Detailed and brief outputs follow band-specific size guidance,
retry with attempt history in the active generation context, escalate on the
third attempt, and keep source-truth artifact records lean.

**Prerequisite:** Story 3.

**ACs covered:**
- AC-3.4
- AC-3.5
- AC-3.6
- AC-3.7

### Story 5: Smart Compact Lower-Band Readiness

**Delivers:** Smart compact requires selected real lower-band outputs, performs
visible catch-up when needed, and fails specifically when selected output cannot
be produced.

**Prerequisite:** Story 4.

**ACs covered:**
- AC-4.1
- AC-4.2
- AC-4.3

### Story 6: Remove Placeholder Runtime Path

**Delivers:** Deterministic placeholder detailed/brief generation is removed
from normal runtime behavior and tests no longer bless placeholder fallback.

**Prerequisite:** Story 5.

**ACs covered:**
- AC-4.4
- AC-4.5

### Story 7: Lower-Band Inspection And Reporting

**Delivers:** Operator inspection reports lower-band transcript readiness,
detailed/brief status, failures, catch-up events, and compact blockers without
becoming a formal eval system.

**Prerequisite:** Story 6.

Inspection support may be delivered incrementally in earlier stories when it
helps validate compression and smart compact behavior. Story 7 completes the
formal inspection AC coverage.

**ACs covered:**
- AC-5.1
- AC-5.2
- AC-5.3
- AC-5.4

---

## Validation Checklist

- [ ] User Profile has all four fields and secondary user context.
- [ ] Feature Overview describes the new capability and includes flow summary.
- [ ] Scope boundaries are explicit.
- [ ] Every AC has at least one TC.
- [ ] TCs cover happy paths, missing state, failure paths, and integration
      failure where applicable.
- [ ] Data contracts describe boundary-visible records and logs without
      TypeScript shapes.
- [ ] Tech Design Questions capture implementation decisions without forcing
      them into the epic.
- [ ] Story breakdown covers all ACs.
- [ ] Placeholder fallback is explicitly excluded.
- [ ] Service-mock and full integration verification expectations are both
      represented.
- [ ] Existing closed Chunk membership is not silently rewritten under the new
      lower-band basis.
