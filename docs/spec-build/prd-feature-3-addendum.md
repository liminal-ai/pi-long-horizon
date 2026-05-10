# Feature 3 Addendum: Design Elements Surfaced During Epic 2 Planning

This document captures design decisions and scope refinements for Feature 3 (Band, Chunk, and Projection Mechanics) that emerged during the Epic 2 design conversation. These should be reconciled with the PRD and architecture before Epic 3 spec work begins.

---

## Thread View Replaces Projection Revision as Primary Concept

The architecture defined `ProjectionRevision` as the recorded output of smart compact. During Epic 2 planning, a richer concept emerged: **Thread View**.

A Thread View is a first-class persisted object representing a curated, banded context expression over a source Thread. It is not just a record of what was emitted — it captures composition intent, band structure, and curation decisions.

- Each Thread has exactly **one active Thread View** at any time
- Other Thread Views may be `draft` or `archived`
- The active Thread View is what PI runs against
- Draft views start empty and are assembled from source truth
- Thread Views are curated expressions, not source mutations

The relationship between Thread View and ProjectionRevision needs to be reconciled. Options:
- Thread View subsumes ProjectionRevision entirely
- ProjectionRevision becomes output metadata on a Thread View (the artifact produced when a Thread View is materialized for PI)
- Both survive with clear ownership boundaries

The Epic 2 design leans toward Thread View as the primary concept with projection metadata as a property of a materialized view.

---

## Thread View Is Structured as Four Ordered Band Regions

A Thread View is not a flat message list. It is explicitly structured as four ordered band regions:

| Band | Selection Unit | Representation |
|------|---------------|----------------|
| Full fidelity | Turns (newest) | Raw messages from selected turns |
| Smooth | Turns | One synthetic smooth-turn message per turn |
| Detailed | Chunks (closed) | ~30% actor-narrative summary per chunk |
| Brief | Chunks (closed, oldest) | ~5% third-person brief summary per chunk |

Each band stores **explicit ordered selected source-unit IDs** (turn IDs for upper bands, chunk IDs for lower bands). The materialized message sequence is derived from these selections but also persisted for fast inspection and runtime binding.

Band allocation works backward from newest to oldest, filling the highest-fidelity band first.

---

## Thread View Lifecycle and Normal Operation

During normal operation between smart compactions:
- New raw messages are appended to the active Thread View in the full-fidelity region
- PI keeps operating on the growing full-fidelity tail
- No band rework happens during normal turn-by-turn operation

Smart compaction triggers when the active Thread View crosses the configured upper threshold. It creates a new draft Thread View, fills it from source truth according to band targets, and activates it (replacing the previous active view). The goal is to bring the active view below the lower threshold.

Example thresholds for gpt-5.5: upper ~225k tokens, lower ~185k tokens.

Band targets should be **adaptive with configurable parameters**, not fixed percentages. Pure percentage allocation behaves badly at the edges (too few turns, very large turns, uneven chunk sizes).

---

## Smart Compaction Band-Fill Process

The build process for a new Thread View during smart compaction:

1. Calculate overall token budget (lower threshold target minus non-thread overhead)
2. Reserve band budget targets
3. **Full fidelity**: select newest turns backward, measuring raw token cost per turn, until the band budget is approximately filled. The open turn is always included. Selection boundary falls on a turn boundary, never splitting a turn across bands.
4. **Smooth band**: select the next older turns, measuring smooth-turn token cost per turn. Generally a contiguous range adjacent to full fidelity. The open chunk's turns live here.
5. **Detailed band**: select older closed chunks, using their ~30% detailed summary token cost.
6. **Brief band**: select oldest closed chunks, using their ~5% brief summary token cost.
7. Verify total fits under the lower threshold.

Turns are never split across bands. Chunks are never split. The allocation is over coherent units at each level.

---

## Smoothing Is Turn-Level

Smoothing operates on the canonical turn, not individual messages. Output is one synthetic wire-format message per closed turn.

The smooth representation preserves actor back-and-forth using standardized markers:
- `[user]`
- `[assistant]`
- `[tool]`
- `[thinking]`

This decision means the token accounting model for band allocation has four representation costs per source lineage:
- Raw token count per turn (for full-fidelity allocation)
- Smooth token count per turn (for smooth-band allocation)
- Detailed token count per chunk (for detailed-band allocation)
- Brief token count per chunk (for brief-band allocation)

---

## Chunk Formation Pipeline

Chunks are formed upstream of smart compaction, not during it. Smart compaction consumes precomputed chunk artifacts; it does not create them on the critical path.

### Formation Process

- Exactly one **open chunk** exists at any time
- All older chunks are **closed**
- The open chunk accumulates consecutive smooth turns as they become available
- Chunk sizing targets: roughly 4k-7k smoothed tokens (configurable)
- When the open chunk reaches the boundary-decision range, a closure decision is made
- Closure can be deterministic (size thresholds) or agent-assisted (semantic topic drift, narrative breaks)
- When a chunk closes, a new open chunk starts from the next smooth turn

