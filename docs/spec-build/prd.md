# PI Long Horizon - Product Requirements Document

## Product Vision

PI Long Horizon is a long-horizon agent CLI built on PI. It runs a scoped set of Codex models through ChatGPT OAuth and gives the agent a managed memory surface for coding sessions that outgrow a raw transcript.

The v1 product manages PI's working context so coding sessions remain coherent past a single context window. It gives operators visible maintenance state and a manual smart compact path for dogfooding the core loop.

---

## Terminology

| Term | Meaning |
|------|---------|
| PI | The interactive agent runtime used by this project. V1 extends PI instead of forking it. |
| Long-horizon agent CLI | A command-line agent experience intended to stay coherent across larger coding sessions than a raw model context can hold. |
| Context Steward | The programmatic actor that maintains the stored history, derived memory layers, and generated PI session file. |
| Actor | A human, agent, tool, system, or runtime participant that can emit messages into a thread. |
| Source thread | The complete stored history for a working line of conversation. It records what happened before any shortening or projection. |
| Canonical turn | One prompt addressed to an agent plus the responses, tool activity, reasoning, and runtime notes that follow until the next agent-addressed prompt. |
| Open turn | A canonical turn that can still receive more activity for the current prompt. |
| Closed turn | A canonical turn whose messages are ready for final smoothing, chunking, and projection decisions. |
| Typed part | A structured piece inside a message, such as text, reasoning, tool call, tool result, runtime note, image, or file reference. |
| Band | A fidelity region in the generated context. Newer history uses higher-fidelity bands; older history uses smoother or more compressed bands. |
| Smooth turn | A readable single-text version of a canonical turn. It keeps the substance of the turn while reducing noise from raw messages and tool output. |
| Chunk | A stable group of smooth turns. Chunks become the source material for detailed and brief summaries. |
| Detailed summary | A middle-fidelity summary of a chunk, used for older history that still needs back-and-forth detail. |
| Brief summary | A low-fidelity summary of a chunk, used for oldest history that needs project trajectory, decisions, and unresolved threads. |
| Job | A visible background work item for smoothing, boundary decisions, summary generation, repair, or projection preparation. |
| Smart compact | The operation that rebuilds the shorter PI session file from raw, smooth, detailed, and brief representations. |
| Generated PI session file | The shorter session file that PI loads after smart compact. It is output from the stored history, not the stored history itself. |
| Projection revision | A recorded smart compact output, including the generated session file, source state, policy, size report, archive path, and reload result. |
| Context Workbench | The stewardship surface over the source thread, turns, message parts, chunks, jobs, and generated session files. |

---

## User Profile

**Primary User:** Context Steward, the programmatic actor that maintains the long-horizon context substrate.

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized runtime activity, tracks prompt-bounded turns, prepares smoothed and summarized history, and regenerates the PI session file when the working context needs to shrink.

**Mental Model:** "Keep the source thread complete, prepare lower-fidelity versions as history ages, and project the right fidelity mix back into the agent runtime."

**Key Constraint:** The agent can only reason over a bounded model context, while the useful history of the project and working relationship can grow across many sessions.

**Secondary Users:** The human operator starts and dogfoods the agent, runs inspection and smart compact commands, and reviews context behavior. PI consumes the generated session file.

---

## Problem Statement

Long coding-agent sessions accumulate user messages, assistant responses, tool calls, tool results, and reasoning traces. Raw history eventually exceeds the model context or crowds out older project knowledge. Standard compaction replaces a large span with one summary and leaves the active session dependent on one runtime-specific transcript format.

---

## Product Principles

