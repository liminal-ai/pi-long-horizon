# Message Model Brainstorm — Event Log + Materialized Domain Records

Status: brainstorming note, not a locked design.

This captures a discussion about where the SQLite data model should go after the first compatibility migration. The current SQLite store is mostly a compatibility layer: it gives us `thread.sqlite` and transactional writes, but many records are still stored as JSON blobs shaped close to the existing canonical records. That was useful for migration/cutover, but it is probably not the final domain model.

## Core Direction

The long-term model should not be shaped around PI rollout JSONL or around modern chat API `message.parts[]` structures. The canonical store should be shaped around our domain:

- what happened in the session;
- how it is represented as clear long-horizon conversation records;
- how turns/chunks/artifacts are maintained over those records;
- how each harness renders a rollout/context from that state.

A useful split:

```text
harness-native event/session record
  -> canonical event log
  -> materialized domain records
  -> derived memory state
  -> harness-specific rollout/live-context rendering
```

## Source Events

The source-of-truth ingest layer can be thought of as an append-only canonical event log.

Example event kinds:

- `user_prompt_finalized`
- `assistant_text_finalized`
- `assistant_thinking_finalized`
- `tool_call_finalized`
- `tool_result_finalized`
- `runtime_note_recorded`
- `session_started`
- `session_reopened`

These events preserve ordering, dedupe keys, harness provenance, and raw/source payloads.

The event log answers: **what happened, in what order, from which harness/source?**

## Materialized Domain Records

Immediately after ingest, events should be projected/materialized into legible operational records. This is the user's intended use of "projection" in this discussion: event -> useful domain entity, not smart-compact/thread-view projection.

Possible materialized records:

- conversation item / message
- assistant text
- assistant thinking
- tool call
- tool result
- runtime note
- harness/session mapping

Example:

```text
assistant says "I'll run tests"  -> assistant_text record
assistant calls bash npm test    -> tool_call record
bash returns failed output       -> tool_result record
assistant explains failure       -> assistant_text record
```

Tool calls and tool results are probably better represented as related records linked by a stable `tool_call_id`, rather than buried as arbitrary message parts.

The materialized layer answers: **what clear domain objects can the rest of the system query and operate on?**

## Why Not Center `message_parts`?

PI and modern chat APIs use content blocks / parts. For example, assistant messages may include text, thinking, and tool-call blocks. That is useful at the wire/API boundary.

But our canonical data does not need to mirror the wire API. It will always be transformed:

```text
PI events/session JSONL -> canonical model -> PI rollout JSONL
Other harness format    -> canonical model -> other harness rollout/context
```

So a relational `message_parts` table is only justified if we need to query, update, count, dedupe, repair, or provenance-track individual parts independently.

A better principle:

> Normalize things the domain needs to reason about independently. Do not normalize nested API arrays just because they exist.

For tool calls/results, strong typing probably is useful. For a simple text prompt, separate part rows may not add value.

## Harness Adapters

Each harness should have two mappings:

1. **Ingest adapter**
   - harness-native events/session records -> canonical source events
   - handles messy API/session details, dedupe keys, source metadata

2. **Render adapter**
   - canonical/thread-view/domain state -> harness-specific rollout/context format
   - PI JSONL for PI, another shape for another harness

The harness adapter owns translation. The canonical store owns source truth and derived memory state.

## Turns, Chunks, And Artifacts

Turns and chunks should not be primary ingest objects. They are higher-order maintained structures over the canonical event/conversation stream.

Possible flow:

```text
canonical events
  -> materialized conversation/tool/thinking records
  -> turn maintenance
  -> chunk maintenance
  -> smooth/lower-band artifacts
  -> token counts/readiness
  -> generated harness rollout
```

A prompt event may trigger a turn boundary, but the source truth is still the ordered event/conversation stream. The turn is a maintained grouping over that stream.

## Live Tool-Result Truncation

One thing this model does not replace is live prompt-visible tool-result truncation.

That belongs in the harness prompt/context rendering layer, not ingest and not canonical storage.

Canonical state should preserve full tool results. Then each harness renderer applies live-context hygiene:

```text
if tool result is outside protected recent budget:
  render truncated/off-gassed version in prompt-visible context
else:
  render full result
```

For PI, this is currently done in the context hook / generated rollout path. Other harnesses will need equivalent live prompt/off-gassing policies.

So there are two output concerns:

1. durable smart-context generation over turns/chunks/bands;
2. live prompt hygiene for huge tool outputs in the active/high-fidelity region.

Both should read full canonical truth. Neither should mutate canonical truth.

## Possible Incremental Path

This is a larger architecture shift than the current SQLite compatibility layer, so it should be incremental.

Possible path:

1. Add/shape SDK APIs around event ingest:
   - `appendCanonicalEvent(...)`
   - transaction inserts event + materialized records + dirty markers.

2. Add SQLite tables for canonical events and selected materialized records.

3. Keep current PI path working while wiring a parallel ingest path.

4. Compare current canonical message behavior with event/materialized behavior.

5. Move maintenance to domain tables:
   - turns;
   - chunks;
   - token counts;
   - artifacts/readiness.

6. Move smart compact to consume the domain model.

7. Keep PI-specific logic as an adapter:
   - PI ingest mapping;
   - PI rollout rendering;
   - PI live prompt truncation/off-gassing.

This would naturally refactor the project:

- `lhx`/SDK becomes the standalone long-horizon context manager.
- PI extension becomes thin lifecycle wiring.
- Other harnesses can plug in with their own ingest/render adapters.
- SQLite becomes domain-shaped rather than JSON-file-shaped or PI-rollout-shaped.

## Open Questions

- What exact event kinds are stable enough for v1?
- Do we need both `messages` and more specific records like `assistant_text`, `tool_calls`, `tool_results`, or should `conversation_items` be the common table?
- Which fields should be columns vs retained in `payload_json`?
- How much raw harness payload should be stored for audit/replay?
- Should the event log be the only authoritative source, or can materialized domain rows also be canonical after transaction-time projection?
- How should source revisions map to event order and materialized rows?
- What is the minimal migration path from current `message_json` rows?
- How do we test equivalence between old capture behavior and the new event/materialization path?
