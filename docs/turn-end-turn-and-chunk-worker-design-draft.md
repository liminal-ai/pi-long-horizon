# Turn-End Turn And Chunk Worker Design Draft

This is a design-spec draft for the next canonical LHX slice: explicit
`turn_end` intake, durable turn-processing triggers, targeted turn processing,
and incremental chunk update.

It is grounded in the current `packages/lh-context` canonical
`thread_events` path and uses the older context steward / PI path as the
behavioral reference. The goal is not to copy the old implementation
mechanically, but to preserve the behavior that made turns, chunks, smoothing,
and smart compact work.

## Purpose

This slice makes the canonical pipeline useful above the message/block layer.

Today, `packages/lh-context` has durable source events and first-level
projection into threads, messages, and message blocks. See
`packages/lh-context/src/thread-events/schema.ts` and
`packages/lh-context/src/thread-events/store.ts`, especially `appendMany`,
`projectEvent`, and `projectionDraftsForEvent`.

The next layer should:

- Accept an explicit canonical `turn_end` source event.
- Persist a durable queue trigger as part of successful append handling.
- Let an async worker process the ended turn.
- Persist turn-derived state needed by current behavior.
- Incrementally update chunk state for turns that are ready to chunk.
- Handle chunk-close projection/compression consequences in the same worker
  flow for this slice.

## Scope

In scope:

- Canonical `turn_end` event schema and semantics.
- Append-time handling of `turn_end` and durable trigger persistence.
- Canonical turn and chunk projection tables/state in `lh-context`.
- Deterministic turn and chunk ids.
- A per-thread serialized worker path for ended-turn processing.
- Turn smoothing and lower-band turn projection as part of turn processing.
- Non-ready/failed state persistence on the turn when processing cannot finish.
- Incremental chunk update that is behaviorally close to the current algorithm.
- Chunk-close lower-band detailed/brief projection work in the same worker.

Out of scope:

- Broad PI-specific intake wiring.
- LHX core inferring turn ends as the primary design.
- Full thread-wide repair on every turn end.
- A general-purpose scheduler architecture.
- A rich turn-end reason taxonomy.
- A complete repair/backfill system.
- Reworking thread-view selection or smart compact policy beyond the state this
  slice must produce.

## Settled Decisions

- `turn_end` is an explicit canonical source event.
- `turn_end` is not a projected message.
- The first `turn_end` in an append batch wins.
- After the first winning `turn_end`, skip all later input events until the
  next `user_prompt`; skipped events are not persisted and are reported as
  skipped, not failed.
- Queue trigger persistence is part of append handling, not a later best-effort
  side effect.
- A turn groups messages primarily, with event provenance/span alongside.
- A turn is the span since the last user prompt through `turn_end`.
- Canonical turns should stay fairly close to the current hardened
  `TurnRecord` shape in `src/thread/domain/records.ts`.
- Keep `messageIds` on turns; current correlation is one-way from turn to
  messages.
- `turnId` is deterministic from `threadId + turnOrder`.
- `chunkId` is deterministic from `threadId + chunkOrder`.
- The turn worker fully processes the current ended turn for this slice as far
  as configured dependencies allow, persisting durable non-ready state
  otherwise.
- If lower-band turn projection or exact token count is not ready, persist
  non-ready/failed turn-derived state and do not place the turn into a chunk.
- The same worker does chunk update and chunk-close projection work for this
  slice.
- Worker execution must serialize per thread.

## Canonical `turn_end`

`turn_end` should be added as a canonical source event kind in
`packages/lh-context/src/thread-events/schema.ts`.

The append input should be small and match the existing append event envelope:

```ts
{
  idempotencyKey: string;
  eventKind: "turn_end";
  actor: ActorRef;
  harness: HarnessRef;
  origin?: ThreadEventOrigin;
  occurredAt?: string;
  payload: {};
}
```

The persisted event should carry the normal generated fields and a tagged
payload:

```ts
{
  eventKind: "turn_end";
  payload: { _tag: "turn_end" };
}
```

