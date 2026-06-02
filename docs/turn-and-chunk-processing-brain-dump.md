# Turn And Chunk Processing Brain Dump

This is a brain dump, not a spec.

It is meant to capture the shape of the conversation around turns, chunks, `turn_end`, queue triggers, and async projection work in the new canonical LHX path. It is deliberately a little loose. Some of this feels pretty solid. Some of it is still more like "this is where our heads are right now and why."

The goal here is not to pretend we have already finished the detailed design. The goal is to preserve the conclusions, the reasoning, the tradeoffs, and the places where we explicitly decided not to overbuild yet.

## The basic shift

We now have canonical `thread_events` plus first-level projection into `threads`, `messages`, and `message_blocks`.

The next major slice is not "general intake" in the abstract. It is the turn and chunk processing path that sits on top of that event substrate.

That means:

- source events come in
- some source events tell us a turn has ended
- that should kick off async work
- that async work should create the turn, do the turn-level processing, and then update chunk state

This is the essence of the new system we were trying to isolate.

## Why this slice matters

This slice feels important because it is the first place where the new system really starts acting like itself.

Up to now, we mostly built:

- event intake
- first-level storage
- first-level deterministic projection

This next slice starts to express the higher-level model:

- turns exist as real projected entities
- chunks exist as real projected entities
- async processing is part of the canonical pipeline rather than a sidecar afterthought

That is also why it felt like a better next slice than jumping back to PI wiring too early. We were trying to finish more of the source-of-truth layer before over-orienting around one harness.

## Keep the intake boundary clear

One thing that became important in the discussion was staying oriented to the actual boundary we were talking about.

We were not primarily talking about the existing PI extension internals as the design surface. We looked at them to understand the current algorithm. But the boundary under discussion is:

- LHX SDK / CLI canonical thread event intake
- `createThread`
- `appendThreadEvents`

That matters because it changes where turn-end knowledge lives, where async work gets triggered, and what should or should not be inferred by the LHX core.

## Strong lean: explicit `turn_end` event

The current lean is pretty clearly toward having an explicit canonical `turn_end` source event.

This felt cleaner than asking LHX core to infer turn ends from batches or from message patterns as the primary design.

Reasons this felt good:

- it keeps event items more stateless
- it avoids needing batch-level relationship logic just to understand whether a turn ended
- it lets the harness/client own the knowledge it already has
- it keeps the canonical stream honest: the harness says the turn ended, and we record that fact

There was also a strong stylistic fit here with the direction already taken for events: try not to make event meaning depend on neighboring events in the same batch more than necessary.

So the current shape is:

- normal events come in
- when the caller knows the turn ended, it includes a `turn_end` event

That means LHX is not "deciding" that a turn ended in the first instance. It is responding to a canonical source event that says that it did.

This is not locked forever. It is still possible later that some adapters or harnesses synthesize `turn_end` internally before submission, or that some inference rules get added somewhere. But the current clean center feels like: explicit event.

## Minimalism around `turn_end`

We talked about not throwing the kitchen sink into the `turn_end` event.

The current feeling is that `turn_end` should be very small in v1.

Probably just:

- normal event envelope metadata
- `eventKind: "turn_end"`
- `occurredAt` if meaningful

And not much else.

There was discussion about whether to include a reason like:

- user aborted
- timeout
- disconnect
- some other early termination

The current lean was to wait on that.

Why wait:

- it is not required for turn/chunk projection
- it forces taxonomy decisions early
- different harnesses are likely to have different meanings and edge cases

So the current position is: `turn_end` just means the harness says the turn is over. If later we need a reason, we can add one.

## What should happen synchronously at intake

There was a useful simplification here.

We do not currently seem to want a separate persisted "turn boundary checkpoint record" just for the sake of it.

The synchronous path after append should probably stay very small:

1. append the source events
2. if the committed batch contains `turn_end`, write one durable projection trigger into a queue

That is the main sync consequence of `turn_end`.

So there is no strong current case for:

- a separate turn-boundary projection row just to launch async work
- a large queue payload
- a rich new job object model

The queue trigger itself is probably enough.

## Keep the queue payload tiny

We spent some time correcting drift here too.

The repo today does not really have a fancy first-class job scheduler with elaborate job records. The current async patterns are much simpler and more keyed:

- `{ threadId, messageId }`
- `{ threadId, chunkId, requiredBands?, mode }`
- per-thread pending/running state
- `inFlight` dedupe sets

