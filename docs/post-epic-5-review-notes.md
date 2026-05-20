# Post-Epic 5 Review Notes

## Purpose

This document captures exploratory findings after reviewing the PI Long Horizon PRD, technical architecture, implemented codebase, and observed runtime behavior inside the PI harness. It is intentionally a notes/analysis document rather than a formal spec. The goal is to preserve useful insights, design interpretations, open questions, and next-step considerations as the project assesses how well the current context-management harness functions after Epic 5.

## Source Material Reviewed

Primary documents reviewed:

- `docs/spec-build/prd.md`
- `docs/spec-build/technical-architecture.md`

Code areas reviewed:

- `src/thread/**`
- `src/context-steward/**`
- `src/thread/async-thread/**`
- `src/thread-view/**`
- `src/token-accounting/**`
- `src/commands/smart-compact.ts`
- `src/context-steward/pi/pi-extension.ts`
- `.pi/extensions/**`
- related tests under `tests/**`

Runtime context:

- Current PI session was reportedly launched with `npm run agent` from this repository.
- `npm run agent` sets `PI_CODING_AGENT_DIR=.pi/agent` and launches `pi` with the local project configuration.
- The repo includes `.pi/extensions/context-steward.ts`, which re-exports `src/context-steward/pi/pi-extension.js`.
- `.pi/agent/settings.json` disables PI native compaction.
- Based on code/config and assuming the launch statement is correct, this session is likely running under the PI Long Horizon extension stack.

## Initial PRD / Technical Architecture Understanding

The PRD and technical architecture describe PI Long Horizon as a local, file-backed context substrate layered around PI through extensions.

The core product idea is not simply “summarize chat.” It is:

1. Preserve full canonical source history.
2. Derive smoother and more compressed representations from that source.
3. Build generated PI session files as projections/artifacts.
4. Keep operator-visible state for capture, maintenance, degraded modes, and smart compact.
5. Avoid treating generated compacted sessions as source truth.

Important planned concepts from the PRD/architecture:

- Canonical Thread
- Typed messages and parts
- Prompt-bounded turns
- Closed turns
- Smooth turns
- Chunks
- Detailed summaries
- Brief summaries
- Bands
- Manual smart compact
- Generated PI session files
- Projection revisions
- Import/attach from unmanaged PI sessions
- Repair of turn state
- Visible degraded/blocked status
- PI as first runtime target, with future target-neutral projection possible

The architecture thesis was strong and mostly centered on ownership boundaries:

- Thread owns source truth.
- Async maintenance derives artifacts.
- Projection/compiler emits runtime-specific generated output.
- PI loads generated session files.
- Generated output metadata records active rollout truth.

## Codebase Conformance to the Plan

The implemented codebase conforms strongly to the original PRD and technical architecture.

Evidence:

- `src/thread/domain/records.ts` defines canonical thread/message/turn/import/projection records.
- `src/thread/store/file-thread-store.ts` implements a file-backed store and target session mapping.
- `src/context-steward/pi/pi-extension.ts` integrates with PI lifecycle events and commands.
- `src/thread/async-thread/**` implements smoothing, chunking, lower-band artifact maintenance, readiness, blockers, and degraded states.
- `src/thread-view/**` implements Thread View building, materialization, PI projection, and prompt-visible output handling.
- `src/commands/smart-compact.ts` implements manual smart compact.
- `src/token-accounting/**` adds token accounting policies and provider-backed generated session counting.

Tests are broad and appear to encode the architecture rather than only utility behavior. The suite includes tests for:

- capture
- import/attach
- turn repair
- file store behavior
- PI extension commands
- async thread maintenance
- smoothing
- chunk/lower-band artifacts
- thread-view building/materialization
- PI thread-view writing
- smart compact lifecycle
- token accounting
- workbench/inspection reports
- prompt-visible tool-result truncation

At the time of review, the test command reported hundreds of service tests passing.

## Important Implementation Evolutions

Several areas appear more concrete or mature in code than in the original PRD/architecture.

### Thread View Became a Major Intermediate Representation

The implementation has a substantial `thread-view` layer. This acts as a concrete intermediate representation between canonical Thread source and generated PI session file.

