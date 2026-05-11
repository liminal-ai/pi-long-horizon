# PI Long Horizon Architecture And Naming Braindump

This document is a self-contained architecture and naming braindump for PI
Long Horizon. It is written for a fresh high-capability model or engineer who
does not have prior context on the project.

The immediate goal is not to finalize implementation. The immediate goal is to
understand the system well enough to propose a clean top-level domain and
module breakdown with normal, non-weird names.

The current problem is not just that some names are ugly. The deeper problem is
that the current top-level breakdown is not yet clean enough, so naming keeps
slipping back into stale architecture labels, over-abstract words, or weird
half-technical phrases.

This document tries to surface:

- what the system is
- what the system is not
- what the major concepts are
- what the product is trying to do over time
- what Feature 1 and Feature 2 established
- what Feature 3 is trying to establish
- where the naming is currently bad
- what naming preferences the human explicitly wants
- what abstraction tensions still need to be resolved

It is intentionally more expansive than a normal spec note. The point is to
help a stronger model or reviewer enter the problem with enough context to
suggest a sane structure.

---

## 1. What This Product Is

PI Long Horizon is a long-horizon agent CLI layered around PI.

At a high level:

- PI is the existing interactive agent runtime.
- PI Long Horizon is not forking PI.
- PI Long Horizon is building a context-management system around PI so long
  coding sessions stay coherent after a raw transcript becomes too large.

The key product idea is:

- store the complete source history
- derive lower-fidelity context layers over time
- build a runtime-facing context object from those layers
- give the runtime a shorter, usable file/view when needed

This is not a generic chat memory system. It is specifically about making
agentic coding sessions remain coherent over larger histories without treating
the runtime transcript as the canonical truth.

The system is local, file-backed, TypeScript/Node, and the first runtime target
is PI.

---

## 2. What The Product Is Not

Important anti-misreadings:

- It is not just "add summaries to PI."
- It is not just "compact the transcript."
- It is not just "a browse UI over chat history."
- It is not a PI fork.
- It is not a system where the generated runtime file becomes source truth.
- It is not a model-dependent system at every stage.

Feature 3 in particular is trying to prove that the interlocking mechanics of
the long-horizon system can work deterministically before model quality is
introduced in Feature 4.

---

## 3. Product Center Of Gravity

The system has two major truths:

1. There is a complete source record.
2. There is a curated runtime-facing view built from that source.

That distinction matters everywhere.

The source side should remain authoritative.
The runtime-facing side should remain replaceable, rebuildable, and targetable.

The design work keeps getting into trouble when names blur those two ideas.

Examples of blur:

- treating a runtime file as if it were the source record
- calling everything "projection" when the richer concept is now "Thread View"
- calling internal domains "Context Steward Core" as if the actor name were a
  permanent technical surface
- using vague buckets like "Background Maintenance" or grandiose names like
  "Projection Compiler"

The system needs clearer top-level concepts.

---

## 4. Canonical High-Level Concepts

These are the major product concepts as currently understood.

### Thread

The Thread is the authoritative source-of-truth record.

It contains the full source history.

It is not the PI runtime file.

It includes:

- actors
- messages
- typed parts
- prompt-bounded turns
- chunk state
- job state
- output metadata

The Thread should be thought of as the canonical stored history.

### Thread View

A Thread View is the curated runtime-facing context built from a Thread.

It is not source truth.

It is a structured context expression over the Thread.

It is used:

- for inspection
- for curation
- for rebuilds
- for runtime-facing output

Important lifecycle facts:

- one Thread can have many Thread Views
- exactly one Thread View is active at a time
- others may be draft or archived
- draft Thread Views start empty and are filled from source truth
- editing a Thread View is curation, not source mutation

The system moved from older "projection revision" language toward Thread View
because Thread View is the richer and more truthful concept.

### Turn

The canonical turn is prompt-bounded.

It is not PI's smaller internal assistant/tool cycle notion.