This keeps `turn_end` aligned with the current schema style, where append
events provide a payload object and persisted payloads add `_tag`. The decoder
for this slice should require `payload: {}` for append input. If we later want
to allow omitted payloads for empty events, that should be an explicit decoder
special case rather than an accidental exception.

`turn_end` projects to zero messages and zero message blocks. This preserves
the current first-level projection boundary in `projectionDraftsForEvent`: a
source event can have no message projection, and source event semantics remain
available below the projected message layer.

The event means only: "the harness/client says the current turn is over." It
does not currently encode abort, timeout, disconnect, success, or any other
reason taxonomy.

If a valid/idempotent `turn_end` does not close an open user-prompt span, it
should still be persisted as a source event but should not enqueue a worker
trigger. Examples include `thread_created -> turn_end`, or a later separate
append that sends `turn_end` after the previous append already closed the
current span. This is distinct from a second `turn_end` in the same append batch
after a winning `turn_end`; that same-batch input is skipped by the batch rule
and is not persisted. The append result for a persisted no-open-span event
should make this visible, for example:

```ts
{
  ok: true;
  inputIndex: number;
  triggered: false;
  reason: "no_open_turn_span";
}
```

This keeps the source stream honest without inventing an empty turn.

## Batch Semantics

`appendMany` already processes events sequentially and commits each successful
event in its own transaction. That shape should stay.

For event handling inside one append batch:

1. Inputs are inspected in order.
2. Events that are not skipped are validated and appended in order.
3. The first committed `turn_end` that closes the span since the latest
   `user_prompt` is the winning boundary for this batch.
4. After that winning `turn_end`, all later input events are ignored until the
   next `user_prompt`.
5. Ignored events are not inserted into `thread_events`, do not project
   messages/blocks, and do not create queue triggers.
6. The next `user_prompt` is not ignored. It is appended normally and starts
   the next candidate turn span.
7. Boundary eligibility then reopens for that new span.

This is a concrete skipped-after-boundary rule, not merely "ignore later
`turn_end` boundaries." It applies to assistant text, thinking, tool calls,
tool results, runtime notes, and extra `turn_end` events that arrive after the
winning `turn_end` and before the next `user_prompt`.

The append result model should represent this explicitly. Current `appendMany`
returns per-item success/failure results; this slice should extend that model
with a skipped item result such as:

```ts
{
  ok: true;
  inputIndex: number;
  skipped: true;
  reason: "ignored_after_turn_end";
}
```

Skipped items are intentional no-ops, so they should not make the whole batch
`ok: false`. Validation for skipped items can be minimal: enough to recognize
whether the item is the next `user_prompt` that resumes normal append. Once a
`user_prompt` is recognized, it should be fully decoded and appended through
the normal path.

Append item control flow should stay simple:

- success: record a success result and continue
- skipped: record a skipped result and continue
- failure: record a failure result and break

Worked normal batch:

| Input | Handling |
| --- | --- |
| `user_prompt` | append, project message, open candidate span |
| assistant/tool events | append and project normally |
| first `turn_end` | append source event, project no message, insert trigger |
| assistant/tool/runtime events after `turn_end` | skipped, not persisted |
| next `user_prompt` | append normally, starts the next candidate span |

Worked retry batch:

| Input | Handling |
| --- | --- |
| `user_prompt` duplicate | returns existing event/projection |
| assistant/tool duplicates | return existing events/projections |
| duplicate winning `turn_end` | returns existing event/trigger state and re-enters skipped-after-boundary mode |
| later assistant/tool/runtime events before next `user_prompt` | skipped again, not persisted |
| next `user_prompt` | append or dedupe normally and starts the next candidate span |
 
This retry behavior keeps ambiguous client retries from accidentally admitting
events that were skipped during the original append.

An important retry/detail point: if the winning `turn_end` is encountered again
as a duplicate during a retried batch, that duplicate still counts as the
active boundary for skip behavior in that batch. In other words, deduping the
winning `turn_end` does not reopen the batch for later events that were
previously supposed to be skipped. A duplicate winning `turn_end` should
re-enter skipped-after-boundary mode until the next `user_prompt`.