- **Keep the complete history before shortening it:** The system stores the full conversation and tool activity before generating the shorter session file that PI loads.
- **Reduce older history gradually:** Recent work stays raw. Older work moves through smoothed turns, detailed summaries, and brief summaries.
- **Prepare compressed history early:** The system can smooth turns and summarize chunks before the active context reaches its compact threshold.
- **Keep closed chunks stable:** Once a group of turns is closed and summarized, normal aging changes which summary is used rather than reshuffling the group.
- **Treat PI as the first output format:** The stored history is not a PI session file. PI receives a generated session file.
- **Make context easy to inspect:** Deterministic code, future agents, CLI commands, and future UI use the same navigation concepts.

---

## Scope

### In Scope

V1 delivers the context-maintenance foundation needed for a long-horizon PI CLI:

- Complete stored history for messages, turns, chunks, jobs, and generated session file revisions.
- PI extension capture of finalized runtime activity.
- Prompt-bounded turns that can contain multiple agent responses and tool cycles.
- Context Workbench views over messages, turns, typed parts, smooth state, chunks, jobs, and generated session files.
- Smooth turn generation.
- Chunk formation from smooth turns.
- Model-assisted chunk boundary decisions.
- Detailed and brief chunk summaries.
- Manual smart compact that generates a PI-compatible session file and reloads PI.
- Fixture sessions for threshold and projection testing.
- Explicit attach/import behavior for PI sessions that started before Context Steward capture.
- Operator-visible blocked/degraded status when smoothing, chunking, summaries, or smart compact cannot proceed.

### Out of Scope

- Forking PI. Not planned for v1; the product extends PI through supported extension and session-loading surfaces.
- PI-native compaction entries as the main projection architecture. Covered in the technical architecture as a rejected v1 architecture.
- Convex persistence migration. Future direction.
- Round Table multi-agent product behavior. Future direction.
- Web UI for context editing. Future direction.
- Autonomous high-end agent reworking of closed chunks. Future direction.
- Non-PI projection targets. Future direction.
- Dynamic memory ticket retrieval and injection. Future direction.
- Higher-order chunk merging for multi-month histories. Future direction.

### Assumptions

| ID | Assumption | Status | Notes |
|----|------------|--------|-------|
| A1 | PI extension events expose finalized messages before PI writes its native session entry. | Validated from PI source | `message_end` handlers run before `SessionManager.appendMessage`. |
| A2 | PI can reload a generated session file from an extension command. | Validated from PI source | `switchSession()` opens a session path and replaces the runtime context. |
| A3 | Canonical turns use prompt boundaries, not PI's internal turn event boundaries. | Validated from PI source | PI internal turns represent one assistant response plus tool results. |
| A4 | Model-assisted chunk boundary decisions improve summary quality enough to justify async model calls. | Unvalidated | Feature 4 evaluates this with fixtures. |
| A5 | File-backed storage is sufficient for v1 thread sizes and can later map to database collections. | Unvalidated | Expanded fixtures should test size and traversal cost. |
| A6 | Smoothing can run after local PI activity boundaries and be refreshed when a prompt-bounded turn receives more activity. | Unvalidated | Feature 3 validates draft/final smooth behavior during dogfooding. |

---

## Non-Functional Requirements

- **Capture latency:** Runtime capture writes do not create visible delay in the PI TUI.
- **Projection safety:** Smart compact writes the generated PI session file atomically before PI reloads it.
- **Repairability:** Missing turns, missing smooth text, and incomplete derived state are detectable and repairable.
- **Observability:** Capture, smoothing, chunking, summarization, and smart compact report status, blocked work, and output sizes.
- **Portability:** Stored history records avoid PI session schema fields. PI-specific data appears in target metadata and generated PI session output.
- **Cost control:** Model work for smoothing, boundary decisions, and summaries runs as visible async jobs unless a command explicitly waits for it.
- **Schema evolution:** Stored thread data includes version information so future schema changes can be detected and migrated.

---

## Architecture Summary

V1 is a local TypeScript/Node system that runs as a PI extension plus supporting local commands and workers. The first target runtime is PI with ChatGPT OAuth-backed Codex models. The v1 store is file-backed under a Context Steward thread directory, with a store interface so later database storage can preserve the same ordering and active-record semantics.