One initiating prompt plus everything that follows until the next initiating
prompt is the canonical turn.

That turn is the upper-band coherence unit.

### Smooth Turn

A smooth turn is a single readable text representation of a closed turn.

In Feature 3 it is deterministic, not model-generated.

The current intent is:

- one smooth text field per turn
- preserve actor back-and-forth
- use fixed section markers like user, assistant, tool, thinking
- apply deterministic cleanup and deterministic tool-output handling

### Chunk

A chunk is a group of consecutive smooth turns.

There is exactly one open chunk at a time.
Older chunks are closed.

Chunks become the lower-band unit.

Chunks are not supposed to be reshuffled casually once closed.

### Placeholder Lower-Fidelity Outputs

Feature 3 does not do semantic summarization.

Instead, closed chunks get deterministic placeholder representations:

- detailed placeholder at about 30 percent
- brief placeholder at about 5 percent

These are mechanics placeholders, not quality summaries.

They must be visibly marked as placeholders.

### PI Target Output

The system eventually needs to hand something back to PI.

Historically, the docs used names like:

- generated PI session file
- projection revision
- projection compiler

Those names are now suspect.

The current direction is:

- Thread View is the central runtime-facing concept
- PI is one target or harness
- a PI-specific thread-view file or format is produced from a Thread View

The exact naming around this surface is one of the things we are trying to
clean up.

---

## 5. Feature Progression

### Feature 1

Feature 1 established the source-of-truth substrate:

- thread store
- messages
- parts
- prompt-bounded turns
- attach/import
- repair
- generated output metadata

It proved that PI activity can be captured into a canonical stored history.

### Feature 2

Feature 2 established the Context Workbench and Thread View as real product
concepts.

Major outcomes:

- Thread View as a first-class object
- workbench search, skim, inspect
- draft/active/archived Thread View lifecycle
- upper-band composition
- minimal lower-band awareness
- compare/activate

Important caveat:

Feature 2 ended with a seam around lower-band reality.

It could reason about lower-band concepts, but some lower-band paths were still
test-injected or minimally wired rather than fully production-backed.

That seam now matters for Feature 3.

### Feature 3

Feature 3 is supposed to make the full banded-fidelity maintenance loop real,
deterministically.

The current Epic 3 direction is:

- deterministic smooth-turn generation
- deterministic chunk growth and closure
- deterministic placeholder lower-band generation
- rebuild Thread Views under explicit per-run compaction inputs
- write a PI-native target file
- archive prior output
- reload PI
- explicit blocked/degraded state

### Feature 4

Feature 4 is where qualitative model work enters:

- model-assisted smoothing
- model-assisted boundary decisions
- real detailed summaries
- real brief summaries
- quality evaluation and tuning

Feature 3 should not absorb Feature 4’s quality work.

---

## 6. Why Naming Has Become A Problem

There are at least four naming failure modes that have shown up:

### A. Actor branding leaked into technical surfaces

`Context Steward` is a useful actor/product concept.

It is not a good default prefix for every module or surface.

Names like `Context Steward Core` are disliked because they blur:

- product actor
- requirements user
- implementation surface

The human explicitly wants to stop deepening that naming.

### B. Older architecture names have more weight than they deserve

Names like:

- `Projection Compiler`
- `ProjectionRevision`
- `PI Runtime Integration`

were reasonable at one point in the architecture, but they are now steering the
thinking in stale directions.

They make the system feel more abstract, weirder, and less grounded than it
needs to be.

### C. Over-abstract middle nouns are weak

Examples:

- manager
- broker
- maintenance
- integration
- compiler

These are often either too vague or too grand.

The human wants:

- normal
- plain
- responsibility-shaped
- not weirdly academic
- not overbranded
- not overblown

### D. Top-level surfaces and submodules are not yet fully disentangled

Some naming problems are really structure problems.

Example:

- if `thread-view` is a top-level surface
- then `thread-view-builder` is a module inside it
- not another top-level surface

The naming keeps drifting when the structural hierarchy is not fully nailed
down.

---

## 7. Human Naming Preferences

These preferences are explicit and should be treated as binding design
constraints, not as style suggestions.

### Preference 1: Stop deepening bad old names

Specifically:

- stop reinforcing `Context Steward Core`
- stop reinforcing `projection` as the main concept
- stop reinforcing `compiler` when the behavior is closer to building or
  writing

### Preference 2: Use plain, non-weird English

The human strongly dislikes names that feel:

- stilted
- over-abstract
- over-clever
- over-academic
- overengineered
- “system diagram names” instead of normal language

Names should feel like things a sane engineer would naturally say.

### Preference 3: Prefer responsibility names over vague managerial nouns

`manager`, `broker`, and similar words are weak unless there is a very strong
reason for them.

`builder` was liked because it actually describes assembly behavior.

### Preference 4: Keep top-level surfaces short and strong

The emerging pattern the human liked was:

- `thread`
- `thread-view`
- `async-thread`

These are short, broad, readable, and not overdesigned.

### Preference 5: Allow concrete shorthand in code, readable names in docs

Example the human accepted:

- in docs/comments: `PI CLI harness adapter`
- in code/shorthand: `pi-cli-ha`

So:

- docs can be more spelled out
- code can be compact
- but the compact form still needs to be intelligible

### Preference 6: Avoid fake precision around tunable values

Things like:

- chunk token range
- band percentages
- lower-bound target

are important, but they are not sacred design truths.

The design should distinguish:

- structural architecture decisions
- tunable operational values

and should not pretend every config knob needs rigid doctrinal treatment.

---

## 8. Current Naming Moves That Seem Better

These are the newer names or naming directions that appear healthier than the
old ones.

### `thread`

This seems to be the top-level source-of-truth surface.

It is the canonical record side.

It is short and clean.

### `thread-view`

This seems to be the top-level curated runtime-facing surface.

This is not merely a helper object.

It is a primary system concept.

The human explicitly corrected the distinction:

- `thread-view` is the higher-order surface
- `thread-view-builder` is a module inside it

That distinction matters.

### `thread-view-builder`

This is liked as a module name.

It is plain.
It describes assembly work.
It is not weirdly magical.

But it should be understood as living under the `thread-view` surface.

### `pi-thread-view-builder`

This was a healthier replacement for `projection compiler`.

Reason:

- PI is one target or harness
- Thread View remains the central concept
- `builder` is normal language

This suggests a pattern where different targets could later have their own
thread-view builders.

### `async-thread`

This was chosen as the broad top-level surface for the async derived-state side.

It is intentionally less “fully descriptive” than a longer three-word noun
chain, but it is clean enough and not weird.

This surface is meant to cover things like:

- deterministic smoothing
- chunk growth/closure
- placeholder lower-band generation
- maybe retry/reconcile behavior later

The human preferred this over uglier names like:

- background maintenance
- async-thread-manager
- async-thread-broker

### `PI CLI harness adapter` / `pi-cli-ha`

This seems to be the preferred naming direction for the PI-facing adapter
surface or implementation.

Important distinction:

- `harness adapter` is the general role or pattern
- `pi-cli-ha` is the concrete PI CLI implementation

In docs/comments:

- write out `PI CLI harness adapter`

In code:

- `pi-cli-ha` is acceptable shorthand

This was preferred over stale names like:

- `PI Runtime Integration`
- `PI Runtime Adapter`
- `PI Session Adapter`

Though those may still be conceptually adjacent.

---

## 9. Current Top-Level Shape That Seems To Be Emerging

This is not final. This is the current shape that seems closest to the human’s
preferred direction.

- `thread`
  - canonical source-of-truth side

- `thread-view`
  - curated runtime-facing side

- `async-thread`
  - async derived-state side