The important semantic invariant is that one user-prompt-started span gets at
most one effective `turn_end`.

## Append Consequences

When a non-duplicate winning `turn_end` that closes an open user-prompt span is
committed, append handling must also persist a durable worker trigger.

This trigger write is part of append handling. It should not be a later timer,
in-memory pub/sub notification, or best-effort callback after the append result
has already been returned.

The current `ThreadEventStore.appendMany` path in
`packages/lh-context/src/thread-events/store.ts` is the relevant code shape:

- It resolves `clientThreadId` to canonical `threadId`.
- It decodes and appends events sequentially.
- It inserts a source event and first projection in one transaction per event.
- It returns per-event success/failure information.

For a `turn_end` that closes an open span, the per-event transaction should
include:

- Insert or dedupe the `thread_events` row.
- Project zero messages/blocks.
- If inserted and winning, insert a durable queue trigger using a deterministic
  trigger id.
- Update the thread's `updated_at`.

For a valid `turn_end` with no open span, the transaction should insert or
dedupe the source event, project zero messages/blocks, update the thread, and
enqueue no trigger.

If the queue trigger cannot be persisted, the `turn_end` append transaction
should roll back and return a per-item append failure rather than reporting
success with missing async work.

## Queue Trigger

The queue payload should stay tiny. The worker should read canonical state from
SQLite.

This slice chooses an internal SQLite queue/trigger table row in the same
`lh-context` database. Do not let queue package exploration drive the design.
`SqlPersistedQueue` or a similar queue abstraction is deferred until scoped,
long-lived Effect SQL client lifecycle work lands. A queue abstraction can be
reconsidered later only if it is verified to participate in the same SQLite
append transaction, or to provide equivalent all-or-fail atomicity with the
source event append.

This means "trigger" here means a durable trigger row for worker processing,
not necessarily a SQLite database `TRIGGER` object.

Required logical fields:

- deterministic trigger id, derived from `threadId` and the winning
  `turn_end` event order or source event id
- `threadId`
- `turnEndEventOrder`
- trigger status / claim metadata needed by the internal worker

Required queue properties:

- Trigger insertion for a winning `turn_end` happens in the same SQLite
  transaction as that source event append.
- A duplicate `turn_end` source event must not enqueue duplicate work.
- Re-attempting the same append after an ambiguous client failure should
  converge on the same source event and the same trigger id.
- Deterministic trigger-id conflict should be treated as idempotent only when
  it points at the same `threadId` and same winning `turn_end` event order.
- If the source event commits, its trigger must be durable too. Otherwise the
  append should fail and the `turn_end` source event should not be committed.
- Queue claiming/lease details can vary, but the stored trigger must be enough
  for a worker to load canonical state from SQLite and process idempotently.

The exact internal queue table shape is still open, but the implementation
should start from the required SQLite-row properties above.

## Provider Dependency Boundary

Provider-backed work must enter this slice through injected interfaces/options.

This includes:

- user-prompt model smoothing
- exact token counting
- lower-band turn projection token counting
- chunk-level detailed/brief lower-band compression

`lh-context` core must not import PI extension/runtime wiring, PI context
objects, PI model selection helpers, or provider construction from the current
PI extension. The PI path may provide implementations of these interfaces at
the integration edge, but the canonical turn/chunk worker should depend only on
small capability interfaces.

## Turn Model

Canonical turns should stay close to the current hardened `TurnRecord` from
`src/thread/domain/records.ts`.

The old shape has real scar tissue that downstream behavior depends on:

- `turnId`
- `threadId`
- `turnOrder`
- `lifecycleStatus`
- `repairStatus`
- `initiatingMessageId`
- `messageIds`
- `sourceRange`
- `openedAt`
- `closedAt`
- `sourceRevision`
- `rawTokenCountMetadata`
- `smooth`
- `repairMetadata`

The new canonical shape does not need to copy every name blindly, but this
slice should prefer capability preservation over simplification. In particular,
the new turn needs room for smooth state, lower-band turn projection state,
token count metadata, lifecycle/repair status, and provenance.

The turn should group messages primarily:

- `messageIds` remain on the turn.
- Messages do not need `turnId` in this slice.
- Correlation remains one-way from turn to messages.

Because the new canonical substrate is event-based, the turn should also carry
event provenance:

- starting event order
- ending `turn_end` event order
- source event id span or enough equivalent provenance for inspection/replay
- message order span or message ids for projected-message lookup

## Turn Boundaries

A turn is the span since the last user prompt through `turn_end`.

More concretely:

- The latest unclosed `user_prompt` starts a candidate turn span.
- The span includes that user prompt and all following projected messages that
  belong before the winning `turn_end`.
- The winning `turn_end` closes the turn.
- `turn_end` itself is provenance for the turn but is not a message in the turn.

This differs from the old PI path in mechanism, but preserves the behavioral
role of `finalizeOpenTurnOnTurnEnd` in
`src/thread/services/turn-service.ts`: PI's lifecycle hook closes the current
open turn, then background work fills in derived state.

The new path should not primarily rely on assistant `stopReason === "stop"` to
close the turn. That old rule in `applyCapturedMessageToTurns` is a behavioral
reference, not the canonical boundary source for this slice.

## Deterministic Ids

Turn ids should be deterministic:

```text
turnId = f(threadId, turnOrder)
```

Chunk ids should also be deterministic:

```text
chunkId = f(threadId, chunkOrder)
```

The exact string format can follow the existing projected-id style in
`packages/lh-context/src/thread-events/store.ts`, where message/block ids are
stable handles derived from thread id plus order. The important property is
that replaying the same canonical thread state yields the same turn and chunk
ids.

Ordering columns remain the real ordering semantics. String ids are stable
handles.

`turnOrder` and `chunkOrder` are append-monotonic and never reassigned. Later
repair/backfill may update or fill existing turn/chunk rows, but it must not
renumber prior turns or chunks.

## Fully Processed Turn

For this slice, "fully processed" does not mean "created a turn row." It means
the turn has the turn-derived state needed by the current behavior.

At minimum, the worker should attempt to persist:

- closed turn lifecycle state
- message ids and event/message span
- smooth turn components and materialized smooth text state
- smooth token metadata
- lower-band turn projection state
- exact lower-band projection token count
- raw/materialized token metadata needed by current smart-compact behavior
- non-ready/failed state for any derived field that could not become ready

The target is current-behavior parity, so token metadata should not be treated
as casually optional. Where exact counting cannot complete, the worker should
persist explicit non-ready/failed token-related state and keep the turn out of
chunks if the missing count is a chunk-eligibility prerequisite.

Current references:

- `ensureSmoothTurn` in
  `src/thread/async-thread/services/smooth-turn-service.ts`
- `materializeSmoothTurnFromState` in the same file
- `ensureLowerBandTurnProjection` in
  `src/thread/async-thread/services/lower-band-turn-projection-service.ts`
- token-count repair behavior in
  `src/thread/async-thread/services/async-thread-run-service.ts`

The detailed implementation can choose new canonical table shapes, but the
observed behavior should remain familiar: smooth state is assembled from turn
messages, lower-band turn projection is conversation-only, and chunk placement
requires ready turn-level lower-band projection with exact count.

## Worker Algorithm

The worker receives a durable trigger caused by a winning `turn_end`.

Expected high-level algorithm:

1. Serialize work for the thread.
2. Claim the trigger and read the canonical state needed to process that
   trigger's `turnEndEventOrder` in a short transaction.
3. Release the transaction before doing provider/model/token-count work.
4. Determine the one ended turn span closed by that `turn_end`.
5. Compute the turn work: smoothing, token counting, and lower-band turn
   projection using injected dependencies.
6. Reopen a short transaction, revalidate the trigger/thread/turn preconditions,
   and idempotently create or update the closed turn projection.
7. Persist ready or non-ready/failed turn-derived state.
8. If the turn lacks ready lower-band projection or exact token count, stop
   before chunk placement.
9. If the turn is chunk-eligible, compute and persist the incremental chunk
   update.
10. If chunk update closes a chunk, run detailed/brief chunk projection work
    through injected dependencies, again without holding a DB write transaction
    during provider work.