The system has five top-tier surfaces. Context Steward Core stores the source thread. Context Workbench exposes readable and editable thread, turn, chunk, job, and generated-session state. Background Maintenance runs smoothing, boundary, and summary jobs. Projection Compiler builds the shorter PI session file. PI Runtime Integration captures PI events and reloads PI after smart compact.

V1 is single-user and single-machine. It extends PI through extension events, commands, and `switchSession`; it does not fork PI.

See `technical-architecture.md` for the deeper architecture.

---

## Milestones

| Milestone | After | What Exists | Feedback Point |
|-----------|-------|-------------|----------------|
| M1 | Feature 1 | PI activity is captured into stored messages and prompt-bounded turns. | Dogfood live capture and inspect stored thread state. |
| M2 | Feature 2 | The Context Workbench traverses thread, turn, message, part, chunk, job, and generated-session state. | Inspect real and fixture threads through Workbench output. |
| M3 | Feature 3 | Smooth turns, chunks, band allocation, and manual smart compact produce a generated PI session file. | Run smart compact, reload PI, and compare source thread to generated session. |
| M4 | Feature 4 | Model-calibrated smoothing, chunk boundaries, and summaries produce detailed and brief memory layers. | Evaluate compression quality and context coherence across threshold fixtures. |

---

## Feature 1: Session Context Store

### Feature Overview

This feature gives the Context Steward a source thread for a live PI session. After it ships, PI runtime activity is captured as stored messages and prompt-bounded turns, and the generated PI session file is tracked as output from that stored history.

### Scope

#### In Scope

- Thread directory for stored history.
- Actor identity fields on stored messages.
- Messages with ordered typed parts.
- Prompt-bounded turns with open and closed states.
- PI extension capture for finalized runtime messages and relevant runtime events.
- Target metadata for the generated PI session file.
- Repair path that reconstructs turns from stored messages.
- Attach/import path for a PI session that already contains activity before Context Steward capture starts.
- Basic fixture creation from real PI sessions.

#### Out of Scope

- Full Context Workbench query surface. Feature 2.
- Chunking and band allocation. Feature 3.
- Smart compact projection. Feature 3.
- Summary generation. Feature 4.
- Database storage. Future direction.

### Scenarios

#### Scenario 1: Capturing Live PI Activity

The operator uses the PI CLI. The Context Steward records each finalized prompt, response, tool result, reasoning part, and runtime note into the source thread.

**AC-1:** The steward records finalized PI messages during PI extension events. Stored messages preserve actor identity, message kind, ordered typed parts, timestamps, and target-runtime metadata.

**AC-2:** An agent-addressed prompt starts a canonical turn. Agent responses, tool activity, runtime notes, and intermediate outputs remain in that turn until the next agent-addressed prompt starts a new turn.

**AC-3:** A canonical turn can contain multiple assistant responses and tool cycles. PI activity events that occur before the next initiating prompt remain inside the current canonical turn.

#### Scenario 2: Tracking The Generated PI Session

The steward stores source history and records which PI session file receives generated output.

**AC-4:** The source thread records the current generated PI session file path. PI loads that generated file after smart compact.

**AC-5:** The steward can run an explicit repair or import operation from a PI-native session file. New activity after repair/import is captured through extension events.

#### Scenario 3: Attaching To An Existing PI Session

The operator may start PI before Context Steward capture is active.

**AC-6:** The steward can attach to an existing PI session and import prior PI messages into a new source thread. Imported records are marked as imported at the thread/import level.

**AC-7:** After attach completes, the next finalized PI activity is recorded through the same extension-capture path and associated with the imported source thread.

#### Scenario 4: Repairing Turn State

A thread may have messages whose turn state is missing or incomplete.

**AC-8:** The steward can reconstruct turn membership from stored messages using agent-addressed prompt boundaries. Repair preserves message order and raw message content.