For the new canonical path, we still want durability, but that does not mean we need a giant payload.

The current lean is that the queue entry should be tiny. Something like:

- `threadId`
- `turnEndEventOrder`

Maybe that ultimately becomes `throughEventOrder` instead of a specifically named turn-end field, but the spirit is the same: the worker needs to know which thread and how far into the committed stream this trigger is valid.

It probably does not need:

- the entire event batch copied into the queue
- a list of event ids
- a turn id that does not exist yet
- a big lifecycle blob
- a lot of per-batch relationship state

The worker should read the real canonical events and messages from SQLite.

## Effect queue thoughts

We explicitly looked at Effect here.

One important finding was that this is not just a choice between:

- in-memory `Queue` / `PubSub`
- hand-rolled durability

Effect now has `SqlPersistedQueue`, which makes a durable SQL-backed queue feel much more natural in this design space.

That does not mean the detailed queue implementation is fully decided. But it does matter because it makes the durable trigger story feel much more native to the stack we are already moving toward.

Current feeling:

- plain in-memory `PubSub` is not enough as the primary truth for this path
- a durable SQL-backed trigger fits the importance of the turn/chunk projection pipeline much better

This is still not the same as saying we need a grand scheduler architecture. It just means the trigger should survive process boundaries and not be best-effort only.

## Current code as reference, not as prison

We spent time checking how the current system actually behaves so we do not accidentally design from vibes.

That code review matters, but it should not be mistaken for "the new system must reproduce every shape exactly."

The important thing is understanding the current successful behavior and what part of it we want to carry forward.

### What current `turn_end` actually does

Current `turn_end` handling in the PI path does not itself directly run all of the turn/chunk logic inline. What it does is:

- finalize the open turn
- refresh prompt projection
- kick off background maintenance

That background maintenance then tries to repair a number of things.

### What current background maintenance actually does

The current maintenance path is much broader than the new slice we are describing.

It is a bounded catch-up sweep across the thread. It attempts to:

- repair missing smooth-turn state for closed turns
- repair missing lower-band turn projections for closed turns
- update chunk state
- repair token count state
- manage various readiness and maintenance status records

That means the current system is more "repair whatever is behind" than "do exactly one fresh turn and stop."

This was a useful finding because it clarified that the new path does not need to begin by copying that whole repair-sweep model.

## Important conclusion: the new worker does not need to be a repair sweep

We explicitly landed on the idea that this new slice probably should not start as a thread-wide repair process that reconsiders everything every time.

Instead, the better shape for the new path seems to be:

- one queue trigger per ended turn
- one worker pass per ended turn
- process that turn fully
- then update chunk state in the precise current style

So this is more targeted than the current background maintenance flow.

There will still likely need to be a repair/backfill path later. That felt clear. But it did not feel like the essence of the new design slice.

## What the worker should own

The worker for this slice is doing real work, not just moving bookkeeping around.

The current shape we discussed is:

1. receive a durable queue trigger caused by `turn_end`
2. load the thread and canonical data through that event watermark
3. build or finish the one closed turn that this trigger corresponds to
4. do the turn-level async work needed to fill in the turn's additional projected fields
5. update chunk state using that newly available turn
6. if that chunk path needs more projection work, do that before finishing

The key thing here is that this worker is not just "notice turn end" and then defer everything forever.

It is the actual turn-processing path.

Another way to say it: once this worker finishes, the expectation is not "we created some kind of shell and someone else will eventually make it real." The expectation is much closer to "the turn that just ended now has the fields and projections it is supposed to have for this slice, and the chunk consequences of that turn have also been handled."

This is one reason the slice felt meaningful. It is not only about detecting turn end. It is about finishing the work that a turn end is supposed to cause.

## Turn work vs chunk work

One useful clarification was separating different kinds of work:

- turn construction
- smooth turn work
- token counts
- lower-band turn projection
- chunk placement
- chunk-level projections/artifacts

The current conclusion was that for this slice, the worker should probably do everything needed to make that turn real and then immediately handle chunk placement.

That probably wants to be read pretty strongly, not weakly.

The worker is not just creating a boundary or a shell. It should do the actual turn work for the specific turn in play:

- create the turn
- fill in the turn-level derived/projection fields that are supposed to exist for this slice
- run the turn-side async/inference work that belongs to that turn

Then it should do the chunk-side work that follows from that completed turn:

- decide where that turn lands relative to the current open chunk
- close/open chunks if the current chunk algorithm says to
- if closing a chunk implies chunk projection work, do that work too