- `pi-cli-ha`
  - PI CLI harness adapter implementation

The major unresolved structural question is:

**what is the parent/peer relationship between these?**

That is still not fully settled.

---

## 10. The Big Structural Question

This is probably the central architecture naming problem now:

### Option A: Sibling top-level surfaces

- `thread`
- `thread-view`
- `async-thread`
- `harness-adapter` family / `pi-cli-ha`

Pros:

- clean separation by responsibility
- easy to explain each surface
- aligns with current naming improvements

Cons:

- may understate the fact that some of these are deeply subordinate to Thread

### Option B: `thread` as the broad parent

Something like:

- `thread/`
  - source-truth modules
  - `thread-view/`
  - `async-thread/`
  - maybe harness-facing pieces somewhere under or beside it

This seems closer to what the human was poking at:

- maybe `thread` is the broad parent
- maybe `thread-view` and `async-thread` are children
- maybe `pi-cli-ha` is not top-level at all

Pros:

- reflects that all of this is really downstream of Thread
- gives a cleaner hierarchy

Cons:

- could blur the distinction between source side and runtime-facing side if done
  sloppily

### Option C: `thread` and `thread-view` as the two primary domains, others
under them

For example:

- `thread/`
  - canonical records
  - maybe async derivation state tied directly to thread

- `thread-view/`
  - builders
  - materialization
  - target-specific builders
  - PI output shaping

- `pi-cli-ha/`
  - adapter layer that loads the PI-target file

This may be the most semantically honest split:

- source truth domain
- curated runtime view domain
- PI harness adapter

But it still leaves an open question:

**does `async-thread` belong under `thread`, or is it peer to `thread`?**

My current guess is that the human is leaning toward:

- `thread` as a high-order parent
- `thread-view` as a high-order child/surface under that world
- `async-thread` maybe also under that world
- `pi-cli-ha` definitely not a peer to everything else

But this is still not fully resolved.

---

## 11. How Feature 3 Complicates The Top-Level Breakdown

Epic 3 is the first feature that forces all these pieces to work together in a
real loop.

That loop includes:

1. source-thread state exists
2. turns close
3. deterministic smooth text gets created
4. chunk state evolves
5. placeholder lower-band artifacts appear
6. a draft Thread View is rebuilt
7. a PI-target thread-view file is produced
8. the PI CLI harness adapter tells PI to load it

That means any top-level breakdown has to make this loop legible.

If the surfaces are named badly, the loop becomes muddy.

Examples of muddy phrasing:

- “Context Steward Core writes projection revisions”
- “Background Maintenance prepares compaction artifacts”
- “Projection Compiler emits generated session files”
- “PI Runtime Integration reloads the runtime”

All of those are technically sort of understandable.
All of them are also less clear than they should be.

We want something more like:

- thread records source truth
- async-thread produces derived state
- thread-view builds curated runtime-facing views
- pi-thread-view-builder produces the PI-target view/file
- PI CLI harness adapter tells PI to load it

That is much closer to plain English.

---

## 12. Feature 2 Seam That Feature 3 Must Resolve

A very important recent implementation lesson:

Feature 2 ended with a lower-band seam.

In practice:

- workbench lower-band awareness existed
- chunk-like reads existed as an interface
- but production behavior still leaned on an empty chunk-reader fallback and
  test-injected chunk data in some paths
- lower-band edit/materialization did not fully prove real closed-chunk and
  artifact validation in production-backed behavior

This matters because Epic 3 cannot treat chunks as merely conceptual anymore.

Feature 3 has to make them real:

- real persisted chunk lifecycle state
- real placeholder lower-band artifacts
- real production-backed chunk reads
- real validation at rebuild/materialization time

This makes the naming and modular boundaries even more important, because
“lower-band awareness” is no longer enough. Feature 3 is the real thing.

---

## 13. What Feature 3 Is Trying To Prove

Feature 3 is not trying to prove that the summaries are good.