**AC-9:** The steward reports missing or incomplete turn state before smoothing, chunking, or smart compact uses the affected turns.

---

## Feature 2: Context Workbench

### Feature Overview

This feature gives the Context Steward and operator a readable surface over the source thread. After it ships, consumers can inspect thread health, follow the turn timeline, inspect typed message parts, and identify missing derived work.

### Scope

#### In Scope

- Open and inspect a source thread.
- List messages, turns, typed parts, chunks, jobs, and generated session files.
- Show flattened views for tool calls, tool results, reasoning parts, runtime notes, and text.
- Report missing smooth turns, missing summaries, open chunks, failed jobs, and stale generated session files.
- Report blocked smart compact prerequisites and degraded context-maintenance state.
- Read fixture threads and expanded threshold sessions.
- Provide concepts usable by deterministic code, CLI commands, future agents, and future UI.

#### Out of Scope

- Model summarization. Feature 4.
- Chunk boundary adjudication. Feature 3 and Feature 4.
- Projection compilation. Feature 3.
- Web UI. Future direction.
- Final method signatures. Tech design.

### Scenarios

#### Scenario 1: Inspecting Thread State

The operator or future context agent opens a thread and reviews its current structure.

**AC-1:** The Workbench shows whether a thread is usable for maintenance by reporting its target runtime, active turn state, derived-state health, and generated-session status.

**AC-2:** The Workbench presents the turn timeline in order, with enough context to understand the initiating prompt, responding actors, tool activity, derived-state readiness, and chunk placement.

**AC-3:** The Workbench supports part-level inspection so consumers can trace text, tool activity, reasoning, and runtime notes back to stored messages.

#### Scenario 2: Finding Work That Needs Repair Or Generation

The steward checks whether a thread is ready for smoothing, chunking, summarization, or smart compact.

**AC-4:** The Workbench identifies missing derived work that blocks maintenance, including closed turns without smooth output, chunks awaiting boundary decisions, chunks without required summaries, failed jobs, and stale generated session files.

**AC-5:** The Workbench reports smart compact blockers in operator terms: missing smooth turns, pending boundary decisions, missing summaries, invalid generated-session candidates, and model/job failures.

**AC-6:** The Workbench shows whether a record is source history or derived state before repair operations run.

---

## Feature 3: Band, Chunk, and Projection Mechanics

### Feature Overview

This feature gives the Context Steward its first complete maintenance loop. It has two connected seams: chunk preparation and smart compact. Chunk preparation creates smooth turns and stable chunks. Smart compact selects raw, smooth, detailed, and brief representations and generates the PI session file loaded by the CLI.

### Scope

#### In Scope

Chunk preparation:

- Smooth turn jobs triggered by PI activity boundaries and canonical turn closure.
- One open chunk per thread.
- Chunk membership from smooth turn text.
- Chunk boundary decision state.
- Chunk status `open` or `closed`, with active state for replacement/rework.

Smart compact:

- Ramped upper and lower smart compact bounds.
- Budget-based projection allocation from newest/highest fidelity backward.
- Generated PI session file using raw, smooth, detailed chunk, and brief chunk representations.
- Manual smart compact command that writes the generated session file atomically and reloads PI.
- Smart compact prerequisite check that waits for selected jobs or stops with a blocked report.

#### Out of Scope

- Final smoothing and summary prompts. Feature 4.
- Automatic smart compact trigger. Future direction.
- Expensive chunk rework. Future direction.
- Non-PI target compilers. Future direction.

### Scenarios

#### Scenario 1: Preparing Smooth Turns

A turn receives a smoothed representation before smart compact needs it.

**AC-1:** The steward can create draft smooth text after PI reports no more local runtime activity for the current prompt. If the canonical turn receives more activity before the next initiating prompt, the smooth text is refreshed.

**AC-2:** The steward finalizes smooth text when the canonical turn closes. Smooth state records readiness, failure, and generation metadata while preserving stored messages and typed parts.