11. Reopen a short transaction, revalidate, and persist ready/failed chunk
    artifact state.
12. Mark the trigger complete only after the intended turn and chunk
    consequences have been handled or durable non-ready/failed state has been
    persisted.

The worker is targeted. It is not a replacement for
`maintainAsyncThread` in
`src/thread/async-thread/services/async-thread-run-service.ts`, which currently
does bounded catch-up across missing smooth turns, lower-band turn projections,
chunks, and token counts.

For this slice, one worker run processes the current ended turn only: the turn
closed by the trigger's `turnEndEventOrder`. It does not walk backward and
repair earlier unprocessed turns, and it does not perform bounded catch-up up
to the trigger order. If earlier turns are missing, incomplete, failed, or
unchunked, that is real maintenance debt for a future repair/backfill path, not
work this targeted trigger should absorb.

The worker must not hold DB write transactions while doing provider-backed or
slow work. The intended shape is: claim/read quickly, release the transaction,
do slow work, reopen a transaction, revalidate, then upsert idempotently. This
keeps SQLite write locks short and makes retries safer.

## Smoothing Expectations

The current smooth-turn component builder is deterministic and message-oriented.
It classifies parts into user prompt, assistant message, tool exchange, and
thinking components, then materializes smooth text from components.

The canonical worker should preserve that behavior in substance, while also
making the settled user-prompt smoothing decision explicit:

- Build smooth components from the turn's messages.
- Treat deterministic smooth-turn component building as the base turn-processing
  step.
- Treat model-backed user-prompt smoothing as a separate injected
  provider/service concern.
- Invoke the user-prompt smoothing provider for the user prompt in this worker
  when that provider is configured for the canonical pipeline.
- Persist a model-smoothed user prompt component when that call succeeds.
- Fall back to deterministic preservation when user-prompt model smoothing is
  unavailable, intentionally disabled, or fails in a recoverable way.
- Represent model-smoothing failure/fallback on the smooth component with
  status/quality/metadata rather than pretending no attempt happened.
- Render assistant text deterministically.
- Render tool exchange deterministically with bounded tool output.
- Omit thinking that has no plaintext.
- Persist degraded/non-ready state rather than losing state when smoothing
  cannot fully materialize.

This means deterministic preservation is the fallback and compatibility floor,
not necessarily the whole story for user prompts. The current
`smooth-turn-service` already has component status/quality/provider-metadata
concepts that are close to the shape this needs, even though the canonical
implementation may live in `lh-context`. The no-PI-runtime-imports boundary
from the provider dependency section applies here too: canonical smoothing code
uses injected capabilities, not PI extension wiring.

The worker should not postpone smoothing to a general background sweep. Smooth
state is part of making the ended turn real for this slice.

## Lower-Band Turn Projection

Each turn has one lower-band turn projection.

This is distinct from chunk-level detailed/brief summaries. The turn projection
is the conversation-only representation that chunk assembly concatenates.

The current projection behavior in
`src/thread/async-thread/services/lower-band-turn-projection-service.ts`
should be preserved in substance:

- Reasoning/thinking is excluded from lower-band turn projection.
- Tool calls/results are excluded from lower-band turn projection.
- User prompt and assistant message components are used.
- A turn with multiple user prompts is invalid for this projection.
- The projection requires exact token count metadata before it is ready.

If the projection cannot become ready, persist a pending/failed/invalid state on
the turn and do not place that turn in a chunk.

## Chunk Update

Chunking should stay behaviorally close to `updateChunkState` in
`src/thread/async-thread/services/chunk-service.ts`.

Preserved behavior:

- Maintain at most one open chunk.
- Create an open chunk when needed.
- Consider closed, unassigned, chunk-eligible turns.
- Require materialized smooth text that is `ready` or `degraded`, plus a ready
  exact lower-band turn projection, for chunk assembly.
- Compare the next eligible turn against the current open chunk.
- Close before append when soft-threshold rules say to.
- Append the turn to the open chunk.
- Close after append when hard-threshold rules say to.
- Open a new chunk after closing.
- Refresh closed chunk materialized state from source turns when needed.