This is a useful evolution because it avoids jumping directly from source records to PI JSONL. It creates a place to reason about selected source units, bands, emitted messages, materialization status, and generated-output accounting.

### Token Accounting Became Central

The PRD discussed budget pressure, but the code adds a dedicated token-accounting subsystem:

- materialized representation counters
- generated session counters
- OpenAI input token counting
- source policy/trust decisions
- stale count rejection
- provider/model metadata requirements
- final generated-session count before write/reload

This makes the system more rigorous and less magical. Smart compact is not just based on rough estimates; it can block or degrade when trusted counts are unavailable.

### Placeholder Chunks Were Superseded by More Concrete Artifacts

The code contains signs of legacy placeholder chunk handling, but newer logic distinguishes:

- conversation transcript artifact
- detailed semantic artifact
- brief semantic artifact
- readiness/failure/invalid states

This suggests the system evolved from placeholder summaries toward a stricter lower-band artifact pipeline.

### Operator Tooling Expanded

The PRD called for observable maintenance. The code has a broad command/status surface, including commands such as:

- `lh-attach`
- `lh-turn-health`
- `lh-repair-turns`
- `lh-status`
- `lh-prompt-projection-status`
- `lh-active-thread-view-status`
- `lh-lower-band-status`
- `lh-smoothing-status`
- `lh-smart-compact`
- `lh-compact-report`

This makes the project feel strongly dogfood-oriented and operationally inspectable.

## Four-Band Stratified Context Reduction

An important clarification from the review: the four-band context reducer was already planned in the PRD. It was not an unplanned implementation addition.

The PRD explicitly described:

- raw/full-fidelity recent history
- smooth turns for somewhat older history
- detailed summaries for older middle history
- brief summaries for oldest compressed history
- budget-based projection allocation from newest/highest fidelity backward

The implementation realizes this through `thread-view`.

Conceptually:

```text
newest context       -> full fidelity raw messages
recent context       -> smooth turns
older context        -> detailed chunk summaries
oldest context       -> brief chunk summaries
```

This is the core durable context-shaping mechanism.

### Band Numbers as Heuristic Shaping, Not Exact Targets

A key understanding from discussion: the submitted band numbers should not be interpreted as hard final token targets.

They are better understood as:

- band weights
- band preferences
- allocation hints
- heuristic shaping parameters
- desired context shape

They guide the selection process but do not guarantee final distribution.

Reasons final distribution can differ:

- selection happens over whole turns/chunks
- source units are discrete and uneven
- one tool-heavy turn can dominate a budget
- smooth/detailed/brief artifacts may be missing or stale
- token counts may be estimated or provider-counted
- prompt-visible tool-result truncation may shrink full-fidelity content after selection
- final generated-session counting may trigger additional reduction
- PI session serialization overhead differs from source-unit estimates

Trying to force exact percentages would likely damage coherence by requiring unnatural splitting of turns/chunks/messages.

Better framing:

```text
requested band numbers = steering input
actual band distribution = emergent result under constraints
```

This seems acceptable and probably preferable. The important value is understandable decisioning, not exact adherence to arbitrary ratios.

## Major Additional Context-Reduction Mechanism: Message-Level Tool-Result Off-Gassing

The most significant unplanned/less-obvious mechanism found in code is live prompt-visible tool-result truncation.

Implemented in:

- `src/thread-view/services/live-tool-result-truncation.ts`
- `src/thread-view/services/prompt-visible-tool-result-projection.ts`
- `src/thread-view/targets/pi/pi-thread-view-prompt-truncation.ts`
- `src/thread-view/targets/pi/active-prompt-projection-writer.ts`
- integrated through `src/context-steward/pi/pi-extension.ts`

Default constants:

```ts
DEFAULT_LIVE_TOOL_RESULT_RAW_ZONE_TOKEN_THRESHOLD = 32_000;
DEFAULT_LIVE_TOOL_RESULT_TRUNCATED_CHAR_LIMIT = 500;
```

Behavior:

- Maintain a rolling protected raw zone for recent prompt-visible messages.
- Once prompt-visible context after the compacted-content boundary exceeds the threshold, older tool-result messages become eligible for truncation.
- Eligible old tool results are truncated to roughly 500 chars plus suffix.
- Canonical source capture preserves the original full tool output through side-channel restoration.