**AC-3:** When chunking needs a turn whose smooth text is missing, the steward repairs the turn or regenerates smooth text before assigning the turn. If repair or generation cannot complete, chunking reports blocked state.

#### Scenario 2: Building Chunks From Smooth Turns

Eligible smooth turns are appended to the current open chunk as they leave full fidelity.

**AC-4:** A turn becomes chunk-eligible when projection policy moves it out of full fidelity and into the smooth band. The steward appends eligible smooth turns to the open chunk in order.

**AC-5:** When the open chunk reaches the boundary decision range, the steward requests a model boundary decision using the current chunk and nearby smooth turns. If no valid decision is available, chunking remains pending.

**AC-6:** Closing a chunk prevents new turns from being added to it. Future rework creates replacement chunk state and marks prior chunks inactive.

#### Scenario 3: Running Manual Smart Compact

The operator runs smart compact after the active context crosses the current upper bound.

**AC-7:** Smart compact uses a configured range schedule with upper trigger bounds and lower target bounds. Early compacts use smaller ranges, and later compacts move toward the mature operating range.

**AC-8:** Projection allocation starts with newest/highest-fidelity history and works backward. Full fidelity is selected by token budget.

**AC-9:** The generated PI session uses raw messages for full-fidelity history, one synthetic smooth-turn message for smooth history, detailed chunk summaries for middle compressed history, and brief chunk summaries for oldest compressed history.

**AC-10:** Before writing the generated PI session file, smart compact verifies that required smooth turns, chunk boundaries, and summaries are ready. If prerequisites are missing, it waits for selected jobs or stops with a report that names the blocked work.

**AC-11:** Smart compact writes the generated PI session file atomically, archives the previous generated session file at regeneration boundaries, and reloads PI through the extension command path.

---

## Feature 4: Summarization Policies and Model-Calibrated Bands

### Feature Overview

This feature calibrates the model-generated representations used by smart compact. After it ships, smooth turns, chunk boundary decisions, detailed summaries, and brief summaries have prompts, output formats, evaluation fixtures, and quality reports.

### Scope

#### In Scope

- Smooth turn prompt and output format.
- Chunk boundary adjudication prompt and output format.
- Detailed chunk summary prompt and target compression range.
- Brief chunk summary prompt and target compression range.
- Fixture-based evaluation for quality and structured output reliability.
- Model selection for smoothing, boundary decisions, and summaries.
- Reports comparing source tokens, smooth tokens, summary tokens, and generated session size.
- Cost and latency reports for smoothing, boundary, and summary jobs.

#### Out of Scope

- Higher-order chunk merging. Future direction.
- High-end bespoke agent context rework. Future direction.
- Dynamic memory retrieval tickets. Future direction.
- Automatic prompt optimization. Future direction.

### Scenarios

#### Scenario 1: Generating Smooth Turns

The steward converts a closed turn into a single readable text representation.

**AC-1:** Smooth output uses clear speaker and tool markers, normalizes whitespace/casing/grammar according to the smoothing policy, and preserves a coherent account of the turn. Stored messages and typed parts remain the reference record for repair and regeneration.

**AC-2:** Smooth generation can summarize, truncate, or omit tool details according to policy while preserving the information needed for later chunk summaries.

#### Scenario 2: Choosing Chunk Boundaries

The steward asks a model whether the current chunk should close.

**AC-3:** Boundary adjudication returns a structured close or continue decision with a short rationale. Invalid or unavailable results leave chunking pending.

**AC-4:** Boundary evaluation uses fixture threads with topic changes, long tool-heavy turns, and ongoing work that should not be split prematurely.

#### Scenario 3: Producing Chunk Summaries

Closed chunks receive detailed and brief summaries for projection bands.

**AC-5:** Detailed summaries preserve the compressed back-and-forth between user and agent at the configured middle-fidelity target. Tool calls and reasoning traces appear as prose only when they help explain the work.