### Key Invariant

The open chunk remains in the **smooth band** of the Thread View until it closes. Only closed chunks may be represented by detailed or brief summaries. This avoids the hybrid state where something is "in the 30% band" without actually having a 30% representation.

### Async Dependency Chain

After a turn closes, the following maintenance chain runs asynchronously:

1. Turn closes
2. Smooth-turn job runs
3. Smooth-turn token count becomes available
4. Open-chunk update runs (smoothed turn added to open chunk)
5. Chunk-close check runs
6. If chunk closes → detailed summary job becomes eligible
7. Brief summary job becomes eligible after detailed summary

This chain should be checked turn-by-turn, asynchronously, in response to new turn endings. A **background reconciliation process** should also track the dependency chain and retry stalled or failed steps.

---

## Chunk Summary Representations

Each closed chunk has two summary forms:

- **Detailed summary (~30%)**: maintains an actor-narrative style. The back-and-forth between user and agent is preserved in compressed prose form. Tool calls and reasoning traces appear as prose only when they help explain the work.
- **Brief summary (~5%)**: third-person narrative description. Preserves project trajectory, decisions, unresolved threads, and stable context. Does not preserve turn-by-turn actor back-and-forth.

A chunk owns its available derived artifacts (smooth concatenation, detailed summary, brief summary). The Thread View decides which representation to use for that chunk in a specific assembled context. Representation level is a **Thread View composition property**, not an intrinsic chunk property.

---

## Turn-Level Exclusion and Curation

Exclusion from a Thread View operates at the **turn level**. Message-level exclusion is not supported in the initial version.

Exclusion is a **view-composition decision**, not a source-history mutation. The source Thread stays complete and authoritative. A turn excluded from one Thread View can be included in another.

The smooth band should be modeled as an ordered selection of turn IDs (not just a contiguous range) so that bespoke exclusions are possible without breaking the data model. The default is contiguous, but the representation must support exceptions.

---

## Prompt Caching Awareness

Thread View structure must account for inference-time prompt caching behavior on target platforms:

**OpenAI Responses API**: automatic caching for prompts >= 1024 tokens. Cache hits require exact prefix match. Static content should be at the front; variable content at the end.

**Anthropic Messages API**: explicit cache control via `cache_control` markers. Cache scope follows prefix order: tools → system → messages. Cache TTL is 5 minutes (1 hour in beta). Changes to tools, system, message prefix, images, tool_choice, and thinking settings can invalidate cached message prefixes.

### Design Implication

Thread View construction should minimize changes to earlier (older) regions of the assembled context. The primary design principle:

**Earlier regions of a Thread View should be treated as stability-sensitive. Later regions should absorb most change whenever possible.**

Smart compaction should be designed so that:
- The brief and detailed bands (oldest, most stable) change infrequently
- The smooth band changes moderately
- The full-fidelity band absorbs most churn

Thread View assembly should preserve exact prefix structure across compactions when the underlying band content hasn't changed. This is not just a performance concern — it directly affects inference cost through cache hit rates.

Feature 3 should track and expose cache-relevant metrics:
- How much of the prefix was preserved across a compaction
- What percentage of content changed per band
- Whether compaction configuration choices are cache-friendly

---

## Smart Compaction Prerequisite Handling

When smart compaction runs and required artifacts are not ready:

- Smart compaction should **stop, surface the blocker, and trigger or wait on dependency repair/prep work** — not silently degrade
- The system should offer both behaviors via mode/config:
  - Strict/report-only: fail with a blocker report
  - Orchestrated: try to satisfy prerequisites, then continue if possible
- Smart compaction is not allowed to silently pretend missing prerequisites are satisfied

Tracking metrics for how often compaction is blocked:
- Compactions attempted with all prerequisites ready
- Compactions blocked on smoothing
- Compactions blocked on chunk closure
- Compactions blocked on detailed summary
- Compactions blocked on brief summary
- Mean lag between turn close and prerequisite readiness

These metrics indicate whether thresholds are too aggressive, smoothing is too slow, or the async pipeline is falling behind.

---

## Items to Reconcile Before Epic 3 Spec

1. **Thread View vs ProjectionRevision**: settle whether Thread View subsumes ProjectionRevision or they coexist with clear boundaries
2. **Thread View record schema**: define the persisted format including band regions, selected IDs, materialized messages, and metadata
3. **Band budget calculation**: exact algorithm for adaptive band targets (not fixed percentages)
4. **Chunk formation timing**: confirm that chunk formation runs as part of async maintenance, not on the smart compaction critical path
5. **Smooth-turn format**: finalize the wire-format structure and actor markers for smooth turn messages
6. **Token accounting**: where and when raw/smooth/detailed/brief token counts are computed and stored
7. **Cache-aware assembly**: how Thread View construction ensures prefix stability across compactions
8. **Background reconciler scope**: what the reconciler monitors, how it retries, and what it reports
9. **"Context Steward" naming cleanup**: refactor Epic 1 module names post-Epic 2 to remove unnecessary branding (appendix to Epic 1)
