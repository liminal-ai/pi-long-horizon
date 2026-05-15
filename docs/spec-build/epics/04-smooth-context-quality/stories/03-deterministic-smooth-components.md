# Story 3: Deterministic Smooth Components

### Summary
<!-- Jira: Summary field -->

Assistant text, thinking text, and tool work are rendered during turn-end into deterministic smooth components with compact JSON tool exchanges and consistent omission markers.

### Description
<!-- Jira: Description field -->

**User Profile**

Primary User: Context Steward. The steward needs the smooth band to remain high-fidelity enough for future agents to understand what happened in a Turn. Tool-heavy Turns should retain the outline of calls and results without preserving giant payloads. Assistant responses should remain full text. Thinking should not drag encrypted signatures into the smooth band.

**Objective**

Deliver deterministic rendering for non-user smooth components during turn-end maintenance. Assistant text is preserved fully. Thinking keeps only plaintext reasoning text when available and never serializes encrypted thinking signatures. Tool calls and results are rendered as interleaved compact JSON exchanges. Oversized string fields in tool calls and tool results are capped at 500 characters with an explicit omitted-character marker. When combined with the user prompt component from Story 2, these deterministic components allow the system to materialize a complete regenerated smooth Turn.

**Scope**

In scope:
- Full assistant text component rendering with no response cap
- Turn-end/closed-Turn generation of assistant, thinking, and tool exchange components for closed Turns only
- `[final]` label only when provider metadata explicitly marks final answer
- `[assistant]` label otherwise, with optional future actor label
- Thinking component renders plaintext `text`/`thinking` only
- Thinking signatures and encrypted payloads are never included in smooth text
- Tool exchanges pair calls and results by internal ids
- Compact JSON rendering for tool calls and tool results
- Oversized string fields capped at 500 characters
- Omission marker format: `[omitted: N chars]`
- Failed tool results retained and marked, not dropped
- Live older full-fidelity tool-result truncation cap updated to 500 for policy consistency
- Complete smooth Turn readiness handoff after deterministic components are generated

Out of scope:
- User prompt smoothing model calls (Story 2)
- Assistant response compression
- Whole-turn summary
- Detailed/brief band semantic summaries

**Dependencies**

- Story 1 (component-first smooth Turn foundation)

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-3.1:** Assistant text is preserved as high-fidelity smooth content.

- **TC-3.1a: Assistant response text is preserved without cap**
  - Given: an assistant message contains long text
  - When: the assistant component is rendered
  - Then: the full assistant text is preserved
- **TC-3.1b: Assistant tool calls are not rendered as assistant prose**
  - Given: an assistant message contains tool call parts
  - When: smooth components are rendered
  - Then: tool calls are represented in tool exchanges rather than assistant text

**AC-3.2:** Thinking content excludes signatures and encrypted payloads.

- **TC-3.2a: Plaintext thinking text can be rendered**
  - Given: a reasoning part contains plaintext thinking text
  - When: the thinking component is rendered
  - Then: the plaintext text can appear in the thinking component
- **TC-3.2b: Thinking signatures are never rendered**
  - Given: a reasoning part contains `thinkingSignature` or encrypted payload content
  - When: the thinking component is rendered
  - Then: that signature or encrypted payload does not appear in smooth output
- **TC-3.2c: Missing plaintext thinking is omitted**
  - Given: a reasoning part contains only an encrypted signature
  - When: the thinking component is rendered
  - Then: the component is omitted or marked omitted without blocking readiness

**AC-3.3:** Tool calls and results render as compact interleaved JSON exchanges.

- **TC-3.3a: Tool call JSON shape is preserved**
  - Given: a tool call has name and arguments
  - When: tool exchanges are rendered
  - Then: the rendered call keeps compact JSON shape with name and arguments
- **TC-3.3b: Tool result JSON shape is preserved**
  - Given: a tool result has status and output fields
  - When: tool exchanges are rendered
  - Then: the rendered result keeps compact JSON shape with status and output information