That means this worker is not just:

- make a skeleton turn
- leave chunks for some later vague process

It is:

- make the turn fully processed for this slice
- then place it into chunk state correctly
- then finish the chunk-side consequences that result from that placement

There was some earlier looseness around whether chunk-level projection output generation might get split again after chunk close. By the end of the conversation, the direction leaned toward having the same worker do that chunk projection work when chunk close actually happens, at least for this slice.

That was part of why the slice felt substantial and meaningful: it would carry the turn all the way through to chunk consequences.

One useful framing here is that the worker should focus on the particular turn and the particular chunk path touched by that turn, not on re-running general repair for everything in the thread.

So the emphasis is:

- finish the turn that ended
- finish the chunk consequences caused by that turn
- stop

Not:

- use the turn end as an excuse to sweep the whole thread for every missing thing

The repair/backfill story can exist later as a separate path.

## Existing runtime materialization as a clue

Part of the motivation for this shape is how the current code already tends to work.

There are places where fields get generated earlier, and then a later runtime/materialization step mostly assembles or concatenates those already-generated fields into the final visible form. In other words, the value is in having the component parts already projected and stored, not in having some giant runtime method do clever synthesis from scratch every time.

That points in a similar direction for the new turn worker:

- do the real turn-side generation/projection work when the turn ends
- persist those results
- do the chunk-side generation/projection work that follows from that turn
- leave later runtime/materialization steps relatively light because the important projected fields already exist

This is another reason the slice is more than just "create a turn row." The quality of the later runtime path depends on the worker actually filling in the turn and chunk fields that downstream code expects to already be there.

## Current chunk algorithm matters

One reason we did not want to hand-wave here is that the current chunk logic is fairly precise and apparently works pretty well.

The current chunk algorithm does not rebuild all chunks from scratch every time.

It is incremental.

Roughly:

- ensure there is exactly one open chunk
- refresh derived fields for closed chunks if needed
- find closed turns not yet assigned to any chunk
- only consider turns whose turn-level prerequisites are ready
- compare each eligible turn against the current open chunk
- close the open chunk before append if soft-threshold rules say to
- append the turn
- close the chunk after append if hard-threshold rules say to
- open a new chunk when needed

That was an important detail because it means the new worker should probably not think of chunking as "recalculate all chunks" but more as "update chunk state against the current open chunk and existing assignments."

## Current chunk thresholds as reference

We looked at the current defaults in code, mainly as a reference point:

- target min smooth tokens: 1200
- target soft max smooth tokens: 1800
- hard max smooth tokens: 2200

These are useful to remember because they explain the existing behavior, but they should not be treated in this document as a permanent policy decision for the new canonical system. They are just part of understanding the current algorithm that the new path is likely to model.

## What we are not trying to do in this slice

Some explicit non-goals or at least "not first" items came into focus.

We are probably not trying to do all of this in the first turn/chunk slice:

- full thread-wide repair every time a turn ends
- broad PI-specific intake wiring
- all-harness turn-end inference logic in LHX core
- a huge scheduler architecture
- overdesigned queue payloads
- every possible turn-end reason taxonomy
- a complete backfill/repair regime for every failure mode

Those things may come. Some almost certainly will. But they are not the center of the slice we are talking about here.

## Why explicit `turn_end` still feels especially right

By the end of the discussion, one of the stronger arguments for explicit `turn_end` was not only harness knowledge. It was also fit with the general style of the event model.

We have generally preferred event shapes where each event is meaningful on its own, without depending too much on hidden relationships to neighboring events in the same append batch.

That makes `turn_end` feel especially coherent:

- the harness emits a real event saying the turn ended
- LHX records it
- LHX responds by queueing projection work

That is cleaner than having LHX peer across the batch and decide that some combination of events implies turn closure while also trying to avoid statefulness between items.

## Questions We Actually Answered

It became clear at a certain point that the conversation had answered a lot more than it first seemed to. This section is here mainly so that later agents do not have to reconstruct all of it from memory or from the full chat history.

These are not written like a formal spec. They are just the working answers we converged on.

### `turn_end`

- `turn_end` should be an explicit canonical source event.
- The harness/client is responsible for knowing when the turn ended and emitting that event.
- We are not trying to make LHX core infer turn end as the primary design.
- `turn_end` should stay small for now.
- We are not adding a reason taxonomy yet.
- `turn_end` is a source event, not a projected message.