It is trying to prove that the system mechanics work.

Those mechanics include:

- deterministic smooth-turn generation
- deterministic chunk eligibility
- deterministic open-chunk growth
- deterministic chunk closure
- deterministic placeholder lower-band generation
- deterministic Thread View rebuild from explicit run inputs
- deterministic materialization into emitted Thread View messages
- generation of a PI-target thread-view file
- archive and reload behavior
- explicit blocked/degraded state

The naming and surface map should make that loop easier to understand, not
harder.

---

## 14. Likely Fine-Grained Responsibilities Inside Each Surface

These are not final module names. They are just the capability buckets we need
some top-level structure to host.

### Under `thread`

Likely responsibilities:

- thread record access
- message/part access
- turn state access
- canonical ordering
- thread-level metadata

### Under `async-thread`

Likely responsibilities:

- deterministic smooth-turn generation
- smooth repair/regeneration
- chunk eligibility evaluation
- open-chunk update
- chunk closure
- placeholder lower-band generation
- maybe later retry/reconcile behavior

### Under `thread-view`

Likely responsibilities:

- draft Thread View creation
- band selection
- band validation
- emitted message materialization
- compare draft vs active
- activate/archive

And within that surface:

- `thread-view-builder`
- maybe `thread-view-materializer`
- maybe target-specific thread-view builders

### Under PI target / harness side

Likely responsibilities:

- produce the PI-target thread-view file
- write it atomically
- archive the prior one
- tell PI to load it

This may split into:

- `pi-thread-view-builder`
- `pi-cli-ha`

or something close to that.

---

## 15. Candidate Structural Interpretations

Here are some candidate interpretations that a stronger model should evaluate.

### Interpretation 1

Top-level surfaces:

- `thread`
- `thread-view`
- `async-thread`
- `harness-adapter`

PI-specific pieces:

- `thread-view/pi-thread-view-builder`
- `harness-adapter/pi-cli-ha`

### Interpretation 2

Top-level surfaces:

- `thread`
- `thread-view`
- `harness-adapter`

And `async-thread` is actually a sub-surface under `thread`, because it is
producing derived thread state, not an independently meaningful product domain.

This feels plausible.

### Interpretation 3

Top-level surfaces:

- `thread`
- `thread-view`

And:

- `async-thread` is a subsystem within `thread`
- `pi-thread-view-builder` is a subsystem within `thread-view`
- `pi-cli-ha` is a concrete harness adapter implementation

This might be the cleanest if the goal is not to explode the number of
top-level surfaces.

### Interpretation 4

Top-level surfaces:

- `thread`
- `runtime-thread-view`
- `harness-adapter`

This is less likely to be preferred because `thread-view` already seems to be
the accepted concept, and inventing `runtime-thread-view` now probably adds
more churn than value.

---

## 16. Naming Anti-Goals

These are names or naming styles that should probably be avoided unless there is
a very strong reason.

### Avoid actor-branded surface names

- `Context Steward Core`
- `Context Steward Runtime`
- `Context Steward Projection`

Reason:

- blurs actor and architecture
- overbrands implementation

### Avoid stale `projection` language as the center of the system

- `projection compiler`
- `projection manager`
- `projection engine`

Reason:

- Thread View is the newer, better concept
- `projection` may survive only as legacy metadata terminology, if at all

### Avoid overblown language

- compiler
- orchestrator, unless it truly orchestrates many sub-workers
- engine
- broker

These all risk sounding more abstract or magical than the system actually is.

### Avoid weak vague “manager” names unless unavoidable

- manager
- controller
- coordinator

Not forbidden, just suspect.

### Avoid awkward noun chains

The human explicitly does not want a long weird three-word module name where the
third word adds little value.

This is why `async-thread` won over longer names like `async-thread-maintenance`
or `async-thread-manager`.

---

## 17. Naming Preferences By Surface

This section compresses the likely direction.