- **TC-3.3c: Calls and results are interleaved**
  - Given: a Turn contains multiple tool calls and matching results
  - When: tool exchanges are rendered
  - Then: each call is followed by its corresponding result where possible

**AC-3.4:** Oversized tool exchange strings are omitted consistently.

- **TC-3.4a: Large tool call argument string is capped**
  - Given: a tool call writes or passes a large string payload
  - When: tool exchanges are rendered
  - Then: the oversized string field is capped at 500 characters and includes `[omitted: N chars]`
- **TC-3.4b: Large tool result output is capped**
  - Given: a tool result output exceeds 500 characters
  - When: tool exchanges are rendered
  - Then: the output is capped at 500 characters and includes `[omitted: N chars]`
- **TC-3.4c: Failed tool result is retained**
  - Given: a tool result represents a failure
  - When: tool exchanges are rendered
  - Then: the failure is retained and clearly marked rather than removed

**AC-3.5:** Tool-result truncation policy stays coherent across full-fidelity and smooth bands.

- **TC-3.5a: Older live full-fidelity tool results truncate to 500 characters**
  - Given: a tool result crosses the live prompt-visible truncation frontier
  - When: truncation is applied
  - Then: the visible result uses the 500-character cap
- **TC-3.5b: Smart compact pre-truncation uses the same cap**
  - Given: smart compact generates a PI rollout with full-fidelity tool results beyond the frontier
  - When: prompt-visible truncation is applied before writing/reload
  - Then: the same 500-character cap is used

**AC-3.6:** Deterministic component generation only finalizes closed Turns.

- **TC-3.6a: Open canonical Turn remains pending**
  - Given: a canonical Turn is still open
  - When: deterministic component generation is evaluated
  - Then: assistant, thinking, and tool exchange components are not finalized and complete smooth readiness remains pending
- **TC-3.6b: Closed canonical Turn generates deterministic components**
  - Given: a canonical Turn is closed and has assistant/tool/thinking source parts
  - When: deterministic component generation runs
  - Then: required deterministic components are generated from the closed Turn source

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Smooth band should preserve maximum useful fidelity while reducing tool-work bulk. The current deterministic smooth format serializes assistant tool-call JSON in full, caps only tool results, and serializes whole reasoning objects including signatures. This story replaces those rules with deterministic component renderers that future agents can read quickly.

This is the closed-Turn half of the new smoothing pass. At message-end, user smoothing may already be in flight or complete. When the canonical Turn is closed, deterministic component generation should catch up the assistant, thinking, and tool exchange components, then let readiness evaluation determine whether the complete regenerated smooth Turn is available for smart compact and lower-band chunking. Do not finalize deterministic components for open canonical Turns.

Tool calls are kept JSON-shaped because repeated correct tool syntax is useful model context. The cap applies to string fields, not to the whole exchange object, so paths, command names, and argument keys remain visible.

#### Implementation Targets

| Area | Files / Modules |
|------|-----------------|
| Component renderers | `src/thread/async-thread/services/smooth-turn-format.ts` or new renderer modules |
| Smooth service integration | `src/thread/async-thread/services/smooth-turn-service.ts` |
| Turn-end maintenance | `src/thread/async-thread/services/async-thread-run-service.ts`, `src/context-steward/pi/pi-extension.ts` |
| Tool truncation policy | `src/thread-view/services/live-tool-result-truncation.ts` |
| PI prompt pre-truncation | `src/thread-view/targets/pi/pi-thread-view-prompt-truncation.ts` |
| Prompt-visible projection | `src/thread-view/services/prompt-visible-tool-result-projection.ts` |

#### Test Mapping