The current thresholds are reference defaults, not a permanent canonical policy:

- target min smooth tokens: 1200
- target soft max smooth tokens: 1800
- hard max smooth tokens: 2200

This worker should update only the chunk path touched by the current ended turn
when that turn is eligible. It should not perform a full chunk rebuild from
scratch, and it should not use this trigger to catch up earlier unchunked
turns.

## Chunk-Close Projection Work

If chunk update closes a canonical chunk and the chunk has ready conversation
transcript state, the same worker should run chunk-level detailed/brief
projection/compression work for this slice.

This preserves the current consequence of chunk close while avoiding a second
durable trigger in the first design slice. The reference behavior is currently
split between:

- `updateChunkState`, which schedules lower-band compression on chunk close.
- `LowerBandCompressionService` in
  `src/thread/async-thread/services/lower-band-compression-service.ts`, which
  generates detailed/brief chunk artifacts.

The new canonical design can internalize this in one worker flow, while still
keeping the implementation modular.

Running detailed/brief compression inline can make one trigger run slower
because it may call providers. That is intentionally accepted for this slice so
chunk-close consequences become durable immediately. Keep the code modular so
this work can split into a later trigger if the runtime cost becomes a problem.

## Failure And Non-Ready Handling

The worker should prefer durable non-ready state over silent omission.

If smoothing cannot fully materialize:

- Persist missing/pending/degraded/invalid smooth state on the turn.
- Do not treat the trigger as if a ready turn was produced unless downstream
  prerequisites are met.

If lower-band turn projection cannot become ready:

- Persist pending/failed/invalid projection state on the turn.
- Include error code/message where available.
- Do not place the turn into a chunk.

If exact token count is unavailable or fails:

- Persist failed/non-ready token-related state on the relevant turn projection.
- Do not place the turn into a chunk.

If chunk-close detailed/brief projection fails:

- Persist failed/non-ready chunk artifact state.
- The trigger may still be considered handled if the failure state is durable
  and retry/backfill can later find it.

Trigger completion depends on durability:

- If the worker persists a terminal ready/non-ready/failed state for the current
  turn and any chunk-close consequence it attempted, the trigger can be marked
  complete.
- If the worker hits a transient infrastructure failure before durable state is
  persisted, the trigger must remain retryable and must not be marked complete.
- If provider work returns a durable domain failure, persist that failure state
  and then complete the trigger.

This follows the old system's broad pattern of status-bearing records
(`repairStatus`, smooth status, lower-band projection status, chunk artifact
status), but applies it to the targeted worker path.

## Serialization

Worker runs must serialize per thread.

The old system has several in-memory serializers and in-flight sets:

- `withSerializedThreadOperation` in `src/thread/services/thread-service.ts`
- per-store mutation queues in file/SQLite stores
- lower-band compression `inFlight` tracking

Those are useful reference points, but this canonical path needs a durable
worker story that remains correct across process boundaries. At minimum:

- Only one worker should mutate turns/chunks for a thread at a time.
- Retries should not create duplicate turns or duplicate chunk assignments.
- Queue claim/lease semantics should compose with per-thread serialization.

The exact locking/claiming mechanism belongs with the final queue design.

## Idempotency And Replay

Important idempotency expectations:

- Source events continue to use `idempotencyKey` uniqueness per thread.
- Duplicate `turn_end` input returns the existing event and does not enqueue
  duplicate work.
- A winning `turn_end` trigger uses a deterministic id, so retrying append
  cannot create a second trigger for the same boundary.
- Deterministic `turnId` and `chunkId` make replay/backfill less surprising.
- Worker writes should be upsert/idempotent against deterministic ids and
  source/projection watermarks.
- Re-running a completed trigger should converge on the same turn and chunk
  state, not append another copy.

The worker should be able to recover after partial progress:

- If the turn row exists but smooth state is missing, continue from the turn.
- If smooth state exists but lower-band projection is failed, preserve or retry
  according to retry policy.
- If the turn is not chunk-eligible, leave it unchunked with durable state.
- If a chunk already contains the turn id, do not append it again.