**AC-6:** Brief summaries preserve project trajectory, decisions, unresolved threads, and stable context needed for oldest-history projection.

**AC-7:** Summary evaluation reports whether generated summaries hit the configured compression range and structured output format.

**AC-8:** Summary evaluation reports whether generated summaries cover the source chunk without unsupported additions.

**AC-9:** Summary evaluation reports whether generated summaries remain useful inside the generated PI session.

**AC-10:** Summary and smoothing reports include model used, input size, output size, latency, and estimated cost where available.

---

## Cross-Cutting Decisions

- **Context Steward as requirements user:** Most feature scenarios are written from the steward's perspective because v1 capabilities are context-maintenance capabilities. The human operator remains the visible product user for commands, inspection, and review.
- **Stored history over PI session file:** The stored source thread records what happened. The PI session file is generated output.
- **Background preparation before projection pressure:** Smooth turns, chunks, and summaries may be prepared before smart compact uses them.
- **Observable maintenance:** Capture, repair, smoothing, chunking, summarization, and smart compact expose status instead of silently mutating context.
- **Operator-visible degraded state:** When smoothing, chunking, summarization, or smart compact cannot proceed, the system reports blocked work instead of silently producing lower-quality output.
- **Manual smart compact in v1:** The operator triggers smart compact with a command. Automatic triggers are future scope.
- **Closed chunks stay stable:** Normal aging changes which summary is used. Reworking closed chunks is an explicit future operation.
- **Fixture-backed validation:** Real and expanded fixture threads are maintained for threshold, projection, and summarization tests. The Workbench reads fixtures as normal threads instead of treating fixture inspection as a separate product flow.

---

## Future Directions

- Convex-backed thread, chunk, job, and generated-session storage.
- Round Table multi-agent conversations with shared history and target-specific projection.
- High-end agent-led context rework over closed chunks.
- Dynamic memory tickets and retrieval injection.
- Non-PI projection targets such as Codex, Claude Code, or OpenCode.
- Higher-order chunk merging for histories beyond the initial v1 horizon.
- Automatic smart compact triggers.
- Web UI for context editing.

---

## Recommended Epic Sequencing

```text
Feature 1: Session Context Store
    |
    v
Feature 2: Context Workbench
    |
    v
Feature 3: Band, Chunk, and Projection Mechanics
    |
    v
Feature 4: Summarization Policies and Model-Calibrated Bands
```

The sequence establishes source capture before navigation, navigation before projection mechanics, and mechanics before model-calibrated summarization. Feature 4 can tune model behavior because Features 1-3 provide source records, chunk state, projection compilation, and fixtures.

---

## Non-Binding Story Notes

These notes preserve the initial implementation shape for planning. Full story breakdowns belong in the detailed epic phase.

| Feature | Story Notes |
|---------|-------------|
| Feature 1 | Thread store foundation; actor/message capture; prompt-bounded turn creation; generated PI session metadata; attach/import; turn repair; real-session fixtures. |
| Feature 2 | Workbench foundation; thread and turn status; typed-part traversal; derived-state health; smart compact blockers; fixture navigation; CLI status command. |
| Feature 3 | Compact range foundation; smooth turn jobs; chunk membership; boundary pending state; band allocation; prerequisite checks; PI session generation; manual smart compact; projection archive/status. |
| Feature 4 | Evaluation fixture foundation; smooth prompt; boundary prompt; detailed summary prompt; brief summary prompt; model/cost reporting; end-to-end calibrated smart compact evaluation. |

---

## Relationship to Downstream Specs

This PRD defines the v1 capabilities and feature boundaries for PI Long Horizon. Full epics define detailed flows, line-level acceptance criteria, test conditions, and story breakdowns. Tech designs define file schemas, command contracts, worker behavior, target compilers, model prompts, and verification scripts inside the companion architecture.