| TC | Test File / Check | Test Description |
|----|-------------------|------------------|
| TC-3.1a | `tests/thread/smooth-turn-service.test.ts` | assistant response text preserved without cap |
| TC-3.1b | `tests/thread/smooth-turn-service.test.ts` | assistant tool calls render in tool exchanges |
| TC-3.2a | `tests/thread/smooth-turn-service.test.ts` | plaintext thinking can be rendered |
| TC-3.2b | `tests/thread/smooth-turn-service.test.ts` | thinking signatures never render |
| TC-3.2c | `tests/thread/smooth-turn-service.test.ts` | encrypted-only thinking is omitted |
| TC-3.3a | `tests/thread/smooth-turn-service.test.ts` | tool call JSON shape is preserved |
| TC-3.3b | `tests/thread/smooth-turn-service.test.ts` | tool result JSON shape is preserved |
| TC-3.3c | `tests/thread/smooth-turn-service.test.ts` | calls and results are interleaved |
| TC-3.4a | `tests/thread/smooth-turn-service.test.ts` | large tool call argument string is capped |
| TC-3.4b | `tests/thread/smooth-turn-service.test.ts` | large tool result output is capped |
| TC-3.4c | `tests/thread/smooth-turn-service.test.ts` | failed tool result is retained |
| TC-3.5a | `tests/thread-view/prompt-visible-tool-result-projection.test.ts` | live older full-fidelity tool results cap at 500 |
| TC-3.5b | `tests/thread-view/pi-thread-view-prompt-truncation.test.ts` | smart compact pre-truncation cap is 500 |
| TC-3.6a | `tests/thread/async-thread-run-service.test.ts` | open canonical turn remains pending |
| TC-3.6b | `tests/thread/async-thread-run-service.test.ts` | closed canonical turn generates deterministic components |

#### Non-TC Decided Tests

- `tests/thread/smooth-turn-service.test.ts`: unpaired tool results are rendered in an explicit unpaired section rather than dropped.
- `tests/thread/smooth-turn-service.test.ts`: compact JSON rendering drops noisy call ids unless needed for unpaired/ambiguous cases.
- `tests/thread/async-thread-run-service.test.ts`: closed-Turn maintenance generates deterministic components and re-evaluates complete smooth Turn readiness.

#### Technical Notes

Use one omission unit: characters. The marker is `[omitted: N chars]`.

Do not use inference for tool exchanges in this story. Rendering should be deterministic and inspectable.

Deterministic generation should not wait for a slow user smoothing model call. If user smoothing is still pending after the Turn closes, the Turn remains pending for complete smooth readiness until Story 2 finishes or fallback writes deterministic-preserved user text.

Tool exchange component text should use newline-delimited compact JSON objects in canonical source order:

| Object | Required fields | Notes |
|--------|-----------------|-------|
| Tool call | `type: "tool_call"`, `name`, `arguments` | Include `toolCallId` only for unpaired or ambiguous calls. Cap oversized string values recursively. |
| Tool result | `type: "tool_result"`, `status`, `output` | `status` is `success` or `error` using current tool-result error metadata. Include `toolCallId` only for unpaired or ambiguous results. |
| Unpaired marker | `type: "unpaired_tool_call"` or `type: "unpaired_tool_result"` | Preserve source order and retain enough id/name detail for inspection. |

Pair tool calls and results by existing internal tool call ids. Duplicate ids, missing ids, and malformed tool parts should render explicit unpaired/ambiguous records instead of dropping content or throwing during smooth generation.

#### Anti-Shim Requirements

- Prove tool exchange rendering against real message/part records that include assistant tool calls and tool result messages.
- Prove large write/edit payloads are omitted from tool call arguments, not only from tool results.
- Prove thinking signatures are absent by searching the rendered output for known signature values.
- Prove duplicate, missing, and malformed tool ids render explicit unpaired/ambiguous records.

#### Verification

- Targeted: `node --import tsx --test tests/thread/smooth-turn-service.test.ts tests/thread-view/prompt-visible-tool-result-projection.test.ts tests/thread-view/pi-thread-view-prompt-truncation.test.ts`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- [ ] All 15 TCs pass (TC-3.1a through TC-3.6b)
- [ ] Tool exchanges render as compact interleaved JSON with 500-character string caps
- [ ] Thinking signatures and encrypted payloads are absent from smooth output
- [ ] `npm run verify` passes