## Persistence Changes In `lh-context`

This slice requires new canonical tables or equivalent persisted state in the
`lh-context` SQLite database. Identity, order, status, and span fields must be
queryable columns. Rich derived payloads can start as JSON.

Minimum additions:

- Add `turn_end` to event schemas.
- Add queue storage for durable turn-processing trigger rows.
- Add `turns`.
- Add `chunks`.
- Add chunk lower-band artifact state, either in chunk rows or companion rows.

Required queryable trigger columns:

- `trigger_id`
- `thread_id`
- `turn_end_event_order`
- `status`
- `created_at`
- `updated_at`
- claim/lease/attempt fields as needed by the worker

Required queryable `turns` columns:

- `turn_id`
- `thread_id`
- `turn_order`
- `lifecycle_status`
- `processing_status` or `repair_status`
- `initiating_message_id`
- `from_message_order`
- `to_message_order`
- `from_event_order`
- `turn_end_event_order`
- `opened_at`
- `closed_at`
- `source_revision` or projection watermark

Initial JSON payload fields on `turns` can include:

- `message_ids_json`
- `raw_token_count_metadata_json`
- `smooth_json`
- `repair_metadata_json`

Required queryable `chunks` columns:

- `chunk_id`
- `thread_id`
- `chunk_order`
- `lifecycle_status`
- `opened_at`
- `closed_at`
- `close_reason`
- `source_revision` or projection watermark

Initial JSON/text payload fields on `chunks` can include:

- `source_turn_ids_json`
- `smooth_text`
- `smooth_token_count_metadata_json`
- `conversation_transcript_json`
- `lower_band_json`

This draft intentionally does not force aggressive normalization. The current
SQLite steward store keeps rich turn/chunk JSON rows with some indexed ordering
columns. The current `lh-context` first projection uses more normalized message
and block rows. The implementation design should choose the shape that best
balances queryability, replay, and preserving hardened behavior.

## Required Tests

Design-level test coverage should include at least:

- `turn_end` source event persists with no message/block projection.
- Append of a winning `turn_end` and its trigger is atomic.
- Duplicate `turn_end` returns the existing event and creates no duplicate
  trigger.
- After a winning `turn_end`, append skips later input events until the next
  `user_prompt`.
- `turn_end` with no open user-prompt span persists the source event but creates
  no trigger.
- Worker creates the deterministic closed turn for the current ended span.
- Non-ready turn-derived state blocks chunk placement.
- Eligible current ended turn updates chunk state incrementally.
- Chunk close persists detailed/brief chunk artifacts as ready or failed.
- Transient infrastructure failure before durable state is persisted leaves the
  trigger retryable.
- Provider/model/token-count work is not performed while holding DB write
  transactions.
- Worker rerun is idempotent and does not duplicate turns, chunks, assignments,
  triggers, or artifacts.

## Intentional Preservation From The Old System

The old PI path does three relevant things on `turn_end`:

- Finalizes the open turn via `finalizeOpenTurnOnTurnEnd`.
- Refreshes prompt projection.
- Schedules background maintenance.

The maintenance flow then does much more than this new slice should do:

- Smooth-turn repair.
- Lower-band turn projection repair.
- Chunk update.
- Token-count repair.
- Chunk lower-band catch-up.
- Maintenance status updates.

This design preserves the important behavior but changes the shape:

- `turn_end` becomes a canonical source event.
- The trigger is durable and part of append handling.
- The worker targets the current ended turn rather than sweeping the whole
  thread or catching up older turns.
- Turn-derived state is persisted on the turn.
- Chunk update remains incremental.
- Repair/backfill for other turns becomes a separate future path.

## Remaining Open Questions

These are the real questions still worth carrying into the detailed
implementation pass:

- What is the exact internal SQLite queue table/record shape?
- What are the exact worker-read queries for loading the thread, events,
  messages, the current ended turn span, open chunk, and relevant closed chunk
  state for the trigger's `turnEndEventOrder`?
- What should the later repair/backfill path for other turns look like, and
  which statuses or indexes should this slice add now so that path is easy to
  build?