### What a turn is

- A turn is the span since the last user prompt through the emitted `turn_end`.
- That span includes the user prompt and everything after it that belongs to the turn.
- Turns should still group messages primarily, because the current turn/chunk/smoothing code is message-oriented.
- Turns should also carry event provenance/span, because the new system is built on canonical `thread_events`.
- Current correlation is one-way from turn to messages.
- Keep `messageIds` on the turn.
- Messages do not need to gain `turnId` in this slice.

### Turn shape

- Keep the new canonical turn fairly close to the current hardened `TurnRecord` shape.
- Do not treat this refactor as an excuse to streamline away hard-won fields just because the old shape looks messy.
- The important standard here is preserving capability and behavioral equivalence first.
- The turn worker should fill in all the turn-derived fields needed by downstream behavior, especially the fields needed for smoothed-turn use and chunk placement.

### Deterministic ids

- `turnId` should be deterministic from `threadId` + `turnOrder`.
- `chunkId` should be deterministic from `threadId` + `chunkOrder`.

### Batch behavior

- First `turn_end` in a batch wins.
- After the first `turn_end`, ignore later events until the next `user_prompt`.
- Duplicate `turn_end` should be ignored through normal idempotent behavior.

### Trigger / queue behavior

- `turn_end` causes a durable projection trigger to be written as part of append handling.
- We are not adding a separate turn-boundary checkpoint record just to launch async work.
- The queue payload should stay small.
- The worker should read real canonical state from SQLite rather than having a fat copied payload.

### Worker shape

- The worker for this slice is targeted, not a general repair sweep.
- It should finish the turn that just ended.
- It should then run chunk update for the chunk path touched by that turn.
- If that chunk path closes a chunk and chunk projection/compression work needs to happen, do that in the same worker flow for this slice.
- We are not splitting chunk-close projection into a second durable trigger in this first design slice.

### Turn processing expectations

- A "finished" turn for this slice means the turn has the derived fields downstream code actually needs, not just a boundary shell.
- User-prompt smoothing belongs in the same turn worker for this slice.
- The worker should persist non-ready / failed turn-derived state on the turn when it cannot finish some part of the turn.

### Lower-band projection and chunk placement

- Each turn has one lower-band turn projection.
- That turn-level lower-band projection is not the same thing as chunk-level detailed/brief compression.
- Detailed and brief are chunk-level outputs.
- Chunk assembly uses turn lower-band projections, concatenated in order at the chunk level.
- If a turn does not have a ready lower-band turn projection and its exact token count, it should not be placed into a chunk yet.
- In that case, persist non-ready / failed state and leave the turn unchunked for later retry/repair.

### Chunk behavior

- Chunking should stay behaviorally close to the current incremental algorithm.
- Do not turn this slice into a full chunk rebuild from scratch every time.
- Keep the existing feel of comparing eligible turns against the current open chunk and closing/opening chunks according to the same general rules.

### Concurrency

- Serialize this worker per thread.
- Concurrency across threads is fine.
- Concurrency within the same thread is not fine for this slice because turn/chunk state depends on ordered mutation against the same open chunk.

## Open questions that still seem real

A few things still seem meaningfully open, not in a fake way but in a real way:

- exact queue persistence shape and worker-read query shape
- whether a worker run should always process exactly one ended turn, or catch up more than one ended turn within a bounded watermark when the thread has fallen behind
- what the repair/backfill path should look like later, once this targeted happy-path worker exists
- whether any old maintenance/inspection fields need to be mirrored directly now versus added later once the new path is working

Those are all the kinds of things a more detailed design pass should iron out.

## Current mood of the decision

If this all had to be summarized in a few lines, the mood is something like:

- keep source events clean and explicit
- let the harness/client emit `turn_end`
- keep the sync intake path small
- write one durable trigger when a turn ends
- let an async worker process one turn fully
- then let that same worker update chunk state in the current precise incremental style
- avoid pretending we need a full repair-everything loop as the starting point

That is probably the heart of the conversation.

## Why this slice feels like the right next build target

This slice felt right because it is both substantial and bounded.

It is substantial because it includes:

- new source event shape (`turn_end`)
- durable async trigger
- real turn processing
- real chunk placement
- real chunk-close consequences

And it is bounded because it still avoids:

- total harness integration breadth
- full repair architecture
- broad algorithmic side quests

So it feels like a good "essence of the new system" slice: not trivial, not all of phase two, but enough to make the architecture real.