### Source-of-truth side

Preferred:

- `thread`

Not preferred:

- `thread-core`
- `thread-manager`
- `context-steward-core`

### Curated runtime-facing side

Preferred:

- `thread-view`

Within it:

- `thread-view-builder`
- `pi-thread-view-builder`

Not preferred:

- `projection`
- `projection-compiler`
- `view-compiler`

### Async derived-state side

Preferred:

- `async-thread`

Not preferred:

- `background-maintenance`
- `async-thread-broker`
- `async-thread-manager`

### PI harness side

Preferred:

- docs/comments: `PI CLI harness adapter`
- code shorthand: `pi-cli-ha`

Not preferred:

- `pi-runtime-integration`
- `runtime-integration`
- `pi-runtime-bridge`

though these may still be usable conceptually if the final model thinks a
slightly fuller written form is needed somewhere.

---

## 18. What A Stronger Model Should Actually Solve

The high-value question is not:

- “come up with prettier names”

The high-value question is:

**Given this product and these constraints, what is the cleanest top-level
domain/module breakdown, and what should each top-level surface and key
submodule be called?**

That question should be answered with attention to:

- source truth vs curated view vs async derivation vs harness adaptation
- current and future targets
- Feature 3 mechanics
- Feature 4 future quality work
- human readability
- story/design/test navigability
- resistance to stale old names

---

## 19. A Possible Question To Ask A Stronger Model

Here is the kind of question this braindump is intended to support:

> We are building a long-horizon context-management system around an existing
> PI agent runtime. The authoritative source record is a Thread. A curated
> runtime-facing object is a Thread View. There is also an async derived-state
> area that handles deterministic smoothing, chunk lifecycle, and placeholder
> lower-band outputs. PI is the first harness/target, and we need a PI CLI
> harness adapter plus a PI-specific thread-view builder.
>
> We are trying to settle the top-level surface/module breakdown and the names
> for those surfaces. We want plain, non-weird English. We do not want stale
> names like Context Steward Core or Projection Compiler. We dislike vague
> nouns like broker or overblown nouns like compiler. We like `thread`,
> `thread-view`, `async-thread`, `thread-view-builder`, `pi-thread-view-builder`,
> and `PI CLI harness adapter` / `pi-cli-ha`.
>
> Please propose the cleanest top-level architecture naming and module
> breakdown for this system. Be explicit about:
> - which things are true top-level surfaces
> - which things are modules inside those surfaces
> - how the Feature 3 deterministic maintenance loop should map across them
> - which old names should be retired
> - what naming convention should be used in docs vs code

That is the actual problem we are trying to solve.

---

## 20. My Current Best Guess

This is not final. It is just the current best local synthesis.

### Likely top-level surfaces

- `thread`
- `thread-view`
- maybe `harness-adapter`

### Likely not top-level, but important

- `async-thread` may actually be a major sub-surface under `thread`
- `thread-view-builder` is a module within `thread-view`
- `pi-thread-view-builder` is a target-specific module within `thread-view`
- `pi-cli-ha` is a concrete implementation under the harness-adapter side

### Why this may be right

- keeps top-level count small
- keeps `thread-view` as a real primary concept
- avoids making every large capability its own top-level kingdom
- treats PI-facing adaptation as a separate concern from source and view

But I am not fully confident yet, which is why this braindump exists.

---

## 21. Final Summary

The project is trying to stabilize a long-horizon context system whose core
ideas are now clearer than its architecture vocabulary.

The product concepts are getting better:

- Thread
- Thread View
- deterministic async derivation
- PI-target Thread View output
- PI CLI harness adapter

But the top-level module/surface map is still not fully settled, and old names
keep leaking back in.

The human’s core ask is:

- stop using weird names
- stop deepening stale names
- use plain English
- distinguish top-level surfaces from modules inside them
- build a structure that makes Feature 3 and later work easier to reason about

That is the state of the problem.