This is distinct from four-band smart compact.

### Why This Matters

The four-band system is turn/chunk based. That is semantically clean, but it has a major edge case:

```text
A single open/current turn can contain huge tool output before any closed-turn/chunk/band machinery can reduce it.
```

Example:

```text
first turn -> 150+ tool calls -> 300k prompt-visible tokens
```

If the model window is around 258k, banding alone does not help much because:

- there may be no older turns to smooth/chunk
- the current turn may still be open/live
- the entire pressure source is inside recent full-fidelity context

Live tool-result truncation acts as a message-level pressure valve.

It handles the pressure at the granularity where the pathological growth occurs: individual tool-result messages.

Good framing:

```text
Banding/chunking = durable semantic memory compression
Live tool-result truncation = tactical prompt-pressure off-gassing
```

This allows the main architecture to remain turn/chunk based without forcing the banding system to become message-based.

### Source-of-Truth Preservation

The design is careful not to violate the project’s core principle of keeping full source history.

PI-visible prompt may contain truncated tool output, but canonical capture restores and stores full output.

The extension listens to `tool_result` events and stores original content in a side-channel map. Later, when `message_end` capture occurs, it restores original tool content before canonical capture.

This means:

```text
canonical thread: full tool output
PI-visible prompt: truncated old tool output
```

This is a strong design choice.

## Runtime Behavior Observed / Inferred

The user observed context rising to roughly 18-19% of 272k and then dropping back to roughly 12-14% during the current run.

This aligns well with live prompt-visible tool-result truncation.

Expected dynamic:

1. File reads, greps, and other tool calls add prompt-visible tool output.
2. Context percentage rises.
3. Once the raw-zone threshold is exceeded, older tool results fall out of the protected zone.
4. Those older tool results are truncated.
5. Prompt-visible context percentage drops.
6. Canonical full output remains preserved.

After the raw zone is saturated, each turn can both add and remove visible context:

```text
turn N visible context =
  previous visible context
  + new prompt/response/tool output
  - newly truncated old tool-output bulk
  + small stubs for truncated results
```

This creates a dampened/sawtooth growth profile rather than the monotonic growth of a normal transcript session.

This may explain why context percentage moves less turn-to-turn after the threshold is reached.

## Smart Compact and Tool-Result Truncation Interaction

A key question was whether smart compact resets full-fidelity tool results back to untruncated raw output.

The answer from code review: smart compact itself applies the prompt-visible tool-result truncation pass before final count/write.

In `src/commands/smart-compact.ts`, after building the PI Thread View file, code calls:

```ts
applyPromptVisibleToolResultTruncationToPiThreadViewFile(...)
```

unless prompt-visible truncation is explicitly disabled.

Therefore, if the selected full-fidelity raw tool results exceed the live raw-zone threshold, older selected full-fidelity tool results can be truncated during smart compact before the generated session is counted and written.

Important nuance:

- This applies to entries generated from raw turn messages with role `toolResult`.
- Smooth/detailed/brief summaries are not tool-result messages and are not affected by this truncation path.
- Canonical source remains full fidelity.

This means smart compact can both:

1. redistribute older turns into smooth/detailed/brief bands; and
2. apply message-level off-gassing inside the remaining full-fidelity band when necessary.

If compact moves enough old raw turns out of full fidelity, the remaining full-fidelity region may fall under the raw-zone threshold and therefore no longer need tool-result truncation. If not, truncation is baked into the generated compact session.

## Turn-Based Banding vs Message-Based Banding

Discussion conclusion: keeping the main banding/chunking system turn-based is likely a good design choice.

Advantages of turn-based banding:

- preserves task intent
- keeps user prompt, tool calls, tool results, and agent answer as a meaningful causal unit
- makes smoothing easier and more coherent
- gives cleaner source mapping/provenance
- keeps chunks stable
- reduces policy complexity
- avoids arbitrary message-level fragmentation

If banding became message-based, the system would need many additional policy rules:

- whether to preserve user messages separately
- how to handle tool call/result pairs
- how to keep final assistant answers with their evidence
- how to split or drop reasoning/tool messages
- how to maintain coherent summaries from partial turns

The live tool-result truncation mechanism is a good compromise:

```text
Keep durable memory semantic and turn/chunk based.
Handle pathological live bloat at message level.
```

This is architecturally cleaner than centering all banding around messages.

## Quality Assessment of Message-Level Off-Gassing

Overall assessment: strong design addition.

It solves a real harness problem without distorting the main architecture.

Strengths:

- handles huge tool-output spikes before smart compact is useful
- protects a recent raw zone
- keeps older live tool output from monopolizing context
- preserves canonical full outputs
- complements, rather than replaces, banding/chunking
- explains observed runtime context-pressure behavior

Caveat:

The current truncation policy appears blunt: old tool result text is truncated to a head-only character limit.

Potential future refinements:

- keep head + tail
- preserve lines matching error/fail/exception/warning
- tool-specific truncation policies
- preserve command metadata and exit code prominently
- summarize or structure common test/build outputs
- allow tools to mark important output regions

But the architecture of the mechanism appears sound.

## PI Harness Runtime Inference

Assuming the session was launched with `npm run agent` from this repo, it is likely that the current session is running with this extension code active.

Supporting evidence:

- `npm run agent` launches `pi` with local `.pi/agent` directory.
- `.pi/extensions/context-steward.ts` re-exports the implemented extension.
- `.pi/agent/settings.json` disables PI native compaction.
- Observed context sawtoothing is consistent with the implemented live prompt-visible tool-result truncation mechanism.

Caveat:

The assistant can inspect repo files but cannot independently prove runtime extension hook state unless PI exposes that state. The conclusion depends on the user’s launch statement and visible configuration.

## Overall Project Assessment

The initial plan appears to have turned out well in implementation.

The codebase is not a thin prototype. It is a substantial context-management substrate with:

- persistent source truth
- async derived artifacts
- projection revisions
- target-specific PI output generation
- smart compact lifecycle
- exact/strict token accounting
- operator inspection surfaces
- live prompt-pressure mitigation

The strongest design throughline is separation of source truth from prompt-visible/generated artifacts.

The most important post-plan addition appears to be live prompt-visible tool-result truncation. It handles real-world agent behavior that turn/chunk banding is not designed to handle directly.

## Key Takeaways

1. The PRD’s core four-band model was planned and implemented faithfully.
2. The band numbers are best understood as heuristic shaping weights, not exact final token targets.
3. Exact final band distribution is inherently emergent due to discrete source units, artifact readiness, token accounting, truncation, and final count/reduction loops.
4. Message-level tool-result off-gassing is a major complementary mechanism.
5. This off-gassing lets the main context architecture remain turn/chunk based.
6. Runtime context sawtoothing is expected once the raw-zone threshold is saturated.
7. Smart compact applies prompt-visible tool-result truncation before final generated-session count/write.
8. The implementation seems more operational and safety-conscious than the initial docs alone suggest.

## Open Questions / Possible Next Review Areas

- Should band percentage inputs be renamed in docs/UI from “targets” to “weights,” “shape,” or “allocation hints”?
- Should compact reports show requested band shape vs actual emitted token distribution after truncation/final counting?
- Should live tool-result truncation be exposed more explicitly in operator status output?
- Should truncation policy move from head-only to head+tail or semantic preservation?
- Should tool-specific truncation policies exist for test output, grep/find, git diff, logs, and file reads?
- How often does smart compact restore full-fidelity visibility by moving older tool-heavy turns into smooth/lower bands?
- How accurate is the 32k raw-zone default in practice for the current 272k-ish window?
- Should the raw-zone threshold scale with model window or requested compact bound?
- Should there be telemetry comparing canonical token growth vs prompt-visible token growth?
- Does active prompt projection refresh always happen soon enough to prevent context-window failure during extreme first-turn tool storms?

## Working Mental Model

Current system has two complementary pressure-management layers:

```text
Layer 1: Live prompt pressure relief
  - message-level
  - tool-result focused
  - rolling raw-zone threshold
  - prompt-visible truncation
  - canonical full-output preservation

Layer 2: Durable long-horizon memory projection
  - turn/chunk based
  - full fidelity / smooth / detailed / brief bands
  - smart compact generated PI session
  - token accounting and final count enforcement
```

This layered model seems like the right architecture for a coding-agent context harness.
